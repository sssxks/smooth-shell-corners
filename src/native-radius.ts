import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'enumerate_children_async', 'enumerate_children_finish');
Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.File.prototype, 'make_directory_async', 'make_directory_finish');
Gio._promisify(Gio.File.prototype, 'set_attributes_async', 'set_attributes_finish');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');
Gio._promisify(Gio.File.prototype, 'replace_async', 'replace_finish');
Gio._promisify(Gio.OutputStream.prototype, 'close_async', 'close_finish');
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

export async function nativeCssFiles(
    configHome = GLib.get_user_config_dir(),
    flatpakHome = GLib.build_filenamev([GLib.get_home_dir(), '.var', 'app']),
) {
    const paths = [GLib.build_filenamev([configHome, 'gtk-4.0', 'gtk.css'])];
    const flatpaks = Gio.File.new_for_path(flatpakHome);
    let entries;
    try {
        entries = await flatpaks.enumerate_children_async('standard::name,standard::type',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_DEFAULT, null);
    } catch (error) {
        if (error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) return paths;
        throw error;
    }
    try {
        while (true) {
            const batch = await entries.next_files_async(64, GLib.PRIORITY_DEFAULT, null);
            if (!batch.length) break;
            for (const entry of batch) {
                if (entry.get_file_type() === Gio.FileType.DIRECTORY)
                    paths.push(GLib.build_filenamev([
                        flatpakHome, entry.get_name(), 'config', 'gtk-4.0', 'gtk.css',
                    ]));
            }
        }
    } finally {
        await entries.close_async(GLib.PRIORITY_DEFAULT, null);
    }
    return paths;
}

// Gio has no asynchronous make_directory_with_parents variant.
async function makeParents(directory: Gio.File): Promise<void> {
    try {
        await directory.make_directory_async(GLib.PRIORITY_DEFAULT, null);
    } catch (error) {
        if (!(error instanceof GLib.Error)) throw error;
        if (error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) return;
        const parent = directory.get_parent();
        if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND) || !parent) throw error;
        await makeParents(parent);
        return makeParents(directory);
    }
    const attributes = new Gio.FileInfo();
    attributes.set_attribute_uint32('unix::mode', 0o700);
    await directory.set_attributes_async(attributes, Gio.FileQueryInfoFlags.NONE,
        GLib.PRIORITY_DEFAULT, null);
}

// Serialize toggles, rollback and disable cleanup, including across re-enables.
let pendingUpdate = Promise.resolve();
export function setNativeRadiusRemoved(enabled: boolean, paths?: string[]): Promise<void> {
    const update = pendingUpdate.then(() => writeNativeRadius(enabled, paths));
    pendingUpdate = update.catch(() => {});
    return update;
}

// Keep this independent of Shell so uninstall and tests use the same cleanup.
// Read the current contents each time, preserving edits made while enabled.
async function writeNativeRadius(enabled: boolean, paths?: string[]) {
    const errors = [];
    for (const path of paths ?? await nativeCssFiles()) {
        try {
            const file = Gio.File.new_for_path(path);
            let css = '', etag = null;
            try {
                const [bytes, loadedEtag] = await file.load_contents_async(null);
                // GJS versions differ in their interpretation of ignoreBOM.
                const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
                css = (bom ? '\uFEFF' : '') + new TextDecoder('utf-8', {fatal: true})
                    .decode(bom ? bytes.subarray(3) : bytes);
                etag = loadedEtag;
            } catch (error) {
                if (!(error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))) throw error;
                if (!enabled) continue;
            }
            const updated = updateCss(css, enabled);
            if (updated === css) continue;
            if (enabled) await makeParents(file.get_parent()!);
            // Atomic replacement plus the etag prevents overwriting concurrent
            // edits. An empty file after cleanup is harmless and avoids a
            // separate read/delete race with a user's editor.
            if (updated.length) {
                await file.replace_contents_bytes_async(new GLib.Bytes(new TextEncoder().encode(updated)), etag, false,
                    Gio.FileCreateFlags.NONE, null);
            } else {
                // Empty GLib.Bytes can supply a null buffer to GIO's async
                // writer. Closing a replacement stream commits an empty file.
                const stream = await file.replace_async(etag, false, Gio.FileCreateFlags.NONE,
                    GLib.PRIORITY_DEFAULT, null);
                await stream.close_async(GLib.PRIORITY_DEFAULT, null);
            }
        } catch (error) {
            errors.push(`${path}: ${String(error)}`);
        }
    }
    // Attempt every file even if one fails, especially during cleanup.
    if (errors.length) throw new Error(errors.join('\n'));
}
