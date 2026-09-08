#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
rm -rf dist
npx tsc
cp resources/metadata.json resources/stylesheet.css dist/
cp -r resources/schemas dist/schemas
glib-compile-schemas dist/schemas
