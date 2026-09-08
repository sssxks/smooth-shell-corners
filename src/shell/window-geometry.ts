import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';

export interface WindowBounds {
    x1: number; y1: number; x2: number; y2: number;
}

export function targetActor(actor: Meta.WindowActor): Meta.WindowActor {
    return actor;
}

export function getWindowTexture(actor: Meta.WindowActor): Meta.ShapedTexture | null {
    return actor.get_texture();
}

export function getEffect(actor: Meta.WindowActor, effectName: string): Clutter.Effect | null {
    return actor.get_effect(effectName);
}

export function contentOffset(win: Meta.Window | null): [number, number, number, number] {
    if (!win) return [0, 0, 0, 0];
    const buffer = win.get_buffer_rect();
    const frame = win.get_frame_rect();
    return [
        frame.x - buffer.x,
        frame.y - buffer.y,
        frame.width - buffer.width,
        frame.height - buffer.height,
    ];
}

export function computeBounds(actor: Meta.WindowActor, scale: number, fillPadding = false): WindowBounds {
    const target = targetActor(actor) ?? actor;
    const targetWidth = target.width;
    const targetHeight = target.height;
    const [dx, dy, dw, dh] = contentOffset(actor.metaWindow);

    let x1 = dx;
    let y1 = dy;
    let x2 = dx + targetWidth + dw;
    let y2 = dy + targetHeight + dh;

    if (!fillPadding) {
        if (x1 === 0) x1 += scale;
        if (y1 === 0) y1 += scale;
        if (x2 === targetWidth) x2 -= scale;
        if (y2 === targetHeight) y2 -= scale;
    }

    return {x1, y1, x2, y2};
}

