import GLib from 'gi://GLib';
import {readConfig} from '../../dist/settings/config.js';
import {clearWindowFilterCache, getWindowIdentifiers, shouldSkip} from '../../dist/shell/window-filter.js';

export function checkWindowFilter(win, settings) {
    const config = readConfig(settings);
    const read = GLib.file_get_contents;
    let reads = 0;
    GLib.file_get_contents = path => {
        if (path.startsWith('/proc/')) reads++;
        return read(path);
    };
    function check(condition, message) {
        if (!condition) throw new Error(message);
    }
    try {
        clearWindowFilterCache();
        check(!shouldSkip(win, config, false), 'Normal fixture is eligible');
        check(reads === 0, 'Disabled toolkit filters must not read proc');
        const identifiers = getWindowIdentifiers(win);
        check(identifiers.length > 0, 'Real window exposes identifiers');
        const excluded = {...config, blacklist: identifiers, skipLibadwaitaApp: true};
        check(shouldSkip(win, excluded, false), 'Blacklist excludes the real window');
        check(!shouldSkip(win, {...excluded, whitelistMode: true}, false), 'Explicit whitelist wins');
        check(reads === 0, 'Explicit filters must not inspect toolkit libraries');
        shouldSkip(win, {...config, skipLibadwaitaApp: true}, false);
        check(reads === 1, 'Enabled toolkit filter inspects process');
        shouldSkip(win, {...config, skipLibadwaitaApp: true}, false);
        check(reads === 1, 'Toolkit detection is cached');
        return true;
    } finally {
        GLib.file_get_contents = read;
        clearWindowFilterCache();
    }
}
