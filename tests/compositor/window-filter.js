import Gio from 'gi://Gio';
import {readConfig} from '../../dist/settings/config.js';
import {clearWindowFilterCache, trackWindowFilter, getWindowIdentifiers, shouldSkip} from '../../dist/shell/window-filter.js';

export function checkWindowFilter(win, settings) {
    const config = readConfig(settings);
    const read = Gio.File.prototype.load_contents_async;
    let reads = 0;
    Gio.File.prototype.load_contents_async = function (...args) {
        if (this.get_path().startsWith('/proc/')) reads++;
        return read.apply(this, args);
    };
    function check(condition, message) {
        if (!condition) throw new Error(message);
    }
    try {
        clearWindowFilterCache();
        trackWindowFilter(win);
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
        Gio.File.prototype.load_contents_async = read;
        clearWindowFilterCache();
    }
}
