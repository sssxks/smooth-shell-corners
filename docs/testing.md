# Try Smooth Shell Corners for a week

[Install the preview](../README.md#install-a-release), then use your usual apps.
The first milestone is five people who still have it enabled after a week.
You do not need to run developer tests.

## Ten-minute first check

1. Disable other window-corner extensions and enable Smooth Shell Corners.
2. Restart GTK4 apps: native GTK4 corner replacement is on by default.
3. Open your browser, editor and a GTK4 app. Check corners, borders and text.
4. Move and resize windows, maximize and restore, enter and leave fullscreen,
   minimize and restore, and open the overview. Try your normal monitor scaling.
5. If you use custom shadows, turn them on and repeat the overview check.
6. Disable the extension and restart GTK4 apps. Confirm that styling returns
   to normal. Re-enable it if you want to continue the week-long trial.

For the subtle style shown in the screenshots, use radius **12**, smoothing
**0.6**, and enable custom shadows. Other settings can stay at their defaults.

## Send feedback

[Report a bug](https://github.com/sssxks/smooth-shell-corners/issues/new?template=bug.yml)
when something breaks. Include a small screenshot if useful, your GPU, GNOME
version, scaling, app name/version and steps to reproduce. Check screenshots
and log excerpts for personal information before sharing.

After a week, use the
[trial feedback form](https://github.com/sssxks/smooth-shell-corners/issues/new?template=trial.yml):

- Are you still using it?
- What looks or works better for you?
- What made you disable it, or almost disable it?

Update the same issue if a fix changes your answer. There is no automatic usage
tracking; feedback is voluntary.

## What is and is not verified

| Environment / behavior | Evidence or status |
|---|---|
| Bazzite, GNOME Shell 50.4, Wayland | Local development and isolated compositor checks |
| 100%, 125%, 150%, 200% scaling | Automated sample-window pixel comparisons |
| Window lifecycle, overview, custom shadow continuity | Isolated compositor checks; see the development guide |
| GNOME 45–49 / X11 | Allowed by metadata, unverified for this fork |
| Mixed monitors, different GPUs, real application combinations | Needs tester reports |
| Other corner extensions | Enable only one at a time |
| Other window effects, including blur | Compatibility unverified |

GTK4 replacement uses user CSS, affects excluded GTK4 windows too, and needs app
restarts. Existing Flatpak directories are covered; toggle replacement off/on
after adding an app. Padding fill may stretch narrow edge content. Some popups
and custom app surfaces remain square. These limits are explained in the
[settings guide](guide.md).

Passing sample-window tests does not establish compatibility with every app or GPU.
