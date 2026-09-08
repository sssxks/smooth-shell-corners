import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {bindAdjustmentInt as bindAdjInt, bindBoolean as bindBool, createSpinRow as makeSpinRow} from './widgets.js';

function makeShadowGroup(title: string, prefix: string, settings: Gio.Settings) {
    const group = new Adw.PreferencesGroup({title});
    const rows = [
        ['Opacity', 'opacity', 0, 255],
        ['Blur', 'blur', 0, 120],
        ['Spread', 'spread', -50, 50],
        ['X offset', 'x-offset', -100, 100],
        ['Y offset', 'y-offset', -100, 100],
    ] as const;

    for (const [titleText, suffix, minimum, maximum] of rows) {
        const item = makeSpinRow(_(titleText), '', minimum, maximum, 1);
        bindAdjInt(settings, `${prefix}-${suffix}`, item.adj);
        group.add(item.row);
    }
    return group;
}

export function addShadowPreferences(win: Adw.PreferencesWindow, settings: Gio.Settings): void {
        // ── Page 2: Shadow ───────────────────────────────────────────────────
        const shadowPage = new Adw.PreferencesPage({
            title:     _('Shadow'),
            icon_name: 'weather-overcast-symbolic',
        });
        win.add(shadowPage);

        // Enable / disable custom shadow
        const shadowToggleGroup = new Adw.PreferencesGroup();
        shadowPage.add(shadowToggleGroup);

        const shadowRow = new Adw.SwitchRow({
            title:    _('Custom shadow'),
            subtitle: _('Replace the rectangular GNOME shadow with a rounded one'),
        });
        bindBool(settings, 'custom-shadow', shadowRow);
        shadowToggleGroup.add(shadowRow);

        const keepShadowRow = new Adw.SwitchRow({
            title:    _('Shadow when maximised'),
            subtitle: _('Keep the custom shadow when the window is maximised or full-screen'),
        });
        bindBool(settings, 'keep-shadow-maximized', keepShadowRow);
        shadowToggleGroup.add(keepShadowRow);

        // Focused / unfocused shadow settings
        shadowPage.add(makeShadowGroup(_('Focused window'),   'focused-shadow',   settings));
        shadowPage.add(makeShadowGroup(_('Unfocused window'), 'unfocused-shadow', settings));

}

