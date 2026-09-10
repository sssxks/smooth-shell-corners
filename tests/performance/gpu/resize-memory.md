# Resize VRAM regression — 2026-09-10

Reproduced against renderer `21eb293` in a private GNOME Shell on the RX 7900 XT.
Four windows, 4K at 150%, blur 24/spread 7; one window repeatedly changes width
800–1276 and height 500–797 at a 16 ms timer interval. Each resize interval has
a one-second warmup and four-second measurement, followed by returning to
1000×650 and idling. A second cycle checks whether memory continues growing.

`uv run tests/performance/gpu/run.py --resize --no-timers` runs extension-off,
corners-only and shadows controls. The final diagnostic GC is confined to the
private test Shell. Production code never forces GC.

## Observations

Numbers are the private Shell's deduplicated DRM `memory-vram` accounting,
not whole-device usage. Resident-VRAM counters agreed in these captures.

| Point | Before, MiB | Fixed, MiB |
| --- | ---: | ---: |
| Initial idle | 739 | 737 |
| First cycle including following idle, peak | 14,233 | 1,037 |
| Second resize, peak | 13,476 | 1,035 |
| Idle after second resize | 13,822 | 988 |
| After diagnostic GC | 8,345 | 988 |

The original renderer created an exact-size source target and two exact-size
shadow targets whenever window dimensions changed. At 4K these allocations are
large, and repeated resizing creates them faster than reclamation keeps up.
Dropping JS references is not immediate GPU-resource reclamation; the diagnostic
GC reclaimed several GiB, but did not return the original run to its starting
level. These measurements do not fully distinguish the remaining native-object
retention from driver caching.

With capacity reuse, the second cycle stays within the first cycle's peak,
without diagnostic collection. Some retained capacity and native/driver caching
remain: this is not a promise to return immediately to the initial idle number.
Extension-off controls stayed around 522–573 MiB during the same resize pattern.

## Fix and design

- Reuse source and shadow targets in 128-physical-pixel allocation blocks.
  Keep existing capacity until an axis no longer fits or shrinks to half its
  capacity. This avoids allocating on every pixel step or oscillating at a
  block boundary, while allowing large reductions to reclaim capacity.
- Track active source dimensions separately, so resizing within a reused
  allocation still captures new content and invalidates the cached shadow.
- Crop source and shadow composition to the active image. The source crop is
  necessary to preserve fractional-scale edge rendering.
- Render shadow passes only over the active viewport. Map filter coordinates
  into the allocation and clamp to the active texel centres, matching texture
  edge clamping without sampling unused capacity.
- Preserve the physical sampling density, captured alpha silhouette, blur,
  spread and all settings. There is no downsampling or forced disposal of Cogl
  objects that may still be referenced by queued painting.

An initial implementation filtered the entire capacity; it fixed memory growth
but raised resize GPU use to about 9%. The retained implementation filters only
the active image and measured **5.9–6.0%**, compared with **5.7–6.0%** before.

Normal single-window damage measured **0.937 ms/rendered frame**, versus
0.913 ms in the preceding optimization report. All-window damage measured
**3.538 ms**, versus 3.516 ms. These small differences are not a demonstrated
speedup; the fix addresses memory growth while keeping GPU time close to the
previous renderer.

## Validation and evidence

- Typecheck, lint/build, 28 Node tests and profiler accounting checks passed.
- Six shader regressions passed. Independent Gaussian and spread references
  now test a smaller active image inside a larger texture filled with nonzero
  unused pixels, including signed/fractional spread and large blur radii.
- The full private-compositor suite passed: text preservation, content updates,
  opacity, fill, clones, lifecycle, shadow continuity and spread.
- New compositor comparisons check resizing within capacity, growth and shrink
  against fresh allocations at 100%, 125%, 150% and 200%; maximum allowed
  difference is one color level. Existing tolerances were not relaxed.

Artifacts retain exact builds and harnesses; the fixes were uncommitted during
capture, so the directory hash is the baseline HEAD, not the measured source:

- [Original resize run](../../artifacts/gpu/20260910-220415-21eb29383c/results.json)
- [Allocation-reuse controls, before active-area refinement](../../artifacts/gpu/20260910-221155-21eb29383c/results.json)
- [Final resize memory and uninstrumented GPU use](../../artifacts/gpu/20260910-221603-21eb29383c/results.json)
- [Final normal-workload GPU timestamps](../../artifacts/gpu/20260910-221535-21eb29383c/results.json)
