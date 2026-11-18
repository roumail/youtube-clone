#!/usr/bin/env bash
# Generate deterministic, synthetic test fixtures (DESIGN.md §7). Nothing real,
# nothing committed: output goes to fixtures/out/ (gitignored, cached in CI).
# Packaged fixtures are produced by tools/prepare.sh itself, so every e2e run
# exercises the real preparation path.
# Needs: ffmpeg + ffprobe on PATH, and tools/get-packager.sh run once.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PREPARE="$HERE/../tools/prepare.sh"
OUT="$HERE/out"
RAW="$OUT/raw"
FFMPEG="${FFMPEG:-ffmpeg}"

"$FFMPEG" -hide_banner -version | head -1
rm -rf "$OUT"
mkdir -p "$RAW"

# Synthetic H.264/AAC source: test pattern with frame counter + 440 Hz tone.
# Fixed GOP (2 s at 30 fps) so segment boundaries are deterministic.
make_raw() { # name seconds
  "$FFMPEG" -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc=size=640x360:rate=30:duration=$2" \
    -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=$2" \
    -c:v libx264 -profile:v main -pix_fmt yuv420p -g 60 -keyint_min 60 -sc_threshold 0 \
    -c:a aac -b:a 96k -ac 2 -shortest \
    "$RAW/$1.mp4"
}

make_raw tiny 3
make_raw medium 60
make_raw broken-missing-audio 3

for name in tiny medium broken-missing-audio; do
  "$PREPARE" "$RAW/$name.mp4" "$OUT" >/dev/null
done
rm "$OUT/broken-missing-audio/audio.mp4"   # the "broken" part

# Raw inputs: already-H.264 (repackage path) and VP9/Opus (re-encode path).
cp "$RAW/tiny.mp4" "$OUT/raw-h264.mp4"
"$FFMPEG" -hide_banner -loglevel error -y -i "$RAW/tiny.mp4" \
  -c:v libvpx-vp9 -b:v 0 -crf 40 -deadline realtime -c:a libopus "$OUT/raw-vp9.webm"

# Exercise the re-encode path of prepare.sh too.
"$PREPARE" "$OUT/raw-vp9.webm" "$OUT/prepared-from-vp9" >/dev/null
test -f "$OUT/prepared-from-vp9/raw-vp9/raw-vp9.mpd"

rm -rf "$RAW"
echo "fixtures:"; find "$OUT" -type f | sort
