import type {CornerConfig, ShadowConfig} from '../settings/config.js';
import type {WindowBounds} from '../shell/window-geometry.js';

import Cogl from 'gi://Cogl';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';

import {
    FILL_CODE,
    FILL_DECLARATIONS,
    ROUNDED_CODE,
    ROUNDED_DECLARATIONS,
    EFFECT_SHADOW_BLUR_CODE,
    EFFECT_SHADOW_BLUR_DECLARATIONS,
    EFFECT_SHADOW_CODE,
    EFFECT_SHADOW_DECLARATIONS,
    EFFECT_SHADOW_MASK_CODE,
    EFFECT_SHADOW_MASK_DECLARATIONS,
    EFFECT_SHADOW_SPREAD_CODE,
    EFFECT_SHADOW_SPREAD_DECLARATIONS,
} from './shaders.js';

const SHADOW_PADDING = 80;

export const RoundedCornersEffect = GObject.registerClass(
    { GTypeName: 'SSCRoundedCornersEffect' },
    class RoundedCornersEffect extends Clutter.Effect {

        _u: Record<
            'fillPadding' | 'sampleBounds' | 'bounds' | 'clipRadius' | 'borderWidth' |
            'borderColor' | 'borderedAreaBounds' | 'borderedAreaClipRadius' |
            'exponent' | 'pixelStep' | 'textureOrigin', number
        > | null = null;
        _pipeline: Cogl.Pipeline | null = null;
        _framebuffer: Cogl.Offscreen | null = null;
        _paintScale = 1;
        _rasterScale = 1;
        _originX = 0;
        _originY = 0;
        _stage: Clutter.Stage | null = null;
        _purgeConnection = 0;
        _sample: [number, number, number, number] = [0, 0, 0, 0];
        _windowBounds = {x1: 0, y1: 0, x2: 0, y2: 0};
        _shadowEnabled = false;
        _shadowTexture: Cogl.Texture | null = null;
        _shadowInputs: number[] = [];
        _shadowHole: [number, number, number, number] = [0, 0, 0, 0];
        _shadowHoleRadius = 0;
        _shadowExponent = 2;
        _shadowOpacity = 0;
        _shadowBlur = 0;
        _shadowSpread = 0;
        _shadowOffset: [number, number] = [0, 0];
        _shadowMaskPipeline: Cogl.Pipeline | null = null;
        _shadowSpreadPipeline: Cogl.Pipeline | null = null;
        _shadowBlurPipeline: Cogl.Pipeline | null = null;
        _shadowPipeline: Cogl.Pipeline | null = null;
        _shadowMaskFramebuffer: Cogl.Offscreen | null = null;
        _shadowBlurFramebuffer: Cogl.Offscreen | null = null;
        _shadowMaskUniforms: Record<string, number> | null = null;
        _shadowSpreadUniforms: Record<string, number> | null = null;
        _shadowBlurUniforms: Record<string, number> | null = null;
        _shadowUniforms: Record<string, number> | null = null;

        override vfunc_set_actor(actor: Clutter.Actor | null) {
            if (this._purgeConnection) this._stage?.disconnect(this._purgeConnection);
            this._purgeConnection = 0;
            this._stage = null;
            this._shadowTexture = null;
            this._framebuffer = null;
            this._pipeline = null;
            this._u = null;
            this._shadowMaskPipeline = null;
            this._shadowSpreadPipeline = null;
            this._shadowBlurPipeline = null;
            this._shadowPipeline = null;
            this._shadowMaskFramebuffer = null;
            this._shadowBlurFramebuffer = null;
            this._shadowMaskUniforms = null;
            this._shadowSpreadUniforms = null;
            this._shadowBlurUniforms = null;
            this._shadowUniforms = null;
            super.vfunc_set_actor(actor);
        }

        override vfunc_modify_paint_volume(volume: Clutter.PaintVolume): boolean {
            // TRUE preserves the supplied bounds; FALSE makes them unknown,
            // breaking the overview clones' cached pointer hit-test regions.
            if (!this._shadowEnabled) return true;
            const pad = SHADOW_PADDING * this._paintScale;
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
                    this._shadowTexture = null;
                    this._framebuffer = null;
                    this._pipeline?.set_layer_null_texture(0);
                    this._shadowMaskFramebuffer = null;
                    this._shadowBlurFramebuffer = null;
                    this._shadowMaskPipeline?.set_layer_null_texture(0);
                    this._shadowSpreadPipeline?.set_layer_null_texture(0);
                    this._shadowBlurPipeline?.set_layer_null_texture(0);
                    this._shadowPipeline?.set_layer_null_texture(0);
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
            const width = Math.max(1, Math.ceil(actor.get_width() * scale) + 1);
            const height = Math.max(1, Math.ceil(actor.get_height() * scale) + 1);

            let dirty = !!(flags & Clutter.EffectPaintFlags.ACTOR_DIRTY);
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
            const color = new Cogl.Color();
            color.init_from_4f(opacity, opacity, opacity, opacity);
            this._pipeline.set_color(color);

            if (dirty) this._shadowTexture = null;

            // Shadow sampling is immediate, so populate the source first. A
            // layer without rectangles captures content without compositing it.
            // This also preserves shaped/multi-plane content through Clutter.
            if (dirty && this._shadowEnabled) {
                const capture = Clutter.LayerNode.new_to_framebuffer(framebuffer, this._pipeline);
                capture.add_child(Clutter.ActorNode.new(actor, 255));
                capture.paint(_context);
                dirty = false;
            }

            const sourceTexture = framebuffer.get_texture();
            if (this._shadowEnabled && sourceTexture && this._shadowPipeline && this._shadowUniforms) {
                const pad = SHADOW_PADDING;
                const u = this._shadowUniforms;
                const shadowTexture = this._shadowTexture ?? this._renderShadowTexture(sourceTexture, scale);
                this._shadowTexture = shadowTexture;
                if (shadowTexture) {
                    this._shadowPipeline.set_layer_texture(0, shadowTexture);
                    this._shadowPipeline.set_uniform_float(u.effectShadowOpacity, 1, 1,
                        [this._shadowOpacity * actor.get_paint_opacity() / 255]);
                    const shadow = Clutter.PipelineNode.new(this._shadowPipeline);
                    shadow.add_rectangle(new Clutter.ActorBox({x1: -pad, y1: -pad,
                        x2: actor.get_width() + pad, y2: actor.get_height() + pad}));
                    node.add_child(shadow);
                }
            }

            // Render content at full opacity and modulate once when compositing.
            // Reuse the texture for opacity and shader-only changes. New content,
            // a different pixel phase or a different painted scale invalidates it.
            const target = dirty
                ? Clutter.LayerNode.new_to_framebuffer(framebuffer, this._pipeline)
                : Clutter.PipelineNode.new(this._pipeline);
            target.add_rectangle(new Clutter.ActorBox({
                x1: originX, y1: originY,
                x2: originX + width / scale, y2: originY + height / scale,
            }));
            node.add_child(target);
            if (dirty) target.add_child(Clutter.ActorNode.new(actor, 255));
        }

        _ensureUniforms() {
            if (this._u && this._pipeline) return {u: this._u, pipeline: this._pipeline};
            const context = this.actor.get_context().get_backend().get_cogl_context();
            this._pipeline = Cogl.Pipeline.new(context);
            this._pipeline.set_blend('RGBA = ADD (SRC_COLOR, DST_COLOR * (1-SRC_COLOR[A]))');
            this._pipeline.set_layer_filters(0, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
            const fill = Cogl.Snippet.new(Cogl.SnippetHook.TEXTURE_LOOKUP, FILL_DECLARATIONS, null);
            fill.set_replace(FILL_CODE);
            this._pipeline.add_layer_snippet(0, fill);
            this._pipeline.add_snippet(Cogl.Snippet.new(
                Cogl.SnippetHook.FRAGMENT, ROUNDED_DECLARATIONS, ROUNDED_CODE,
            ));
            this._u = {
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
            color.init_from_4f(1, 1, 1, 1);

            const maskPipeline = Cogl.Pipeline.new(context);
            maskPipeline.set_layer_texture(0, coordinateTexture);
            maskPipeline.set_layer_filters(0, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
            maskPipeline.set_layer_wrap_mode(0, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);
            maskPipeline.set_color(color);
            maskPipeline.set_blend('RGBA = ADD (SRC_COLOR, DST_COLOR * (1-SRC_COLOR[A]))');
            maskPipeline.add_snippet(Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT,
                EFFECT_SHADOW_MASK_DECLARATIONS, EFFECT_SHADOW_MASK_CODE));

            const spreadPipeline = Cogl.Pipeline.new(context);
            spreadPipeline.set_layer_texture(0, coordinateTexture);
            spreadPipeline.set_layer_filters(0, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
            spreadPipeline.set_layer_wrap_mode(0, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);
            spreadPipeline.set_color(color);
            spreadPipeline.set_blend('RGBA = ADD (SRC_COLOR, 0)');
            spreadPipeline.add_snippet(Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT,
                EFFECT_SHADOW_SPREAD_DECLARATIONS, EFFECT_SHADOW_SPREAD_CODE));

            const blurPipeline = Cogl.Pipeline.new(context);
            blurPipeline.set_layer_texture(0, coordinateTexture);
            blurPipeline.set_layer_filters(0, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
            blurPipeline.set_layer_wrap_mode(0, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);
            blurPipeline.set_color(color);
            blurPipeline.set_blend('RGBA = ADD (SRC_COLOR, 0)');
            blurPipeline.add_snippet(Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT,
                EFFECT_SHADOW_BLUR_DECLARATIONS, EFFECT_SHADOW_BLUR_CODE));

            const pipeline = Cogl.Pipeline.new(context);
            pipeline.set_layer_texture(0, coordinateTexture);
            pipeline.set_layer_filters(0, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
            pipeline.set_layer_wrap_mode(0, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);
            color.init_from_4f(0, 0, 0, 1);
            pipeline.set_color(color);
            pipeline.set_blend('RGBA = ADD (SRC_COLOR, DST_COLOR * (1-SRC_COLOR[A]))');
            pipeline.add_snippet(Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT,
                EFFECT_SHADOW_DECLARATIONS, EFFECT_SHADOW_CODE));

            this._shadowMaskPipeline = maskPipeline;
            this._shadowSpreadPipeline = spreadPipeline;
            this._shadowBlurPipeline = blurPipeline;
            this._shadowPipeline = pipeline;
            this._shadowMaskUniforms = {
                effectShadowHole: maskPipeline.get_uniform_location('effectShadowHole'),
                effectShadowHoleRadius: maskPipeline.get_uniform_location('effectShadowHoleRadius'),
                effectShadowExp: maskPipeline.get_uniform_location('effectShadowExp'),
                fillPadding: maskPipeline.get_uniform_location('fillPadding'),
                sampleBounds: maskPipeline.get_uniform_location('sampleBounds'),
                pixelStep: maskPipeline.get_uniform_location('pixelStep'),
                textureOrigin: maskPipeline.get_uniform_location('textureOrigin'),
                effectShadowOffset: maskPipeline.get_uniform_location('effectShadowOffset'),
                effectShadowRectOrigin: maskPipeline.get_uniform_location('effectShadowRectOrigin'),
                effectShadowRectSize: maskPipeline.get_uniform_location('effectShadowRectSize'),
            };
            this._shadowSpreadUniforms = {
                step: spreadPipeline.get_uniform_location('effectShadowSpreadUvStep'),
                pixels: spreadPipeline.get_uniform_location('effectShadowSpreadPixels'),
            };
            this._shadowBlurUniforms = {
                effectShadowBlurUvStep: blurPipeline.get_uniform_location('effectShadowBlurUvStep'),
                effectShadowBlurPixels: blurPipeline.get_uniform_location('effectShadowBlurPixels'),
            };
            this._shadowUniforms = {
                effectShadowOpacity: pipeline.get_uniform_location('effectShadowOpacity'),
            };
        }

        _renderShadowTexture(sourceTexture: Cogl.Texture, scale: number): Cogl.Texture | null {
            const maskPipeline = this._shadowMaskPipeline;
            const blurPipeline = this._shadowBlurPipeline;
            const spreadPipeline = this._shadowSpreadPipeline;
            const spreadUniforms = this._shadowSpreadUniforms;
            const maskUniforms = this._shadowMaskUniforms;
            const blurUniforms = this._shadowBlurUniforms;
            if (!maskPipeline || !blurPipeline || !maskUniforms || !blurUniforms ||
                !spreadPipeline || !spreadUniforms)
                return null;

            const actorWidth = this.actor.get_width();
            const actorHeight = this.actor.get_height();
            const rectWidth = actorWidth + 2 * SHADOW_PADDING;
            const rectHeight = actorHeight + 2 * SHADOW_PADDING;
            // Keep the silhouette and spread on a stable pixel grid as blur
            // changes. Resizing a binary mask to blur / 4 made its edges jump.
            const blur = this._shadowBlur;
            const width = Math.max(1, Math.ceil(rectWidth * scale));
            const height = Math.max(1, Math.ceil(rectHeight * scale));

            if (!this._shadowMaskFramebuffer ||
                this._shadowMaskFramebuffer.get_width() !== width ||
                this._shadowMaskFramebuffer.get_height() !== height) {
                const context = this.actor.get_context().get_backend().get_cogl_context();
                try {
                    const maskTexture = Cogl.Texture2D.new_with_size(context, width, height);
                    const blurTexture = Cogl.Texture2D.new_with_size(context, width, height);
                    const maskFramebuffer = Cogl.Offscreen.new_with_texture(maskTexture);
                    const blurFramebuffer = Cogl.Offscreen.new_with_texture(blurTexture);
                    maskFramebuffer.allocate();
                    blurFramebuffer.allocate();
                    this._shadowMaskFramebuffer = maskFramebuffer;
                    this._shadowBlurFramebuffer = blurFramebuffer;
                } catch (error) {
                    console.error(`[SmoothShellCorners] Could not allocate shadow blur: ${String(error)}`);
                    this._shadowMaskFramebuffer = null;
                    this._shadowBlurFramebuffer = null;
                    return null;
                }
            }

            const maskFramebuffer = this._shadowMaskFramebuffer;
            const blurFramebuffer = this._shadowBlurFramebuffer;
            if (!maskFramebuffer || !blurFramebuffer)
                return null;

            const identity = new Graphene.Matrix().init_identity();
            for (const target of [maskFramebuffer, blurFramebuffer]) {
                target.set_viewport(0, 0, width, height);
                target.orthographic(-SHADOW_PADDING, -SHADOW_PADDING,
                    actorWidth + SHADOW_PADDING, actorHeight + SHADOW_PADDING, -1, 1);
                target.set_modelview_matrix(identity);
                target.clear4f(Cogl.BufferBit.COLOR, 0, 0, 0, 0);
            }

            maskPipeline.set_layer_texture(0, sourceTexture);
            maskPipeline.set_uniform_float(maskUniforms.effectShadowHole, 4, 1, this._shadowHole);
            maskPipeline.set_uniform_float(maskUniforms.effectShadowHoleRadius, 1, 1,
                [this._shadowHoleRadius]);
            maskPipeline.set_uniform_float(maskUniforms.effectShadowExp, 1, 1, [this._shadowExponent]);
            maskPipeline.set_uniform_float(maskUniforms.effectShadowOffset, 2, 1, this._shadowOffset);
            maskPipeline.set_uniform_float(maskUniforms.effectShadowRectOrigin, 2, 1,
                [-SHADOW_PADDING, -SHADOW_PADDING]);
            maskPipeline.set_uniform_float(maskUniforms.effectShadowRectSize, 2, 1,
                [rectWidth, rectHeight]);
            maskFramebuffer.draw_rectangle(maskPipeline, -SHADOW_PADDING, -SHADOW_PADDING,
                actorWidth + SHADOW_PADDING, actorHeight + SHADOW_PADDING);

            // Ping-pong both filters through the existing pair of targets.
            // Overwrite blending is required because each target is reused.
            // Cogl queues rectangles. Submit each consumer before overwriting
            // its input, otherwise the journals acquire circular dependencies
            // and spread can disappear. flush() does not wait for GPU completion.
            if (this._shadowSpread !== 0) {
                spreadPipeline.set_layer_texture(0, maskFramebuffer.get_texture());
                spreadPipeline.set_uniform_float(spreadUniforms.step, 2, 1, [1 / width, 0]);
                spreadPipeline.set_uniform_float(spreadUniforms.pixels, 1, 1,
                    [this._shadowSpread * width / rectWidth]);
                blurFramebuffer.draw_rectangle(spreadPipeline, -SHADOW_PADDING, -SHADOW_PADDING,
                    actorWidth + SHADOW_PADDING, actorHeight + SHADOW_PADDING);
                blurFramebuffer.flush();
                spreadPipeline.set_layer_texture(0, blurFramebuffer.get_texture());
                spreadPipeline.set_uniform_float(spreadUniforms.step, 2, 1, [0, 1 / height]);
                spreadPipeline.set_uniform_float(spreadUniforms.pixels, 1, 1,
                    [this._shadowSpread * height / rectHeight]);
                maskFramebuffer.draw_rectangle(spreadPipeline, -SHADOW_PADDING, -SHADOW_PADDING,
                    actorWidth + SHADOW_PADDING, actorHeight + SHADOW_PADDING);
                if (blur > 0) maskFramebuffer.flush();
            }
            if (blur > 0) {
                blurPipeline.set_layer_texture(0, maskFramebuffer.get_texture());
                blurPipeline.set_uniform_float(blurUniforms.effectShadowBlurUvStep, 2, 1,
                    [1 / width, 0]);
                blurPipeline.set_uniform_float(blurUniforms.effectShadowBlurPixels, 1, 1,
                    [blur * width / rectWidth]);
                blurFramebuffer.draw_rectangle(blurPipeline, -SHADOW_PADDING, -SHADOW_PADDING,
                    actorWidth + SHADOW_PADDING, actorHeight + SHADOW_PADDING);
                blurFramebuffer.flush();
                blurPipeline.set_layer_texture(0, blurFramebuffer.get_texture());
                blurPipeline.set_uniform_float(blurUniforms.effectShadowBlurUvStep, 2, 1,
                    [0, 1 / height]);
                blurPipeline.set_uniform_float(blurUniforms.effectShadowBlurPixels, 1, 1,
                    [blur * height / rectHeight]);
                maskFramebuffer.draw_rectangle(blurPipeline, -SHADOW_PADDING, -SHADOW_PADDING,
                    actorWidth + SHADOW_PADDING, actorHeight + SHADOW_PADDING);
            }
            return maskFramebuffer.get_texture();
        }

        /**
         * Push updated values to every shader uniform.
         * @param {number} scaleFactor  – monitor scale factor (HiDPI)
         * @param {object} cfg          – rounded corner config from settings
         * @param {object} windowBounds – {x1, y1, x2, y2} in logical pixels
         * @param {number} paintScale   – actual monitor density, without rounding
         */
        updateUniforms(scaleFactor: number, cfg: CornerConfig, windowBounds: WindowBounds,
            paintScale = 1, shadow?: ShadowConfig) {
            if (paintScale !== this._paintScale) this._framebuffer = null;
            this._paintScale = paintScale;
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
            // Compare filter inputs, not settings object identity: geometry
            // refreshes often repeat the same values. Opacity and border color
            // affect composition only and do not invalidate the silhouette.
            const shadowInputs = [
                Number(this._shadowEnabled), Number(cfg.fillPadding),
                ...sample, windowBounds.x1, windowBounds.y1, windowBounds.x2, windowBounds.y2,
                ...this._shadowHole, radius, exponent, this._shadowBlur,
                this._shadowSpread, ...this._shadowOffset, paintScale, actorW, actorH,
            ];
            if (shadowInputs.some((value, i) => value !== this._shadowInputs[i]))
                this._shadowTexture = null;
            this._shadowInputs = shadowInputs;
            shadowActor.invalidate_paint_volume?.();

            pipeline.set_uniform_float(u.fillPadding, 1, 1, [cfg.fillPadding ? 1 : 0]);
            if (this._shadowMaskPipeline && this._shadowMaskUniforms)
                this._shadowMaskPipeline.set_uniform_float(this._shadowMaskUniforms.fillPadding,
                    1, 1, [cfg.fillPadding ? 1 : 0]);
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
            pipeline.set_uniform_float(u.pixelStep, 2, 1, [scale / width, scale / height]);
            pipeline.set_uniform_float(u.textureOrigin, 2, 1, [originX, originY]);
            pipeline.set_uniform_float(u.sampleBounds, 4, 1, sampleBounds);
            if (this._shadowMaskPipeline && this._shadowMaskUniforms) {
                const mask = this._shadowMaskPipeline;
                const mu = this._shadowMaskUniforms;
                mask.set_uniform_float(mu.pixelStep, 2, 1, [scale / width, scale / height]);
                mask.set_uniform_float(mu.textureOrigin, 2, 1, [originX, originY]);
                mask.set_uniform_float(mu.sampleBounds, 4, 1, sampleBounds);
            }
        }
    },
);
