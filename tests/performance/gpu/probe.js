import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const sleep = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms,
    () => { resolve(); return GLib.SOURCE_REMOVE; }));
const windows = () => global.get_window_actors()
    .filter(a => a.metaWindow.title?.startsWith('SSC GPU '))
    .sort((a, b) => a.metaWindow.title.localeCompare(b.metaWindow.title));

export default class Probe {
    async enable() {
        global.context.unsafe_mode = true;
        const path = GLib.getenv('SSC_GPU_CHECKOUT') + '/dist';
        const {default: Extension} = await import(Gio.File.new_for_path(path + '/extension.js').get_uri());
        this.extension = new Extension({uuid: 'smooth-shell-corners@xks', name: 'Smooth Shell Corners',
            path, dir: Gio.File.new_for_path(path), 'settings-schema': 'org.gnome.shell.extensions.smooth-shell-corners'});
        this.settings = this.extension.getSettings();
        // Pin rendering inputs across the introduction of basic/advanced mode.
        // Skip only keys absent from an older schema, not values that fail to set.
        const settings = {
            'corner-radius': 8, smoothing: 1, 'fill-padding': true,
            'padding-top': 1, 'padding-bottom': 1, 'padding-left': 1, 'padding-right': 1,
            'remove-native-radius': false, 'skip-libadwaita-app': false, 'skip-libhandy-app': false,
            blacklist: [], 'whitelist-mode': false, 'border-width': 0,
            'keep-rounded-maximized': false, 'keep-rounded-fullscreen': false,
            'custom-shadow': false, 'keep-shadow-maximized': false,
            'shadow-advanced': true, 'shadow-strength': 100,
        };
        for (const state of ['focused', 'unfocused'])
            Object.assign(settings, Object.fromEntries(Object.entries({opacity: 115, blur: 24, spread: 7,
                'x-offset': 0, 'y-offset': 0}).map(([k, v]) => [`${state}-shadow-${k}`, v])));
        for (const [key, value] of Object.entries(settings)) {
            if (!this.settings.settings_schema.has_key(key)) continue;
            this.settings.set_value(key, new GLib.Variant(this.settings.get_value(key).get_type_string(), value));
        }
        this.pid = new Gio.Credentials().get_unix_pid();
        this.enabled = false;
        this.frameTimes = [];
        this.paint = global.stage.connect('before-paint', () => this.frameTimes.push(GLib.get_monotonic_time() * 1000));
        Main.overview.hide();
        global.sscGpu = this;
    }
    start(mode) {
        this.result = null;
        this.run(mode).then(value => {this.result = value;}, error => {this.result = {error: String(error.stack)};});
        return true;
    }
    async run(mode) {
        if (this.enabled) this.extension.disable();
        this.enabled = mode !== 'off';
        this.settings.set_boolean('custom-shadow', mode === 'shadows');
        if (this.enabled) this.extension.enable();
        const actors = windows();
        if (actors.length !== 4) throw new Error('Expected four GPU fixture windows');
        actors.forEach((a, i) => a.metaWindow.move_resize_frame(false,
            30 + (i % 2) * 1200, 40 + Math.floor(i / 2) * 700, 1000, 650));
        actors[3].metaWindow.activate(global.get_current_time());
        await sleep(1000);
        const monitor = Main.layoutManager.monitors[0];
        if (monitor.width !== 2560 || monitor.height !== 1440) throw new Error('Unexpected monitor geometry');
        for (const actor of actors) {
            const fx = actor.get_effect('ssc-rounded-corners');
            if (!!fx !== this.enabled || (fx && fx._shadowEnabled !== (mode === 'shadows')))
                throw new Error('Fixture effect/shadow state mismatch');
            const rect = actor.metaWindow.get_frame_rect();
            if (rect.width !== 1000 || rect.height !== 650) throw new Error('Unexpected window size');
        }
        const records = [];
        for (const workload of ['idle', 'move', 'damage']) {
            let timer = 0, tick = 0;
            if (workload !== 'idle') timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
                if (workload === 'move') actors[0].metaWindow.move_frame(false, 30 + (tick++ % 100), 40);
                else actors[0].queue_redraw();
                return GLib.SOURCE_CONTINUE;
            });
            await sleep(1000);
            this.frameTimes = [];
            const start = GLib.get_monotonic_time() * 1000;
            await sleep(4000);
            const end = GLib.get_monotonic_time() * 1000;
            records.push({mode, workload, start, end, frames: this.frameTimes});
            if (timer) GLib.source_remove(timer);
        }
        // Drain outstanding asynchronous GPU queries outside all timed spans.
        for (let i = 0; i < 4; i++) {global.stage.queue_redraw(); await sleep(100);}
        return {records, settings: Object.fromEntries(this.settings.settings_schema.list_keys().sort()
            .map(k => [k, this.settings.get_value(k).print(true)])),
            geometry: actors.map(a => {const r = a.metaWindow.get_frame_rect(); return [r.x, r.y, r.width, r.height];})};
    }
    disable() {
        if (this.enabled) this.extension.disable();
        if (this.paint) global.stage.disconnect(this.paint);
        global.context.unsafe_mode = false;
        delete global.sscGpu;
    }
}
