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
    css.load_from_string('window { background: white; color: black; } label { font: 16px monospace; } window.body-window { background: transparent; } .body-panel { background: black; color: white; border-radius: 8px; box-shadow: 0 0 6px 0 rgba(0,0,0,0.4); }');
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
    for (const kind of ['body-dialog', 'body-overlay']) {
        const createBody = new Gio.SimpleAction({name: kind});
        createBody.connect('activate', () => {
            extra?.destroy();
            extra = new Gtk.ApplicationWindow({application: app, title: `SSC ${kind}`,
                default_width: 640, default_height: kind === 'body-dialog' ? 420 : 140,
                decorated: false});
            extra.add_css_class('body-window');
            const overlay = new Gtk.Overlay();
            const panel = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL,
                margin_start: kind === 'body-dialog' ? 16 : 170,
                margin_end: kind === 'body-dialog' ? 16 : 170,
                margin_top: 16, margin_bottom: 16});
            panel.add_css_class('body-panel');
            panel.append(new Gtk.Label({label: 'Body text 0123',
                margin_start: 32, margin_end: 32, margin_top: 32}));
            overlay.set_child(panel);
            extra.set_child(overlay);
            extra.present();
        });
        app.add_action(createBody);
    }
    const close = new Gio.SimpleAction({name: 'close'});
    close.connect('activate', () => { extra?.destroy(); extra = null; });
    app.add_action(close);
    win.set_child(label);
    win.present();
});
app.run([]);
