# Demo captures

`before.png` and `after.png` are unretouched GNOME Shell ScreenshotArea captures,
taken on Bazzite with GNOME Shell 50.4 / Wayland at 150% scaling. The window is
the repository's GTK4 text fixture (`tests/fixtures/compositor-app.js`), not
Firefox, VS Code or a competitor extension.

The session uses the compositor test's private D-Bus, temporary XDG directories,
and hidden host Flatpak configs. The desktop background is solid `#344454` and
notification banners are disabled in that private session. No personal desktop
content appears in these captures.

The 600×400 logical-pixel fixture is positioned at (140, 140). ScreenshotArea
captures (100, 100, 680, 480), producing 1020×720 physical-pixel PNGs.
The before image has the extension disabled. The after image uses the production
extension's `enable()` method with radius 12, smoothing 0.6 and custom shadows on.
Other settings are the schema defaults, except maximized rounding is off and
libadwaita skipping is off as in the test probe. The fixture is undecorated;
these images do not demonstrate GTK4 native-corner removal.

The subtle preset differs from the shipped radius 8 / smoothing 1.0 / shadows
off defaults. Click the images to inspect at full resolution: browser scaling of
the README itself can resample text.

For quantitative text and shadow checks, run:

```bash
timeout 120s uv run tests/compositor/compositor.py
```

The September 10, 2026 run reported zero changed interior pixels for the tested
fixed-renderer cases at 100%, 125%, 150% and 200%. That is a sample-window test,
not a promise about every application or a comparison with another extension.
