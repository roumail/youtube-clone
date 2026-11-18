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
    -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709" \
    -c:v libx264 -profile:v main -g 60 -keyint_min 60 -sc_threshold 0 \
    -c:a aac -b:a 96k -ac 2 -shortest \
    "$RAW/$1.mp4"
}

# Episode-like source, mirroring a real web download: 1080p H.264 High,
# BT.709, 25 fps, and TWO audio tracks with Chinese first, English second.
make_episode_like() { # name seconds
  "$FFMPEG" -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc=size=1920x1080:rate=25:duration=$2" \
    -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=$2" \
    -f lavfi -i "sine=frequency=880:sample_rate=48000:duration=$2" \
    -map 0:v -map 1:a -map 2:a \
    -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709" \
    -c:v libx264 -profile:v high -preset veryfast -g 50 \
    -c:a aac -b:a 128k -ac 2 \
    -metadata:s:a:0 language=zho -metadata:s:a:1 language=eng -shortest \
    "$RAW/$1.mp4"
}

make_raw tiny 3
make_episode_like episode-like 10
make_raw medium 60
make_raw broken-missing-audio 3

for name in tiny medium broken-missing-audio episode-like; do
  "$PREPARE" "$RAW/$name.mp4" "$OUT" >/dev/null
done
rm "$OUT/broken-missing-audio/audio.mp4"   # the "broken" part

# Series episodes (DESIGN.md §3): titles "Series - SxxEyy - Episode". Prepared
# from copies of "tiny" named like real episodes, out of order on purpose.
for ep in "Show - S01E10 - Tenth" "Show - S01E02 - Second" "Show - S01E01 - First"; do
  cp "$RAW/tiny.mp4" "$RAW/$ep.mp4"
  "$PREPARE" "$RAW/$ep.mp4" "$OUT" >/dev/null
done

# Real episodes declare SDR colour (BT.709). Shaka marks such video hdr=SDR,
# which its default offline track picker drops on P3 screens. Fixtures must
# carry the same signal so CI covers it.
grep -q 'TransferCharacteristics" value="1"' "$OUT/tiny/tiny.mpd" \
  || { echo "fixture manifest lacks BT.709 TransferCharacteristics" >&2; exit 1; }
# A video this device can't play: "tiny" with a codec no browser supports.
# Shaka's capability filter drops it, so a store would keep 0 tracks.
cp -R "$OUT/tiny" "$OUT/unplayable"
mv "$OUT/unplayable/tiny.mpd" "$OUT/unplayable/unplayable.mpd"
sed -i.bak 's/codecs="avc1\.[0-9A-Fa-f]*"/codecs="xyz1.000000"/' "$OUT/unplayable/unplayable.mpd" && rm "$OUT/unplayable/unplayable.mpd.bak"
grep -q 'codecs="xyz1.000000"' "$OUT/unplayable/unplayable.mpd" \
  || { echo "unplayable fixture: codec not replaced" >&2; exit 1; }

grep -q 'lang="en"' "$OUT/episode-like/episode-like.mpd" \
  || { echo "prepare.sh did not pick the English audio track" >&2; exit 1; }

# Raw inputs: already-H.264 (repackage path) and VP9/Opus (re-encode path).
cp "$RAW/tiny.mp4" "$OUT/raw-h264.mp4"
"$FFMPEG" -hide_banner -loglevel error -y -i "$RAW/tiny.mp4" \
  -c:v libvpx-vp9 -b:v 0 -crf 40 -deadline realtime -c:a libopus "$OUT/raw-vp9.webm"

# Exercise the re-encode path of prepare.sh too.
"$PREPARE" "$OUT/raw-vp9.webm" "$OUT/prepared-from-vp9" >/dev/null
test -f "$OUT/prepared-from-vp9/raw-vp9/raw-vp9.mpd"

rm -rf "$RAW"
echo "fixtures:"; find "$OUT" -type f | sort
