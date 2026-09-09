import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

// Run the real uniform setup without requiring a running GNOME Shell.
const source = readFileSync(new URL('../../dist/effects/rounded-corners.js', import.meta.url), 'utf8')
    .replace(/^import \{[\s\S]*?\} from '\.\/shaders\.js';$/m, '')
    .replace(/^import .*;$/gm, '').replaceAll('export const ', 'const ');
class EffectBase {
    actor = {
        get_width: () => 100, get_height: () => 80,
        invalidate_paint_volume: () => {},
        get_context: () => ({get_backend: () => ({get_cogl_context: () => null})}),
    };
    get values() { return this._pipeline.values; }
    queue_repaint() {}
}
const Cogl = {
    Pipeline: {new: () => ({
        values: {},
        get_uniform_location: name => name,
        set_uniform_float(name, _size, _count, values) { this.values[name] = values; },
        set_blend() {}, set_layer_filters() {}, add_layer_snippet() {}, add_snippet() {},
    })},
    Snippet: {new: () => ({set_replace() {}})},
    SnippetHook: {}, PipelineFilter: {},
};
const FILL_DECLARATIONS = '';
const FILL_CODE = '';
const ROUNDED_DECLARATIONS = '';
const ROUNDED_CODE = '';
const Effect = vm.runInNewContext(`${source}\nRoundedCornersEffect`, {
    GObject: {registerClass: (_meta, cls) => cls}, Shell: {GLSLEffect: EffectBase},
    Clutter: {Effect: EffectBase}, Cogl, Graphene: {},
    FILL_DECLARATIONS, FILL_CODE, ROUNDED_DECLARATIONS, ROUNDED_CODE,
});
const cfg = {
    padding: {left: 2, top: 2, right: 2, bottom: 2},
    cornerRadius: 12, smoothing: 0.6, borderWidth: 0,
    borderColor: [1, 1, 1, 1], fillPadding: true,
};
const frame = {x1: 0, y1: 0, x2: 100, y2: 80};
const plain = value => JSON.parse(JSON.stringify(value));
const near = (actual, expected) => actual.forEach((value, i) =>
    assert.ok(Math.abs(value - expected[i]) < 1e-12));

test('fill restores frame bounds and samples clean pixel centres at each scale', () => {
    for (const scale of [1, 1.25, 2]) {
        const fx = new Effect();
        fx.updateUniforms(scale, cfg, frame);
        assert.deepEqual(plain(fx.values.bounds), [0, 0, 100, 80]);
        const inset = Math.ceil(2 * scale) + 0.5;
        near(fx.values.sampleBounds,
            [inset / 101, inset / 81, (100 - inset) / 101, (80 - inset) / 81]);
    }
});

test('disabled fill preserves the baseline clip', () => {
    const fx = new Effect();
    fx.updateUniforms(1, {...cfg, fillPadding: false}, frame);
    assert.deepEqual(plain(fx.values.bounds), [2, 2, 98, 78]);
    assert.equal(fx.values.fillPadding[0], 0);
});

test('asymmetric padding and frame offsets respect the buffer', () => {
    const fx = new Effect();
    fx.updateUniforms(1, {...cfg, padding: {left: 0, top: 1, right: 3, bottom: 4}},
        {x1: 10, y1: 8, x2: 90, y2: 72});
    near(fx.values.sampleBounds, [10.5 / 101, 9.5 / 81, 86.5 / 101, 67.5 / 81]);
});

test('fractional sampling accounts for framebuffer size and physical pixel phase', () => {
    const fx = new Effect();
    fx.updateUniforms(1, cfg, frame, 1.5);
    near(fx.values.pixelStep, [1.5 / 151, 1.5 / 121]);
    near(fx.values.sampleBounds, [3.5 / 151, 3.5 / 121, 146.5 / 151, 116.5 / 121]);
    fx._updateTextureMapping(151, 121, -1 / 3, -1 / 3);
    near(fx.values.textureOrigin, [-1 / 3, -1 / 3]);
    near(fx.values.sampleBounds, [4.5 / 151, 4.5 / 121, 146.5 / 151, 116.5 / 121]);
});

test('oversized padding cannot invert the sample rectangle', () => {
    const fx = new Effect();
    fx.updateUniforms(2, {...cfg, padding: {left: 100, top: 100, right: 100, bottom: 100}}, frame);
    const [left, top, right, bottom] = fx.values.sampleBounds;
    assert.equal(left, right);
    assert.equal(top, bottom);
    assert.ok(left > 0 && right < 1 && top > 0 && bottom < 1);
});
