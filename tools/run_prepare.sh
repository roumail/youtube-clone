#!/usr/bin/env bash
# Prepare one or many videos for the kids library (owner's Mac).
# Around "kidsvideo prepare" (tools/kidsvideo/), one video at a time — see
# tools/README.md for examples.
#
#   tools/run_prepare.sh [--dest DIR] [--title "T"] [--series "S"] [--tmux] INPUT...
#   ls *.mp4 | tools/run_prepare.sh          (paths on stdin, one per line)
#
# INPUT: video files and/or folders (folders are searched recursively for
#        .mp4 .m4v .mov .mkv .webm .avi). With no INPUT, paths are read from
#        stdin. Works through a symlink on your PATH (e.g. ~/bin/run_prepare).
# --dest:  where prepared folders go (e.g. your "Kids Library" folder).
#          Default: $KIDS_LIBRARY, from the environment or from .env in the
#          repo root (gitignored; copy .env.example).
# --title: title for a single input file. Otherwise the file name is tidied:
#          "Frozen.2.2019.1080p.BluRay.x264-GRP" -> "Frozen 2 2019".
#          With --series it's the episode title.
# --series: these are episodes of NAME. Each file name must contain its season
#          and episode (S01E03 / s1e3 / 1x03). Titles become
#          "NAME - S01E03 - Episode title", filed under DEST/NAME/.
# --tmux:  run the job detached in a tmux session (survives closing the
#          terminal); prints how to watch it. Needs tmux (brew install tmux).
#          RUN_PREPARE_TMUX=1 in .env makes it the default; --no-tmux overrides.
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

usage() { sed -n '2,24p' "$SELF" | sed 's/^# \{0,1\}//'; exit "${1:-2}"; }

DEST=""; TITLE=""; SERIES=""; USE_TMUX=""; INPUTS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest) DEST="${2:-}"; shift 2 ;;
    --title) TITLE="${2:-}"; shift 2 ;;
    --series) SERIES="${2:-}"; shift 2 ;;
    --tmux) USE_TMUX=1; shift ;;
    --no-tmux) USE_TMUX=0; shift ;;
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

# Defaults from the repo's .env (gitignored). Variables already set in the
# environment win over .env; command-line options win over both.
if [[ -f "$ROOT/.env" ]]; then
  kl_set="${KIDS_LIBRARY+x}"; kl="${KIDS_LIBRARY-}"
  tm_set="${RUN_PREPARE_TMUX+x}"; tm="${RUN_PREPARE_TMUX-}"
  set -a; . "$ROOT/.env"; set +a
  [[ -n "$kl_set" ]] && KIDS_LIBRARY="$kl"
  [[ -n "$tm_set" ]] && RUN_PREPARE_TMUX="$tm"
fi
[[ -n "$DEST" ]] || DEST="${KIDS_LIBRARY:-}"
[[ -n "$USE_TMUX" ]] || USE_TMUX="${RUN_PREPARE_TMUX:-0}"
[[ "$USE_TMUX" == 0 || "$USE_TMUX" == 1 ]] || { echo "RUN_PREPARE_TMUX must be 0 or 1 (got: $USE_TMUX)" >&2; exit 2; }
if [[ -z "$DEST" ]]; then
  echo "No destination. Use --dest DIR, or set KIDS_LIBRARY in $ROOT/.env (see .env.example)." >&2
  exit 2
fi
if [[ ! -d "$DEST" ]]; then
  echo "Destination does not exist: $DEST" >&2
  echo "(Create it first, e.g. a 'Kids Library' folder.)" >&2
  exit 1
fi

# Pinned Shaka Packager (no-op if already present).
"$HERE/get-packager.sh" >/dev/null || { echo "could not install Shaka Packager" >&2; exit 1; }
# kidsvideo (tools/kidsvideo/, prepares and packs each video): built here when
# Go is installed; the Docker image already has it.
if command -v go >/dev/null; then
  (cd "$HERE/kidsvideo" && go build -trimpath -o "$HERE/bin/kidsvideo" .) || { echo "could not build tools/kidsvideo" >&2; exit 1; }
fi
[[ -x "$HERE/bin/kidsvideo" ]] || { echo "kidsvideo not found: install Go (brew install go) and run this again" >&2; exit 1; }

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

# --tmux: re-run this same job in a detached tmux session, so a long re-encode
# survives closing the terminal. The file list goes to a file next to the log,
# which the session reads as its stdin (a detached session can't read your pipe,
# and a whole season's paths don't fit in a tmux command). Inside the session
# $TMUX is set, so no loop.
if [[ "$USE_TMUX" == 1 && -z "${TMUX:-}" ]]; then
  command -v tmux >/dev/null || { echo "--tmux needs tmux (brew install tmux); or run without --tmux" >&2; exit 1; }
  session="kids-prepare-$(date +%m%d-%H%M%S)"
  mkdir -p "$ROOT/logs"
  log="$ROOT/logs/run_prepare-$session.log"
  list="$ROOT/logs/run_prepare-$session.files"
  printf '%s\n' "${FILES[@]}" > "$list"
  args=("$SELF" --dest "$DEST")
  [[ -n "$TITLE" ]] && args+=(--title "$TITLE")
  [[ -n "$SERIES" ]] && args+=(--series "$SERIES")
  inner="$(printf '%q ' "${args[@]}") < $(printf '%q' "$list") 2>&1 | tee $(printf '%q' "$log"); echo; echo '[finished — press Enter to close this window]'; read -r </dev/tty"
  tmux new-session -d -s "$session" -c "$PWD" "bash -c $(printf '%q' "$inner")" \
    || { echo "could not start the tmux session; run without --tmux" >&2; exit 1; }
  echo "running detached in tmux session: $session  (${#FILES[@]} video(s))"
  echo "  watch it:   tmux attach -t $session     (leave it running again: Ctrl-b then d)"
  echo "  log:        $log"
  exit 0
fi
if [[ "$USE_TMUX" == 0 && -z "${TMUX:-}" && -t 2 ]] && command -v tmux >/dev/null; then
  echo "tip: long jobs (re-encodes) can run detached with --tmux (or RUN_PREPARE_TMUX=1 in .env)" >&2
fi

done_n=0; skip_n=0; fail_n=0; FAILED=()

# Tidy a release-style name into a title: dots/underscores become spaces (only
# when the name has no spaces, so "Mr. Bean" keeps its dot), a leading [group]
# is dropped, and everything from the first quality/source/size tag on is cut.
#   "Frozen.2.2019.1080p.BluRay.1400MB.DD5.1.x264-GalaxyRG" -> "Frozen 2 2019"
clean_name() {
  printf '%s' "$1" | perl -pe '
    s/^\s*[\[(][^\])]*[\])]\s*//;
    if (!/ /) { s/[._]+/ /g } else { s/_+/ /g }
    s/\b(2160p|1080p|720p|576p|480p|4k|uhd|hdr10?|dv|web[- ]?dl|webrip|web|bluray|blu ray|bdrip|brrip|hdtv|dvdrip|remux|amzn|nf|dsnp|hmax|atvp|x26[45]|h ?26[45]|hevc|avc|aac\d?|ac3|eac3|ddp?\d?|dts|truehd|atmos|proper|repack|extended|multi|\d+(?:\.\d+)? ?[mg]b)\b.*$//i;
    s/\s{2,}/ /g; s/^[\s\-]+|[\s\-.\[(]+$//g;'
}

# Episode title: the text after the SxxEyy tag, tidied the same way.
episode_title_from() { # basename-without-extension, matched-episode-tag
  clean_name "${1#*"$2"}"
}

for f in "${FILES[@]}"; do
  base="$(basename "$f")"; stem="${base%.*}"
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
  else
    cleaned="$(clean_name "$stem")"
    title="${cleaned:-$stem}"
  fi

  echo "== $title"
  if [[ -f "$dest/$title.kidsvideo" ]]; then
    echo "   already prepared, skipping"; skip_n=$((skip_n + 1)); continue
  fi
  mkdir -p "$dest"
  if PACKAGER="${PACKAGER:-$HERE/bin/packager}" "$HERE/bin/kidsvideo" prepare --title "$title" --dest "$dest" "$f" 2>&1 | sed 's/^/   /'; then
    if [[ -f "$dest/$title.kidsvideo" ]]; then done_n=$((done_n + 1)); else fail_n=$((fail_n + 1)); FAILED+=("$f"); fi
  else
    fail_n=$((fail_n + 1)); FAILED+=("$f")
  fi
done

echo
echo "prepared: $done_n   skipped (already there): $skip_n   failed: $fail_n   → $DEST"
for f in "${FAILED[@]+"${FAILED[@]}"}"; do echo "   FAILED: $f"; done
[[ $fail_n -eq 0 ]]
