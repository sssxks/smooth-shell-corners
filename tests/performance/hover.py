# /// script
# requires-python = ">=3.13,<3.14"
# dependencies = []
# ///
"""Bazzite/GNOME 50 pointer hover regression: uv run tests/performance/hover.py."""
import json
import os
from pathlib import Path
import select
import shutil
import signal
import subprocess
import tempfile
import time

from run import run, digest, stop, interrupt

repo = Path(__file__).resolve().parents[2]
suite = Path(__file__).resolve().parent


def validate(records):
    failures = []
    for record in records:
        for sample in record['samples']:
            # A path can cross another preview's chrome first (about 80 ms
            # here). Allow 150 ms, but reject the stale-cache stalls.
            if (sample['enter'] is None or sample['enter'] - sample['crossed'] > 150 or
                    not sample['shown'] or sample['opacity'] != 255 or
                    sample['closeOpacity'] != 255 or sample['scale'] <= 1):
                failures.append({'mode': record['mode'], **sample})
    if failures:
        raise AssertionError(f'Hover was delayed or incomplete: {json.dumps(failures)}')


def main():
    # Let the outer timeout and Ctrl+C run the same child-process cleanup.
    signal.signal(signal.SIGTERM, interrupt)
    signal.signal(signal.SIGINT, interrupt)
    version = run(['gnome-shell', '--version'])
    if not version.startswith('GNOME Shell 50.'):
        raise RuntimeError(f'This benchmark targets GNOME 50, found {version}')
    run(['npm', 'run', 'build'], timeout=90)
    commit = run(['git', 'rev-parse', 'HEAD'])
    output = repo / 'tests/artifacts/hover' / (
        time.strftime('%Y%m%d-%H%M%S') + '-' + commit[:10])
    output.mkdir(parents=True, exist_ok=False)
    print(f'Results: {output}', flush=True)
    # Archive exactly what Shell will import, including uncommitted changes.
    shutil.make_archive(str(output / 'extension'), 'zip', repo / 'dist')
    shutil.copytree(suite, output / 'harness', ignore=shutil.ignore_patterns('__pycache__'))
    metadata = {
        'commit': commit, 'git_status': run(['git', 'status', '--short']),
        'extension_sha256': digest(p for p in (repo / 'dist').rglob('*') if p.is_file()),
        'shell': version,
        'protocol_sha256': digest([suite / name for name in
            ['hover.py', 'hover.js', 'probe.js', 'fixture.js', 'run.py']]),
    }
    records = []
    shell = app = None
    with tempfile.TemporaryDirectory(prefix='ssc-benchmark-') as temporary:
        root = Path(temporary)
        env = os.environ | {'GSETTINGS_BACKEND': 'keyfile', 'DISPLAY': '',
                            'WAYLAND_DISPLAY': 'ssc-benchmark', 'GDK_BACKEND': 'wayland'}
        for key, directory in [('XDG_CONFIG_HOME', 'config'), ('XDG_DATA_HOME', 'data'),
                               ('XDG_CACHE_HOME', 'cache'), ('XDG_RUNTIME_DIR', 'runtime')]:
            env[key] = str(root / directory)
            (root / directory).mkdir(mode=0o700)
        probe = root / 'data/gnome-shell/extensions/ssc-benchmark@local'
        probe.mkdir(parents=True)
        (probe / 'metadata.json').write_text(json.dumps({'uuid': 'ssc-benchmark@local',
            'name': 'SSC benchmark', 'description': 'Private benchmark probe', 'shell-version': ['50']}))
        (probe / 'extension.js').write_text(
            f'export {{default}} from {json.dumps((suite / "hover.js").as_uri())};\n')
        run(['gsettings', 'set', 'org.gnome.shell', 'enabled-extensions',
             "['ssc-benchmark@local']"], env)
        run(['gsettings', 'set', 'org.gnome.desktop.interface', 'enable-animations', 'true'], env)
        run(['gsettings', 'set', 'org.gnome.mutter', 'dynamic-workspaces', 'false'], env)
        run(['gsettings', 'set', 'org.gnome.desktop.wm.preferences', 'num-workspaces', '1'], env)
        (root / 'flatpaks').mkdir()
        launch = root / 'launch.sh'
        launch.write_text('printf "%s\\n" "$DBUS_SESSION_BUS_ADDRESS"\n'
            'exec gnome-shell --headless --wayland --no-x11 --virtual-monitor=1920x1080 '
            '--wayland-display=ssc-benchmark > "$XDG_CACHE_HOME/shell.log" 2>&1\n')
        try:
            shell = subprocess.Popen(['bwrap', '--dev-bind', '/', '/', '--bind',
                str(root / 'flatpaks'), str(Path.home() / '.var/app'), '--',
                'dbus-run-session', '--', 'bash', str(launch)], env=env,
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, start_new_session=True)
            if not select.select([shell.stdout], [], [], 20)[0]:
                raise RuntimeError('Private session bus did not start')
            env['DBUS_SESSION_BUS_ADDRESS'] = shell.stdout.readline().strip()
            if not env['DBUS_SESSION_BUS_ADDRESS']:
                raise RuntimeError('Empty private session bus address')

            def control(command, argument=''):
                return json.loads(run(['gjs', '-m', str(repo / 'tests/compositor/compositor-driver.js'),
                                       command, str(argument)], env))

            def evaluate(code):
                return control('eval', code)

            def eventually(code, timeout=20):
                deadline = time.monotonic() + timeout
                while time.monotonic() < deadline:
                    if shell.poll() is not None:
                        raise RuntimeError('Private Shell exited')
                    try:
                        result = evaluate(code)
                    except subprocess.CalledProcessError:
                        result = None
                    if result:
                        return result
                    time.sleep(1)
                raise TimeoutError(code)

            eventually('!!global.sscBench')
            control('scale', 1.5)
            metadata['monitor_state'] = run(['gdbus', 'call', '--session', '--dest',
                'org.gnome.Mutter.DisplayConfig', '--object-path', '/org/gnome/Mutter/DisplayConfig',
                '--method', 'org.gnome.Mutter.DisplayConfig.GetCurrentState'], env)
            app = subprocess.Popen(['gjs', '-m', str(suite / 'fixture.js')], env=env,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            eventually("global.get_window_actors().filter(a => a.metaWindow.title?.startsWith('SSC benchmark ')).length === 6")
            for mode in ['off', 'corners', 'shadows']:
                print(f'Hover: {mode}', flush=True)
                evaluate(f'global.sscBench.start({json.dumps(mode)})')
                result = eventually('global.sscBench.result', timeout=60)
                if 'error' in result:
                    raise RuntimeError(result['error'])
                records.append(result)
                delays = [s['enter'] - s['crossed'] for s in result['samples'] if s['enter'] is not None]
                print(f'  {len(delays)}/12 entries; maximum crossing delay {max(delays, default=0):.1f} ms', flush=True)
            (output / 'results.json').write_text(json.dumps(records, indent=2) + '\n')
            if 'JS ERROR' in (root / 'cache/shell.log').read_text():
                raise RuntimeError('Shell reported a JavaScript error; see shell.log')
            validate(records)
            print('All 36 hover checks passed.', flush=True)
        finally:
            stop(app)
            stop(shell)
            if (root / 'cache/shell.log').exists():
                shutil.copyfile(root / 'cache/shell.log', output / 'shell.log')
            (output / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit('Hover test interrupted; private session cleaned up.') from None
