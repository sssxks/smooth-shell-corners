/**
 * effect.js – GLSL Clutter effects for Smooth Shell Corners
 *
 * The window effect owns a pixel-aligned framebuffer (see below). The shadow
 * still uses Shell.GLSLEffect, whose GNOME 50 (Mutter 18) lifecycle is:
 *
 *   In shell_glsl_effect_constructed(), Mutter does:
 *     1. klass->base_pipeline = cogl_pipeline_new(ctx)
 *     2. klass->build_pipeline(self)   ← vfunc_build_pipeline runs HERE
 *     3. priv->pipeline = cogl_pipeline_copy(klass->base_pipeline)
 *
 *   Therefore:
 *     - add_glsl_snippet() is ONLY valid inside vfunc_build_pipeline()
 *       (it operates on klass->base_pipeline which exists at that point).
 *     - get_uniform_location() must NOT be called in vfunc_build_pipeline()
 *       because it uses priv->pipeline which is still NULL at that point.
 *     - get_uniform_location() and set_uniform_float() are safe AFTER the
 *       constructor completes (priv->pipeline is set in step 3).
 *     - build_pipeline runs once per GType class, not per instance.
 *
 * Based on:
 *   https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/50.0/src/shell-glsl-effect.c
 *   https://github.com/flexagoon/rounded-window-corners
 */

import Cogl from 'gi://Cogl';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Shell from 'gi://Shell';

// ─────────────────────────────────────────────────────────────────────────────
// GLSL – Rounded corners shader
// ─────────────────────────────────────────────────────────────────────────────

// Remap the texture lookup before Cogl applies actor opacity. Sampling in the
// final fragment hook would bypass that modulation during window animations.
const FILL_DECLARATIONS = /* glsl */`
uniform float fillPadding;
uniform vec4 sampleBounds;
`;

const FILL_CODE = /* glsl */`
    vec2 uv = cogl_tex_coord.st;
    if (fillPadding > 0.5)
        uv = clamp(uv, sampleBounds.xy, sampleBounds.zw);
    cogl_texel = texture2D(cogl_sampler, uv);
`;

const ROUNDED_DECLARATIONS = /* glsl */`
uniform vec4  bounds;
uniform float clipRadius;
uniform float borderWidth;
uniform vec4  borderColor;
uniform vec4  borderedAreaBounds;
uniform float borderedAreaClipRadius;
uniform float exponent;
uniform vec2  pixelStep;
uniform vec2  textureOrigin;

float circleBounds(vec2 p, vec2 center, float r) {
    vec2  d     = p - center;
    float dist2 = dot(d, d);
    float outer = r + 0.5;
    if (dist2 >= outer * outer) return 0.0;
    float inner = r - 0.5;
    if (dist2 <= inner * inner) return 1.0;
    return outer - sqrt(dist2);
}

float squircleBounds(vec2 p, vec2 center, float r, float e) {
    vec2  d    = abs(p - center);
    float dist = pow(pow(d.x, e) + pow(d.y, e), 1.0 / e);
    return clamp(r - dist + 0.5, 0.0, 1.0);
}

float getOpacity(vec2 p, vec4 b, float r, float e) {
    if (p.x < b.x || p.x > b.z || p.y < b.y || p.y > b.w) return 0.0;
    float cl = b.x + r, cr = b.z - r;
    float ct = b.y + r, cb = b.w - r;
    vec2 c;
    if      (p.x < cl) c.x = cl;
    else if (p.x > cr) c.x = cr;
    else               return 1.0;
    if      (p.y < ct) c.y = ct;
    else if (p.y > cb) c.y = cb;
    else               return 1.0;
    if (e <= 2.0)
        return circleBounds(p, c, r);
    else
        return squircleBounds(p, c, r, e);
}
`;

const ROUNDED_CODE = /* glsl */`
    vec2  p = cogl_tex_coord_in[0].xy / pixelStep + textureOrigin;
    float a = getOpacity(p, bounds, clipRadius, exponent);

    if (borderWidth > 0.9 || borderWidth < -0.9) {
        float ba = getOpacity(p, borderedAreaBounds, borderedAreaClipRadius, exponent);
        if (borderWidth > 0.0) {
            cogl_color_out *= a;
            float edgeAlpha = clamp(abs(a - ba), 0.0, 1.0);
            cogl_color_out = mix(cogl_color_out,
                                 vec4(borderColor.rgb, 1.0),
                                 edgeAlpha * borderColor.a);
        } else {
            vec4 borderRect = vec4(borderColor.rgb, 1.0) * ba * borderColor.a;
            cogl_color_out  = mix(borderRect, cogl_color_out, a);
        }
    } else {
        cogl_color_out *= a;
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// GLSL – Clip shadow shader
//
// Uses the same squircle formula as RoundedCornersEffect so the shadow is
// clipped with pixel-perfect precision along the rounded corners.
//
// Uniforms (all in shadow-actor pixel coordinates):
//   shadowBounds  – [x1, y1, x2, y2] of the WINDOW content area
//   shadowRadius  – squircle corner radius (matches RoundedCornersEffect)
//   shadowExp     – squircle exponent (matches RoundedCornersEffect)
//   shadowStep    – [1/actorW, 1/actorH] for the shadow actor
// ─────────────────────────────────────────────────────────────────────────────

const SHADOW_DECLARATIONS = /* glsl */`
uniform vec4  shadowBounds;
uniform float shadowRadius;
uniform float shadowExp;
uniform vec2  shadowStep;

float shadowCircleBounds(vec2 p, vec2 center, float r) {
    vec2  d     = p - center;
    float dist2 = dot(d, d);
    float outer = r + 0.5;
    if (dist2 >= outer * outer) return 0.0;
    float inner = r - 0.5;
    if (dist2 <= inner * inner) return 1.0;
    return outer - sqrt(dist2);
}

float shadowSquircleBounds(vec2 p, vec2 center, float r, float e) {
    vec2  d    = abs(p - center);
    float dist = pow(pow(d.x, e) + pow(d.y, e), 1.0 / e);
    return clamp(r - dist + 0.5, 0.0, 1.0);
}

float shadowGetOpacity(vec2 p, vec4 b, float r, float e) {
    if (p.x < b.x || p.x > b.z || p.y < b.y || p.y > b.w) return 0.0;
    float cl = b.x + r, cr = b.z - r;
    float ct = b.y + r, cb = b.w - r;
    vec2 c;
    if      (p.x < cl) c.x = cl;
    else if (p.x > cr) c.x = cr;
    else               return 1.0;
    if      (p.y < ct) c.y = ct;
    else if (p.y > cb) c.y = cb;
    else               return 1.0;
    if (e <= 2.0)
        return shadowCircleBounds(p, c, r);
    else
        return shadowSquircleBounds(p, c, r, e);
}
`;

const SHADOW_CODE = /* glsl */`
    vec2 p = cogl_tex_coord_in[0].xy / shadowStep;
    // opacity = 1 inside the squircle, 0 outside, anti-aliased at edges
    float opacity = shadowGetOpacity(p, shadowBounds, shadowRadius, shadowExp);
    // Erase the shadow where the window content would be (inside the squircle)
    cogl_color_out *= (1.0 - opacity);
`;

// ─────────────────────────────────────────────────────────────────────────────
// RoundedCornersEffect
//
// Shell.GLSLEffect rounds the resource scale up to an integer before rendering
// offscreen. At 150%, a native 1.5x window gets resampled to 2x and back to 1.5x.
// Own the framebuffer here to keep the intermediate image at the monitor scale.
// The shadow below can still use Shell.GLSLEffect: it contains no sharp content.
// ─────────────────────────────────────────────────────────────────────────────
export const RoundedCornersEffect = GObject.registerClass(
    { GTypeName: 'SSCRoundedCornersEffect' },
    class RoundedCornersEffect extends Clutter.Effect {

        _u = null;
        _pipeline = null;
        _framebuffer = null;
        _paintScale = 1;
        _rasterScale = 1;
        _originX = 0;
        _originY = 0;
        _stage = null;
        _purgeConnection = 0;

        vfunc_set_actor(actor) {
            if (this._purgeConnection) this._stage.disconnect(this._purgeConnection);
            this._purgeConnection = 0;
            this._stage = null;
            this._framebuffer = null;
            this._pipeline = null;
            this._u = null;
            super.vfunc_set_actor(actor);
        }

        vfunc_paint(node, _context, flags) {
            const actor = this.actor;
            if (!this._pipeline || flags & Clutter.EffectPaintFlags.BYPASS_EFFECT) {
                node.add_child(Clutter.ActorNode.new(actor, -1));
                this._framebuffer = null;
                this._pipeline?.set_layer_null_texture(0);
                return;
            }

            const stage = actor.get_stage();
            if (stage !== this._stage) {
                if (this._purgeConnection) this._stage.disconnect(this._purgeConnection);
                this._stage = stage;
                this._purgeConnection = stage.connect('gl-video-memory-purged', () => {
                    this._framebuffer = null;
                    this._pipeline.set_layer_null_texture(0);
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
                const project = (x, y) => {
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
                    console.error(`[SmoothShellCorners] ${error.message}`);
                    this._framebuffer = null;
                    this._pipeline.set_layer_null_texture(0);
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

        get_uniform_location(name) {
            return this._pipeline.get_uniform_location(name);
        }

        set_uniform_float(location, size, values) {
            this._pipeline.set_uniform_float(location, size, 1, values);
        }

        _ensureUniforms() {
            if (this._u) return;
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
                fillPadding:            this.get_uniform_location('fillPadding'),
                sampleBounds:           this.get_uniform_location('sampleBounds'),
                bounds:                 this.get_uniform_location('bounds'),
                clipRadius:             this.get_uniform_location('clipRadius'),
                borderWidth:            this.get_uniform_location('borderWidth'),
                borderColor:            this.get_uniform_location('borderColor'),
                borderedAreaBounds:     this.get_uniform_location('borderedAreaBounds'),
                borderedAreaClipRadius: this.get_uniform_location('borderedAreaClipRadius'),
                exponent:               this.get_uniform_location('exponent'),
                pixelStep:              this.get_uniform_location('pixelStep'),
                textureOrigin:          this.get_uniform_location('textureOrigin'),
            };
        }

        /**
         * Push updated values to every shader uniform.
         * @param {number} scaleFactor  – monitor scale factor (HiDPI)
         * @param {object} cfg          – rounded corner config from settings
         * @param {object} windowBounds – {x1, y1, x2, y2} in logical pixels
         * @param {number} paintScale   – actual monitor density, without rounding
         */
        updateUniforms(scaleFactor, cfg, windowBounds, paintScale = 1) {
            if (paintScale !== this._paintScale) this._framebuffer = null;
            this._paintScale = paintScale;
            this._ensureUniforms();
            if (!this._u) return;

            const bw     = cfg.borderWidth * scaleFactor;
            const bc     = cfg.borderColor;
            const outerR = cfg.cornerRadius * scaleFactor;
            const { padding, smoothing } = cfg;

            const sample = [
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

            const bb = [b[0] + bw, b[1] + bw, b[2] - bw, b[3] - bw];

            let borderInnerR = outerR - Math.abs(bw);
            if (borderInnerR < 0.001) borderInnerR = 0.0;

            const actorW = this.actor.get_width();
            const actorH = this.actor.get_height();

            let exponent = smoothing * 10 + 2;
            let radius   = outerR * 0.5 * exponent;
            const maxR   = Math.min(b[2] - b[0], b[3] - b[1]) / 2;
            if (maxR > 0 && radius > maxR) {
                exponent *= maxR / radius;
                radius    = maxR;
            }
            if (outerR > 0)
                borderInnerR *= radius / outerR;

            const u = this._u;
            this.set_uniform_float(u.fillPadding,            1, [cfg.fillPadding ? 1 : 0]);
            this.set_uniform_float(u.bounds,                 4, b);
            this.set_uniform_float(u.clipRadius,             1, [radius]);
            this.set_uniform_float(u.borderWidth,            1, [bw]);
            this.set_uniform_float(u.borderColor,            4, bc);
            this.set_uniform_float(u.borderedAreaBounds,     4, bb);
            this.set_uniform_float(u.borderedAreaClipRadius, 1, [borderInnerR]);
            this.set_uniform_float(u.exponent,               1, [exponent]);
            this._updateTextureMapping(
                Math.max(1, Math.ceil(actorW * paintScale) + 1),
                Math.max(1, Math.ceil(actorH * paintScale) + 1), 0, 0,
            );
            this.queue_repaint();
        }

        _updateTextureMapping(width, height, originX, originY, scale = this._paintScale) {
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
            this.set_uniform_float(this._u.pixelStep, 2, [scale / width, scale / height]);
            this.set_uniform_float(this._u.textureOrigin, 2, [originX, originY]);
            this.set_uniform_float(this._u.sampleBounds, 4, sampleBounds);
        }
    },
);

// ─────────────────────────────────────────────────────────────────────────────
// ClipShadowEffect
//
// Clips the custom CSS shadow so it is transparent exactly where the window
// content is — following the squircle shape instead of a plain rectangle.
// ─────────────────────────────────────────────────────────────────────────────
export const ClipShadowEffect = GObject.registerClass(
    { GTypeName: 'SSCClipShadowEffect' },
    class ClipShadowEffect extends Shell.GLSLEffect {

        _u = null;

        vfunc_build_pipeline() {
            this.add_glsl_snippet(
                Cogl.SnippetHook.FRAGMENT,
                SHADOW_DECLARATIONS,
                SHADOW_CODE,
                false,
            );
            // Do NOT call get_uniform_location() or set_uniform_float() here.
        }

        _ensureUniforms() {
            if (this._u) return;
            this._u = {
                bounds:  this.get_uniform_location('shadowBounds'),
                radius:  this.get_uniform_location('shadowRadius'),
                exp:     this.get_uniform_location('shadowExp'),
                step:    this.get_uniform_location('shadowStep'),
            };
        }

        /**
         * Update the squircle clip for the shadow actor.
         * @param {number[]} bounds  – [x1, y1, x2, y2] of the window content area
         *                             in shadow-actor pixel coordinates
         * @param {number}   radius  – squircle corner radius (same as RoundedCornersEffect)
         * @param {number}   exp     – squircle exponent (same as RoundedCornersEffect)
         * @param {number}   sw      – shadow actor width  (0 = read from actor)
         * @param {number}   sh      – shadow actor height (0 = read from actor)
         *
         * sw/sh may be passed explicitly to avoid a layout-timing race:
         * BindConstraints are resolved on the next Clutter layout pass, so
         * this.actor.get_width() can return 0 on the first call (e.g. for
         * Qt/OpenGL X11 windows that defer applyEffectTo until notify::size).
         */
        setClip(bounds, radius, exp, sw = 0, sh = 0) {
            this._ensureUniforms();
            if (!this._u) return;

            const w = sw > 0 ? sw : this.actor.get_width();
            const h = sh > 0 ? sh : this.actor.get_height();
            if (w <= 0 || h <= 0) return;

            const step = [1 / w, 1 / h];

            this.set_uniform_float(this._u.bounds,  4, bounds);
            this.set_uniform_float(this._u.radius,  1, [radius]);
            this.set_uniform_float(this._u.exp,     1, [exp]);
            this.set_uniform_float(this._u.step,    2, step);
            this.queue_repaint();
        }
    },
);
