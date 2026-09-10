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

const SHADOW_KEYS = {
    focused: {
        opacity: 'focused-shadow-opacity', blur: 'focused-shadow-blur',
        spread: 'focused-shadow-spread', xOffset: 'focused-shadow-x-offset',
        yOffset: 'focused-shadow-y-offset',
    },
    unfocused: {
        opacity: 'unfocused-shadow-opacity', blur: 'unfocused-shadow-blur',
        spread: 'unfocused-shadow-spread', xOffset: 'unfocused-shadow-x-offset',
        yOffset: 'unfocused-shadow-y-offset',
    },
} as const;

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
    const keys = focused ? SHADOW_KEYS.focused : SHADOW_KEYS.unfocused;
    if (settings.get_boolean(SettingsKey.shadowAdvanced)) {
        return {
            opacity: settings.get_int(keys.opacity), blur: settings.get_int(keys.blur),
            spread: settings.get_int(keys.spread), xOffset: settings.get_int(keys.xOffset),
            yOffset: settings.get_int(keys.yOffset),
        };
    }

    // Schema defaults are the calibrated preset, independent of saved advanced
    // values. Keep 100% exact without duplicating the calibration constants.
    const preset = (key: string) => settings.get_default_value(key)!.get_int32();
    const amount = settings.get_int(SettingsKey.shadowStrength) / 100;
    const opacity = preset(keys.opacity) / 255;
    return {
        // Optical density grows steadily while alpha approaches 1 gradually.
        opacity: Math.round(255 * (1 - Math.pow(1 - opacity, amount))),
        blur: preset(keys.blur) * (0.75 + 0.25 * amount),
        spread: preset(keys.spread) + 2 * (amount - 1),
        xOffset: preset(keys.xOffset),
        yOffset: preset(keys.yOffset),
    };
}

export interface ExtensionConfig extends CornerConfig {
    customShadow: boolean;
    keepShadowMaximized: boolean;
    focusedShadow: ShadowConfig;
    unfocusedShadow: ShadowConfig;
    blacklist: string[];
    whitelistMode: boolean;
    skipLibadwaitaApp: boolean;
    skipLibhandyApp: boolean;
}

export function readConfig(settings: Gio.Settings): ExtensionConfig {
    return {
        ...readCornerConfig(settings),
        customShadow: settings.get_boolean(SettingsKey.customShadow),
        keepShadowMaximized: settings.get_boolean(SettingsKey.shadowAdvanced) &&
            settings.get_boolean(SettingsKey.keepShadowMaximized),
        focusedShadow: readShadowConfig(settings, true),
        unfocusedShadow: readShadowConfig(settings, false),
        blacklist: settings.get_strv(SettingsKey.blacklist),
        whitelistMode: settings.get_boolean(SettingsKey.whitelistMode),
        skipLibadwaitaApp: settings.get_boolean(SettingsKey.skipLibadwaitaApp),
        skipLibhandyApp: settings.get_boolean(SettingsKey.skipLibhandyApp),
    };
}
