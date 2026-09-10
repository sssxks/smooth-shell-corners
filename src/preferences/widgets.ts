import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

export function bindAdjustment(
    settings: Gio.Settings,
    key: string,
    adjustment: Gtk.Adjustment,
): void {
    settings.bind(key, adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
}

export function bindBoolean(settings: Gio.Settings, key: string, widget: GObject.Object): void {
    settings.bind(key, widget, 'active', Gio.SettingsBindFlags.DEFAULT);
}

// Keep editor whitespace and cursor position while saving normalized IDs.
// Gtk.TextBuffer replacement emits both deletion and insertion changes.
export function bindStringList(settings: Gio.Settings, key: string, buffer: Gtk.TextBuffer): () => void {
    const normalized = () => buffer.text.split('\n').map(line => line.trim()).filter(Boolean);
    buffer.text = settings.get_strv(key).join('\n');
    let syncing = false;
    const save = buffer.connect('changed', () => {
        if (syncing) return;
        syncing = true;
        try {
            settings.set_strv(key, normalized());
        } finally {
            syncing = false;
        }
    });
    const load = settings.connect(`changed::${key}`, () => {
        if (syncing) return;
        const list = settings.get_strv(key);
        if (JSON.stringify(list) === JSON.stringify(normalized())) return;
        syncing = true;
        try {
            buffer.text = list.join('\n');
        } finally {
            syncing = false;
        }
    });
    return () => {
        buffer.disconnect(save);
        settings.disconnect(load);
    };
}

export function createSpinRow(
    title: string,
    subtitle: string,
    minimum: number,
    maximum: number,
    step: number,
    digits = 0,
) {
    const adjustment = new Gtk.Adjustment({
        lower: minimum,
        upper: maximum,
        step_increment: step,
    });
    const spin = new Gtk.SpinButton({
        adjustment,
        digits,
        valign: Gtk.Align.CENTER,
        width_chars: 5,
    });
    const row = new Adw.ActionRow({title, subtitle});
    row.add_suffix(spin);
    row.activatable_widget = spin;
    return {row, adj: adjustment, spin};
}
