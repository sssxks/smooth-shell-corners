import St from 'gi://St';
import {createShadow, refreshShadowClip} from '../../dist/shell/shadows.js';
import {readCornerConfig} from '../../dist/settings/config.js';
import {computeBounds} from '../../dist/shell/window-geometry.js';
import {RoundedCornersEffect} from '../../dist/effects/rounded-corners.js';

// Synthetic opaque window on white makes missing black shadow pixels measurable.
export function shadowFixture(fill, blur, spread, xOffset, yOffset, scale) {
    global.ssc.shadowFixture?.forEach(actor => actor.destroy());
    const background = new St.Bin({x: 0, y: 0, width: 900, height: 700,
        style: 'background: white;'});
    const actor = new St.Bin({x: 201, y: 201, width: 300, height: 240,
        style: 'background: black;'});
    actor.metaWindow = {
        appears_focused: true,
        get_buffer_rect: () => ({x: 201, y: 201, width: 300, height: 240}),
        get_frame_rect: () => ({x: 201, y: 201, width: 300, height: 240}),
    };
    const values = {'corner-radius': 12, smoothing: 0.6, 'fill-padding': fill,
        'padding-top': 2, 'padding-right': 2, 'padding-bottom': 2, 'padding-left': 2,
        'focused-shadow-opacity': 255, 'focused-shadow-blur': blur,
        'focused-shadow-spread': spread, 'focused-shadow-x-offset': xOffset,
        'focused-shadow-y-offset': yOffset};
    const settings = {get_int: key => values[key] ?? 0,
        get_double: key => values[key] ?? 0, get_boolean: key => values[key] ?? false};
    global.windowGroup.add_child(background);
    global.windowGroup.add_child(actor);
    const shadow = createShadow(actor, settings, 1);
    refreshShadowClip(actor, shadow, settings, 1);
    const effect = new RoundedCornersEffect();
    actor.add_effect(effect);
    effect.updateUniforms(1, readCornerConfig(settings), computeBounds(actor, 1, fill), scale);
    global.ssc.shadowFixture = [actor, shadow, background];
    return true;
}
