import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import {bindAdjustment} from '../../dist/preferences/widgets.js';

const schema = Gio.SettingsSchemaSource.new_from_directory(
    Gio.File.new_for_uri(import.meta.url).get_parent().resolve_relative_path('../../dist/schemas').get_path(),
    Gio.SettingsSchemaSource.get_default(), false,
).lookup('org.gnome.shell.extensions.smooth-shell-corners', false);
const settings = new Gio.Settings({settings_schema: schema, backend: Gio.memory_settings_backend_new()});

function equal(actual, expected) {
    if (actual !== expected) throw new Error(`${actual} !== ${expected}`);
}

for (const [key, read, write, initial, fromWidget, fromSettings] of [
    ['border-width', () => settings.get_int('border-width'), v => settings.set_int('border-width', v), -2, 4, -5],
    ['smoothing', () => settings.get_double('smoothing'), v => settings.set_double('smoothing', v), 0.25, 0.75, 0.5],
]) {
    write(initial);
    const adjustment = new Gtk.Adjustment({lower: -15, upper: 15});
    bindAdjustment(settings, key, adjustment);
    equal(adjustment.value, initial);
    let changes = 0;
    const id = settings.connect(`changed::${key}`, () => changes++);
    adjustment.value = fromWidget;
    equal(read(), fromWidget);
    equal(changes, 1);
    write(fromSettings);
    equal(adjustment.value, fromSettings);
    equal(changes, 2);
    adjustment.value = fromSettings;
    equal(changes, 2);
    settings.disconnect(id);
    Gio.Settings.unbind(adjustment, 'value');
}
print('Real GSettings/Gtk bindings preserve integers, fractions and bidirectional updates.');
