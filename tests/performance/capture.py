"""Read timing marks from Sysprof v1 captures (Sysprof 50 capture-types.h)."""
import bisect
import math
import statistics
import struct


def summary(values):
    values = sorted(values)
    if not values:
        raise ValueError('No measured frames; benchmark is invalid')
    return {"count": len(values), "mean": statistics.mean(values),
            "median": statistics.median(values),
            "p95": values[math.ceil(len(values) * .95) - 1],
            "p99": values[math.ceil(len(values) * .99) - 1]}


def analyze(path, spans):
    data = path.read_bytes()
    if len(data) < 256 or struct.unpack_from('<I', data)[0] != 0xFDCA975E:
        raise ValueError('Not a Sysprof capture')
    if data[4] != 1 or not data[5] & 1:
        raise ValueError('Expected little-endian Sysprof capture version 1')
    marks = []
    offset = 256
    while offset < len(data):
        if offset + 24 > len(data):
            raise ValueError('Truncated capture frame')
        length, _, pid, time, kind = struct.unpack_from('<HhiqI', data, offset)
        if length < 24 or offset + length > len(data):
            raise ValueError('Invalid capture frame length')
        if kind & 255 == 10:
            if length < 96:
                raise ValueError('Truncated timing mark')
            duration = struct.unpack_from('<q', data, offset + 24)[0]
            name = data[offset + 56:offset + 96].split(b'\0')[0].decode()
            if duration < 0:
                raise ValueError('Negative mark duration')
            marks.append((time, duration, name, pid))
        offset += length
    # The profiler is attached only to the private Shell. Derive its PID from
    # frame-clock marks instead of relying on process metadata or a fixed PID.
    pids = {m[3] for m in marks if m[2] == 'Clutter::FrameClock::dispatch()'}
    if len(pids) != 1:
        raise ValueError(f'Expected one Shell frame clock, found PIDs {pids}')
    marks = [m for m in marks if m[3] in pids]
    ticks = sorted(m[0] for m in marks if m[2] == 'Clutter::Timeline::do_tick()')
    frames = []
    for m in sorted(marks):
        t, duration, name, _ = m
        if name != 'Clutter::FrameClock::dispatch()':
            continue
        i = bisect.bisect_left(ticks, t)
        if (i < len(ticks) and ticks[i] < t + duration and
                any(lo <= t and t + duration <= hi for lo, hi in spans)):
            frames.append(m)
    starts = [m[0] for m in frames]

    def inside(time):
        i = bisect.bisect_right(starts, time) - 1
        return i >= 0 and time < frames[i][0] + frames[i][1]

    paints = [m[1] / 1e6 for m in marks
              if m[2] == 'Clutter::Stage::paint_view()' and inside(m[0])]
    flushes = sum(m[2] == 'Cogl::Journal::flush()' and inside(m[0]) for m in marks)
    cycles = [sum(lo <= m[0] and m[0] + m[1] <= hi for m in frames) for lo, hi in spans]
    if any(n < 10 for n in cycles):
        raise ValueError(f'Missing animation activity: frames per cycle {cycles}')
    return {"paint_ms": summary(paints),
            "dispatch_ms": summary([m[1] / 1e6 for m in frames]),
            "flushes_per_paint": flushes / len(paints), "frames_per_cycle": cycles}
