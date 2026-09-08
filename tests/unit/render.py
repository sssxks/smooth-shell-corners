# /// script
# requires-python = ">=3.13,<3.14"
# dependencies = ["moderngl==5.12.0"]
# ///
"""Run with uv run tests/unit/render.py; uses headless EGL on Bazzite."""
import re
from pathlib import Path

import moderngl

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

# Composite the real window/shadow masks over white with a solid black shadow.
# Antialiased window pixels must not expose the desktop between the two layers.
shadow_program = ctx.program(
    vertex_shader="""#version 330
    out vec2 uv;
    void main() {
        vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
        uv = p;
        gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }""",
    fragment_shader="""#version 330
    in vec2 uv;
    out vec4 cogl_color_out;
    """ + snippet("ROUNDED_DECLARATIONS") + snippet("SHADOW_DECLARATIONS") + """
    void main() {
        vec4 cogl_tex_coord_in[1];
        cogl_tex_coord_in[0] = vec4(uv, 0, 1);
        cogl_color_out = vec4(1);
    """ + snippet("SHADOW_CODE") + """
        float windowAlpha = getOpacity(uv / shadowStep + shadowOrigin,
                                       shadowBounds, shadowRadius, shadowExp);
        float coverage = windowAlpha + cogl_color_out.a * (1.0 - windowAlpha);
        // Red: combined coverage; green: window coverage; blue: shadow alone.
        cogl_color_out = vec4(coverage, windowAlpha, cogl_color_out.a, 1);
    }""",
)
shadow_vao = ctx.vertex_array(shadow_program, [])
for scale in [1, 1.25, 1.5, 2]:
    size = round(64 * scale)
    shadow_fbo = ctx.simple_framebuffer((size, size), components=4)
    shadow_fbo.use()
    for exponent in [2, 8, 12]:
        for key, value in dict(shadowBounds=(8, 8, 52, 52), shadowRadius=12,
                               shadowExp=exponent, shadowStep=(1/64, 1/64),
                               shadowOrigin=(-2, -2)).items():
            shadow_program[key].value = value
        shadow_vao.render(vertices=3)
        result = shadow_fbo.read(components=4)
        edges = [result[i:i+4] for i in range(0, len(result), 4)
                 if 0 < result[i+1] < 255]
        assert edges, (scale, exponent, 'No antialiased pixels exercised')
        assert all(pixel[0] == 255 for pixel in edges), (scale, exponent, edges)
        center = ((size//2)*size + size//2)*4
        assert result[center+2] == 0, 'Shadow must still be cleared beneath the window interior'
    shadow_fbo.release()
print('Window/shadow composition has no antialiasing seam; transparent shadow interior passed.')
