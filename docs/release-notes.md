Smooth Shell Corners 0.1.2 improves window-body detection, shadow rendering,
and GNOME Shell responsiveness. This remains an early preview.

Changes since 0.1.1:

- GPU detection accounts for native transparent window margins and refreshes
  after resizing or content changes. Utility windows and unsupported shapes
  preserve their appearance.
- Shared shadow tiles and reusable render targets reduce repeated rendering and
  GPU allocation churn. Blur stays stable during resizing, shadow spread survives
  blur, and maximized/fullscreen windows respect their shadow setting.
- GTK4 CSS updates and toolkit detection use asynchronous file I/O. Queued CSS
  changes and stale-callback checks protect rapid toggles and disable/re-enable.
- Release ZIPs exclude compiled schemas and standalone recovery scripts.

Type checking, lint, 32 unit tests, real GJS tests, isolated compositor tests,
standalone cleanup, and ZIP contents/import reachability checks passed.

Tested locally on Bazzite / GNOME Shell 50.4 / Wayland. GNOME 45–49 remain
unverified. Mixed-monitor and other window-effect combinations need testers.

Download `smooth-shell-corners@xks.shell-extension.zip` and run from its folder:

```bash
gnome-extensions install --force smooth-shell-corners@xks.shell-extension.zip
```

Disable other window-corner extensions, log out and back in, then run:

```bash
gnome-extensions enable smooth-shell-corners@xks
gnome-extensions prefs smooth-shell-corners@xks
```

Native GTK4 corner replacement is enabled by default and manages a marked block
in host and existing Flatpak GTK4 CSS files. Restart affected apps after enabling
or disabling it. You can turn it off in Applications settings. This also affects
GTK4 windows excluded by application filters. Padding fill can stretch edge content.

No Node.js or build tools are needed for the ZIP.
To remove, disable the extension, restart GTK4 apps, then uninstall it through
the Extensions app or `gnome-extensions uninstall smooth-shell-corners@xks`.

[Settings and recovery](https://github.com/sssxks/smooth-shell-corners/blob/master/docs/guide.md) ·
[Help test for a week](https://github.com/sssxks/smooth-shell-corners/blob/master/docs/testing.md) ·
[Report a problem](https://github.com/sssxks/smooth-shell-corners/issues/new/choose)
