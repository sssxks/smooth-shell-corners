import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {SettingsKey} from '../settings/keys.js';

import {bindAdjustment, bindBoolean as bindBool, createSpinRow as makeSpinRow} from './widgets.js';

function makeShadowGroup(title: string, prefix: string, settings: Gio.Settings) {
    const group = new Adw.PreferencesGroup({
        title,
    });
    const rows = [
        ['Opacity', 'opacity', 0, 255],
        ['Blur', 'blur', 0, 120],
        ['Spread', 'spread', -50, 50],
        ['X offset', 'x-offset', -100, 100],
        ['Y offset', 'y-offset', -100, 100],
    ] as const;

    for (const [titleText, suffix, minimum, maximum] of rows) {
        const item = makeSpinRow(_(titleText), '', minimum, maximum, 1);
        bindAdjustment(settings, `${prefix}-${suffix}`, item.adj);
        group.add(item.row);
    }
    return group;
}

export function addShadowPreferences(win: Adw.PreferencesWindow, settings: Gio.Settings): void {
    const shadowPage = new Adw.PreferencesPage({
        title: _('Shadow'), icon_name: 'weather-overcast-symbolic',
    });
    win.add(shadowPage);

    const toggleGroup = new Adw.PreferencesGroup();
    shadowPage.add(toggleGroup);
    const shadowRow = new Adw.SwitchRow({
        title: _('Custom shadow'),
        subtitle: _('Replace the native shadow with a rounded one'),
    });
    bindBool(settings, SettingsKey.customShadow, shadowRow);
    toggleGroup.add(shadowRow);

    const controlsGroup = new Adw.PreferencesGroup();
    shadowPage.add(controlsGroup);
    const strengthRow = new Adw.ActionRow({
        title: _('Shadow strength'),
        subtitle: _('0% = none, 100% ≈ native'),
    });
    const strength = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 0, 200, 1);
    strength.set_size_request(220, -1);
    strength.valign = Gtk.Align.CENTER;
    strength.draw_value = true;
    strength.digits = 0;
    strength.set_format_value_func((_scale, value) => `${Math.round(value)}%`);
    strength.add_mark(100, Gtk.PositionType.BOTTOM, null);
    bindAdjustment(settings, SettingsKey.shadowStrength, strength.get_adjustment());
    strengthRow.add_suffix(strength);
    strengthRow.activatable_widget = strength;
    controlsGroup.add(strengthRow);
    settings.bind(SettingsKey.shadowAdvanced, strengthRow, 'visible',
        Gio.SettingsBindFlags.GET | Gio.SettingsBindFlags.INVERT_BOOLEAN);

    const advanced = new Adw.SwitchRow({
        title: _('Advanced settings'),
        subtitle: _('Tune separate parameters instead of shadow strength'),
    });
    bindBool(settings, SettingsKey.shadowAdvanced, advanced);
    controlsGroup.add(advanced);
    settings.bind(SettingsKey.customShadow, controlsGroup, 'sensitive', Gio.SettingsBindFlags.GET);

    const behaviorGroup = new Adw.PreferencesGroup();
    const keepShadowRow = new Adw.SwitchRow({
        title: _('Shadow when maximised'),
        subtitle: _('Keep the custom shadow when the window is maximised or full-screen'),
    });
    bindBool(settings, SettingsKey.keepShadowMaximized, keepShadowRow);
    behaviorGroup.add(keepShadowRow);

    for (const group of [
        makeShadowGroup(_('Focused window'), 'focused-shadow', settings),
        makeShadowGroup(_('Unfocused window'), 'unfocused-shadow', settings),
        behaviorGroup,
    ]) {
        settings.bind(SettingsKey.shadowAdvanced, group, 'visible', Gio.SettingsBindFlags.GET);
        settings.bind(SettingsKey.customShadow, group, 'sensitive', Gio.SettingsBindFlags.GET);
        shadowPage.add(group);
    }
}
