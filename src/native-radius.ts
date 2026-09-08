import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BEGIN = '\n/* BEGIN Smooth Shell Corners native radius */\n';
const END = '/* END Smooth Shell Corners native radius */\n';

// Target top-level client-decorated windows, not in-app dialogs or popovers.
// Override the actual property: --window-radius is absent in older GTK4 and
// is also used by apps for unrelated styling such as focus rings.
export const NATIVE_RADIUS_CSS = 'window.csd { border-radius: 0; }\n';

export function updateCss(css, enabled) {
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

export function nativeCssFiles(
    configHome = GLib.get_user_config_dir(),
    flatpakHome = GLib.build_filenamev([GLib.get_home_dir(), '.var', 'app']),
) {
    const paths = [GLib.build_filenamev([configHome, 'gtk-4.0', 'gtk.css'])];
    const flatpaks = Gio.File.new_for_path(flatpakHome);
    let entries;
    try {
        entries = flatpaks.enumerate_children('standard::name,standard::type',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    } catch (error) {
        if (error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) return paths;
        throw error;
    }
    try {
        let entry;
        while ((entry = entries.next_file(null))) {
            if (entry.get_file_type() === Gio.FileType.DIRECTORY)
                paths.push(GLib.build_filenamev([
                    flatpakHome, entry.get_name(), 'config', 'gtk-4.0', 'gtk.css',
                ]));
        }
    } finally {
        entries.close(null);
    }
    return paths;
}

// Keep this independent of Shell so uninstall and tests use the same cleanup.
// Read the current contents each time, preserving edits made while enabled.
export function setNativeRadiusRemoved(enabled, paths = nativeCssFiles()) {
    const errors = [];
    for (const path of paths) {
        try {
            const file = Gio.File.new_for_path(path);
            let css = '', etag = null;
            try {
                const [, bytes, loadedEtag] = file.load_contents(null);
                // GJS versions differ in their interpretation of ignoreBOM.
                const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
                css = (bom ? '\uFEFF' : '') + new TextDecoder('utf-8', {fatal: true})
                    .decode(bom ? bytes.subarray(3) : bytes);
                etag = loadedEtag;
            } catch (error) {
                if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) throw error;
                if (!enabled) continue;
            }
            const updated = updateCss(css, enabled);
            if (updated === css) continue;
            if (enabled && GLib.mkdir_with_parents(file.get_parent().get_path(), 0o700) !== 0)
                throw new Error('Could not create the GTK4 configuration directory');
            // Atomic replacement plus the etag prevents overwriting concurrent
            // edits. An empty file after cleanup is harmless and avoids a
            // separate read/delete race with a user's editor.
            const [written] = file.replace_contents(updated, etag, false,
                Gio.FileCreateFlags.NONE, null);
            if (!written) throw new Error('Could not update the GTK4 stylesheet');
        } catch (error) {
            errors.push(`${path}: ${error.message}`);
        }
    }
    // Attempt every file even if one fails, especially during cleanup.
    if (errors.length) throw new Error(errors.join('\n'));
}
