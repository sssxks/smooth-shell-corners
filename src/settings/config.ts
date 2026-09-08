import Gio from 'gi://Gio';

import {SettingsKey} from './keys.js';

export interface PaddingConfig {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

export interface CornerConfig {
    cornerRadius: number;
    smoothing: number;
    fillPadding: boolean;
    padding: PaddingConfig;
    borderWidth: number;
    borderColor: [number, number, number, number];
    keepRoundedMaximized: boolean;
    keepRoundedFullscreen: boolean;
}

export interface ShadowConfig {
    opacity: number;
    blur: number;
    spread: number;
    xOffset: number;
    yOffset: number;
}

export function readCornerConfig(settings: Gio.Settings): CornerConfig {
    return {
        cornerRadius: settings.get_int(SettingsKey.cornerRadius),
        smoothing: settings.get_double(SettingsKey.smoothing),
        fillPadding: settings.get_boolean(SettingsKey.fillPadding),
        padding: {
            top: settings.get_int(SettingsKey.paddingTop),
            bottom: settings.get_int(SettingsKey.paddingBottom),
            left: settings.get_int(SettingsKey.paddingLeft),
            right: settings.get_int(SettingsKey.paddingRight),
        },
        borderWidth: settings.get_int(SettingsKey.borderWidth),
        borderColor: [
            settings.get_double(SettingsKey.borderRed),
            settings.get_double(SettingsKey.borderGreen),
            settings.get_double(SettingsKey.borderBlue),
            settings.get_double(SettingsKey.borderAlpha),
        ],
        keepRoundedMaximized: settings.get_boolean(SettingsKey.keepRoundedMaximized),
        keepRoundedFullscreen: settings.get_boolean(SettingsKey.keepRoundedFullscreen),
    };
}

export function readShadowConfig(settings: Gio.Settings, focused: boolean): ShadowConfig {
    const prefix = focused ? 'focused-shadow' : 'unfocused-shadow';
    return {
        opacity: settings.get_int(`${prefix}-opacity`),
        blur: settings.get_int(`${prefix}-blur`),
        spread: settings.get_int(`${prefix}-spread`),
        xOffset: settings.get_int(`${prefix}-x-offset`),
        yOffset: settings.get_int(`${prefix}-y-offset`),
    };
}
