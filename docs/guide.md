# Settings, troubleshooting and development

[Back to the project](../README.md). Run development commands from the repository root.

## Configuration

### Corners tab

| Setting | Description | Default |
|:--------|:------------|:--------|
| Radius | Corner radius in logical pixels | `8` |
| Smoothing | `0` = circle · `1` = squircle (superellipse) | `1.0` |
| Clip padding | Extra gap between the window edge and the clip boundary | `1` |
| Fill clipped edges | Extend pixels from inside the padding to the detected window body | on |
| Border width | Positive = inner border · Negative = outer · `0` = none | `0` |
| Border colour | RGBA colour picker | `(0.8, 0.8, 0.85, 1)` |
| Keep rounded when maximised | Apply corners even when a window fills the screen | on |
| Keep rounded when full-screen | Apply corners in full-screen mode | off |

To hide a 2px application border without opening seams between tiled windows,
enable **Fill clipped edges**, set the four padding values to **2**, and set
**Border width** to **0**. Padding follows the extension's monitor scaling.
The shader repeats the nearest interior row/column without resizing the content;
the corner mask and custom shadow use the detected body before clip padding.

Content touching the sampled edge (such as scrollbars or images) will stretch
across the narrow strip. Transparent app backgrounds and client-drawn rounded
corners can still show through: this samples the actual app pixels, not an
inferred background color. Rounded corners and gaps configured in your tiling
extension remain. Turning the option off restores ordinary clipping.

### Shadow tab

| Setting | Description | Default |
|:--------|:------------|:--------|
| Custom shadow | Replace the native shadow with a rounded one | off |
| Shadow strength | Basic mode: adjust visual presence for both focus states | 100% (0–200%) |
| Use advanced settings | Switch to independent manual parameters and “Shadow when maximised” | off |

Basic mode uses a preset curve for opacity, blur and spread: 0% gives no
shadow, 100% approximates the native look, and higher values add density with
a modest increase in extent. Advanced mode replaces the strength slider with
individual controls. Each mode remembers its own values; switching never
copies, multiplies or resets them. Advanced mode initially uses the defaults
below; existing manual adjustments are preserved.

Defaults approximate libadwaita 1.9.3 using the existing single-layer renderer:

|  | Focused | Unfocused |
|:-|:--------|:----------|
| Opacity | 115 / 255 | 18 / 255 |
| Blur | 23 px | 13 px |
| Spread | −2 px | 7 px |
| X / Y offset | 0 / 0 px | 0 / 0 px |

See [measurement method and results](../tests/shadows/README.md), or reproduce
with `just calibrate-shadows`.

Custom shadows follow the configured rounded rectangle, independent of app
pixels. A translucent rectangular app can keep its corners and shadow without
casting shadows around its text or darkening its interior.

### Applications tab

| Setting | Description | Default |
|:--------|:------------|:--------|
| Replace native GTK4 corners | Let the extension shape GTK4 windows; restart apps after changes | on |
| Leave libadwaita windows unchanged | Use their toolkit-provided corners instead of this extension | off |
| Leave libhandy windows unchanged | Same, for legacy Handy apps | off |
| Whitelist mode | Treat the exception list as a whitelist instead of a blacklist | off |
| Exception list | One application identifier per line (`WM_CLASS`, Wayland app ID, or desktop ID) | — |

Normal windows and dialogs automatically check for a rectangular body. Transparent
decoration margins can be removed before applying corners and shadows to that
body. Utility windows, toolbars and splash screens receive no window effect.
If the GPU check cannot identify a body, clipping, padding fill, corners, borders
and custom shadows pass through without changing the app's appearance.

Detection is a bounded sampling heuristic, not a complete silhouette scan. It
searches at most 64 logical pixels inward and checks a sparse interior grid;
tiny holes may escape detection. Later content changes are checked within roughly
one second while the window is painted.
The **Exception list** remains available as an explicit override. To preserve
an app's native GTK4 styling too, turn off **Replace native GTK4 corners** and
restart it; that CSS override applies globally, including to skipped apps.

#### Native GTK4 corner removal

Enable **Replace native GTK4 corners** to provide rectangular window content and
remove the GTK client shadow, so the shader can shape the window without
sampling libadwaita's transparent native corners. This
makes **Leave libadwaita windows unchanged** inapplicable while active, preserving
your exclusion preference for when you turn it off. Your radius, smoothing and
padding still apply.

The extension manages a marked `window.csd { border-radius: 0; }` block in:

- `$XDG_CONFIG_HOME/gtk-4.0/gtk.css` (normally `~/.config/gtk-4.0/gtk.css`)
- `~/.var/app/<app-id>/config/gtk-4.0/gtk.css` for existing Flatpak app directories

GTK reads these files when apps start. **Restart affected apps after enabling,
disabling, or disabling the extension.** This includes the preferences window.
The override affects GTK4 client-decorated windows generally, including windows
excluded by the extension's application filters. It does not change GTK3,
libhandy, Qt, or Electron styling, and does not target in-app dialogs or popovers.
Apps using their own clipping may still need separate handling. No Flatpak
permissions are changed; apps with custom configuration paths may not pick up
the override. Toggle the setting off/on after adding new Flatpak apps.

Existing CSS and edits outside our marked block are preserved. Disabling removes
the block from each configuration; an otherwise empty `gtk.css` can remain.
If a file cannot be updated, GNOME shows an error. Files successfully changed
during a failed enable are cleaned up. If Shell crashes or the extension files
were removed without disabling it, restore the CSS from this checkout with:

```bash
gjs -m dist/restore-native-radius.js
```

Then restart apps. This cleanup does not change the switch preference; turn it
off as well if you do not want the override reapplied next time the extension loads.

#### Reusing settings from the original extension

The new extension starts with separate preferences. To copy your existing tuning
once, while Smooth Shell Corners is disabled:

```bash
dconf dump /org/gnome/shell/extensions/rounded-windows/ > /tmp/ssc-old-settings.ini
dconf load /org/gnome/shell/extensions/smooth-shell-corners/ < /tmp/ssc-old-settings.ini
```

**Finding a window identifier:**
Use the X11/XWayland `WM_CLASS` when available. For Wayland-native apps, use the app ID or desktop file ID shown by GNOME Shell / your launcher entry.

---

## Troubleshooting

### No rounded corners appear

1. Make sure the extension is **enabled** (`gnome-extensions list --enabled | grep smooth-shell-corners`).
2. Check the journal for errors:
   ```bash
   journalctl -b /usr/bin/gnome-shell | grep -E "SmoothShellCorners|JS ERROR"
   ```
3. The app may be libadwaita — disable **Leave libadwaita windows unchanged** in settings.

### Corners still square on one specific app

Some apps use a custom identifier. Add its `WM_CLASS`, Wayland app ID, or desktop file ID to the exception list (in whitelist mode) or disable the libadwaita/libhandy skip option.

### Wayland limits

GNOME Shell can round top-level windows managed by Mutter. Popup menus, tooltips, override-redirect X11 surfaces, and some client subsurfaces are compositor-limited and may remain square even on GNOME 50 Wayland.

### Settings window crashes

Make sure you are running GNOME 45 or later. If you see `TypeError: Gdk.RGBA is not a constructor`, reinstall the latest version.

### Extension causes GNOME Shell to crash

```bash
journalctl -b /usr/bin/gnome-shell | tail -100
```

Then [open a bug report](#reporting-bugs) with the relevant error excerpt. Review logs for personal information before sharing.

---

## Reporting bugs

**Before opening an issue**, please:

1. Check the [existing issues](https://github.com/sssxks/smooth-shell-corners/issues) to avoid duplicates.
2. Include your GNOME version; 50.4 is tested locally and 45–49 remain unverified.
3. Try disabling other extensions to rule out conflicts.

**When opening an issue, include:**

```
**GNOME Shell version:**  (run: gnome-shell --version)
**Distribution & version:**
**Display server:**  Wayland / X11
**Monitor scale:**  100% / 125% / 150% / other
**Extension version:**  (from resources/metadata.json or the Extensions app)

**Steps to reproduce:**
1.
2.
3.

**What you expected:**

**What actually happened:**

**Journal log:**
(run: journalctl -b /usr/bin/gnome-shell | grep -E "SmoothShellCorners|JS ERROR" | tail -50)
```

👉 [Open a new issue](https://github.com/sssxks/smooth-shell-corners/issues/new)

---

## How it works

The window effect renders the window, corner mask, optional border and custom
shadow together, so the shadow follows overview clones and window animations.

The window effect owns its framebuffer to preserve text sharpness. The stock
offscreen effect rounds fractional resource scales up: at 150%, window content
is sampled at 200% and then reduced again. This extension renders at the actual
painted density and aligns the framebuffer origin to physical pixels, including
windows positioned between physical pixels. Overview clones use their projected
paint size. Cached content is redrawn when the app updates or the sampling grid
changes. No Mutter patch is needed.

Body detection uses a 4×1 floating-point probe texture and a 1×1 result texture
containing four insets. The painting shaders consume that result directly;
production code never reads pixels back to the CPU. Up to three checks during
startup accommodate initial app painting. Resizing reuses the previous insets
and schedules one check after geometry settles for 180 ms. Content damage
schedules a check at most once per second; idle windows schedule no checks. A GPU-rejected normal window still retains
its content framebuffer; utility windows bypass allocation altogether. If
floating-point targets are unavailable, the effect preserves the app visually.

Shadows use shared geometry textures with fixed corners and stretchable straight
sections. The spread and Gaussian blur are baked only when their geometry or
style changes; application damage and ordinary resizing reuse the tile. Each
axis too small to separate opposite corners is rendered at its actual size.
With automatic body detection, windows within 128 logical pixels of that limit
use a private full-size shadow tile so GPU insets cannot make stretched corners
overlap. This path rebakes on resize or a new body-detection result; sufficiently large
windows keep sharing tiles. Private tiles are released with their window or on GPU-memory purge.
Fractional edge phases can select different tiles. Overview clones sample the
monitor-density tile. The final shader clears the unshifted window interior so
shadow offsets do not darken translucent content.

The shared cache retains at most 16 tiles / 16 MiB of RGBA8 texels, plus one
reusable filter scratch target and textures referenced by active painting.
Window content still needs its own framebuffer. Disabling clears the shared
cache; a GPU-memory purge clears it and rebuilds tiles on demand. An oversized
tile stays with its active window instead of evicting the shared cache. These limits
are not a cap on total compositor VRAM or a promise of immediate driver reclamation.

The shader uses a **squircle (superellipse)** formula:

$$\text{dist}(p, c) = \left( |p_x - c_x|^e + |p_y - c_y|^e \right)^{1/e}$$

where `e = smoothing × 10 + 2` (2 = circle, 12 = squircle).

---

## Development checks

For a repeatable performance comparison, run `just benchmark`. It builds the
checkout and measures scripted Overview transitions with six fixed windows in
a private GNOME Shell 50 session, comparing extension off, corners only, and
custom shadows across three balanced rounds. It saves raw Sysprof captures and
JSON results for `just benchmark-compare BEFORE/results.json AFTER/results.json`.
See [the benchmark guide](../tests/performance/README.md) for methodology and limits.

```bash
just check
gjs -m tests/unit/native-radius.test.js
gjs -m tests/compositor/native-radius-render.js
uv run tests/unit/render.py
uv run tests/unit/body-render.py
timeout 300s uv run tests/compositor/compositor.py
glib-compile-schemas --strict --dry-run resources/schemas
```

TypeScript source lives under `src/`, static extension resources under
`resources/`, and `dist/` is generated as the complete installable extension.
The root `extension.js` and `prefs.js` required by GNOME are emitted from small
entry points; window lifecycle, filtering, geometry, shadows, effects, settings,
and preference pages are maintained in separate modules.

The rendering test compiles the actual shader snippets in a headless EGL context
and checks a synthetic border, content preservation, opacity, corner clipping,
and window/shadow composition without an antialiasing seam.
It uses an isolated uv environment with Python 3.13 and ModernGL. These checks do
not replace testing in GNOME Shell with real apps, scaling, and tiling animations.
The body shader test checks native shadow margins, asymmetric insets, translucent
rectangles, holes and disconnected overlays; pixel readback is confined to tests.
The native-radius file tests use temporary directories, including simulated
Flatpak configs; they do not modify your GTK settings. The native rendering test
briefly opens a libadwaita window in the current graphical session and verifies
its render nodes before applying CSS, after applying it, and after removing it.

The compositor test targets Bazzite with GNOME Shell 50.4. It starts a separate
headless Shell, private session bus and GTK text fixture with temporary settings;
it does not change the running desktop. It compares interior screenshot pixels
with the effect disabled at 100%, 125%, 150% and 200%, including fractional pixel
positions, content updates, opacity and an overview-style clone. Results are
written to `tests/artifacts/sharpness-results.json`. This renderer has not yet been verified
on older Shell releases or with mixed-monitor setups and other window effects.
Additional real GTK fixtures compare automatic dialog bounds against a manually
specified 16px inset at all four scales, including small windows and clamped
radii. Utility classification removes the effect; the same transparent overlay
classified as a normal window must also preserve its original pixels.

The same compositor test checks shadow continuity along all four edges and corners
at those scales, with filling on/off and varied blur, spread and offsets. A black
window and shadow over white must darken continuously toward the window; a bright
pixel between them fails the test. This reproduced the inherited gap with the
original effects from Rounded Windows commit `9d9eb77013b24e45ae75fc92a85a9b6d82e052f6`.
The fix accounts for Mutter's padded offscreen texture, matches the window's
buffer-edge inset, and keeps shadow under the antialiased edge instead of cutting
both layers away there.
