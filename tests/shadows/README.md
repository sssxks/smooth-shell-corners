# Shadow calibration (Bazzite / GNOME 50)

Custom shadows now use [shared geometry tiles](../performance/gpu/geometry-shadows.md).
The spread and Gaussian kernel remain the same; application alpha no longer
defines the caster. The calibration harness uses a fixed exterior canvas around
that geometry. The current unfocused holdout threshold fails identically on
the previous renderer and geometry renderer; see the comparison report above.

For the stable blur, spread-ordering fix and performance comparison, see
[the blur/spread follow-up](blur-spread.md). The calibration figures below
describe the earlier renderer.

Run `just calibrate-shadows`. The runner uses GTK/GSK to render the normal
window shadow layers from the installed libadwaita version's source, then
fits the extension's **actual GLSL** using the existing EGL test harness.
It writes PNG comparisons (left: native, middle: old, right: fitted) and
`results.json` to `tests/artifacts/shadows/`. No desktop settings are changed.

Reference: libadwaita **1.9.3**, commit
`5789add99c79cee0fae624b56706c7c0bea7fb2b`,
[`src/stylesheet/widgets/_window.scss`](https://github.com/GNOME/libadwaita/blob/1.9.3/src/stylesheet/widgets/_window.scss).
GTK **4.22.4** passes CSS blur/spread directly to the GSK outset-shadow node
([`gtkcssshadowvalue.c`](https://github.com/GNOME/gtk/blob/4.22.4/gtk/gtkcssshadowvalue.c)).
This is a rendering of the native shadow definitions, not a screenshot of
an application with a possibly overridden user theme.

Normal-contrast native layers (x/y offsets are all zero):

| State | Blur / spread / alpha |
| --- | --- |
| Focused | 14 / 5 / 15%, 5 / 2 / 10%, 0 / 1 / 5% |
| Unfocused | 10 / 5 / 8%, 0 / 1 / 5% |

We measure alpha at the middle of all four straight edges, from 1.5 to 47.5
logical pixels outside the window. This excludes the native 1px outline.
Joint fitting over 256, 320 and 400px windows reduces sensitivity to the
extension's former downsample-grid alignment. The harness now uses the same 80px padding,
RGBA8 intermediate images, stable pixel grid, variable-width separable Gaussian
blur and spread as the effect. We search integer blur 4–30 and spread −3–10,
solving the least-squares opacity for each pair and rounding it to 0–255.
Offsets remain zero to match the native symmetry.

Historical measurements with the former nine-tap downsampled blur, at 100%
strength / 1× rendering scale on this machine (not recalibrated for the stable-grid blur):

| State | Old RMSE (alpha × 255) | New RMSE | New opacity / blur / spread / x / y |
| --- | ---: | ---: | --- |
| Focused | 7.842 | 0.574 | 115 / 23 / −2 / 0 / 0 |
| Unfocused | 3.638 | 0.205 | 18 / 13 / 7 / 0 / 0 |

The straight-edge error falls by about 93% and 94%, respectively. This is a
single-layer approximation: it does not reproduce the native outline, corner
geometry, high-contrast styles or special dialog shadows. Both reference and
comparison fixtures use an 8px circular corner to isolate the shadow profile.
The larger fitted opacity is **not** the visible edge opacity; negative spread
and the extension's different blur kernel change how much reaches the exterior.
No extra runtime shadow layers or GPU passes were added.

Independent validation at 480 and 640px uses the committed schema defaults,
not the fitted candidate. Focused RMSE is 0.572 at both sizes; unfocused RMSE
is 0.177 and 0.214. The runner requires at least an 80% reduction over the old
defaults on each validation case. These figures characterize 1× rendering;
the compositor regression separately checks shadow continuity at 100%, 125%,
150% and 200% rendering scales.

Basic mode uses `shadow-strength` (0–200%, default 100%) and reads the calibrated
schema defaults independently of saved manual values. With `t = strength / 100`
and preset opacity `a` in 0–1, the initial mapping is:

- Opacity: `round(255 × (1 − (1 − a)^t))` (increasing optical density).
- Blur: `presetBlur × (0.75 + 0.25t)` (modest change in extent).
- Spread: `presetSpread + 2(t − 1)` (slightly tighter or fuller edges).
- Offsets: the preset's zero offsets.

At 0%, opacity is zero; at 100%, the calibrated values are exact. Above 100%,
the curve emphasizes density instead of excessive blur. This is an initial
perceptual mapping for visual tuning, not a claim of perceptual linearity.

`shadow-advanced` selects manual mode, using the saved opacity, blur, spread and
offsets directly. The basic slider disappears and the manual controls appear.
Both modes retain their own settings with no conversion on switching. The
maximized-shadow setting belongs to advanced mode; basic mode uses false.
Custom shadows still use the existing enable switch.
