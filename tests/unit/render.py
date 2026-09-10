# /// script
# requires-python = ">=3.13,<3.14"
# dependencies = ["moderngl==5.12.0", "numpy==2.4.2"]
# ///
"""Run with uv run tests/unit/render.py; uses headless EGL on Bazzite."""
import re
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
    uniform float actorOpacity;
    """ + snippet("FILL_DECLARATIONS") + snippet("ROUNDED_DECLARATIONS") + """
    void main() {
        vec4 cogl_tex_coord = vec4(uv, 0, 1);
        vec4 cogl_tex_coord_in[1];
        cogl_tex_coord_in[0] = cogl_tex_coord;
        vec4 cogl_texel;
        {
    """ + snippet("FILL_CODE") + """
        }
        cogl_color_out = cogl_texel * actorOpacity;
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
                       actorOpacity=1).items():
    program[key].value = value

for enabled, opacity in [(1, 1), (1, 0.5), (0, 1)]:
    program['fillPadding'].value = enabled
    program['actorOpacity'].value = opacity
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
    """ + snippet("EFFECT_SHADOW_MASK_DECLARATIONS") + """
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
    """ + snippet("EFFECT_SHADOW_DECLARATIONS") + """
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
    """ + snippet("EFFECT_SHADOW_SPREAD_DECLARATIONS") + """
    void main() {
        vec4 cogl_tex_coord_in[1];
        cogl_tex_coord_in[0] = vec4(uv, 0, 1);
    """ + snippet("EFFECT_SHADOW_SPREAD_CODE") + """
    }""",
)
shadow_spread_vao = ctx.vertex_array(shadow_spread_program, [])


def render_shadow(pixels, values, size=64, work_size=64, spread=0, blur_step=0):
    """Run the production mask, two spread, two blur and composite passes."""
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
            shadow_spread_program['effectShadowSpreadPixels'].value = spread * work_size / 64
            shadow_spread_vao.render(vertices=3)
    if blur_step:
        for axis, step in enumerate([(blur_step/64, 0), (0, blur_step/64)]):
            targets[1-axis].use()
            textures[axis].use(location=0)
            shadow_blur_program['effectShadowBlurUvStep'].value = step
            shadow_blur_vao.render(vertices=3)
    output.use()
    textures[0].use(location=0)
    shadow_composite_program['effectShadowOpacity'].value = 1
    shadow_composite_vao.render(vertices=3)
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
    downsample = max(1, blur_step * scale)
    work_size = round(64 * scale / downsample)
    for exponent in [2, 8, 12]:
        values = dict(effectShadowHole=(0, 0, 64, 64), effectShadowHoleRadius=12,
                      effectShadowExp=exponent, effectShadowOffset=(0, 0),
                      effectShadowRectOrigin=(0, 0), effectShadowRectSize=(64, 64),
                      fillPadding=0, sampleBounds=(0, 0, 1, 1),
                      pixelStep=(1/64, 1/64), textureOrigin=(0, 0))
        alpha = render_shadow(source_pixels, values, size, work_size, blur_step=blur_step)
        assert alpha[0, 0] == 0, (scale, exponent, 'Shadow leaked beyond the silhouette')
        assert alpha[size // 2, size // 2] > 0, (scale, exponent, 'Silhouette was not sampled')
        assert alpha[size // 2, size // 2 - round(22 * scale)] > 0, (
            scale, exponent, 'Blur did not extend around the opaque boundary')

        profile = alpha[size // 2, :size // 2]
        gradient = np.diff(profile.astype(np.int16))
        assert gradient.min() >= -1, (scale, exponent, 'Shadow edge is not monotonic', profile.tolist())
        assert gradient.max() <= 48, (scale, exponent, 'Shadow edge contains a visible step', profile.tolist())
        transition = profile[(profile > 0) & (profile < 255)]
        assert len(np.unique(transition)) >= 8, (
            scale, exponent, 'Shadow edge contains discrete alpha plateaus', transition.tolist())
print('Opaque silhouette blur is monotonic and free of sparse-sampling steps.')

# Regression tests intentionally exercise alpha boundaries inside the actor,
# rather than only an opaque rectangle that hides incorrect spread/fill.

class ShadowRegressions(unittest.TestCase):
    def mask(self, pixels, spread=0, fill=False, scale=1):
        values = dict(effectShadowHole=(0, 0, 64, 64), effectShadowHoleRadius=0,
                      effectShadowExp=2, effectShadowOffset=(0, 0),
                      effectShadowRectOrigin=(0, 0), effectShadowRectSize=(64, 64),
                      fillPadding=int(fill),
                      sampleBounds=(8.5/64, 8.5/64, 55.5/64, 55.5/64),
                      pixelStep=(1/64, 1/64), textureOrigin=(0, 0))
        size = round(64 * scale)
        return render_shadow(pixels, values, size=size, work_size=size, spread=spread)

    def test_positive_spread_expands_internal_alpha_edge(self):
        for scale in [1, 1.25, 1.5, 2]:
            with self.subTest(scale=scale):
                plain = self.mask(source_pixels, scale=scale)
                spread = self.mask(source_pixels, spread=6, scale=scale)
                for y, x in [(32, 10), (10, 32), (32, 54), (54, 32)]:
                    y, x = round(y * scale), round(x * scale)
                    self.assertEqual(int(plain[y, x]), 0)
                    self.assertEqual(int(spread[y, x]), 255)
                self.assertEqual(int(spread[round(32*scale), round(5*scale)]), 0)

    def test_negative_spread_contracts_internal_alpha_edge(self):
        for scale in [1, 1.25, 1.5, 2]:
            with self.subTest(scale=scale):
                plain = self.mask(source_pixels, scale=scale)
                spread = self.mask(source_pixels, spread=-6, scale=scale)
                for y, x in [(32, 17), (17, 32), (32, 47), (47, 32)]:
                    y, x = round(y * scale), round(x * scale)
                    self.assertEqual(int(plain[y, x]), 255)
                    self.assertEqual(int(spread[y, x]), 0)
                self.assertEqual(int(spread[round(32*scale), round(32*scale)]), 255)

    def test_fill_restores_transparent_margins_in_shadow(self):
        pixels = bytes(c for y in range(64) for x in range(64)
                       for c in (0, 0, 0, 255 if 8 <= x < 56 and 8 <= y < 56 else 0))
        plain = self.mask(pixels)
        filled = self.mask(pixels, fill=True)
        for y, x in [(32, 1), (32, 62), (1, 32), (62, 32)]:
            self.assertEqual(int(plain[y, x]), 0)
            self.assertEqual(int(filled[y, x]), 255)


if __name__ == '__main__':
    unittest.main()
