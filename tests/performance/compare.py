# /// script
# requires-python = ">=3.13,<3.14"
# dependencies = []
# ///
"""Compare two results.json files; reject incompatible benchmark conditions."""
import json
from pathlib import Path
import sys


def compare(before, after):
    for key in ['protocol_sha256', 'environment', 'workload']:
        if before[key] != after[key]:
            raise ValueError(f'{key} differs; rerun both commits under the same conditions')
    for mode in ['off', 'corners', 'shadows']:
        old_runs = [r for r in before['runs'] if r['mode'] == mode]
        new_runs = [r for r in after['runs'] if r['mode'] == mode]
        if len(old_runs) != 3 or len(new_runs) != 3:
            raise ValueError('Expected three complete runs per mode')
        for r in old_runs + new_runs:
            for key in ['settings', 'geometry']:
                if r[key] != old_runs[0][key]:
                    raise ValueError(f'{mode}: {key} differs; comparison is not controlled')
    print(f"Before: {before['commit'][:12]} ({before['extension_sha256'][:12]})")
    print(f"After:  {after['commit'][:12]} ({after['extension_sha256'][:12]})")
    print('Median run means; positive change means slower. Times are CPU-side elapsed ms.')
    print(f"{'Mode':9} {'Metric':12} {'Before':>9} {'After':>9} {'Change':>9}  Run mean ranges (before -> after)")
    for mode in ['off', 'corners', 'shadows']:
        for metric in ['paint_ms', 'dispatch_ms']:
            a = before['aggregate_run_means'][mode][metric]['median']
            b = after['aggregate_run_means'][mode][metric]['median']
            ranges = []
            for report in [before, after]:
                values = [r['metrics'][metric]['mean'] for r in report['runs'] if r['mode'] == mode]
                ranges.append(f'{min(values):.3f}–{max(values):.3f}')
            print(f'{mode:9} {metric:12} {a:9.3f} {b:9.3f} {(b/a-1)*100:+8.1f}%  ' + ' -> '.join(ranges))
    print('\nAnimated frames per cycle (min–max, before -> after):')
    for mode in ['off', 'corners', 'shadows']:
        ranges = []
        for report in [before, after]:
            counts = [n for r in report['runs'] if r['mode'] == mode
                      for n in r['metrics']['frames_per_cycle']]
            ranges.append(f'{min(counts)}–{max(counts)}')
        print(f"  {mode:9} {' -> '.join(ranges)}")
    print('\nCheck the off baseline for machine-load drift. Overlapping run ranges are not a significance test.')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: uv run tests/performance/compare.py BEFORE/results.json AFTER/results.json')
    try:
        compare(*(json.loads(Path(path).read_text()) for path in sys.argv[1:]))
    except ValueError as error:
        raise SystemExit(str(error)) from error
