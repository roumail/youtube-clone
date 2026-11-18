#!/usr/bin/env bash
# Cut a release: tag main's current commit as vMAJOR.MINOR.PATCH and publish
# its GitHub Release. Publishing the release DEPLOYS it (deploy.yml): the site
# always runs the latest release. Run by the owner, with the owner's own GitHub
# login — no workflow creates tags.
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
  git merge-base --is-ancestor "$LAST" "$SHA" || die "this commit doesn't come after $LAST"
fi

# 3. The commit must have passed CI on main (the deploy re-checks this too).
REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
passed="$(gh api "repos/$REPO/commits/$SHA/check-runs?check_name=e2e&filter=all" \
  --jq '[.check_runs[] | select(.conclusion == "success")] | length')"
[[ "${passed:-0}" -gt 0 ]] || die "$SHA hasn't passed CI (e2e) on main yet; wait for it"

# 4. Notes: the PRs merged since the last release.
NOTES="$(mktemp)"; trap 'rm -f "$NOTES"' EXIT
if [[ -n "$LAST" ]]; then
  { echo "Changes since $LAST:"; echo; git log --format='- %s' "$LAST..$SHA"; } >"$NOTES"
else
  echo "First release: the feature set in DESIGN.md, tested on the iPad." >"$NOTES"
fi

echo "release $TAG  ->  $SHA  (previous: ${LAST:-none})"
sed 's/^/  /' "$NOTES"
if [[ "$DRY" == --dry-run ]]; then echo "(dry run: nothing created)"; exit 0; fi

gh release create "$TAG" --target "$SHA" --title "$TAG" --notes-file "$NOTES"
echo "released $TAG — deploying now. Follow it with:"
echo "  gh run list --workflow deploy.yml --limit 1"
echo "The site serves $TAG once the Deploy run succeeds (it rolls back to the previous release if the live check fails)."
