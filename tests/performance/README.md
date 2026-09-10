# Automated Overview benchmark

From this Bazzite/GNOME Shell 50 checkout:

```bash
just benchmark
```

Allow about two minutes. Requires the normal build dependencies plus `uv`,
`gjs`, `bwrap`, and GNOME Shell built with profiler support (present on this
machine). The runner builds the current checkout, including uncommitted edits.
It does not install the extension into your desktop.

Results go into a new directory under `tests/artifacts/benchmark/`. Keep the
entire directory for each revision you want to compare. It contains:

- `results.json`: metadata, per-run results, and aggregate run means.
- Nine `.syscap` files that can be opened in Sysprof, with matching JSON files
  identifying the exact measured time spans and fixture state.
- `extension.zip`, build hash, commit ID, and working-tree status, so dirty
  builds are distinguishable from committed builds.
- A copy and hash of the benchmark code, renderer/device identification,
  package versions, monitor state, settings, and the private Shell log.

Only completed, validated runs produce `results.json`. Failed runs retain
diagnostic artifacts. Ctrl+C or the four-minute outer timeout cleans up the
private Shell and fixture process groups.

## Workload and isolation

The runner starts a headless hardware-rendered Shell on its own session bus,
with private config, data, runtime, and cache directories. Only the benchmark
probe and the checkout's extension are loaded. Existing Flatpak config
directories are hidden from that Shell using the same isolation pattern as
the compositor correctness tests. Native GTK corner replacement is explicitly
off; the six GTK4 fixture windows are undecorated.

The fixed workload is a 1920×1080 virtual monitor at 150% scale, six 400×260
windows, and scripted Overview show/hide transitions 700 ms apart. Settings
are pinned in `probe.js` rather than inherited from your desktop or changing
extension defaults. Each run warms up with two cycles, then measures six.
Three rounds balance the order:

1. Extension off → corners only → corners and shadows.
2. Corners only → corners and shadows → extension off.
3. Corners and shadows → extension off → corners only.

The probe checks window geometry, effect state, shadow state, and Overview
visibility. Capture analysis rejects missing animation activity. Warmup,
settings transitions, and idle gaps are excluded from the timing statistics:
only frame-clock callbacks containing timeline ticks inside measured spans
are included. These are animation frames, not uniquely tagged Overview frames;
the controlled fixture and private session limit other animation sources.

The probe uses unsafe Shell Eval only on the private bus. It never changes
the desktop Shell's Eval setting. Actual desktop applications and extensions
remain running, so heavy host activity still affects the shared CPU/GPU. Keep
the desktop quiet and the power profile unchanged during comparisons.

## Comparing revisions

Run `just benchmark` on each revision with the same benchmark code and machine
conditions. Then use the two completed JSON paths:

```bash
just benchmark-compare /path/to/before/results.json /path/to/after/results.json
```

The comparison shows median run means, percentage changes, the range of
the three run means, and animated frame counts per cycle. It rejects different protocols, environment signatures,
workloads, settings, or geometry. When the benchmark protocol changes, re-run
both revisions with that protocol. The archived extension and harness can
help reconstruct old conditions; a commit ID alone does not describe a dirty
build.

Pay attention to the extension-off baseline: if it also changes substantially,
machine-load drift is a plausible explanation. Three rounds provide an initial
view of variability, not statistical proof. There is deliberately no automatic
regression percentage threshold yet; establish repeatability before making
this a pass/fail performance gate.

## What the metrics mean

`paint_ms` is elapsed time inside `Clutter::Stage::paint_view()`.
`dispatch_ms` is elapsed time inside the full frame-clock callback and includes
paint time; do not add them. Each run reports mean, median, p95 and p99. The
top-level aggregate summarizes the three **run means**, not pooled frames.
COGL journal flush marks per paint help explain changes in rendering work,
but are not GPU draw-call counts.

The runner captures Shell's own Sysprof marks directly through
`org.gnome.Sysprof3.Profiler`, without system-wide sampling, symbol decoding,
or starting the profiler UI. This also avoids the CLI capture-finalization
stall observed on the private bus. The small binary reader implements only
the documented Sysprof v1 header and timing-mark records, checks their bounds,
and ignores other records. Its format reference is Sysprof 50.0
`src/libsysprof-capture/sysprof-capture-types.h`.

These are **CPU-side elapsed scopes**, including driver waits and tracing
overhead. The benchmark does not measure GPU execution time, power, memory,
direct scanout, or real-monitor presentation deadlines. Headless scheduling
differs from the real desktop. Use it to track this fixed Overview workload
across changes, and confirm important improvements on the real session.

For changes to capture analysis:

```bash
just benchmark-check
```
