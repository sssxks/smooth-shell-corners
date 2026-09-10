# /// script
# requires-python = ">=3.13,<3.14"
# dependencies = []
# ///
"""Bazzite: timestamp real Shell GL commands; run unchanged against a worktree."""
import argparse
import bisect
from collections import defaultdict
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import time

suite = Path(__file__).resolve().parent
repo = suite.parents[2]
sys.path.insert(0, str(suite.parent))
from run import stop, interrupt


def run(args, env=None, cwd=repo, timeout=30):
    result = subprocess.run(args, cwd=cwd, env=env, check=True, text=True,
                            capture_output=True, timeout=timeout)
    return result.stdout.strip()


def engines(pid):
    clients = {}
    for fd in Path(f'/proc/{pid}/fdinfo').iterdir():
        try:
            info = dict(line.split(':', 1) for line in fd.read_text().splitlines() if ':' in line)
        except FileNotFoundError:
            continue
        if info.get('drm-pdev', '').strip() != '0000:03:00.0' or 'drm-engine-gfx' not in info:
            continue
        clients[info['drm-client-id'].strip()] = {
            'gfx_ns': int(info['drm-engine-gfx'].split()[0]),
            **{key: int(info.get('drm-'+key, '0 KiB').split()[0])*1024
               for key in ['memory-vram', 'resident-vram', 'memory-gtt']},
        }
    if not clients:
        raise RuntimeError('No RX 7900 XT graphics-engine counters for private Shell')
    return {'time': time.monotonic_ns(), **{key: sum(client[key] for client in clients.values())
                                        for key in ['gfx_ns', 'memory-vram', 'resident-vram', 'memory-gtt']}}


def analyze(trace, records, samples):
    rows = []
    if trace.exists():
        with trace.open() as stream:
            for cpu, context, program, label, width, height, ns in csv.reader(stream):
                rows.append((int(cpu), label, int(ns), int(width), int(height)))
    results = []
    for record in records:
        start, end = record['start'], record['end']
        frames = record['frames']
        selected = [r for r in rows if start <= r[0] < end]
        groups = defaultdict(list)
        frame_ns = defaultdict(int)
        for cpu, label, ns, width, height in selected:
            groups[label].append((ns, width, height))
            frame_ns[bisect.bisect_right(frames, cpu)-1] += ns
        counters = [s for s in samples if start <= s['time'] < end]
        if len(counters) < 2:
            raise RuntimeError('Missing engine-counter samples')
        busy = 100 * (counters[-1]['gfx_ns']-counters[0]['gfx_ns']) / (counters[-1]['time']-counters[0]['time'])
        passes = {label: {'calls': len(values), 'gpu_ms': sum(v[0] for v in values)/1e6,
                          'mean_us': sum(v[0] for v in values)/len(values)/1e3,
                          'max_target': max((v[1], v[2]) for v in values)} for label, values in groups.items()}
        memory = {key: {'start_mib': counters[0].get(key, 0)/2**20,
                        'end_mib': counters[-1].get(key, 0)/2**20,
                        'peak_mib': max(s.get(key, 0) for s in counters)/2**20}
                  for key in ['memory-vram', 'resident-vram', 'memory-gtt']}
        active_ms = sorted(ns/1e6 for ns in frame_ns.values())
        results.append({**record, 'frames': len(frames), 'gfx_busy_percent': busy,
                        'gpu_ms_per_frame': sum(r[2] for r in selected)/1e6/max(1, len(frames)) if trace.exists() else None,
                        'gpu_ms_per_rendered_frame': sum(active_ms)/len(active_ms) if active_ms else None,
                        'gpu_ms_per_rendered_frame_p95': active_ms[math.ceil(.95*len(active_ms))-1] if active_ms else None,
                        'frames_with_gpu_commands': len(frame_ns) if trace.exists() else None,
                        'gpu_ms_per_second': sum(r[2] for r in selected)/(end-start)*1000 if trace.exists() else None,
                        'passes': passes, 'memory': memory})
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkout', type=Path, default=repo)
    parser.add_argument('--modes', nargs='+', choices=['off', 'corners', 'shadows'], default=['off', 'corners', 'shadows'])
    parser.add_argument('--no-timers', action='store_true', help='Measure instrumentation overhead using DRM counters')
    parser.add_argument('--resize', action='store_true', help='Repeat resize and idle spans, then diagnostic GC')
    args = parser.parse_args()
    checkout = args.checkout.resolve()
    signal.signal(signal.SIGTERM, interrupt)
    signal.signal(signal.SIGINT, interrupt)
    run(['npm', 'run', 'build'], cwd=checkout, timeout=90)
    commit = run(['git', 'rev-parse', 'HEAD'], cwd=checkout)
    output = repo / 'tests/artifacts/gpu' / (time.strftime('%Y%m%d-%H%M%S')+'-'+commit[:10])
    output.mkdir(parents=True)
    library = output / 'libssc_gpu_timer.so'
    run(['rustc', '--edition', '2024', '--crate-type', 'cdylib', '-C', 'opt-level=2', '-C', 'panic=abort',
         str(suite/'timer.rs'), '-o', str(library)], timeout=60)
    shutil.copytree(suite, output/'harness', ignore=shutil.ignore_patterns('__pycache__'))
    shutil.make_archive(str(output/'extension'), 'zip', checkout/'dist')
    protocol_paths = [suite/name for name in ['timer.rs', 'probe.js', 'fixture.js', 'run.py']]
    metadata = {'commit': commit, 'status': run(['git', 'status', '--short'], cwd=checkout),
        'timers': not args.no_timers, 'kernel': os.uname().release,
        'packages': run(['rpm', '-q', 'mutter', 'gjs', 'mesa-dri-drivers']),
        'protocol_sha256': hashlib.sha256(b''.join(p.read_bytes() for p in protocol_paths)).hexdigest(),
        'extension_sha256': hashlib.sha256((output/'extension.zip').read_bytes()).hexdigest()}
    print(f'Results: {output}', flush=True)
    shell = app = None
    records, samples = [], []
    with tempfile.TemporaryDirectory(prefix='ssc-gpu-', ignore_cleanup_errors=True) as temporary:
        root = Path(temporary)
        env = os.environ | {'GSETTINGS_BACKEND': 'keyfile', 'DISPLAY': '', 'WAYLAND_DISPLAY': 'ssc-gpu',
                           'GDK_BACKEND': 'wayland', 'SSC_GPU_CHECKOUT': str(checkout),
                           'SSC_GPU_RESIZE': '1' if args.resize else '0',
                           'SSC_GPU_TRACE': str(output/'draws.csv')}
        for key, name in [('XDG_CONFIG_HOME', 'config'), ('XDG_DATA_HOME', 'data'),
                          ('XDG_CACHE_HOME', 'cache'), ('XDG_RUNTIME_DIR', 'runtime')]:
            env[key] = str(root/name)
            (root/name).mkdir(mode=0o700)
        probe = root/'data/gnome-shell/extensions/ssc-gpu@local'
        probe.mkdir(parents=True)
        (probe/'metadata.json').write_text(json.dumps({'uuid':'ssc-gpu@local', 'name':'SSC GPU probe',
            'description':'Private GPU timestamps', 'shell-version':['50']}))
        (probe/'extension.js').write_text(f'export {{default}} from {json.dumps((suite/"probe.js").as_uri())};\n')
        run(['gsettings', 'set', 'org.gnome.shell', 'enabled-extensions', "['ssc-gpu@local']"], env)
        (root/'flatpaks').mkdir()
        launch = root/'launch.sh'
        launch.write_text('printf "%s\\n" "$DBUS_SESSION_BUS_ADDRESS"\n'
            + ('export LD_PRELOAD='+str(library)+'\n' if not args.no_timers else '')
            + 'exec gnome-shell --headless --wayland --no-x11 --virtual-monitor=3840x2160 '
              '--wayland-display=ssc-gpu > "$XDG_CACHE_HOME/shell.log" 2>&1\n')
        try:
            shell = subprocess.Popen(['bwrap', '--dev-bind', '/', '/', '--bind', str(root/'flatpaks'),
                str(Path.home()/'.var/app'), '--', 'dbus-run-session', '--', 'bash', str(launch)],
                env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, start_new_session=True)
            if not select.select([shell.stdout], [], [], 20)[0]:
                raise RuntimeError('Private session bus did not start')
            env['DBUS_SESSION_BUS_ADDRESS'] = shell.stdout.readline().strip()
            def control(command, argument=''):
                return json.loads(run(['gjs', '-m', str(repo/'tests/compositor/compositor-driver.js'), command, str(argument)], env))
            def evaluate(code):
                return control('eval', code)
            def eventually(code):
                for _ in range(25):
                    if shell.poll() is not None: raise RuntimeError('Private Shell exited')
                    try:
                        value = evaluate(code)
                        if value: return value
                    except subprocess.CalledProcessError:
                        pass
                    time.sleep(1)
                raise RuntimeError('Timed out: '+code)
            eventually('!!global.sscGpu')
            pid = evaluate('global.sscGpu.pid')
            control('scale', 1.5)
            app = subprocess.Popen(['gjs', '-m', str(suite/'fixture.js')], env=env,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            eventually("global.get_window_actors().filter(a => a.metaWindow.title?.startsWith('SSC GPU ')).length === 4")
            for mode in args.modes:
                print(f'Measuring {mode}', flush=True)
                evaluate(f'global.sscGpu.start({json.dumps(mode)})')
                if args.resize and engines(pid)['memory-vram'] == 0:
                    raise RuntimeError('Missing Shell VRAM accounting')
                deadline = time.monotonic()+(33 if args.resize else 23)
                while time.monotonic() < deadline:
                    samples.append(engines(pid))
                    time.sleep(.25)
                result = eventually('global.sscGpu.result')
                if 'error' in result: raise RuntimeError(result['error'])
                records.extend(result['records'])
                metadata.setdefault('settings', {})[mode] = result['settings']
                for r in analyze(output/'draws.csv', result['records'], samples):
                    timing = (f"{r['gpu_ms_per_rendered_frame']:.3f} ms/rendered frame"
                              if r["gpu_ms_per_rendered_frame"] is not None
                              else "no timed frames" if not args.no_timers else "timers disabled")
                    print(f"  {r['workload']:6}: gfx {r['gfx_busy_percent']:.1f}%, "
                          f"{r['frames']} paint callbacks, GPU commands {timing}", flush=True)
                    if args.resize:
                        memory = r['memory']['memory-vram']
                        print(f"    VRAM MiB: start {memory['start_mib']:.1f}, "
                              f"peak {memory['peak_mib']:.1f}, end {memory['end_mib']:.1f}", flush=True)
            log = (root/'cache/shell.log').read_text()
            if 'JS ERROR' in log or 'GPU timer:' in log and 'timestamp_bits=' not in log:
                raise RuntimeError('Shell/tracer error; inspect shell.log')
            if not args.no_timers and not (output/'draws.csv').exists():
                raise RuntimeError('No GPU timestamps captured')
            if any(p.read_bytes() != (output/'harness'/p.name).read_bytes() for p in protocol_paths):
                raise RuntimeError('GPU profiling code changed during recording')
            metadata['dependency_errors'] = log.count('_cogl_framebuffer_add_dependency')
            metadata['renderer'] = [s for s in log.splitlines() if 'renderer=' in s or 'selected as primary' in s]
            result = {**metadata, 'results': analyze(output/'draws.csv', records, samples)}
            (output/'results.json').write_text(json.dumps(result, indent=2)+'\n')
            (output/'spans.json').write_text(json.dumps(records)+'\n')
            (output/'engines.json').write_text(json.dumps(samples)+'\n')
            print(f'Saved {output/"results.json"}', flush=True)
        finally:
            stop(app)
            stop(shell)
            if (root/'cache/shell.log').exists(): shutil.copyfile(root/'cache/shell.log', output/'shell.log')
            (output/'metadata.json').write_text(json.dumps(metadata, indent=2)+'\n')


if __name__ == '__main__':
    main()
