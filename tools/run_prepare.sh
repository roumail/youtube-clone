#!/usr/bin/env bash
# Prepare one or many videos for the kids library: a launcher for
# "kidsvideo prepare" (tools/kidsvideo/), which does the work (folders, stdin,
# the destination, titles, series, the batch summary). This script builds the
# tool when Go is installed, fetches the pinned Shaka Packager, and with --tmux
# runs the job detached. See tools/README.md for examples.
#
#   tools/run_prepare.sh [--tmux | --no-tmux] [--dest DIR] [--title "T"] [--series "S"] [--dry-run] INPUT...
#   ls *.mp4 | tools/run_prepare.sh          (paths on stdin, one per line)
#
# INPUT: video files and/or folders (folders are searched recursively for
#        .mp4 .m4v .mov .mkv .webm .avi). With no INPUT, paths are read from
#        stdin. Works through a symlink on your PATH (e.g. ~/bin/run_prepare).
# --dest:  where prepared videos go (e.g. your "Kids Library" folder; it must
#          exist). Default: $KIDS_LIBRARY, from the environment or from .env
#          in the repo root (gitignored; copy .env.example).
# --title: title for a single input file. Otherwise the file name is tidied:
#          "Frozen.2.2019.1080p.BluRay.x264-GRP" -> "Frozen 2 2019".
#          With --series it's the episode title.
# --series: these are episodes of NAME. Each file name must contain its season
#          and episode (S01E03 / s1e3 / 1x03). Titles become
#          "NAME - S01E03 - Episode title", filed under DEST/NAME/.
# --dry-run: say, per video, what would be copied or re-encoded; write nothing.
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

usage() { sed -n '2,28p' "$SELF" | sed 's/^# \{0,1\}//'; exit "${1:-2}"; }

# --tmux / --no-tmux are this script's; everything else goes to kidsvideo prepare.
USE_TMUX=""; ARGS=()
for a in "$@"; do
  case "$a" in
    --tmux) USE_TMUX=1 ;;
    --no-tmux) USE_TMUX=0 ;;
    -h|--help) usage 0 ;;
    *) ARGS+=("$a") ;;
  esac
done
[[ ${#ARGS[@]} -gt 0 || ! -t 0 ]] || usage

# RUN_PREPARE_TMUX from the repo's .env (gitignored); the environment wins over
# .env, the command line over both. (kidsvideo reads KIDS_LIBRARY itself.)
if [[ -z "$USE_TMUX" ]]; then
  if [[ -z "${RUN_PREPARE_TMUX+x}" && -f "$ROOT/.env" ]]; then
    RUN_PREPARE_TMUX="$(set -a; . "$ROOT/.env" >/dev/null 2>&1; printf '%s' "${RUN_PREPARE_TMUX:-0}")"
  fi
  USE_TMUX="${RUN_PREPARE_TMUX:-0}"
fi
[[ "$USE_TMUX" == 0 || "$USE_TMUX" == 1 ]] || { echo "RUN_PREPARE_TMUX must be 0 or 1 (got: $USE_TMUX)" >&2; exit 2; }

# Pinned Shaka Packager (no-op if already present).
"$HERE/get-packager.sh" >/dev/null || { echo "could not install Shaka Packager" >&2; exit 1; }
# kidsvideo (tools/kidsvideo/): built here when Go is installed; the Docker
# image already has it.
if command -v go >/dev/null; then
  (cd "$HERE/kidsvideo" && go build -trimpath -o "$HERE/bin/kidsvideo" .) || { echo "could not build tools/kidsvideo" >&2; exit 1; }
fi
[[ -x "$HERE/bin/kidsvideo" ]] || { echo "kidsvideo not found: install Go (brew install go) and run this again" >&2; exit 1; }
export PACKAGER="${PACKAGER:-$HERE/bin/packager}"

# --tmux: run the same job in a detached tmux session, so a long re-encode
# survives closing the terminal. Paths piped in go to a file next to the log,
# which the session reads as its stdin (a detached session can't read your
# pipe, and a whole season's paths don't fit in a tmux command).
if [[ "$USE_TMUX" == 1 && -z "${TMUX:-}" ]]; then
  command -v tmux >/dev/null || { echo "--tmux needs tmux (brew install tmux); or run without --tmux" >&2; exit 1; }
  session="kids-prepare-$(date +%m%d-%H%M%S)"
  mkdir -p "$ROOT/logs"
  log="$ROOT/logs/run_prepare-$session.log"
  list=/dev/null; given=""
  for a in "${ARGS[@]+"${ARGS[@]}"}"; do [[ -e "$a" ]] && given=1; done
  if [[ -z "$given" && ! -t 0 ]]; then
    list="$ROOT/logs/run_prepare-$session.files"
    cat > "$list"
  fi
  # A tmux session gets the tmux server's environment, not this shell's: pass
  # on (or clear) what kidsvideo reads, so the job goes where this shell says.
  unset_vars=(); set_vars=(PACKAGER="$PACKAGER")
  for v in KIDS_LIBRARY FFMPEG FFPROBE; do
    if [[ -n "${!v+x}" ]]; then set_vars+=("$v=${!v}"); else unset_vars+=(-u "$v"); fi
  done
  cmd=(env "${unset_vars[@]+"${unset_vars[@]}"}" "${set_vars[@]}" "$HERE/bin/kidsvideo" prepare "${ARGS[@]+"${ARGS[@]}"}")
  inner="$(printf '%q ' "${cmd[@]}") < $(printf '%q' "$list") 2>&1 | tee $(printf '%q' "$log"); echo; echo '[finished — press Enter to close this window]'; read -r </dev/tty"
  tmux new-session -d -s "$session" -c "$PWD" "bash -c $(printf '%q' "$inner")" \
    || { echo "could not start the tmux session; run without --tmux" >&2; exit 1; }
  echo "running detached in tmux session: $session"
  echo "  watch it:   tmux attach -t $session     (leave it running again: Ctrl-b then d)"
  echo "  log:        $log"
  exit 0
fi
if [[ "$USE_TMUX" == 0 && -z "${TMUX:-}" && -t 2 ]] && command -v tmux >/dev/null; then
  echo "tip: long jobs (re-encodes) can run detached with --tmux (or RUN_PREPARE_TMUX=1 in .env)" >&2
fi

exec "$HERE/bin/kidsvideo" prepare "${ARGS[@]+"${ARGS[@]}"}"
