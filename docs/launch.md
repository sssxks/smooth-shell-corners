# Launch kit

## Community post draft

Title: Smooth Shell Corners: subtle GNOME corners and crisp text at 150% — looking for five testers

I made Smooth Shell Corners, a fork of Rounded Windows focused on rendering
quality: crisp text at fractional scaling, filling clipped application borders,
and consistent corners with optional shadows.

The before/after images show the same GTK4 sample window in GNOME Shell 50.4 at
150% scaling. The subtle preset is radius 12, smoothing 0.6, with custom shadows.
These are actual compositor captures; they are not a comparison with another extension.

I'm looking for five people to try the preview for a week, especially on different
GPUs or mixed-monitor setups. It's tested locally on Bazzite / GNOME 50.4 /
Wayland; older versions listed in metadata are still unverified.

Native GTK4 corner replacement is enabled by default, so restart GTK4 apps after
installing. It can be turned off in preferences. Please disable other corner
extensions while trying this one.

Download and instructions: https://github.com/sssxks/smooth-shell-corners

If you try it, tell me your GNOME version, GPU, scaling and main apps. After a
week, I'd love to hear whether you kept it enabled, and what made you keep or
remove it. Bug reports and trial feedback have forms in the repository.

## Where and when

Start with one post in a GNOME community where project showcases are allowed,
such as r/gnome, after checking its current posting rules. Attach the two images
from `docs/images/`, and include the repository link. Keep the caption's sample
window qualification. A Bazzite community is a useful second venue because it
matches the tested environment; check its current rules before posting there too.
Do not post identical announcements across many communities at once.

This file is a draft; no community messages have been sent.

## First week

- Launch day: make the preview downloadable, publish one demo post, and invite
  interested users to the testing guide.
- During the week: acknowledge reports, reproduce concrete failures, and link
  fixes to the release that contains them. Ask for missing environment details.
- After seven days: ask volunteers, “Are you still using it? If you disabled it,
  what made you stop?” Track answers in the trial feedback issues.
- Prioritize problems that cause removal, prevent installation, or break normal
  window interactions. Repeat the relevant checks before releasing a fix.

Count people who explicitly report continued use after a week. Downloads and
stars can help gauge discovery, but are not evidence of continued use.

## Short project description

Consistent squircle window corners for GNOME, with crisp text at fractional scaling and optional shadows.
