#!/usr/bin/env bash
# Prepare one or many videos for the kids library (owner's Mac).
# A wrapper around tools/prepare.sh — see tools/README.md for examples.
#
#   tools/run_prepare.sh [--dest DIR] [--title "Clean Title"] INPUT...
#
# INPUT: video files and/or folders (folders are searched recursively for
#        .mp4 .m4v .mov .mkv .webm .avi).
# --dest:  where prepared folders go (e.g. your Google Drive "Kids Library").
#          Default: $KIDS_LIBRARY, from the environment or from .env in the
#          repo root (gitignored; copy .env.example).
# --title: clean title for a single input file (otherwise its file name is used).
#
# Already-prepared videos are skipped; a failure doesn't stop the batch.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-2}"; }

DEST=""; TITLE=""; INPUTS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest) DEST="${2:-}"; shift 2 ;;
    --title) TITLE="${2:-}"; shift 2 ;;
    -h|--help) usage 0 ;;
    --) shift; INPUTS+=("$@"); break ;;
    -*) echo "unknown option: $1" >&2; usage ;;
    *) INPUTS+=("$1"); shift ;;
  esac
done
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
  echo "--title only works with exactly one video (got ${#FILES[@]})" >&2; exit 2
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
done_n=0; skip_n=0; fail_n=0; FAILED=()

for f in "${FILES[@]}"; do
  src="$f"
  if [[ -n "$TITLE" ]]; then
    # prepare.sh takes the title from the file name: link under the clean name.
    ext="${f##*.}"
    mkdir -p "$TMP/titled"
    src="$TMP/titled/$TITLE.$ext"
    ln -sf "$(cd "$(dirname "$f")" && pwd)/$(basename "$f")" "$src"
  fi
  name="$(basename "$src")"; title="${name%.*}"
  echo "== $title"
  if [[ -f "$DEST/$title/$title.mpd" ]]; then
    echo "   already prepared, skipping"; skip_n=$((skip_n + 1)); continue
  fi
  if "$HERE/prepare.sh" "$src" "$DEST" 2>&1 | sed 's/^/   /'; then
    if [[ -f "$DEST/$title/$title.mpd" ]]; then done_n=$((done_n + 1)); else fail_n=$((fail_n + 1)); FAILED+=("$f"); fi
  else
    fail_n=$((fail_n + 1)); FAILED+=("$f")
  fi
done

echo
echo "prepared: $done_n   skipped (already there): $skip_n   failed: $fail_n   → $DEST"
for f in "${FAILED[@]+"${FAILED[@]}"}"; do echo "   FAILED: $f"; done
[[ $fail_n -eq 0 ]]
