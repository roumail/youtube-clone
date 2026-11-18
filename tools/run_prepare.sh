#!/usr/bin/env bash
# Prepare one or many videos for the kids library (owner's Mac).
# A wrapper around tools/prepare.sh — see tools/README.md for examples.
#
#   tools/run_prepare.sh [--dest DIR] [--title "Clean Title"] INPUT...
#   ls *.mp4 | tools/run_prepare.sh          (paths on stdin, one per line)
#
# INPUT: video files and/or folders (folders are searched recursively for
#        .mp4 .m4v .mov .mkv .webm .avi). With no INPUT, paths are read from
#        stdin. Works through a symlink on your PATH (e.g. ~/bin/run_prepare).
# --dest:  where prepared folders go (e.g. your Google Drive "Kids Library").
#          Default: $KIDS_LIBRARY, from the environment or from .env in the
#          repo root (gitignored; copy .env.example).
# --title: clean title for a single input file (otherwise its file name is used).
#          With --series it's the episode title.
# --series: these are episodes of NAME. Each file name must contain its season
#          and episode (S01E03 / s1e3 / 1x03). Titles become
#          "NAME - S01E03 - Episode title", filed under DEST/NAME/.
#
# Already-prepared videos are skipped; a failure doesn't stop the batch.
set -uo pipefail

# Resolve symlinks (e.g. ~/bin/run_prepare -> repo/tools/run_prepare.sh) so the
# repo's .env and sibling tools are found from anywhere.
SELF="$0"
while [[ -L "$SELF" ]]; do
  link="$(readlink "$SELF")"
  case "$link" in /*) SELF="$link" ;; *) SELF="$(dirname "$SELF")/$link" ;; esac
done
HERE="$(cd "$(dirname "$SELF")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

usage() { sed -n '2,22p' "$SELF" | sed 's/^# \{0,1\}//'; exit "${1:-2}"; }

DEST=""; TITLE=""; SERIES=""; INPUTS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest) DEST="${2:-}"; shift 2 ;;
    --title) TITLE="${2:-}"; shift 2 ;;
    --series) SERIES="${2:-}"; shift 2 ;;
    -h|--help) usage 0 ;;
    --) shift; INPUTS+=("$@"); break ;;
    -*) echo "unknown option: $1" >&2; usage ;;
    *) INPUTS+=("$1"); shift ;;
  esac
done
# No arguments: read paths from stdin (e.g. `ls *.mp4 | run_prepare`).
if [[ ${#INPUTS[@]} -eq 0 && ! -t 0 ]]; then
  while IFS= read -r line; do [[ -n "$line" ]] && INPUTS+=("$line"); done
fi
[[ ${#INPUTS[@]} -gt 0 ]] || usage

if [[ -z "$DEST" ]]; then
  if [[ -z "${KIDS_LIBRARY:-}" && -f "$ROOT/.env" ]]; then
    set -a; . "$ROOT/.env"; set +a
  fi
  DEST="${KIDS_LIBRARY:-}"
fi
if [[ -z "$DEST" ]]; then
  echo "No destination. Use --dest DIR, or set KIDS_LIBRARY in $ROOT/.env (see .env.example)." >&2
  exit 2
fi
if [[ ! -d "$DEST" ]]; then
  echo "Destination does not exist: $DEST" >&2
  echo "(Create it first, e.g. the 'Kids Library' folder in Google Drive.)" >&2
  exit 1
fi

# Pinned Shaka Packager (no-op if already present).
"$HERE/get-packager.sh" >/dev/null || { echo "could not install Shaka Packager" >&2; exit 1; }

# Expand folders into video files.
FILES=()
for input in "${INPUTS[@]}"; do
  if [[ -d "$input" ]]; then
    while IFS= read -r -d '' f; do FILES+=("$f"); done < <(
      find "$input" -type f \( -iname '*.mp4' -o -iname '*.m4v' -o -iname '*.mov' -o -iname '*.mkv' -o -iname '*.webm' -o -iname '*.avi' \) -print0 | sort -z)
  elif [[ -f "$input" ]]; then
    FILES+=("$input")
  else
    echo "skipping, not found: $input" >&2
  fi
done
[[ ${#FILES[@]} -gt 0 ]] || { echo "no video files found" >&2; exit 1; }
if [[ -n "$TITLE" && ${#FILES[@]} -ne 1 ]]; then
  # (with --series, --title names the single episode)
  echo "--title only works with exactly one video (got ${#FILES[@]})" >&2; exit 2
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
done_n=0; skip_n=0; fail_n=0; FAILED=()

# Episode title from a release-style name: the text after SxxEyy, with dots and
# underscores as spaces, cut at the first quality/source tag.
episode_title_from() { # basename-without-extension, matched-episode-tag
  printf '%s' "${1#*"$2"}" | perl -pe '
    s/[._]+/ /g;
    s/\b(2160p|1080p|720p|576p|480p|4k|uhd|hdr|web[- ]?dl|webrip|web|bluray|bdrip|brrip|hdtv|dvdrip|amzn|nf|dsnp|hmax|atvp|x26[45]|h ?26[45]|hevc|avc|aac|ddp?\d?|dts|proper|repack|multi)\b.*$//i;
    s/^[\s\-]+|[\s\-]+$//g;'
}

for f in "${FILES[@]}"; do
  base="$(basename "$f")"; stem="${base%.*}"; ext="${base##*.}"
  title="$stem"; dest="$DEST"
  if [[ -n "$SERIES" ]]; then
    season=""; episode=""; tag=""
    if [[ "$stem" =~ [Ss]([0-9]{1,3})[Ee]([0-9]{1,3}) ]]; then
      tag="${BASH_REMATCH[0]}"; season="${BASH_REMATCH[1]}"; episode="${BASH_REMATCH[2]}"
    elif [[ "$stem" =~ (^|[^0-9])(([0-9]{1,2})x([0-9]{1,3}))([^0-9]|$) ]]; then
      tag="${BASH_REMATCH[2]}"; season="${BASH_REMATCH[3]}"; episode="${BASH_REMATCH[4]}"
    fi
    if [[ -z "$episode" ]]; then
      echo "== $stem"; echo "   FAILED: no season/episode (e.g. S01E03) in the file name"
      fail_n=$((fail_n + 1)); FAILED+=("$f"); continue
    fi
    ep_title="${TITLE:-$(episode_title_from "$stem" "$tag")}"
    title="$(printf '%s - S%02dE%02d' "$SERIES" "$((10#$season))" "$((10#$episode))")"
    [[ -n "$ep_title" ]] && title="$title - $ep_title"
    dest="$DEST/$SERIES"
  elif [[ -n "$TITLE" ]]; then
    title="$TITLE"
  fi

  src="$f"
  if [[ "$title" != "$stem" ]]; then
    # prepare.sh takes the title from the file name: link under the new name.
    mkdir -p "$TMP/titled"
    src="$TMP/titled/$title.$ext"
    ln -sf "$(cd "$(dirname "$f")" && pwd)/$base" "$src"
  fi
  echo "== $title"
  if [[ -f "$dest/$title/$title.mpd" ]]; then
    echo "   already prepared, skipping"; skip_n=$((skip_n + 1)); continue
  fi
  mkdir -p "$dest"
  if "$HERE/prepare.sh" "$src" "$dest" 2>&1 | sed 's/^/   /'; then
    if [[ -f "$dest/$title/$title.mpd" ]]; then done_n=$((done_n + 1)); else fail_n=$((fail_n + 1)); FAILED+=("$f"); fi
  else
    fail_n=$((fail_n + 1)); FAILED+=("$f")
  fi
done

echo
echo "prepared: $done_n   skipped (already there): $skip_n   failed: $fail_n   → $DEST"
for f in "${FAILED[@]+"${FAILED[@]}"}"; do echo "   FAILED: $f"; done
[[ $fail_n -eq 0 ]]
