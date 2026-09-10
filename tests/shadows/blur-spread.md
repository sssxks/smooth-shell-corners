# Blur and spread follow-up (Bazzite / GNOME 50, 2026-09-10)

Subsequent [GPU profiling and bisection](../performance/gpu/results.md) found
a severe GPU regression at `55c53b9` that the CPU measurements below missed:
2.34% → 36.86% graphics-engine use in the fixed 4K damage workload.

Commit `55c53b9` fixed blur-dependent silhouette jumps by keeping the working
textures at paint resolution. Its predecessor resized a binary mask as blur
changed, shifting the apparent edge. Retaining the stable grid is necessary
to preserve that fix, including the user's reported Chromium improvement.

## Spread correctness

The compositor regression reproduces a separate bug in `55c53b9`: at blur 24,
spread −12, 0 and +12 produce identical exterior straight-edge coverage
(3.161 opaque-equivalent logical pixels at 1×). Without blur, positive spread
works. Both the parent and `55c53b9` emit Cogl framebuffer dependency errors.

The effect alternates between two textures. Cogl journals the draw calls;
queuing a write into a texture whose consumer is still queued creates a
circular dependency. The spread result is lost when blur reuses the targets.
Submit the consumer before overwriting its input. This uses
[`Cogl.Framebuffer.flush()`](https://mutter.gnome.org/cogl/method.Framebuffer.flush.html),
which submits commands without waiting for GPU completion. No extra textures
or filter passes are needed.

After fixing the ordering, the same three spread settings produce coverage
0.216, 3.161 and 12.208 on both axes. The compositor test also covers 150%
scale and rejects the framebuffer-dependency errors in the Shell log.

## Gaussian optimization

Two adjacent Gaussian taps with weights `a` and `b` can be replaced by one
linearly filtered sample at `i + b/(a+b)`, multiplied by `a+b`. Mirroring
these pairs preserves the discrete Gaussian and its clamped boundary handling.
For radius 24, each pass uses 25 texture lookups instead of 49. The mask,
spread, resolution and Gaussian width remain the same.

The EGL test compares the production shader to an independent CPU Gaussian
convolution on random alpha values. Both axes pass within one 8-bit alpha
level for radii 0.05–240, including fractional radii and odd/even support.
The tiny-radius case checks weight underflow during scaled window animations.
The blur 4–50 progression tests also pass at 100%, 125%, 150% and 200% with
negative, zero and positive spread. The full compositor suite passes.

Analytic rounded-rectangle shadows could avoid filtering, but would lose
arbitrary alpha silhouettes. Downsampling needs proper coverage filtering
to avoid the original edge jumps. Pairing samples is a smaller optimization
whose filter can be checked directly against the existing Gaussian.

## Performance method

Run the unchanged `tests/performance/run.py` separately on the parent,
`55c53b9`, and the follow-up. Run these sequentially, without concurrent
compositor tests. Each run contains three balanced rounds of extension off,
corners only and shadows. The comparison tool verifies matching protocol,
environment, settings and geometry.

The workload is six 400×260 windows on a 1920×1080 headless monitor at 150%,
with Overview show/hide animations. The saved settings use basic shadow mode
at 100%; the manual values in the probe are inactive. These are CPU-side
elapsed paint/dispatch scopes, not GPU timings or presentation latency, and
do not characterize a full-screen window at maximum blur/spread.

Median of the three run means, in milliseconds:

| Build | Off paint | Corners paint | Shadows paint | Shadows dispatch |
| --- | ---: | ---: | ---: | ---: |
| Parent `1097791` | 0.280 | 0.567 | 1.386 | 2.306 |
| Blur fix `55c53b9` | 0.314 | 0.587 | 1.654 | 2.560 |
| Paired blur + ordered spread | 0.295 | 0.584 | 1.506 | 2.537 |

The original fix increases shadow-mode paint time by 19.3% and dispatch time
by 11.0%. The follow-up lowers paint time by 8.9% versus that commit, but
remains 8.6% above the parent. Dispatch time improves only 0.9% versus the
commit. Shadow paint run-mean ranges are 1.358–1.429, 1.631–1.721 and
1.397–1.633 ms respectively. Baseline drift and overlapping ranges mean
these runs do not establish a precise or universal speedup.

The follow-up also restores previously missing spread work and eliminates
dependency-error logging, so this is an end-to-end comparison of the builds,
not an isolated measurement of paired sampling. No JavaScript or framebuffer
dependency errors occur in its benchmark log.

Local artifacts include raw Sysprof captures, settings, archived extension
builds and renderer/environment metadata:

- [Parent](../artifacts/benchmark/20260910-195418-1097791c8e/results.json)
- [Committed blur fix](../artifacts/benchmark/20260910-195628-55c53b9471/results.json)
- [Follow-up](../artifacts/benchmark/20260910-200010-55c53b9471/results.json)

Reproduce the comparison with `uv run tests/performance/compare.py` and the
two corresponding `results.json` paths. Artifacts are ignored by Git; the
archived follow-up extension identifies the measured uncommitted changes.
