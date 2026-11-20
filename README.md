# Kids video library

An offline, PIN-gated video library for a family's Mac, iPad and iPhone: an
installable web app (PWA). Videos are prepared once on the Mac, sent to the
iPad and iPhone with AirDrop, and stored on each device. Pausing is free;
playing needs the PIN every time; nothing plays by itself.

- **Live app:** https://www.rohailtaimour.com/youtube-clone/
- **What it does:** the behaviour specs in `e2e/features/` are the source of truth.
- **Working on it:** `AGENTS.md`. **Preparing videos:** `tools/README.md`.

## Using it

- **Install.** Mac: Chrome → ⋮ → Cast, save and share → Install page as app
  (or Safari → Add to Dock). iPad and iPhone: Safari or Chrome → Share → Add to
  Home Screen. On iPad and iPhone every browser uses Apple's WebKit, so the
  choice of browser changes nothing.
- **Each device has its own library and its own PIN**, kept in that device's
  browser storage. The PIN can be changed in Settings.
- **Deleting the home-screen app** (or clearing its data) deletes its library.
  Re-adding from the Mac's library folder is the recovery; the files there are
  the backup.
- **Forgotten PIN:** delete and re-add the home-screen app (this also clears
  the library).
- **Adding a video on the iPad or iPhone:** AirDrop its `.kidsvideo` from the
  Mac; it lands in Files → Downloads. In the app: Add video → PIN → pick it
  there. Then delete it from Downloads: the app keeps its own copy, so leaving
  it there stores the video twice.
- **Keep a child inside the app:** turn on iPad Guided Access.
- **Honest limits.** The PIN and the watch-time limit stop a child, not a
  determined adult: the stored SHA-256 of a 4–6 digit PIN can be brute-forced by
  someone who can read the browser's storage, and clearing the browser data
  resets everything.

## Why it's built this way

**An installable web app, not a native app.** A native iPad app runs into
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

**Each video is prepared once on the Mac**, or on any computer with Docker
(Shaka stores DASH, not plain `.mp4`), into one `.kidsvideo` file sent to the
devices with AirDrop, so the iPad and iPhone never process anything. Tools: the pinned Shaka Packager
binary (repackages without re-encoding) and ffmpeg (re-encodes whatever is above
the size target of 720p, 1.2 Mbit/s and stereo audio, and grabs the poster). No
Python anywhere.

**Stack:** plain HTML, CSS and JavaScript modules, no framework, no build step.
The only app dependency is the vendored, pinned Shaka Player in `app/vendor/`.
npm is only for the CI test tooling.

**Hosting:** static files only (never videos) on GitHub Pages. HTTPS is
required to install. No server code, no database.

**Storage space:** since WebKit 17 (iPadOS 17 / macOS 14) a browser app gets up
to 60% of the disk per origin, and installed web apps get the same; Chrome on
the Mac is similar. Home-screen web apps are exempt from Safari's 7-day storage
cap; eviction only happens under disk pressure and spares persistent origins.
The app asks for persistent storage once at startup.

### Sources
- WebKit, *Updates to Storage Policy*: https://webkit.org/blog/14403/updates-to-storage-policy/
- MDN, *Storage quotas and eviction criteria*: https://developer.mozilla.org/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- Workbox issue #3004, large local videos crash iOS Safari: https://github.com/GoogleChrome/workbox/issues/3004
- WebKit bug 232076 (blob URL video, missing Range header): https://bugs.webkit.org/show_bug.cgi?id=232076
- Apple forums, blob URL memory leak (iOS 15): https://developer.apple.com/forums/thread/693447 · blob URLs broken on iOS 17.4.1: https://developer.apple.com/forums/thread/751063
- Shaka Player offline tutorial: https://shaka-project.github.io/shaka-player/docs/api/tutorial-offline.html
- Shaka Player plugins tutorial (registerScheme): https://shaka-project.github.io/shaka-player/docs/api/tutorial-plugins.html
- Shaka Packager DASH tutorial (on-demand profile): https://shaka-project.github.io/shaka-packager/html/tutorials/dash.html
