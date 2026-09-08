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
