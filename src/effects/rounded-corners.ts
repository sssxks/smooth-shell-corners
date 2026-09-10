import type {CornerConfig, ShadowConfig} from '../settings/config.js';
import type {WindowBounds} from '../shell/window-geometry.js';

import Cogl from 'gi://Cogl';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';

import {createShadowBaker, cachedShadow, cacheShadow, clearShadowCache, shadowGeneration} from './shadow-baker.js';
import {textureExtent} from './texture-extent.js';
import {shadowGeometry} from './shadow-geometry.js';
import {BodyDetector} from './body-detector.js';

import {
    BODY_DECLARATIONS,
    FILL_CODE,
    FILL_DECLARATIONS,
    ROUNDED_CODE,
    ROUNDED_DECLARATIONS,
    EFFECT_SHADOW_CODE,
    EFFECT_SHADOW_DECLARATIONS,
} from './shaders.js';

export const RoundedCornersEffect = GObject.registerClass(
    { GTypeName: 'SSCRoundedCornersEffect' },
    class RoundedCornersEffect extends Clutter.Effect {

        _u: Record<
            'fillPadding' | 'sampleBounds' | 'bounds' | 'clipRadius' | 'borderWidth' |
            'borderColor' | 'borderedAreaBounds' | 'borderedAreaClipRadius' |
            'exponent' | 'pixelStep' | 'textureOrigin' | 'bodyTextureStep' | 'bodyEnabled' | 'windowOpacity', number
        > | null = null;
        _pipeline: Cogl.Pipeline | null = null;
        _framebuffer: Cogl.Offscreen | null = null;
        _paintScale = 1;
        _rasterScale = 1;
        _sourceWidth = 0;
        _sourceHeight = 0;
        _originX = 0;
        _originY = 0;
        _stage: Clutter.Stage | null = null;
        _purgeConnection = 0;
        _sample: [number, number, number, number] = [0, 0, 0, 0];
        _windowBounds = {x1: 0, y1: 0, x2: 0, y2: 0};
        _detectBody = false;
        _bodyFailed = false;
        _bodyDetector: BodyDetector | null = null;
        _bodyShadowTexture: Cogl.Texture | null = null;
        _bodyShadowKey = '';
        _shadowEnabled = false;
        _shadowKey = '';
        _shadowGeneration = -1;
        _shadowHole: [number, number, number, number] = [0, 0, 0, 0];
        _shadowHoleRadius = 0;
        _shadowExponent = 2;
        _shadowOpacity = 0;
        _shadowBlur = 0;
        _shadowSpread = 0;
        _shadowOffset: [number, number] = [0, 0];
        _shadowBaker: ReturnType<typeof createShadowBaker> | null = null;
        _shadowPipeline: Cogl.Pipeline | null = null;
        _shadowUniforms: Record<string, number> | null = null;

        clearShadowResources(): void {
            this._bodyShadowTexture = null;
            this._bodyShadowKey = '';
            this._shadowKey = '';
            this._shadowGeneration = -1;
            this._shadowPipeline = null;
            this._shadowBaker = null;
            this._shadowUniforms = null;
        }

        override vfunc_set_actor(actor: Clutter.Actor | null) {
            if (this._purgeConnection) this._stage?.disconnect(this._purgeConnection);
            this._purgeConnection = 0;
            this._stage = null;
            this._bodyDetector?.dispose();
            this._bodyDetector = null;
            this._bodyFailed = false;
            this._framebuffer = null;
            this._pipeline = null;
            this._u = null;
            this.clearShadowResources();
            super.vfunc_set_actor(actor);
        }

        override vfunc_modify_paint_volume(volume: Clutter.PaintVolume): boolean {
            // TRUE preserves the supplied bounds; FALSE makes them unknown,
            // breaking the overview clones' cached pointer hit-test regions.
            if (!this._shadowEnabled) return true;
            const pad = (Math.abs(this._shadowSpread) + this._shadowBlur + 2 +
                Math.max(...this._shadowOffset.map(Math.abs))) * this._paintScale;
            const origin = volume.get_origin();
            volume.set_origin(new Graphene.Point3D({x: origin.x - pad, y: origin.y - pad, z: origin.z}));
            volume.set_width(volume.get_width() + 2 * pad);
            volume.set_height(volume.get_height() + 2 * pad);
            return true;
        }

        override vfunc_paint(node: Clutter.PaintNode, _context: Clutter.PaintContext, flags: Clutter.EffectPaintFlags) {
            const actor = this.actor;
            if (!this._pipeline || flags & Clutter.EffectPaintFlags.BYPASS_EFFECT) {
                node.add_child(Clutter.ActorNode.new(actor, -1));
                this._framebuffer = null;
                this._pipeline?.set_layer_null_texture(0);
                return;
            }

            const stage = actor.get_stage();
            if (stage !== this._stage) {
                if (this._purgeConnection) this._stage?.disconnect(this._purgeConnection);
                this._stage = stage;
                this._purgeConnection = stage.connect('gl-video-memory-purged', () => {
                    clearShadowCache();
                    this._bodyDetector?.dispose();
                    this._bodyDetector = null;
                    this.clearShadowResources();
                    this._bodyFailed = false;
                    this._framebuffer = null;
                    this._pipeline?.set_layer_null_texture(0);
                    this.queue_repaint();
                });
            }

            let scale = this._paintScale;
            // One extra physical pixel accommodates any fractional origin
            // without reallocating the texture on every step of a window drag.
            const [stageWidth, stageHeight] = actor.get_transformed_size();
            let originX = 0, originY = 0;
            if (!actor.is_in_clone_paint() &&
                Math.abs(stageWidth - actor.get_width()) < 0.001 &&
                Math.abs(stageHeight - actor.get_height()) < 0.001) {
                const [x, y] = actor.get_transformed_position();
                originX = (Math.floor(x * scale) - x * scale) / scale;
                originY = (Math.floor(y * scale) - y * scale) / scale;
            } else {
                // get_transformed_position/size describe the source actor, not
                // the clone currently being painted in overview. Project three
                // local points through the actual paint transform instead.
                const target = _context.get_framebuffer();
                const modelview = target.get_modelview_matrix();
                const projection = target.get_projection_matrix();
                const [vx, vy, vw, vh] = target.get_viewport4fv();
                const project = (x: number, y: number): [number, number] => {
                    const point = new Graphene.Vec4().init(x, y, 0, 1);
                    const clip = projection.transform_vec4(modelview.transform_vec4(point));
                    return [vx + (1 + clip.get_x() / clip.get_w()) * vw / 2,
                        vy + (1 - clip.get_y() / clip.get_w()) * vh / 2];
                };
                const p = project(0, 0), right = project(100, 0), bottom = project(0, 100);
                const sx = (right[0] - p[0]) / 100, sy = (bottom[1] - p[1]) / 100;
                // Keep the regular texture for rotations/perspective or
                // non-uniform stretching; those inherently require resampling.
                if (sx > 0.001 && Math.abs(sx - sy) < 0.00001 &&
                    Math.abs(right[1] - p[1]) < 0.001 && Math.abs(bottom[0] - p[0]) < 0.001) {
                    scale = Math.round(sx * 100000) / 100000;
                    const x = Math.round(p[0] * 1024) / 1024;
                    const y = Math.round(p[1] * 1024) / 1024;
                    originX = (Math.floor(x) - x) / scale;
                    originY = (Math.floor(y) - y) / scale;
                }
            }
            const sourceWidth = Math.max(1, Math.ceil(actor.get_width() * scale) + 1);
            const sourceHeight = Math.max(1, Math.ceil(actor.get_height() * scale) + 1);
            const width = textureExtent(sourceWidth, this._framebuffer?.get_width());
            const height = textureExtent(sourceHeight, this._framebuffer?.get_height());

            let dirty = !!(flags & Clutter.EffectPaintFlags.ACTOR_DIRTY);
            if (sourceWidth !== this._sourceWidth || sourceHeight !== this._sourceHeight) dirty = true;
            this._sourceWidth = sourceWidth;
            this._sourceHeight = sourceHeight;
            if (originX !== this._originX || originY !== this._originY) dirty = true;
            if (scale !== this._rasterScale) dirty = true;
            this._rasterScale = scale;
            this._originX = originX;
            this._originY = originY;
            if (!this._framebuffer || this._framebuffer.get_width() !== width ||
                this._framebuffer.get_height() !== height) {
                const context = actor.get_context().get_backend().get_cogl_context();
                const texture = Cogl.Texture2D.new_with_size(context, width, height);
                const framebuffer = Cogl.Offscreen.new_with_texture(texture);
                try {
                    framebuffer.allocate();
                } catch (error) {
                    // Keep the window usable if the GPU cannot allocate the
                    // target. A later settings/geometry refresh may retry it.
                    console.error(`[SmoothShellCorners] ${String(error)}`);
                    this._framebuffer = null;
                    this._pipeline?.set_layer_null_texture(0);
                    this.enabled = false;
                    node.add_child(Clutter.ActorNode.new(actor, -1));
                    return;
                }
                this._framebuffer = framebuffer;
                this._pipeline.set_layer_texture(0, texture);
                dirty = true;
            }

            const framebuffer = this._framebuffer;
            framebuffer.set_viewport(0, 0, width, height);
            framebuffer.orthographic(originX, originY,
                originX + width / scale, originY + height / scale, -1, 1);
            framebuffer.set_modelview_matrix(new Graphene.Matrix().init_identity());
            this._updateTextureMapping(width, height, originX, originY, scale);
            const opacity = actor.get_paint_opacity() / 255;
            this._pipeline.set_uniform_float(this._u!.windowOpacity, 1, 1, [opacity]);

            this._ensureBodyDetector();
            const detector = this._bodyDetector;
            if (flags & Clutter.EffectPaintFlags.ACTOR_DIRTY && !actor.is_in_clone_paint())
                detector?.contentChanged();
            if (detector?.pending && !actor.is_in_clone_paint()) {
                const capture = Clutter.LayerNode.new_to_framebuffer(framebuffer, this._pipeline);
                capture.add_child(Clutter.ActorNode.new(actor, 255));
                capture.paint(_context);
                dirty = false;
                const b = this._windowBounds;
                detector.render(framebuffer.get_texture(), [b.x1, b.y1, b.x2, b.y2],
                    scale, [originX, originY]);
            }
            this._bindBody(this._pipeline);

            if (this._shadowEnabled) this._ensureShadowPipeline();
            if (this._shadowEnabled && this._shadowPipeline && this._shadowUniforms) {
                // Bake at monitor density, independent of overview zoom and
                // content damage. Clones transform the same cached geometry.
                const [x1, y1, x2, y2] = this._shadowHole;
                const geometry = shadowGeometry(Math.max(0, x2 - x1), Math.max(0, y2 - y1),
                    this._shadowHoleRadius, this._shadowExponent,
                    this._shadowBlur, this._shadowSpread, this._paintScale);
                // The CPU does not know GPU insets. If up to 64 logical pixels
                // on each side could make corners overlap, bake the actual body
                // in a private tile. Larger windows retain the shared tile path.
                const direct = this._detectBody && (x2 - x1 < geometry.width + 128 ||
                    y2 - y1 < geometry.height + 128);
                if (direct) {
                    geometry.width = Math.max(0, x2 - x1);
                    geometry.height = Math.max(0, y2 - y1);
                }
                const directKey = [geometry.key, x2 - x1, y2 - y1,
                    detector?.revision ?? -1, shadowGeneration].join(',');
                let texture = direct ? this._bodyShadowKey === directKey
                    ? this._bodyShadowTexture ?? undefined : undefined : cachedShadow(geometry.key);
                if (!texture && !direct && this._shadowKey === geometry.key && this._shadowGeneration === shadowGeneration) {
                    // Active windows already retain this texture for painting.
                    // LRU eviction must not force them to rebake every frame.
                    texture = this._shadowPipeline.get_layer_texture(0);
                } else if (!texture) {
                    texture = this._renderShadowTexture(geometry, direct) ?? undefined;
                    if (texture && direct) {
                        this._bodyShadowKey = directKey;
                        this._bodyShadowTexture = texture;
                    } else if (texture) cacheShadow(geometry.key, texture);
                }
                if (!direct) this._bodyShadowTexture = null;
                if (texture) {
                    const pipeline = this._shadowPipeline, u = this._shadowUniforms;
                    const [dx, dy] = this._shadowOffset;
                    const left = x1 + dx - geometry.margin, top = y1 + dy - geometry.margin;
                    const right = x2 + dx + geometry.margin, bottom = y2 + dy + geometry.margin;
                    pipeline.set_layer_texture(0, texture);
                    this._bindBody(pipeline);
                    // A private body tile must never satisfy shared-tile reuse
                    // after a resize crosses the small-window threshold.
                    this._shadowKey = direct ? '' : geometry.key;
                    this._shadowGeneration = shadowGeneration;
                    for (const [key, values] of Object.entries({
                        effectShadowOpacity: [this._shadowOpacity * opacity],
                        effectShadowRectOrigin: [left, top],
                        effectShadowRectSize: [right - left, bottom - top],
                        effectShadowTileSize: [geometry.width, geometry.height],
                        effectShadowTextureSize: [texture.get_width() / this._paintScale,
                            texture.get_height() / this._paintScale],
                        effectShadowDirect: [direct ? 1 : 0],
                        effectShadowMargin: [geometry.margin], effectShadowEdge: [geometry.edge],
                        effectShadowOffset: this._shadowOffset, bounds: this._shadowHole,
                        clipRadius: [this._shadowHoleRadius], exponent: [this._shadowExponent],
                    })) pipeline.set_uniform_float(u[key], values.length, 1, values);
                    const shadow = Clutter.PipelineNode.new(pipeline);
                    shadow.add_texture_rectangle(new Clutter.ActorBox({x1: left, y1: top,
                        x2: right, y2: bottom}), 0, 0, 1, 1);
                    node.add_child(shadow);
                }
            } else {
                this._shadowKey = '';
                this._shadowPipeline?.set_layer_null_texture(0);
            }

            // Render content at full opacity and modulate once when compositing.
            // Reuse the texture for opacity and shader-only changes. New content,
            // a different pixel phase or a different painted scale invalidates it.
            const target = dirty
                ? Clutter.LayerNode.new_to_framebuffer(framebuffer, this._pipeline)
                : Clutter.PipelineNode.new(this._pipeline);
            target.add_texture_rectangle(new Clutter.ActorBox({
                x1: originX, y1: originY,
                x2: originX + sourceWidth / scale, y2: originY + sourceHeight / scale,
            }), 0, 0, sourceWidth / width, sourceHeight / height);
            node.add_child(target);
            if (dirty) target.add_child(Clutter.ActorNode.new(actor, 255));
        }

        _ensureUniforms() {
            if (this._u && this._pipeline) return {u: this._u, pipeline: this._pipeline};
            const context = this.actor.get_context().get_backend().get_cogl_context();
            this._pipeline = Cogl.Pipeline.new(context);
            this._pipeline.set_blend('RGBA = ADD (SRC_COLOR, DST_COLOR * (1-SRC_COLOR[A]))');
            this._pipeline.set_layer_filters(0, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
            const fallback = Cogl.Texture2D.new_with_size(context, 1, 1);
            fallback.allocate();
            this._pipeline.set_layer_texture(1, fallback);
            this._pipeline.set_layer_combine(1, 'RGBA = REPLACE (PREVIOUS)');
            const fill = Cogl.Snippet.new(Cogl.SnippetHook.TEXTURE_LOOKUP,
                BODY_DECLARATIONS + FILL_DECLARATIONS, null);
            fill.set_replace(FILL_CODE);
            this._pipeline.add_layer_snippet(0, fill);
            this._pipeline.add_snippet(Cogl.Snippet.new(
                Cogl.SnippetHook.FRAGMENT, ROUNDED_DECLARATIONS, ROUNDED_CODE,
            ));
            this._u = {
                windowOpacity:          this._pipeline.get_uniform_location('windowOpacity'),
                bodyEnabled:            this._pipeline.get_uniform_location('bodyEnabled'),
                bodyTextureStep:        this._pipeline.get_uniform_location('bodyTextureStep'),
                fillPadding:            this._pipeline.get_uniform_location('fillPadding'),
                sampleBounds:           this._pipeline.get_uniform_location('sampleBounds'),
                bounds:                 this._pipeline.get_uniform_location('bounds'),
                clipRadius:             this._pipeline.get_uniform_location('clipRadius'),
                borderWidth:            this._pipeline.get_uniform_location('borderWidth'),
                borderColor:            this._pipeline.get_uniform_location('borderColor'),
                borderedAreaBounds:     this._pipeline.get_uniform_location('borderedAreaBounds'),
                borderedAreaClipRadius: this._pipeline.get_uniform_location('borderedAreaClipRadius'),
                exponent:               this._pipeline.get_uniform_location('exponent'),
                pixelStep:              this._pipeline.get_uniform_location('pixelStep'),
                textureOrigin:          this._pipeline.get_uniform_location('textureOrigin'),
            };
            return {u: this._u, pipeline: this._pipeline};
        }

        _ensureShadowPipeline() {
            if (this._shadowPipeline) return;
            const context = this.actor.get_context().get_backend().get_cogl_context();
            const coordinateTexture = Cogl.Texture2D.new_with_size(context, 1, 1);
            coordinateTexture.allocate();
            const color = new Cogl.Color();

            const pipeline = Cogl.Pipeline.new(context);
            pipeline.set_layer_texture(0, coordinateTexture);
            pipeline.set_layer_filters(0, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
            pipeline.set_layer_wrap_mode(0, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);
            color.init_from_4f(0, 0, 0, 1);
            pipeline.set_color(color);
            pipeline.set_blend('RGBA = ADD (SRC_COLOR, DST_COLOR * (1-SRC_COLOR[A]))');
            pipeline.add_snippet(Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT,
                BODY_DECLARATIONS + ROUNDED_DECLARATIONS + EFFECT_SHADOW_DECLARATIONS, EFFECT_SHADOW_CODE));

            pipeline.set_layer_texture(1, coordinateTexture);
            pipeline.set_layer_combine(1, 'RGBA = REPLACE (PREVIOUS)');
            pipeline.set_layer_filters(1, Cogl.PipelineFilter.NEAREST, Cogl.PipelineFilter.NEAREST);
            this._shadowPipeline = pipeline;
            this._shadowUniforms = Object.fromEntries([
                'effectShadowOpacity', 'effectShadowRectOrigin', 'effectShadowRectSize',
                'effectShadowTileSize', 'effectShadowTextureSize', 'effectShadowMargin',
                'effectShadowEdge', 'effectShadowDirect', 'effectShadowOffset', 'bounds', 'clipRadius', 'exponent',
            ].map(name => [name, pipeline.get_uniform_location(name)]));
        }

        _renderShadowTexture(geometry: ReturnType<typeof shadowGeometry>, direct = false): Cogl.Texture | null {
            this._shadowBaker ??= createShadowBaker(this.actor.get_context().get_backend().get_cogl_context());
            return this._shadowBaker(geometry, this._shadowHoleRadius, this._shadowExponent,
                this._shadowBlur, this._shadowSpread, this._paintScale,
                pipeline => this._bindBody(pipeline, direct));
        }

        /**
         * Push updated values to every shader uniform.
         * @param {number} scaleFactor  – monitor scale factor (HiDPI)
         * @param {object} cfg          – rounded corner config from settings
         * @param {object} windowBounds – {x1, y1, x2, y2} in logical pixels
         * @param {number} paintScale   – actual monitor density, without rounding
         */
        updateUniforms(scaleFactor: number, cfg: CornerConfig, windowBounds: WindowBounds,
            paintScale = 1, shadow?: ShadowConfig, detectBody = false) {
            if (paintScale !== this._paintScale) this._framebuffer = null;
            this._paintScale = paintScale;
            this._detectBody = detectBody;
            const {u, pipeline} = this._ensureUniforms();

            const bw     = cfg.borderWidth * scaleFactor;
            const bc     = cfg.borderColor;
            const outerR = cfg.cornerRadius * scaleFactor;
            const { padding, smoothing } = cfg;

            const sample: [number, number, number, number] = [
                windowBounds.x1 + padding.left   * scaleFactor,
                windowBounds.y1 + padding.top    * scaleFactor,
                windowBounds.x2 - padding.right  * scaleFactor,
                windowBounds.y2 - padding.bottom * scaleFactor,
            ];

            const b = cfg.fillPadding
                ? [windowBounds.x1, windowBounds.y1, windowBounds.x2, windowBounds.y2]
                : sample;
            this._sample = sample;
            this._windowBounds = windowBounds;
            this._ensureBodyDetector();
            this._bodyDetector?.updateGeometry([windowBounds.x1, windowBounds.y1,
                windowBounds.x2, windowBounds.y2], paintScale);
            const actorW = this.actor.get_width();
            const actorH = this.actor.get_height();
            const bb = [b[0] + bw, b[1] + bw, b[2] - bw, b[3] - bw];

            // Match the signed rectangle inset: outer borders expand the
            // radius too, otherwise their corners become much thicker.
            // Keep square corners when rounding is disabled.
            let borderRadius = outerR > 0 ? Math.max(0, outerR - bw) : 0;

            let exponent = smoothing * 10 + 2;
            let radius   = outerR * 0.5 * exponent;
            const maxR   = Math.min(b[2] - b[0], b[3] - b[1]) / 2;
            if (maxR > 0 && radius > maxR) {
                exponent *= maxR / radius;
                radius    = maxR;
            }
            if (outerR > 0)
                borderRadius *= radius / outerR;

            const shadowActor = this.actor;
            this._shadowEnabled = !!shadow && shadow.opacity > 0;
            if (shadow) {
                this._ensureShadowPipeline();
                const blur = shadow.blur * scaleFactor;
                this._shadowHole = [b[0], b[1], b[2], b[3]];
                this._shadowHoleRadius = radius;
                this._shadowExponent = exponent;
                this._shadowOpacity = shadow.opacity / 255;
                this._shadowBlur = blur;
                this._shadowSpread = shadow.spread * scaleFactor;
                this._shadowOffset = [shadow.xOffset * scaleFactor, shadow.yOffset * scaleFactor];
            }
            shadowActor.invalidate_paint_volume?.();

            pipeline.set_uniform_float(u.fillPadding, 1, 1, [cfg.fillPadding ? 1 : 0]);
            pipeline.set_uniform_float(u.bounds, 4, 1, b);
            pipeline.set_uniform_float(u.clipRadius, 1, 1, [radius]);
            pipeline.set_uniform_float(u.borderWidth, 1, 1, [bw]);
            pipeline.set_uniform_float(u.borderColor, 4, 1, bc);
            pipeline.set_uniform_float(u.borderedAreaBounds, 4, 1, bb);
            pipeline.set_uniform_float(u.borderedAreaClipRadius, 1, 1, [borderRadius]);
            pipeline.set_uniform_float(u.exponent, 1, 1, [exponent]);
            this._updateTextureMapping(
                Math.max(1, Math.ceil(actorW * paintScale) + 1),
                Math.max(1, Math.ceil(actorH * paintScale) + 1), 0, 0,
            );
            this.queue_repaint();
        }

        _ensureBodyDetector(): void {
            if (!this._detectBody) {
                this._bodyDetector?.dispose();
                this._bodyDetector = null;
                return;
            }
            if (this._bodyDetector || this._bodyFailed) return;
            try {
                const context = this.actor.get_context().get_backend().get_cogl_context();
                this._bodyDetector = new BodyDetector(context, () => this.queue_repaint());
            } catch (error) {
                // Preserve the app if floating-point render targets are not
                // supported; guessing a rectangle would change its shape.
                console.error(`[SmoothShellCorners] Body detection unavailable: ${String(error)}`);
                this._bodyFailed = true;
            }
        }

        _bindBody(pipeline: Cogl.Pipeline, enabled = this._detectBody): void {
            const detector = this._bodyDetector;
            if (detector && enabled) {
                pipeline.set_layer_texture(1, detector.texture);
                pipeline.set_layer_filters(1, Cogl.PipelineFilter.NEAREST, Cogl.PipelineFilter.NEAREST);
            }
            pipeline.set_uniform_float(pipeline.get_uniform_location('bodyEnabled'), 1, 1,
                [enabled ? detector ? 1 : 2 : 0]);
        }

        _updateTextureMapping(width: number, height: number, originX: number, originY: number, scale = this._paintScale) {
            const {u, pipeline} = this._ensureUniforms();
            const bounds = this._windowBounds;
            const sampleBounds = [];
            // Sample clean physical texel centres; do not blend the removed
            // border back in. Oversized padding collapses to the frame centre.
            for (let axis = 0; axis < 2; axis++) {
                const extent = axis === 0 ? width : height;
                const origin = axis === 0 ? originX : originY;
                const start = ((axis === 0 ? bounds.x1 : bounds.y1) - origin) * scale;
                const end = ((axis === 0 ? bounds.x2 : bounds.y2) - origin) * scale;
                const middle = Math.min(Math.max(Math.floor((start + end) / 2) + 0.5, 0.5),
                    Math.max(0.5, extent - 0.5));
                sampleBounds[axis] = Math.min(
                    Math.ceil((this._sample[axis] - origin) * scale) + 0.5, middle) / extent;
                sampleBounds[axis + 2] = Math.max(
                    Math.floor((this._sample[axis + 2] - origin) * scale) - 0.5, middle) / extent;
            }
            pipeline.set_uniform_float(u.bodyTextureStep, 2, 1, [scale / width, scale / height]);
            pipeline.set_uniform_float(u.pixelStep, 2, 1, [scale / width, scale / height]);
            pipeline.set_uniform_float(u.textureOrigin, 2, 1, [originX, originY]);
            pipeline.set_uniform_float(u.sampleBounds, 4, 1, sampleBounds);
        }
    },
);
