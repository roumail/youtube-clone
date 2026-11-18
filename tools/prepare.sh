#!/usr/bin/env bash
# Prepare one video for the library (DESIGN.md §4).
#
#   tools/prepare.sh "My Video.mp4" "<Google Drive>/Kids Library"
#
# Writes "<output-root>/My Video/" containing:
#   My Video.mpd   DASH manifest; its file name is the title shown in the app
#   video.mp4      video track (H.264, single file, byte-range segments)
#   audio.mp4      audio track (AAC)
#   poster.jpg     thumbnail
#
# Re-encodes only when the input isn't already H.264 + AAC in MP4/MOV;
# otherwise it just repackages (fast). Skips videos already prepared.
# Needs: ffmpeg + ffprobe on PATH, and tools/get-packager.sh run once.
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "usage: $0 <input-video> [output-root]   (default output-root: ./prepared)" >&2; exit 2
fi
INPUT="$1"
ROOT="${2:-prepared}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PACKAGER="${PACKAGER:-$HERE/bin/packager}"
FFMPEG="${FFMPEG:-ffmpeg}"
FFPROBE="${FFPROBE:-ffprobe}"

[[ -f "$INPUT" ]] || { echo "no such file: $INPUT" >&2; exit 1; }
[[ -x "$PACKAGER" ]] || { echo "Shaka Packager not found; run tools/get-packager.sh" >&2; exit 1; }

NAME="$(basename "$INPUT")"; TITLE="${NAME%.*}"
DEST="$ROOT/$TITLE"
if [[ -f "$DEST/$TITLE.mpd" ]]; then echo "already prepared: $DEST"; exit 0; fi

probe() { "$FFPROBE" -v error -select_streams "$1" -show_entries stream=codec_name -of csv=p=0 "$INPUT" | head -1; }
VCODEC="$(probe v:0)"; ACODEC="$(probe a:0)"
EXT="$(tr '[:upper:]' '[:lower:]' <<<"${NAME##*.}")"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
SRC="$INPUT"
if [[ "$VCODEC" != h264 || "$ACODEC" != aac || ! "$EXT" =~ ^(mp4|m4v|mov)$ ]]; then
  echo "re-encoding ($EXT, video=$VCODEC, audio=$ACODEC) -> H.264/AAC"
  VARGS=(-c:v libx264 -preset medium -crf 21 -pix_fmt yuv420p)
  AARGS=(-c:a aac -b:a 128k -ac 2)
  [[ "$VCODEC" == h264 ]] && VARGS=(-c:v copy)
  [[ "$ACODEC" == aac ]] && AARGS=(-c:a copy)
  "$FFMPEG" -hide_banner -loglevel error -y -i "$INPUT" -map 0:v:0 -map 0:a:0 \
    "${VARGS[@]}" "${AARGS[@]}" -movflags +faststart "$WORK/src.mp4"
  SRC="$WORK/src.mp4"
else
  echo "already H.264/AAC: repackaging only"
fi

mkdir -p "$WORK/out"
"$PACKAGER" --quiet \
  "in=$SRC,stream=video,output=$WORK/out/video.mp4" \
  "in=$SRC,stream=audio,output=$WORK/out/audio.mp4" \
  --mpd_output "$WORK/out/$TITLE.mpd"

# Poster from 10% into the video.
DUR="$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$SRC")"
AT="$(awk -v d="$DUR" 'BEGIN { printf "%.2f", d * 0.1 }')"
"$FFMPEG" -hide_banner -loglevel error -y -ss "$AT" -i "$SRC" -frames:v 1 -vf "scale=640:-2" -q:v 4 "$WORK/out/poster.jpg"

mkdir -p "$ROOT"
mv "$WORK/out" "$DEST"
echo "prepared: $DEST"
ls -lh "$DEST"
