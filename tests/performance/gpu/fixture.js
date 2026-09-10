import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib';
const app = new Gtk.Application({application_id: 'org.example.SSCGpu'});
app.connect('activate', () => {
    for (let i = 0; i < 4; i++) {
        const window = new Gtk.ApplicationWindow({application: app, title: `SSC GPU ${i}`,
            decorated: false, default_width: 1000, default_height: 650});
        const label = new Gtk.Label({label: `GPU timing fixture ${i}`});
        if (GLib.getenv('SSC_GPU_BODY') === '1') {
            const css = new Gtk.CssProvider();
            css.load_from_string('window { background: transparent; } .body { background: #303030; color: white; border-radius: 8px; box-shadow: 0 0 6px rgba(0,0,0,0.4); }');
            Gtk.StyleContext.add_provider_for_display(window.get_display(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
            const body = new Gtk.Box({margin_start:16,margin_end:16,margin_top:16,margin_bottom:16});
            body.add_css_class('body'); body.append(label); window.set_child(body);
        } else window.set_child(label);
        window.present();
    }
});
app.run([]);
