import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import {bindAdjustment, bindStringList} from '../../dist/preferences/widgets.js';

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

// Exercise real schema defaults and persisted overrides, not a settings mock.
const {readShadowConfig, readConfig} = await import('../../dist/settings/config.js');
function shadowEqual(actual, expected) {
    equal(JSON.stringify(actual), JSON.stringify(expected));
}
equal(settings.get_int('shadow-strength'), 100);
equal(settings.get_boolean('shadow-advanced'), false);
for (const focused of [true, false]) {
    settings.set_boolean('shadow-advanced', false);
    settings.set_int('shadow-strength', 100);
    const preset = readShadowConfig(settings, focused);
    shadowEqual(preset, focused
        ? {opacity: 115, blur: 23, spread: -2, xOffset: 0, yOffset: 0}
        : {opacity: 18, blur: 13, spread: 7, xOffset: 0, yOffset: 0});
    settings.set_boolean('shadow-advanced', true);
    shadowEqual(readShadowConfig(settings, focused), preset);

    const prefix = focused ? 'focused-shadow' : 'unfocused-shadow';
    const manual = {opacity: 77, blur: 18, spread: -3, xOffset: -5, yOffset: 7};
    for (const [suffix, value] of [
        ['opacity', 77], ['blur', 18], ['spread', -3], ['x-offset', -5], ['y-offset', 7],
    ]) settings.set_int(`${prefix}-${suffix}`, value);

    for (const strength of [0, 25, 50, 100, 150, 200]) {
        settings.set_int('shadow-strength', strength);
        shadowEqual(readShadowConfig(settings, focused), manual);
        settings.set_boolean('shadow-advanced', false);
        const basic = readShadowConfig(settings, focused);
        if (strength === 0) equal(basic.opacity, 0);
        if (strength === 100) shadowEqual(basic, preset);
        equal(basic.xOffset, 0);
        equal(basic.yOffset, 0);
        settings.set_boolean('shadow-advanced', true);
        shadowEqual(readShadowConfig(settings, focused), manual);
        equal(settings.get_int('shadow-strength'), strength);
        settings.set_int(`${prefix}-opacity`, 0);
        settings.set_boolean('shadow-advanced', false);
        shadowEqual(readShadowConfig(settings, focused), basic);
        settings.set_int(`${prefix}-opacity`, 77);
        settings.set_boolean('shadow-advanced', true);
    }

    settings.set_boolean('shadow-advanced', false);
    let previous = {opacity: -1, blur: 0, spread: -Infinity};
    for (let strength = 0; strength <= 200; strength++) {
        settings.set_int('shadow-strength', strength);
        const current = readShadowConfig(settings, focused);
        for (const key of ['opacity', 'blur', 'spread']) {
            if (current[key] < previous[key]) throw new Error(`Non-monotonic ${key} at ${strength}`);
        }
        if (current.opacity > 255) throw new Error('Opacity out of range');
        previous = current;
    }
}
settings.set_boolean('keep-shadow-maximized', true);
equal(readConfig(settings).keepShadowMaximized, false);
settings.set_boolean('shadow-advanced', true);
equal(readConfig(settings).keepShadowMaximized, true);
print('Basic and advanced shadows retain independent values; 100% matches the preset and strength is monotonic.');

// Use real TextBuffer signals: replacing text first emits an empty buffer.
settings.set_strv('blacklist', ['first.app']);
const buffer = new Gtk.TextBuffer();
const unbindList = bindStringList(settings, 'blacklist', buffer);
const lists = [];
const listConnection = settings.connect('changed::blacklist', () => {
    lists.push(settings.get_strv('blacklist'));
});
settings.set_strv('blacklist', ['second.app', 'third.app']);
equal(JSON.stringify(lists), JSON.stringify([['second.app', 'third.app']]));
equal(buffer.text, 'second.app\nthird.app');
// Whitespace is normalized in settings without rewriting text or moving the cursor.
buffer.text = '  second.app  \n\nthird.app\n';
lists.length = 0;
buffer.place_cursor(buffer.get_iter_at_offset(4));
buffer.insert_at_cursor('X', -1);
equal(buffer.text, '  seXcond.app  \n\nthird.app\n');
equal(buffer.cursor_position, 5);
equal(JSON.stringify(settings.get_strv('blacklist')), JSON.stringify(['seXcond.app', 'third.app']));
equal(lists.some(list => list.length === 0), false);
unbindList();
settings.set_strv('blacklist', ['external.app']);
equal(buffer.text, '  seXcond.app  \n\nthird.app\n');
buffer.text = 'detached.app';
equal(JSON.stringify(settings.get_strv('blacklist')), JSON.stringify(['external.app']));
settings.disconnect(listConnection);
print('Exception editor avoids feedback writes and preserves in-progress text and cursor.');
