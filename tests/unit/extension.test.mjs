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
        ({instance: new SmoothShellCornersExtension(), skip: () => shouldSkip({windowType: 0}, {})});
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

function setupWindowLifecycle(ready = true) {
    function emitter() {
        const callbacks = new Map();
        let nextId = 0;
        return {
            connect(signal, callback) {
                callbacks.set(++nextId, {signal, callback});
                return nextId;
            },
            disconnect(id) { callbacks.delete(id); },
            emit(signal, ...args) {
                for (const entry of [...callbacks.values()])
                    if (entry.signal === signal) entry.callback(this, ...args);
            },
            callbacks,
        };
    }
    const actor = Object.assign(emitter(), {
        metaWindow: {...emitter(), get_monitor: () => 0},
        effects: new Map(),
        get_effect(name) { return this.effects.get(name); },
        add_effect_with_name(name, effect) { this.effects.set(name, effect); },
        remove_effect_by_name(name) { this.effects.delete(name); },
        get_first_child() { return this; },
        bind_property(prop, target) {
            const copy = () => { target[prop] = this[prop]; };
            copy();
            const id = this.connect(`notify::${prop}`, copy);
            return {unbind: () => this.disconnect(id)};
        },
        opacity: 255,
    });
    const shadow = {
        destroyed: false,
        get_constraints: () => [],
        get_parent: () => null,
        clear_effects() {},
        destroy() { this.destroyed = true; },
    };
    const windowManager = emitter();
    class Timeline {}
    const timeline = Object.assign(new Timeline(), emitter());
    const actors = [actor];
    const state = vm.runInNewContext(`${source}
        _settings = settings;
        buildConfig = () => ({customShadow: true});
        scaleFactor = () => 1;
        computeBounds = () => ({});
        refreshShadowStyle = () => {};
        refreshShadowClip = () => {};
        createShadow = () => shadow;
        enableEffect();
        ({disable: disableEffect, tracked: () => _actorMap.size});
    `, {
        Extension: class {},
        settings: {...emitter(), get_boolean: key => key === 'custom-shadow'},
        shadow,
        global: {get_window_actors: () => actors, display: {...emitter(), get_monitor_scale: () => 1}, windowManager},
        Main: {layoutManager: emitter()},
        Clutter: {Timeline},
        GObject: {BindingFlags: {SYNC_CREATE: 1}},
        RoundedCornersEffect: class { updateUniforms() {} },
        refreshShadowGeometry() {},
        targetActor: actor => actor,
        getWindowTexture: () => ready ? actor : null,
        getWindowEffect: (actor, name) => actor.get_effect(name),
        shouldSkipWindow: () => false,
        clearWindowFilterCache() {},
        connectSignal(connections, object, signal, callback) {
            connections.push({object, id: object.connect(signal, callback)});
        },
        disconnectSignals(connections) {
            for (const {object, id} of connections) object.disconnect(id);
            connections.length = 0;
        },
    });
    return {...state, actor, shadow, actors, windowManager, timeline, ready() { ready = true; actor.emit('notify::size'); }};
}

for (const finish of ['destroy', 'disable']) {
    test(`closing window keeps corners until ${finish} and releases its resources`, () => {
        const state = setupWindowLifecycle();
        const {actor, shadow, windowManager} = state;
        assert.equal(actor.effects.size, 1);
        windowManager.emit('destroy', actor);
        state.actors.length = 0;
        assert.equal(actor.effects.size, 1, 'close animation retains corner effect');
        assert.equal(shadow.destroyed, false);
        actor.opacity = 96;
        actor.emit('notify::opacity');
        assert.equal(shadow.opacity, 96, 'shadow follows the close fade');
        if (finish === 'destroy') actor.emit('destroy');
        else state.disable();
        assert.equal(actor.effects.size, 0);
        assert.equal(shadow.destroyed, true);
        assert.equal(state.tracked(), 0);
        assert.equal(actor.callbacks.size, 0);
        assert.equal(actor.metaWindow.callbacks.size, 0);
        state.disable();
    });
}

for (const finish of ['destroy', 'disable']) {
    test(`window awaiting texture is disconnected on ${finish}`, () => {
        const state = setupWindowLifecycle(false);
        assert.equal(state.actor.effects.size, 0);
        assert.equal(state.tracked(), 1);
        if (finish === 'destroy') state.actor.emit('destroy');
        else state.disable();
        state.ready();
        assert.equal(state.actor.effects.size, 0);
        assert.equal(state.actor.callbacks.size, 0);
        assert.equal(state.actor.metaWindow.callbacks.size, 0);
        assert.equal(state.tracked(), 0);
        state.disable();
    });
}

test('late texture becomes rounded without reconnecting the window', () => {
    const state = setupWindowLifecycle(false);
    state.ready();
    assert.equal(state.actor.effects.size, 1);
    state.disable();
});

for (const finish of ['completed', 'disable']) {
    test(`Magic Lamp completion is owned until ${finish}`, () => {
        const state = setupWindowLifecycle();
        state.actor.effects.set('unminimize-magic-lamp-effect', {timerId: state.timeline});
        state.windowManager.emit('minimize', state.actor);
        state.windowManager.emit('unminimize', state.actor);
        assert.equal(state.shadow.visible, false);
        assert.equal(state.timeline.callbacks.size, 1);
        if (finish === 'completed') {
            state.timeline.emit('completed');
            assert.equal(state.shadow.visible, true);
        } else {
            state.disable();
            state.timeline.emit('completed');
            assert.equal(state.shadow.visible, false);
        }
        assert.equal(state.timeline.callbacks.size, 0);
        state.disable();
    });
}
