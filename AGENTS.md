# Working on this repo (for any coding agent / LLM)

An offline, PIN-gated kids video library: an installable web app (PWA) for one
family's Mac and iPad. **The behaviour specs in `e2e/features/` are the source of
truth.** `DESIGN.md` keeps only what they can't: the reasons behind decisions,
notes for the owner, scope, behaviour with no scenario yet, and the manual
device checklist. This file only says *how* to work here.

## The owner decides
- The owner sets the order of work and approves every PR merge, unless they
  explicitly hand merging to you for specific PRs.
- **Nothing gets added without asking** (DESIGN.md §3, Scope). If a feature, setting,
  dependency or behaviour isn't in the spec, propose it and wait.
- **Don't deviate from the spec.** If you learn something that contradicts it,
  stop, raise it, update the spec in a PR, then continue.
- Open questions that need the owner are listed in DESIGN.md → "Open decisions".
  Ask; don't guess.

## How changes land
- **Once per clone:** `git config core.hooksPath tools/hooks`. The pre-commit
  hook (`tools/check-hygiene.sh`) blocks credentials, personal data (home
  paths, email addresses), `.env` files, media and files over 2 MB. Never use
  `--no-verify`. CI runs the same check on every PR (`repo-hygiene`).
- `main` is protected: PRs only, **squash merge only**, the `e2e` check must be
  green. Branch from an up-to-date `main`; one concern per PR.
- **CI is the only test runner.** Don't run the Playwright suite locally. Push,
  then read results with `gh run view <id> --log-failed` and the
  `playwright-report` artifact (trace, screenshots, video).
- Merging does **not** deploy. Only a release published by the owner
  (`tools/release.sh`) deploys `app/` to GitHub Pages
  (https://www.rohailtaimour.com/youtube-clone/); the site runs exactly the
  latest release.

## Safety rules (learned the hard way)
- **Stage files by explicit path. Never `git add -A` / `git add .`** — the owner
  keeps real, copyrighted videos in the working tree (`prepared/`, gitignored).
  Real media must never reach this public repo. Check `git status --short` and
  the commit stat before every push.
- The owner may use the same working folder. Don't switch branches with
  uncommitted work in it, and don't delete their files.
- Fixtures are synthetic and generated in CI (`fixtures/generate.sh`); nothing
  large is committed.

## Security
- Don't document security measures in this repo (docs, comments, PR texts).
  The owner keeps private notes.
- Ask the owner before changing GitHub workflows, workflow permissions, the
  deploy steps, page security headers, or `app/vendor/`. Never weaken or skip a
  required check to get a change through.
- Never build HTML from data (`innerHTML`, `eval`, …). Insert text.

## How features are built
- Behaviour specs live in `e2e/features/<area>/*.spec.js`: one file per
  `Feature:`, one `test('Scenario: …')` per scenario, Given/When/Then as
  `test.step` labels. How to write them: DESIGN.md §5.
- Unbuilt scenarios are `test.fixme`. A new feature starts as a feature file of
  `test.fixme` scenarios, reviewed by the owner; building it means switching
  them to `test` and implementing until CI is green.
- Tests wait on app state (`data-state`, `data-import`, …), never on time;
  `waitForTimeout` is banned by lint. The routes, test ids, states and persisted
  keys the specs use are the app ↔ test contract — change the spec before
  changing them.
- Behaviour listed in DESIGN.md §4 has no scenario yet: write one before
  changing it.
- CI runs on Ubuntu in the digest-pinned Playwright image, with a P3 screen
  emulated for every test. A Playwright bump changes `package.json` and the
  image digest together. Real-Mac checks are local (`tools/real-episode-check.mjs`).

## Must-keep technical rules
- Shaka offline: **always pass our own `offline.trackSelectionCallback`**
  (store the single variant). Shaka's default drops SDR video on P3 screens and
  stores 0 tracks without an error. A store with 0 tracks is a failure.
- `<video>`: no `controls`, no `autoplay`, `playsinline`,
  `disablePictureInPicture`, `disableRemotePlayback`. Pause is free; every
  play/resume needs the PIN.
- No frameworks, no build step for the app. The only app dependency is the
  vendored, pinned Shaka Player in `app/vendor/`.

## Releases
- Releases (`vMAJOR.MINOR.PATCH` tags + GitHub Releases) are cut **by the
  owner** with `tools/release.sh`, and publishing one deploys it. Never create, move or delete
  tags yourself. When a PR is user-visible, say in it whether it's a
  major (incompatible, e.g. videos must be re-added), minor (new feature) or
  patch (fixes only) change.

## Useful commands
- Prepare real videos (owner's Mac): `tools/run_prepare.sh [--title "…"] <files or folders>`.
  The destination comes from `KIDS_LIBRARY` in a gitignored `.env` (see
  `.env.example`); never commit the owner's paths. Details: `tools/README.md`.
- Manual real-episode check in the owner's Chrome (not CI): adds and plays a
  prepared episode in the live app: `node tools/real-episode-check.mjs "prepared/<Title>"`.
- Release (owner only): `tools/release.sh minor` (or `major`/`patch`/`1.0.0`, `--dry-run`).
