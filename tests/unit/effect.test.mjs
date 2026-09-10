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

for (const borderWidth of [-2, 2]) test(`border ${borderWidth} corner thickness follows the straight edge width`, () => {
    for (const smoothing of [0, 0.3, 0.6, 1]) {
        for (const scale of [1, 1.25, 1.5, 2]) {
            for (const cornerRadius of [0, 12, 24]) {
                const fx = new Effect();
                fx.updateUniforms(scale, {...cfg, smoothing, cornerRadius, borderWidth}, frame);
                const u = fx.values;
                // The diagonal intersection of the shader's superellipse is
                // (left + r - r / 2^(1/e), top + r - r / 2^(1/e)).
                const diagonal = (b, r) => Math.SQRT2 *
                    (b[0] + r * (1 - 2 ** (-1 / Math.max(2, u.exponent[0]))));
                const thickness = Math.sign(borderWidth) *
                    (diagonal(u.borderedAreaBounds, u.borderedAreaClipRadius[0]) -
                    diagonal(u.bounds, u.clipRadius[0]));
                const width = 2 * scale;
                // Square corners meet at a miter; smoothed corners use the
                // existing superellipse approximation to a parallel curve.
                const expected = cornerRadius === 0 ? width * Math.SQRT2 : width;
                assert.ok(Math.abs(thickness - expected) < expected * 0.1,
                    `smoothing=${smoothing}, scale=${scale}, radius=${cornerRadius}: ` +
                    `corner ${thickness.toFixed(3)}px vs edge ${width}px`);
            }
        }
    }
});

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

// Model deferred paint-node execution: constructing a LayerNode does not
// populate its texture. Only painting its ActorNode writes current content.
class PaintNode {
    children = [];
    add_child(child) { this.children.push(child); }
    add_rectangle() {}
    paint(context) { this.children.forEach(child => child.paint(context)); }
}
const paintClutter = {
    Effect: EffectBase,
    EffectPaintFlags: {ACTOR_DIRTY: 1, BYPASS_EFFECT: 2},
    ActorBox: class { constructor(values) { Object.assign(this, values); } },
    PipelineNode: {new: () => new PaintNode()},
    ActorNode: {new: actor => ({paint(context) {
        context.target.texture.revision = actor.revision;
        actor.paintCount++;
    }})},
    LayerNode: {new_to_framebuffer: framebuffer => {
        const node = new PaintNode();
        node.paint = context => PaintNode.prototype.paint.call(node, {...context, target: framebuffer});
        return node;
    }},
};
const paintCogl = {
    ...Cogl,
    Texture2D: {new_with_size: (_context, width, height) => ({width, height, revision: null})},
    Offscreen: {new_with_texture: texture => ({
        texture, allocate() {}, get_texture: () => texture,
        get_width: () => texture.width, get_height: () => texture.height,
        set_viewport() {}, orthographic() {}, set_modelview_matrix() {},
    })},
    Color: class { init_from_4f() {} },
};
const PaintEffect = vm.runInNewContext(`${source}\nRoundedCornersEffect`, {
    GObject: {registerClass: (_meta, cls) => cls}, Clutter: paintClutter, Cogl: paintCogl,
    Graphene: {Matrix: class { init_identity() { return this; } }},
    FILL_DECLARATIONS, FILL_CODE, ROUNDED_DECLARATIONS, ROUNDED_CODE,
});

for (const scenario of ['first paint', 'content update', 'resize', 'cached repaint', 'pixel phase', 'scale', 'GPU purge', 'disabled update']) {
    test(`shadow reads current rendered content on ${scenario}`, () => {
        const fx = new PaintEffect();
        let purge;
        const stage = {connect: (_signal, callback) => { purge = callback; return 1; }};
        Object.assign(fx.actor, {
            revision: 1, paintCount: 0, get_stage: () => stage,
            get_transformed_size: () => [fx.actor.get_width(), 80],
            get_transformed_position: () => [0, 0], is_in_clone_paint: () => false,
            get_paint_opacity: () => 255,
        });
        fx._pipeline = {set_layer_texture() {}, set_layer_null_texture() {}, set_color() {}, set_uniform_float() {}};
        fx._shadowEnabled = true;
        fx._shadowPipeline = {set_layer_texture() {}, set_layer_null_texture() {}, set_uniform_float() {}};
        fx._shadowUniforms = {};
        fx._updateTextureMapping = () => {};
        const revisions = [];
        fx._renderShadowTexture = texture => { revisions.push(texture.revision); return texture; };
        const paint = flags => {
            const root = new PaintNode();
            fx.vfunc_paint(root, {}, flags);
            root.paint({});
        };
        paint(1);
        if (scenario !== 'first paint') {
            if (scenario !== 'cached repaint') fx.actor.revision = 2;
            if (scenario === 'resize') fx.actor.get_width = () => 120;
            if (scenario === 'pixel phase') fx.actor.get_transformed_position = () => [0.5, 0];
            if (scenario === 'scale') fx._paintScale = 1.5;
            if (scenario === 'GPU purge') purge();
            if (scenario === 'disabled update') {
                fx._shadowEnabled = false;
                paint(1);
                fx._shadowEnabled = true;
            }
            paint(scenario === 'content update' ? 1 : 0);
        }
        assert.equal(revisions.at(-1), fx.actor.revision);
        assert.equal(revisions.length, scenario === 'first paint' || scenario === 'cached repaint' ? 1 : 2);
        assert.equal(fx.actor.paintCount, scenario === 'first paint' || scenario === 'cached repaint' ? 1 : 2);
    });
}


test('shadow shares fill toggle, sample bounds and fractional texture mapping with the window', () => {
    const fx = new Effect();
    fx._shadowMaskPipeline = Cogl.Pipeline.new();
    const keys = ['fillPadding', 'sampleBounds', 'pixelStep', 'textureOrigin'];
    fx._shadowMaskUniforms = Object.fromEntries(keys.map(key => [key, key]));
    for (const fillPadding of [true, false, true]) {
        fx.updateUniforms(1, {...cfg, fillPadding}, frame, 1.5);
        fx._updateTextureMapping(151, 121, -1 / 3, -1 / 3);
        for (const key of keys)
            assert.deepEqual(plain(fx._shadowMaskPipeline.values[key]), plain(fx.values[key]));
    }
});

test('shadow cache survives identical settings and opacity but invalidates filter inputs', () => {
    const fx = new Effect();
    fx._ensureShadowPipeline = () => {};
    const shadow = {opacity: 115, blur: 24, spread: 7, xOffset: 0, yOffset: 0};
    fx.updateUniforms(1, cfg, frame, 1.5, shadow);
    const cached = {};
    fx._shadowTexture = cached;
    fx.updateUniforms(1, {...cfg}, {...frame}, 1.5, {...shadow, opacity: 80});
    assert.equal(fx._shadowTexture, cached);
    for (const change of [
        {blur: 25}, {spread: 8}, {xOffset: 2}, {yOffset: 3}, {opacity: 0},
    ]) {
        fx.updateUniforms(1, cfg, frame, 1.5, shadow);
        fx._shadowTexture = cached;
        fx.updateUniforms(1, cfg, frame, 1.5, {...shadow, ...change});
        assert.equal(fx._shadowTexture, null);
    }
    for (const change of [
        {fillPadding: false}, {cornerRadius: 20}, {smoothing: 0.1},
        {padding: {...cfg.padding, left: 3}},
    ]) {
        fx.updateUniforms(1, cfg, frame, 1.5, shadow);
        fx._shadowTexture = cached;
        fx.updateUniforms(1, {...cfg, ...change}, frame, 1.5, shadow);
        assert.equal(fx._shadowTexture, null);
    }
});
