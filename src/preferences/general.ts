import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {bindAdjustment, bindBoolean as bindBool, createSpinRow as makeSpinRow} from './widgets.js';

export function addCornerPreferences(win: Adw.PreferencesWindow, settings: Gio.Settings): void {
        // ── Page 1: Corners ─────────────────────────────────────────────────
        const cornersPage = new Adw.PreferencesPage({
            title: _('Corners'),
            icon_name: 'emblem-photos-symbolic',
        });
        win.add(cornersPage);

        // ── Group: Corner shape ──────────────────────────────────────────────
        const shapeGroup = new Adw.PreferencesGroup({
            title:       _('Corner shape'),
            description: _('Controls the radius and curvature of the rounded corners.'),
        });
        cornersPage.add(shapeGroup);

        // Radius
        const radiusRow = makeSpinRow(
            _('Radius'), _('Corner radius in logical pixels'), 1, 50, 1);
        bindAdjustment(settings, 'corner-radius', radiusRow.adj);
        shapeGroup.add(radiusRow.row);

        // Smoothing (squircle)
        const smoothRow = makeSpinRow(
            _('Smoothing'),
            _('0 = perfect circle · 1 = squircle (super-ellipse)'),
            0, 1, 0.05, 2);
        bindAdjustment(settings, 'smoothing', smoothRow.adj);
        shapeGroup.add(smoothRow.row);

        // ── Group: Padding ───────────────────────────────────────────────────
        const padGroup = new Adw.PreferencesGroup({
            title:       _('Clip padding'),
            description: _('Extra space (px) between the window edge and the clip boundary.'),
        });
        cornersPage.add(padGroup);

        const fillRow = new Adw.SwitchRow({
            title: _('Fill clipped edges'),
            subtitle: _('Extend interior pixels over the padding to preserve the window size.'),
        });
        bindBool(settings, 'fill-padding', fillRow);
        padGroup.add(fillRow);

        for (const [side, key] of [
            [_('Top'),    'padding-top'],
            [_('Bottom'), 'padding-bottom'],
            [_('Left'),   'padding-left'],
            [_('Right'),  'padding-right'],
        ]) {
            const r = makeSpinRow(side, '', 0, 100, 1);
            bindAdjustment(settings, key, r.adj);
            padGroup.add(r.row);
        }

        // ── Group: Border ────────────────────────────────────────────────────
        const borderGroup = new Adw.PreferencesGroup({
            title:       _('Border'),
            description: _('Positive width = inner border · Negative = outer border · 0 = none'),
        });
        cornersPage.add(borderGroup);

        const bwRow = makeSpinRow(_('Width'), '', -15, 15, 1);
        bindAdjustment(settings, 'border-width', bwRow.adj);
        borderGroup.add(bwRow.row);

        // Border colour (RGBA via Gtk.ColorButton)
        const colorRow = new Adw.ActionRow({ title: _('Colour') });
        const colorBtn  = new Gtk.ColorButton({
            use_alpha: true,
            valign:    Gtk.Align.CENTER,
        });
        // Read initial colour from settings
        const updateColorBtn = () => {
            const rgba    = new Gdk.RGBA();
            rgba.red   = settings.get_double('border-red');
            rgba.green = settings.get_double('border-green');
            rgba.blue  = settings.get_double('border-blue');
            rgba.alpha = settings.get_double('border-alpha');
            colorBtn.set_rgba(rgba);
        };
        updateColorBtn();
        colorBtn.connect('color-set', () => {
            const c = colorBtn.get_rgba();
            settings.set_double('border-red',   c.red);
            settings.set_double('border-green', c.green);
            settings.set_double('border-blue',  c.blue);
            settings.set_double('border-alpha', c.alpha);
        });
        for (const k of ['border-red', 'border-green', 'border-blue', 'border-alpha'])
            settings.connect(`changed::${k}`, updateColorBtn);
        colorRow.add_suffix(colorBtn);
        borderGroup.add(colorRow);

        // ── Group: Behaviour ─────────────────────────────────────────────────
        const behGroup = new Adw.PreferencesGroup({ title: _('Behaviour') });
        cornersPage.add(behGroup);

        const maxRow  = new Adw.SwitchRow({
            title:    _('Keep rounded when maximised'),
            subtitle: _('Show rounded corners even for maximised windows'),
        });
        bindBool(settings, 'keep-rounded-maximized', maxRow);
        behGroup.add(maxRow);

        const fullRow = new Adw.SwitchRow({
            title:    _('Keep rounded when full-screen'),
            subtitle: _('Show rounded corners even in full-screen mode'),
        });
        bindBool(settings, 'keep-rounded-fullscreen', fullRow);
        behGroup.add(fullRow);

}

export function addApplicationPreferences(win: Adw.PreferencesWindow, settings: Gio.Settings): void {
        // ── Page 3: Applications ─────────────────────────────────────────────
        const appsPage = new Adw.PreferencesPage({
            title:     _('Applications'),
            icon_name: 'view-app-grid-symbolic',
        });
        win.add(appsPage);

        // GTK4 integration
        const gtkGroup = new Adw.PreferencesGroup({
            title:       _('GTK4 integration'),
        });
        appsPage.add(gtkGroup);

        const nativeRow = new Adw.SwitchRow({
            title: _('Remove native GTK4 corners'),
            subtitle: _('let Smooth Shell Corners shape GTK4 windows. Restart affected apps after changing this.'),
        });
        bindBool(settings, 'remove-native-radius', nativeRow);
        gtkGroup.add(nativeRow);

        // Keep toolkit-specific exclusions distinct from GTK4 CSS preparation.
        const toolkitGroup = new Adw.PreferencesGroup({
            title:       _('Automatic exclusions'),
            description: _('Leave applications that already draw rounded corners unchanged.'),
        });
        appsPage.add(toolkitGroup);

        const adwRow = new Adw.SwitchRow({
            title: _('Leave libadwaita windows unchanged'),
        });
        bindBool(settings, 'skip-libadwaita-app', adwRow);
        const updateNativeSkip = () => {
            adwRow.sensitive = !settings.get_boolean('remove-native-radius');
            adwRow.subtitle = adwRow.sensitive
                ? _('Use their toolkit-provided corners instead of applying this extension')
                : _('Not applicable while native GTK4 corners are being replaced');
        };
        settings.connect('changed::remove-native-radius', updateNativeSkip);
        updateNativeSkip();
        toolkitGroup.add(adwRow);

        const handyRow = new Adw.SwitchRow({
            title: _('Leave libhandy windows unchanged'),
            subtitle: _('Use their toolkit-provided corners instead of applying this extension'),
        });
        bindBool(settings, 'skip-libhandy-app', handyRow);
        toolkitGroup.add(handyRow);

        // Blacklist / whitelist
        const listGroup = new Adw.PreferencesGroup({
            title:       _('Exceptions list'),
            description: _('Application identifiers, one per line. You can use WM_CLASS, Wayland app IDs, ' +
                           'or desktop file IDs. In normal mode these windows are EXCLUDED; enable ' +
                           'whitelist mode to ONLY apply rounded corners to them.'),
        });
        appsPage.add(listGroup);

        const whitelistRow = new Adw.SwitchRow({
            title:    _('Whitelist mode'),
            subtitle: _('Treat the list below as a whitelist instead of a blacklist'),
        });
        bindBool(settings, 'whitelist-mode', whitelistRow);
        listGroup.add(whitelistRow);

        // Multiline text editor for the blacklist
        const scrolled = new Gtk.ScrolledWindow({
            vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
            min_content_height: 120,
            max_content_height: 240,
            hexpand: true,
        });
        const textView = new Gtk.TextView({
            monospace:     true,
            wrap_mode:     Gtk.WrapMode.NONE,
            top_margin:    6,
            bottom_margin: 6,
            left_margin:   8,
            right_margin:  8,
        });
        scrolled.set_child(textView);

        // Load initial value
        const loadList = () => {
            const list = settings.get_strv('blacklist');
            textView.buffer.text = list.join('\n');
        };
        loadList();

        // Save on buffer change (GTK4 removed focus-out-event)
        textView.buffer.connect('changed', () => {
            const text = textView.buffer.text;
            const list = text.split('\n').map(s => s.trim()).filter(s => s.length > 0);
            settings.set_strv('blacklist', list);
        });

        settings.connect('changed::blacklist', () => {
            const list = settings.get_strv('blacklist');
            const text = list.join('\n');
            if (textView.buffer.text !== text) textView.buffer.text = text;
        });

        const listBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4 });
        listBox.append(scrolled);

        const listExpander = new Adw.ExpanderRow({ title: _('Exception list') });
        // Use the Adw.ExpanderRow's add_row to add a wrapped child
        const wrap = new Adw.ActionRow();
        wrap.set_child(listBox);
        listExpander.add_row(wrap);
        listGroup.add(listExpander);

}
export function addAboutPreferences(
    win: Adw.PreferencesWindow,
    metadata: {name: string; url?: string; 'version-name'?: string},
    settings: Gio.Settings,
): void {
        // ── Page 4: About ────────────────────────────────────────────────────
        const aboutPage = new Adw.PreferencesPage({
            title:     _('About'),
            icon_name: 'help-about-symbolic',
        });
        win.add(aboutPage);

        const aboutGroup = new Adw.PreferencesGroup();
        aboutPage.add(aboutGroup);

        const nameRow = new Adw.ActionRow({ title: metadata.name });
        nameRow.add_suffix(new Gtk.Label({
            label:  metadata['version-name'] ?? '1.0',
            xalign: 1,
            valign: Gtk.Align.CENTER,
        }));
        aboutGroup.add(nameRow);

        const srcRow = new Adw.ActionRow({
            title:    _('Source code'),
            subtitle: metadata.url ?? '',
            activatable: true,
        });
        srcRow.add_suffix(new Gtk.Image({ icon_name: 'go-next-symbolic' }));
        srcRow.connect('activated', () => {
            const url = metadata.url;
            if (url) Gtk.show_uri(win, url, Gdk.CURRENT_TIME);
        });
        aboutGroup.add(srcRow);

        // Debug toggle
        const debugGroup = new Adw.PreferencesGroup({ title: _('Developer') });
        aboutPage.add(debugGroup);
        const debugRow = new Adw.SwitchRow({
            title:    _('Debug logging'),
            subtitle: _('Print verbose logs to the GNOME Shell journal'),
        });
        bindBool(settings, 'debug-mode', debugRow);
        debugGroup.add(debugRow);
}
