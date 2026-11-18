# Working on this repo (for any coding agent / LLM)

An offline, PIN-gated kids video library: an installable web app (PWA) for one
family's Mac and iPad. **Read `DESIGN.md` first — it is the spec and the source
of truth.** This file only says *how* to work here.

## The owner decides
- The owner sets the order of work and approves every PR merge, unless they
  explicitly hand merging to you for specific PRs.
- **Nothing gets added without asking** (DESIGN.md §6). If a feature, setting,
  dependency or behaviour isn't in the spec, propose it and wait.
- **Don't deviate from the spec.** If you learn something that contradicts it,
  stop, raise it, update `DESIGN.md` in a PR, then continue.
- Open questions that need the owner are listed in DESIGN.md → "Open decisions".
  Ask; don't guess.

## How changes land
- `main` is protected: PRs only, **squash merge only**, the `e2e` check must be
  green. Branch from an up-to-date `main`; one concern per PR.
- **CI is the only test runner.** Don't run the Playwright suite locally. Push,
  then read results with `gh run view <id> --log-failed` and the
  `playwright-report` artifact (trace, screenshots, video).
- Merging deploys: after CI passes on `main`, `deploy.yml` publishes `app/` to
  GitHub Pages (https://www.rohailtaimour.com/youtube-clone/).

## Safety rules (learned the hard way)
- **Stage files by explicit path. Never `git add -A` / `git add .`** — the owner
  keeps real, copyrighted videos in the working tree (`prepared/`, gitignored).
  Real media must never reach this public repo. Check `git status --short` and
  the commit stat before every push.
- The owner may use the same working folder. Don't switch branches with
  uncommitted work in it, and don't delete their files.
- Fixtures are synthetic and generated in CI (`fixtures/generate.sh`); nothing
  large is committed.

## How features are built
- Behaviour specs live in `e2e/features/<area>/*.spec.js`: one file per
  `Feature:`, one `test('Scenario: …')` per scenario, Given/When/Then as
  `test.step` labels (DESIGN.md §7).
- Unbuilt scenarios are `test.fixme`. To build a milestone, take its feature
  files from the **milestone ↔ feature map** in DESIGN.md, switch those
  scenarios from `test.fixme` to `test`, and implement until CI is green.
- Tests wait on app state (`data-state`, `data-import`, …), never on time;
  `waitForTimeout` is banned by lint. The app ↔ test contract (routes, test ids,
  states, persisted keys) is in DESIGN.md §7 — change the spec before changing it.
- CI mirrors the owner's Mac: macOS runner, headed Chrome (pinned via
  Playwright), P3 screen emulated for every test.

## Must-keep technical rules (details in DESIGN.md)
- Shaka offline: **always pass our own `offline.trackSelectionCallback`**
  (store the single variant). Shaka's default drops SDR video on P3 screens and
  stores 0 tracks without an error. A store with 0 tracks is a failure.
- `<video>`: no `controls`, no `autoplay`, `playsinline`,
  `disablePictureInPicture`, `disableRemotePlayback`. Pause is free; every
  play/resume needs the PIN.
- No frameworks, no build step for the app. The only app dependency is the
  vendored, pinned Shaka Player in `app/vendor/`.

## Useful commands
- Prepare real videos (owner's Mac): `tools/run_prepare.sh [--title "…"] <files or folders>`.
  The destination comes from `KIDS_LIBRARY` in a gitignored `.env` (see
  `.env.example`); never commit the owner's paths. Details: `tools/README.md`.
- Manual real-episode check in local Chrome (not CI):
  `node tools/real-episode-check.mjs "prepared/<Title>"`.
