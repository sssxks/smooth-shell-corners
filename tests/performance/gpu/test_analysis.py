# /// script
# requires-python = ">=3.13,<3.14"
# dependencies = []
# ///
"""Validate timestamp units, span boundaries and per-client counter accounting."""
import importlib.util
from pathlib import Path
import contextlib
import io
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('gpu_run', Path(__file__).with_name('run.py'))
profile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profile)
spec = importlib.util.spec_from_file_location('gpu_bisect', Path(__file__).with_name('bisect-check.py'))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class Accounting(unittest.TestCase):
    def test_bisect_never_calls_a_failed_capture_bad(self):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            with patch.object(checker.subprocess, 'run', side_effect=subprocess.TimeoutExpired('capture', 180)):
                self.assertEqual(checker.main(), 125)
            for result in [SimpleNamespace(returncode=1, stdout='', stderr='build failed'),
                           SimpleNamespace(returncode=0, stdout='missing report', stderr='')]:
                with patch.object(checker.subprocess, 'run', return_value=result):
                    self.assertEqual(checker.main(), 125)

    def test_spans_units_and_empty_paint_callbacks(self):
        with tempfile.TemporaryDirectory() as tmp:
            trace = Path(tmp)/'draws.csv'
            trace.write_text('500000000,1,2,blur-x,100,80,90000000\n'
                             '1000000000,1,2,blur-x,100,80,4000000\n'
                             '2100000000,1,2,spread-x,100,80,2000000\n'
                             '2900000000,1,2,blur-x,100,80,4000000\n'
                             '4000000000,1,2,blur-x,100,80,90000000\n')
            records = [{'start': 1000000000, 'end': 4000000000,
                        'frames': [1000000000, 2000000000, 3000000000]}]
            samples = [{'time': 1000000000, 'gfx_ns': 0}, {'time': 3000000000, 'gfx_ns': 500000000}]
            result = profile.analyze(trace, records, samples)[0]
            self.assertEqual(result['gfx_busy_percent'], 25)
            self.assertAlmostEqual(result['gpu_ms_per_frame'], 10/3)
            self.assertAlmostEqual(result['gpu_ms_per_second'], 10/3)
            self.assertEqual(result['frames_with_gpu_commands'], 2)
            self.assertEqual(result['gpu_ms_per_rendered_frame'], 5)
            self.assertEqual(result['gpu_ms_per_rendered_frame_p95'], 6)
            self.assertEqual(result['passes']['blur-x']['gpu_ms'], 8)
            trace.write_text('')
            empty = profile.analyze(trace, records, samples)[0]
            self.assertEqual(empty['frames_with_gpu_commands'], 0)
            self.assertIsNone(empty['gpu_ms_per_rendered_frame'])
            self.assertIsNone(empty['gpu_ms_per_rendered_frame_p95'])
            trace.unlink()
            self.assertIsNone(profile.analyze(trace, records, samples)[0]['gpu_ms_per_frame'])

    def test_duplicate_fds_do_not_double_count_gpu_time(self):
        text = 'drm-pdev: 0000:03:00.0\ndrm-client-id: 7\ndrm-engine-gfx: 123 ns\ndrm-memory-vram: 2048 KiB\ndrm-resident-vram: 1024 KiB\n'
        fds = [SimpleNamespace(read_text=lambda: text), SimpleNamespace(read_text=lambda: text),
               SimpleNamespace(read_text=lambda: text.replace('03:00.0', '12:00.0')),
               SimpleNamespace(read_text=lambda: 'drm-pdev: 0000:03:00.0\ndrm-client-id: 9\n')]
        with patch.object(profile, 'Path', return_value=SimpleNamespace(iterdir=lambda: fds)):
            sample = profile.engines(1)
            self.assertEqual(sample['gfx_ns'], 123)
            self.assertEqual(sample['memory-vram'], 2**21)
            self.assertEqual(sample['resident-vram'], 2**20)


if __name__ == '__main__':
    unittest.main()
