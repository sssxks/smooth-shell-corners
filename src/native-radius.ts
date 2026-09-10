import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'enumerate_children_async', 'enumerate_children_finish');
Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.File.prototype, 'make_directory_async', 'make_directory_finish');
Gio._promisify(Gio.File.prototype, 'set_attributes_async', 'set_attributes_finish');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async', 'next_files_finish');
Gio._promisify(Gio.FileEnumerator.prototype, 'close_async', 'close_finish');

const BEGIN = '\n/* BEGIN Smooth Shell Corners native radius */\n';
const END = '/* END Smooth Shell Corners native radius */\n';

// Target top-level client-decorated windows, not in-app dialogs or popovers.
// Override the actual property: --window-radius is absent in older GTK4 and
// is also used by apps for unrelated styling such as focus rings.
export const NATIVE_RADIUS_CSS = 'window.csd { border-radius: 0; box-shadow: none; }\n';

export function updateCss(css: string, enabled: boolean): string {
    const start = css.indexOf(BEGIN);
    const end = css.indexOf(END);
    if (start !== -1 || end !== -1) {
        if (start === -1 || end < start ||
            css.indexOf(BEGIN, start + BEGIN.length) !== -1 ||
            css.indexOf(END, end + END.length) !== -1)
            throw new Error('The Smooth Shell Corners CSS markers were modified; repair them before retrying.');
        css = css.slice(0, start) + css.slice(end + END.length);
    }
    return enabled ? css + BEGIN + NATIVE_RADIUS_CSS + END : css;
}

export async function* nativeCssFiles(
    configHome = GLib.get_user_config_dir(),
    flatpakHome = GLib.build_filenamev([GLib.get_home_dir(), '.var', 'app']),
    cancellable: Gio.Cancellable | null = null,
) {
    // Yield the host first so Flatpak discovery cannot prevent its cleanup.
    yield GLib.build_filenamev([configHome, 'gtk-4.0', 'gtk.css']);
    const flatpaks = Gio.File.new_for_path(flatpakHome);
    let entries;
    try {
        entries = await flatpaks.enumerate_children_async('standard::name,standard::type',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_DEFAULT, cancellable);
    } catch (error) {
        if (error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) return;
        throw error;
    }
    try {
        while (true) {
            const batch = await entries.next_files_async(64, GLib.PRIORITY_DEFAULT, cancellable);
            if (!batch.length) break;
            for (const entry of batch) {
                if (entry.get_file_type() === Gio.FileType.DIRECTORY)
                    yield GLib.build_filenamev([
                        flatpakHome, entry.get_name(), 'config', 'gtk-4.0', 'gtk.css',
                    ]);
            }
        }
    } finally {
        await entries.close_async(GLib.PRIORITY_DEFAULT, null);
    }
}

// Gio has no asynchronous make_directory_with_parents variant.
async function makeParents(directory: Gio.File, cancellable: Gio.Cancellable): Promise<void> {
    try {
        await directory.make_directory_async(GLib.PRIORITY_DEFAULT, cancellable);
    } catch (error) {
        if (!(error instanceof GLib.Error)) throw error;
        if (error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) return;
        const parent = directory.get_parent();
        if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND) || !parent) throw error;
        await makeParents(parent, cancellable);
        return makeParents(directory, cancellable);
    }
    const attributes = new Gio.FileInfo();
    attributes.set_attribute_uint32('unix::mode', 0o700);
    await directory.set_attributes_async(attributes, Gio.FileQueryInfoFlags.NONE,
        GLib.PRIORITY_DEFAULT, cancellable);
}

// Preparation is cancellable; commits contain no await so disable cannot race
// an in-flight replacement. Remember only paths this session may have changed.
let pendingUpdate = Promise.resolve();
let currentUpdate: Gio.Cancellable | null = null;
const touchedFiles = new Set<string>();

function decodeCss(bytes: Uint8Array): string {
    // GJS versions differ in their interpretation of ignoreBOM.
    const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    return (bom ? '\uFEFF' : '') + new TextDecoder('utf-8', {fatal: true})
        .decode(bom ? bytes.subarray(3) : bytes);
}

function commitCss(file: Gio.File, css: string, updated: string, etag: string | null): void {
    if (updated === css) return;
    if (updated.length)
        file.replace_contents(new TextEncoder().encode(updated), etag, false, Gio.FileCreateFlags.NONE, null);
    else
        // GJS passes an empty byte array as NULL, which GIO rejects. Closing
        // an empty replacement stream preserves atomicity and the etag check.
        file.replace(etag, false, Gio.FileCreateFlags.NONE, null).close(null);
}

// Shell does not await disable(). Restore the files already touched without
// directory discovery, preserving current user edits and checking their etags.
export function restoreNativeRadius(): void {
    currentUpdate?.cancel();
    currentUpdate = null;
    const errors = [];
    try {
        for (const path of touchedFiles) {
            try {
                const file = Gio.File.new_for_path(path);
                const [, bytes, etag] = file.load_contents(null);
                const css = decodeCss(bytes);
                commitCss(file, css, updateCss(css, false), etag);
            } catch (error) {
                if (error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) continue;
                errors.push(`${path}: ${String(error)}`);
            }
        }
    } finally {
        touchedFiles.clear();
    }
    if (errors.length) throw new Error(errors.join('\n'));
}

export function setNativeRadiusRemoved(enabled: boolean, paths?: Iterable<string> | AsyncIterable<string>): Promise<void> {
    currentUpdate?.cancel();
    const cancellable = new Gio.Cancellable();
    currentUpdate = cancellable;
    const update = pendingUpdate.then(async () => {
        if (cancellable.is_cancelled()) return;
        try {
            await writeNativeRadius(enabled, cancellable, paths);
        } finally {
            if (currentUpdate === cancellable) currentUpdate = null;
        }
    });
    pendingUpdate = update.catch(() => {});
    return update;
}

// Keep discovery independent of Shell for standalone recovery after a crash.
async function writeNativeRadius(enabled: boolean, cancellable: Gio.Cancellable,
    paths: Iterable<string> | AsyncIterable<string> = nativeCssFiles(undefined, undefined, cancellable)) {
    const errors = [];
    try {
        for await (const path of paths) {
            if (cancellable.is_cancelled()) return;
            try {
                const file = Gio.File.new_for_path(path);
                let css = '', etag = null;
                try {
                    const [bytes, loadedEtag] = await file.load_contents_async(cancellable);
                    css = decodeCss(bytes);
                    etag = loadedEtag;
                } catch (error) {
                    if (!(error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))) throw error;
                    if (!enabled) continue;
                }
                if (cancellable.is_cancelled()) return;
                const updated = updateCss(css, enabled);
                if (enabled && updated !== css) await makeParents(file.get_parent()!, cancellable);
                if (cancellable.is_cancelled()) return;
                if (enabled) touchedFiles.add(path);
                commitCss(file, css, updated, etag);
                if (!enabled) touchedFiles.delete(path);
            } catch (error) {
                if (cancellable.is_cancelled()) return;
                errors.push(`${path}: ${String(error)}`);
            }
        }
    } catch (error) {
        if (cancellable.is_cancelled()) return;
        errors.push(`CSS discovery: ${String(error)}`);
    }
    if (errors.length) throw new Error(errors.join('\n'));
}
