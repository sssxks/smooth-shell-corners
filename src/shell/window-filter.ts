import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import type {ExtensionConfig} from '../settings/config.js';

type AppType = 'Other' | 'LibAdwaita' | 'LibHandy';
const pendingReads = new Map<number, Gio.Cancellable>();
const appTypeCache = new Map<number, AppType>();
const trackedWindows = new Map<Meta.Window, number>();

export function trackWindowFilter(win: Meta.Window): void {
    if (!trackedWindows.has(win)) trackedWindows.set(win, win.get_pid());
}

export function forgetWindowFilter(win: Meta.Window): void {
    const pid = trackedWindows.get(win);
    if (pid === undefined) return;
    trackedWindows.delete(win);
    // Other windows from the same process still share its detection result.
    if ([...trackedWindows.values()].includes(pid)) return;
    pendingReads.get(pid)?.cancel();
    pendingReads.delete(pid);
    appTypeCache.delete(pid);
}

export function clearWindowFilterCache(): void {
    for (const cancellable of pendingReads.values()) cancellable.cancel();
    pendingReads.clear();
    appTypeCache.clear();
    trackedWindows.clear();
}
const ROUNDABLE_WINDOW_TYPES = [
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
].filter(type => type !== undefined);

export function normalizeAppId(value: unknown): string {
    if (typeof value !== 'string')
        return '';
    return value.trim().replace(/\.desktop$/i, '');
}

export function getWindowIdentifiers(win: Meta.Window): string[] {
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
        add(win.gtkApplicationId);
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

function getAppType(win: Meta.Window, onReady: () => void): AppType | undefined {
    const pid = trackedWindows.get(win);
    // Geometry notifications may arrive during a close animation, after
    // unmanaged has released this process. Do not start another read then.
    if (pid === undefined) return 'Other';
    const cached = appTypeCache.get(pid);
    if (cached) return cached;
    if (pendingReads.has(pid)) return undefined;

    const cancellable = new Gio.Cancellable();
    pendingReads.set(pid, cancellable);
    const file = Gio.File.new_for_path(`/proc/${pid}/maps`);
    file.load_contents_async(cancellable, (_file, result) => {
        let type: AppType = 'Other';
        try {
            const [, bytes] = file.load_contents_finish(result);
            const maps = new TextDecoder().decode(bytes);
            if (maps.includes('libadwaita-1.so')) type = 'LibAdwaita';
            else if (maps.includes('libhandy-1.so')) type = 'LibHandy';
        } catch (_) {}
        // A closed process or disabled extension must not repopulate the cache.
        if (cancellable.is_cancelled()) return;
        pendingReads.delete(pid);
        appTypeCache.set(pid, type);
        onReady();
    });
    return undefined;
}

export function shouldSkip(
    win: Meta.Window,
    config: ExtensionConfig,
    nativeRadiusRemoved: boolean,
    onReady: () => void = () => {},
): boolean {
    const identifiers = getWindowIdentifiers(win);
    if (identifiers.some(id => ['com.rastersoft.ding', 'ding'].includes(normalizeAppId(id))))
        return true;

    const windowType = win.windowType;
    if (!ROUNDABLE_WINDOW_TYPES.includes(windowType))
        return true;

    const {blacklist, whitelistMode} = config;
    const isListed = isListedWindow(identifiers, blacklist);
    if (whitelistMode ? !isListed : isListed)
        return true;

    const isMaximized = win.maximizedHorizontally || win.maximizedVertically;
    if (isMaximized && !config.keepRoundedMaximized)
        return true;
    if (win.fullscreen && !config.keepRoundedFullscreen)
        return true;

    const skipAdwaita = !nativeRadiusRemoved && config.skipLibadwaitaApp;
    if (isListed || (!skipAdwaita && !config.skipLibhandyApp))
        return false;
    const appType = getAppType(win, onReady);
    // Preserve native appearance until toolkit detection completes.
    if (appType === undefined) return true;
    return (skipAdwaita && appType === 'LibAdwaita') ||
        (config.skipLibhandyApp && appType === 'LibHandy');
}
