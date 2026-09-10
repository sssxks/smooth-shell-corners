import Gtk from 'gi://Gtk?version=4.0';

const app = new Gtk.Application({application_id: 'org.example.SSCBenchmark'});
app.connect('activate', () => {
    for (let i = 0; i < 6; i++) {
        const window = new Gtk.ApplicationWindow({application: app,
            title: `SSC benchmark ${i}`, decorated: false,
            default_width: 400, default_height: 260});
        window.set_child(new Gtk.Label({
            label: `Window ${i}\n\nABCDEFGHIJKLMNOPQRSTUVWXYZ\n` +
                'abcdefghijklmnopqrstuvwxyz\n0123456789  {}[]() != => 1.5x',
        }));
        window.present();
    }
});
app.run([]);
