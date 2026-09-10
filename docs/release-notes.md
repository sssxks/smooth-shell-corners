Smooth Shell Corners 0.1.3 fixes extension cleanup, settings refresh, and
application exception editing. This remains an early preview.

Changes since 0.1.2:

- Restore managed GTK4 CSS before disable returns, cancel pending updates, and
  preserve user edits. Process host CSS even when Flatpak discovery fails.
- Keep toolkit detection cached across settings changes to avoid temporarily
  losing window effects; release detection state when the last process window closes.
- Release custom shadow resources when disabled and avoid repeated allocation
  retries after a rendering failure until resources are reset.
- Keep application exception editors synchronized with settings and correct
  preference control updates.

Type checking, lint, 37 unit tests, real GJS CSS and preferences tests, and
release ZIP contents checks passed.

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
