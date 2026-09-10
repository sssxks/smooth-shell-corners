# GPU rectangular-body detection — 2026-09-10

This follow-up to `cabf931` identifies a rectangular app body without constructing
an alpha silhouette or reading pixels back to the CPU. The baseline shared-tile
implementation is committed separately; measurements below use its isolated
checkout and the current implementation with the same harness. Artifact folders
contain the exact extension ZIP, hash, harness and dirty status, so their shared
`cabf931` suffix does not imply identical code.

## Design and limits

Only NORMAL, DIALOG and MODAL_DIALOG windows receive the effect. UTILITY,
TOOLBAR and SPLASHSCREEN bypass it without allocating an effect framebuffer.
There are no app-specific exceptions for DingTalk.

A 4×1 RGBA32F target scans three rays per side, at most 64 logical pixels inward,
for consistent opaque edges. A 1×1 RGBA32F pass checks an interior grid and the
excluded margins. The result stores four insets; a negative first component
means preserve the app visually. Uniformly translucent full rectangles can
retain zero insets. The fill, clipping, border and shadow shaders consume this
texture directly. These targets hold 80 bytes of texels, **not** 80 bytes of
actual driver allocation.

`BodyDetector` owns the two targets and the retry timer together, so window
teardown cancels pending work and source textures are not retained by the probes.
There are at most three startup checks, then one check after resizing settles
for 180 ms. Content damage and movement do not rescan. During resize the previous
insets remain in use. Unsupported floating-point targets preserve app pixels.
Sparse samples cannot prove arbitrary shapes rectangular: small holes and shape
changes after startup without geometry changes can escape detection. This is a
bounded heuristic, not an exact bounding-box reduction over every pixel.

Large windows retain shared shadow tiles. When possible insets could make
opposite corners overlap, the small-window path bakes a private full-size tile;
it rebakes on resize. A regression covers switching from this private tile to
a shared tile. A rejected NORMAL window still owns a content framebuffer and
executes pass-through compositing; only the window-type filter removes the whole
effect. The global GTK CSS override remains independent of these decisions.

## GPU timestamps

Bazzite, GNOME Shell 50.4, RX 7900 XT; private 3840×2160 Shell at 150%, four
1000×650 logical windows. Values sum GPU command durations per rendered frame,
including captured commands outside the effect; they are not presentation times.
Each row is one paired recording and small draws are sensitive to tracing and
GPU clock variation.

| Fixture / workload | `cabf931`, ms | GPU body detection, ms |
| --- | ---: | ---: |
| Opaque / move one | 0.103 | 0.115 |
| Opaque / update one | 0.098 | 0.110 |
| Opaque / update all four | 0.408 | 0.403 |
| Native transparent margins / move one | 0.101 | 0.109 |
| Native transparent margins / update one | 0.097 | 0.105 |
| Native transparent margins / update all four | 0.429 | 0.487 |

Static idle has no timed draws. Neither detection nor shadow mask/spread/blur
appears in measured move or damage spans. Across each complete new trace, four
windows produce exactly 12 probe and 12 validation draws during startup. Mean
probe+validation time per check is 0.048 ms for opaque windows and 0.079 ms for
native margins. These numbers exclude the startup content capture and setup.
After warmup, the new private Shell retains about 2 MiB more VRAM than baseline
(roughly 542 versus 540 MiB); this includes driver/native allocation overhead.

Evidence:

- [Opaque baseline](../../artifacts/gpu/20260910-235146-cabf931b04/results.json)
- [Opaque detection](../../artifacts/gpu/20260910-235225-cabf931b04/results.json)
- [Transparent-margin baseline](../../artifacts/gpu/20260910-235337-cabf931b04/results.json)
- [Transparent-margin detection](../../artifacts/gpu/20260910-235300-cabf931b04/results.json)

## Resize and memory

Two uninstrumented recordings per build resize one transparent-margin window
at 16 ms intervals, twice per recording, with rests and a final diagnostic GC.
These dimensions exercise the shared-tile path, not small private shadow tiles.

| Measurement | `cabf931` | GPU body detection |
| --- | ---: | ---: |
| Resize graphics-engine use | 0.8% | 0.7–0.8% |
| Peak VRAM per recording, MiB | 682 / 718 | 720 / 720 |
| Retained after second resize, MiB | 631 / 609 | 611 / 555 |

The baseline's 36 MiB peak variation and both builds' changing retained figures
show why a single resize peak is not a reliable allocation-cost estimate. The
highest observed peaks differ by about 2 MiB. Neither build grows its peak in
the second resize cycle; diagnostic GC does not reduce its final retained
figure. These are per-Shell deduplicated DRM counters, not whole-device VRAM or
a cross-device guarantee. The private small-window fallback is visually tested
but its resize cost is not quantified by this workload.

- [Detection, first resize recording](../../artifacts/gpu/20260910-235414-cabf931b04/results.json)
- [Baseline, first resize recording](../../artifacts/gpu/20260910-235459-cabf931b04/results.json)
- [Baseline, second resize recording](../../artifacts/gpu/20260910-235559-cabf931b04/results.json)
- [Detection, second resize recording](../../artifacts/gpu/20260910-235642-cabf931b04/results.json)

## Validation

- Typecheck, lint, build and 26 Node tests, including bounded startup attempts,
  resize debounce, timer teardown and private/shared shadow-cache transitions.
- GPU shader fixtures for opaque/translucent rectangles, native shadow margins,
  asymmetric insets, holes, islands and overlays at four scales. Readback is
  test-only.
- Real GTK dialog screenshots match manual 16px body bounds at 100%, 125%, 150%
  and 200%, including 320×240 windows with clamped radii. Ordinary repaint does
  not change detection revision.
- A real GTK overlay has no effect when classified UTILITY. Reclassifying it
  NORMAL still preserves its pixels through GPU rejection. Type changes occur
  only in the private test compositor.
- Existing text, lifecycle, clone, translucent-interior, GPU-purge and shadow
  continuity regressions pass. The purge comparison excludes Shell's changing
  clock while retaining the entire fixture window and shadow.

Reproduce with `npm run check`, `uv run tests/unit/body-render.py`,
`uv run tests/unit/render.py` and
`timeout 300s uv run tests/compositor/compositor.py`. Profiling adds `--body` to
`uv run tests/performance/gpu/run.py --modes shadows`; use `--checkout PATH` for
baseline and `--resize --no-timers` for uninstrumented resize counters.
