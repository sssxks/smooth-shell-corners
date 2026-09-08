import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

export function bindAdjustmentInt(
    settings: Gio.Settings,
    key: string,
    adjustment: Gtk.Adjustment,
): void {
    adjustment.value = settings.get_int(key);
    adjustment.connect('value-changed', current =>
        settings.set_int(key, current.value));
    settings.connect(`changed::${key}`, () => {
        const value = settings.get_int(key);
        if (adjustment.value !== value)
            adjustment.value = value;
    });
}

export function bindAdjustmentDouble(
    settings: Gio.Settings,
    key: string,
    adjustment: Gtk.Adjustment,
): void {
    adjustment.value = settings.get_double(key);
    adjustment.connect('value-changed', current =>
        settings.set_double(key, current.value));
    settings.connect(`changed::${key}`, () => {
        const value = settings.get_double(key);
        if (Math.abs(adjustment.value - value) > 1e-9)
            adjustment.value = value;
    });
}

export function bindBoolean(settings: Gio.Settings, key: string, widget: any): void {
    settings.bind(key, widget, 'active', Gio.SettingsBindFlags.DEFAULT);
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

