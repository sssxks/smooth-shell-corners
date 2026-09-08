import Cogl from 'gi://Cogl';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

import {SHADOW_CODE, SHADOW_DECLARATIONS} from './shaders.js';

export const ClipShadowEffect = GObject.registerClass(
    { GTypeName: 'SSCClipShadowEffect' },
    class ClipShadowEffect extends Shell.GLSLEffect {

        _u: Record<'bounds' | 'radius' | 'exp' | 'step' | 'origin', number> | null = null;

        override vfunc_build_pipeline() {
            this.add_glsl_snippet(
                Cogl.SnippetHook.FRAGMENT,
                SHADOW_DECLARATIONS,
                SHADOW_CODE,
                false,
            );
            // Do NOT call get_uniform_location() or set_uniform_float() here.
        }

        _ensureUniforms() {
            if (this._u) return this._u;
            this._u = {
                bounds:  this.get_uniform_location('shadowBounds'),
                radius:  this.get_uniform_location('shadowRadius'),
                exp:     this.get_uniform_location('shadowExp'),
                step:    this.get_uniform_location('shadowStep'),
                origin:  this.get_uniform_location('shadowOrigin'),
            };
            return this._u;
        }

        override vfunc_paint_target(node: Clutter.PaintNode, context: Clutter.PaintContext) {
            const u = this._ensureUniforms();
            const texture = this.get_texture();
            const scale = this.actor.get_resource_scale();
            const volume = this.actor.get_paint_volume();
            const origin = volume?.get_origin() ?? {x: 0, y: 0};
            const width = volume?.get_width() ?? this.actor.width;
            const height = volume?.get_height() ?? this.actor.height;
            // Clutter's _clutter_actor_box_enlarge_for_effects adds three
            // logical pixels to the paint volume, with an asymmetric origin.
            // Read the actual texture at paint time: actor size alone omits
            // this padding (and any CSS shadow overflowing the allocation).
            const x = Math.trunc(Math.ceil(origin.x + width + 0.75) - Math.round(width) - 3);
            const y = Math.trunc(Math.ceil(origin.y + height + 0.75) - Math.round(height) - 3);
            this.set_uniform_float(u.step, 2,
                [scale / texture.get_width(), scale / texture.get_height()]);
            this.set_uniform_float(u.origin, 2, [x, y]);
            super.vfunc_paint_target(node, context);
        }

        /**
         * Update the squircle clip for the shadow actor.
         * @param {number[]} bounds  – [x1, y1, x2, y2] of the window content area
         *                             in shadow-actor pixel coordinates
         * @param {number}   radius  – squircle corner radius (same as RoundedCornersEffect)
         * @param {number}   exp     – squircle exponent (same as RoundedCornersEffect)
         * Texture mapping is set at paint time, after layout and offscreen
         * allocation; actor dimensions may still be zero when this is called.
         */
        setClip(bounds: [number, number, number, number], radius: number, exp: number) {
            const u = this._ensureUniforms();

            this.set_uniform_float(u.bounds,  4, bounds);
            this.set_uniform_float(u.radius,  1, [radius]);
            this.set_uniform_float(u.exp,     1, [exp]);
            this.queue_repaint();
        }
    },
);
