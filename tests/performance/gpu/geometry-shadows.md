# Geometry shadows — 2026-09-10

The default custom shadow now follows the configured rounded rectangle. It no
longer captures or thresholds application alpha. Shaped apps can use the existing
exception list to bypass the complete compositor effect; no automatic pixel scan
or opaque-region heuristic was added. The global GTK4 CSS override remains
separate and still affects excluded GTK4 apps when enabled.

## Rendering and memory

The existing signed spread and Gaussian filters bake a compact tile at monitor
density. Each side retains the corner plus the finite filter support; the middle
strip stretches during resizing. An axis too short to separate its corners keeps
its actual geometry. The tile preserves the fractional phase of the right/bottom
edge, so ordinary fractional-scale resizing uses a small set of phases rather
than introducing a new full-window allocation at every step.

Content damage, movement, opacity and offsets do not enter the tile key. The
composition shader maps window coordinates into the tile and clears the unshifted
interior, keeping shadow beneath the antialiased edge without darkening the body
of translucent windows. Overview clones transform the same monitor-density tile.

Completed tiles share an LRU limited to 16 entries and 16 MiB of RGBA8 texels.
One reusable scratch framebuffer serves the spread/blur passes. Active pipelines
retain their current texture even if the LRU evicts it; this also prevents an
oversized style from rebaking every frame. Oversized tiles do not evict shared
styles. Disable clears the shared cache; GPU purge invalidates both cache and
active references, with pipeline/tile reconstruction deferred until painting.
These are ownership limits, not a cap on total driver allocations: window
content framebuffers and pending native-object reclamation still consume memory.

## Fresh comparison

Both builds were measured on Bazzite / GNOME Shell 50.4, RX 7900 XT, using the
same private 4K/150% fixture and harness. Baseline is `5d6f1b7`, including the
previous allocation-capacity fix. The geometry build is the uncommitted working
tree based on that commit; each artifact archives the exact extension ZIP and
its SHA-256. Artifact directory commit names alone do not identify that build.

| Workload | Previous, ms/rendered frame | Geometry, ms/rendered frame |
| --- | ---: | ---: |
| Move one window | 0.926 | 0.101 |
| Update one window | 0.922 | 0.097 |
| Update all four windows | 3.633 | 0.358 |

Mask, spread and blur draws are absent from the geometry build's measured spans
after warmup. Static idle has no timed GPU frames in either build. These figures
are summed GPU command durations per rendered frame, not presentation latency.
Tracing can perturb short draws; the resize comparison uses uninstrumented DRM
engine counters and per-Shell memory accounting.

The resize runner changes one window at a 16 ms interval, with two resize/rest
cycles and a final diagnostic GC. No GL timestamp tracer is loaded:

| Measurement | Previous shadows | Geometry shadows | Corners only | Extension off |
| --- | ---: | ---: | ---: | ---: |
| Resize GPU engine use | 5.9–6.0% | 0.7% | 0.4–0.5% | 0.3–0.4% |
| Peak VRAM across both resize cycles, MiB | 1,092 | 680 | 671 | 568 |
| Idle after second resize, MiB | 1,040 | 633 | 624 | 522 |

The geometry renderer's second cycle stays within the first cycle's peak to
rounding precision. Diagnostic GC does not lower the final retained figure in
either renderer. Counters are deduplicated DRM allocations for the private Shell,
not whole-device memory. Controls share the geometry run's private Shell and run
in off/corners/shadows order, so the approximately 9 MiB gap between corners and
shadows includes native/driver caching and is not a direct texture-size count.
This is one fresh paired run on this GPU, not a cross-device performance claim.

Evidence:

- [Previous renderer, GPU timestamps](../../artifacts/gpu/20260910-225211-5d6f1b7745/results.json)
- [Geometry renderer, GPU timestamps](../../artifacts/gpu/20260910-225119-5d6f1b7745/results.json)
- [Previous renderer, resize without timers](../../artifacts/gpu/20260910-225314-5d6f1b7745/results.json)
- [Geometry renderer and controls, resize without timers](../../artifacts/gpu/20260910-225407-5d6f1b7745/results.json)

## Validation

- Typecheck, lint/build, Node lifecycle/cache/geometry tests, and GJS preferences
  and GTK CSS tests.
- Production GLSL against independent CPU spread/Gaussian references, alpha
  independence, and 48 tile-versus-full-geometry comparisons at 100%, 125%, 150%
  and 200%. Maximum allowed difference remains one color level. Includes small
  axes, circular/smoothed/square corners, signed spread, blur and offsets.
- Private-compositor checks for text preservation, content updates, opacity,
  fill, overview clones, lifecycle, shadow continuity and signed spread.
- New compositor checks count actual tile bakes across resize/content changes,
  compare translucent interiors with shadows off, and reconstruct identical
  fixture pixels after GPU purge. Purge comparisons cover the fixture canvas;
  unrelated Shell actors outside it can redraw when the global signal fires.

The optional native calibration command (`uv run tests/shadows/compare.py`) fails
its old unfocused 480px holdout threshold identically on both `5d6f1b7` and this
build: RMSE 0.7727315443 alpha levels versus the required 0.7037314562 (20% of
3.5186572811). This is a pre-existing stable-grid calibration discrepancy, not a
geometry-shadow regression. No defaults or acceptance tolerances were changed.
The calibration harness was updated only to remove obsolete application-texture
uniforms and return the filtered geometry for exterior-profile comparisons.
