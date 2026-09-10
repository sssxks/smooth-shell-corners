// Used only on the private test D-Bus, never the desktop session bus.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

function call(destination, path, iface, method, args) {
    return Gio.DBus.session.call_sync(destination, path, iface, method, args,
        null, Gio.DBusCallFlags.NONE, 15000, null).deepUnpack();
}

if (ARGV[0] === 'eval') {
    const [ok, result] = call('org.gnome.Shell', '/org/gnome/Shell', 'org.gnome.Shell',
        'Eval', new GLib.Variant('(s)', [ARGV[1]]));
    if (!ok) throw new Error(result);
    print(result || 'null');
} else if (ARGV[0] === 'scale') {
    const destination = 'org.gnome.Mutter.DisplayConfig';
    const path = '/org/gnome/Mutter/DisplayConfig';
    const [serial, monitors] = call(destination, path, destination, 'GetCurrentState', null);
    const [spec, modes] = monitors[0];
    const mode = modes.find(m => m[6]['is-current']?.deepUnpack());
    call(destination, path, destination, 'ApplyMonitorsConfig',
        new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', [serial, 1,
            [[0, 0, Number(ARGV[1]), 0, true, [[spec[0], mode[0], {}]]]], {}]));
    print('null');
} else if (ARGV[0] === 'screenshot') {
    const [ok] = call('org.gnome.Shell.Screenshot', '/org/gnome/Shell/Screenshot',
        'org.gnome.Shell.Screenshot', 'Screenshot',
        new GLib.Variant('(bbs)', [false, false, ARGV[1]]));
    if (!ok) throw new Error('Screenshot failed');
    print('null');
} else if (['change', 'window', 'close', 'body-dialog', 'body-overlay', 'body-inset'].includes(ARGV[0])) {
    call('org.example.SSCSharpness', '/org/example/SSCSharpness', 'org.gtk.Actions',
        'Activate', new GLib.Variant('(sava{sv})', [ARGV[0], [], {}]));
    print('null');
}
