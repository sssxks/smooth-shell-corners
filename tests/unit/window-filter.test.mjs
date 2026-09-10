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
    const api = vm.runInNewContext(`${source}\n({shouldSkip, clearWindowFilterCache});`, {
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
