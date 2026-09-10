import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {setImmediate} from 'node:timers';
import {test} from 'node:test';

const source = readFileSync(new URL('../../dist/shell/window-manager.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replace('export default class', 'class');

function setup(failEnable = false, write = () => {}) {
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
        refreshAll = () => {};
        getAppType = () => 'LibAdwaita';
        shouldSkipWindow = () => _settings.get_boolean('skip-libadwaita-app') &&
            !_nativeRadiusRemoved;
        ({instance: new SmoothShellCornersExtension(), skip: () => shouldSkipWindow({windowType: 0}, {}, _nativeRadiusRemoved)});
    `, {
        Extension: class { getSettings() { return settings; } },
        Meta: {WindowType: {NORMAL: 0}},
        Main: {layoutManager: {_startingUp: false}, notifyError: (...args) => notices.push(args)},
        console: {log() {}, error() {}},
        restoreNativeRadius: () => calls.push(false),
        setNativeRadiusRemoved: enabled => {
            calls.push(enabled);
            if (enabled && failEnable) throw new Error('Test write failure');
            return write(enabled);
        },
    });
    return {...result, calls, notices, callbacks, change(enabled) {
        values['remove-native-radius'] = enabled;
        for (const {signal, callback} of callbacks.values())
            if (signal === 'changed::remove-native-radius') callback();
    }};
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('native removal overrides skip only while active and cleans up on disable', async () => {
    const state = setup();
    state.instance.enable();
    await settle();
    assert.equal(state.skip(), false);
    state.change(false);
    await settle();
    assert.equal(state.skip(), true);
    state.change(true);
    await settle();
    assert.equal(state.skip(), false);
    state.instance.disable();
    assert.deepEqual(state.calls, [true, false, true, false]);
    assert.equal(state.callbacks.size, 0);
});

test('failed native removal reports an error and rolls back partial writes', async () => {
    const state = setup(true);
    state.instance.enable();
    await settle();
    assert.deepEqual(state.calls, [true, false]);
    assert.equal(state.notices.length, 1);
    assert.equal(state.skip(), true);
    state.instance.disable();
});

test('late CSS completion after disable cannot affect a new enable cycle', async () => {
    const completions = [];
    const state = setup(false, () => new Promise(resolve => completions.push(resolve)));
    state.instance.enable();
    state.instance.disable();
    state.instance.enable();
    assert.equal(state.skip(), true);
    completions[0]();
    await settle();
    assert.equal(state.skip(), true);
    completions[1]();
    await settle();
    assert.equal(state.skip(), false);
    state.instance.disable();
    await settle();
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
        get_effect(name) { return this.effects.get(name) ?? null; },
        add_effect_with_name(name, effect) { this.effects.set(name, effect); },
        remove_effect_by_name(name) { this.effects.delete(name); },
        get_texture() { return ready ? this : null; },
    });
    const windowManager = emitter();
    const timeline = emitter();
    const settings = {...emitter(), get_boolean: key => key === 'custom-shadow'};
    const timers = new Map();
    let nextTimer = 0;
    let toolkitCached = true;
    const actors = [actor];
    const filterWindows = new Set();
    const config = {customShadow: true, keepShadowMaximized: false, focusedShadow: {opacity: 115}, unfocusedShadow: {opacity: 18}};
    const state = vm.runInNewContext(`${source}
        _settings = settings;
        scaleFactor = () => 1;
        enableEffect();
        ({disable: disableEffect, tracked: () => _actorMap.size});
    `, {
        Extension: class {},
        settings,
        readConfig: () => config,
        computeWindowBounds: () => ({}),
        global: {get_window_actors: () => actors, display: {...emitter(), get_monitor_scale: () => 1}, windowManager},
        Main: {layoutManager: emitter()},
        GLib: {PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false,
            timeout_add(_priority, _delay, callback) { timers.set(++nextTimer, callback); return nextTimer; },
            source_remove(id) { timers.delete(id); }},
        RoundedCornersEffect: class {
            clears = 0;
            clearShadowResources() { this.clears++; }
            updateUniforms(...args) { this.shadow = args[4]; }
        },
        trackWindowFilter(win) { filterWindows.add(win); },
        forgetWindowFilter(win) { filterWindows.delete(win); },
        shouldSkipWindow: () => !toolkitCached,
        clearWindowFilterCache() { toolkitCached = false; },
        clearShadowCache() {},
        disconnectSignals(connections) {
            for (const {object, id} of connections) object.disconnect(id);
            connections.length = 0;
        },
    });
    return {...state, actor, config, actors, filterWindows, windowManager, timeline, settings,
        toolkitCached: () => toolkitCached,
        tick() {
            const callbacks = [...timers.values()];
            timers.clear();
            callbacks.forEach(callback => callback());
        },
        ready() { ready = true; actor.emit('notify::size'); }};
}

for (const finish of ['destroy', 'disable']) {
    test(`closing window keeps corners until ${finish} and releases its resources`, () => {
        const state = setupWindowLifecycle();
        const {actor, windowManager} = state;
        assert.equal(actor.effects.size, 1);
        assert.ok(state.filterWindows.has(actor.metaWindow));
        actor.metaWindow.emit('unmanaged');
        assert.equal(state.filterWindows.size, 0);
        assert.equal(actor.effects.size, 1, 'Unmanaged preserves the close animation');
        windowManager.emit('destroy', actor);
        state.actors.length = 0;
        assert.equal(actor.effects.size, 1, 'close animation retains corner effect');
        if (finish === 'destroy') actor.emit('destroy');
        else state.disable();
        assert.equal(actor.effects.size, 0);
        assert.equal(state.tracked(), 0);
        assert.equal(state.filterWindows.size, 0);
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
        assert.equal(state.filterWindows.size, 0);
        state.disable();
    });
}

test('late texture becomes rounded without reconnecting the window', () => {
    const state = setupWindowLifecycle(false);
    state.ready();
    assert.equal(state.actor.effects.size, 1);
    state.disable();
});

for (const lamp of [false, true]) {
    test(`minimize and restore preserve the enabled effect with Magic Lamp ${lamp ? 'on' : 'off'}`, () => {
        const state = setupWindowLifecycle();
        const effect = state.actor.get_effect('ssc-rounded-corners');
        if (lamp) state.actor.effects.set('unminimize-magic-lamp-effect', {timerId: state.timeline});
        state.windowManager.emit('minimize', state.actor);
        assert.equal(effect.enabled, true);
        state.windowManager.emit('unminimize', state.actor);
        state.timeline.emit('completed');
        assert.equal(state.actor.get_effect('ssc-rounded-corners'), effect);
        assert.equal(effect.enabled, true);
        assert.equal(state.timeline.callbacks.size, 0);
        state.disable();
    });
}

test('settings refresh preserves detected windows and disable clears toolkit detection', () => {
    const state = setupWindowLifecycle();
    const effect = state.actor.get_effect('ssc-rounded-corners');
    for (const key of ['corner-radius', 'shadow-strength', 'debug-mode', 'blacklist', 'skip-libhandy-app']) {
        state.settings.emit('changed', key);
        state.tick();
        assert.equal(state.actor.get_effect('ssc-rounded-corners'), effect, key);
        assert.equal(effect.enabled, true);
        assert.equal(state.toolkitCached(), true);
    }
    state.disable();
    assert.equal(state.toolkitCached(), false);
});

test('maximised and fullscreen shadows follow the setting independently of corners', () => {
    const s = setupWindowLifecycle();
    const effect = s.actor.get_effect('ssc-rounded-corners');
    const refresh = () => s.actor.emit('notify::size');
    for (const flag of ['maximizedHorizontally', 'maximizedVertically', 'fullscreen']) {
        s.actor.metaWindow[flag] = true;
        for (const focused of [false, true]) {
            s.actor.metaWindow.appears_focused = focused;
            s.config.keepShadowMaximized = false;
            refresh();
            assert.equal(effect.shadow, undefined);
            assert.equal(s.actor.get_effect('ssc-rounded-corners'), effect);
            s.config.keepShadowMaximized = true;
            refresh();
            assert.equal(effect.shadow, focused ? s.config.focusedShadow : s.config.unfocusedShadow);
        }
        s.actor.metaWindow[flag] = false;
    }
    s.config.keepShadowMaximized = false;
    refresh();
    assert.equal(effect.shadow, s.config.focusedShadow);
    assert.equal(effect.clears, 0, 'Temporary shadow suppression retains resources');
    s.config.customShadow = false;
    refresh();
    assert.equal(effect.shadow, undefined);
    assert.equal(effect.clears, 1);
    s.disable();
});
