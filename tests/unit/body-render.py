# /// script
# requires-python = ">=3.13,<3.14"
# dependencies = ["moderngl==5.12.0", "numpy==2.4.2"]
# ///
"""Exercise GPU-only rectangle detection with readback confined to this test."""
import runpy
import unittest
from pathlib import Path

import numpy as np
import moderngl

harness = runpy.run_path(str(Path(__file__).with_name('render.py')))
ctx, snippet = harness['ctx'], harness['snippet']
vertex = '''#version 330
out vec2 uv;
void main() { vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);
uv=p;gl_Position=vec4(p*2.0-1.0,0,1); }'''


def shader(prefix):
    return ctx.program(vertex_shader=vertex, fragment_shader='''#version 330
#define texture2D texture
in vec2 uv;
out vec4 cogl_color_out;
uniform sampler2D cogl_sampler0;
uniform sampler2D cogl_sampler1;
''' + snippet(prefix+'_DECLARATIONS') + '''
void main() { vec4 cogl_tex_coord_in[1];cogl_tex_coord_in[0]=vec4(uv,0,1);
''' + snippet(prefix+'_CODE') + '}')


probe, validate = shader('BODY_PROBE'), shader('BODY_VALIDATE')
probe_vao, validate_vao = ctx.vertex_array(probe, []), ctx.vertex_array(validate, [])
validate['cogl_sampler1'].value = 1


def alpha_fixture(kind, scale, width=512, height=468):
    x, y = np.meshgrid((np.arange(round(width*scale))+0.5)/scale,
                       (np.arange(round(height*scale))+0.5)/scale)
    if kind == 'opaque':
        return np.ones_like(x)
    if kind == 'translucent':
        return np.full_like(x, 0.5)
    if kind == 'transparent':
        return np.zeros_like(x)
    # 16px inset, small native corners, and a 6px translucent native shadow.
    dx = np.maximum(np.maximum(24-x, x-(width-24)), 0)
    dy = np.maximum(np.maximum(24-y, y-(height-24)), 0)
    distance = np.hypot(dx, dy) - 8
    alpha = np.where(distance <= 0, 1, np.clip((6-distance)/6, 0, 1)*0.4)
    if kind == 'hole':
        alpha[(abs(x-width/2)<24)&(abs(y-height/2)<24)] = 0
    if kind == 'islands':
        alpha[(x>width*0.35)&(x<width*0.65)] = 0
    if kind == 'overlay':
        alpha[:] = 0
        alpha[(x>width*0.3)&(x<width*0.7)&(y>20)&(y<70)] = 1
    return alpha


def detect(alpha, scale):
    height, width = alpha.shape
    rgba = np.zeros((height, width, 4), dtype=np.uint8)
    rgba[:, :, 3] = np.round(alpha*255).astype(np.uint8)
    source = ctx.texture((width, height), 4, rgba.tobytes())
    source.filter = (moderngl.NEAREST, moderngl.NEAREST)
    source.repeat_x = source.repeat_y = False
    rays = ctx.texture((4, 1), 4, dtype='f4')
    result = ctx.texture((1, 1), 4, dtype='f4')
    rays.filter = (moderngl.NEAREST, moderngl.NEAREST)
    targets = [ctx.framebuffer([rays]), ctx.framebuffer([result])]
    source.use(location=0)
    for program, vao, target, prefix in [
        (probe, probe_vao, targets[0], 'bodyProbe'),
        (validate, validate_vao, targets[1], 'bodyValidate')]:
        target.use()
        if program is validate:
            rays.use(location=1)
        for key, value in dict(Frame=(0, 0, width/scale, height/scale),
                Step=(scale/width, scale/height), Origin=(0, 0), Scale=scale).items():
            program[prefix+key].value = value
        vao.render(vertices=3)
    values = np.frombuffer(result.read(), dtype=np.float32).copy()
    for resource in [*targets, source, rays, result]:
        resource.release()
    return values


class BodyDetection(unittest.TestCase):
    def test_dialog_body_excludes_native_shadow_at_all_scales(self):
        for scale in [1, 1.25, 1.5, 2]:
            np.testing.assert_allclose(detect(alpha_fixture('dialog', scale), scale), [16]*4, atol=0.01)

    def test_rectangles_and_uniform_translucency_keep_full_bounds(self):
        for kind in ['opaque', 'translucent']:
            np.testing.assert_array_equal(detect(alpha_fixture(kind, 1.5), 1.5), [0]*4)

    def test_holes_islands_and_overlays_are_not_given_a_rectangle(self):
        for kind in ['hole', 'islands', 'overlay', 'transparent']:
            for scale in [1, 1.25, 1.5, 2]:
                with self.subTest(kind=kind, scale=scale):
                    self.assertLess(detect(alpha_fixture(kind, scale), scale)[0], 0)

    def test_asymmetric_margins(self):
        alpha = np.zeros((320, 480))
        alpha[12:300, 8:448] = 1
        np.testing.assert_array_equal(detect(alpha, 1), [8, 12, 32, 20])


if __name__ == '__main__':
    unittest.main()
