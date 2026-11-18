#!/usr/bin/env bash
# Cut a release: tag the commit that is live (deployed AND verified) as
# vMAJOR.MINOR.PATCH and create its GitHub Release. Run by the owner, with the
# owner's own GitHub login — no workflow creates tags.
#
#   tools/release.sh minor              # 1.2.3 -> 1.3.0  (new feature)
#   tools/release.sh patch              # 1.2.3 -> 1.2.4  (fixes only)
#   tools/release.sh major              # 1.2.3 -> 2.0.0  (big/incompatible change)
#   tools/release.sh 1.0.0              # explicit version (the first release)
#   tools/release.sh minor --dry-run    # show what would happen
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

ARG="${1:-}"; DRY="${2:-}"
[[ -n "$ARG" ]] || { sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
die() { echo "release: $*" >&2; exit 1; }

# 1. Only from an up-to-date, clean main.
[[ "$(git rev-parse --abbrev-ref HEAD)" == main ]] || die "switch to main first (git checkout main)"
git diff --quiet && git diff --cached --quiet || die "uncommitted changes; commit or stash them"
git fetch -q origin main --tags
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || die "main isn't up to date (git pull)"
SHA="$(git rev-parse HEAD)"

# 2. Next version.
LAST="$(git tag -l 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | head -1)"
if [[ "$ARG" =~ ^v?([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  NEXT="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.${BASH_REMATCH[3]}"
else
  [[ -n "$LAST" ]] || die "no release yet: give the first version explicitly, e.g. tools/release.sh 1.0.0"
  IFS=. read -r MA MI PA <<<"${LAST#v}"
  case "$ARG" in
    major) NEXT="$((MA + 1)).0.0" ;;
    minor) NEXT="$MA.$((MI + 1)).0" ;;
    patch) NEXT="$MA.$MI.$((PA + 1))" ;;
    *) die "expected major, minor, patch or a version like 1.0.0" ;;
  esac
fi
TAG="v$NEXT"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && die "$TAG already exists"
if [[ -n "$LAST" ]]; then
  [[ "$(printf '%s\n%s\n' "${LAST#v}" "$NEXT" | sort -V | tail -1)" == "$NEXT" && "${LAST#v}" != "$NEXT" ]] \
    || die "$TAG isn't newer than $LAST"
  [[ "$(git rev-parse "$LAST^{commit}")" != "$SHA" ]] || die "$LAST already points at this commit; nothing new to release"
fi

# 3. The commit must be live: deployed and verified, and served by the site.
LIVE_URL="$(sed -n 's/^  LIVE_URL: *//p' .github/workflows/deploy.yml | head -1)"
deployed="$(gh run list --workflow deploy.yml --limit 30 --json displayTitle,conclusion \
  --jq "[.[] | select(.displayTitle == \"Deploy $SHA\" and .conclusion == \"success\")] | length")"
[[ "${deployed:-0}" -gt 0 ]] || die "$SHA hasn't been deployed and verified yet (wait for the Deploy run)"
live="$(curl -fsS "${LIVE_URL}version.json?t=$(date +%s)" | sed -n 's/.*"commit":"\([0-9a-f]*\)".*/\1/p')"
[[ "$live" == "$SHA" ]] || die "the live site serves ${live:-nothing}, not $SHA"

# 4. Notes: the PRs merged since the last release.
NOTES="$(mktemp)"; trap 'rm -f "$NOTES"' EXIT
if [[ -n "$LAST" ]]; then
  { echo "Changes since $LAST:"; echo; git log --format='- %s' "$LAST..$SHA"; } >"$NOTES"
else
  { echo "First release: the feature set in DESIGN.md, tested on the iPad."; echo; git log --format='- %s' "$SHA" -n 50; } >"$NOTES"
fi

echo "release $TAG  ->  $SHA  (previous: ${LAST:-none})"
sed 's/^/  /' "$NOTES"
if [[ "$DRY" == --dry-run ]]; then echo "(dry run: nothing created)"; exit 0; fi

gh release create "$TAG" --target "$SHA" --title "$TAG" --notes-file "$NOTES"
echo "released $TAG"
