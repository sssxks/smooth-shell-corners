# /// script
# requires-python = ">=3.13,<3.14"
# dependencies = ["moderngl==5.12.0", "numpy==2.4.2", "pillow==12.1.1"]
# ///
"""Bazzite: uv run tests/shadows/compare.py (after npm run build)."""
import json
import math
import runpy
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
from PIL import Image

repo = Path(__file__).resolve().parents[2]
output = repo / "tests/artifacts/shadows"
output.mkdir(parents=True, exist_ok=True)
subprocess.run(["gjs", "-m", str(Path(__file__).with_name("native.js")), str(output)],
               check=True, timeout=30)
# Reuse the production GLSL harness, including its downsampling and RGBA8 targets.
render = runpy.run_path(str(repo / "tests/unit/render.py"))["render_shadow"]
pixels = bytes([0, 0, 0, 255]) * (64 * 64)


def profiles(alpha):
    center = len(alpha) // 2
    end = len(alpha) - 80
    # Four straight edges, distances 1.5 .. 47.5px; omit the native 1px outline.
    return np.concatenate([alpha[center, 32:79][::-1], alpha[center, end+1:end+48],
                           alpha[32:79, center][::-1], alpha[end+1:end+48, center]])


def shadow(blur, spread, y=0, width=256):
    size = width + 160  # Production actor padding is 80px per side.
    values = dict(effectShadowHole=(80, 80, width+80, width+80), effectShadowHoleRadius=8,
                  effectShadowExp=2, effectShadowOffset=(0, y),
                  effectShadowRectOrigin=(0, 0), effectShadowRectSize=(size, size),
                  fillPadding=1, sampleBounds=(0, 0, 1, 1),
                  pixelStep=(1/size, 1/size), textureOrigin=(0, 0))
    return render(pixels, values, size=size,
                  work_size=math.ceil(size / max(1, blur / 4)),
                  spread=spread, blur_step=blur/4, rect_size=size) / 255


widths = [256, 320, 400]
targets = {state: [np.array(Image.open(output / f"{state}-{width}.png"))[:, :, 3] / 255
                   for width in widths] for state in ["focused", "unfocused"]}
references = {state: np.concatenate([profiles(alpha) for alpha in images])
              for state, images in targets.items()}

best = {state: (float("inf"), None) for state in targets}
# Native shadows have zero offsets. Fit only blur, spread and opacity; retain
# the existing single-layer renderer instead of adding extra per-window passes.
for blur in range(4, 31):
    for spread in range(-3, 11):
        profile = np.concatenate([profiles(shadow(blur, spread, width=width)) for width in widths])
        if not np.any(profile):
            continue
        for state, reference in references.items():
            opacity = round(np.clip(np.dot(profile, reference) / np.dot(profile, profile), 0, 1) * 255)
            error = float(np.mean((profile * opacity / 255 - reference) ** 2))
            if error < best[state][0]:
                best[state] = (error, dict(opacity=opacity, blur=blur, spread=spread, xOffset=0, yOffset=0))

schema = ET.parse(repo / "resources/schemas/org.gnome.shell.extensions.smooth-shell-corners.gschema.xml")
defaults = {key.attrib['name']: key.findtext('default') for key in schema.findall('.//key')}
report = {}
for state, old in [("focused", (45, 18, -2, 4)), ("unfocused", (28, 12, -2, 3))]:
    reference = references[state]
    opacity, blur, spread, y = old
    before = [shadow(blur, spread, y, width) * opacity/255 for width in widths]
    error, config = best[state]
    after = [shadow(config['blur'], config['spread'], width=width) * config['opacity']/255
             for width in widths]
    report[state] = dict(defaults=config,
        old_rmse_alpha255=float(np.sqrt(np.mean((np.concatenate([profiles(alpha) for alpha in before])-reference)**2))*255),
        fitted_rmse_alpha255=math.sqrt(error)*255)
    # Check the committed defaults on independent, larger window sizes.
    configured = [int(defaults[f"{state}-shadow-{key}"]) for key in ["opacity", "blur", "spread", "y-offset"]]
    holdout = {}
    for width in [480, 640]:
        target = np.array(Image.open(output / f"{state}-{width}.png"))[:, :, 3] / 255
        reference = profiles(target)
        a, b, sp, dy = configured
        candidate = profiles(shadow(b, sp, dy, width)) * a / 255
        baseline = profiles(shadow(blur, spread, y, width)) * opacity / 255
        rmse = float(np.sqrt(np.mean((candidate-reference)**2)) * 255)
        old_rmse = float(np.sqrt(np.mean((baseline-reference)**2)) * 255)
        assert rmse < old_rmse * 0.2, (state, width, rmse, old_rmse)
        holdout[width] = dict(old_rmse_alpha255=old_rmse, configured_rmse_alpha255=rmse)
    report[state]['validation'] = holdout
    # White-background contact sheet: native, old, fitted. Hide the interior.
    tiles = []
    for alpha in [targets[state][0], before[0], after[0]]:
        gray = np.uint8(np.clip(np.round(255*(1-alpha)), 0, 255))
        gray[80:336, 80:336] = 245
        tiles.append(gray[48:368, 48:368])
    Image.fromarray(np.concatenate(tiles, axis=1)).save(output / f"{state}-comparison.png")
(output / "results.json").write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
