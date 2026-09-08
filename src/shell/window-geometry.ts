export function findTextureActor(actor: any): any {
    if (!actor)
        return null;
    if (actor.get_texture?.())
        return actor;

    let child = actor.get_first_child?.() ?? null;
    while (child) {
        const textured = findTextureActor(child);
        if (textured)
            return textured;
        child = child.get_next_sibling?.() ?? null;
    }
    return null;
}

export function targetActor(actor: any): any {
    return findTextureActor(actor) ?? actor;
}

export function getWindowTexture(actor: any): any {
    const target = targetActor(actor);
    return target?.get_texture?.() ?? actor?.get_texture?.() ?? null;
}

export function getEffect(actor: any, effectName: string): any {
    const target = targetActor(actor);
    return target ? target.get_effect(effectName) : null;
}

export function contentOffset(win: any): [number, number, number, number] {
    const buffer = win.get_buffer_rect();
    const frame = win.get_frame_rect();
    return [
        frame.x - buffer.x,
        frame.y - buffer.y,
        frame.width - buffer.width,
        frame.height - buffer.height,
    ];
}

export function computeBounds(actor: any, scale: number, fillPadding = false) {
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

