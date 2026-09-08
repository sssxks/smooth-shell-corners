import Adw from 'gi://Adw';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    addAboutPreferences,
    addApplicationPreferences,
    addCornerPreferences,
} from './general.js';
import {addShadowPreferences} from './shadows.js';

export default class SmoothShellCornersPreferences extends ExtensionPreferences {
    override async fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
        const settings = this.getSettings();
        window.set_default_size(680, 720);
        addCornerPreferences(window, settings);
        addShadowPreferences(window, settings);
        addApplicationPreferences(window, settings);
        addAboutPreferences(window, this.metadata, settings);
    }
}
