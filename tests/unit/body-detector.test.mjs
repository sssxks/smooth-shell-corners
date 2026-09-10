import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

const source = readFileSync(new URL('../../dist/effects/body-detector.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replace('export class', 'class');

function setup() {
    const timers = new Map();
    let timerId = 0, repaints = 0, draws = 0;
    const Cogl = {
        PixelFormat: {RGBA_FP_32323232_PRE: 1}, SnippetHook: {}, PipelineFilter: {}, PipelineWrapMode: {},
        Snippet: {new() {}},
        Texture2D: {new_from_data: (_context, width, height, _format, _stride, data) => {
            assert.equal(new Float32Array(data.buffer)[0], -1, 'Initial result must preserve the app');
            return {get_width: () => width, get_height: () => height};
        }},
        Offscreen: {new_with_texture: texture => ({get_texture: () => texture,
            get_width: () => texture.get_width(), allocate() {}, set_viewport() {}, orthographic() {},
            set_modelview_matrix() {}, draw_rectangle() { draws++; }, flush() {}})},
        Pipeline: {new: () => ({set_blend() {}, set_layer_filters() {}, set_layer_wrap_mode() {},
            add_snippet() {}, set_layer_texture() {}, set_layer_combine() {}, set_layer_null_texture() {},
            get_uniform_location: name => name, set_uniform_float() {}})},
    };
    const Detector = vm.runInNewContext(`${source}\nBodyDetector`, {
        Cogl, Graphene: {Matrix: class { init_identity() { return this; } }},
        GLib: {PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false,
            timeout_add: (_priority, milliseconds, callback) => {
                assert.equal(milliseconds, 180);
                timers.set(++timerId, callback); return timerId;
            }, source_remove: id => timers.delete(id)},
        BODY_PROBE_DECLARATIONS: '', BODY_PROBE_CODE: '',
        BODY_VALIDATE_DECLARATIONS: '', BODY_VALIDATE_CODE: '',
    });
    const detector = new Detector(null, () => repaints++);
    const frame = [0, 0, 600, 400];
    detector.updateGeometry(frame, 1.5);
    const render = () => {
        if (detector.pending) detector.render({get_width: () => 1024, get_height: () => 640}, frame, 1.5, [0, 0]);
    };
    const tick = () => {
        const entries = [...timers.values()]; timers.clear(); entries.forEach(callback => callback());
    };
    return {detector, render, tick, timers, draws: () => draws, repaints: () => repaints};
}

test('startup makes three bounded attempts, then content frames do not scan', () => {
    const s = setup();
    s.render(); s.tick(); s.render(); s.tick(); s.render();
    assert.equal(s.detector.revision, 3);
    assert.equal(s.draws(), 6);
    assert.equal(s.timers.size, 0);
    for (let i = 0; i < 100; i++) s.render();
    assert.equal(s.draws(), 6);
});

test('resize reuses old insets and debounces to one scan after geometry settles', () => {
    const s = setup();
    s.render(); s.tick(); s.render(); s.tick(); s.render();
    for (let i = 1; i <= 100; i++) {
        s.detector.updateGeometry([0, 0, 600 + i, 400], 1.5);
        s.render();
        assert.equal(s.timers.size, 1);
    }
    assert.equal(s.detector.revision, 3);
    s.tick(); s.render();
    assert.equal(s.detector.revision, 4);
    assert.equal(s.timers.size, 0);
    s.detector.updateGeometry([0, 0, 700, 400], 1.5);
    assert.equal(s.timers.size, 0, 'Identical geometry must not schedule detection');
});

test('destroying or excluding a window cancels the pending detector callback', () => {
    const s = setup(); s.render();
    assert.equal(s.timers.size, 1);
    s.detector.dispose(); s.tick();
    assert.equal(s.repaints(), 0);
    assert.equal(s.timers.size, 0);
});
