import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';

const app = new Gtk.Application({application_id: 'org.example.SSCSharpness'});
app.connect('activate', () => {
    const win = new Gtk.ApplicationWindow({application: app, title: 'SSC text test',
        default_width: 600, default_height: 400, decorated: false});
    const label = new Gtk.Label({xalign: 0, yalign: 0,
        margin_start: 40, margin_end: 40, margin_top: 40, margin_bottom: 40,
        label: 'Smooth Shell Corners — text sharpness\n\nABCDEFGHIJKLMNOPQRSTUVWXYZ\n' +
            'abcdefghijklmnopqrstuvwxyz\n0123456789  {}[]() != => 1.5x\n\n' +
            'The quick brown fox jumps over the lazy dog.'});
    const css = new Gtk.CssProvider();
    css.load_from_string('window { background: white; color: black; } label { font: 16px monospace; }');
    Gtk.StyleContext.add_provider_for_display(win.get_display(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const change = new Gio.SimpleAction({name: 'change'});
    change.connect('activate', () => { label.label = 'Updated window content\n\n0123456789\nCache invalidation check'; });
    app.add_action(change);
    let extra = null;
    const create = new Gio.SimpleAction({name: 'window'});
    create.connect('activate', () => {
        extra = new Gtk.ApplicationWindow({application: app, title: 'SSC lifecycle test',
            default_width: 320, default_height: 240, decorated: false});
        extra.present();
    });
    app.add_action(create);
    const close = new Gio.SimpleAction({name: 'close'});
    close.connect('activate', () => { extra?.destroy(); extra = null; });
    app.add_action(close);
    win.set_child(label);
    win.present();
});
app.run([]);
