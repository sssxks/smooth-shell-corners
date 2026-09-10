import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Extension from '../../dist/extension.js';

const sleep = ms => new Promise(resolve => GLib.timeout_add(
    GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));
const windows = () => global.get_window_actors()
    .filter(a => a.metaWindow.title?.startsWith('SSC benchmark '))
    .sort((a, b) => a.metaWindow.title.localeCompare(b.metaWindow.title));

export default class Probe {
    enable() {
        global.context.unsafe_mode = true;
        const path = Gio.File.new_for_uri(import.meta.url).get_parent()
            .get_parent().get_parent().get_child('dist').get_path();
        this.extension = new Extension({uuid: 'smooth-shell-corners@xks',
            name: 'Smooth Shell Corners', path, dir: Gio.File.new_for_path(path),
            'settings-schema': 'org.gnome.shell.extensions.smooth-shell-corners'});
        this.settings = this.extension.getSettings();
        // Pin inputs across commits, even if extension defaults change.
        // Undecorated fixtures need no GTK CSS override.
        const settings = {
            'corner-radius': 8, 'smoothing': 1, 'fill-padding': true,
            'padding-top': 1, 'padding-bottom': 1, 'padding-left': 1, 'padding-right': 1,
            'remove-native-radius': false, 'skip-libadwaita-app': false,
            'skip-libhandy-app': false, 'blacklist': [], 'whitelist-mode': false,
            'border-width': 0, 'border-red': .8, 'border-green': .8,
            'border-blue': .85, 'border-alpha': 1,
            'keep-rounded-maximized': false, 'keep-rounded-fullscreen': false,
            'custom-shadow': false, 'keep-shadow-maximized': false,
            'focused-shadow-opacity': 45, 'focused-shadow-blur': 18,
            'focused-shadow-spread': -2, 'focused-shadow-x-offset': 0,
            'focused-shadow-y-offset': 4,
            'unfocused-shadow-opacity': 28, 'unfocused-shadow-blur': 12,
            'unfocused-shadow-spread': -2, 'unfocused-shadow-x-offset': 0,
            'unfocused-shadow-y-offset': 3, 'debug-mode': false,
        };
        for (const [key, value] of Object.entries(settings))
            this.settings.set_value(key,
                new GLib.Variant(this.settings.get_value(key).get_type_string(), value));
        this.enabled = false;
        global.sscBench = this;
        Main.overview.hide();
    }

    async prepare(mode) {
        if (this.enabled) this.extension.disable();
        this.enabled = false;
        Main.overview.hide();
        this.settings.set_boolean('custom-shadow', mode === 'shadows');
        if (mode !== 'off') {
            this.extension.enable();
            this.enabled = true;
        }
        const actors = windows();
        if (actors.length !== 6) throw new Error(`Expected six windows, got ${actors.length}`);
        actors.forEach((a, i) => a.metaWindow.move_resize_frame(false,
            20 + (i % 3) * 410, 40 + Math.floor(i / 3) * 280, 400, 260));
        actors[5].metaWindow.activate(global.get_current_time());
        await sleep(700);
        this.mode = mode;
        this.validate();
    }

    validate() {
        const actors = windows();
        if (actors.length !== 6) throw new Error('Window count changed');
        if (!actors[5].metaWindow.appears_focused)
            throw new Error('Expected fixture 5 to retain focus on the desktop');
        const monitor = Main.layoutManager.monitors[0];
        if (Main.layoutManager.monitors.length !== 1 ||
            monitor.width !== 1280 || monitor.height !== 720)
            throw new Error('Expected one 1920×1080 monitor at 150%');
        return actors.map((a, i) => {
            const rect = a.metaWindow.get_frame_rect();
            const fx = a.get_effect('ssc-rounded-corners');
            if (rect.width !== 400 || rect.height !== 260 || a.metaWindow.minimized ||
                rect.x !== 20 + (i % 3) * 410 || rect.y !== 40 + Math.floor(i / 3) * 280)
                throw new Error('Fixture geometry changed');
            if ((!!fx && fx.enabled) !== (this.mode !== 'off'))
                throw new Error(`Effect state mismatch for ${this.mode}`);
            if (fx && fx._shadowEnabled !== (this.mode === 'shadows'))
                throw new Error('Shadow state mismatch');
            return {title: a.metaWindow.title, x: rect.x, y: rect.y,
                width: rect.width, height: rect.height, focused: a.metaWindow.appears_focused};
        });
    }

    async cycle() {
        Main.overview.show();
        await sleep(700);
        if (!Main.overview.visible) throw new Error('Overview did not open');
        Main.overview.hide();
        await sleep(700);
        if (Main.overview.visible) throw new Error('Overview did not close');
    }

    start(mode) {
        this.result = null;
        this.run(mode).then(result => { this.result = result; }, error => {
            this.result = {error: error.stack ?? String(error)};
        });
        return true;
    }

    async run(mode) {
        await this.prepare(mode);
        // Populate pipelines and textures before the measured transitions.
        await this.cycle();
        await this.cycle();
        const geometry = this.validate();
        const spans = [];
        for (let i = 0; i < 6; i++) {
            const start = GLib.get_monotonic_time() * 1000;
            await this.cycle();
            spans.push([start, GLib.get_monotonic_time() * 1000]);
        }
        if (JSON.stringify(this.validate()) !== JSON.stringify(geometry))
            throw new Error('Fixture geometry changed during measurement');
        const settings = Object.fromEntries(this.settings.settings_schema.list_keys()
            .sort().map(key => [key, this.settings.get_value(key).print(true)]));
        return {mode, spans, geometry, settings};
    }

    disable() {
        if (this.enabled) this.extension.disable();
        global.context.unsafe_mode = false;
        delete global.sscBench;
    }
}
