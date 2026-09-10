// Keep nearby resize steps in the same allocation. Shrink only after a
// substantial reduction, so dragging across a bucket boundary cannot churn
// native GPU resources faster than GJS collects their small JS wrappers.
export function textureExtent(required: number, current = 0): number {
    if (required <= current && required > current / 2) return current;
    return Math.ceil(required / 128) * 128;
}

