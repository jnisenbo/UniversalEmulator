#!/usr/bin/env bash
# Builds the native helper. Requires Xcode command line tools (xcode-select --install).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build
if [[ "$(uname)" != "Darwin" ]]; then
  echo "arcadia-helper: skipping (macOS only)" >&2
  exit 0
fi
# The Info.plist is embedded in the binary (__TEXT,__info_plist) so this
# command-line tool can carry a Bluetooth usage description.
xcrun swiftc -O \
  -target arm64-apple-macos13 \
  -framework GameController -framework IOBluetooth \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker ArcadiaHelper/Info.plist \
  -o build/arcadia-helper \
  ArcadiaHelper/main.swift
# arm64 binaries must be signed; ld signs ad-hoc already, this makes it explicit.
codesign --force --sign - --identifier com.jnisenbo.arcadia.helper build/arcadia-helper
echo "built native/build/arcadia-helper"
