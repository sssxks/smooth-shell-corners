# RX 7900 XT shadow regression — 2026-09-10

The automatic bisect identifies **`55c53b9` as the first bad commit**.
The user's installed `effects/shaders.js` and `effects/rounded-corners.js`
were byte-identical to that commit's archived build during this investigation.
The spread/paired-blur follow-up was committed first as **`c368afe`**, leaving
a clean worktree before profiling development. It was not installed into the
user's running Shell.

## Uninstrumented GPU utilization

These are private-Shell graphics-engine counters, with the timer library
absent. Same 4K/150% fixture, four windows and fixed rendering settings:

| Revision/mode | Static idle | Move one window | Damage one window |
| --- | ---: | ---: | ---: |
| Extension off (`c368afe`) | ~0% | 1.1% | 1.1% |
| Corners only (`c368afe`) | ~0% | 1.3% | 1.3% |
| `2a08b9a`, older analytic shadow | ~0% | 1.5% | 1.5% |
| `4afaa40` | ~0% | 2.4% | 2.37% |
| `148a92c` | ~0% | 2.4% | 2.34% |
| `1097791`, immediate parent | ~0% | 2.4% | 2.34% |
| **`55c53b9`, full-resolution blur** | ~0% | **37.1%** | **36.86%** |
| `c368afe`, ordered spread + paired blur | ~0% | 23.6% | 24.2% |

The boundary is about a **16× GPU-utilization increase**, much larger than the
19% CPU paint-time increase previously reported. CPU-side paint scopes did
not capture the GPU bottleneck. The paired blur helps materially on the GPU,
but the follow-up still costs roughly ten times the parent in this workload.

This reproduces the scale of the user's ~40% observation on 4K with roughly
five windows and Mission Center's live graph visible. It is not a measurement
of that exact desktop arrangement. A genuinely static fixture submits no
shadow draws during its measured idle span; one continuously damaged window
is enough to trigger the high load.

## Where GPU time goes

At `c368afe`, the final timestamp capture measured 239 frames with GL commands
during the damage interval (243 before-paint callbacks). Per rendered frame,
summed across all four windows:

| Command group | GPU ms | Share |
| --- | ---: | ---: |
| Blur, both directions | 2.251 | 58.7% |
| Spread, both directions | 1.388 | 36.2% |
| Silhouette mask | 0.087 | 2.3% |
| Shadow composition | 0.023 | 0.6% |
| Window corner composition | 0.018 | 0.5% |
| Other draws and clears | 0.071 | 1.8% |
| **Total timed commands** | **3.837** | **100%** |

The `55c53b9` boundary trace takes about **6.13 ms per rendered frame**, with
roughly 4.42 ms in blur and 1.44 ms in spread. These are GPU timestamp sums,
not CPU scope durations. Query overhead is why bisection uses the separate
uninstrumented engine counters; see the [method](README.md).

Two concrete contributors explain the regression:

1. Shadow working viewports grew from **129×90 to 1740×1215** in this fixture,
   about **182× as many pixels**, while blur also switched from nine taps to
   a radius-dependent loop. Spread likewise runs over the enlarged textures.
2. **All four shadows are regenerated on each damaged frame.** The final
   capture records 956 calls to each mask/spread/blur pass: 4 × 239 frames.
   Only one window is damaged. Its content capture runs 239 times at 1501×976,
   while the shadow targets are cleared 1912 times (2 × 4 × 239).
   Window-content caching already avoids recapturing the other three windows;
   shadow filtering does not reuse their completed results.

The same amplification happens while moving just one window. The live graph
explains why a desktop that feels idle can continually exercise this path.

## Next implementation target

First cache each unchanged window's completed shadow, with invalidation for
source content, geometry, scale and shadow configuration. This targets the
three unchanged windows directly and preserves the current filter's output.
Then measure the remaining changed-window cost before choosing how to reduce
filter area/resolution. Any downsampling design must retain coverage and the
blur/spread regressions; returning to a point-sampled binary mask would restore
the earlier correctness bug. No further rendering changes were made as part
of this profiling/bisection task.

## Local evidence

Artifacts are ignored by Git but retained in this workspace:

- [Bisect log](../../artifacts/gpu/bisect.log)
- [Parent, uninstrumented](../../artifacts/gpu/20260910-204551-1097791c8e/results.json)
- [First bad commit, uninstrumented](../../artifacts/gpu/20260910-204528-55c53b9471/results.json)
- [Current commit, uninstrumented controls](../../artifacts/gpu/20260910-203908-c368afe654/results.json)
- [Parent timestamps](../../artifacts/gpu/20260910-204702-1097791c8e/results.json)
- [First bad commit timestamps](../../artifacts/gpu/20260910-204900-55c53b9471/results.json)
- [Current commit, final timestamp capture](../../artifacts/gpu/20260910-205222-c368afe654/results.json)
