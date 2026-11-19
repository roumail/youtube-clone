#!/usr/bin/env bash
# Share the prepared library with the iPad/iPhone over home Wi-Fi (owner's Mac).
#
#   tools/share_library.sh [--setup] [--dry-run]
#
# Copies every .kidsvideo from KIDS_LIBRARY (e.g. the Google Drive folder) into
# a local folder, SHARE_DIR, keeping series sub-folders. Videos removed from
# KIDS_LIBRARY are removed from SHARE_DIR too; nothing else in it is touched.
# Then it checks that SHARE_DIR is shared and prints how to open it on the iPad.
#
# --setup:   once: make SHARE_DIR a shared folder named SHARE_NAME (read-only).
#            Needs your admin password (sudo). File Sharing itself is switched on
#            in System Settings → General → Sharing; the script opens that pane.
# --dry-run: show what would be copied or removed, change nothing.
#
# Settings (environment or the repo's .env, see .env.example):
#   KIDS_LIBRARY  where prepared videos are (same as run_prepare.sh)
#   SHARE_DIR     the local copy that is shared (default: "$HOME/Kids Library Share")
#   SHARE_NAME    the name the iPad sees (default: "Kids Library")
#
# Why a local copy: files in a cloud folder may exist only online, and a shared
# folder can't download them for the iPad. The copy needs the disk space once.
set -uo pipefail

SELF="$0"
while [[ -L "$SELF" ]]; do
  link="$(readlink "$SELF")"
  case "$link" in /*) SELF="$link" ;; *) SELF="$(dirname "$SELF")/$link" ;; esac
done
ROOT="$(cd "$(dirname "$SELF")/.." && pwd)"

usage() { sed -n '2,23p' "$SELF" | sed 's/^# \{0,1\}//'; exit "${1:-2}"; }

SETUP=0; DRY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --setup) SETUP=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage 0 ;;
    *) echo "unknown option: $1" >&2; usage ;;
  esac
done

# Defaults from the repo's .env; variables already set in the environment win.
if [[ -f "$ROOT/.env" ]]; then
  saved="$(declare -p KIDS_LIBRARY SHARE_DIR SHARE_NAME 2>/dev/null || true)"
  set -a; . "$ROOT/.env"; set +a
  eval "$saved"
fi
SRC="${KIDS_LIBRARY:-}"
DST="${SHARE_DIR:-$HOME/Kids Library Share}"
NAME="${SHARE_NAME:-Kids Library}"

[[ -n "$SRC" && -d "$SRC" ]] || { echo "KIDS_LIBRARY isn't a folder: '${SRC}'. Set it in $ROOT/.env (see .env.example)." >&2; exit 2; }
SRC="$(cd "$SRC" && pwd)"
mkdir -p "$DST" && DST="$(cd "$DST" && pwd)"
# The copy removes old videos from SHARE_DIR, so it must be a folder of its own.
case "$DST" in
  "$SRC"|"$SRC"/*|"$HOME"|/|/Users|/Volumes) echo "SHARE_DIR must be its own folder, not '$DST'." >&2; exit 2 ;;
esac
case "$SRC" in "$DST"/*) echo "SHARE_DIR can't contain KIDS_LIBRARY." >&2; exit 2 ;; esac

# 1. Copy: only .kidsvideo files (and the folders holding them). --delete only
#    removes .kidsvideo files that are gone from KIDS_LIBRARY: anything excluded
#    by the filter is never deleted.
echo "== copying .kidsvideo files"
echo "   from: $SRC"
echo "   to:   $DST"
opts=(-rt --delete --prune-empty-dirs --itemize-changes
  --include='*/' --include='*.kidsvideo' --exclude='*')
[[ "$DRY" == 1 ]] && opts+=(--dry-run)
out="$(rsync "${opts[@]}" "$SRC"/ "$DST"/)" || { echo "copy failed" >&2; exit 1; }
added="$(grep -c '^>f' <<<"$out" || true)"
removed="$(grep -c '^\*deleting .*\.kidsvideo$' <<<"$out" || true)"
grep -E '^(>f|\*deleting)' <<<"$out" | sed -E 's/^>f[^ ]* /   + /; s/^\*deleting +/   - /'
total="$(find "$DST" -name '*.kidsvideo' | wc -l | tr -d ' ')"
echo "   copied: $added   removed: $removed   in the shared folder: $total$([[ "$DRY" == 1 ]] && echo '  (dry run)')"

# 2. Share it (once).
shared() { sharing -l 2>/dev/null | awk -F'\t+' '$1 == "path:" { print $2 }' | grep -Fqx "$DST"; }
if [[ "$SETUP" == 1 && "$DRY" == 0 ]]; then
  if shared; then
    echo "== '$DST' is already shared"
  else
    echo "== sharing '$DST' as \"$NAME\" (read-only); asks for your admin password"
    sudo sharing -a "$DST" -n "$NAME" -S "$NAME" -s 001 -g 000 -R 1 || { echo "sharing failed" >&2; exit 1; }
  fi
  if ! nc -z -G 2 127.0.0.1 445 >/dev/null 2>&1; then
    echo "== File Sharing is off: turn it on in the System Settings pane that just opened"
    open "x-apple.systempreferences:com.apple.Sharing-Settings.extension" 2>/dev/null || true
  fi
fi

# 3. Status + how to open it on the iPad.
host="$(scutil --get LocalHostName 2>/dev/null || hostname -s).local"
if ! shared; then
  echo "== not shared yet: run   tools/share_library.sh --setup"
elif ! nc -z -G 2 127.0.0.1 445 >/dev/null 2>&1; then
  echo "== shared, but File Sharing is off: System Settings → General → Sharing → File Sharing"
else
  cat <<MSG
== ready. On the iPad (same Wi-Fi), once:
   Files → ⋯ (top of the sidebar) → Connect to Server → smb://$host
   → Registered User: your Mac user name ($(id -un)) and password.
   Then in the app: Add video → PIN → "$host" (under Shared) → $NAME → pick the files.
MSG
fi
