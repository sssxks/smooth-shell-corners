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

## Initial implementation target (completed below)

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

## Optimization 1: reuse completed shadows

Cache invalidation follows actual source damage (including resize, pixel phase,
clone scale and GPU purge) and filter inputs. Repeated settings refreshes and
nonzero opacity changes reuse the result. Disabling shadows while content
changes also invalidates it. No shader or resolution change.

The isolated repeat measured **1.039 ms/rendered damage frame**, versus
3.837 ms before caching; uninstrumented graphics-engine use fell from
24.2% to **7.1%** (moving: 7.2%). Each filter now runs once per rendered frame,
instead of four times. Blur still costs 0.559 ms and spread 0.347 ms/frame.

Validation: typecheck, lint, 26 Node tests (including cache invalidation),
GJS tests, shader regressions and the full private-compositor visual/lifecycle
suite passed. The initial exploratory capture is excluded because another GPU
test was started around its completion; the following captures ran in isolation:

- [Cache timestamps](../../artifacts/gpu/20260910-214507-0662a3c40a/results.json)
- [Cache without timers](../../artifacts/gpu/20260910-214530-0662a3c40a/results.json)

These artifacts were taken with the cache changes uncommitted; their archived
extension and source status identify the measured build.

## Optimization 2: stop spread at its exact extremum

Dilation stops at alpha 1 and erosion at alpha 0: remaining samples cannot
change the answer. This preserves arbitrary silhouettes and the fractional
spread samples. No quality or customization tradeoff.

GPU commands fell to **0.926 ms/rendered damage frame**, with spread down
from 0.347 to **0.218 ms**. Uninstrumented engine use was **6.3%** (move 6.4%).
The gain depends on alpha content and spread sign; fully opaque interiors
still need all samples during erosion.

An independent CPU max/min reference covers both axes, fractional and signed
radii, opaque/transparent regions, random alpha and outside-texture sampling.
It passes within one alpha quantization level, alongside Gaussian, monotonic
blur, existing shader tests, Node checks and full compositor tests.

- [Spread timestamps](../../artifacts/gpu/20260910-214729-c46ff00a4c/results.json)
- [Spread without timers](../../artifacts/gpu/20260910-214752-c46ff00a4c/results.json)

## Rejected experiment: recursive Gaussian weights

Generating Gaussian weights by recurrence passed the CPU convolution reference,
including added radii 480 and 960. It did not provide a repeatable speedup:
timed commands remained about 0.92 ms/rendered frame. One uninstrumented run
looked promising at 5.7%, but alternating repeat captures measured direct
exponentials at 6.2% and 6.1%, versus recurrence at 6.5% and 6.4%.
The recurrence was dropped; the larger-radius reference checks remain.

- [Recurrence timestamps](../../artifacts/gpu/20260910-214917-5ce73e00c4/results.json)
- [Direct repeat 1](../../artifacts/gpu/20260910-215031-5ce73e00c4/results.json)
- [Recurrence repeat 1](../../artifacts/gpu/20260910-215054-5ce73e00c4/results.json)
- [Direct repeat 2](../../artifacts/gpu/20260910-215117-5ce73e00c4/results.json)
- [Recurrence repeat 2](../../artifacts/gpu/20260910-215140-5ce73e00c4/results.json)

## Final comparison: freshly rerun baseline and optimized build

Same RX 7900 XT, 4K/150%, four 1000×650 windows, blur 24, spread 7.
Baseline renderer is `c368afe`; optimized renderer is `5ce73e0`.
Both use the expanded, identical profiling protocol. GPU command timings are
sums per rendered frame; engine use comes from separate runs without timers.

| Workload | Before mean / p95 ms | After mean / p95 ms | Before GPU use | After GPU use |
| --- | ---: | ---: | ---: | ---: |
| move | 3.847 / 3.855 | 0.928 / 1.173 | 23.9% | 6.0% |
| damage | 3.849 / 3.866 | 0.913 / 0.913 | 23.9% | 5.9% |
| damage-all | 4.086 / 4.100 | 3.516 / 3.562 | 25.6% | 22.2% |

Static idle submits no timed commands, with approximately zero engine use
in both builds. Single-window damage is **76% cheaper in GPU command time**.
All-window damage is **14% cheaper**; caching cannot remove that filtering work.
These are private-Shell measurements, not total device usage or presentation
latency. Full control traces measured 0.029 ms/frame with the extension off and
0.065 ms/frame with corners only under single-window damage.

Final single-window damage profile:

| Pass | GPU ms/rendered frame | Share |
| --- | ---: | ---: |
| Blur | 0.560 | 61.4% |
| Spread | 0.216 | 23.7% |
| Silhouette mask | 0.023 | 2.5% |
| Shadow composition | 0.026 | 2.9% |
| Window corner composition | 0.019 | 2.1% |
| Other draws and clears | 0.068 | 7.5% |

There are 240 rendered damage frames and 240 calls to each filter, versus 960
before optimization. All-window damage returns to 960 calls per filter.
Both fresh timestamp captures report zero framebuffer dependency warnings.

Final validation: typecheck, lint/build, 26 Node tests, three profiler accounting
tests, six shader regression tests including CPU Gaussian/spread references,
GJS tests and the real compositor visual/lifecycle suite. Production rendering
code is unchanged since the spread commit; the final run also exercises all
three extension modes and the added simultaneous-damage workload.

Artifacts:
- [Optimized timestamps and controls](../../artifacts/gpu/20260910-215233-5ce73e00c4/results.json)
- [Optimized without timers](../../artifacts/gpu/20260910-215348-5ce73e00c4/results.json)
- [Fresh baseline timestamps](../../artifacts/gpu/20260910-215416-c368afe654/results.json)
- [Fresh baseline without timers](../../artifacts/gpu/20260910-215444-c368afe654/results.json)

## Remaining opportunities and tradeoffs

The retained changes keep the full-resolution mask and Gaussian sample grid,
all shadow controls and captured source alpha. They add no render targets.
The existing transparency, fill, positive/negative spread, blur monotonicity,
fractional scaling, clone and lifecycle regressions passed.

The new `damage-all` workload is deliberately unfavorable to caching: every
source is dirtied at every tick. Each shadow filter runs four times per rendered
frame again. The optimization therefore does not make continuously changing
silhouettes cheap; the single-window result should not be generalized to four
simultaneous animations.

Further work, in order of interest:

1. **Avoid filtering after RGB-only changes.** Current source damage is
   conservative: even an unchanged alpha silhouette invalidates the shadow.
   A reliable alpha-change detector, or a proven opaque-shape fast path with
   the current silhouette path as fallback, could avoid much of the remaining
   work without a visual tradeoff. It must handle changing transparency and
   account for detection cost; CPU readback/synchronization could erase gains.
2. **Prefilter before reducing blur resolution.** A fixed grid and coverage
   filtering after the full-resolution silhouette/spread could reduce the
   dominant blur bandwidth. That would trade some small-scale blur accuracy
   and needs pixel-difference and monotonicity validation. Point-sampling a
   binary mask at a blur-dependent resolution is ruled out by the earlier bug.
3. **Optimize large/negative spread separately.** Early termination helps only
   when the extremum is reached. A multi-pass max/min filter could reduce work
   for large radii, but requires measuring extra passes and retaining fractional
   endpoints and outside-zero behavior.

No customization or quality sacrifice was needed for the two retained changes.
There is no evidence from these measurements that removing settings alone would
solve the remaining bottleneck. The current profile points to avoiding filter
work or reducing its pixel/sample count.
