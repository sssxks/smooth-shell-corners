/**
 * extension.js – Smooth Shell Corners
 *
 * Applies GLSL-based rounded corners (and an optional custom shadow) to every
 * window that is not already drawn with libadwaita / libhandy.
 *
 * Signal / lifecycle flow
 * ──────────────────────
 * enable()
 *   └─ wait for shell startup → enableEffect()
 *        ├─ connect global signals   (window-created, minimize, unminimize,
 *        │                            restacked, settings changed)
 *        └─ applyEffectTo() every existing window actor
 *
 * applyEffectTo(actor)
 *   ├─ connect per-window signals  (size, texture size, fullscreen, focus,
 *   │                               workspace-changed, actor destroy)
 *   └─ onAddEffect(actor)
 *        ├─ add RoundedCornersEffect to the actor / surface
 *        ├─ create custom shadow St.Bin (below the actor in windowGroup)
 *        └─ refreshRoundedCorners()
 *
 * disable()
 *   ├─ disableEffect()    → removeEffectFrom() every actor
 *   └─ uninitPrefs()
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {RoundedCornersEffect} from '../effects/index.js';
import { setNativeRadiusRemoved } from '../native-radius.js';
import {readCornerConfig} from '../settings/config.js';
import {clearWindowFilterCache, shouldSkip as shouldSkipWindow} from './window-filter.js';
import {connectSignal, disconnectSignals, type SignalConnection} from './connections.js';
import {
    computeBounds as computeWindowBounds,
    getEffect as getWindowEffect,
    getWindowTexture,
    targetActor,
} from './window-geometry.js';
import {
    createShadow as createWindowShadow,
    refreshShadowClip as refreshWindowShadowClip,
    refreshShadowGeometry,
    refreshShadowStyle as refreshWindowShadowStyle,
} from './shadows.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const ROUNDED_CORNERS_EFFECT = 'ssc-rounded-corners';

// ─────────────────────────────────────────────────────────────────────────────
// Module-level state
//   _settings  – Gio.Settings instance (populated by enable())
//   _connections – list of { object, id } for global signal connections
//   _actorMap    – Map<Meta.WindowActor, ActorData> (includes closing actors)
//
// ActorData = {
//   shadow         : St.Bin | null,
//   propertyBindings: GObject.Binding[],
//   signalsAttached : boolean,
//   timeoutId      : GLib.Source | 0,
// }
// ─────────────────────────────────────────────────────────────────────────────
let _settings       = null;
let _nativeRadiusRemoved = false;
const _connections: SignalConnection[] = [];   // global connections
const _actorMap     = new Map();
let _mutterSettings = null;
let _mutterSettingsConn = 0;
let _fractionalScaling = null;
let _settingsTimeoutId = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Settings helpers
// ─────────────────────────────────────────────────────────────────────────────
function getB(key)   { return _settings.get_boolean(key); }

function buildConfig() { return readCornerConfig(_settings); }

// ─────────────────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────────────────
function logDbg(msg) {
    if (_settings && getB('debug-mode'))
        console.log(`[SmoothShellCorners] ${msg}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Application type detection  (libadwaita / libhandy)
// ─────────────────────────────────────────────────────────────────────────────
function shouldSkip(win) {
    return shouldSkipWindow(win, _settings, _nativeRadiusRemoved);
}

// ─────────────────────────────────────────────────────────────────────────────
// Actor helpers
// ─────────────────────────────────────────────────────────────────────────────

function getEffect(actor) {
    return getWindowEffect(actor, ROUNDED_CORNERS_EFFECT);
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
        const isWaylandCompositor = (Meta as any).is_wayland_compositor;
        const isWayland = !isWaylandCompositor || isWaylandCompositor();
        _fractionalScaling = isWayland && features.includes('scale-monitor-framebuffer');
    } catch (_) {
        _fractionalScaling = false;
    }
    return _fractionalScaling;
}

/** Get the monitor scale factor for a window (respects fractional scaling). */
function scaleFactor(win) {
    // When fractional scaling is enabled the actor dimensions already
    // incorporate the scale, so the shader must use scale = 1.
    if (isFractionalScalingEnabled())
        return 1;

    const idx = win.get_monitor();
    return global.display.get_monitor_scale(idx);
}

/**
 * Compute the offset between the window's buffer rect and its frame rect.
 * CSD windows have invisible resize grips outside the visible frame; this
 * delta lets us clip only the visible part.
 *
 * Returns [dx, dy, dw, dh] (all ≤ 0 for the width/height components).
 */
function computeBounds(actor, fillPadding = false) {
    return computeWindowBounds(actor, scaleFactor(actor.metaWindow), fillPadding);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shadow helpers
// ─────────────────────────────────────────────────────────────────────────────

function createShadow(actor) {
    return createWindowShadow(actor, _settings, scaleFactor(actor.metaWindow));
}

function refreshShadowStyle(actor, shadowActor) {
    refreshWindowShadowStyle(actor, shadowActor, _settings, scaleFactor(actor.metaWindow));
}

function refreshShadowClip(actor, shadowActor) {
    refreshWindowShadowClip(actor, shadowActor, _settings, scaleFactor(actor.metaWindow));
}

// ─────────────────────────────────────────────────────────────────────────────
// Effect application / removal
// ─────────────────────────────────────────────────────────────────────────────

/** Attach the RoundedCornersEffect and a custom shadow to a window actor. */
function onAddEffect(actor) {
    logDbg(`Adding effect to "${actor.metaWindow.title}"`);

    const win = actor.metaWindow;
    if (shouldSkip(win)) {
        logDbg(`  → skipped`);
        return;
    }

    const target = targetActor(actor);
    if (!target) return;

    if (_actorMap.has(actor) || target.get_effect(ROUNDED_CORNERS_EFFECT)) {
        refreshRoundedCorners(actor);
        return;
    }

    target.add_effect_with_name(ROUNDED_CORNERS_EFFECT, new RoundedCornersEffect());

    let shadow = null;
    const bindings = [];

    if (getB('custom-shadow')) {
        shadow = createShadow(actor);

        // Mirror visibility / transform from window to shadow
        for (const prop of ['pivot-point', 'translation-x', 'translation-y',
                             'scale-x', 'scale-y', 'visible', 'opacity']) {
            bindings.push(actor.bind_property(prop, shadow, prop,
                GObject.BindingFlags.SYNC_CREATE));
        }
    }

    _actorMap.set(actor, {
        shadow,
        bindings,
        connections: [],
        signalsAttached: false,
        timeoutId: 0,
    });
    refreshRoundedCorners(actor);
}

/** Remove effects and shadow from a window actor. */
function onRemoveEffect(actor) {
    try {
        logDbg(`Removing effect from "${actor.metaWindow?.title}"`);
    } catch (_) {}

    try {
        const target = targetActor(actor);
        if (target)
            target.remove_effect_by_name(ROUNDED_CORNERS_EFFECT);
    } catch (_) {
        // Actor may already be destroyed
    }

    const data = _actorMap.get(actor);
    if (!data) return;

    // Disconnect per-window signals safely
    if (data.connections) {
        for (const c of data.connections) {
            try { c.obj.disconnect(c.id); } catch (_) {}
        }
        data.connections = [];
    }

    // Unbind property mirrors
    for (const b of data.bindings)
        b.unbind();

    // Remove and destroy the custom shadow actor
    if (data.shadow) {
        try {
            data.shadow.get_constraints().forEach(c => data.shadow.remove_constraint(c));
            if (data.shadow.get_parent())
                global.windowGroup.remove_child(data.shadow);
            data.shadow.clear_effects();
            data.shadow.destroy();
        } catch (_) {
            // Shadow actor may already be destroyed
        }
    }

    if (data.timeoutId)
        GLib.source_remove(data.timeoutId);

    _actorMap.delete(actor);
}

/** Recompute and push all shader uniforms for a single window. */
function refreshRoundedCorners(actor) {
    const win = actor.metaWindow;
    if (!win) return;

    const data = _actorMap.get(actor);
    const fx   = getEffect(actor);

    // If neither the effect nor actor data exists, add the effect.
    // Guard against re-entry: only call onAddEffect when there is no _actorMap
    // entry yet (avoids the infinite loop onAddEffect → refreshRoundedCorners
    // → onAddEffect …). onAddEffect calls refreshRoundedCorners itself at the
    // end, so we just return here.
    if (!fx && !data) {
        onAddEffect(actor);
        return;
    }

    if (shouldSkip(win)) {
        if (data) onRemoveEffect(actor);
        return;
    }

    if (!fx) return;   // effect was removed due to shouldSkip during onAddEffect
    if (!fx.enabled) fx.enabled = true;

    const cfg = buildConfig();
    fx.updateUniforms(scaleFactor(win), cfg, computeBounds(actor, cfg.fillPadding),
        global.display.get_monitor_scale(win.get_monitor()));

    // Update shadow
    if (data) {
        refreshShadowStyle(actor, data.shadow);
        refreshShadowClip(actor, data.shadow);

        refreshShadowGeometry(actor, data.shadow, scaleFactor(win));
    }
}

/** Refresh the shadow style / position for a single actor. */
function refreshFocus(actor) {
    const data = _actorMap.get(actor);
    if (data?.shadow)
        refreshShadowStyle(actor, data.shadow);
}

/** Remove and re-add the effect for a window actor. */
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

// ─────────────────────────────────────────────────────────────────────────────
// Global signal management
// ─────────────────────────────────────────────────────────────────────────────

function addConnection(obj, signal, cb) {
    connectSignal(_connections, obj, signal, cb);
}

function disconnectAll() {
    disconnectSignals(_connections);
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-window signal setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

function attachWindowSignals(actor) {
    const data = _actorMap.get(actor);
    if (data?.signalsAttached)
        return;

    if (!data) return;

    const addWinConn = (obj, sig, cb) => {
        if (obj) data.connections.push({ obj, id: obj.connect(sig, cb) });
    };

    const win     = actor.metaWindow;
    const texture = getWindowTexture(actor);

    // The window-manager destroy signal starts the close animation. Keep the
    // effect until the actor itself is destroyed, after its final painted frame.
    addWinConn(actor, 'destroy', () => removeEffectFrom(actor));

    // Window resized → update shader uniforms
    addWinConn(actor,   'notify::size',  () => { if (actor.metaWindow) refreshRoundedCorners(actor); });
    if (texture)
        addWinConn(texture, 'size-changed', () => { if (actor.metaWindow) refreshRoundedCorners(actor); });

    // Fullscreen state changed (may not cause a size change)
    addWinConn(win, 'notify::fullscreen',     () => { if (actor.metaWindow) refreshRoundedCorners(actor); });
    // Focus changed → update shadow style
    addWinConn(win, 'notify::appears-focused',() => { if (actor.metaWindow) refreshFocus(actor); });
    // Monitor / workspace change
    addWinConn(win, 'workspace-changed',      () => { if (actor.metaWindow) refreshFocus(actor); });

    if (data)
        data.signalsAttached = true;
}

function applyEffectTo(actor) {
    if (!actor?.metaWindow)
        return;

    if (_actorMap.has(actor) || getEffect(actor)) {
        refreshRoundedCorners(actor);
        attachWindowSignals(actor);
        return;
    }

    // Wayland / XWayland windows may not have a surface child yet.
    if (!actor.get_first_child?.()) {
        const connId = actor.connect('notify::first-child', () => {
            actor.disconnect(connId);
            applyEffectTo(actor);
        });
        return;
    }

    if (!getWindowTexture(actor)) {
        // The compositor texture is not ready yet.  This happens with Qt /
        // OpenGL-accelerated X11 apps (VirtualBox, Qt-GL, some Chromium builds)
        // where the window is mapped before its first paint arrives.
        // Wait for the actor's size to change (first paint / resize), then retry.
        // We disconnect before retrying to avoid double-applying the effect.
        const connId = actor.connect('notify::size', () => {
            actor.disconnect(connId);
            applyEffectTo(actor);
        });
        return;
    }

    // Add the effect FIRST, then connect signals. If signals were connected
    // before the effect, adding the effect could trigger notify::size
    // synchronously, causing re-entrant calls to refreshRoundedCorners
    // before _actorMap has been populated.
    onAddEffect(actor);
    attachWindowSignals(actor);
}

function applyEffectToWindow(win) {
    if (!win)
        return;

    const actor = win.get_compositor_private?.();
    if (actor) {
        applyEffectTo(actor);
        return;
    }

    const connId = win.connect('notify::compositor-private', () => {
        const nextActor = win.get_compositor_private?.();
        if (!nextActor)
            return;

        win.disconnect(connId);
        applyEffectTo(nextActor);
    });
}

function removeEffectFrom(actor) {
    onRemoveEffect(actor);
}

// ─────────────────────────────────────────────────────────────────────────────
// Global enable / disable
// ─────────────────────────────────────────────────────────────────────────────

function enableEffect() {
    // Apply to all existing windows
    for (const actor of global.get_window_actors())
        applyEffectTo(actor);

    // New window created
    addConnection(global.display, 'window-created',
        (_, win) => {
            applyEffectToWindow(win);
        });

    // Resource scale is integer-rounded by Clutter, so its notify signal cannot
    // distinguish 125% from 150%. Track actual monitor changes instead.
    addConnection(Main.layoutManager, 'monitors-changed', refreshAll);
    addConnection(global.display, 'window-entered-monitor', (_, _monitor, win) => {
        const actor = win.get_compositor_private();
        if (actor) refreshRoundedCorners(actor);
    });

    // Minimise: always hide shadow + disable effect to prevent the white
    // background of the shadow actor from showing during the animation.
    addConnection(global.windowManager, 'minimize',
        (_, actor) => {
            const data = _actorMap.get(actor);
            if (data?.shadow)
                data.shadow.visible = false;
            const fx = getEffect(actor);
            if (fx) fx.enabled = false;
        });

    // Unminimise: restore shadow + effect.  For the Magic-Lamp extension,
    // wait until the animation is nearly finished before showing the shadow.
    addConnection(global.windowManager, 'unminimize',
        (_, actor) => {
            const data = _actorMap.get(actor);
            const fx   = getEffect(actor);

            const lamp = actor.get_effect('unminimize-magic-lamp-effect');
            if (lamp && data?.shadow && fx) {
                data.shadow.visible = false;
                const timer = lamp.timerId;
                if (timer) {
                    const tid = timer.connect('new-frame', src => {
                        if (src.get_progress() > 0.98) {
                            data.shadow.visible = true;
                            fx.enabled = true;
                            src.disconnect(tid);
                        }
                    });
                }
                return;
            }

            // Standard unminimise (no magic lamp)
            if (data?.shadow)
                data.shadow.visible = true;
            if (fx) fx.enabled = true;
        });

    // Window re-stack → reorder shadow actors
    addConnection(global.display, 'restacked', onRestacked);

    // Settings changed → reapply all with debounce to prevent slider lag
    addConnection(_settings, 'changed', () => {
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
    });
}

function disableEffect() {
    // Closing actors can already be absent from get_window_actors().
    for (const actor of _actorMap.keys())
        removeEffectFrom(actor);
    disconnectAll();
    
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

// ─────────────────────────────────────────────────────────────────────────────
// Extension class
// ─────────────────────────────────────────────────────────────────────────────

export default class SmoothShellCornersExtension extends Extension {

    #startupConnection = null;
    #nativeRadiusConnection = null;

    #syncNativeRadius(enabled) {
        try {
            setNativeRadiusRemoved(enabled);
            _nativeRadiusRemoved = enabled;
        } catch (error) {
            console.error(`[SmoothShellCorners] ${error.message}`);
            Main.notifyError('Smooth Shell Corners',
                `Could not ${enabled ? 'remove' : 'restore'} native GTK4 corners. ${error.message}`);
            // If enabling only succeeded for some files, roll those back.
            if (enabled) this.#syncNativeRadius(false);
        }
    }

    enable() {
        _settings = this.getSettings();
        logDbg('Enabling…');
        this.#syncNativeRadius(_settings.get_boolean('remove-native-radius'));
        this.#nativeRadiusConnection = _settings.connect('changed::remove-native-radius', () => {
            this.#syncNativeRadius(_settings.get_boolean('remove-native-radius'));
            // enableEffect's general settings handler refreshes window effects.
        });

        if (Main.layoutManager._startingUp) {
            // GNOME Shell is still starting up – wait until it is ready
            this.#startupConnection = Main.layoutManager.connect(
                'startup-complete', () => {
                    enableEffect();
                    Main.layoutManager.disconnect(this.#startupConnection);
                    this.#startupConnection = null;
                },
            );
        } else {
            enableEffect();
        }
    }

    disable() {
        logDbg('Disabling…');

        if (this.#startupConnection !== null) {
            Main.layoutManager.disconnect(this.#startupConnection);
            this.#startupConnection = null;
        }

        disableEffect();
        if (this.#nativeRadiusConnection !== null) {
            _settings.disconnect(this.#nativeRadiusConnection);
            this.#nativeRadiusConnection = null;
        }
        this.#syncNativeRadius(false);
        _nativeRadiusRemoved = false;
        _settings = null;
        _mutterSettings = null;
        _fractionalScaling = null;
    }
}
