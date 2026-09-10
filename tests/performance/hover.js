import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Probe from './probe.js';

const sleep = ms => new Promise(resolve => GLib.timeout_add(
    GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));
const now = () => GLib.get_monotonic_time() / 1000;
const previews = actor => {
    if (actor.metaWindow?.title?.startsWith('SSC benchmark ') && actor.window_container)
        return [actor];
    return actor.get_children().flatMap(previews);
};

export default class HoverProbe extends Probe {
    async run(mode) {
        await this.prepare(mode);
        const pointer = global.stage.get_context().get_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const move = (x, y) => pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
        move(1, 1);
        Main.overview.show();
        await sleep(1000);
        const targets = previews(global.stage).sort((a, b) => a.metaWindow.title.localeCompare(b.metaWindow.title));
        if (targets.length !== 6) throw new Error(`Expected six previews, got ${targets.length}`);
        const samples = [];
        for (const interval of [40, 2]) {
            for (const target of targets) {
                move(1, 100);
                await sleep(400);
                const [x, y] = target.get_transformed_position();
                const [w, h] = target.get_transformed_size();
                const tx = x + w / 2, ty = y + h / 2;
                let entered = null;
                const connection = target.connect('enter-event', () => {
                    entered ??= now();
                    return Clutter.EVENT_PROPAGATE;
                });
                const start = now();
                let crossed = null;
                for (let step = 1; step <= 30; step++) {
                    const px = 1 + (tx - 1) * step / 30;
                    const py = 100 + (ty - 100) * step / 30;
                    if (crossed === null && px >= x && px <= x + w && py >= y && py <= y + h)
                        crossed = now();
                    move(px, py);
                    await sleep(interval);
                }
                const arrived = now();
                await sleep(600);
                samples.push({interval, title: target.metaWindow.title, crossed: crossed - start,
                    enter: entered === null ? null : entered - start,
                    afterArrival: entered === null ? null : entered - arrived,
                    shown: target._overlayShown, opacity: target._title.opacity,
                    closeOpacity: target._closeButton.opacity, scale: target.window_container.scale_x});
                target.disconnect(connection);
            }
        }
        move(1, 1);
        return {mode, samples};
    }
}
