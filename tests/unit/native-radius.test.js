// gjs -m tests/unit/native-radius.test.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import {nativeCssFiles, NATIVE_RADIUS_CSS, setNativeRadiusRemoved, updateCss} from '../../dist/native-radius.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function throws(fn, message) {
    let failed = false;
    try { await fn(); } catch (_) { failed = true; }
    assert(failed, message);
}

function read(path) {
    return new TextDecoder('utf-8', {ignoreBOM: true}).decode(GLib.file_get_contents(path)[1]);
}

function removeTree(file) {
    if (file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.DIRECTORY) {
        const entries = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let entry;
        while ((entry = entries.next_file(null))) removeTree(file.get_child(entry.get_name()));
        entries.close(null);
    }
    file.delete(null);
}

const root = GLib.dir_make_tmp('ssc-native-radius-test-XXXXXX');
try {
    const config = `${root}/host`;
    const flatpaks = `${root}/flatpaks`;
    GLib.mkdir_with_parents(`${flatpaks}/org.example.App/config`, 0o700);
    GLib.file_set_contents(`${flatpaks}/not-an-app`, '');
    Gio.File.new_for_path(`${flatpaks}/linked-app`).make_symbolic_link(`${flatpaks}/org.example.App`, null);
    const paths = await nativeCssFiles(config, flatpaks);
    assert(paths.length === 2, 'Discover host and real Flatpak directories only');
    assert((await nativeCssFiles(config, `${root}/missing`)).length === 1, 'Missing Flatpak root is supported');

    // Do not create config files just because the extension is enabled with
    // removal off, or during uninstall on a machine that never used removal.
    await setNativeRadiusRemoved(false, paths);
    assert(!GLib.file_test(config, GLib.FileTest.EXISTS), 'Cleanup must not create config directories');

    const originals = ['', '/* no trailing newline */', '/* user CSS */\r\n', '\uFEFF/* UTF-8 BOM */'];
    for (const original of originals) {
        const added = updateCss(original, true);
        assert(updateCss(added, true) === added, 'Repeated enable is idempotent');
        assert(updateCss(added, false) === original, 'Original CSS round trips exactly');
        assert(updateCss(added + '\n/* new edit */', false) === original + '\n/* new edit */',
            'Cleanup preserves new user edits');
    }

    await setNativeRadiusRemoved(true, paths);
    for (const path of paths) {
        assert(read(path).includes(NATIVE_RADIUS_CSS), 'CSS reaches host and Flatpak');
        const directory = Gio.File.new_for_path(path).get_parent();
        const mode = directory.query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null)
            .get_attribute_uint32('unix::mode') & 0o777;
        assert(mode === 0o700, 'New GTK configuration directories remain private');
    }
    const enabled = read(paths[0]);
    await setNativeRadiusRemoved(true, paths);
    assert(read(paths[0]) === enabled, 'Repeated file writes do not duplicate the override');
    GLib.file_set_contents(paths[0], '/* before */' + enabled + '/* after */');
    await setNativeRadiusRemoved(false, paths);
    assert(read(paths[0]) === '/* before *//* after */', 'User edits survive real file cleanup');
    assert(read(paths[1]) === '', 'New Flatpak CSS becomes harmless empty file');

    GLib.file_set_contents(paths[0], originals[3]);
    await setNativeRadiusRemoved(true, paths);
    await setNativeRadiusRemoved(false, paths);
    assert(Array.from(GLib.file_get_contents(paths[0])[1]).join() ===
        Array.from(new TextEncoder().encode(originals[3])).join(), 'UTF-8 BOM is preserved on disk');

    await Promise.all([
        setNativeRadiusRemoved(true, paths),
        setNativeRadiusRemoved(false, paths),
        setNativeRadiusRemoved(true, paths),
        setNativeRadiusRemoved(false, paths),
    ]);
    assert(Array.from(GLib.file_get_contents(paths[0])[1]).join() ===
        Array.from(new TextEncoder().encode(originals[3])).join(),
    'Rapid toggles finish with cleanup and preserve user CSS');
    assert(read(paths[1]) === '', 'Rapid toggles leave no Flatpak override');

    const malformed = enabled.replace('END Smooth', 'EDITED Smooth');
    GLib.file_set_contents(paths[0], malformed);
    await setNativeRadiusRemoved(true, [paths[1]]);
    await throws(() => setNativeRadiusRemoved(false, paths), 'Malformed markers report an error');
    assert(read(paths[0]) === malformed, 'Malformed file is not truncated');
    assert(read(paths[1]) === '', 'One failure does not prevent cleanup of other files');
    await throws(() => updateCss(enabled + enabled, false), 'Duplicate markers are rejected');

    GLib.file_set_contents(paths[0], new Uint8Array([0xff]));
    await throws(() => setNativeRadiusRemoved(true, paths), 'Invalid UTF-8 is not silently rewritten');
    assert(GLib.file_get_contents(paths[0])[1][0] === 0xff, 'Invalid bytes preserved');

    const provider = new Gtk.CssProvider();
    let parseError = null;
    provider.connect('parsing-error', (_provider, _section, error) => { parseError = error; });
    provider.load_from_string(NATIVE_RADIUS_CSS);
    assert(parseError === null, `GTK4 accepts override: ${parseError}`);
    print('Native-radius tests passed: discovery, GTK CSS, idempotency, preservation, cleanup and failures.');
} finally {
    removeTree(Gio.File.new_for_path(root));
}
