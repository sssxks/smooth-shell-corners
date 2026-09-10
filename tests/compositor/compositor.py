# /// script
# requires-python = ">=3.13,<3.14"
# dependencies = ["pillow==12.1.1", "numpy==2.4.2"]
# ///
"""Bazzite / GNOME 50: uv run tests/compositor/compositor.py.

Compare actual composited text, not just the fragment shader. All settings,
apps, screenshots and the unsafe Eval endpoint live on a private test bus.
"""
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import tempfile
import time

import numpy as np
from PIL import Image

repo = Path(__file__).resolve().parents[2]
results = []

with tempfile.TemporaryDirectory(prefix="ssc-compositor-") as temporary:
    root = Path(temporary)
    env = os.environ | {"GSETTINGS_BACKEND": "keyfile", "DISPLAY": "",
                        "WAYLAND_DISPLAY": "ssc-test", "GDK_BACKEND": "wayland"}
    for key, directory in [("XDG_CONFIG_HOME", "config"), ("XDG_DATA_HOME", "data"),
                           ("XDG_CACHE_HOME", "cache"), ("XDG_RUNTIME_DIR", "runtime")]:
        env[key] = str(root / directory)
        (root / directory).mkdir(mode=0o700)

    def run(args, timeout=20):
        return subprocess.run(args, env=env, text=True, capture_output=True,
                              timeout=timeout, check=True).stdout

    (root / "flatpaks").mkdir()
    probe = root / "data/gnome-shell/extensions/ssc-probe@local"
    probe.mkdir(parents=True)
    (probe / "metadata.json").write_text(json.dumps({"uuid": "ssc-probe@local",
        "name": "SSC isolated probe", "description": "Rendering test", "shell-version": ["50"]}))
    (probe / "extension.js").write_text(f"""
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {{checkWindowFilter}} from '{repo.as_uri()}/tests/compositor/window-filter.js';
import Extension from '{repo.as_uri()}/dist/extension.js';
import {{RoundedCornersEffect}} from '{repo.as_uri()}/dist/effects/rounded-corners.js';
import {{shadowFixture}} from '{repo.as_uri()}/tests/compositor/shadow-fixture.js';
const Pass = GObject.registerClass(class SSCProbePass extends Shell.GLSLEffect {{
    vfunc_build_pipeline() {{ this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, '', '', false); }}
}});
export default class Probe {{
    enable() {{
        global.context.unsafe_mode = true;
        const extension = new Extension({{uuid:'smooth-shell-corners@xks', name:'Smooth Shell Corners',
            path:'{repo}/dist', dir:Gio.File.new_for_path('{repo}/dist'),
            'settings-schema':'org.gnome.shell.extensions.smooth-shell-corners'}});
        const settings = extension.getSettings();
        settings.set_boolean('skip-libadwaita-app', false);
        settings.set_boolean('keep-rounded-maximized', false);
        global.ssc = {{RoundedCornersEffect, Pass, Clutter, overview: Main.overview, makeShadow: shadowFixture, extension, settings, checkWindowFilter}};
        this.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {{
            Main.overview.hide();
            this.owner = Gio.bus_own_name(Gio.BusType.SESSION, 'org.example.SSCProbe',
                Gio.BusNameOwnerFlags.NONE, null, null, null);
            this.timer = 0;
            return GLib.SOURCE_REMOVE;
        }});
    }}
    disable() {{
        if (this.timer) GLib.source_remove(this.timer);
        if (this.owner) Gio.bus_unown_name(this.owner);
        global.context.unsafe_mode = false;
    }}
}}
""")
    run(["gsettings", "set", "org.gnome.shell", "enabled-extensions", "['ssc-probe@local']"])
    # stdout carries only the private bus address; keep Shell diagnostics separate.
    launch = root / "launch.sh"
    launch.write_text('printf "%s\\n" "$DBUS_SESSION_BUS_ADDRESS"\n'
        'exec gnome-shell --headless --wayland --no-x11 --virtual-monitor=1920x1080 '
        '--wayland-display=ssc-test > "$XDG_CACHE_HOME/shell.log" 2>&1\n')
    shell = subprocess.Popen(["bwrap", "--dev-bind", "/", "/", "--bind", str(root / "flatpaks"),
                              str(Path.home() / ".var/app"), "--", "dbus-run-session", "--", "bash", str(launch)], env=env,
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             text=True, start_new_session=True)
    app = None
    try:
        assert select.select([shell.stdout], [], [], 20)[0], "No private bus address"
        env["DBUS_SESSION_BUS_ADDRESS"] = shell.stdout.readline().strip()
        assert env["DBUS_SESSION_BUS_ADDRESS"], "Private bus failed to start"
        run(["gdbus", "wait", "--session", "--timeout", "20", "org.example.SSCProbe"], timeout=25)
        app = subprocess.Popen(["gjs", "-m", str(repo / "tests/fixtures/compositor-app.js")], env=env,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        run(["gdbus", "wait", "--session", "--timeout", "10", "org.example.SSCSharpness"], timeout=15)
        time.sleep(0.5)  # Let the first Wayland configure/paint finish.

        def control(command, argument=""):
            return json.loads(run(["gjs", "-m", str(repo / "tests/compositor/compositor-driver.js"), command, str(argument)]))

        def evaluate(code):
            return control("eval", code)

        evaluate("global.ssc.actor = global.get_window_actors().find(a => a.metaWindow.title === 'SSC text test'); true;")

        def eventually(expression):
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if evaluate(expression):
                    return
                time.sleep(0.05)
            raise AssertionError(expression)

        assert evaluate("global.ssc.checkWindowFilter(global.ssc.actor.metaWindow, global.ssc.settings)")

        # Exercise the actual lifecycle before the independent renderer probes.
        effect = "global.ssc.actor.get_effect('ssc-rounded-corners') !== null"
        evaluate("global.ssc.extension.enable(); true;")
        eventually(effect)
        # The shadow is painted by the window effect, so it remains part of
        # the transformed overview clone instead of being a sibling actor.
        shadows = "global.windowGroup.get_children().filter(a => a.name === 'SSC Shadow').length"
        for enabled in [True, False, True, False]:
            evaluate(f"global.ssc.settings.set_boolean('custom-shadow', {str(enabled).lower()}); true;")
            eventually(f"{shadows} === 0 && ({effect})")
            expected = "true" if enabled else "false"
            eventually(f"global.ssc.actor.get_effect('ssc-rounded-corners')._shadowEnabled === {expected}")
        print("Custom shadow toggles apply to existing windows.", flush=True)

        evaluate("global.ssc.settings.set_boolean('custom-shadow', true); true;")
        eventually("global.ssc.actor.get_effect('ssc-rounded-corners')._shadowEnabled")
        # Mode switching must reach the effect on an already-open window.
        evaluate("global.ssc.settings.set_int('shadow-strength', 0); true;")
        eventually("!global.ssc.actor.get_effect('ssc-rounded-corners')._shadowEnabled")
        evaluate("global.ssc.settings.set_boolean('shadow-advanced', true); true;")
        eventually("global.ssc.actor.get_effect('ssc-rounded-corners')._shadowEnabled")
        evaluate("global.ssc.settings.set_boolean('shadow-advanced', false); true;")
        eventually("!global.ssc.actor.get_effect('ssc-rounded-corners')._shadowEnabled")
        evaluate("global.ssc.settings.set_int('shadow-strength', 100); true;")
        eventually("global.ssc.actor.get_effect('ssc-rounded-corners')._shadowEnabled")
        print("Independent shadow modes and zero strength apply to existing windows.", flush=True)
        evaluate("global.ssc.overview.show(); true;")
        eventually("global.ssc.overview.visible")
        eventually("global.ssc.actor.get_effect('ssc-rounded-corners')._shadowEnabled && global.ssc.actor.get_effect('ssc-rounded-corners').enabled")
        evaluate("global.ssc.overview.hide(); true;")
        eventually("!global.ssc.overview.visible")
        eventually("global.ssc.actor.get_effect('ssc-rounded-corners')._shadowEnabled && global.ssc.actor.get_effect('ssc-rounded-corners').enabled")
        print("Effect shadow remains enabled through overview show and hide.", flush=True)
        for _ in range(2):
            evaluate("global.ssc.actor.metaWindow.make_fullscreen(); true;")
            eventually(f"global.ssc.actor.metaWindow.fullscreen && !({effect})")
            evaluate("global.ssc.actor.metaWindow.unmake_fullscreen(); true;")
            eventually(f"!global.ssc.actor.metaWindow.fullscreen && ({effect})")
        for _ in range(2):
            evaluate("global.ssc.actor.metaWindow.maximize(); true;")
            eventually(f"global.ssc.actor.metaWindow.maximizedHorizontally && !({effect})")
            evaluate("global.ssc.actor.metaWindow.unmaximize(); true;")
            eventually(f"!global.ssc.actor.metaWindow.maximizedHorizontally && ({effect})")
        evaluate("global.ssc.settings.set_strv('blacklist', ['org.example.SSCSharpness']); true;")
        eventually(f"!({effect})")
        evaluate("global.ssc.settings.set_boolean('whitelist-mode', true); true;")
        eventually(effect)
        evaluate("global.ssc.settings.set_strv('blacklist', []); true;")
        eventually(f"!({effect})")
        evaluate("global.ssc.settings.set_boolean('whitelist-mode', false); true;")
        eventually(effect)
        evaluate("global.ssc.actor.metaWindow.minimize(); true;")
        # The effect must remain enabled throughout the minimize animation;
        # disabling it here causes the visible rounded corners to flicker off.
        eventually("global.ssc.actor.get_effect('ssc-rounded-corners')?.enabled === true")
        eventually("global.ssc.actor.metaWindow.minimized")
        evaluate("global.ssc.actor.metaWindow.unminimize(); true;")
        eventually(f"!global.ssc.actor.metaWindow.minimized && ({effect}) && global.ssc.actor.get_effect('ssc-rounded-corners').enabled")
        for _ in range(2):
            evaluate("global.ssc.extension.disable(); true;")
            eventually(f"!({effect}) && {shadows} === 0")
            evaluate("global.ssc.extension.enable(); true;")
            eventually(effect)
        print("Maximize, filter changes, minimize and repeated enable/disable passed.", flush=True)
        evaluate("global.ssc.settings.set_boolean('custom-shadow', true); true;")
        eventually(f"{shadows} === 0")
        evaluate("global.ssc.retained = null; true;")
        control("window")
        eventually("global.get_window_actors().some(a => a.metaWindow.title === 'SSC lifecycle test' && a.get_effect('ssc-rounded-corners'))")
        evaluate("global.ssc.retained = global.get_window_actors().find(a => a.metaWindow.title === 'SSC lifecycle test'); true;")
        eventually(f"{shadows} === 0")
        control("close")
        eventually("!global.get_window_actors().some(a => a.metaWindow.title === 'SSC lifecycle test')")
        eventually(f"{shadows} === 0")
        evaluate("global.ssc.extension.disable(); true;")
        eventually(f"!({effect})")
        print("Fullscreen lifecycle restores corners on every transition.", flush=True)

        def capture(name):
            path = root / (name + ".png")
            control("screenshot", path)
            return np.array(Image.open(path))[:, :, :3].astype(float)

        def install(scale, fill=True):
            evaluate(f"""(() => {{
                const a = global.ssc.actor; a.clear_effects();
                const fx = new global.ssc.RoundedCornersEffect(); a.add_effect(fx);
                fx.updateUniforms(1, {{padding: {{left:2,top:2,right:2,bottom:2}},
                    cornerRadius:8,smoothing:1,borderWidth:0,borderColor:[1,1,1,1],fillPadding:{str(fill).lower()}}},
                    {{x1:0,y1:0,x2:a.width,y2:a.height}}, {scale});
                global.ssc.fx = fx; return true;
            }})()""")

        def compare(name, before, after, scale, x, y, width, height, tolerance=0):
            # Exclude the intentional corner/border changes, retain all text.
            crop = (slice(round((y+32)*scale), round((y+height-32)*scale)),
                    slice(round((x+32)*scale), round((x+width-32)*scale)))
            delta = abs(before[crop] - after[crop])
            result = {"case": name, "mean_error": float(delta.mean()),
                      "max_error": float(delta.max()), "changed_pixels": int(np.any(delta != 0, axis=2).sum())}
            results.append(result)
            print(json.dumps(result), flush=True)
            if tolerance is not None:
                assert delta.max() <= tolerance, result

        for scale, position, width, height in [(1.5, 100, 600, 400), (1.5, 101, 600, 400),
                (1.25, 101, 601, 397), (2, 101, 601, 397), (1, 101, 601, 397)]:
            control("scale", scale)
            evaluate(f"global.ssc.actor.clear_effects(); global.ssc.actor.metaWindow.move_resize_frame(false, {position}, {position}, {width}, {height}); true;")
            time.sleep(0.25)  # Allow GTK to repaint at the new size/density.
            baseline = capture("baseline")
            if scale == 1.5 and position == 100:
                evaluate("global.ssc.actor.add_effect(new global.ssc.Pass()); true;")
                compare("stock-pass-150%", baseline, capture("stock"), scale, position, position, width, height, None)
            install(scale)
            compare(f"fixed-{scale}-{position}-{width}", baseline, capture("fixed"),
                    scale, position, position, width, height)

        # Reused capacity must render like a fresh effect after growing,
        # shrinking and resizing within a bucket, including fractional scales.
        for scale in [1, 1.25, 1.5, 2]:
            control("scale", scale)
            for width, height in [(330, 260), (580, 400), (200, 160)]:
                evaluate(f"global.ssc.makeShadow(true, 24, 7, 0, 0, {scale}, 400, 300)")
                capture("resize-initial")
                evaluate(f"global.ssc.resizeShadow({width}, {height})")
                reused = capture("resize-reused")
                evaluate(f"global.ssc.makeShadow(true, 24, 7, 0, 0, {scale}, {width}, {height})")
                fresh = capture("resize-fresh")
                delta = abs(reused[:round(700*scale), :round(900*scale)] -
                            fresh[:round(700*scale), :round(900*scale)])
                assert delta.max() <= 1, ("resized shadow differs", scale, width, height, delta.max())
        evaluate("global.ssc.shadowFixture.forEach(a => a.destroy()); global.ssc.shadowFixture = null; true;")
        control("scale", 1)
        print("Reused source/shadow capacity matches fresh allocations at all four scales.", flush=True)

        # New app content must invalidate the cached framebuffer.
        control("change")
        time.sleep(0.15)
        changed = capture("changed-with-effect")
        evaluate("global.ssc.actor.clear_effects(); true;")
        compare("content-update", capture("changed-baseline"), changed, 1, 101, 101, 601, 397)

        control("scale", 1.5)
        evaluate("global.ssc.actor.metaWindow.move_resize_frame(false,101,101,600,400); global.ssc.actor.opacity=153; true;")
        time.sleep(0.25)
        faded = capture("opacity-baseline")
        install(1.5, fill=False)
        compare("opacity-and-fill-off", faded, capture("opacity-fixed"), 1.5, 101, 101, 600, 400, 1)

        # Exercise the clone path used by overview previews, then return to the
        # desktop. Its transform must not poison the cached full-size image.
        evaluate("""global.ssc.actor.opacity=255; global.ssc.actor.clear_effects();
            global.ssc.clone = new global.ssc.Clutter.Clone({source:global.ssc.actor,x:750,y:120});
            global.ssc.clone.set_scale(0.5,0.5); Main.uiGroup.add_child(global.ssc.clone); true;""")
        clone = capture("clone-baseline")
        install(1.5)
        compare("overview-clone", clone, capture("clone-fixed"), 1.5, 750, 120, 300, 200, 1)
        evaluate("global.ssc.clone.destroy(); true;")
        returned = capture("desktop-return")
        evaluate("global.ssc.actor.clear_effects(); true;")
        compare("return-from-clone", capture("return-baseline"), returned, 1.5, 101, 101, 600, 400)

        # A dark shadow must get darker (never brighter) toward a black window.
        # Inspect all four straight edges, including the first exterior pixel.
        for scale in [1, 1.25, 1.5, 2]:
            control("scale", scale)
            for fill in [True, False]:
                for blur, spread, dx, dy in [(18, 0, 0, 0), (32, 4, 3, -3), (8, -2, -2, 2), (0, 8, 0, 0)]:
                    evaluate(f"global.ssc.makeShadow({str(fill).lower()}, {blur}, {spread}, {dx}, {dy}, {scale})")
                    shot = capture("shadow")
                    inset = 0 if fill else 3
                    left, top, right, bottom = [round(v * scale) for v in
                        (201 + inset, 201 + inset, 501 - inset, 441 - inset)]
                    cx, cy = round(351 * scale), round(321 * scale)
                    profiles = [shot[cy, left-12:left+2, 0],
                                shot[cy, right-2:right+12, 0][::-1],
                                shot[top-12:top+2, cx, 0],
                                shot[bottom-2:bottom+12, cx, 0][::-1]]
                    assert all(profile[-1] == 0 for profile in profiles), "Missing opaque window"
                    if blur > 0:
                        straight_exteriors = []
                        for profile in profiles[:4]:
                            opaque = np.flatnonzero(profile == 0)
                            straight_exteriors.append(profile[:int(opaque[0])] if len(opaque) else profile)
                        assert all(len(profile) and profile.min() < 254 for profile in straight_exteriors), (
                            "Missing shadow", scale, fill, blur, spread, dx, dy,
                            [profile[:14].tolist() for profile in profiles[:4]])
                        for edge, profile in zip(["left", "right", "top", "bottom"], straight_exteriors):
                            exterior = profile.astype(np.int16)
                            largest_step = int(np.maximum(0, -np.diff(exterior)).max(initial=0))
                            assert largest_step <= 48, (scale, fill, blur, spread, dx, dy,
                                edge, "Stepped blur", exterior.tolist())
                    else:
                        assert all(profile[:-2].min() < 254 for profile in profiles[:4]), (
                            "Missing unblurred shadow", scale, fill, spread, dx, dy)
                    # Scan into each rounded corner as well as the straight edges.
                    for row in [*range(top, top + round(48 * scale)),
                                *range(bottom - round(48 * scale), bottom)]:
                        profiles.extend([shot[row, left-12:cx, 0],
                                         shot[row, cx:right+12, 0][::-1]])
                    for edge, profile in zip(["left", "right", "top", "bottom"] + ["corner"] * (len(profiles)-4), profiles):
                        peak = int(np.diff(profile).argmax())
                        # Alpha silhouette blur can rise slightly while crossing
                        # a rounded corner; reject only a visible bright seam.
                        assert np.diff(profile)[peak] <= 16, (scale, fill, blur, spread, dx, dy,
                            edge, profile[max(0, peak-2):peak+4].tolist())
        print("Shadow edge continuity passed at 100%, 125%, 150% and 200%.", flush=True)

        # Exercise the queued Cogl passes together. The immediate EGL harness
        # cannot detect spread being lost when a framebuffer is reused too soon.
        for scale in [1, 1.5]:
            control("scale", scale)
            for blur in [0, 24]:
                masses = []
                for spread in [-12, 0, 12]:
                    evaluate(f"global.ssc.makeShadow(true, {blur}, {spread}, 0, 0, {scale})")
                    shot = capture("shadow-spread")
                    left, top = round(201*scale), round(201*scale)
                    cx, cy = round(351*scale), round(321*scale)
                    profiles = [shot[cy, left-round(60*scale):left, 0],
                                shot[top-round(60*scale):top, cx, 0]]
                    masses.append([(255-profile).sum() / (255*scale) for profile in profiles])
                print(f"Spread exterior coverage: scale={scale}, blur={blur}: {masses}", flush=True)
                for axis in range(2):
                    assert masses[2][axis] > masses[1][axis] + 4, (scale, blur, axis, masses)
                    if blur:
                        assert masses[1][axis] > masses[0][axis] + 1.5, (scale, blur, axis, masses)
        print("Positive and negative spread affect both axes with blur enabled.", flush=True)

        print(run(["gjs", "-m", str(repo / "tests/compositor/native-radius-render.js")]), end="")
        log = (root / "cache/shell.log").read_text()
        assert "JS ERROR" not in log, log[-10000:]
        assert "_cogl_framebuffer_add_dependency" not in log, log[-10000:]
        (repo / "dist").mkdir(exist_ok=True)
        artifacts = repo / "tests/artifacts"
        artifacts.mkdir(exist_ok=True)
        (artifacts / "sharpness-results.json").write_text(json.dumps(results, indent=2) + "\n")
    except Exception:
        print((root / "cache/shell.log").read_text()[-10000:])
        raise
    finally:
        if app is not None:
            app.terminate()
            app.wait(timeout=5)
        os.killpg(shell.pid, signal.SIGTERM)
        try:
            shell.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(shell.pid, signal.SIGKILL)
            shell.wait(timeout=5)
