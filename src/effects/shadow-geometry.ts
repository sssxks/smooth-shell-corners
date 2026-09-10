// Keep the complete corner plus the finite spread/blur support on each side.
// Only the middle strip is stretched; small windows retain their full geometry.
export function shadowGeometry(width: number, height: number, radius: number,
    exponent: number, blur: number, spread: number, scale: number) {
    const support = Math.ceil(Math.abs(spread) * scale) + Math.ceil(blur * scale) + 2;
    const margin = support / scale;
    const edge = (Math.ceil(radius * scale) + support) / scale;
    const compact = (size: number) => Math.min(size,
        2 * edge + (1 + (size * scale % 1)) / scale);
    const tileWidth = compact(width), tileHeight = compact(height);
    return {
        width: tileWidth, height: tileHeight, margin, edge,
        key: [tileWidth, tileHeight, radius, exponent, blur, spread, scale].join(','),
    };
}
