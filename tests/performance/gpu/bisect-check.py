# /// script
# requires-python = ">=3.13,<3.14"
# dependencies = []
# ///
"""git bisect run uv run /path/to/tests/performance/gpu/bisect-check.py (in target worktree)."""
import json
from pathlib import Path
import subprocess
import sys


def main():
    suite = Path(__file__).resolve().parent
    try:
        result = subprocess.run(['timeout', '150s', 'uv', 'run', str(suite/'run.py'),
                                 '--checkout', str(Path.cwd()), '--modes', 'shadows', '--no-timers'],
                                text=True, capture_output=True, timeout=180)
        print(result.stdout, end='')
        if result.returncode:
            print(result.stderr, file=sys.stderr)
            return 125
        path = next(line.removeprefix('Saved ') for line in result.stdout.splitlines() if line.startswith('Saved '))
        report = json.loads(Path(path).read_text())
        record = next(r for r in report['results'] if r['workload'] == 'damage')
        commit = report['commit']
        if not isinstance(commit, str):
            raise ValueError('Missing commit identifier')
        busy = record['gfx_busy_percent']
        if not 0 <= busy <= 100:
            raise ValueError('Invalid GPU engine utilization')
    except (OSError, ValueError, KeyError, TypeError, StopIteration, subprocess.TimeoutExpired) as error:
        print(f'Cannot classify this revision: {error}', file=sys.stderr)
        return 125
    # Endpoints measured 1.5% and 24.2%. Keep clock noise out of the decision.
    print(f"BISECT {'bad' if busy > 10 else 'good'}: {commit[:10]}, damage gfx={busy:.2f}%")
    return 1 if busy > 10 else 0


if __name__ == '__main__':
    raise SystemExit(main())
