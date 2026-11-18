#!/usr/bin/env bash
# Supply-chain check (CI): the vendored Shaka Player must be byte-identical to
# the official npm release of the same version. npm verifies the tarball's
# integrity against the registry; we then compare the file.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=5.3.5
VENDORED="app/vendor/shaka-player-$VERSION.compiled.js"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
( cd "$WORK" && npm pack "shaka-player@$VERSION" --silent >/dev/null && tar -xzf "shaka-player-$VERSION.tgz" package/dist/shaka-player.compiled.js )
if cmp -s "$VENDORED" "$WORK/package/dist/shaka-player.compiled.js"; then
  echo "OK: $VENDORED matches shaka-player@$VERSION from npm"
else
  echo "MISMATCH: $VENDORED differs from shaka-player@$VERSION on npm" >&2; exit 1
fi
