// gjs -m tests/native-radius-render.js — briefly opens a real libadwaita window.
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib';
import {NATIVE_RADIUS_CSS} from '../native-radius.js';

Adw.init();
const win = new Adw.Window({
    default_width: 360, default_height: 200,
    title: 'Smooth Shell Corners rendering test',
});
win.set_content(new Gtk.Label({label: 'Checking native corner removal and restoration'}));
const provider = new Gtk.CssProvider();
provider.load_from_string(NATIVE_RADIUS_CSS);
const display = win.get_display();
const loop = new GLib.MainLoop(null, false);
let stage = 0;
let failure = null;
win.present();
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
    try {
        const snapshot = new Gtk.Snapshot();
        Gtk.WidgetPaintable.new(win).snapshot(snapshot, win.get_width(), win.get_height());
        const node = new TextDecoder().decode(snapshot.to_node().serialize().get_data());
        const rounded = /rounded-clip\s*\{/.test(node);
        if (rounded !== (stage !== 1))
            throw new Error(`Stage ${stage}: expected ${stage === 1 ? 'square' : 'rounded'} native content\n${node}`);
        if (stage === 0)
            Gtk.StyleContext.add_provider_for_display(display, provider, Gtk.STYLE_PROVIDER_PRIORITY_USER);
        else if (stage === 1)
            Gtk.StyleContext.remove_provider_for_display(display, provider);
        if (++stage < 3) return GLib.SOURCE_CONTINUE;
    } catch (error) {
        failure = error;
    }
    win.destroy();
    loop.quit();
    return GLib.SOURCE_REMOVE;
});
loop.run();
if (failure) throw failure;
print('Real libadwaita rendering passed: rounded → square → rounded.');
