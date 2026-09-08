import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {ClipShadowEffect} from '../effects/index.js';
import type {CornerConfig, ExtensionConfig, ShadowConfig} from '../settings/config.js';
import {computeBounds, contentOffset} from './window-geometry.js';

const CLIP_SHADOW_EFFECT = 'ssc-clip-shadow';
const SHADOW_PADDING = 80;

export function boxShadowCss(config: ShadowConfig, scale: number): string {
    const alpha = (config.opacity / 255).toFixed(3);
    const blur = (config.blur * scale).toFixed(1);
    const spread = (config.spread * scale).toFixed(1);
    const x = (config.xOffset * scale).toFixed(1);
    const y = (config.yOffset * scale).toFixed(1);
    return `box-shadow: ${x}px ${y}px ${blur}px ${spread}px rgba(0,0,0,${alpha})`;
}

export function createShadow(actor: Meta.WindowActor, scale: number): St.Bin {
    const shadow = new St.Bin({
        name: 'SSC Shadow',
        style: 'background: transparent;',
    });
    const inner = new St.Bin({x_expand: true, y_expand: true});
    inner.add_style_class_name('ssc-shadow');
    shadow.set_child(inner);

    const pad = SHADOW_PADDING * scale;
    const [dx, dy, dw, dh] = contentOffset(actor.metaWindow);
    const offsets = [dx - pad, dy - pad, dw + 2 * pad, dh + 2 * pad];
    for (let coordinate = 0; coordinate < offsets.length; coordinate++) {
        shadow.add_constraint(new Clutter.BindConstraint({
            source: actor,
            coordinate,
            offset: offsets[coordinate],
        }));
    }

    shadow.add_effect_with_name(CLIP_SHADOW_EFFECT, new ClipShadowEffect());
    global.windowGroup.insert_child_below(shadow, actor);
    return shadow;
}

export function refreshShadowStyle(
    actor: Meta.WindowActor,
    shadowActor: St.Bin | null,
    config: ExtensionConfig,
    scale: number,
): void {
    if (!shadowActor)
        return;

    const themeScale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    const cssScale = scale / themeScale;
    const padding = SHADOW_PADDING * cssScale;
    const shadowConfig = actor.metaWindow?.appears_focused
        ? config.focusedShadow : config.unfocusedShadow;
    const exponent = config.smoothing * 10 + 2;
    const radius = config.cornerRadius * 0.5 * exponent * cssScale;
    const inner = shadowActor.get_first_child();
    if (!(inner instanceof St.Bin))
        return;

    const win = actor.metaWindow;
    if (!win) return;
    const maximized = win.maximizedHorizontally || win.maximizedVertically;
    const hidden = (maximized || win.fullscreen) &&
        !config.keepShadowMaximized;

    shadowActor.style = `padding: ${padding}px;`;
    inner.style = hidden
        ? 'opacity: 0;'
        : `background: transparent;
           border-radius: ${radius}px;
           ${boxShadowCss(shadowConfig, cssScale)};
           margin: ${config.fillPadding ? 0 : config.padding.top * cssScale}px
                   ${config.fillPadding ? 0 : config.padding.right * cssScale}px
                   ${config.fillPadding ? 0 : config.padding.bottom * cssScale}px
                   ${config.fillPadding ? 0 : config.padding.left * cssScale}px;`;
}

export function refreshShadowClip(
    actor: Meta.WindowActor,
    shadowActor: St.Bin | null,
    config: CornerConfig,
    scale: number,
): void {
    if (!shadowActor)
        return;
    const effect = shadowActor.get_effect(CLIP_SHADOW_EFFECT);
    if (!(effect instanceof ClipShadowEffect))
        return;

    const padding = SHADOW_PADDING * scale;
    const [dx, dy, dw, dh] = contentOffset(actor.metaWindow);
    const width = actor.width + dw + 2 * padding;
    const height = actor.height + dh + 2 * padding;
    if (width <= 0 || height <= 0)
        return;

    const outerRadius = config.cornerRadius * scale;
    let exponent = config.smoothing * 10 + 2;
    let radius = outerRadius * 0.5 * exponent;

    // Include the same buffer-edge inset as the window effect, then translate
    // from window-buffer coordinates into the padded shadow actor.
    const bounds = computeBounds(actor, scale, config.fillPadding);
    const x1 = padding + bounds.x1 - dx + (config.fillPadding ? 0 : config.padding.left * scale);
    const y1 = padding + bounds.y1 - dy + (config.fillPadding ? 0 : config.padding.top * scale);
    const x2 = padding + bounds.x2 - dx -
        (config.fillPadding ? 0 : config.padding.right * scale);
    const y2 = padding + bounds.y2 - dy -
        (config.fillPadding ? 0 : config.padding.bottom * scale);

    const maximumRadius = Math.min(x2 - x1, y2 - y1) / 2;
    if (maximumRadius > 0 && radius > maximumRadius) {
        exponent *= maximumRadius / radius;
        radius = maximumRadius;
    }

    effect.setClip([x1, y1, x2, y2], radius, exponent);
}

export function refreshShadowGeometry(actor: Meta.WindowActor, shadowActor: St.Bin | null, scale: number): void {
    if (!shadowActor)
        return;

    const padding = SHADOW_PADDING * scale;
    const [dx, dy, dw, dh] = contentOffset(actor.metaWindow);
    const offsets = [dx - padding, dy - padding, dw + 2 * padding, dh + 2 * padding];
    shadowActor.get_constraints().forEach((constraint, coordinate) => {
        if (constraint instanceof Clutter.BindConstraint)
            constraint.offset = offsets[coordinate];
    });
}
