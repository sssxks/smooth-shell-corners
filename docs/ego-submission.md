# extensions.gnome.org submission preparation

The preview ZIP is built from readable, unminified JavaScript emitted by
TypeScript, with metadata, stylesheet, schemas, LICENSE and AUTHORS.
Build with `npm ci && just pack` from the release commit. The extension UUID is
`smooth-shell-corners@xks`; version-name is `0.1.1`.

## Listing copy

Name: Smooth Shell Corners

Description:

Consistent rounded and squircle corners for GNOME windows, with crisp text at
fractional scaling, optional custom shadows, and clipped border filling.

Early preview tested on Bazzite / GNOME Shell 50.4 / Wayland. Older GNOME versions
listed in metadata are not yet verified. Native GTK4 corner replacement is on by
default and manages a marked CSS block in host and existing Flatpak GTK4 configs;
restart affected apps after enabling or disabling it. It can be turned off in
preferences. Enable only one window-corner extension at a time.

Homepage: https://github.com/sssxks/smooth-shell-corners

Screenshot: `docs/images/after.png` (GTK4 sample window, 150% scaling).

## Review notes

The extension has automated lifecycle, CSS cleanup, preferences, shader and
compositor tests. See `docs/guide.md` for their scope. These are developer checks,
not GNOME review approval or evidence for untested Shell releases.

Draw reviewers' attention to `native-radius.js`: enabling the extension can
modify host and existing Flatpak GTK4 CSS files. Disabling removes the marked
block; app restarts are necessary because GTK caches styling. Explain this
behavior rather than assuming it will be accepted.

Only submit Shell versions you can maintain and verify. The local preview still
allows 45–49 in metadata; decide their inclusion using actual test results before
submitting to EGO. Confirm upstream authorship and preserved license notices when
reviewing the final distributed files.

Read the current [official review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
and inspect the final ZIP, then sign in and upload at
[extensions.gnome.org](https://extensions.gnome.org/upload/).
The guidelines require lifecycle cleanup, readable JavaScript and attribution for
adapted extension code. Review acceptance remains the reviewers' decision.

No EGO submission has been made. This workspace has GitHub access but no
available authenticated EGO submission tool.
