import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {shadowGeometry} from '../../dist/effects/shadow-geometry.js';

// Run the real uniform setup without requiring a running GNOME Shell.
const source = ['texture-extent', 'shadow-baker', 'rounded-corners'].map(name =>
    readFileSync(new URL(`../../dist/effects/${name}.js`, import.meta.url), 'utf8')
        .replace(/^import \{[\s\S]*?\} from '\.\/shaders\.js';$/m, '')
        .replace(/^import .*;$/gm, '').replaceAll('export const ', 'const ')
        .replaceAll('export function ', 'function ').replaceAll('export let ', 'let ')
).join('\n');
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
    Texture2D: {new_with_size: () => ({allocate() {}})},
    Pipeline: {new: () => ({
        values: {},
        get_uniform_location: name => name,
        set_uniform_float(name, _size, _count, values) { this.values[name] = values; },
        set_layer_texture() {}, set_layer_combine() {},
        set_blend() {}, set_layer_filters() {}, add_layer_snippet() {}, add_snippet() {},
    })},
    Snippet: {new: () => ({set_replace() {}})},
    SnippetHook: {}, PipelineFilter: {},
};
const BODY_DECLARATIONS = '';
const FILL_DECLARATIONS = '';
const FILL_CODE = '';
const ROUNDED_DECLARATIONS = '';
const ROUNDED_CODE = '';
const Effect = vm.runInNewContext(`${source}\nRoundedCornersEffect`, {
    GObject: {registerClass: (_meta, cls) => cls},
    Clutter: {Effect: EffectBase}, Cogl, Graphene: {},
    shadowGeometry, BODY_DECLARATIONS, FILL_DECLARATIONS, FILL_CODE, ROUNDED_DECLARATIONS, ROUNDED_CODE,
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
    add_texture_rectangle() {}
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
    Texture2D: {new_with_size: (_context, width, height) => ({width, height, revision: null, get_width: () => width, get_height: () => height})},
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
    shadowGeometry, BODY_DECLARATIONS, FILL_DECLARATIONS, FILL_CODE, ROUNDED_DECLARATIONS, ROUNDED_CODE,
});

function shadowEffect(width = 600, height = 400) {
    const fx = new PaintEffect();
    let purge;
    const stage = {connect: (_signal, callback) => { purge = callback; return 1; }};
    Object.assign(fx.actor, {
        revision: 1, paintCount: 0, get_stage: () => stage,
        get_width: () => width, get_height: () => height,
        get_transformed_size: () => [fx.actor.get_width(), fx.actor.get_height()],
        get_transformed_position: () => [0, 0], is_in_clone_paint: () => false,
        get_paint_opacity: () => 255,
    });
    fx._u = {windowOpacity: 'windowOpacity'};
    fx._pipeline = {get_uniform_location: name => name, set_layer_texture() {}, set_layer_null_texture() {}, set_color() {}, set_uniform_float() {}};
    fx._ensureShadowPipeline = () => {
        if (fx._shadowPipeline) return;
        fx._shadowPipeline = {texture: null, get_uniform_location: name => name,
            set_layer_texture(_layer, texture) { this.texture = texture; },
            get_layer_texture() { return this.texture; },
            set_layer_null_texture() { this.texture = null; }, set_uniform_float() {}};
        fx._shadowUniforms = {};
    };
    fx._ensureShadowPipeline();
    fx._shadowEnabled = true;
    fx._shadowHoleRadius = 24;
    fx._shadowBlur = 12;
    fx._shadowSpread = 3;
    fx._updateTextureMapping = () => {};
    fx.bakes = 0;
    fx._renderShadowTexture = geometry => {
        fx.bakes++;
        return {get_width: () => Math.ceil((geometry.width + 2 * geometry.margin) * fx._paintScale),
            get_height: () => Math.ceil((geometry.height + 2 * geometry.margin) * fx._paintScale)};
    };
    fx.paint = (flags = 0) => {
        fx._shadowHole = [0, 0, fx.actor.get_width(), fx.actor.get_height()];
        const root = new PaintNode();
        fx.vfunc_paint(root, {}, flags);
        root.paint({});
    };
    fx.purge = () => purge();
    // Purge the shared cache so tests do not depend on execution order.
    fx.paint(1);
    fx.purge();
    fx.bakes = 0;
    fx.paint(1);
    return fx;
}

test('content, resize, movement and opacity reuse the tile while content stays current', () => {
    const fx = shadowEffect();
    const originalPaints = fx.actor.paintCount;
    for (let i = 0; i < 5; i++) {
        fx.actor.revision++;
        fx.actor.get_width = () => 600 + i * 20;
        fx.actor.get_transformed_position = () => [i / 4, 0];
        fx._shadowOpacity = i / 5;
        fx._shadowOffset = [i, -i];
        fx.paint(1);
        assert.equal(fx._framebuffer.get_texture().revision, fx.actor.revision);
    }
    assert.equal(fx.bakes, 1);
    assert.equal(fx.actor.paintCount, originalPaints + 5);
});

test('different windows share tiles, while scale, filters and GPU purge regenerate them', () => {
    const first = shadowEffect();
    const second = shadowEffect(800, 700);
    first.bakes = 0;
    first.paint();
    assert.equal(first.bakes, 0);
    for (const change of [() => { first._paintScale = 1.5; },
        () => { first._shadowBlur++; }, () => { first._shadowSpread++; },
        () => { first._shadowHoleRadius++; }, () => { first._shadowExponent++; },
        () => first.purge()]) {
        const before = first.bakes;
        change();
        first.paint();
        assert.equal(first.bakes, before + 1);
    }
    assert.equal(second.bakes, 1);
});

test('small-window resizing regenerates geometry without stale source capacity', () => {
    const fx = shadowEffect(50, 40);
    const original = fx._framebuffer;
    fx.actor.get_width = () => 60;
    fx.paint();
    assert.equal(fx.bakes, 2);
    assert.equal(fx._framebuffer, original);
    fx.actor.get_width = () => 300;
    fx.paint();
    assert.notEqual(fx._framebuffer, original);
});

test('nine-slice geometry preserves small axes and fractional right-edge phase', () => {
    for (const scale of [1, 1.25, 1.5, 2]) {
        const shape = (w, h) => shadowGeometry(w, h, 24, 8, 23, -2, scale);
        const a = shape(800, 600), b = shape(1000, 900);
        assert.equal(a.key, b.key);
        const small = shape(30, 900);
        assert.equal(small.width, 30);
        assert.equal(small.height, a.height);
        const fractional = shape(801, 603);
        near([fractional.width * scale % 1, fractional.height * scale % 1],
            [801 * scale % 1, 603 * scale % 1]);
    }
});

test('shared cache evicts old styles instead of growing with settings changes', () => {
    const fx = shadowEffect();
    const original = fx._shadowBlur;
    for (let i = 1; i <= 20; i++) {
        fx._shadowBlur = original + i;
        fx.paint();
    }
    const before = fx.bakes;
    fx._shadowBlur = original;
    fx.paint();
    assert.equal(fx.bakes, before + 1);
});

test('oversized active styles are retained without rebaking or evicting shared tiles', () => {
    const fx = shadowEffect();
    const another = shadowEffect();
    fx.actor.get_width = () => 4000;
    fx.actor.get_height = () => 3000;
    fx._shadowHoleRadius = 600;
    fx._paintScale = 2;
    fx.paint();
    const baked = fx.bakes;
    for (let i = 0; i < 5; i++) fx.paint(1);
    assert.equal(fx.bakes, baked);
    const otherBakes = another.bakes;
    another.paint();
    assert.equal(another.bakes, otherBakes);
});

test('resizing from a private body shadow to a shared tile never reuses the private image', () => {
    const fx = shadowEffect(180, 180);
    fx.purge();
    fx._detectBody = true;
    fx._ensureBodyDetector = () => {};
    fx._bindBody = () => {};
    fx.paint();
    const privateTexture = fx._shadowPipeline.get_layer_texture(0);
    const before = fx.bakes;
    fx.paint();
    assert.equal(fx.bakes, before, 'Unchanged small window should retain its private tile');
    fx.actor.get_width = () => 600;
    fx.actor.get_height = () => 400;
    fx.paint();
    assert.equal(fx.bakes, before + 1);
    assert.notEqual(fx._shadowPipeline.get_layer_texture(0), privateTexture);
    assert.ok(fx._shadowPipeline.get_layer_texture(0).get_width() < privateTexture.get_width());
});

test('explicit shadow cleanup drops private resources and allows a fresh bake', () => {
    const fx = shadowEffect();
    const content = fx._framebuffer;
    fx._bodyShadowTexture = {};
    fx._bodyShadowKey = 'private';
    fx._shadowBaker = () => {};
    fx.clearShadowResources();
    for (const key of ['_bodyShadowTexture', '_shadowPipeline', '_shadowBaker', '_shadowUniforms'])
        assert.equal(fx[key], null, key);
    assert.equal(fx._bodyShadowKey, '');
    assert.equal(fx._shadowKey, '');
    assert.equal(fx._framebuffer, content, 'Corner content stays available');
    fx.actor.get_width = () => 40;
    fx.actor.get_height = () => 40;
    const bakes = fx.bakes;
    fx.paint();
    assert.equal(fx.bakes, bakes + 1);
    assert.ok(fx._shadowPipeline.get_layer_texture(0));
});
