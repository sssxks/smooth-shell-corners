Smooth Shell Corners 0.1.1 is an early preview focused on consistent corners,
crisp text at fractional scaling, clipped border filling, and custom shadows.

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
