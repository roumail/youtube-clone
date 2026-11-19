# Design notes

**The behaviour specs in `e2e/features/` are the source of truth** for what the app
does. This file keeps only what they can't hold: why it's built this way, notes
for the owner, behaviour that has no scenario yet, how specs are written, and
the manual device checklist. How to work in this repo is in `AGENTS.md`.

Original brief:
* Installable on the Mac and the iPad; each device keeps its own storage.
* Maximum reuse of existing functionality, minimum dependencies.
* A fixed library that is available for rendering.
* Adding new media is easy.
* Full control over the UI: pausing is free, playing needs a code every time; no autoplay.
* Feature-minimal: nothing gets added without asking first.

## 1. Why it's built this way

**An installable web app (PWA), not a native app.** A native iPad app runs into
Apple's signing paywall: a free Apple ID install stops launching after 7 days,
and a lasting one needs the $99/yr developer program. Capacitor/Cordova wrappers
need the same signing; AltStore/SideStore is fragile; Python (Kivy/BeeWare) adds
an interpreter on top. A browser is on every device already, so: no App Store,
no Xcode, no account, no expiry.

**Shaka Player offline storage.** Shaka stores each video as many small
segments in IndexedDB and plays them through Media Source Extensions
(`ManagedMediaSource` on iPadOS 17+). No single big file is ever handed to the
`<video>` element, which avoids the iOS problems with large blob URLs (memory
blow-up on iOS 15, broken playback on iOS 17.4.1, crashes with 100–500 MB
files). It's production-grade, so nothing is hand-rolled on the storage side.
Shaka's default offline track picker drops SDR video on P3 screens, so the app
always passes its own (see `AGENTS.md`).

**The cost: each video is prepared once on the Mac** (Shaka stores DASH, not
plain `.mp4`), into one `.kidsvideo` file shared through Google Drive, so the
iPad never processes anything. Tools: the pinned Shaka Packager binary
(repackages without re-encoding) and ffmpeg (re-encodes only when needed, grabs
the poster). No Python anywhere. Usage: `tools/README.md`.

**Stack:** plain HTML, CSS and JavaScript modules, no framework, no build step.
The only app dependency is the vendored, pinned Shaka Player in `app/vendor/`.
npm is only for the CI test tooling.

**Hosting:** static files only (never videos) on GitHub Pages at
https://www.rohailtaimour.com/youtube-clone/, the address the devices install
from. HTTPS is required to install. No server code, no database.

**Storage space:** since WebKit 17 (iPadOS 17 / macOS 14) a browser app gets up
to 60% of the disk per origin, and installed web apps get the same; Chrome on
the Mac is similar. Home-screen web apps are exempt from Safari's 7-day storage
cap; eviction only happens under disk pressure and spares persistent origins.
The app calls `navigator.storage.persist()` once at startup, with no UI and no
test.

## 2. Notes for the owner

- **Install.** Mac: Chrome → ⋮ → Cast, save and share → Install page as app
  (or Safari → Add to Dock). iPad and iPhone: Safari or Chrome → Share → Add to
  Home Screen. On iPad and iPhone every browser uses Apple's WebKit, so the
  choice of browser changes nothing.
- **Deleting the home-screen app** (or clearing its data) deletes its library.
  Re-adding from Google Drive is the recovery; the files there are the backup.
- **Forgotten PIN:** delete and re-add the home-screen app (this also clears
  the library).
- **iPad, picking from Google Drive:** the file is downloaded to a temporary
  place first, so about 2× the video's size has to be free for a moment.
- **Keep a child inside the app:** turn on iPad Guided Access.
- **Honest limits.** The PIN and the watch-time limit stop a child, not a
  determined adult: the stored SHA-256 of a 4–6 digit PIN can be brute-forced by
  someone who can read the browser's storage, and clearing the browser data
  resets everything.

## 3. Scope (feature-minimal)

Users are the parents plus a child watching. The PIN prompt is the only access
control; there are no logins, accounts or roles, and none are planned.

Out of scope unless asked for:
- playlists, recommendations, history
- playback speed, subtitles, volume UI (hardware buttons only)
- next / previous buttons in the player (not wanted, owner decision 2026-11-19)
- accounts, sync, cloud, multiple profiles
- PiP, AirPlay, downloading from the internet, comments, likes

Any new feature is proposed first and added only after it's approved.

## 4. Behaviour without a scenario yet

The app does these today, but no spec checks them. Before changing one, write
its scenario first.

- **Full screen:** Esc leaves it; the button is hidden where the browser doesn't
  allow full screen for the page (`document.fullscreenEnabled` false, e.g. the
  iPhone); it hides with the other controls while playing.
- **Controls hiding:** a key press shows them again; on the Mac the mouse
  pointer hides with them; they stay visible when the video has ended, when time
  is up, and while a prompt is open.
- **Seek:** times from one hour show as `h:mm:ss`; there are no skip buttons and
  no scroll-wheel seeking.
- **Series tile:** shows the poster of the series' first episode.
- **Watch-time limit:** time with the app in the background doesn't count; it's
  measured with the browser's monotonic clock, so changing the device time
  doesn't change it; on a phone the budget prompt stays above the keyboard.
- **Optional features:** each one is its own module, `app/features/<id>.js`
  (`{ id, title, init(ctx) }`), with flags in `localStorage['features']`; a
  feature that's switched off is never loaded.
- **The app never fetches video content from the internet.**
- **Updates:** the service worker is network-first, so after a release the new
  version shows (manual check, Appendix A item 1).

## 5. Writing specs

- One `e2e/features/<area>/*.spec.js` per `Feature:`, one `test('Scenario: …')`
  per scenario, Given/When/Then as `test.step` labels. No Gherkin layer.
- **Wait on state, never on time.** Web-first assertions on the app's
  `data-testid` / `data-state` / `data-import` attributes (`waitForTimeout` is
  banned by lint). Those ids and states, the routes, and the `localStorage` keys
  the specs use are the app ↔ test contract.
- "Playing" means `data-state=playing` **and** `currentTime` advancing; "paused"
  means `video.paused` and `currentTime` stable across two polls.
- Timers use `page.clock`. Every test gets a fresh browser context. `retries: 0`.
- Arrange through `seedLibrary` (Shaka `store()` with the app's track picker);
  only the import scenarios go through the file picker.
- **No test hooks in the app.** The environment is simulated with init scripts
  in `e2e/support.js`: P3 screen (every test), Media Session handlers,
  visibility, the iPhone keyboard, free storage space.
- Projects: Chromium at iPad size with touch; `@ipad` scenarios also run in
  WebKit (iPad profile); `@iphone` scenarios run only in WebKit iPhone profiles,
  portrait and landscape.
- Fixtures are synthetic and generated by `fixtures/generate.sh` (each one is
  described there), through `tools/prepare.sh`, so every CI run exercises it.

## Open decisions (owner)
1. **Per-device PIN:** same code on all devices for now; revisit later.

## Appendix A – iPad manual checklist
Run on the real iPad, in the app **installed from the home screen**, after each
release that changes behaviour. Also run it on the **iPhone**, in portrait and
landscape, plus: every PIN prompt (first run, Play, Settings, a wrong PIN) is
fully above the keyboard without scrolling, and the page never zooms in when a
field is tapped.

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
- Workbox issue #3004, large local videos crash iOS Safari: https://github.com/GoogleChrome/workbox/issues/3004
- WebKit bug 232076 (blob URL video, missing Range header): https://bugs.webkit.org/show_bug.cgi?id=232076
- Apple forums, blob URL memory leak (iOS 15): https://developer.apple.com/forums/thread/693447 · blob URLs broken on iOS 17.4.1: https://developer.apple.com/forums/thread/751063
- Shaka Player offline tutorial: https://shaka-project.github.io/shaka-player/docs/api/tutorial-offline.html
- Shaka Player plugins tutorial (registerScheme): https://shaka-project.github.io/shaka-player/docs/api/tutorial-plugins.html
- Shaka Packager DASH tutorial (on-demand profile): https://shaka-project.github.io/shaka-packager/html/tutorials/dash.html
- Chromium lacks H.264 for MSE by default: https://groups.google.com/a/chromium.org/g/chromium-dev/c/Qh49e3wcyKM
