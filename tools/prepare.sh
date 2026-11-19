#!/usr/bin/env bash
# Prepare one video for the library.
#
#   tools/prepare.sh "My Video.mp4" "<Kids Library>"
#
# Writes "<output-root>/My Video.kidsvideo": one file (an uncompressed tar) holding:
#   My Video.mpd   DASH manifest; its file name is the title shown in the app
#   video.mp4      video track (H.264, single file, byte-range segments)
#   audio.mp4      audio track (AAC)
#   poster.jpg     thumbnail
#
# Audio: if there are several audio tracks, the first English one is used
# (language tag en/eng/english); otherwise the first audio track.
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
if [[ -f "$ROOT/$TITLE.kidsvideo" ]]; then echo "already prepared: $TITLE"; exit 0; fi

probe() { "$FFPROBE" -v error -select_streams "$1" -show_entries stream=codec_name -of csv=p=0 "$INPUT" | head -1; }

# Which audio stream (absolute index): first English, else first audio.
AUDIO_LIST="$("$FFPROBE" -v error -select_streams a -show_entries stream=index:stream_tags=language -of csv=p=0 "$INPUT")"
AIDX="$(awk -F, 'tolower($2) ~ /^(en|eng|english)$/ { print $1; exit }' <<<"$AUDIO_LIST")"
[[ -n "$AIDX" ]] || AIDX="$(head -1 <<<"$AUDIO_LIST" | cut -d, -f1)"
[[ -n "$AIDX" ]] || { echo "no audio track in $INPUT" >&2; exit 1; }
ALANG="$(awk -F, -v i="$AIDX" '$1 == i { print ($2 == "" ? "unknown" : $2) }' <<<"$AUDIO_LIST")"
echo "audio: stream $AIDX ($ALANG) of $(wc -l <<<"$AUDIO_LIST" | tr -d ' ') audio track(s)"

VCODEC="$(probe v:0)"; ACODEC="$(probe "$AIDX")"
EXT="$(tr '[:upper:]' '[:lower:]' <<<"${NAME##*.}")"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# Live progress for long re-encodes, drawn straight on the terminal (callers
# like run_prepare.sh filter stdout line by line, which would hide a bar).
# No terminal (CI, redirected output): no bar. PROGRESS_OUT overrides the target.
PROGRESS_OUT="${PROGRESS_OUT:-/dev/tty}"
can_draw() { { : >"$PROGRESS_OUT"; } 2>/dev/null; }
fmt_time() { local s=$1; if (( s >= 3600 )); then printf '%d:%02d:%02d' $((s/3600)) $((s%3600/60)) $((s%60)); else printf '%d:%02d' $((s/60)) $((s%60)); fi; }
draw_progress() { # stdin: ffmpeg -progress key=value lines; $1: total seconds
  local total_us t=0 speed="?" pct=0 start=$SECONDS elapsed eta bar
  total_us=$(awk -v d="$1" 'BEGIN { printf "%d", d * 1000000 }')
  while IFS='=' read -r key val; do
    case "$key" in
      out_time_us) [[ "$val" =~ ^[0-9]+$ ]] && t=$val ;;
      speed) speed="${val// /}" ;;
      progress)
        (( total_us > 0 )) && pct=$(( t * 100 / total_us )); (( pct > 100 )) && pct=100
        [[ "$val" == end ]] && pct=100
        elapsed=$(( SECONDS - start ))
        if (( pct > 0 )); then eta="ETA $(fmt_time $(( elapsed * (100 - pct) / pct )))"; else eta="ETA ?"; fi
        bar=$(printf '%*s' $(( pct / 5 )) '' | tr ' ' '#')$(printf '%*s' $(( 20 - pct / 5 )) '' | tr ' ' '-')
        printf '\r   re-encoding [%s] %3d%%  %s / %s  speed %s  %s   ' "$bar" "$pct" \
          "$(fmt_time $(( t / 1000000 )))" "$(fmt_time $(( total_us / 1000000 )))" "$speed" "$eta" >>"$PROGRESS_OUT"
        [[ "$val" == end ]] && printf '\n' >>"$PROGRESS_OUT"
        ;;
    esac
  done
}
SRC="$INPUT"
if [[ "$VCODEC" != h264 || "$ACODEC" != aac || ! "$EXT" =~ ^(mp4|m4v|mov)$ ]]; then
  echo "re-encoding ($EXT, video=$VCODEC, audio=$ACODEC) -> H.264/AAC"
  VARGS=(-c:v libx264 -preset medium -crf 21 -pix_fmt yuv420p)
  AARGS=(-c:a aac -b:a 128k -ac 2)
  [[ "$VCODEC" == h264 ]] && VARGS=(-c:v copy)
  [[ "$ACODEC" == aac ]] && AARGS=(-c:a copy)
  ENC=("$FFMPEG" -hide_banner -loglevel error -y -i "$INPUT" -map 0:v:0 -map "0:$AIDX"
       "${VARGS[@]}" "${AARGS[@]}" -movflags +faststart)
  STARTED=$SECONDS
  if can_draw; then
    IN_DUR="$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$INPUT")"
    "${ENC[@]}" -nostats -progress pipe:1 "$WORK/src.mp4" | draw_progress "${IN_DUR:-0}"
  else
    "${ENC[@]}" "$WORK/src.mp4"
  fi
  echo "re-encoded in $(fmt_time $(( SECONDS - STARTED )))"
  SRC="$WORK/src.mp4"
  ASEL=audio   # the re-encoded file has exactly one audio track
else
  echo "already H.264/AAC: repackaging only"
  ASEL="$AIDX" # packager accepts a zero-based stream index
fi

mkdir -p "$WORK/out"
"$PACKAGER" --quiet \
  "in=$SRC,stream=video,output=$WORK/out/video.mp4" \
  "in=$SRC,stream=$ASEL,output=$WORK/out/audio.mp4" \
  --mpd_output "$WORK/out/$TITLE.mpd"

# Poster from 10% into the video.
DUR="$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$SRC")"
AT="$(awk -v d="$DUR" 'BEGIN { printf "%.2f", d * 0.1 }')"
"$FFMPEG" -hide_banner -loglevel error -y -ss "$AT" -i "$SRC" -frames:v 1 -vf "scale=640:-2" -q:v 4 "$WORK/out/poster.jpg"

mkdir -p "$ROOT"
mv "$WORK/out" "$DEST"
# One file per video: "<Title>.kidsvideo" (the app adds it in a single pick).
"$HERE/pack.sh" "$DEST" >/dev/null
rm -rf "$DEST"
echo "prepared: $ROOT/$TITLE.kidsvideo"
ls -lh "$ROOT/$TITLE.kidsvideo"
