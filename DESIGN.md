# design document youtube clone

## Working agreement (read first)

**Order of work: the owner sets it.**
- **Done:** T0 (specs drafted, GitHub + CI, CI failing, then the smoke test passing), the GitHub Pages deploy, and CI on Ubuntu in the digest-pinned Playwright image (it ran on macOS for a while; the owner moved it back on 2026-11-18, see section 7).
- **M0 (Shaka offline spike): core question answered yes.** See "M0 results" under Milestones for exactly what is and isn't verified.
- **Built and released as v1.0.0:** M2 (library + import), M3 (player + PIN gate), M4 (first-run PIN, lockout, settings, offline, installable), series groundwork, release gates. **M5: the owner's iPad UI test passed (2026-11-18).** Changes from here on are released as versions (section 7, "Releases").
- **Before that:** the product features went milestone by milestone, using the **milestone ↔ feature map** under Milestones. The owner picks the order. Open questions for the owner are under **Open decisions**.
- **How to work in this repo** (PRs, CI-only testing, safety rules) is in `AGENTS.md`. `CLAUDE.md` points to it.

**Rules while working:**
- Ask for design clarifications along the way whenever they're needed.
- **Don't deviate from this spec.** If something learned during the work contradicts it, stop and raise it so the spec gets updated first. Then continue.
- Tests are never run locally by the LLM. CI is the source of truth (see section 7).


Specs: (spend more time on the ones on top - 60% top two bullets and 40% divided b/w remaining tasks)
* Biggest constraint we need to consider - Ideally installable on mac and ipad. Each device points to it's own storage
* stack needs to be chosen based on maximum reuse of existing functionality. Python might be easy with more projects but we have to also consider dependencies since mac and ipad are already big constraints.
* Fixed library that is available for rendering
* Rather easy to add new media to the library
* Full control over UI: Parental controls for playing (pausing doesn't need a code but playing needs a code again) - no autoplay
* feature minimal - nothing gets added without asking first

---

# Plan

**Typical media:** 5–20 minute episodes, not films. Sizes are in the low hundreds of MB.

Effort split mirrors the specs: sections 1–2 (platform + stack) are the bulk of the thinking; sections 3–6 are deliberately short.

## 1. Platform & installation: Mac, iPad and iPhone, storage on each device (~30%)

### Decision: an installable web app (PWA), not a native app
A native iPad app runs into Apple's signing paywall. A free Apple ID install stops launching after 7 days; a lasting install needs the $99/yr developer program. A browser is already on every device, so we use that instead:

- **No App Store, no Xcode, no developer account, no expiry.**
- **Mac:** Chrome → ⋮ → Cast, save and share → **Install page as app** (Chrome's own engine). Safari → Add to Dock works too.
- **iPad:** Chrome (iPadOS 16.4+) or Safari → Share → **Add to Home Screen**. It gets its own icon, opens full-screen, and keeps **its own storage**.
  - **Important:** on iPad, Chrome runs on the same WebKit engine as Safari. Apple requires this for every browser outside the EU. So the browser you pick on iPad doesn't change storage or playback behaviour, and the iPad limits below apply in either one.
- **iPhone (supported since owner decision 2026-11-19):** installed the same way as on the iPad, with its own storage. Everything said about the iPad below applies to it too. What's different is the small screen, in portrait and landscape:
  - **The on-screen keyboard covers about half the screen** (less of it in portrait, most of it in landscape). Safari doesn't shrink full-screen layers for it, so a centred PIN prompt ended up behind the keyboard and the page had to be scrolled to type the PIN (seen on v2.1.0). Rule: **the PIN prompt follows the part of the screen the keyboard leaves visible** (`window.visualViewport`), so its field, message and buttons are always above the keyboard and the page never scrolls. On short screens (phone landscape) the prompt is compact, with the title, field and buttons on one row.
  - Screens fit the phone's width, with no sideways scrolling.
- **Works offline:** a service worker caches the app's code, so the URL only has to be reachable to install and update.

### Hosting
- Install requires HTTPS, so the static files (HTML/JS/CSS only; **never videos**) live on **GitHub Pages** at **https://www.rohailtaimour.com/youtube-clone/** (this project site inherits the owner's custom domain; HTTPS is enforced). This is the address the devices install from. No server code and no database.
- On the Mac, it can also run from `localhost` while developing.

### Storage per device: decision = Shaka Player offline storage
Research summary, sources at the bottom of this doc:

| Question | Status | Evidence |
|---|---|---|
| Is there enough space? | **Solved** | Since WebKit 17 (iPadOS 17 / macOS 14), a browser app gets up to **60% of disk per origin**. Installed web apps get the same quota. Chrome on Mac has similarly large quotas. |
| Will the iPad delete it after 7 days unused? | **Solved** | Home-screen web apps are exempt from the 7-day cap on script-writable storage. Eviction only happens under disk pressure, least-recently-used first, and persistent origins are excluded. **Kept simple (one user):** the app calls `navigator.storage.persist()` once at startup, with no UI and no test. The installed iPad app was granted it in M0. |
| Can the iPad play one big stored file? | **Avoid** | Turning a large stored file into a playable link (`URL.createObjectURL`) has a history of problems on iOS:<br>• memory blow-up (iOS 15);<br>• broken playback (iOS 17.4.1);<br>• crashes with 100–500 MB files in a Workbox issue that was never resolved. |
| How do we store and play big videos offline? | **Solved: use Shaka Player offline** | Google's open-source player (Apache-2.0) with built-in offline storage:<br>• stores each video as **many small segments** (a few seconds each) in IndexedDB;<br>• plays them back through Media Source Extensions (`ManagedMediaSource` on iPadOS 17+);<br>• no single huge file is ever handed to the video element, so the big-file bugs above don't apply. |

**Shaka gotcha found in M0 (must keep):** Shaka's default offline track picker uses `hdrLevel: 'AUTO'`.
- On P3 screens (MacBooks, iPads) that means "prefer PQ", so it **drops every SDR variant**.
- Real episodes declare BT.709, which Shaka reads as SDR. The default picker therefore stored **0 tracks without any error** ("0 MB in 0.0 s"), and playback failed with 4036.
- **Rule:** the app always passes its own `offline.trackSelectionCallback` that stores the single variant `prepare.sh` produces.
- **Rule:** a store that keeps 0 tracks is treated as a failure.
- Fixtures carry BT.709 colour info, and a CI test emulates a P3 screen, so this can't silently come back.

**Why Shaka:** it's the tried-and-tested option. Offline storage is a first-class, documented feature with `store()`, `list()`, `remove()`, progress callbacks and app metadata, and it's used in production. We hand-roll nothing on the storage side.

**The cost: videos are prepared on the Mac once.** Shaka stores DASH/HLS content (a manifest plus segmented media), not plain `.mp4` files. Each video is packaged once on the Mac (section 4), and the packaged output is shared through **Google Drive**, so the iPad never does any processing. At home-library scale this is a one-off step per video, not a burden.

**Fallback (only if Shaka on iPad fails M0):** keep the videos as plain files in OPFS and have the service worker feed them to the player a few MB at a time as `206` range responses (the Workbox range-requests pattern, read from OPFS). It's more hand-written code and less proven on iPad, which is why it's no longer the main plan.

### Prior art: what we reuse vs. skip
| Project | What it does | Use? |
|---|---|---|
| **Shaka Player** | Production offline video storage + playback | **Yes: core dependency** |
| **Shaka Packager** | Google's packager that produces exactly what Shaka Player expects | **Yes: Mac-side tool** |
| Local-Video-Player, OtterPlayer, dalyIsaac/video-player, pwa-player | PWA players for local files | No: they play a file you pick each time, with no persistent library |
| Ke3516/offline-media-player | Offline media-library PWA | No: its iPad path is a Capacitor native build (paywall) |
| ffamilyfriendly/Video-Storage | Chunked large-video storage in IndexedDB for iOS | No: archived in 2023. It does confirm the "small chunks" idea that Shaka uses |
| Chronos (research issue #28) | Design notes for large offline video in a PWA | No: reference only, not tested on a device |

### Remaining caveat
Deleting the home-screen icon (or clearing that app's data) deletes its library. Re-importing from Google Drive is the recovery, and the packaged files there act as the backup.

### Options considered
| Option | Cost / friction | Verdict |
|---|---|---|
| **PWA (Install / Add to Home Screen)** | Free, no expiry, one codebase, Chrome or Safari | **Chosen** |
| Native SwiftUI app + free Apple ID | Re-install from the Mac every 7 days | Rejected |
| Native SwiftUI app + paid account | $99/yr | Rejected (paywall) |
| Capacitor / Cordova wrapper | Still a native iOS build that needs signing | Rejected (same paywall) |
| AltStore/SideStore (auto re-sign) | Free, but needs a helper running on the Mac, 3-app limit, and breaks often | Rejected: fragile |
| Python (Kivy/BeeWare) | Same signing problem as native, plus an interpreter | Rejected |

## 2. Stack: maximum reuse, minimum dependencies (~30%)

**Plain HTML + CSS + vanilla JavaScript (ES modules), plus one vendored library: Shaka Player.** The app has no framework, no build step and no npm dependencies. npm is only used for the CI test tooling (Playwright, ESLint). Shaka's pre-compiled build is copied into `app/vendor/` at a pinned version (5.3.5).

| Need | Reused from |
|---|---|
| Offline video storage (segments in IndexedDB) | **Shaka** `shaka.offline.Storage`: `store()`, `list()`, `remove()`, `appMetadata` |
| Offline playback | **Shaka** `shaka.Player` attached to our own `<video>` (no `controls`, no Shaka UI), using `player.load(offlineUri)` |
| Reading packaged files picked from Google Drive / Files | **Shaka** `NetworkingEngine.registerScheme`: a small custom `local:` scheme that returns bytes from the picked `File` objects (`file.slice` for byte ranges). This is the documented plugin route for non-HTTP sources. |
| Picking files | `<input type="file" multiple>`: on iPad it opens the Files picker, where Google Drive appears as a location; on the Mac it opens Finder |
| Small data (PIN hash) | `localStorage` / IndexedDB |
| PIN hashing | Web Crypto `crypto.subtle.digest('SHA-256')` |
| Blocking lock-screen / headphone / media-key "play" | Media Session API action handlers |
| Offline + installability | Service worker + `manifest.webmanifest` |

**Mac-side tools (preparing videos only; nothing extra on the iPad):**
- **Shaka Packager:** a single static binary, **pinned to v3.9.3**, downloaded from its GitHub releases (`packager-osx-arm64` on the Mac, `packager-linux-x64` in CI) and checked against a SHA-256. It repackages H.264/AAC `.mp4` into DASH **without re-encoding**, so it's fast. **No Python or venv anywhere.**
- **ffmpeg 9.0.2**: Homebrew on the Mac (already installed). In CI, the static build from `mwader/static-ffmpeg:9.0.2-1-amd64`, pinned by image digest and copied out of the image. No `apt`, which hung CI once:
  - re-encodes inputs that aren't already H.264/AAC;
  - grabs a poster frame for the thumbnail.

**Toolchain:** a text editor, a browser, a git push to the static host, and the two Mac tools above.

Code layout (small on purpose). ✅ = exists today, ◻ = to build:
```
app/                                  published to GitHub Pages
  index.html, styles.css            ✅ shell with the 4 screens and the data-state contract
  app.js                            ✅ routing + render(state); behaviour to build
  local-scheme.js                   ✅ Shaka "local:" scheme for picked files (from M0, kept)
  vendor/shaka-player-5.3.5.compiled.js   ✅ pinned
  manifest.webmanifest, sw.js, icons/    ✅ M4: installable + offline (sw: network-first, see M0 lesson 3)
  library.js, pin.js                ✅ M2/M4: Shaka storage (own track picker, 0-track cleanup); PIN hash, set/change, 5-strike 60 s lockout
  player.js                         ✅ M3: Shaka player on our <video>; PIN-gated play, free pause, safety net
tools/
  get-packager.sh, prepare.sh, pack.sh   ✅ Mac: video → one .kidsvideo file for Google Drive
  run_prepare.sh, README.md         ✅ Mac wrapper: single file or batch → KIDS_LIBRARY (.env)
  real-episode-check.mjs            ✅ manual check with a real episode in local Chrome
fixtures/generate.sh                ✅ synthetic fixtures (CI)
e2e/                                ✅ specs (section 7)
```

## 3. Fixed library for rendering (~10%)
- The library is `storage.list()` from Shaka, shown as a thumbnail grid.
- Title and poster thumbnail come from `appMetadata`, which is saved at import time. The title is the manifest's file name without `.mpd`: the iPad picker gives the app file names only, not the folder name.
- **Series (groundwork, owner decision 2026-11-18):**
  - A video belongs to a series when its title follows **`Series - S01E03 - Episode title`**. The title is the `.mpd` file name, because the iPad picker only gives the app file names.
  - `run_prepare.sh --series "Name"` produces these titles and files them under `Kids Library/Name/` in Drive.
  - The app reads series, season and episode **from the title when listing** (`parseTitle` in `library.js`). No extra stored data is needed, so nothing has to be re-imported later.
  - **Now:** the library lists a series' episodes together, in season/episode order (E10 after E02); everything else is alphabetical, with a series sorting by its name.
  - **Series screen (drafted 2026-11-19, M7, not built):**
    - the library shows **one tile per series** (series name, "N episodes", poster of its first episode) next to standalone videos;
    - tapping it opens `#/series/<name>`, listing the episodes in season/episode order;
    - an episode opens paused (play still needs the PIN), and **back returns to the series list**;
    - **never** autoplay the next episode.

    Scenarios: `e2e/features/library/series.spec.js`.
- Library grid only: no search, categories, or recommendations.
- The app never fetches video content from the internet.

## 4. Adding media (~10%)
**Step 1, on the Mac, once per video** (usage and examples: `tools/README.md`):
- `tools/run_prepare.sh` is the everyday command. It's a wrapper around `prepare.sh` for the owner's Mac:
  - takes single files or whole folders (batch mode);
  - `--title` sets a clean title for a single file;
  - `--series "Name"` names episodes `Name - S01E03 - Episode title` (season and episode read from `S01E03`/`s1e3`/`1x03` in the file name) and files them under `Name/`;
  - reads paths from stdin too (`ls *.mp4 | run_prepare`), and works through a symlink on the PATH;
  - skips videos already prepared and keeps going if one fails, printing a summary;
  - writes to `--dest`, or by default to `KIDS_LIBRARY` from a **gitignored `.env`** (so the owner's local path is never public; `.env.example` is committed).
- `tools/prepare.sh "My Video.mp4" <dest>` prepares one video. **The output is one file per video, `My Video.kidsvideo`** (owner decision 2026-11-19: "the unit is the container"; since v2.0.0 it's the **only** format, and loose folders aren't accepted). It's a plain, uncompressed `tar` of the 4 parts below, made with the system `tar` by `tools/pack.sh`. What's inside:
  ```
  Google Drive/Kids Library/My Video/
    My Video.mpd      // DASH manifest; its file name is the title
    video.mp4         // fragmented video track (single file, byte-range segments)
    audio.mp4         // fragmented audio track
    poster.jpg        // thumbnail
  ```
- The script:
  - uses the **first English audio track** when there are several (language tag `en`/`eng`/`english`), otherwise the first audio track;
  - runs ffmpeg first only if the input isn't already H.264/AAC (and always to grab the poster);
  - then runs Shaka Packager in **on-demand profile**, which writes one file per track plus the manifest, so there are no thousands of tiny files.
- Videos already prepared (a `<Title>.kidsvideo` exists) are skipped. Nothing is processed twice.

**Step 2, on any device:**
- **"Add video"** button, behind the PIN. A short note on the library screen says what to pick: the video's `.kidsvideo` file. After the correct PIN, the file picker opens straight away, within the same tap on "OK".
  - **iPad risk to check (Appendix A, item 2):** Safari may refuse to open the picker after the asynchronous PIN check. If it does, the fallback is a second "Choose files" tap. That would change the add-video scenario, so it goes back to the owner first.
- Pick **the video's `.kidsvideo` file** (one tap). Anything else (e.g. loose parts) is refused, with a message saying to pick the `.kidsvideo`.
- **No duplicates** (owner decision 2026-11-19): a video whose title is already in the library (case-insensitive) is refused before anything is stored: "<title>" is already in the library. To replace one, remove it in Settings first.
- **Several at once (drafted 2026-11-19, M7, not built):**
  - pick several `.kidsvideo` files together (e.g. a whole season); they're imported **one after another**, and progress says "Adding 2 of 5: <title>";
  - a bad file doesn't stop the rest, and the summary names what failed;
  - anything that isn't a `.kidsvideo` is refused by name, and the rest are still added.

  Scenarios: `e2e/features/library/add-several.spec.js`.
  - The app reads the container's tar headers and hands each part to Shaka as a **lazy slice** of the picked file, so nothing is copied or unpacked. The 4 parts are checked as before.
- The app:
  - registers the picked files under the `local:` scheme;
  - calls `storage.store('local://My Video.mpd', {title, poster})`, where the title is taken from the `.mpd` file name;
  - shows Shaka's progress callback as a progress bar (confirmed working by the owner in M0);
  - **uses its own single-variant track picker** (section 1);
  - if the stored entry has **0 tracks** (the device can't play it), it reports an import error and **removes the empty entry**, so no "0 MB" item is ever listed.
- Once stored, the picked files and the Drive copy aren't needed by the app any more; it plays fully offline.

**Also:**
- **"Remove video,"** behind the PIN: `storage.remove(offlineUri)`.
- iPad note: when you pick from Google Drive, the iPad downloads the files to a temporary location first. So it briefly needs about 2× the video's size free.

## 5. Parental controls & playback rules (~10%)
- **Custom controls only.** Shaka is used without its UI layer. The `<video>` element has no `controls` attribute and is never put into native fullscreen (`playsinline`, and no `webkitEnterFullscreen`), because the native controls would bypass the PIN. The app's own full-screen layout is done in CSS: the player covers the whole screen (letterboxed with `object-fit: contain`, in landscape and portrait), with Back / Play / Pause floating over it, clear of the safe areas. A scenario checks the video area equals the viewport at iPad landscape and portrait sizes. Fixed in v2.0.0; before that the video was capped at 70% of the height.
- Opening a video shows it **paused** on the first frame.
- **Pause:** free, no code.
- **Play / resume:** always asks for the PIN, every time.
- **No autoplay:** no `autoplay` attribute, and the `ended` event never loads another video.
- Close the loopholes:
  - The Media Session `play` handler shows the PIN prompt instead of resuming, so headphones, lock screen, Control Center, and Mac media keys can't resume playback.
  - `disablePictureInPicture` and `disableRemotePlayback` (no AirPlay).
  - `visibilitychange` → pause. Coming back requires the PIN again.
  - Any `play` event not started by the PIN flow is immediately paused (a safety net).
- **PIN:**
  - Set on first run; only a SHA-256 hash is stored.
  - 5 wrong attempts trigger a 60-second lockout.
  - Changing the PIN requires the current one.
  - Forgotten PIN: delete and re-add the home-screen app (this also clears the library).
  - **Checking the PIN is synchronous** (a built-in SHA-256, `verifyPinSync`). Safari on the iPad only opens a file picker, or starts unmuted playback, *during* the user's tap. Any `await` between tapping "OK" and the picker or `play()` makes it refuse silently. That was the v1.0.0–v1.0.2 iPad bug: after the PIN, Add video opened nothing. A scenario tagged `@ipad` slows the browser's async hashing to 6 s and checks the picker still opens at once. It runs on Chrome and on a Safari-engine (WebKit, iPad profile) project.
  - **The PIN itself is never kept**, not even in memory beyond the submit handler. Only its hash is stored (`localStorage['pin.sha256']`), and a scenario checks the PIN appears nowhere else.
  - **Honest limit:** the stored SHA-256 of a 4–6 digit PIN can be brute-forced quickly by someone who can read the device's browser storage. The PIN keeps a child from starting playback (section 6); it isn't meant to resist a determined adult with device access. A test checks that the PIN itself is never stored or left behind (storage, cookies, URL, input field).
  - Same code on both devices for now; revisit later.
- **Seek (owner request 2026-11-19, M8):**
  - a **scrub bar** along the bottom of the player (drag on iPad, click/drag on Mac), with **elapsed / total** time;
  - **← / →** jump 10 s back or forward (keyboard, e.g. on the Mac). No skip buttons and no scroll-wheel seeking.
  - **The child may seek freely, no PIN:** seeking **never starts playback**. Seeking while paused stays paused, and seeking while playing plays on from the new point.

  Scenarios: `e2e/features/playback/seek.spec.js`.
- Tip, no code involved: turn on iPad **Guided Access** to keep a child inside the app.

### Optional parental features (feature flags) — built in M6 (2026-11-19)
**Mechanism** (owner: "modular, toggled on for a behaviour, behind the PIN"):
- Each optional feature is **its own module**, `app/features/<id>.js`, exporting `{ id, title, init(ctx) }`.
  - `ctx` gives it what it needs: player events (play, pause, ended, tick), the PIN prompt, and a place to render.
- The flags live in `localStorage['features']` (e.g. `{ "watchTimeLimit": true }`). **They are switched in Settings, so changing one needs the PIN.**
- **A feature that's off is never loaded**, so there's no hidden behaviour. The core rules (PIN to play, free pause, no autoplay) are always on and aren't features.
- Every feature defaults to **off**.

**First feature: watch-time limit (`watchTimeLimit`)** — scenarios in `e2e/features/parental-controls/watch-time-limit.spec.js`:
- **Session:** a session starts when the parent sets a **budget** at the first play, right after the PIN (e.g. 20 / 30 / 45 min).
  - One budget covers **all videos**.
  - It is stored locally (`localStorage['watchTime.session']`: `{ budget, used }` in seconds), so **a refresh or relaunch keeps it**.
- **Counting:** only **actual playing time** counts: not paused time, the library, or the app in the background. It's measured with the browser's monotonic clock, so changing the device time doesn't affect it.
- **Display:** the player shows **time watched**, **time left** and the **current time** (clock).
- **When the budget runs out:**
  - playback pauses, and the player shows **"Time is up"** (`data-state="time-up"`);
  - playing again needs the PIN, which offers more time.
- **Ending a session:** the parent can end it in Settings (PIN); the next play then asks for a new budget.
- **Honest limit:** it's enforced in the browser, like the PIN. It stops a child, but an adult who clears the browser data resets it.

## 6. Feature-minimal guardrail (~10%)
**Users are the parents (mum and dad) plus a child watching.**
- The **PIN prompt is the only access control.**
- There's no login, accounts, roles or other authentication or authorization, and none is planned.
- The PIN keeps a child from starting playback. It is not meant to stop a determined adult.

Explicitly **out of scope unless asked for**:
- search, playlists, recommendations, history
- playback speed, subtitles, volume UI (hardware buttons only)
- ~~seek bar~~: **added on request (2026-11-19)**, see section 5 "Seek"
- accounts, sync, cloud, multiple profiles
- PiP, AirPlay, downloading from the internet, comments, likes

Any new feature gets proposed first and added only after it's approved.

## 7. Testing strategy

### Ground rules (from the owner)
- **Fixtures and a test harness come before any feature code.** The app is built against fixtures, never against real videos.
- **CI is the source of truth.** The LLM never runs tests locally. It pushes a branch, CI runs, and the LLM reads the results (`gh run view --log-failed` plus the downloaded artifacts) and iterates.
- **Behaviour is pinned to Chrome.** Automated tests run in one exact Chrome build:
  - **Ubuntu**, inside the official Playwright Docker image, **pinned by digest**, so the OS, system libraries and browser can't drift;
  - with a **P3 screen emulated for every test**, as on the family's devices. This is what catches the Shaka/P3 class of bug, and it works the same on any OS.

  **Owner decision (2026-11-18):** CI ran on macOS runners for a while, to mirror the owner's Mac. It was moved back to Ubuntu because the macOS queue slowed every PR and couldn't be pinned, while the real target, the iPad, can't be reproduced in CI anyway.
  - **Real-Mac checks are local:** `tools/real-episode-check.mjs` drives the Mac's installed Chrome, in a visible window, with a real episode. Run it when preparing new content.
  - **The iPad and iPhone** are covered by the manual checklist (Appendix A). Phone-sized layout is also checked in CI with WebKit iPhone profiles; the on-screen keyboard is modelled there (see the browser profile below), so the real keyboard is a manual check (the iPhone Simulator in Xcode, or the phone).

### Layers
| Layer | Tool | What it covers |
|---|---|---|
| End-to-end (user actions) | **Playwright**, Chromium project only | The real app in a real browser: import, library grid, PIN gate, pause/play rules, no autoplay, offline. |
| iPad | Manual checklist (Appendix A) | Install, Drive picking, offline, lock-screen/headphone behaviour, persistence. |
| iPhone | Playwright WebKit iPhone profiles (`@iphone`), plus Appendix A | Layout on a phone screen with the on-screen keyboard, in portrait and landscape. |

**End-to-end only. No committed unit tests.**
- The owner's acceptance test is CI passing, then user testing.
- The Mac prepare script gets no test of its own. CI **builds the e2e fixtures by running `tools/prepare.sh`**, so every e2e run exercises it through real use.

### Pinning Chrome
- Pin Playwright to an exact version in `package-lock.json`. That pins the exact browser build Playwright downloads (Chrome for Testing in recent versions), so every CI run uses the same Chrome.
- In CI the browser comes preinstalled in the Playwright image, whose tag must match `@playwright/test`. Browser upgrades only happen through a deliberate bump PR that changes **both** `package.json` and the image digest.
- **Codec canary test (runs first):** it asserts that `MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"')` and the AAC equivalent are `true`. Open-source Chromium builds lack H.264/AAC, so if a bump ever switches to one, this fails loudly instead of every playback test failing in confusing ways.

### Fixtures (generated, deterministic, nothing big committed)
- Generated in CI with the **pinned static ffmpeg 9.0.2** + the **pinned Shaka Packager binary** from synthetic sources (`testsrc` video, which has a built-in frame counter, plus a `sine` tone). There's no copyrighted or real content.
- Cached by a hash of the fixture script plus the tool versions.

| Fixture | Purpose |
|---|---|
| `tiny` (3 s, H.264/AAC, packaged) | Most e2e tests. Short enough to reach the end quickly for the "no autoplay" test. |
| `medium` (60 s, packaged) | Pause/resume mid-video, background-pause tests. |
| `raw-h264.mp4`, `raw-vp9.webm` (unpackaged) | Raw inputs. `prepare.sh` packages them in CI, which covers its repackage and re-encode paths. |
| `broken-missing-audio.kidsvideo` | Import error handling (a part is missing from the container). |
| `episode-like` (10 s, 1080p H.264 High, BT.709, audio: Chinese first + English second) | Mirrors a real web-download episode: the P3/SDR track-picker case, and `prepare.sh` choosing English. |
| `unplayable` (`tiny` with a codec no browser supports) | Import of a video the device can't play: must be an error, with no empty entry left behind. |
| `Show - S01E01 - First`, `… S01E02 - Second`, `… S01E10 - Tenth` | Series episodes (copies of `tiny`), for the library order of a series. |
| `<name>.kidsvideo` for every packaged fixture | What the picker is given. The generator also unpacks each into a `<name>/` folder **for tests only**: library seeding loads the parts over HTTP, and one scenario checks that loose parts are refused. |

### Avoiding races in user-action tests
The principle: **tests wait on observable state, never on time.**
1. **Playwright auto-waiting + web-first assertions only.** Use `await expect(locator).toBeVisible()` / `toHaveAttribute(...)`, which retry until true or time out. **`waitForTimeout` / sleeps are banned** by a lint rule (`eslint-plugin-playwright`'s `no-wait-for-timeout`) that runs in CI.
2. **The app publishes its state in the DOM.** The player root carries `data-state="loading|paused|pin-required|playing|ended|error"`, and import carries `data-import="idle|storing|done|error"`. Tests assert on these attributes, so each step waits until the app has actually reached that state. This doubles as a clear, explicit state machine in the app.
3. **Media playback is asserted by its effects, not by timing.** "Playing" means `data-state=playing` **and** `video.currentTime` has advanced (`expect.poll(() => currentTime).toBeGreaterThan(t0)`). "Paused" means `video.paused === true` and `currentTime` stays stable across two polls.
4. **Fake clock for timers.** Playwright's `page.clock` controls the 60 s PIN lockout and any debounce. The test fast-forwards time instead of waiting 60 seconds.
5. **Isolation.** Every test gets a fresh browser context, so IndexedDB, the service worker and storage start clean. There's no shared state between tests, so tests can run in parallel safely.
6. **Arrange via API, act and assert via UI.** Tests that need a pre-filled library seed it through the `seedLibrary` fixture, which calls Shaka `storage.store()` in `page.evaluate` with the **same single-variant track picker as the app**, and fails loudly if 0 bytes were stored. Only the import tests themselves go through the file picker (`setInputFiles`).
7. **Simulated environment events:**
   - offline: `context.setOffline(true)`;
   - app backgrounded: override `document.visibilityState` and dispatch `visibilitychange`;
   - lock-screen/headphone "play": call the Media Session handler the app registered, captured by an init script (real OS media keys can't be pressed from CI, so this is also on the iPad checklist).
8. **No retries hiding flakiness.** `retries: 0`. A flaky test fails the PR and gets fixed, not retried.

### App ↔ test contract
The specs depend only on what's listed here. Changing it means changing the spec first.

**Routes** (hash-based, so a static host can serve every screen):

| Route | Screen |
|---|---|
| `#/library` (default) | Library |
| `#/player/<videoId>` | Player, where `videoId` = URL-encoded Shaka `offlineUri` |
| `#/settings` | Settings (PIN-gated) |

**The 4 screens and their states** (`data-testid` → `data-state`):

| Element | States / attributes |
|---|---|
| `app` (root) | `data-ready="true"` once booted |
| `screen-library` | `empty` · `ready` |
| `screen-player` | `loading` · `paused` · `pin-required` · `playing` · `ended` · `error` |
| `pin-prompt` (overlay, appears over any screen) | `data-mode`: `setup` · `confirm` · `verify` · `change`<br>`data-state`: `entry` · `wrong` · `locked-out` |
| `screen-settings` | `locked` · `unlocked` |
| `import-status` | `data-import`: `idle` · `storing` · `done` · `error` |

**Controls** (`data-testid`):
- Library: `app-version` (the released version from `version.json`, or `dev`), `library-item` (with `data-video-id`), `add-video-button`, `settings-button`, `import-input`, `import-progress`, `import-help` (always-visible note: pick the `.kidsvideo` file).
- Player: `player-video` (the `<video>` element), `play-button`, `pause-button`, `back-button`; **seek (M8):** `seek-bar` (a range input, in seconds), `time-elapsed`, `time-total` (`mm:ss`, or `h:mm:ss` from one hour).
- PIN prompt: `pin-input`, `pin-submit`, `pin-cancel`, `pin-error`.
- Settings: `change-pin-button`, `settings-video-item`, `remove-video-button`, `back-button`.
- **Proposed for series (M7, not built yet):** `series-item` (library tile, with `data-series`), route `#/series/<name>`, `screen-series`, `episode-item`.
- **Optional features (M6):** `feature-toggle-<id>` (Settings checkbox), `budget-prompt`, `budget-option-<minutes>` (20/30/45), `budget-cancel`, `session-bar`, `session-time` (with `data-seconds`), `session-remaining`, `clock`, `end-session-button`, and the player state `time-up`.
- `back-button` exists on both the player and settings screens, so tests scope it by screen, e.g. `getByTestId('screen-settings').getByTestId('back-button')`.

**Persisted data the tests may seed:**
- `localStorage['pin.sha256']`: the hex SHA-256 of the PIN.
- `localStorage['pin.lockout']`: `{failures, until}`, where `until` is an epoch ms.
- Shaka offline `appMetadata`: `{title, poster}`, where `poster` is a JPEG data URL.

**No test hooks in the app.** Tests use only browser-level techniques:
- Media Session handlers are captured by an init script that wraps `navigator.mediaSession.setActionHandler`.
- Visibility is simulated by overriding `document.visibilityState`.
- The iPhone's on-screen keyboard is modelled by an init script (`onScreenKeyboard` in `e2e/support.js`): while a text field has focus, `window.visualViewport` is shorter by the keyboard's height (300 px in portrait, 200 px in landscape), as iPhone Safari reports it, and fires `resize`. Like the real keyboard, it slides away about 300 ms after the field loses focus, so a tap on OK lands before the layout changes.

**Drafted-but-not-built specs** are marked `test.fixme`. They show as skipped in the report and are switched on in the milestone that implements them, so CI stays green on what exists.

**Browser profile:**
- the pinned Chromium build at an iPad-sized viewport (1180×820), with touch enabled;
- scenarios tagged `@ipad` also run in WebKit with an iPad profile (`ipad-webkit`); scenarios tagged `@iphone` run **only** in WebKit with iPhone profiles, portrait (`iphone-portrait`) and landscape (`iphone-landscape`);
- **`(color-gamut: p3)` reported as true** (as on the family's devices), via an init script in `e2e/support.js`.

### Test style: features as a hierarchy (Gherkin-equivalent, plain Playwright)
No Gherkin or Cucumber layer, and no extra dependency. The structure mirrors `.feature` files:

| Gherkin | Here |
|---|---|
| a folder of `.feature` files | `e2e/features/<area>/` |
| `Feature:` (one file) | one `*.spec.js` with `test.describe('Feature: …')` |
| `Scenario:` | `test('Scenario: …')` |
| `Given / When / Then` | `test.step('Given …')` labels, shown in the HTML report and CI traces |

A scenario that isn't built yet is `test.fixme`: it shows as skipped and is switched on in the milestone that builds it. A new feature starts as a new file of `fixme` scenarios, reviewed before any code.

```
e2e/
  support.js, server.js             shared fixtures/helpers, test server
  smoke/smoke.spec.js               the 4 screens load + codec canary (active)
  features/
    first-run/set-pin               Feature: Set a PIN on first run
    library/browse                  Feature: Browse the library (empty, several videos, reload, series order)
    library/add-video               Feature: Add a video (PIN, one .kidsvideo, second video, wrong PIN, loose parts refused, missing part, unplayable, duplicate refused, @ipad picker timing)
    library/remove-video            Feature: Remove a video
    library/add-several             Feature: Add several videos in one go (drafted, fixme)
    library/series                  Feature: Series (tile per series, ordered episodes; drafted, fixme)
    playback/open-video             Feature: Open a video (same app, never a new tab; paused at 0:00; locked-down <video>)
    playback/play-requires-pin      Feature: Playing needs the PIN (correct, wrong, cancel)
    playback/pause-and-resume       Feature: Pause and resume (pause never shows a PIN window; resume needs it; resumes in place)
    playback/multiple-videos        Feature: Several videos (back stops playback; switching starts paused; reopen from 0:00)
    playback/no-autoplay            Feature: No autoplay (end of video: nothing else starts)
    playback/seek                   Feature: Seek (scrub bar, elapsed/total, ← / → 10 s)
    parental-controls/no-way-around-the-pin   Feature: backgrounding, OS "play", script play
    parental-controls/pin-lockout   Feature: PIN lockout (5 wrong → 60 s, survives reload)
    parental-controls/watch-time-limit   Feature: Watch-time limit (optional, behind a flag)
    settings/settings               Feature: Settings (PIN-gated; change PIN needs current)
    offline/offline                 Feature: Works offline
```

**Decided by these scenarios:**
- Opening a video stays **in the same app** (the `#/player/…` route), never a new tab or window.
- Going back to the library **stops** the video.
- Reopening a video starts **from 0:00, paused**. Resuming in place only happens within one viewing, after a pause.

### Harness language
- **Node.js (pinned to the current LTS) + `@playwright/test`, written in plain JS.** This is CI-only and never shipped with the app.
- Playwright has official Python, Java and .NET bindings too, and a community Go port. Matching the app's language isn't required, but JS wins here:
  1. Only the JS version comes with Playwright's full test runner built in: parallel workers, test fixtures, auto-retrying assertions including `expect.poll`, and the trace viewer.
  2. The test steps that run inside the page are JavaScript in any binding anyway (seeding Shaka storage, reading `video.currentTime`).
  3. That makes it **one toolchain in CI** instead of two.
- **Speed isn't a factor.** Every binding drives the same browser over the same protocol, and the Python, Java, .NET and Go bindings all run Playwright's Node driver underneath. Test time is dominated by the browser and video playback.

### CI/CD (GitHub Actions): simple PR gates, no scheduled jobs
- **Repo:** `roumail/youtube-clone`, **public** (no sensitive content). Created with `gh repo create`.
- **`main` is protected:**
  - changes land only through PRs;
  - the required checks must be green before merge;
  - **squash merge only**;
  - no direct pushes.
- **Jobs, run on every PR to `main`:**
  - `fixtures`: generates the media fixtures on a plain runner with the pinned static tools. It's cached by a hash of the generator script plus the tool versions, and handed to `e2e` as an artifact.
  - `e2e` (**the required check**):
    - runs on **Ubuntu inside the digest-pinned Playwright image** (`mcr.microsoft.com/playwright:v1.65.1-noble`);
    - runs lint, the codec canary, then the specs.
- **Bumping Playwright** means changing `package.json` **and** the image digest (in `ci.yml` and `deploy.yml`) in the same PR.
- **Artifacts on failure:** the Playwright trace, screenshots, video and the HTML report. These are what the LLM reads (via `gh`) to debug without running anything locally.
- **On publishing a release** (not on merge): `deploy.yml` deploys the release's tag.
  - It publishes **only `app/`**, at the tagged commit, which must be on `main` and have passed CI.
  - `version.json` on the site records the release version and commit.
  - It uses the Actions-based Pages deployment (`upload-pages-artifact` + `deploy-pages`): no `gh-pages` branch and no force-pushes.
  - Each deploy is recorded in the `github-pages` environment.
  - It can be re-run manually for an existing release tag (`workflow_dispatch`), which is also how the automatic rollback restores the previous release.
  - Tests and tooling are never shipped.
- No nightly or scheduled runs.

### Releases (owner decision 2026-11-18)
- **The site runs exactly the latest release** (owner decision 2026-11-18, revised the same day: releases and deploys must not live independently). **Merges to `main` don't deploy**; they only have to pass CI. Publishing a release deploys it.
- **Versions** follow `vMAJOR.MINOR.PATCH`:
  - **major** for big or incompatible changes (e.g. a new storage format that needs re-adding videos);
  - **minor** for new features;
  - **patch** for fixes only.
- **The first release is v1.0.0:** the feature set above, as tested by the owner on the iPad.
- **The owner cuts releases** with `tools/release.sh major|minor|patch` (or an explicit version), using their own GitHub login. The script:
  - only runs from a clean, up-to-date `main`;
  - refuses unless that commit passed CI on `main` and comes after the previous release;
  - creates the tag and publishes the GitHub Release, with notes listing the PRs merged since the last release;
  - **publishing it deploys it.** The live site is then checked, and if the check fails, the **previous release** is restored automatically.
- **Trade-off, accepted by the owner:** nothing reaches the iPad, fixes included, until a release is cut. In return, the iPad only ever runs deliberately released versions.
- No workflow creates tags. Release tags are permanent: they're never moved or deleted.

### Release gates
- Every PR to `main` must pass the required checks before it can be merged.
- Only published releases deploy. After a deploy, the live site is checked automatically, and the previous release is restored if that check fails.
- Security measures are **not documented in this repo**. The owner keeps private notes; ask the owner before changing workflows, permissions, deploy steps or page security headers.

## Milestones
0. **T0 – Test foundation (before any feature code):**
   - public repo `roumail/youtube-clone` with protected `main` (squash only, required checks);
   - GitHub Actions PR gates;
   - fixture generation;
   - Playwright on the pinned Chrome, with the codec canary;
   - an empty app shell with its `data-state` contract;
   - the smoke test (4 screens load) plus the codec canary passing in CI;
   - all other specs drafted as `test.fixme`.
1. **M0 – Shaka offline spike (riskiest feature work, right after T0):**
   - Built as a **diagnostic page**, `app/spike/` (with its own service worker and manifest), installable as its own PWA. It shows each check as pass/fail and reuses real modules the app keeps (e.g. `local-scheme.js`). It has one active CI test that stores a fixture via the `local:` scheme. The main app is untouched.
   - Package one **typical episode (5–20 min)** on the Mac and put it in Google Drive. Then on the actual iPad confirm:
   - the 4 files can be picked from Google Drive in the Files picker;
   - `storage.store()` through the `local:` scheme completes;
   - the video plays smoothly offline (airplane mode);
   - it survives closing the app, rebooting, and 7+ days;
   - `navigator.storage.persist()` is granted and the quota estimate covers the planned library;
   - the Media Session `play` handler is honoured.

   If Shaka fails on iPad, switch to the OPFS + range-response fallback (section 1).

   **M0 results (2026-11-18), stated honestly:**

   | Check | Mac (Chrome 157, P3 screen) | iPad (installed from home screen) |
   |---|---|---|
   | Pick the 4 files (Finder / Google Drive in Files) | ✅ | ✅ |
   | Store a real episode via the `local:` scheme | ✅ "The Snowy Day": 39 min, 1080p, 1,289 MB in 3 s | ✅ stored (size not reported back) |
   | Play it | ✅ | ✅ played |
   | Pause | n/a | ❌ **spike limitation:** the spike has no pause button (native controls are off by design). The real player has one. |
   | Plays offline (airplane mode, after a force-close) | not tested | **not yet reported** |
   | Lock-screen / headphone "play" is ignored | ✅ in CI (emulated) | **not yet reported** |
   | `persist()` granted | ❌ in a plain tab (expected) | ✅ granted in the installed app |
   | Survives 7+ days | — | open; owner hasn't decided whether it's a gate |

   **The spike's UI is a diagnostic page, not the product.** Its list sits among log text and it has no pause button. The owner noted this as detail, not a blocker.

   **What M0 taught us (each now a rule elsewhere in this spec):**
   1. **Shaka on P3 screens drops SDR video by default.** Its default offline track picker uses `hdrLevel: 'AUTO'`, which on P3 screens means "prefer PQ"; it dropped the only SDR (BT.709) track and stored **0 tracks without any error** ("0 MB in 0.0 s", then 4036 on play). This hit the Mac and the iPad alike. Fix: our own track picker, and storing 0 tracks counts as a failure (section 1).
   2. **CI didn't catch it, because it didn't look like the family's devices:** headless Linux, no P3, and synthetic fixtures without colour info. Fix: every CI test emulates a P3 screen, plus an `episode-like` fixture (1080p, BT.709, two audio languages). See section 7.
   3. **A cache-first service worker kept showing stale versions** after deploys. Fix: network-first when online, `cache: 'reload'` on install, and a visible version marker.
   4. **`apt-get install ffmpeg` hung CI for 10 minutes.** Fix: pinned static binaries only.
   5. **Real downloads have several audio tracks** (the episode's first was Chinese). Fix: `prepare.sh` prefers English.
   6. **The 2 GB+ stress size was wrong for this family.** Typical media is 5–20 min episodes; the largest so far is 39 min / 1.3 GB, and it stored fine.
2. **M1 – Mac prepare script: done** (pulled into M0): `tools/get-packager.sh`, `tools/prepare.sh` (English audio preferred, re-encode only if needed, poster), CI fixtures built through it.
3. **M2 – Library + import.**
4. **M3 – Player + PIN gate.**
5. **M4 – First run, lockout, settings, offline + installable.**
6. **M5 – Hardening:** the iPad checklist (Appendix A) and a pass on the Mac.

### Milestone ↔ feature map
To build a milestone: switch **all** its scenarios from `test.fixme` to `test` in one PR (or a few), implement until CI is green, then the owner tries it on the devices. Order is the owner's call; dependencies are noted.

| Milestone | Feature files (`e2e/features/…`) | Scenarios | Needs first |
|---|---|---|---|
| **M2 – Library + import** ✅ | `library/browse`, `library/add-video`, `library/remove-video` | 4 + 5 + 1 = **10** (incl. series order) | — (the shell + `local-scheme.js` exist). `remove-video` needs the settings screen to unlock with the PIN, so `pin.js` verify mode comes with it. |
| **M3 – Player + PIN gate** ✅ | `playback/open-video`, `playback/play-requires-pin`, `playback/pause-and-resume`, `playback/multiple-videos`, `playback/no-autoplay`, `parental-controls/no-way-around-the-pin` | 3 + 3 + 3 + 3 + 1 + 3 = **16** | M2 (videos must be in the library) |
| **M4 – First run, lockout, settings, offline** ✅ | `first-run/set-pin`, `parental-controls/pin-lockout`, `settings/settings`, `offline/offline` | 3 + 2 + 2 + 1 = **8** | M2, M3. Also adds `manifest.webmanifest`, icons, `sw.js` (network-first) and the startup `persist()` call |
| **M5 – Hardening** | none new: Appendix A on the iPad, and a Mac pass | manual | M2–M4 |
| **M8 – Seek** ✅ | `playback/seek` | **5** | M3. Released as a **minor** version. |
| **M7 – Series** | `library/series`, `library/add-several` | 4 + 3 = **7** | M2–M4. Independent of M6. Released as a **minor** version. |
| **M9 – iPhone** | `devices/iphone` | **4** (each in portrait and landscape) | M2–M4. Released as a **patch** version (fixes the PIN prompt behind the keyboard). |
| **M6 – Optional features + watch-time limit** ✅ | `parental-controls/watch-time-limit` | **9** | M2–M4. Builds the feature-flag mechanism first, then the watch-time module. Released as a **minor** version. |
| | | **59 in total** | |

Also active: `smoke/` (5). The M0 spike and its tests were removed after the owner's iPad test (2026-11-18); `local-scheme.js` from it is part of the app.

## Open decisions (owner)
1. **Per-device PIN:** same code on both devices for now (section 5); revisit later.
2. ~~Watch-time sessions — automatic end~~ **decided 2026-11-19: never automatically.** Only the parent (Settings → End session) or a used-up budget ends a session.
3. ~~Watch-time budget choices~~ **decided 2026-11-19: 20 / 30 / 45 minutes, no "no limit".** For unlimited, switch the feature off.

Closed on 2026-11-19:
- **iPhone:** supported, in portrait and landscape (section 1, M9).

Closed on 2026-11-18:
- **7-day persistence:** not a gate. Prepared videos stay in Google Drive, so a cleared library is simply re-added.
- **Poster frame:** not important; it stays at 10% into the video.
- **M0 spike:** deleted from the repo.
- **Release management:** see section 7, "Releases".

## Appendix A – iPad manual checklist
Also run it on the **iPhone**, in portrait and landscape, plus: every PIN prompt (first run, Play, Settings, a wrong PIN) is fully above the keyboard without scrolling.
Run on the real iPad, in the app **installed from the home screen**, after each milestone that changes behaviour (and fully at M5). The Mac equivalent runs in CI.

1. **Install / update:** open the site in Safari → Share → Add to Home Screen. After a deploy, open the app online, close it and reopen it; the new version shows.
2. **Add a video:** "Add video" → PIN → Files → Google Drive → Kids Library → tap the video's **`.kidsvideo`** file. Progress shows; the video appears with its title and poster. Keep the app open while it stores.
3. **Play / pause / resume:** play asks for the PIN; pause is instant with no PIN; resume asks for the PIN again and continues where it stopped.
4. **No autoplay:** at the end of a video nothing else starts.
5. **Loopholes:** while paused, press play from the lock screen, Control Center and headphones → it stays paused (or shows the PIN prompt). Switch apps while playing → it pauses; coming back needs the PIN.
6. **Offline:** airplane mode, force-close the app, reopen → library is there and a video plays after the PIN.
7. **Persistence:** the library is still there after a reboot, and after a week without opening the app.
8. **Several videos:** going back stops playback; opening another video starts paused and needs the PIN.

## Sources (storage research)
- WebKit, *Updates to Storage Policy* (quotas, eviction, persist): https://webkit.org/blog/14403/updates-to-storage-policy/
- MDN, *Storage quotas and eviction criteria*: https://developer.mozilla.org/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- Chrome for Developers, *Serving cached audio and video* (Workbox range requests): https://developer.chrome.com/docs/workbox/serving-cached-audio-and-video
- Phil Nash, *Service workers: beware Safari's range request*: https://dev.to/philnash/service-workers-beware-safaris-range-request-38i7
- Workbox issue #3004, large local videos crash iOS Safari: https://github.com/GoogleChrome/workbox/issues/3004
- WebKit bug 232076 (blob URL video, missing Range header): https://bugs.webkit.org/show_bug.cgi?id=232076
- Apple forums, blob URL memory leak (iOS 15): https://developer.apple.com/forums/thread/693447 · blob URLs broken on iOS 17.4.1: https://developer.apple.com/forums/thread/751063
- MDN, `FileSystemWritableFileStream` (Safari 26+): https://developer.mozilla.org/en-US/docs/Web/API/FileSystemWritableFileStream
- Chronos issue #28, large offline copies in a PWA: https://github.com/MatyasMayer/Chronos/issues/28
- ffamilyfriendly/Video-Storage: https://github.com/ffamilyfriendly/Video-Storage
- Shaka Player (offline storage): https://github.com/shaka-project/shaka-player
- Shaka Player offline tutorial: https://shaka-project.github.io/shaka-player/docs/api/tutorial-offline.html
- Shaka Player plugins tutorial (registerScheme): https://shaka-project.github.io/shaka-player/docs/api/tutorial-plugins.html
- Shaka Player issue #2205, custom scheme for local content: https://github.com/google/shaka-player/issues/2205
- Shaka Packager DASH tutorial (on-demand profile): https://shaka-project.github.io/shaka-packager/html/tutorials/dash.html
- Shaka Packager releases: https://github.com/shaka-project/shaka-packager/releases
- Playwright: Chrome for Testing vs Chromium codecs: https://qaskills.sh/blog/chrome-for-testing-vs-chromium-playwright
- Chromium lacks H.264 for MSE by default: https://groups.google.com/a/chromium.org/g/chromium-dev/c/Qh49e3wcyKM
- Chrome on iOS adds Home Screen web apps (iPadOS 16.4+): https://www.ghacks.net/?p=198976
