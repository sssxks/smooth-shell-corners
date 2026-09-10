# /// script
# requires-python = ">=3.13,<3.14"
# dependencies = ["moderngl==5.12.0", "numpy==2.4.2"]
# ///
"""Run with uv run tests/unit/render.py; uses headless EGL on Bazzite."""
import re
import json
import math
import subprocess
import unittest
from pathlib import Path

import moderngl
import numpy as np

source = (Path(__file__).resolve().parents[2] / "dist/effects/shaders.js").read_text()


def snippet(name):
    return re.search(rf"const {name} = /\* glsl \*/\s*`(.*?)`;", source, re.S)[1]


ctx = moderngl.create_standalone_context(backend="egl")
program = ctx.program(
    vertex_shader="""#version 330
    out vec2 uv;
    void main() {
        vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
        uv = p;
        gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }""",
    fragment_shader="""#version 330
    #define texture2D texture
    in vec2 uv;
    out vec4 cogl_color_out;
    uniform sampler2D cogl_sampler;
    uniform sampler2D cogl_sampler1;
    """ + snippet("BODY_DECLARATIONS") + snippet("FILL_DECLARATIONS") + snippet("ROUNDED_DECLARATIONS") + """
    void main() {
        vec4 cogl_tex_coord = vec4(uv, 0, 1);
        vec4 cogl_tex_coord_in[1];
        cogl_tex_coord_in[0] = cogl_tex_coord;
        vec4 cogl_texel;
        {
    """ + snippet("FILL_CODE") + """
        }
        cogl_color_out = cogl_texel;
    """ + snippet("ROUNDED_CODE") + "}",
)
w, h = 32, 24
# Magenta app border around a varying, opaque interior.
pixels = bytes(c for y in range(h) for x in range(w)
               for c in ((255, 0, 255, 255) if x < 2 or x >= w-2 or y < 2 or y >= h-2
                         else (x * 5, y * 7, 30, 255)))
texture = ctx.texture((w, h), 4, pixels)
texture.filter = (moderngl.LINEAR, moderngl.LINEAR)
texture.use()
fbo = ctx.simple_framebuffer((w, h), components=4)
fbo.use()
vao = ctx.vertex_array(program, [])
for key, value in dict(bounds=(0, 0, w, h), clipRadius=0, exponent=2,
                       borderWidth=0, borderColor=(1, 1, 1, 1),
                       borderedAreaBounds=(0, 0, w, h), borderedAreaClipRadius=0,
                       pixelStep=(1/w, 1/h), textureOrigin=(0, 0), fillPadding=1,
                       sampleBounds=(2.5/w, 2.5/h, (w-2.5)/w, (h-2.5)/h),
                       windowOpacity=1).items():
    program[key].value = value

for enabled, opacity in [(1, 1), (1, 0.5), (0, 1)]:
    program['fillPadding'].value = enabled
    program['windowOpacity'].value = opacity
    vao.render(vertices=3)
    result = fbo.read(components=4)
    for y in range(h):
        for x in range(w):
            sx = min(max(x, 2), w-3) if enabled else x
            sy = min(max(y, 2), h-3) if enabled else y
            expected = pixels[(sy*w+sx)*4:(sy*w+sx)*4+4]
            actual = result[(y*w+x)*4:(y*w+x)*4+4]
            assert all(abs(a - b*opacity) <= 1 for a, b in zip(actual, expected)), (x, y, actual, expected)

program['fillPadding'].value = 1
program['clipRadius'].value = 6
vao.render(vertices=3)
result = fbo.read(components=4)
assert result[3] == 0, 'Rounded corner should stay transparent'
assert result[((h//2)*w)*4+3] == 255, 'Straight edge should reach frame'
print('Shader compiled; edge fill, unchanged interior, disabled mode, opacity and corners passed.')

# Compare every RGBA channel to the full-opacity image, for both border signs
# and for bypassed body detection. This catches opaque borders during fades.
for border in [-2, 2]:
    for body_enabled in [0, 2]:
        program['bodyEnabled'].value = body_enabled
        program['borderWidth'].value = border
        program['borderColor'].value = (1, 0.25, 0.5, 0.75)
        program['bounds'].value = (3, 3, w-3, h-3)
        program['borderedAreaBounds'].value = (3+border, 3+border, w-3-border, h-3-border)
        program['borderedAreaClipRadius'].value = 6-border
        program['windowOpacity'].value = 1
        vao.render(vertices=3)
        full = np.frombuffer(fbo.read(components=4), dtype=np.uint8).astype(float)
        for opacity in [0, 0.25, 0.5, 1]:
            program['windowOpacity'].value = opacity
            vao.render(vertices=3)
            faded = np.frombuffer(fbo.read(components=4), dtype=np.uint8).astype(float)
            assert np.abs(faded-full*opacity).max() <= 1, (border, body_enabled, opacity)
print('Inner/outer borders and rejected bodies fade with window opacity.')

# Render the same hard-mask, horizontal-blur and vertical-blur passes used by
# the effect. A wide opaque edge must produce a monotonic gradient rather than
# the handful of alpha plateaus produced by sparse 5-tap sampling.
shadow_mask_program = ctx.program(
    vertex_shader="""#version 330
    out vec2 uv;
    void main() {
        vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
        uv = p;
        gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }""",
    fragment_shader="""#version 330
    #define texture2D texture
    in vec2 uv;
    out vec4 cogl_color_out;
    uniform sampler2D cogl_sampler0;
    uniform sampler2D cogl_sampler1;
    """ + snippet("BODY_DECLARATIONS") + snippet("EFFECT_SHADOW_MASK_DECLARATIONS") + """
    void main() {
        vec4 cogl_tex_coord_in[1];
        cogl_tex_coord_in[0] = vec4(uv, 0, 1);
        cogl_color_out = vec4(1);
    """ + snippet("EFFECT_SHADOW_MASK_CODE") + """
    }""",
)
shadow_blur_program = ctx.program(
    vertex_shader="""#version 330
    out vec2 uv;
    void main() {
        vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
        uv = p;
        gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }""",
    fragment_shader="""#version 330
    #define texture2D texture
    in vec2 uv;
    out vec4 cogl_color_out;
    uniform sampler2D cogl_sampler0;
    uniform sampler2D cogl_sampler1;
    """ + snippet("EFFECT_SHADOW_BLUR_DECLARATIONS") + """
    void main() {
        vec4 cogl_tex_coord_in[1];
        cogl_tex_coord_in[0] = vec4(uv, 0, 1);
        cogl_color_out = vec4(1);
    """ + snippet("EFFECT_SHADOW_BLUR_CODE") + """
    }""",
)
shadow_composite_program = ctx.program(
    vertex_shader="""#version 330
    out vec2 uv;
    void main() {
        vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
        uv = p;
        gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }""",
    fragment_shader="""#version 330
    #define texture2D texture
    in vec2 uv;
    out vec4 cogl_color_out;
    uniform sampler2D cogl_sampler0;
    uniform sampler2D cogl_sampler1;
    """ + snippet("BODY_DECLARATIONS") + snippet("ROUNDED_DECLARATIONS") + snippet("EFFECT_SHADOW_DECLARATIONS") + """
    void main() {
        vec4 cogl_tex_coord_in[1];
        cogl_tex_coord_in[0] = vec4(uv, 0, 1);
        cogl_color_out = vec4(1);
    """ + snippet("EFFECT_SHADOW_CODE") + """
    }""",
)
shadow_mask_vao = ctx.vertex_array(shadow_mask_program, [])
shadow_blur_vao = ctx.vertex_array(shadow_blur_program, [])
shadow_composite_vao = ctx.vertex_array(shadow_composite_program, [])
shadow_spread_program = ctx.program(
    vertex_shader="""#version 330
    out vec2 uv;
    void main() {
        vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
        uv = p;
        gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }""",
    fragment_shader="""#version 330
    #define texture2D texture
    in vec2 uv;
    out vec4 cogl_color_out;
    uniform sampler2D cogl_sampler0;
    uniform sampler2D cogl_sampler1;
    """ + snippet("EFFECT_SHADOW_SPREAD_DECLARATIONS") + """
    void main() {
        vec4 cogl_tex_coord_in[1];
        cogl_tex_coord_in[0] = vec4(uv, 0, 1);
    """ + snippet("EFFECT_SHADOW_SPREAD_CODE") + """
    }""",
)
shadow_spread_vao = ctx.vertex_array(shadow_spread_program, [])
for program in [shadow_spread_program, shadow_blur_program]:
    program['effectShadowTextureScale'].value = (1, 1)
    program['effectShadowTextureBounds'].value = (0, 0, 1, 1)


def render_shadow(pixels, values, size=64, work_size=64, spread=0, blur_step=0, rect_size=64):
    """Run the production geometry mask and filters; return the uncut alpha."""
    source = ctx.texture((64, 64), 4, pixels)
    textures = [ctx.texture((work_size, work_size), 4) for _ in range(2)]
    for texture in [source, *textures]:
        texture.filter = (moderngl.LINEAR, moderngl.LINEAR)
        texture.repeat_x = texture.repeat_y = False
    targets = [ctx.framebuffer([texture]) for texture in textures]
    output = ctx.simple_framebuffer((size, size), components=4)
    targets[0].use()
    source.use(location=0)
    for key, value in values.items():
        shadow_mask_program[key].value = value
    shadow_mask_vao.render(vertices=3)
    if spread:
        for axis, step in enumerate([(1/work_size, 0), (0, 1/work_size)]):
            targets[1-axis].use()
            textures[axis].use(location=0)
            shadow_spread_program['effectShadowSpreadUvStep'].value = step
            shadow_spread_program['effectShadowSpreadPixels'].value = spread * work_size / rect_size
            shadow_spread_vao.render(vertices=3)
    if blur_step:
        for axis, step in enumerate([(1/work_size, 0), (0, 1/work_size)]):
            targets[1-axis].use()
            textures[axis].use(location=0)
            shadow_blur_program['effectShadowBlurUvStep'].value = step
            shadow_blur_program['effectShadowBlurPixels'].value = blur_step * 4 * work_size / rect_size
            shadow_blur_vao.render(vertices=3)
    output.use()
    textures[0].use(location=0)
    shadow_blur_program['effectShadowBlurUvStep'].value = (0, 0)
    shadow_blur_vao.render(vertices=3)
    result = output.read(components=4)
    for resource in [output, *targets, *textures, source]:
        resource.release()
    return np.frombuffer(result, dtype=np.uint8).reshape(size, size, 4)[:, :, 3].copy()


source_size = 64
source_pixels = bytes(
    c for y in range(source_size) for x in range(source_size)
    for c in (0, 0, 0, 255 if (x - 32) ** 2 + (y - 32) ** 2 <= 18 ** 2 else 0)
)
for scale in [1, 1.25, 1.5, 2]:
    size = round(64 * scale)
    blur = 8
    blur_step = blur / 4
    work_size = size
    for exponent in [2, 8, 12]:
        values = dict(effectShadowHole=(14, 14, 50, 50), effectShadowHoleRadius=12,
                      effectShadowExp=exponent, effectShadowOffset=(0, 0),
                      effectShadowRectOrigin=(0, 0), effectShadowRectSize=(64, 64))
        alpha = render_shadow(source_pixels, values, size, work_size, blur_step=blur_step)
        assert alpha[0, 0] == 0, (scale, exponent, 'Shadow leaked beyond the geometry')
        assert alpha[size // 2, size // 2] > 0, (scale, exponent, 'Geometry was not rendered')
        assert alpha[size // 2, size // 2 - round(22 * scale)] > 0, (
            scale, exponent, 'Blur did not extend around the opaque boundary')

        profile = alpha[size // 2, :size // 2]
        gradient = np.diff(profile.astype(np.int16))
        assert gradient.min() >= -1, (scale, exponent, 'Shadow edge is not monotonic', profile.tolist())
        assert gradient.max() <= 48, (scale, exponent, 'Shadow edge contains a visible step', profile.tolist())
        transition = profile[(profile > 0) & (profile < 255)]
        assert len(np.unique(transition)) >= 8, (
            scale, exponent, 'Shadow edge contains discrete alpha plateaus', transition.tolist())
print('Geometry blur is monotonic and free of sparse-sampling steps.')

# Independent CPU references validate the filters; geometry tests below validate
# the assembled shadow and its independence from application content.

class ShadowRegressions(unittest.TestCase):
    def test_spread_matches_full_cpu_extremum(self):
        # Exact UV fractions keep half-texel border cases independent of
        # raster interpolation roundoff; the reference includes outside-zero.
        size = 64
        pixels = np.random.default_rng(43).integers(0, 256, (size, size), dtype=np.uint8)
        pixels[10:30, 10:30] = 255
        pixels[35:55, 35:55] = 0
        capacity = size + 29
        padded = np.pad(pixels, ((0, 29), (0, 29)), constant_values=173)
        source = ctx.texture((capacity, capacity), 4, np.repeat(padded[:, :, None], 4, axis=2).tobytes())
        source.filter = (moderngl.LINEAR, moderngl.LINEAR)
        source.repeat_x = source.repeat_y = False
        target = ctx.simple_framebuffer((size, size), components=4)
        try:
            for radius in [-80, -12, -3.5, -0.5, 0.5, 3.5, 12, 80]:
                for axis, step in [(0, (0, 1/size)), (1, (1/size, 0))]:
                    with self.subTest(radius=radius, axis=axis):
                        target.use()
                        source.use(location=0)
                        shadow_spread_program['effectShadowTextureScale'].value = (size/capacity, size/capacity)
                        shadow_spread_program['effectShadowTextureBounds'].value = (
                            .5/capacity, .5/capacity, (size-.5)/capacity, (size-.5)/capacity)
                        shadow_spread_program['effectShadowSpreadUvStep'].value = step
                        shadow_spread_program['effectShadowSpreadPixels'].value = radius
                        shadow_spread_vao.render(vertices=3)
                        actual = np.frombuffer(target.read(components=4), dtype=np.uint8).reshape(size, size, 4)[:, :, 3]
                        samples = []
                        for tap in range(-int(np.ceil(abs(radius))), int(np.ceil(abs(radius)))+1):
                            pos = np.arange(size) + np.clip(tap, -abs(radius), abs(radius))
                            left = np.floor(pos).astype(int)
                            fraction = (pos-left).reshape((-1, 1) if axis == 0 else (1, -1))
                            sample = (1-fraction) * np.take(pixels, np.clip(left, 0, size-1), axis=axis)
                            sample += fraction * np.take(pixels, np.clip(left+1, 0, size-1), axis=axis)
                            outside = (pos < -0.5) | (pos > size-0.5)
                            if axis == 0:
                                sample[outside, :] = 0
                            else:
                                sample[:, outside] = 0
                            samples.append(sample)
                        expected = (np.maximum if radius > 0 else np.minimum).reduce(samples)
                        self.assertLessEqual(float(np.abs(actual.astype(float)-expected).max()), 1.0)
        finally:
            target.release()
            source.release()
            for program in [shadow_spread_program, shadow_blur_program]:
                program['effectShadowTextureScale'].value = (1, 1)
                program['effectShadowTextureBounds'].value = (0, 0, 1, 1)

    def test_paired_blur_matches_discrete_gaussian(self):
        # An independent CPU convolution checks the optimized GPU filter,
        # including fractional radii, odd/even support and clamped borders.
        size = 67
        pixels = np.random.default_rng(42).integers(0, 256, (size, size), dtype=np.uint8)
        capacity = size + 29
        padded = np.pad(pixels, ((0, 29), (0, 29)), constant_values=173)
        source = ctx.texture((capacity, capacity), 4, np.repeat(padded[:, :, None], 4, axis=2).tobytes())
        source.filter = (moderngl.LINEAR, moderngl.LINEAR)
        source.repeat_x = source.repeat_y = False
        target = ctx.simple_framebuffer((size, size), components=4)
        try:
            for radius in [0.05, 0.5, 1, 2, 3.5, 24, 25, 26, 120, 240, 480, 960]:
                for axis, step in [(0, (0, 1/size)), (1, (1/size, 0))]:
                    with self.subTest(radius=radius, axis=axis):
                        target.use()
                        source.use(location=0)
                        shadow_blur_program['effectShadowTextureScale'].value = (size/capacity, size/capacity)
                        shadow_blur_program['effectShadowTextureBounds'].value = (
                            .5/capacity, .5/capacity, (size-.5)/capacity, (size-.5)/capacity)
                        shadow_blur_program['effectShadowBlurUvStep'].value = step
                        shadow_blur_program['effectShadowBlurPixels'].value = radius
                        shadow_blur_vao.render(vertices=3)
                        actual = np.frombuffer(target.read(components=4), dtype=np.uint8).reshape(size, size, 4)[:, :, 3]
                        taps = np.arange(-int(np.ceil(radius)), int(np.ceil(radius))+1)
                        weights = np.exp(-4.5 * (taps/radius)**2)
                        expected = sum(weight * np.take(pixels, np.clip(np.arange(size)+tap, 0, size-1), axis=axis)
                                       for tap, weight in zip(taps, weights)) / weights.sum()
                        self.assertLessEqual(float(np.abs(actual.astype(float)-expected).max()), 1.0)
        finally:
            target.release()
            source.release()
            for program in [shadow_spread_program, shadow_blur_program]:
                program['effectShadowTextureScale'].value = (1, 1)
                program['effectShadowTextureBounds'].value = (0, 0, 1, 1)

    def test_increasing_blur_does_not_shrink_exterior_shadow(self):
        pixels = bytes([0, 0, 0, 255]) * 64 * 64
        values = dict(effectShadowHole=(64, 64, 320, 320), effectShadowHoleRadius=12,
                      effectShadowExp=8, effectShadowOffset=(0, 0),
                      effectShadowRectOrigin=(0, 0), effectShadowRectSize=(384, 384))
        for scale in [1, 1.25, 1.5, 2]:
            size = round(384 * scale)
            for spread in [-2, 0, 7]:
                previous = 0
                for blur in range(4, 51):
                    with self.subTest(scale=scale, spread=spread, blur=blur):
                        alpha = render_shadow(pixels, values, size=size, work_size=size,
                                              spread=spread, blur_step=blur/4, rect_size=384)
                        # Integrate the exterior straight-edge profile. Individual
                        # pixels may lighten as blur grows, but its overall reach
                        # must not jump backwards (especially around 24/25/26).
                        mass = alpha[size//2, :round(64*scale)].sum() / (255 * scale)
                        self.assertGreaterEqual(mass + 0.02, previous)  # RGBA8 rounding
                        previous = mass

    def mask(self, pixels, spread=0, scale=1):
        values = dict(effectShadowHole=(14, 14, 50, 50), effectShadowHoleRadius=0,
                      effectShadowExp=2, effectShadowOffset=(0, 0),
                      effectShadowRectOrigin=(0, 0), effectShadowRectSize=(64, 64))
        size = round(64 * scale)
        return render_shadow(pixels, values, size=size, work_size=size, spread=spread)

    def test_positive_spread_expands_geometry(self):
        for scale in [1, 1.25, 1.5, 2]:
            with self.subTest(scale=scale):
                plain = self.mask(source_pixels, scale=scale)
                spread = self.mask(source_pixels, spread=6, scale=scale)
                for y, x in [(32, 10), (10, 32), (32, 54), (54, 32)]:
                    y, x = round(y * scale), round(x * scale)
                    self.assertEqual(int(plain[y, x]), 0)
                    self.assertEqual(int(spread[y, x]), 255)
                self.assertEqual(int(spread[round(32*scale), round(5*scale)]), 0)

    def test_negative_spread_contracts_geometry(self):
        for scale in [1, 1.25, 1.5, 2]:
            with self.subTest(scale=scale):
                plain = self.mask(source_pixels, scale=scale)
                spread = self.mask(source_pixels, spread=-6, scale=scale)
                for y, x in [(32, 17), (17, 32), (32, 47), (47, 32)]:
                    y, x = round(y * scale), round(x * scale)
                    self.assertEqual(int(plain[y, x]), 255)
                    self.assertEqual(int(spread[y, x]), 0)
                self.assertEqual(int(spread[round(32*scale), round(32*scale)]), 255)

    def test_geometry_is_independent_of_application_alpha(self):
        opaque = bytes([0, 0, 0, 255]) * 64 * 64
        transparent = bytes(64 * 64 * 4)
        for pixels in [source_pixels, transparent]:
            np.testing.assert_array_equal(self.mask(opaque), self.mask(pixels))

    def test_nine_slice_matches_full_geometry(self):
        cases = [(w, h, radius, exponent, blur, spread, scale)
                 for scale in [1, 1.25, 1.5, 2]
                 for w, h in [(401, 303), (43, 31), (35, 360), (400, 40)]
                 for radius, exponent, blur, spread in [(0, 2, 0, 7), (12, 2, 8, -2.5), (15, 8, 24, 7)]]
        # Ask the production JS for its tile geometry, so this also tests the
        # support calculation and fractional right-edge phase, not a replica.
        module = (Path(__file__).resolve().parents[2] / 'dist/effects/shadow-geometry.js').as_uri()
        script = f"import {{shadowGeometry}} from '{module}'; let s=''; for await (const c of process.stdin) s+=c; console.log(JSON.stringify(JSON.parse(s).map(a=>shadowGeometry(...a))));"
        plans = json.loads(subprocess.run(['node', '--input-type=module', '-e', script],
                          input=json.dumps(cases), text=True, capture_output=True,
                          check=True, timeout=10).stdout)
        for case, plan in zip(cases, plans):
            with self.subTest(case=case):
                tiled = geometry_shadow(case, plan, (3, -2))
                full = geometry_shadow(case, plan | {'width': case[0], 'height': case[1]}, (3, -2))
                delta = np.abs(tiled.astype(np.int16) - full.astype(np.int16))
                self.assertLessEqual(int(delta.max()), 1)
                # Unshifted centre stays clear even when the shadow is offset.
                pad, scale = plan['margin'], case[-1]
                cy = round((pad + case[1] / 2 + 2) * scale)
                cx = round((pad + case[0] / 2 - 3) * scale)
                self.assertEqual(int(tiled[cy, cx]), 0)
                if case[4] > 0 or case[5] > 0:
                    self.assertGreater(int(tiled.max()), 0)


def geometry_shadow(case, plan, offset):
    width, height, radius, exponent, blur, spread, scale = case
    pad = plan['margin']
    tw, th = plan['width'], plan['height']
    iw, ih = math.ceil((tw + 2 * pad) * scale), math.ceil((th + 2 * pad) * scale)
    textures = [ctx.texture((iw, ih), 4) for _ in range(2)]
    for tex in textures:
        tex.filter = (moderngl.LINEAR, moderngl.LINEAR)
        tex.repeat_x = tex.repeat_y = False
    targets = [ctx.framebuffer([tex]) for tex in textures]
    targets[0].use()
    for key, value in dict(effectShadowHole=(0, 0, tw, th), effectShadowHoleRadius=radius,
            effectShadowExp=exponent, effectShadowOffset=(0, 0),
            effectShadowRectOrigin=(-pad, -pad), effectShadowRectSize=(iw/scale, ih/scale)).items():
        shadow_mask_program[key].value = value
    shadow_mask_vao.render(vertices=3)
    for program, vao, amount, uniform, step in [
        (shadow_spread_program, shadow_spread_vao, spread, 'effectShadowSpreadPixels', 'effectShadowSpreadUvStep'),
        (shadow_blur_program, shadow_blur_vao, blur, 'effectShadowBlurPixels', 'effectShadowBlurUvStep')]:
        program['effectShadowTextureScale'].value = (1, 1)
        program['effectShadowTextureBounds'].value = (0.5/iw, 0.5/ih, (iw-0.5)/iw, (ih-0.5)/ih)
        if not amount:
            continue
        program[uniform].value = amount * scale
        for axis, direction in enumerate([(1/iw, 0), (0, 1/ih)]):
            targets[1-axis].use()
            textures[axis].use(location=0)
            program[step].value = direction
            vao.render(vertices=3)
    ow, oh = math.ceil((width + 2 * pad) * scale), math.ceil((height + 2 * pad) * scale)
    output = ctx.simple_framebuffer((ow, oh), components=4)
    output.use()
    textures[0].use(location=0)
    for key, value in dict(effectShadowOpacity=1, bounds=(0, 0, width, height),
            clipRadius=radius, exponent=exponent, effectShadowRectOrigin=(offset[0]-pad, offset[1]-pad),
            effectShadowRectSize=(ow/scale, oh/scale), effectShadowTileSize=(tw, th),
            effectShadowTextureSize=(iw/scale, ih/scale), effectShadowOffset=offset,
            effectShadowMargin=pad, effectShadowEdge=plan['edge']).items():
        shadow_composite_program[key].value = value
    shadow_composite_vao.render(vertices=3)
    result = np.frombuffer(output.read(components=4), dtype=np.uint8).reshape(oh, ow, 4)[:, :, 3].copy()
    for resource in [output, *targets, *textures]:
        resource.release()
    for program in [shadow_spread_program, shadow_blur_program]:
        program['effectShadowTextureScale'].value = (1, 1)
        program['effectShadowTextureBounds'].value = (0, 0, 1, 1)
    return result


if __name__ == '__main__':
    unittest.main()
