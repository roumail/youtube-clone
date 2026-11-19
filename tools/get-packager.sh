#!/usr/bin/env bash
# Download the pinned Shaka Packager binary into tools/bin/packager and verify
# its SHA-256. No Python, no package manager. Re-running is a no-op.
set -euo pipefail

VERSION=v3.9.3
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) ASSET=packager-osx-arm64 SHA=b3049e743451aab5c2cd7b1316a4ce055682c41effe06a49e2e6c95a9243d351 ;;
  Linux-x86_64) ASSET=packager-linux-x64 SHA=7a3cf35ad146fd7810b4ededab363c8a3e6121d1b2c8391f53863126186f9ee6 ;;
  Linux-aarch64) ASSET=packager-linux-arm64 SHA=d3a50cecc139b54435be1bbbfba5c0ea822d9e1e7edc3531f7821fba65ceebb0 ;;
  *) echo "unsupported platform: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

BIN="$(cd "$(dirname "$0")" && pwd)/bin"
OUT="$BIN/packager"
mkdir -p "$BIN"

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }

if [[ -x "$OUT" && "$(sha256 "$OUT")" == "$SHA" ]]; then
  echo "$OUT ($VERSION) already present"; exit 0
fi

curl -fsSL -o "$OUT.tmp" "https://github.com/shaka-project/shaka-packager/releases/download/$VERSION/$ASSET"
if [[ "$(sha256 "$OUT.tmp")" != "$SHA" ]]; then
  rm -f "$OUT.tmp"; echo "checksum mismatch for $ASSET" >&2; exit 1
fi
chmod +x "$OUT.tmp" && mv "$OUT.tmp" "$OUT"
echo "installed $OUT ($VERSION)"
