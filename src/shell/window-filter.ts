import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {readCornerConfig} from '../settings/config.js';

const appTypeCache = new Map();

export function clearWindowFilterCache(): void {
    appTypeCache.clear();
}
const ROUNDABLE_WINDOW_TYPES = [
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.UTILITY,
    Meta.WindowType.SPLASHSCREEN,
    Meta.WindowType.TOOLBAR,
].filter(type => type !== undefined);

export function normalizeAppId(value: unknown): string {
    if (typeof value !== 'string')
        return '';
    return value.trim().replace(/\.desktop$/i, '');
}

export function getWindowIdentifiers(win: any): string[] {
    const identifiers = new Set<string>();
    const add = (value: unknown) => {
        if (typeof value !== 'string')
            return;
        const trimmed = value.trim();
        if (!trimmed)
            return;
        identifiers.add(trimmed);
        const normalized = normalizeAppId(trimmed);
        if (normalized)
            identifiers.add(normalized);
    };

    try {
        add(win.get_wm_class_instance?.());
        add(win.get_wm_class?.());
    } catch (_) {}
    try {
        add(win.gtkApplicationId ?? win.get_gtk_application_id?.());
    } catch (_) {}
    try {
        add(win.get_sandboxed_app_id?.());
    } catch (_) {}
    try {
        const tracker = Shell.WindowTracker.get_default();
        const app = tracker?.get_window_app(win) ?? null;
        add(app?.get_id?.());
        add(app?.get_name?.());
    } catch (_) {}

    return [...identifiers];
}

export function isListedWindow(identifiers: string[], list: string[]): boolean {
    const lookup = new Set(identifiers.map(normalizeAppId).filter(Boolean));
    return list.some(item => {
        const normalized = normalizeAppId(item);
        return Boolean(normalized && lookup.has(normalized));
    });
}

function getAppType(win: any): string {
    const pid = win.get_pid();
    if (appTypeCache.size > 200)
        appTypeCache.clear();
    if (appTypeCache.has(pid))
        return appTypeCache.get(pid);

    let type = 'Other';
    try {
        const decoder = new TextDecoder();
        const [, bytes] = GLib.file_get_contents(`/proc/${pid}/maps`);
        const maps = decoder.decode(bytes);
        if (maps.includes('libadwaita-1.so'))
            type = 'LibAdwaita';
        else if (maps.includes('libhandy-1.so'))
            type = 'LibHandy';
    } catch (_) {}

    appTypeCache.set(pid, type);
    return type;
}

export function shouldSkip(
    win: any,
    settings: Gio.Settings,
    nativeRadiusRemoved: boolean,
): boolean {
    const identifiers = getWindowIdentifiers(win);
    if (identifiers.some(id => ['com.rastersoft.ding', 'ding'].includes(normalizeAppId(id))))
        return true;

    const windowType = win.windowType ?? win.get_window_type?.();
    if (!ROUNDABLE_WINDOW_TYPES.includes(windowType))
        return true;

    const blacklist = settings.get_strv('blacklist');
    const whitelistMode = settings.get_boolean('whitelist-mode');
    const isListed = isListedWindow(identifiers, blacklist);
    if (whitelistMode ? !isListed : isListed)
        return true;

    const appType = getAppType(win);
    if (!nativeRadiusRemoved &&
        settings.get_boolean('skip-libadwaita-app') &&
        appType === 'LibAdwaita' &&
        !isListed)
        return true;
    if (settings.get_boolean('skip-libhandy-app') && appType === 'LibHandy' && !isListed)
        return true;

    const config = readCornerConfig(settings);
    const isMaximized = win.maximizedHorizontally || win.maximizedVertically;
    if (isMaximized && !config.keepRoundedMaximized)
        return true;
    if (win.fullscreen && !config.keepRoundedFullscreen)
        return true;

    return false;
}
