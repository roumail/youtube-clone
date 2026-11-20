#!/usr/bin/env bash
# Generate deterministic, synthetic test fixtures. Nothing real,
# nothing committed: output goes to fixtures/out/ (gitignored, cached in CI).
# Packaged fixtures are produced by "kidsvideo prepare" itself (tools/kidsvideo/),
# so every e2e run exercises the real preparation path.
# Needs: ffmpeg + ffprobe on PATH, tools/get-packager.sh run once, and kidsvideo
# built (tools/bin/kidsvideo, or KIDSVIDEO=...).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
KIDSVIDEO="${KIDSVIDEO:-$HERE/../tools/bin/kidsvideo}"
prepare() { "$KIDSVIDEO" prepare --dest "$2" "$1"; } # <video> <output folder>
OUT="$HERE/out"
RAW="$OUT/raw"
FFMPEG="${FFMPEG:-ffmpeg}"

"$FFMPEG" -hide_banner -version | sed -n 1p
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

# "long": 1 hour 5 seconds, for times with hours. A tiny picture at one frame
# per second and silent audio keep it small.
"$FFMPEG" -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc=size=160x90:rate=1:duration=3605" \
  -f lavfi -i "anullsrc=channel_layout=mono:sample_rate=48000" \
  -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709" \
  -c:v libx264 -profile:v main -g 10 -c:a aac -b:a 16k -t 3605 \
  "$RAW/long.mp4"

# "surround": "tiny" with 5.1 audio (6 channels at 384 kbit/s), as many films have.
"$FFMPEG" -hide_banner -loglevel error -y -i "$RAW/tiny.mp4" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=3" \
  -map 0:v -map 1:a -c:v copy -c:a aac -ac 6 -b:a 384k -shortest "$RAW/surround.mp4"

for name in tiny medium broken-missing-audio episode-like long surround; do
  prepare "$RAW/$name.mp4" "$OUT" >/dev/null
done

# Series episodes: titles "Series - SxxEyy - Episode". Prepared
# from copies of "tiny" named like real episodes, out of order on purpose.
# "Show - S01E03" has no episode title.
for ep in "Show - S01E10 - Tenth" "Show - S01E02 - Second" "Show - S01E01 - First" "Show - S01E03"; do
  cp "$RAW/tiny.mp4" "$RAW/$ep.mp4"
  prepare "$RAW/$ep.mp4" "$OUT" >/dev/null
done

# For search: the episode name "Second" again, in another series and as a
# standalone video, from copies of "tiny".
for name in "Garden - S02E01 - Second" "Second"; do
  cp "$RAW/tiny.mp4" "$RAW/$name.mp4"
  prepare "$RAW/$name.mp4" "$OUT" >/dev/null
done

# A standalone video named exactly like the series "Show", from a copy of "tiny".
cp "$RAW/tiny.mp4" "$RAW/Show.mp4"
prepare "$RAW/Show.mp4" "$OUT" >/dev/null

# The longest title kidsvideo pack accepts (95 bytes), from a copy of "tiny".
LONG_TITLE="The Longest Title Allowed - A Tale About Many Long Words That Keeps Going Until It Finally Ends"
cp "$RAW/tiny.mp4" "$RAW/$LONG_TITLE.mp4"
prepare "$RAW/$LONG_TITLE.mp4" "$OUT" >/dev/null

# Unpack every container into a same-named folder: tests that seed the library
# directly (not through the picker) load the parts over HTTP. Test-only; the
# real output is just the .kidsvideo file.
for c in "$OUT"/*.kidsvideo; do
  d="${c%.kidsvideo}"; mkdir -p "$d"; tar -xf "$c" -C "$d"
done

# kidsvideo pack refuses a title that is 95 characters but 96 bytes (one "é"): its
# name would fill the tar name field with no closing NUL.
ACCENTED_TITLE="The Longest Title Allowed - A Café About Many Long Words That Keeps Going Until It Finally Ends"
mkdir "$RAW/$ACCENTED_TITLE"
cp "$OUT/tiny/"{video.mp4,audio.mp4,poster.jpg} "$RAW/$ACCENTED_TITLE/"
cp "$OUT/tiny/tiny.mpd" "$RAW/$ACCENTED_TITLE/$ACCENTED_TITLE.mpd"
if "$KIDSVIDEO" pack "$RAW/$ACCENTED_TITLE" >/dev/null 2>&1; then
  echo "kidsvideo pack accepted a title over 95 bytes" >&2; exit 1
fi

# Broken containers can't come from kidsvideo pack, so they're built with tar,
# in format 2: kidsvideo.json first.
format2() { printf '{"format":2,"title":"%s"}\n' "$1" > "$RAW/kidsvideo.json"; }

# A container without its manifest (no .mpd).
format2 no-manifest
COPYFILE_DISABLE=1 tar --format=ustar -cf "$OUT/no-manifest.kidsvideo" \
  -C "$RAW" kidsvideo.json -C "$OUT/tiny" poster.jpg audio.mp4 video.mp4

# A container with a part missing (no audio.mp4).
rm "$OUT/broken-missing-audio.kidsvideo"
format2 broken-missing-audio
COPYFILE_DISABLE=1 tar --format=ustar -cf "$OUT/broken-missing-audio.kidsvideo" \
  -C "$RAW" kidsvideo.json -C "$OUT/broken-missing-audio" broken-missing-audio.mpd poster.jpg video.mp4

# A container made by the tools before format 2: no kidsvideo.json.
COPYFILE_DISABLE=1 tar --format=ustar -cf "$OUT/old-format.kidsvideo" \
  -C "$OUT/tiny" tiny.mpd poster.jpg audio.mp4 video.mp4

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
"$KIDSVIDEO" pack "$OUT/unplayable" >/dev/null

# A film-like manifest: "tiny" whose declared (peak) bitrate is 100x its real
# one, as with real films. Shaka's own size guess (bitrate x duration) is then
# far bigger than the video, so a space check must use the real size.
cp -R "$OUT/tiny" "$OUT/high-peak"
mv "$OUT/high-peak/tiny.mpd" "$OUT/high-peak/high-peak.mpd"
perl -pi -e 's/bandwidth="(\d+)"/"bandwidth=\"" . ($1 * 100) . "\""/ge' "$OUT/high-peak/high-peak.mpd"
cmp -s "$OUT/tiny/tiny.mpd" "$OUT/high-peak/high-peak.mpd" \
  && { echo "high-peak fixture: bandwidth not changed" >&2; exit 1; }
"$KIDSVIDEO" pack "$OUT/high-peak" >/dev/null

# Size target: at most 540p, video at most 0.7 Mbit/s on average, stereo audio
# at 64 kbit/s. "episode-like" is 1080p; "surround" has 5.1 audio.
seconds() { sed -n 's/.*mediaPresentationDuration="PT\([0-9.]*\)S".*/\1/p' "$1"; }
kbps() { awk -v bytes="$(wc -c < "$1")" -v s="$2" 'BEGIN { printf "%d", bytes * 8 / s / 1000 }'; }
grep -q 'height="540"' "$OUT/episode-like/episode-like.mpd" \
  || { echo "size target: episode-like (1080p) not scaled to 540p" >&2; exit 1; }
(( $(kbps "$OUT/episode-like/video.mp4" "$(seconds "$OUT/episode-like/episode-like.mpd")") <= 700 )) \
  || { echo "size target: episode-like video above 0.7 Mbit/s" >&2; exit 1; }
grep -q 'AudioChannelConfiguration[^>]*value="2"' "$OUT/surround/surround.mpd" \
  || { echo "size target: surround audio not stereo" >&2; exit 1; }
(( $(kbps "$OUT/surround/audio.mp4" "$(seconds "$OUT/surround/surround.mpd")") <= 80 )) \
  || { echo "size target: surround audio above 64 kbit/s" >&2; exit 1; }

grep -q 'lang="en"' "$OUT/episode-like/episode-like.mpd" \
  || { echo "kidsvideo prepare did not pick the English audio track" >&2; exit 1; }

# Raw inputs: already-H.264 (repackage path) and VP9/Opus (re-encode path).
cp "$RAW/tiny.mp4" "$OUT/raw-h264.mp4"
"$FFMPEG" -hide_banner -loglevel error -y -i "$RAW/tiny.mp4" \
  -c:v libvpx-vp9 -b:v 0 -crf 40 -deadline realtime -c:a libopus "$OUT/raw-vp9.webm"

# Exercise the re-encode path of kidsvideo prepare too.
prepare "$OUT/raw-vp9.webm" "$OUT/prepared-from-vp9" >/dev/null
test -f "$OUT/prepared-from-vp9/raw-vp9.kidsvideo"

rm -rf "$RAW"
echo "fixtures:"; find "$OUT" -type f | sort
