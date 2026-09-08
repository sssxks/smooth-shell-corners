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

