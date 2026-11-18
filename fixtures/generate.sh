#!/usr/bin/env bash
# Generate deterministic, synthetic test fixtures (DESIGN.md §7). Nothing real,
# nothing committed: output goes to fixtures/out/ (gitignored, cached in CI).
#
# Tools come from the pinned shaka-streamer-binaries package (ffmpeg, ffprobe,
# Shaka Packager static builds). Override with FFMPEG=/PACKAGER= if needed.
set -euo pipefail

cd "$(dirname "$0")"
FFMPEG="${FFMPEG:-ffmpeg}"
PACKAGER="${PACKAGER:-packager}"
OUT=out
RAW="$OUT/raw"

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

# Package exactly as tools/prepare.sh will: DASH on-demand profile, one file
# per track, manifest named after the video (the title), plus a poster.
package() { # name
  local dir="$OUT/$1"
  mkdir -p "$dir"
  "$PACKAGER" --quiet \
    "in=$RAW/$1.mp4,stream=video,output=$dir/video.mp4" \
    "in=$RAW/$1.mp4,stream=audio,output=$dir/audio.mp4" \
    --mpd_output "$dir/$1.mpd"
  "$FFMPEG" -hide_banner -loglevel error -y -ss 1 -i "$RAW/$1.mp4" \
    -frames:v 1 -q:v 4 "$dir/poster.jpg"
}

make_raw tiny 3
make_raw medium 60
make_raw broken-missing-audio 3

package tiny
package medium
package broken-missing-audio
rm "$OUT/broken-missing-audio/audio.mp4"   # the "broken" part

# Raw inputs for tools/prepare.sh (from M1): already-H.264 and needs-transcode.
cp "$RAW/tiny.mp4" "$OUT/raw-h264.mp4"
"$FFMPEG" -hide_banner -loglevel error -y -i "$RAW/tiny.mp4" \
  -c:v libvpx-vp9 -b:v 0 -crf 40 -deadline realtime -c:a libopus "$OUT/raw-vp9.webm"

rm -rf "$RAW"
echo "fixtures:"; find "$OUT" -type f | sort
