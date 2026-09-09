# /// script
# requires-python = ">=3.13,<3.14"
# dependencies = ["moderngl==5.12.0", "numpy==2.4.2"]
# ///
"""Run with uv run tests/unit/render.py; uses headless EGL on Bazzite."""
import re
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
source_size = 64
source_pixels = bytes(
    c for y in range(source_size) for x in range(source_size)
    for c in (0, 0, 0, 255 if (x - 32) ** 2 + (y - 32) ** 2 <= 18 ** 2 else 0)
)
source_texture = ctx.texture((source_size, source_size), 4, source_pixels)
source_texture.filter = (moderngl.LINEAR, moderngl.LINEAR)
source_texture.use(location=0)
shadow_mask_program['cogl_sampler0'].value = 0
shadow_composite_program['cogl_sampler0'].value = 0
shadow_composite_program['effectShadowOpacity'].value = 1
for scale in [1, 1.25, 1.5, 2]:
    size = round(64 * scale)
    blur = 8
    blur_step = blur / 4
    downsample = max(1, blur_step * scale)
    work_size = round(64 * scale / downsample)
    horizontal_texture = ctx.texture((work_size, work_size), 4)
    horizontal_texture.filter = (moderngl.LINEAR, moderngl.LINEAR)
    horizontal_fbo = ctx.framebuffer([horizontal_texture])
    vertical_texture = ctx.texture((work_size, work_size), 4)
    vertical_texture.filter = (moderngl.LINEAR, moderngl.LINEAR)
    vertical_fbo = ctx.framebuffer([vertical_texture])
    shadow_fbo = ctx.simple_framebuffer((size, size), components=4)
    for exponent in [2, 8, 12]:
        horizontal_fbo.use()
        source_texture.use(location=0)
        for key, value in dict(effectShadowHole=(0, 0, 64, 64),
                               effectShadowHoleRadius=12, effectShadowExp=exponent,
                               effectShadowSpread=0, effectShadowOffset=(0, 0),
                               effectShadowSourceSize=(64, 64),
                               effectShadowBlurStep=blur_step,
                               effectShadowRectOrigin=(0, 0),
                               effectShadowRectSize=(64, 64)).items():
            shadow_mask_program[key].value = value
        shadow_mask_vao.render(vertices=3)

        vertical_fbo.use()
        horizontal_texture.use(location=0)
        shadow_blur_program['cogl_sampler0'].value = 0
        shadow_blur_program['effectShadowBlurUvStep'].value = (0, blur_step / 64)
        shadow_blur_vao.render(vertices=3)

        shadow_fbo.use()
        vertical_texture.use(location=0)
        shadow_composite_vao.render(vertices=3)
        result = shadow_fbo.read(components=4)
        alpha = np.frombuffer(result, dtype=np.uint8).reshape(size, size, 4)[:, :, 3]
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
    horizontal_fbo.release()
    horizontal_texture.release()
    vertical_fbo.release()
    vertical_texture.release()
    shadow_fbo.release()
print('Opaque silhouette blur is monotonic and free of sparse-sampling steps.')
