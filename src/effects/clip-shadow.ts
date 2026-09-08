import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

import {SHADOW_CODE, SHADOW_DECLARATIONS} from './shaders.js';

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

