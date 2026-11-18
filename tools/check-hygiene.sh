#!/usr/bin/env bash
# Repo hygiene: stop credentials, personal data and media from being committed.
#
#   tools/check-hygiene.sh --staged          (pre-commit hook: staged changes)
#   tools/check-hygiene.sh --range A...B     (CI: a PR's changes)
#
# Only ADDED lines and added/changed files are checked. A genuine false
# positive can be allowed by putting `hygiene:allow` on that line.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

MODE="${1:-}"; RANGE="${2:-}"
case "$MODE" in
  --staged) DIFF=(git diff --cached); FILES_CMD=(git diff --cached --name-only --diff-filter=ACMR) ;;
  --range)  [[ -n "$RANGE" ]] || { echo "usage: $0 --range A...B" >&2; exit 2; }
            DIFF=(git diff "$RANGE"); FILES_CMD=(git diff --name-only --diff-filter=ACMR "$RANGE") ;;
  *) echo "usage: $0 --staged | --range A...B" >&2; exit 2 ;;
esac

SELF="tools/check-hygiene.sh"
MAX_BYTES=$((2 * 1024 * 1024))
ALLOW_LARGE='^app/vendor/shaka-player-[0-9.]+\.compiled\.js$'
problems=0
report() { echo "  ✗ $1"; problems=$((problems + 1)); }

size_of() { # file -> bytes of the version being committed
  if [[ "$MODE" == --staged ]]; then git cat-file -s ":$1" 2>/dev/null || echo 0
  else git cat-file -s "${RANGE##*...}:$1" 2>/dev/null || wc -c <"$1"; fi
}

# 1. Files that must never be committed.
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  base="$(basename "$f")"
  if [[ "$base" =~ ^\.env($|\.) && "$base" != ".env.example" ]]; then report "$f: environment file (local settings/secrets)"; fi
  if [[ "$f" =~ \.(mp4|m4v|mov|mkv|webm|avi|mpd)$ ]]; then report "$f: video/media file (real media never goes in the repo)"; fi
  if [[ "$f" =~ \.(pem|key|p12|pfx|keystore)$ || "$base" =~ ^id_(rsa|ed25519|ecdsa)$ ]]; then report "$f: key file"; fi
  if [[ ! "$f" =~ $ALLOW_LARGE ]] && (( $(size_of "$f") > MAX_BYTES )); then report "$f: larger than 2 MB"; fi
done < <("${FILES_CMD[@]}")

# 2. Added lines: credentials and personal data.
PATTERNS=(
  'credential:(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY-----)'
  'secret assignment:(password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"']{6,}["'"'"']'
  'home folder path:/(Users|home)/[A-Za-z0-9._-]+/'
  'email address:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
)
IGNORE_LINE='hygiene:allow|noreply@github\.com|users\.noreply\.github\.com|@example\.(com|org|net)|/home/runner/|/Users/runner/'

file=""
while IFS= read -r line; do
  case "$line" in
    "+++ b/"*) file="${line#+++ b/}"; continue ;;
    "+++ "*|"---"*) continue ;;
    "+"*) ;;
    *) continue ;;
  esac
  [[ "$file" == "$SELF" || "$file" == package-lock.json ]] && continue
  added="${line#+}"
  echo "$added" | grep -qiE "$IGNORE_LINE" && continue
  for p in "${PATTERNS[@]}"; do
    label="${p%%:*}"; rx="${p#*:}"
    if echo "$added" | grep -qiE -- "$rx"; then report "$file: $label"; fi
  done
done < <("${DIFF[@]}" --unified=0 --no-color)

if (( problems > 0 )); then
  echo "repo hygiene: $problems problem(s). Remove them, or mark a genuine false positive with 'hygiene:allow' on that line." >&2
  exit 1
fi
echo "repo hygiene: ok"
