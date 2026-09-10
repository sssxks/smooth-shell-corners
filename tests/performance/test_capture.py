"""Small synthetic captures verify frame selection and failure handling."""
import struct
import copy
import tempfile
from pathlib import Path
import unittest

from capture import analyze
from compare import compare


def mark(time, duration, name, pid=42):
    return (struct.pack('<HhiqIIq', 96, -1, pid, time, 10, 0, duration)
            + b'Compositor'.ljust(24, b'\0') + name.encode().ljust(40, b'\0'))


def fixture():
    header = struct.pack('<II', 0xFDCA975E, 257).ljust(256, b'\0')
    data = bytearray(header)
    for i in range(13):
        t = i * 20_000_000
        data += mark(t, 1_000_000, 'Clutter::FrameClock::dispatch()')
        data += mark(t + 1_000, 1_000, 'Clutter::Timeline::do_tick()')
        data += mark(t + 10_000, 200_000, 'Clutter::Stage::paint_view()')
        data += mark(t + 20_000, 10_000, 'Cogl::Journal::flush()')
        # Another process's paint cannot contribute to the Shell metric.
        data += mark(t + 10_000, 900_000, 'Clutter::Stage::paint_view()', pid=99)
    return data


class CaptureTests(unittest.TestCase):
    def analyze(self, data, spans=((20_000_000, 260_000_000),)):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'test.syscap'
            path.write_bytes(data)
            return analyze(path, spans)

    def test_excludes_warmup_and_other_processes(self):
        result = self.analyze(fixture())
        self.assertEqual(result['frames_per_cycle'], [12])
        self.assertEqual(result['dispatch_ms']['mean'], 1)
        self.assertAlmostEqual(result['paint_ms']['mean'], .2)
        self.assertEqual(result['paint_ms']['count'], 12)
        self.assertEqual(result['flushes_per_paint'], 1)

    def test_requires_complete_frames_inside_span(self):
        result = self.analyze(fixture(), ((20_000_001, 260_000_000),))
        self.assertEqual(result['frames_per_cycle'], [11])

    def test_rejects_truncated_capture(self):
        with self.assertRaisesRegex(ValueError, 'frame length'):
            self.analyze(fixture()[:-1])

    def test_rejects_missing_animation(self):
        with self.assertRaisesRegex(ValueError, 'Missing animation'):
            self.analyze(fixture(), ((1_000_000_000, 2_000_000_000),))

    def test_rejects_multiple_shells(self):
        with self.assertRaisesRegex(ValueError, 'one Shell'):
            self.analyze(fixture() + mark(0, 1, 'Clutter::FrameClock::dispatch()', 99))

    def test_comparison_rejects_environment_change(self):
        with self.assertRaisesRegex(ValueError, 'environment differs'):
            compare({'protocol_sha256': 'same', 'environment': 'A'},
                    {'protocol_sha256': 'same', 'environment': 'B'})

    def test_comparison_rejects_changed_geometry_or_settings(self):
        before = {'protocol_sha256': 'same', 'environment': {}, 'workload': {},
                  'runs': [{'mode': 'off', 'settings': {}, 'geometry': []} for _ in range(3)]}
        for key in ['geometry', 'settings']:
            after = copy.deepcopy(before)
            after['runs'][0][key] = 'changed'
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, key):
                compare(before, after)


if __name__ == '__main__':
    unittest.main()
