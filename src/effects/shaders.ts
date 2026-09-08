export const FILL_DECLARATIONS = /* glsl */`
uniform float fillPadding;
uniform vec4 sampleBounds;
`;

export const FILL_CODE = /* glsl */`
    vec2 uv = cogl_tex_coord.st;
    if (fillPadding > 0.5)
        uv = clamp(uv, sampleBounds.xy, sampleBounds.zw);
    cogl_texel = texture2D(cogl_sampler, uv);
`;

export const ROUNDED_DECLARATIONS = /* glsl */`
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

export const ROUNDED_CODE = /* glsl */`
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
// Uses the window's squircle formula with an inset hole, leaving shadow under
// its antialiased edge while clearing the fully covered interior.
//
// Uniforms (all in shadow-actor pixel coordinates):
//   shadowBounds  – [x1, y1, x2, y2] of the WINDOW content area
//   shadowRadius  – squircle corner radius (matches RoundedCornersEffect)
//   shadowExp     – squircle exponent (matches RoundedCornersEffect)
//   shadowStep    – logical pixels per offscreen texture dimension
//   shadowOrigin  – padded offscreen origin in shadow-actor coordinates
// ─────────────────────────────────────────────────────────────────────────────

export const SHADOW_DECLARATIONS = /* glsl */`
uniform vec4  shadowBounds;
uniform float shadowRadius;
uniform float shadowExp;
uniform vec2  shadowStep;
uniform vec2  shadowOrigin;

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

export const SHADOW_CODE = /* glsl */`
    vec2 p = cogl_tex_coord_in[0].xy / shadowStep + shadowOrigin;
    // Keep shadow beneath the window's antialiased edge. Complementary masks
    // composited separately leave a * (1-a) of the desktop showing through.
    // Inset the hole by one logical pixel, preserving the corner centres;
    // its transition is then hidden by fully opaque window content.
    vec4 hole = shadowBounds + vec4(1.0, 1.0, -1.0, -1.0);
    float opacity = shadowGetOpacity(p, hole, max(0.0, shadowRadius - 1.0), shadowExp);
    cogl_color_out *= (1.0 - opacity);
`;

// ─────────────────────────────────────────────────────────────────────────────
// RoundedCornersEffect
//
// Shell.GLSLEffect rounds the resource scale up to an integer before rendering
// offscreen. At 150%, a native 1.5x window gets resampled to 2x and back to 1.5x.
// Own the framebuffer here to keep the intermediate image at the monitor scale.
// The shadow below can still use Shell.GLSLEffect: it contains no sharp content.
