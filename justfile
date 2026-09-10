set shell := ["bash", "-euo", "pipefail", "-c"]

default: check

deps:
    npm install

build:
    npm run build

check:
    npm run check
    npm run test:gjs

install: build
    ./install.sh

pack: build
    rm -f smooth-shell-corners@xks.shell-extension.zip
    cd dist && zip -9r ../smooth-shell-corners@xks.shell-extension.zip . -x schemas/gschemas.compiled restore-native-radius.js 'tools/*'

# Bazzite / GNOME 50; builds the checkout and benchmarks a private Shell.
benchmark: benchmark-check
    timeout 240s uv run tests/performance/run.py

benchmark-check:
    uv run --python 3.13 tests/performance/test_capture.py

# RX 7900 XT / Bazzite: real GL timestamps and per-process GPU engine counters.
profile-gpu: profile-gpu-check
    timeout 150s uv run tests/performance/gpu/run.py

profile-gpu-check:
    timeout 60s uv run tests/performance/gpu/test_analysis.py

# Exercise actual pointer events and overview chrome in a private Shell.
test-hover:
    timeout 180s uv run tests/performance/hover.py

benchmark-compare before after:
    uv run tests/performance/compare.py '{{before}}' '{{after}}'

clean:
    rm -rf dist smooth-shell-corners@xks.shell-extension.zip

# Fit native GTK shadow profiles against the production GLSL on this Bazzite host.
calibrate-shadows: build
    timeout 120s uv run tests/shadows/compare.py
