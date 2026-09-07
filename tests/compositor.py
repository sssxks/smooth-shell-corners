# /// script
# requires-python = ">=3.13,<3.14"
# dependencies = ["pillow==12.1.1", "numpy==2.4.2"]
# ///
"""Bazzite / GNOME 50: uv run tests/compositor.py (isolated headless Shell).

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

repo = Path(__file__).resolve().parent.parent
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
import {{RoundedCornersEffect}} from '{repo.as_uri()}/effect.js';
const Pass = GObject.registerClass(class SSCProbePass extends Shell.GLSLEffect {{
    vfunc_build_pipeline() {{ this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, '', '', false); }}
}});
export default class Probe {{
    enable() {{
        global.context.unsafe_mode = true;
        global.ssc = {{RoundedCornersEffect, Pass, Clutter}};
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
    shell = subprocess.Popen(["dbus-run-session", "--", "bash", str(launch)], env=env,
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             text=True, start_new_session=True)
    app = None
    try:
        assert select.select([shell.stdout], [], [], 20)[0], "No private bus address"
        env["DBUS_SESSION_BUS_ADDRESS"] = shell.stdout.readline().strip()
        assert env["DBUS_SESSION_BUS_ADDRESS"], "Private bus failed to start"
        run(["gdbus", "wait", "--session", "--timeout", "20", "org.example.SSCProbe"], timeout=25)
        app = subprocess.Popen(["gjs", "-m", str(repo / "tests/compositor-app.js")], env=env,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        run(["gdbus", "wait", "--session", "--timeout", "10", "org.example.SSCSharpness"], timeout=15)
        time.sleep(0.5)  # Let the first Wayland configure/paint finish.

        def control(command, argument=""):
            return json.loads(run(["gjs", "-m", str(repo / "tests/compositor-driver.js"), command, str(argument)]))

        def evaluate(code):
            return control("eval", code)

        evaluate("global.ssc.actor = global.get_window_actors().find(a => a.metaWindow.title === 'SSC text test'); true;")

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

        (repo / "dist").mkdir(exist_ok=True)
        (repo / "dist/sharpness-results.json").write_text(json.dumps(results, indent=2) + "\n")
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
