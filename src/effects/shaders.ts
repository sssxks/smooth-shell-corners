export const FILL_DECLARATIONS = /* glsl */`
uniform float fillPadding;
uniform vec4 sampleBounds;
uniform vec2 bodyTextureStep;
`;

export const FILL_CODE = /* glsl */`
    vec2 uv = cogl_tex_coord.st;
    vec4 insets = readBodyInsets();
    if (fillPadding > 0.5 && insets.x >= 0.0) {
        vec4 samples = sampleBounds + vec4(insets.xy, -insets.zw) * bodyTextureStep.xyxy;
        vec2 middle = (samples.xy + samples.zw) * 0.5;
        uv = clamp(uv, min(samples.xy, middle), max(samples.zw, middle));
    }
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
    vec4 insets = readBodyInsets();
    if (insets.x >= 0.0) {
    vec4 body = insetBody(bounds, insets);
    float radius = clipRadius, power = exponent;
    fitBodyRadius(body, radius, power);
    vec2  p = cogl_tex_coord_in[0].xy / pixelStep + textureOrigin;
    float a = getOpacity(p, body, radius, power);

    if (borderWidth > 0.9 || borderWidth < -0.9) {
        float ba = getOpacity(p, insetBody(borderedAreaBounds, insets),
            clipRadius > 0.0 ? borderedAreaClipRadius * radius / clipRadius : 0.0, power);
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
    }
`;

// Rasterize only the configured geometry. Application pixels never enter the shadow.
export const EFFECT_SHADOW_MASK_DECLARATIONS = /* glsl */`
uniform vec4  effectShadowHole;
uniform float effectShadowHoleRadius;
uniform float effectShadowExp;
uniform vec2  effectShadowOffset;
uniform vec2  effectShadowRectOrigin;
uniform vec2  effectShadowRectSize;

float effectCircle(vec2 p, vec2 center, float r) {
    vec2 d = p - center;
    float dist2 = dot(d, d);
    float outer = r + 0.5;
    if (dist2 >= outer * outer) return 0.0;
    float inner = r - 0.5;
    if (dist2 <= inner * inner) return 1.0;
    return outer - sqrt(dist2);
}

float effectSquircle(vec2 p, vec2 center, float r, float e) {
    vec2 d = abs(p - center);
    float dist = pow(pow(d.x, e) + pow(d.y, e), 1.0 / e);
    return clamp(r - dist + 0.5, 0.0, 1.0);
}

float effectOpacity(vec2 p, vec4 b, float r, float e) {
    if (p.x < b.x || p.x > b.z || p.y < b.y || p.y > b.w) return 0.0;
    float cl = b.x + r, cr = b.z - r, ct = b.y + r, cb = b.w - r;
    vec2 c;
    if (p.x < cl) c.x = cl;
    else if (p.x > cr) c.x = cr;
    else return 1.0;
    if (p.y < ct) c.y = ct;
    else if (p.y > cb) c.y = cb;
    else return 1.0;
    return e <= 2.0 ? effectCircle(p, c, r) : effectSquircle(p, c, r, e);
}

float effectGeometryMask(vec2 p) {
    vec4 insets = readBodyInsets();
    if (insets.x < 0.0) return 0.0;
    vec4 body = insetBody(effectShadowHole, insets);
    float radius = effectShadowHoleRadius, power = effectShadowExp;
    fitBodyRadius(body, radius, power);
    return effectOpacity(p - effectShadowOffset, body,
                         radius, power) > 0.001 ? 1.0 : 0.0;
}
`;

export const EFFECT_SHADOW_MASK_CODE = /* glsl */`
    vec2 p = cogl_tex_coord_in[0].xy * effectShadowRectSize + effectShadowRectOrigin;
    float alpha = effectGeometryMask(p);
    cogl_color_out = vec4(alpha);
`;

// Separable max/min filters dilate/erode the geometry before blur.
// A rectangular kernel keeps work linear in spread instead of quadratic.
export const EFFECT_SHADOW_SPREAD_DECLARATIONS = /* glsl */`
uniform vec2 effectShadowSpreadUvStep;
uniform float effectShadowSpreadPixels;
uniform vec2 effectShadowTextureScale;
uniform vec4 effectShadowTextureBounds;

float effectShadowSample(vec2 uv) {
    return texture2D(cogl_sampler0, clamp(uv * effectShadowTextureScale,
        effectShadowTextureBounds.xy, effectShadowTextureBounds.zw)).a;
}
`;

export const EFFECT_SHADOW_SPREAD_CODE = /* glsl */`
    float radius = abs(effectShadowSpreadPixels);
    float alpha = effectShadowSpreadPixels > 0.0 ? 0.0 : 1.0;
    int taps = int(ceil(radius));
    for (int tap = -taps; tap <= taps; tap++) {
        vec2 uv = cogl_tex_coord_in[0].xy + effectShadowSpreadUvStep *
            clamp(float(tap), -radius, radius);
        float sampleAlpha = 0.0;
        if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0)
            sampleAlpha = effectShadowSample(uv);
        alpha = effectShadowSpreadPixels > 0.0
            ? max(alpha, sampleAlpha) : min(alpha, sampleAlpha);
        // Alpha is bounded by [0, 1]. Once the extremum is reached,
        // remaining samples cannot change it, even for shaped windows.
        if (alpha == (effectShadowSpreadPixels > 0.0 ? 1.0 : 0.0))
            break;
    }
    cogl_color_out = vec4(alpha);
`;

// Horizontal and vertical blur use the same normalized Gaussian weights.
export const EFFECT_SHADOW_BLUR_DECLARATIONS = /* glsl */`
uniform vec2 effectShadowBlurUvStep;
uniform float effectShadowBlurPixels;
uniform vec2 effectShadowTextureScale;
uniform vec4 effectShadowTextureBounds;

float effectShadowSample(vec2 uv) {
    return texture2D(cogl_sampler0, clamp(uv * effectShadowTextureScale,
        effectShadowTextureBounds.xy, effectShadowTextureBounds.zw)).a;
}

float effectGaussianWeight(int tap) {
    float x = float(tap) * 4.0 / effectShadowBlurPixels;
    return exp(-0.28125 * x * x);
}
`;

export const EFFECT_SHADOW_BLUR_CODE = /* glsl */`
    if (effectShadowBlurUvStep == vec2(0.0)) {
        cogl_color_out = vec4(effectShadowSample(cogl_tex_coord_in[0].xy));
    } else {
        float alpha = effectShadowSample(cogl_tex_coord_in[0].xy);
        float total = 1.0;
        int radius = int(ceil(effectShadowBlurPixels));
        // Linear filtering combines two adjacent weighted texels in one
        // lookup. Mirror each pair to preserve the exact Gaussian kernel.
        for (int tap = 1; tap <= radius; tap += 2) {
            float first = effectGaussianWeight(tap);
            float second = tap < radius ? effectGaussianWeight(tap + 1) : 0.0;
            float weight = first + second;
            if (weight == 0.0) break;
            vec2 offset = (float(tap) + second / weight) * effectShadowBlurUvStep;
            alpha += (effectShadowSample(cogl_tex_coord_in[0].xy - offset) +
                      effectShadowSample(cogl_tex_coord_in[0].xy + offset)) * weight;
            total += 2.0 * weight;
        }
        alpha /= total;
        cogl_color_out = vec4(alpha, alpha, alpha, alpha);
    }
`;

// Paint the blurred texture in the same local coordinate space as the window.
// Since this pass belongs to the window effect, overview clones transform it too.
export const EFFECT_SHADOW_DECLARATIONS = /* glsl */`
uniform float effectShadowOpacity;
uniform vec2 effectShadowRectOrigin;
uniform vec2 effectShadowRectSize;
uniform vec2 effectShadowTileSize;
uniform vec2 effectShadowTextureSize;
uniform vec2 effectShadowOffset;
uniform float effectShadowMargin;
uniform float effectShadowEdge;
uniform float effectShadowDirect;
`;

export const EFFECT_SHADOW_CODE = /* glsl */`
    vec4 insets = readBodyInsets();
    if (insets.x < 0.0) {
        cogl_color_out = vec4(0.0);
    } else {
        vec4 body = insetBody(bounds, insets);
        float radius = clipRadius, power = exponent;
        fitBodyRadius(body, radius, power);
        vec2 p = effectShadowRectOrigin + cogl_tex_coord_in[0].xy * effectShadowRectSize;
        vec2 local = p - body.xy - effectShadowOffset;
        vec2 stretch = max(body.zw - body.xy - effectShadowTileSize, vec2(0.0));
        vec2 tile = local - clamp(local - vec2(effectShadowEdge), vec2(0.0), stretch);
        if (effectShadowDirect > 0.5) tile = p - bounds.xy - effectShadowOffset;
        vec2 uv = (tile + vec2(effectShadowMargin)) / effectShadowTextureSize;
        float outer = texture2D(cogl_sampler0, uv).a;
        // Keep shadow under the antialiased edge, but clear the unshifted body.
        vec4 hole = body + vec4(1.0, 1.0, -1.0, -1.0);
        float interior = getOpacity(p, hole, max(radius - 1.0, 0.0), power);
        cogl_color_out = vec4(0.0, 0.0, 0.0,
                              outer * (1.0 - interior) * effectShadowOpacity);
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

// The 1x1 floating-point texture stores left/top/right/bottom insets in actor
// coordinates. A negative left inset means preserve the original appearance.
export const BODY_DECLARATIONS = /* glsl */`
uniform float bodyEnabled;
vec4 readBodyInsets() {
    if (bodyEnabled < 0.5) return vec4(0.0);
    if (bodyEnabled > 1.5) return vec4(-1.0);
    return texture2D(cogl_sampler1, vec2(0.5));
}
vec4 insetBody(vec4 rectangle, vec4 insets) {
    return rectangle + vec4(insets.xy, -insets.zw);
}
void fitBodyRadius(vec4 rectangle, inout float radius, inout float power) {
    float limit = max(0.0, min(rectangle.z - rectangle.x, rectangle.w - rectangle.y) * 0.5);
    if (radius > limit && radius > 0.0) {
        power *= limit / radius;
        radius = limit;
    }
}
`;

// Four fragments scan three parallel rays each. The bounded search looks for
// opaque straight sides, not an arbitrary alpha silhouette. Uniformly
// translucent edges may retain a zero inset, but cannot define a new inset.
export const BODY_PROBE_DECLARATIONS = /* glsl */`
uniform vec4 bodyProbeFrame;
uniform vec2 bodyProbeStep;
uniform vec2 bodyProbeOrigin;
uniform float bodyProbeScale;
float probeAlpha(vec2 p) {
    return texture2D(cogl_sampler0, (p - bodyProbeOrigin) * bodyProbeStep).a;
}
`;
export const BODY_PROBE_CODE = /* glsl */`
    int side = int(floor(cogl_tex_coord_in[0].x * 4.0));
    bool horizontal = side == 0 || side == 2;
    bool reverse = side >= 2;
    vec2 size = bodyProbeFrame.zw - bodyProbeFrame.xy;
    float extent = horizontal ? size.x : size.y;
    float limit = min(64.0, max(0.0, extent * 0.25 - 1.0 / bodyProbeScale));
    vec3 edges = vec3(-1.0);
    vec3 firstAlpha = vec3(0.0);
    for (int pixel = 0; pixel <= int(ceil(limit * bodyProbeScale)); pixel++) {
        float distance = (float(pixel) + 0.5) / bodyProbeScale;
        for (int ray = 0; ray < 3; ray++) {
            if (edges[ray] >= 0.0) continue;
            float across = float(ray + 1) * 0.25;
            vec2 p = bodyProbeFrame.xy + size * (horizontal ? vec2(0.0, across) : vec2(across, 0.0));
            float along = reverse ? extent - distance : distance;
            if (horizontal) p.x += along; else p.y += along;
            float alpha = probeAlpha(p);
            if (pixel == 0) firstAlpha[ray] = alpha;
            if (alpha >= 0.98) edges[ray] = float(pixel) / bodyProbeScale;
        }
        if (min(edges.x, min(edges.y, edges.z)) >= 0.0) break;
    }
    float lo = min(edges.x, min(edges.y, edges.z));
    float hi = max(edges.x, max(edges.y, edges.z));
    float valid = lo >= 0.0 && hi - lo <= 1.01 / bodyProbeScale ? 1.0 : 0.0;
    float translucent = min(firstAlpha.x, min(firstAlpha.y, firstAlpha.z));
    if (valid < 0.5 && translucent >= 0.05 &&
        max(firstAlpha.x, max(firstAlpha.y, firstAlpha.z)) - translucent < 0.02) {
        lo = 0.0;
        valid = 1.0;
    }
    cogl_color_out = vec4(max(lo, 0.0), valid, 0.0, 1.0);
`;

// Validate a grid inside the candidate body and samples beside its straight
// edges. This is a conservative heuristic, not a proof that every pixel is
// rectangular. In particular, disconnected content must not acquire a box.
export const BODY_VALIDATE_DECLARATIONS = /* glsl */`
uniform vec4 bodyValidateFrame;
uniform vec2 bodyValidateStep;
uniform vec2 bodyValidateOrigin;
uniform float bodyValidateScale;
float bodyAlpha(vec2 p) {
    return texture2D(cogl_sampler0, (p - bodyValidateOrigin) * bodyValidateStep).a;
}
`;
export const BODY_VALIDATE_CODE = /* glsl */`
    vec4 insets;
    bool valid = true;
    for (int side = 0; side < 4; side++) {
        vec4 result = texture2D(cogl_sampler1, vec2((float(side) + 0.5) / 4.0, 0.5));
        insets[side] = result.x;
        valid = valid && result.y > 0.5;
    }
    vec4 b = bodyValidateFrame + vec4(insets.xy, -insets.zw);
    vec2 size = b.zw - b.xy;
    valid = valid && min(size.x, size.y) >= 8.0;
    // Ignore the corner squares while checking interior coverage. A regular
    // translucent background is allowed; transparent holes are not.
    for (int y = 0; y < 9; y++) {
        for (int x = 0; x < 9; x++) {
            if ((x < 2 || x > 6) && (y < 2 || y > 6)) continue;
            vec2 p = b.xy + size * (vec2(float(x), float(y)) + 0.5) / 9.0;
            valid = valid && bodyAlpha(p) >= 0.05;
        }
    }
    // Once a side has been inferred, content beyond it must be decoration,
    // not another opaque island. Probe the excluded strip at several points.
    for (int side = 0; side < 4; side++) {
        if (insets[side] <= 1.0 / bodyValidateScale) continue;
        for (int ray = 1; ray < 8; ray++) {
            float t = float(ray) / 8.0;
            vec2 p;
            if (side == 0) p = vec2(bodyValidateFrame.x + insets.x * 0.5, mix(b.y, b.w, t));
            else if (side == 1) p = vec2(mix(b.x, b.z, t), bodyValidateFrame.y + insets.y * 0.5);
            else if (side == 2) p = vec2(bodyValidateFrame.z - insets.z * 0.5, mix(b.y, b.w, t));
            else p = vec2(mix(b.x, b.z, t), bodyValidateFrame.w - insets.w * 0.5);
            valid = valid && bodyAlpha(p) < 0.98;
        }
    }
    cogl_color_out = valid ? insets : vec4(-1.0, -1.0, -1.0, 1.0);
`;
