import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

const source = readFileSync(new URL('../../dist/shell/window-manager.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replace('export default class', 'class');

function setup(failEnable = false) {
    const values = {'remove-native-radius': true, 'skip-libadwaita-app': true};
    const callbacks = new Map();
    let nextId = 0;
    const calls = [];
    const notices = [];
    const settings = {
        get_boolean: key => values[key] ?? false,
        get_int: () => 0, get_double: () => 0,
        get_value: () => ({recursiveUnpack: () => []}),
        connect: (signal, callback) => {
            callbacks.set(++nextId, {signal, callback});
            return nextId;
        },
        disconnect: id => callbacks.delete(id),
    };
    const result = vm.runInNewContext(`${source}
        // Isolate the setting/lifecycle wiring from compositor actor plumbing.
        enableEffect = () => {};
        disableEffect = () => {};
        getAppType = () => 'LibAdwaita';
        shouldSkipWindow = () => _settings.get_boolean('skip-libadwaita-app') &&
            !_nativeRadiusRemoved;
        ({instance: new SmoothShellCornersExtension(), skip: () => shouldSkip({windowType: 0})});
    `, {
        Extension: class { getSettings() { return settings; } },
        Meta: {WindowType: {NORMAL: 0}},
        Main: {layoutManager: {_startingUp: false}, notifyError: (...args) => notices.push(args)},
        console: {log() {}, error() {}},
        setNativeRadiusRemoved: enabled => {
            calls.push(enabled);
            if (enabled && failEnable) throw new Error('Test write failure');
        },
    });
    return {...result, calls, notices, callbacks, change(enabled) {
        values['remove-native-radius'] = enabled;
        for (const {signal, callback} of callbacks.values())
            if (signal === 'changed::remove-native-radius') callback();
    }};
}

test('native removal overrides skip only while active and cleans up on disable', () => {
    const state = setup();
    state.instance.enable();
    assert.equal(state.skip(), false);
    state.change(false);
    assert.equal(state.skip(), true);
    state.change(true);
    assert.equal(state.skip(), false);
    state.instance.disable();
    assert.deepEqual(state.calls, [true, false, true, false]);
    assert.equal(state.callbacks.size, 0);
});

test('failed native removal reports an error and rolls back partial writes', () => {
    const state = setup(true);
    state.instance.enable();
    assert.deepEqual(state.calls, [true, false]);
    assert.equal(state.notices.length, 1);
    assert.equal(state.skip(), true);
    state.instance.disable();
});
