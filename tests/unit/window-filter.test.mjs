import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../../dist/shell/window-filter.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replaceAll('export ', '');

function setup() {
    const reads = [];
    class Cancellable {
        cancelled = false;
        cancel() { this.cancelled = true; }
        is_cancelled() { return this.cancelled; }
    }
    const api = vm.runInNewContext(`${source}\n({shouldSkip, clearWindowFilterCache, trackWindowFilter, forgetWindowFilter});`, {
        TextDecoder,
        Meta: {WindowType: {NORMAL: 0, DIALOG: 1, MODAL_DIALOG: 2}},
        Shell: {WindowTracker: {get_default: () => null}},
        Gio: {Cancellable, File: {new_for_path: path => ({
            load_contents_async(cancellable, callback) {
                reads.push({path, cancellable, finish: maps => callback(this, maps)});
            },
            load_contents_finish(maps) {
                if (maps instanceof Error) throw maps;
                return [true, new TextEncoder().encode(maps)];
            },
        })}},
    });
    const win = {windowType: 0, get_pid: () => 123};
    api.trackWindowFilter(win);
    const config = {blacklist: [], skipLibadwaitaApp: true, skipLibhandyApp: false};
    return {...api, reads, win, config};
}

test('toolkit reads are asynchronous, shared by PID, and cached on completion', () => {
    const state = setup();
    let refreshes = 0;
    const skip = () => state.shouldSkip(state.win, state.config, false, () => refreshes++);
    assert.equal(skip(), true, 'Keep native appearance while detection is pending');
    assert.equal(skip(), true);
    assert.equal(state.reads.length, 1);
    assert.equal(refreshes, 0);
    state.reads[0].finish('/usr/lib/libadwaita-1.so.0');
    assert.equal(refreshes, 1);
    assert.equal(skip(), true);
    assert.equal(state.reads.length, 1);
    assert.equal(state.shouldSkip(state.win, state.config, true), false);
});

test('clearing the cache cancels reads and prevents stale refreshes or cache writes', () => {
    const state = setup();
    let refreshes = 0;
    const skip = () => state.shouldSkip(state.win, state.config, false, () => refreshes++);
    skip();
    state.clearWindowFilterCache();
    assert.equal(state.reads[0].cancellable.is_cancelled(), true);
    state.trackWindowFilter(state.win);
    skip();
    state.reads[0].finish('/usr/lib/libadwaita-1.so.0');
    assert.equal(refreshes, 0);
    state.reads[1].finish('/usr/lib/libgtk-3.so.0');
    assert.equal(refreshes, 1);
    assert.equal(skip(), false);
    assert.equal(state.reads.length, 2);
});

test('unreadable process maps fall back without retrying on every refresh', () => {
    const state = setup();
    state.shouldSkip(state.win, state.config, false);
    state.reads[0].finish(new Error('Process exited'));
    assert.equal(state.shouldSkip(state.win, state.config, false), false);
    assert.equal(state.reads.length, 1);
});

for (const pending of [false, true]) {
    test(`last window evicts toolkit identity, including pending read: ${pending}`, () => {
        const state = setup();
        const sibling = {...state.win};
        state.trackWindowFilter(state.win); // Tracking is idempotent.
        state.trackWindowFilter(sibling);
        let refreshes = 0;
        const skip = win => state.shouldSkip(win, state.config, false, () => refreshes++);
        skip(state.win);
        if (!pending) state.reads[0].finish('/usr/lib/libadwaita-1.so.0');
        state.forgetWindowFilter(state.win);
        skip(sibling);
        assert.equal(state.reads.length, 1, 'A sibling retains the shared read/result');
        assert.equal(state.reads[0].cancellable.is_cancelled(), false);
        state.forgetWindowFilter(sibling);
        skip(sibling);
        assert.equal(state.reads.length, 1, 'Closing actor cannot restart toolkit detection');
        const replacement = {...state.win};
        state.trackWindowFilter(replacement);
        skip(replacement);
        assert.equal(state.reads.length, 2, 'Reused PID must be detected again');
        if (pending) {
            assert.equal(state.reads[0].cancellable.is_cancelled(), true);
            state.reads[0].finish('/usr/lib/libadwaita-1.so.0');
            assert.equal(refreshes, 0, 'Closed window cannot refresh or cache stale results');
            skip(replacement);
            assert.equal(state.reads.length, 2, 'Late callback cannot remove the replacement read');
        }
        state.reads[1].finish('/usr/lib/libgtk-3.so.0');
        assert.equal(skip(replacement), false);
        state.forgetWindowFilter(sibling); // Actor destruction after unmanaged.
        assert.equal(skip(replacement), false);
        assert.equal(state.reads.length, 2);
    });
}
