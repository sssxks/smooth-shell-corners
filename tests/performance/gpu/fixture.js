import Gtk from 'gi://Gtk?version=4.0';
const app = new Gtk.Application({application_id: 'org.example.SSCGpu'});
app.connect('activate', () => {
    for (let i = 0; i < 4; i++) {
        const window = new Gtk.ApplicationWindow({application: app, title: `SSC GPU ${i}`,
            decorated: false, default_width: 1000, default_height: 650});
        window.set_child(new Gtk.Label({label: `GPU timing fixture ${i}`}));
        window.present();
    }
});
app.run([]);
