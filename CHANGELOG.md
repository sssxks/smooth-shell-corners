# Changelog

## 0.1.2 — rendering and Shell responsiveness

- Detect the visible window body on the GPU so native transparent margins are
  handled correctly. Utility windows bypass rounding, and unsupported shapes
  retain their appearance. Detection refreshes after resizing and content changes.
- Reuse render-target capacity during resizing and share cached shadow tiles
  across windows to reduce GPU allocation churn and repeated shadow rendering.
- Stabilize shadow blur while resizing and preserve positive and negative spread
  through the blur pass. Respect the shadow setting for maximized/fullscreen windows.
- Move GTK4 stylesheet discovery, reads and writes, and toolkit detection to
  asynchronous file I/O so they do not block GNOME Shell. Serialize CSS changes
  and discard stale callbacks across settings changes and disable/re-enable cycles.
- Exclude compiled schemas and standalone recovery scripts from release ZIPs;
  keep recovery tools available in local builds. Remove obsolete shadow code.
- Expand GPU, compositor and lifecycle coverage, including asynchronous cleanup
  and toolkit detection. Validation passed on Bazzite / GNOME 50 / Wayland;
  GNOME 45–49 remain unverified.

## 0.1.1 — first Smooth Shell Corners preview

This fork uses its own version sequence. Earlier v2 / V2.1 / v2.2.0 tags belong
to the inherited project history.

- Pixel-aligned rendering for crisp text at fractional scaling.
- Optional filling of clipped application borders.
- Native GTK4 corner replacement, including existing Flatpak configurations.
- Calibrated custom shadows with basic strength and independent advanced controls.
- Window lifecycle and overview fixes, including outer border corner thickness.
- Installable ZIP, corrected installation instructions, and tester feedback forms.

Validation targets Bazzite / GNOME Shell 50.4 on Wayland. GNOME 45–49 remain
unverified despite their metadata compatibility entries.
