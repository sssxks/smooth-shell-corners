// Window tracking outlives temporary exclusions; actor destruction and disable own cleanup.
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {RoundedCornersEffect} from '../effects/index.js';
import { setNativeRadiusRemoved } from '../native-radius.js';
import {readConfig, type ExtensionConfig} from '../settings/config.js';
import {clearWindowFilterCache, shouldSkip as shouldSkipWindow} from './window-filter.js';
import {disconnectSignals, type SignalConnection} from './connections.js';
import {
    computeBounds as computeWindowBounds,
} from './window-geometry.js';
import {
    createShadow as createWindowShadow,
    refreshShadowClip as refreshWindowShadowClip,
    refreshShadowGeometry,
    refreshShadowStyle as refreshWindowShadowStyle,
} from './shadows.js';

const ROUNDED_CORNERS_EFFECT = 'ssc-rounded-corners';

interface ActorData {
    shadow: St.Bin | null;
    bindings: GObject.Binding[];
    connections: SignalConnection[];
    animationConnections: SignalConnection[];
}

let _settings: Gio.Settings | null = null;
let _nativeRadiusRemoved = false;
const _connections: SignalConnection[] = [];   // global connections
const _actorMap = new Map<Meta.WindowActor, ActorData>();
let _mutterSettings: Gio.Settings | null = null;
let _mutterSettingsConn = 0;
let _fractionalScaling: boolean | null = null;
let _settingsTimeoutId = 0;

function currentSettings(): Gio.Settings {
    if (!_settings) throw new Error('Smooth Shell Corners is disabled');
    return _settings;
}

function logDbg(msg: string) {
    if (_settings?.get_boolean('debug-mode'))
        console.log(`[SmoothShellCorners] ${msg}`);
}

function getEffect(actor: Meta.WindowActor) {
    const effect = actor.get_effect(ROUNDED_CORNERS_EFFECT);
    return effect instanceof RoundedCornersEffect ? effect : null;
}

/**
 * Check whether fractional scaling is enabled.
 * When `scale-monitor-framebuffer` is active (default on GNOME 46+ Wayland),
 * the compositor handles scaling at the buffer level and the actor/FBO
 * dimensions already account for the scale.  Returning the raw monitor
 * scale in that case would double-scale all shader values.
 */
function isFractionalScalingEnabled() {
    if (_fractionalScaling !== null)
        return _fractionalScaling;

    try {
        if (!_mutterSettings) {
            _mutterSettings = new Gio.Settings({ schema_id: 'org.gnome.mutter' });
            _mutterSettingsConn = _mutterSettings.connect('changed::experimental-features', () => {
                _fractionalScaling = null;
                refreshAll();
            });
        }

        const features = _mutterSettings.get_strv('experimental-features');
        const isWaylandCompositor = 'is_wayland_compositor' in Meta ? Meta.is_wayland_compositor : null;
        const isWayland = typeof isWaylandCompositor !== 'function' || isWaylandCompositor() === true;
        _fractionalScaling = isWayland && features.includes('scale-monitor-framebuffer');
    } catch (_) {
        _fractionalScaling = false;
    }
    return _fractionalScaling;
}

/** Get the monitor scale factor for a window (respects fractional scaling). */
function scaleFactor(win: Meta.Window | null) {
    // When fractional scaling is enabled the actor dimensions already
    // incorporate the scale, so the shader must use scale = 1.
    if (isFractionalScalingEnabled())
        return 1;

    const idx = win?.get_monitor() ?? 0;
    return global.display.get_monitor_scale(idx);
}

function removeShadow(data: ActorData) {
    for (const binding of data.bindings)
        binding.unbind();
    data.bindings = [];
    data.shadow?.destroy();
    data.shadow = null;
}

function syncShadow(actor: Meta.WindowActor, data: ActorData, config: ExtensionConfig, scale: number) {
    if (!config.customShadow) {
        removeShadow(data);
        return;
    }
    if (data.shadow) return;
    data.shadow = createWindowShadow(actor, scale);
    for (const prop of ['pivot-point', 'translation-x', 'translation-y',
                       'scale-x', 'scale-y', 'visible', 'opacity']) {
        data.bindings.push(actor.bind_property(prop, data.shadow, prop,
            GObject.BindingFlags.SYNC_CREATE));
    }
}

/** Remove effects and shadow from a window actor. */
function onRemoveEffect(actor: Meta.WindowActor) {
    try {
        logDbg(`Removing effect from "${actor.metaWindow?.title}"`);
    } catch (_) {}

    try {
        actor.remove_effect_by_name(ROUNDED_CORNERS_EFFECT);
    } catch (_) {
        // Actor may already be destroyed
    }

    const data = _actorMap.get(actor);
    if (!data) return;

    disconnectSignals(data.animationConnections);
    removeShadow(data);
}

/** Recompute and push all shader uniforms for a single window. */
function refreshRoundedCorners(actor: Meta.WindowActor) {
    const win = actor.metaWindow;
    if (!win) return;

    const data = _actorMap.get(actor);
    if (!data) return;
    const cfg = readConfig(currentSettings());
    if (shouldSkipWindow(win, cfg, _nativeRadiusRemoved)) {
        onRemoveEffect(actor);
        return;
    }

    if (!actor.get_texture()) return;
    let fx = getEffect(actor);
    if (!fx) {
        fx = new RoundedCornersEffect();
        actor.add_effect_with_name(ROUNDED_CORNERS_EFFECT, fx);
    }
    fx.enabled = true;

    const scale = scaleFactor(win);
    fx.updateUniforms(scale, cfg, computeWindowBounds(actor, scale, cfg.fillPadding),
        global.display.get_monitor_scale(win.get_monitor()));
    syncShadow(actor, data, cfg, scale);
    refreshWindowShadowStyle(actor, data.shadow, cfg, scale);
    refreshWindowShadowClip(actor, data.shadow, cfg, scale);
    refreshShadowGeometry(actor, data.shadow, scale);
}

/** Refresh the shadow style / position for a single actor. */
function refreshFocus(actor: Meta.WindowActor) {
    const data = _actorMap.get(actor);
    if (data?.shadow)
        refreshWindowShadowStyle(actor, data.shadow, readConfig(currentSettings()), scaleFactor(actor.metaWindow));
}

/** Refresh tracked windows without replacing their lifecycle connections. */
function refreshAll() {
    for (const actor of global.get_window_actors())
        refreshRoundedCorners(actor);
}

/** When windows are re-stacked, keep shadow actors sorted below their windows. */
function onRestacked() {
    for (const actor of global.get_window_actors()) {
        const data = _actorMap.get(actor);
        if (actor.visible && data?.shadow)
            global.windowGroup.set_child_below_sibling(data.shadow, actor);
    }
}

function attachWindowSignals(actor: Meta.WindowActor) {
    const data = _actorMap.get(actor);
    if (!data) return;

    const win = actor.metaWindow;
    if (!win) return;
    const texture = actor.get_texture();

    // The window-manager destroy signal starts the close animation. Keep the
    // effect until the actor itself is destroyed, after its final painted frame.
    data.connections.push({object: actor, id: actor.connect('destroy', () => removeEffectFrom(actor))});

    // Window resized → update shader uniforms
    data.connections.push({object: actor, id: actor.connect('notify::first-child', () => refreshRoundedCorners(actor))});
    data.connections.push({object: actor, id: actor.connect('notify::size', () => refreshRoundedCorners(actor))});
    if (texture)
        data.connections.push({object: texture, id: texture.connect('size-changed', () => refreshRoundedCorners(actor))});

    // Fullscreen state changed (may not cause a size change)
    data.connections.push({object: win, id: win.connect('notify::fullscreen', () => refreshRoundedCorners(actor))});
    data.connections.push({object: win, id: win.connect('notify::maximized-horizontally', () => refreshRoundedCorners(actor))});
    data.connections.push({object: win, id: win.connect('notify::maximized-vertically', () => refreshRoundedCorners(actor))});
    // Focus changed → update shadow style
    data.connections.push({object: win, id: win.connect('notify::appears-focused', () => refreshFocus(actor))});
    // Monitor / workspace change
    data.connections.push({object: win, id: win.connect('workspace-changed', () => refreshFocus(actor))});

}

function applyEffectTo(actor: Meta.WindowActor) {
    if (!actor?.metaWindow)
        return;

    if (!_actorMap.has(actor)) {
        _actorMap.set(actor, {
            shadow: null, bindings: [], connections: [], animationConnections: [],
        });
        attachWindowSignals(actor);
    }
    refreshRoundedCorners(actor);
}

function applyEffectToWindow(win: Meta.Window) {
    const actor = win.get_compositor_private<Meta.WindowActor | null>();
    if (actor) applyEffectTo(actor);
    // WindowManager::map handles actors created after window-created. There is
    // no Meta.Window compositor-private property to observe with notify.
}

function removeEffectFrom(actor: Meta.WindowActor) {
    const data = _actorMap.get(actor);
    if (!data) return;
    disconnectSignals(data.connections);
    onRemoveEffect(actor);
    _actorMap.delete(actor);
}

function enableEffect() {
    const settings = currentSettings();
    // Apply to all existing windows
    for (const actor of global.get_window_actors())
        applyEffectTo(actor);

    // New window created
    _connections.push({object: global.display, id: global.display.connect('window-created', (_, win) => {
            applyEffectToWindow(win);
        })});

    _connections.push({object: global.windowManager, id: global.windowManager.connect('map', (_, actor) => applyEffectTo(actor))});

    // Resource scale is integer-rounded by Clutter, so its notify signal cannot
    // distinguish 125% from 150%. Track actual monitor changes instead.
    _connections.push({object: Main.layoutManager, id: Main.layoutManager.connect('monitors-changed', refreshAll)});
    _connections.push({object: global.display, id: global.display.connect('window-entered-monitor', (_, _monitor, win) => {
        const actor = win.get_compositor_private<Meta.WindowActor | null>();
        if (actor) refreshRoundedCorners(actor);
    })});

    // Minimise: always hide shadow + disable effect to prevent the white
    // background of the shadow actor from showing during the animation.
    _connections.push({object: global.windowManager, id: global.windowManager.connect('minimize', (_, actor) => {
            const data = _actorMap.get(actor);
            if (data) disconnectSignals(data.animationConnections);
            if (data?.shadow)
                data.shadow.visible = false;
            const fx = getEffect(actor);
            if (fx) fx.enabled = false;
        })});

    // Unminimise: restore shadow + effect.  For the Magic-Lamp extension,
    // wait until the animation finishes before showing the shadow.
    _connections.push({object: global.windowManager, id: global.windowManager.connect('unminimize', (_, actor) => {
            const data = _actorMap.get(actor);
            const fx   = getEffect(actor);

            if (data) disconnectSignals(data.animationConnections);
            const lamp = actor.get_effect('unminimize-magic-lamp-effect');
            const timer = lamp && 'timerId' in lamp && lamp.timerId instanceof Clutter.Timeline
                ? lamp.timerId : null;
            if (timer && data?.shadow && fx) {
                data.shadow.visible = false;
                data.animationConnections.push({object: timer, id: timer.connect('completed', () => {
                    disconnectSignals(data.animationConnections);
                    if (data.shadow) data.shadow.visible = true;
                    fx.enabled = true;
                })});
                return;
            }

            // Standard unminimise (no magic lamp)
            if (data?.shadow)
                data.shadow.visible = true;
            if (fx) fx.enabled = true;
        })});

    // Window re-stack → reorder shadow actors
    _connections.push({object: global.display, id: global.display.connect('restacked', onRestacked)});

    // Settings changed → reapply all with debounce to prevent slider lag
    _connections.push({object: settings, id: settings.connect('changed', () => {
        if (_settingsTimeoutId) {
            GLib.source_remove(_settingsTimeoutId);
            _settingsTimeoutId = 0;
        }
        _settingsTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            clearWindowFilterCache();
            refreshAll();
            _settingsTimeoutId = 0;
            return GLib.SOURCE_REMOVE;
        });
    })});
}

function disableEffect() {
    // Closing actors can already be absent from get_window_actors().
    for (const actor of _actorMap.keys())
        removeEffectFrom(actor);
    disconnectSignals(_connections);
    
    if (_settingsTimeoutId) {
        GLib.source_remove(_settingsTimeoutId);
        _settingsTimeoutId = 0;
    }
    
    clearWindowFilterCache();
    if (_mutterSettings && _mutterSettingsConn) {
        _mutterSettings.disconnect(_mutterSettingsConn);
        _mutterSettingsConn = 0;
    }
}

export default class SmoothShellCornersExtension extends Extension {

    #startupConnection = 0;
    #nativeRadiusConnection = 0;

    #syncNativeRadius(enabled: boolean) {
        try {
            setNativeRadiusRemoved(enabled);
            _nativeRadiusRemoved = enabled;
        } catch (error) {
            console.error(`[SmoothShellCorners] ${String(error)}`);
            Main.notifyError('Smooth Shell Corners',
                `Could not ${enabled ? 'remove' : 'restore'} native GTK4 corners. ${String(error)}`);
            // If enabling only succeeded for some files, roll those back.
            if (enabled) this.#syncNativeRadius(false);
        }
    }

    override enable() {
        _settings = this.getSettings();
        logDbg('Enabling…');
        this.#syncNativeRadius(currentSettings().get_boolean('remove-native-radius'));
        this.#nativeRadiusConnection = _settings.connect('changed::remove-native-radius', () => {
            this.#syncNativeRadius(currentSettings().get_boolean('remove-native-radius')); 
            // enableEffect's general settings handler refreshes window effects.
        });

        if (Main.layoutManager._startingUp) {
            // GNOME Shell is still starting up – wait until it is ready
            this.#startupConnection = Main.layoutManager.connect(
                'startup-complete', () => {
                    enableEffect();
                    Main.layoutManager.disconnect(this.#startupConnection);
                    this.#startupConnection = 0;
                },
            );
        } else {
            enableEffect();
        }
    }

    override disable() {
        logDbg('Disabling…');

        if (this.#startupConnection !== 0) {
            Main.layoutManager.disconnect(this.#startupConnection);
            this.#startupConnection = 0;
        }

        disableEffect();
        if (this.#nativeRadiusConnection !== 0) {
            currentSettings().disconnect(this.#nativeRadiusConnection);
            this.#nativeRadiusConnection = 0;
        }
        this.#syncNativeRadius(false);
        _nativeRadiusRemoved = false;
        _settings = null;
        _mutterSettings = null;
        _fractionalScaling = null;
    }
}
