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
    cd dist && zip -9r ../smooth-shell-corners@xks.shell-extension.zip .

clean:
    rm -rf dist smooth-shell-corners@xks.shell-extension.zip
