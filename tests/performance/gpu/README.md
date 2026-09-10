# GPU profiling and regression bisection

Bazzite / GNOME 50, RX 7900 XT at PCI `0000:03:00.0`. Run:

```sh
just profile-gpu
uv run tests/performance/gpu/run.py --no-timers
uv run tests/performance/gpu/run.py --checkout /path/to/worktree --modes shadows --no-timers
```

Allow about 90 seconds for all three modes. The runner builds the selected
checkout and starts a private headless Shell, with separate configuration,
session bus and extension settings. The desktop Shell is not modified.
The Rust library is compiled locally by `rustc`; no installed native module,
GI bindings or new package dependencies are needed. The existing Python/GJS
test infrastructure handles the fixture, lifecycle and reporting.

## What is measured

The private monitor is 3840×2160 at 150%. Four undecorated GTK windows are
1000×650 logical pixels. Corner radius 8, smoothing 1, blur 24, spread 7,
opacity 115 and zero offsets are pinned for both focus states; advanced mode
is selected wherever that setting exists. Native GTK overrides are disabled.
The probe verifies effect state, monitor geometry and window size.

Each mode (off, corners, shadows) contains one-second warmups and four-second
measurements of static idle, moving one window, and damaging one window at
roughly 60 Hz, followed by damaging all four windows together. Damage requests repaint of one actor, simulating an updating
application without needing a particular app/version. The other three windows
stay unchanged in the single-window cases. The final case exposed filtering
cost in the former content-silhouette renderer. Geometry tiles now remain valid
when sources are dirty; mask/spread/blur passes should be absent after warmup. This is useful for reproducing the compositor cost of a live
graph on an otherwise quiet desktop.

`timer.rs` interposes EGL's function resolver, then wraps the actual GL draws,
clears and blits used by this Mutter version. Shader uniforms identify the
window, mask, spread, blur and composite draws; the directional uniforms
separate horizontal and vertical passes. Pending queries and program metadata
are kept per GL context because query/program names belong to that context.
No Cogl pass is modified or flushed by the tracer.

Each wrapped command is bracketed by `glQueryCounter(GL_TIMESTAMP)`. Results
are collected only after `GL_QUERY_RESULT_AVAILABLE`, using 64-bit nanosecond
values. IDs are recycled after collection. There is no added `glFinish`, and
extra redraws drain remaining queries outside the measured spans. Unsupported
timestamps, backwards results and queue overflow abort the capture rather
than silently returning incomplete timings. See the
[Khronos timer-query specification](https://registry.khronos.org/OpenGL/extensions/ARB/ARB_timer_query.txt).

The kernel's `drm-engine-gfx` counter is sampled independently from the private
Shell's fdinfo. Duplicate descriptors with the same DRM client ID are counted
once; other GPUs and clients without engine counters are excluded. The delta
of engine nanoseconds divided by wall nanoseconds yields the process's graphics
engine utilization. This is not device-wide utilization from Mission Center.

`--no-timers` omits the preload library, measures the same workload through
kernel counters, and reports GPU timestamp fields as null. Use this mode for
bisection and to check tracer overhead. Timers can perturb short draws: in the
initial comparison, tracing changed the old renderer from 2.3% to 3.6% engine
use, but the expensive current renderer stayed near 24% with/without tracing.

A frame count here means a Clutter before-paint callback; some callbacks issue
no GL commands. `frames_with_gpu_commands` distinguishes those cases. Sum of
command timings excludes unwrapped work, query overhead and gaps between GL
commands; it is not presentation latency. Reports retain the original callback-normalized
`gpu_ms_per_frame`, and also provide `gpu_ms_per_rendered_frame` and its
nearest-rank p95 using only callbacks with timed commands. These are null
when there are no timed frames. The command-line summary uses rendered frames.
Other desktop processes share the
physical GPU, so use broad regression thresholds and verify boundary commits.
The tracer targets the draw entry points used by the installed Mutter 50.4,
not arbitrary OpenGL applications.

## Artifacts and checks

Each `tests/artifacts/gpu/TIMESTAMP-COMMIT/` contains:

- `results.json`: per-mode/workload utilization, command timing and pass totals.
- `draws.csv`: CPU monotonic timestamp, EGL context, GL program, pass label,
  viewport width/height, GPU duration in nanoseconds. Present only with timers.
- `spans.json` and `engines.json`: raw measurement intervals, paint callback
  timestamps and kernel counter samples.
- `extension.zip`, `harness/`, compiled tracer, metadata and `shell.log`.

The runner archives the actual build and checks that profiling code did not
change during recording. Old framebuffer-dependency warnings are retained and
counted; rejecting them would prevent profiling the buggy historical renderer.

`just profile-gpu-check` tests nanosecond conversion, interval boundaries,
empty paint callbacks, absent timestamps, duplicate DRM descriptors and safe
bisect skips on capture failure.
The successful real-Shell captures validate EGL interception, pass labels,
query completion and device selection; CPU-only tests cannot validate those.

## Automated bisect

Use a separate checkout and run the profiling harness from the current repo,
so old commits do not need to contain the profiler. On this host:

```sh
git worktree add --detach /var/home/bazzite/repos/ssc-gpu-bisect c368afe
ln -s /var/home/bazzite/repos/smooth-shell-corners/node_modules /var/home/bazzite/repos/ssc-gpu-bisect/node_modules
cd /var/home/bazzite/repos/ssc-gpu-bisect
git bisect start c368afe 2a08b9a
timeout 600s git bisect run uv run /var/home/bazzite/repos/smooth-shell-corners/tests/performance/gpu/bisect-check.py
git bisect log
git bisect reset
```

The checker uses uninstrumented damage-mode utilization: over 10% is bad,
otherwise good. This threshold is specific to the fixture and measured
1.5%/24.2% endpoints on this GPU. A harness/build failure exits 125, never
marks a revision good. For another regression, measure endpoints and choose
a new threshold first. Name the checker `bisect-check.py`, not `bisect.py`,
which would shadow Python's standard-library module used by the analyzer.

See [the measured regression and pass breakdown](results.md), and the subsequent
[geometry-shadow implementation and fresh comparison](geometry-shadows.md).

## Resize memory regression

Run `uv run tests/performance/gpu/run.py --resize --no-timers` to repeat
resize/idle cycles and measure per-Shell allocated/resident VRAM and GTT through
the same deduplicated DRM clients. Allow about two minutes for all three modes.
The final GC is a diagnostic in the private Shell only; no production GC is added.
See [the reproduction, fix and measured memory plateau](resize-memory.md).
