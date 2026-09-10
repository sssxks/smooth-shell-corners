// Attach only to the private Shell; capture its marks without system sampling.
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';

const destination = 'org.gnome.Shell';
const path = '/org/gnome/Sysprof3/Profiler';
const iface = 'org.gnome.Sysprof3.Profiler';
if (ARGV[0] === 'start') {
    const stream = Gio.File.new_for_path(ARGV[1]).create(Gio.FileCreateFlags.NONE, null);
    try {
        if (!(stream instanceof GioUnix.FileDescriptorBased))
            throw new Error('Capture output must support a file descriptor');
        const fds = new Gio.UnixFDList();
        const handle = fds.append(stream.get_fd());
        Gio.DBus.session.call_with_unix_fd_list_sync(destination, path, iface, 'Start',
            new GLib.Variant('(a{sv}h)', [{}, handle]), null,
            Gio.DBusCallFlags.NONE, 10000, fds, null);
    } finally {
        stream.close(null);
    }
} else if (ARGV[0] === 'stop') {
    Gio.DBus.session.call_sync(destination, path, iface, 'Stop', null,
        null, Gio.DBusCallFlags.NONE, 10000, null);
} else {
    throw new Error('Expected start PATH or stop');
}
