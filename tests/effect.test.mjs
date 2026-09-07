import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

// Run the real uniform setup without requiring a running GNOME Shell.
const source = readFileSync(new URL('../effect.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replaceAll('export const ', 'const ');
class GLSLEffect {
    values = {};
    actor = {get_width: () => 100, get_height: () => 80};
    get_uniform_location(name) { return name; }
    set_uniform_float(name, _size, value) { this.values[name] = value; }
    queue_repaint() {}
}
const Effect = vm.runInNewContext(`${source}\nRoundedCornersEffect`, {
    GObject: {registerClass: (_meta, cls) => cls}, Shell: {GLSLEffect},
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
            [inset / 100, inset / 80, (100 - inset) / 100, (80 - inset) / 80]);
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
    near(fx.values.sampleBounds, [0.105, 0.11875, 0.865, 0.84375]);
});

test('oversized padding cannot invert the sample rectangle', () => {
    const fx = new Effect();
    fx.updateUniforms(2, {...cfg, padding: {left: 100, top: 100, right: 100, bottom: 100}}, frame);
    const [left, top, right, bottom] = fx.values.sampleBounds;
    assert.equal(left, right);
    assert.equal(top, bottom);
    assert.ok(left > 0 && right < 1 && top > 0 && bottom < 1);
});
