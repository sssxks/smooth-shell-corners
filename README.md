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
with interior pixel filling for clipped application borders. The extension UUID
and settings schema are retained so installing this fork updates the existing
extension and preserves its preferences. Upstream links below refer to the
original project; the pixel-fill changes are in this checkout.

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
- **Smart skip** — automatically skips libadwaita / libhandy apps to avoid double-rounding
- **Blacklist / Whitelist** — exclude or exclusively include apps by `WM_CLASS`, Wayland app ID, or desktop file ID
- **GNOME 50 / Wayland aware** — matches native Wayland windows without depending on `WM_CLASS`
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

### 2. Clone the repository

```bash
git clone https://github.com/Nathanaelrc/rounded-windows.git
cd rounded-windows
```

### 3. Run the installer

```bash
chmod +x install.sh
./install.sh
```

The script will:
- Detect your GNOME Shell version and confirm it is supported
- Compile the GSettings schema
- Copy all extension files to `~/.local/share/gnome-shell/extensions/rounded-windows@marcosgt.github.io/`

### 4. Restart GNOME Shell

The extension is installed but not loaded yet. You need to restart the shell:

**Wayland session (GNOME 50)**
> Log out and log back in. There is no in-session restart on Wayland.

**X11 session (GNOME 45–49)**
> Press <kbd>Alt</kbd>+<kbd>F2</kbd>, type `r`, press <kbd>Enter</kbd>.

### 5. Enable the extension

After restarting, enable it with one of these methods:

**Option A — terminal:**
```bash
gnome-extensions enable rounded-windows@marcosgt.github.io
```

**Option B — GUI:**
Open the **Extensions** app (or **GNOME Tweaks → Extensions**) and toggle _Smooth Shell Corners_ on.

### 6. Open settings (optional)

```bash
gnome-extensions prefs rounded-windows@marcosgt.github.io
```

Or click the ⚙️ icon next to the extension in the Extensions app.

---

## Uninstall

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
| Skip libadwaita apps | Don't round apps that already have built-in rounded corners | on |
| Skip libhandy apps | Same, for legacy Handy apps | off |
| Whitelist mode | Treat the exception list as a whitelist instead of a blacklist | off |
| Exception list | One application identifier per line (`WM_CLASS`, Wayland app ID, or desktop ID) | — |

**Finding a window identifier:**
Use the X11/XWayland `WM_CLASS` when available. For Wayland-native apps, use the app ID or desktop file ID shown by GNOME Shell / your launcher entry.

---

## Troubleshooting

### No rounded corners appear

1. Make sure the extension is **enabled** (`gnome-extensions list --enabled | grep rounded`).
2. Check the journal for errors:
   ```bash
   journalctl -b /usr/bin/gnome-shell | grep -E "rounded-windows|JS ERROR"
   ```
3. The app may be libadwaita — disable **Skip libadwaita apps** in settings.

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
**Extension version:**  (from metadata.json or the Extensions app)

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
  └─ RoundedCornersEffect  ← Shell.GLSLEffect (offscreen FBO)
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

The shader uses a **squircle (superellipse)** formula:

$$\text{dist}(p, c) = \left( |p_x - c_x|^e + |p_y - c_y|^e \right)^{1/e}$$

where `e = smoothing × 10 + 2` (2 = circle, 12 = squircle).

---

## Development checks

```bash
node --test tests/effect.test.mjs
uv run tests/render.py
glib-compile-schemas --strict --dry-run schemas
```

The rendering test compiles the actual shader snippets in a headless EGL context
and checks a synthetic border, content preservation, opacity, and corner clipping.
It uses an isolated uv environment with Python 3.13 and ModernGL. These checks do
not replace testing in GNOME Shell with real apps, scaling, and tiling animations.

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
