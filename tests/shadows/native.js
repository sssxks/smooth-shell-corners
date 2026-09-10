import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gsk from 'gi://Gsk?version=4.0';
import Graphene from 'gi://Graphene';

// libadwaita 1.9.3, src/stylesheet/widgets/_window.scss, normal contrast.
// Render its actual outset-shadow nodes with GTK's renderer, on transparency.
Gtk.init();
const surface = Gdk.Surface.new_toplevel(Gdk.Display.get_default());
const renderer = Gsk.Renderer.new_for_surface(surface);
for (const width of [256, 320, 400, 480, 640]) {
    const bounds = new Graphene.Rect().init(0, 0, width + 160, width + 160);
    const outline = new Gsk.RoundedRect();
    outline.init_from_rect(new Graphene.Rect().init(80, 80, width, width), 8);
    for (const [name, layers] of [
        ['focused', [[14, 5, 0.15], [5, 2, 0.10], [0, 1, 0.05]]],
        ['unfocused', [[10, 5, 0.08], [0, 1, 0.05]]],
    ]) {
        const snapshot = new Gtk.Snapshot();
        for (const [blur, spread, alpha] of layers.toReversed()) {
            const color = new Gdk.RGBA({red: 0, green: 0, blue: 0, alpha});
            snapshot.append_outset_shadow(outline, color, 0, 0, spread, blur);
        }
        const texture = renderer.render_texture(snapshot.to_node(), bounds);
        if (!texture.save_to_png(`${ARGV[0]}/${name}-${width}.png`))
            throw new Error('Could not save native shadow');
    }
}
renderer.unrealize();

