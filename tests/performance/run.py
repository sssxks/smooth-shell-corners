# /// script
# requires-python = ">=3.13,<3.14"
# dependencies = []
# ///
"""Local Bazzite/GNOME 50 benchmark. Run from any directory with uv."""
import hashlib
import json
import os
import re
from pathlib import Path
import select
import shutil
import signal
import subprocess
import tempfile
import time

from capture import analyze, summary

repo = Path(__file__).resolve().parents[2]
suite = Path(__file__).resolve().parent
protocol_paths = [suite / name for name in
                  ['run.py', 'capture.py', 'probe.js', 'fixture.js', 'profiler.js']]


def run(args, env=None, timeout=20):
    return subprocess.run(args, cwd=repo, env=env, check=True, text=True,
                          capture_output=True, timeout=timeout).stdout.strip()


def digest(paths):
    checksum = hashlib.sha256()
    for path in sorted(paths):
        checksum.update(str(path.relative_to(repo)).encode() + b'\0')
        checksum.update(path.read_bytes())
    return checksum.hexdigest()


def stop(process):
    if process is None or process.poll() is not None:
        return
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)


def interrupt(_signum, _frame):
    # timeout and uv may both forward termination. Do not interrupt teardown.
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    raise KeyboardInterrupt


def main():
    # Let the outer timeout and Ctrl+C run the same child-process cleanup.
    signal.signal(signal.SIGTERM, interrupt)
    signal.signal(signal.SIGINT, interrupt)
    version = run(['gnome-shell', '--version'])
    if not version.startswith('GNOME Shell 50.'):
        raise RuntimeError(f'This benchmark targets GNOME 50, found {version}')
    run(['npm', 'run', 'build'], timeout=90)
    commit = run(['git', 'rev-parse', 'HEAD'])
    output = repo / 'tests/artifacts/benchmark' / (
        time.strftime('%Y%m%d-%H%M%S') + '-' + commit[:10])
    output.mkdir(parents=True, exist_ok=False)
    print(f'Results: {output}', flush=True)
    # Archive exactly what Shell will import, including uncommitted changes.
    shutil.make_archive(str(output / 'extension'), 'zip', repo / 'dist')
    shutil.copytree(suite, output / 'harness', ignore=shutil.ignore_patterns('__pycache__'))
    metadata = {
        'commit': commit, 'git_status': run(['git', 'status', '--short']),
        'extension_sha256': digest(p for p in (repo / 'dist').rglob('*') if p.is_file()),
        'protocol_sha256': digest(protocol_paths),
        'environment': {'shell': version, 'kernel': os.uname().release,
                        'packages': run(['rpm', '-q', 'mutter', 'gjs', 'mesa-dri-drivers', 'sysprof']),
                        'cpu': next(line.split(':', 1)[1].strip() for line in
                                    Path('/proc/cpuinfo').read_text().splitlines()
                                    if line.startswith('model name')),
                        'cpu_governors': {p.parent.name: p.read_text().strip() for p in
                            sorted(Path('/sys/devices/system/cpu/cpufreq').glob('policy*/scaling_governor'))},
                        'graphics_environment': {key: value for key, value in os.environ.items()
                            if key.startswith(('MESA_', 'LIBGL_', 'EGL_', 'DRI_', 'GALLIUM_', 'GSK_'))}},
        'workload': {'backend': 'headless', 'monitor': '1920x1080', 'scale': 1.5,
                     'windows': 6, 'warmup_cycles': 2, 'measured_cycles': 6,
                     'transition_interval_ms': 700, 'rounds': 3},
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
            f'export {{default}} from {json.dumps((suite / "probe.js").as_uri())};\n')
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
            # Keep actual GPU selection in the comparison signature, not just
            # the list of GPUs installed in the machine.
            shell_log = (root / 'cache/shell.log').read_text()
            metadata['environment']['renderer'] = [line.rsplit(': ', 1)[-1]
                for line in shell_log.splitlines()
                if 'renderer for' in line or 'selected as primary' in line]
            metadata['environment']['gpu_devices'] = {
                node: {name: (Path('/sys/class/drm') / Path(node).name / 'device' / name)
                       .read_text().strip() for name in ['vendor', 'device']}
                for node in sorted(set(re.findall(r'/dev/dri/renderD\d+', shell_log)))}
            if not metadata['environment']['renderer'] or not metadata['environment']['gpu_devices']:
                raise RuntimeError('Cannot identify the hardware renderer; see shell.log')
            control('scale', 1.5)
            metadata['monitor_state'] = run(['gdbus', 'call', '--session', '--dest',
                'org.gnome.Mutter.DisplayConfig', '--object-path', '/org/gnome/Mutter/DisplayConfig',
                '--method', 'org.gnome.Mutter.DisplayConfig.GetCurrentState'], env)
            app = subprocess.Popen(['gjs', '-m', str(suite / 'fixture.js')], env=env,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            eventually("global.get_window_actors().filter(a => a.metaWindow.title?.startsWith('SSC benchmark ')).length === 6")
            # Each mode appears once in each position, limiting warmup/order bias.
            orders = [('off', 'corners', 'shadows'), ('corners', 'shadows', 'off'),
                      ('shadows', 'off', 'corners')]
            for round_number, order in enumerate(orders, 1):
                for mode in order:
                    name = f'{round_number}-{mode}'
                    capture = output / f'{name}.syscap'
                    print(f'Round {round_number}/3: {mode}', flush=True)
                    run(['gjs', '-m', str(suite / 'profiler.js'), 'start', str(capture)], env)
                    try:
                        evaluate(f'global.sscBench.start({json.dumps(mode)})')
                        # Avoid creating D-Bus clients during the timed workload.
                        time.sleep(12)
                        result = eventually('global.sscBench.result', timeout=25)
                        if 'error' in result:
                            raise RuntimeError(result['error'])
                    finally:
                        run(['gjs', '-m', str(suite / 'profiler.js'), 'stop'], env)
                    # Stop schedules tracing cleanup on Mutter's worker threads.
                    time.sleep(.25)
                    record = {'round': round_number, **result, 'capture': capture.name,
                              'metrics': analyze(capture, result['spans'])}
                    records.append(record)
                    (output / f'{name}.json').write_text(json.dumps(record, indent=2) + '\n')
                    print(f"  paint {record['metrics']['paint_ms']['mean']:.3f} ms; "
                          f"dispatch {record['metrics']['dispatch_ms']['mean']:.3f} ms", flush=True)
            log = (root / 'cache/shell.log').read_text()
            if 'JS ERROR' in log:
                raise RuntimeError('Shell reported a JavaScript error; see shell.log')
            if (digest(protocol_paths) != metadata['protocol_sha256'] or
                    digest(p for p in (repo / 'dist').rglob('*') if p.is_file()) !=
                    metadata['extension_sha256']):
                raise RuntimeError('Benchmark code or dist changed during recording')
            aggregates = {mode: {metric: summary([
                r['metrics'][metric]['mean'] for r in records if r['mode'] == mode])
                for metric in ['paint_ms', 'dispatch_ms']} for mode in orders[0]}
            report = {**metadata, 'runs': records, 'aggregate_run_means': aggregates}
            (output / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
            print('\nMedian of three run means (CPU-side elapsed time):', flush=True)
            for mode, metrics in aggregates.items():
                print(f"  {mode:8} paint {metrics['paint_ms']['median']:.3f} ms; "
                      f"dispatch {metrics['dispatch_ms']['median']:.3f} ms", flush=True)
            print(f'\nSaved {output / "results.json"}', flush=True)
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
        raise SystemExit('Benchmark interrupted; private session cleaned up.') from None
