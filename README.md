<p align="center">
  <img src="https://img.shields.io/badge/GNOME-45--50-4A86CF?style=flat-square&logo=gnome&logoColor=white" alt="GNOME 45–50">
  <img src="https://img.shields.io/badge/License-GPL--3.0-blue?style=flat-square" alt="GPL-3.0">
  <img src="https://img.shields.io/badge/JS-ES2022-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="JavaScript">
</p>

<h1 align="center">Smooth Shell Corners</h1>

<p align="center">
  A GNOME Shell extension that adds <strong>rounded corners</strong> to top-level windows —<br>
  including apps that don't use libadwaita or libhandy (Firefox, VS Code, Chromium, Electron apps, JetBrains IDEs, etc.).<br>
  GPU-accelerated GLSL shader. No build step, no bundler — pure JavaScript.
</p>

---

This is a fork of [Nathanaelrc/rounded-windows](https://github.com/Nathanaelrc/rounded-windows)
with interior pixel filling for clipped application borders and optional native
GTK4 corner removal. It also keeps window text crisp under fractional scaling by
rendering effects at the window's actual painted density and aligning them to
physical pixels. Its UUID is `smooth-shell-corners@xks`, with a separate
`org.gnome.shell.extensions.smooth-shell-corners` settings schema. It installs
alongside Rounded Windows. Enable only one of them at a time to avoid applying
two effects to the same windows. Upstream links refer to the original project;
this fork's changes are in this checkout.

## Table of contents

- [Screenshots](#screenshots)
- [Features](#features)
- [Requirements](#requirements)
- [Installation — step by step](#installation--step-by-step)
- [Uninstall](#uninstall)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Reporting bugs](#reporting-bugs)
- [How it works](#how-it-works)
- [Credits](#credits)
- [License](#license)

---

## Screenshots

>_

---

## Features

- **Rounded corners** — GLSL fragment shader applied per-window at draw time
- **Squircle / superellipse** — adjustable smoothing (0 = circle, 1 = squircle)
- **Custom shadow** — rounded CSS `box-shadow` replaces GNOME's default rectangular shadow, clipped with the same squircle curve
- **Border** — optional inner or outer coloured border with configurable width
- **Toolkit-aware handling** — replace native GTK4 corners or leave libadwaita / libhandy windows unchanged
- **Blacklist / Whitelist** — exclude or exclusively include apps by `WM_CLASS`, Wayland app ID, or desktop file ID
- **GNOME 50 / Wayland aware** — matches native Wayland windows without depending on `WM_CLASS`
- **Crisp text at fractional scaling** — pixel-aligned rendering avoids the blur caused by resampling window content
- **Live settings** — all changes apply instantly without restarting the shell

---

## Requirements

| Requirement | Version |
|:------------|:--------|
| GNOME Shell | 45 – 50 |
| GLib (glib-compile-schemas) | any modern version |

**Supported distributions** (all others with GNOME 45–50 also work):

| Distribution | GNOME Shell |
|:-------------|:------------|
| Ubuntu 24.04 – 26.04 | 46 – 50 |
| Fedora 40 – 44 | 46 – 50 |
| Arch Linux (rolling) | 45 – 50 |
| Debian Testing / Sid | 45 – 50 |
| openSUSE Tumbleweed | 45 – 50 |

---

## Installation — step by step

### 1. Install dependencies

You need `glib-compile-schemas` to compile the GSettings schema. Install it for your distro:

```bash
# Ubuntu / Debian
sudo apt install libglib2.0-bin

# Fedora / RHEL / CentOS
sudo dnf install glib2

# Arch Linux / Manjaro
sudo pacman -S glib2

# openSUSE
sudo zypper install glib2-tools
```

### 2. Open this checkout

Run the following commands from this Smooth Shell Corners checkout. Cloning the
upstream URL in the credits gives you the original extension without these changes.

### 3. Run the installer

```bash
chmod +x install.sh
./install.sh
```

The script will:
- Detect your GNOME Shell version and confirm it is supported
- Compile the GSettings schema
- Copy all extension files to `~/.local/share/gnome-shell/extensions/smooth-shell-corners@xks/`

### 4. Restart GNOME Shell

The extension is installed but not loaded yet. You need to restart the shell:

**Wayland session (GNOME 50)**
> Log out and log back in. There is no in-session restart on Wayland.

**X11 session (GNOME 45–49)**
> Press <kbd>Alt</kbd>+<kbd>F2</kbd>, type `r`, press <kbd>Enter</kbd>.

### 5. Enable the extension

First disable the original extension if you have it installed:

```bash
gnome-extensions disable rounded-windows@marcosgt.github.io
```

After restarting, enable it with one of these methods:

**Option A — terminal:**
```bash
gnome-extensions enable smooth-shell-corners@xks
```

**Option B — GUI:**
Open the **Extensions** app (or **GNOME Tweaks → Extensions**) and toggle _Smooth Shell Corners_ on.

### 6. Open settings (optional)

```bash
gnome-extensions prefs smooth-shell-corners@xks
```

Or click the ⚙️ icon next to the extension in the Extensions app.

---

## Uninstall

Turn off **Replace native GTK4 corners** and restart affected apps first.
The installer also removes our CSS block before deleting the extension files:

```bash
./install.sh --uninstall
```

Then restart GNOME Shell (step 4 above).

---

## Configuration

### Corners tab

| Setting | Description | Default |
|:--------|:------------|:--------|
| Radius | Corner radius in logical pixels | `12` |
| Smoothing | `0` = circle · `1` = squircle (superellipse) | `0.6` |
| Clip padding | Extra gap between the window edge and the clip boundary | `1` |
| Fill clipped edges | Extend pixels from inside the padding to the original window bounds | off |
| Border width | Positive = inner border · Negative = outer · `0` = none | `0` |
| Border colour | RGBA colour picker | white |
| Keep rounded when maximised | Apply corners even when a window fills the screen | off |
| Keep rounded when full-screen | Apply corners in full-screen mode | off |

To hide a 2px application border without opening seams between tiled windows,
enable **Fill clipped edges**, set the four padding values to **2**, and set
**Border width** to **0**. Padding follows the extension's monitor scaling.
The shader repeats the nearest interior row/column without resizing the content;
the corner mask and custom shadow use the original window footprint.

Content touching the sampled edge (such as scrollbars or images) will stretch
across the narrow strip. Transparent app backgrounds and client-drawn rounded
corners can still show through: this samples the actual app pixels, not an
inferred background color. Rounded corners and gaps configured in your tiling
extension remain. Turning the option off restores ordinary clipping.

### Shadow tab

| Setting | Description | Default |
|:--------|:------------|:--------|
| Custom shadow | Replace GNOME's rectangular shadow with a rounded one | on |
| Shadow when maximised | Keep the custom shadow for maximised windows | off |
| Focused / Unfocused | Opacity, blur radius, spread, horizontal and vertical offset | see below |

Default shadow values:

|  | Focused | Unfocused |
|:-|:--------|:----------|
| Opacity | 45 / 255 | 28 / 255 |
| Blur | 18 px | 12 px |
| Spread | −2 px | −2 px |
| Y offset | 4 px | 3 px |

### Applications tab

| Setting | Description | Default |
|:--------|:------------|:--------|
| Replace native GTK4 corners | Let the extension shape GTK4 windows; restart apps after changes | off |
| Leave libadwaita windows unchanged | Use their toolkit-provided corners instead of this extension | on |
| Leave libhandy windows unchanged | Same, for legacy Handy apps | off |
| Whitelist mode | Treat the exception list as a whitelist instead of a blacklist | off |
| Exception list | One application identifier per line (`WM_CLASS`, Wayland app ID, or desktop ID) | — |

#### Native GTK4 corner removal

Enable **Replace native GTK4 corners** to provide rectangular window content to
the shader, avoiding samples from libadwaita's transparent native corners. This
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
gjs -m restore-native-radius.js
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

Then [open a bug report](#reporting-bugs) with the full log.

---

## Reporting bugs

**Before opening an issue**, please:

1. Check the [existing issues](https://github.com/Nathanaelrc/rounded-windows/issues) to avoid duplicates.
2. Make sure you are on a **supported GNOME version** (45–50).
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
(run: journalctl -b /usr/bin/gnome-shell | grep -E "rounded-windows|JS ERROR" | tail -50)
```

👉 [Open a new issue](https://github.com/Nathanaelrc/rounded-windows/issues/new)

---

## How it works

```
Window Actor (MetaWindowActor)
  └─ RoundedCornersEffect  ← Clutter.Effect (pixel-aligned offscreen FBO)
        Fragment shader:
          • converts tex coord → pixel position
          • evaluates squircle formula at each corner
          • multiplies fragment alpha by the squircle opacity
          • result: corners are transparent, edges are anti-aliased

Shadow Actor (St.Bin, inserted below the window in global.windowGroup)
  └─ ClipShadowEffect  ← Shell.GLSLEffect
        Fragment shader:
          • same squircle formula as above
          • makes the shadow transparent where the window sits
          • prevents shadow from bleeding through rounded corners
  └─ Inner St.Bin  → CSS  border-radius + box-shadow
```

The window effect owns its framebuffer to preserve text sharpness. The stock
offscreen effect rounds fractional resource scales up: at 150%, window content
is sampled at 200% and then reduced again. This extension renders at the actual
painted density and aligns the framebuffer origin to physical pixels, including
windows positioned between physical pixels. Overview clones use their projected
paint size. Cached content is redrawn when the app updates or the sampling grid
changes. No Mutter patch is needed.

The shader uses a **squircle (superellipse)** formula:

$$\text{dist}(p, c) = \left( |p_x - c_x|^e + |p_y - c_y|^e \right)^{1/e}$$

where `e = smoothing × 10 + 2` (2 = circle, 12 = squircle).

---

## Development checks

```bash
just check
gjs -m tests/unit/native-radius.test.js
gjs -m tests/compositor/native-radius-render.js
uv run tests/unit/render.py
timeout 120s uv run tests/compositor/compositor.py
glib-compile-schemas --strict --dry-run resources/schemas
```

TypeScript source lives under `src/`, static extension resources under
`resources/`, and `dist/` is generated as the complete installable extension.
The root `extension.js` and `prefs.js` required by GNOME are emitted from small
entry points; window lifecycle, filtering, geometry, shadows, effects, settings,
and preference pages are maintained in separate modules.

The rendering test compiles the actual shader snippets in a headless EGL context
and checks a synthetic border, content preservation, opacity, and corner clipping.
It uses an isolated uv environment with Python 3.13 and ModernGL. These checks do
not replace testing in GNOME Shell with real apps, scaling, and tiling animations.
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

## Credits

This extension was built by studying and adapting code from several open-source projects:

| Project | Author | What we used |
|:--------|:-------|:-------------|
| [rounded-window-corners](https://github.com/yilozt/rounded-window-corners) | yilozt | Original squircle GLSL shader, shadow actor architecture, ClipShadowEffect concept, per-window signal management |
| [Rounded Window Corners Reborn](https://github.com/flexagoon/rounded-window-corners) | flexagoon | Updated GJS bindings for GNOME 45–47, shadow style system, actor binding pattern |
| [Mutter](https://gitlab.gnome.org/GNOME/mutter) | GNOME | Understanding of MetaWindowActorX11 paint cycle, shadow architecture (focused/unfocused), FBO pipeline |
| [GNOME Shell](https://gitlab.gnome.org/GNOME/gnome-shell) | GNOME | Shell.GLSLEffect usage patterns, ExtensionPreferences API |

The squircle shader, shadow clipping with squircle masking, GNOME 50 / Mutter 18 compatibility fixes, GSettings schema, preferences UI, and installation script were completely rewritten and heavily modified to bring this project to life and ensure compatibility with modern GNOME environments. While it stands on the shoulders of giants, this specific implementation and its novel improvements are my own work.

---

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).  
You are free to use, modify, and distribute it under the same license.
