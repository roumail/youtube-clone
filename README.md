# Kids video library

A PIN-gated video library for a family's Mac, iPad and iPhone: an installable
web app (PWA). Videos are prepared once on the Mac into `.kidsvideo` files.
Pausing is free; playing needs the PIN every time; nothing plays by itself,
except the next video of a playlist a parent started with the PIN.

**Two words used throughout:**
- **The shelf:** where the prepared videos live, normally a "Kids Library"
  folder in Google Drive. It holds everything.
- **The catalogue:** what one device shows the child. A parent adds videos to
  it, behind the PIN. Each device has its own.

Each video in a catalogue is either:
- **streamed:** added from Google Drive. The device keeps only its title and
  poster; it plays from the shelf and needs the internet.
- **stored:** added with "Add video" (from Files, e.g. after AirDrop). A copy
  is kept on the device; it plays offline and uses the device's space.

- **Live app:** https://www.rohailtaimour.com/youtube-clone/
- **What it does:** the behaviour specs in `e2e/features/` are the source of truth.
- **Working on it:** `AGENTS.md`. **Preparing videos:** `tools/README.md`.

## Using it

- **Install.** Mac: Chrome → ⋮ → Cast, save and share → Install page as app
  (or Safari → Add to Dock). iPad and iPhone: Safari or Chrome → Share → Add to
  Home Screen. On iPad and iPhone every browser uses Apple's WebKit, so the
  choice of browser changes nothing.
- **Each device has its own catalogue and its own PIN**, kept in that device's
  browser storage. The PIN can be changed in Settings.
- **Streaming from Google Drive:** "Add from Google Drive" (behind the PIN) signs
  in to Google and opens Google's file picker, including "Shared with me". Pick
  `.kidsvideo` files or a whole folder (on the iPad Google's picker takes one
  item at a time, so pick a series' folder): a folder adds every `.kidsvideo`
  in it and its subfolders, skipping titles already there, so picking it again
  later adds only new episodes. They're added as streamed: only their title and
  poster are read. The app only reads Google Drive (read-only permission), and
  the device account sees nothing but the shelf. The button appears once the site is
  deployed with a Google project's values: see
  [Setting up Google Drive](#setting-up-google-drive).
- **Playing a streamed video** needs the internet and a Google sign-in. Google
  gives a web app like this one (no server of its own) a sign-in that lasts
  about an hour, and renewing it needs a tap. So it is renewed on the tap that
  opens a streamed video, kept across reopening the app until it runs out, and
  a video pauses just before it runs out (play with the PIN to go on). Once the
  device account has approved the app, renewing asks nothing: Google's window
  opens and closes by itself.
- **Storing a video on the iPad or iPhone** (to watch offline): AirDrop its
  `.kidsvideo` from the Mac (it lands in Files → Downloads), or download it from
  Google Drive into Files. In the app: Add video → PIN → pick it there. Then
  delete it from Downloads: the app keeps its own copy, so leaving it there
  stores the video twice.
- **Downloading a streamed video** (for a trip, or a bad connection): its tile
  in the library has **Download** (behind the PIN). A downloaded video plays and
  seeks with no internet, like a stored one. A download is meant to be
  short-lived: Settings → **Remove download** frees the space, and if the
  browser clears it, the video simply streams again.
- **Playing several in a row** (a playlist): hold a video in the library or a
  series to start selecting, tap more to tick them, then Play. They play in
  the order ticked; the PIN is asked once, at the start, and each next video
  starts by itself. Pausing and going on still need the PIN; back ends the
  playlist. A tap on a video still plays it alone. Playlists aren't saved yet.
- **Removing and hiding** (Settings, behind the PIN): a stored video can be
  removed, which deletes its copy and frees the space. A streamed video can
  only be hidden from this device (with its download, if any); it stays on the
  shelf and can be added again.
- **Deleting the home-screen app** (or clearing its data) empties its
  catalogue and deletes its stored copies. The shelf is the backup: add the
  videos again from it.
- **Forgotten PIN:** delete and re-add the home-screen app (this also empties
  the catalogue).
- **Keep a child inside the app:** turn on iPad Guided Access.
- **Honest limits.** The PIN and the watch-time limit stop a child, not a
  determined adult: the stored SHA-256 of a 4–6 digit PIN can be brute-forced by
  someone who can read the browser's storage, and clearing the browser data
  resets everything.

## Setting up Google Drive

Once per installation, about 20 minutes, in a browser on the Mac. Until it's
done, "Add from Google Drive" stays hidden and everything else works.

The devices sign in with a **device account**: a separate, regular (adult, not
Family Link) Google account with Viewer access to the shelf (the library
folder) and nothing else. The Google project lives on that account too.

1. **Create the device account** in a separate browser profile (accounts.google.com
   → Create account → For my personal use, adult birth date) and turn on its
   2-Step Verification. Stay signed in only as this account for the next
   steps: Google's console uses whichever account is active.
2. **Share the shelf** (the library folder) from the account that owns it: Share → add the
   device account as Viewer. No folder settings need changing.
3. **Check access** as the device account: drive.google.com → Shared with me
   shows the folder and offers Download on its files. Optionally: right-click the
   folder → Organize → Add shortcut to My Drive.
4. **Google Cloud project:** console.cloud.google.com → New project (no
   organization, no billing). APIs & Services → Library → enable **Google Drive
   API** and **Google Picker API**.
5. **Consent screen:** APIs & Services → OAuth consent screen → Get started.
   App name and support email (the device account); Audience: External. Under
   Branding: home page = the app's address, authorized domain = its domain.
   Data access → Add or remove scopes: add `https://www.googleapis.com/auth/drive.readonly`
   (a restricted scope; if it isn't in the list, paste it under "Manually add
   scopes"), then Update and Save. Audience → Test users: add the device
   account, and leave the app in Testing: test users need no Google review.
6. **Credentials** (APIs & Services → Credentials → Create credentials):
   - **OAuth client ID:** Web application. Authorized JavaScript origins: the
     site's origin only, for example `https://www.example.com` (no path, no
     trailing slash). No redirect URIs. The app doesn't use the client secret.
   - **API key:** then Edit it. Application restrictions: Websites →
     `https://www.example.com/*` (your site). API restrictions: only Google
     Picker API.
7. **Put two values in GitHub** (repo → Settings → Secrets and variables →
   Actions), then redeploy the latest release (Actions → Deploy → Run workflow
   with its tag) so the site serves them:

   | Name | Where | Where to find it | Looks like |
   |---|---|---|---|
   | `GOOGLE_CLIENT_ID` | Variables | Credentials → OAuth 2.0 Client IDs → your client | `123456789012-abc123….apps.googleusercontent.com` |
   | `GOOGLE_API_KEY` | Secrets | Credentials → API keys → your key → Show key | `AIza` + 35 letters, digits, `-` and `_` |

   The client ID is public by design (its leading digits, the project number,
   are what the Picker needs, so there's nothing else to copy). The API key is
   served to the browser too, but keep its only copies in GitHub and the Cloud
   console: don't paste it into notes, docs or the repo.
8. **On the iPad and iPhone:** open the app online, close it in the app
   switcher and open it again; "Add from Google Drive" shows next to "Add
   video". Add from Google Drive → PIN → sign in as the device account. The
   first time, Google says it "hasn't verified this app" (it stays in Testing):
   Continue, then allow "See and download all your Google Drive files". Then
   Shared with me (or the shortcut) → pick `.kidsvideo` files or a folder. If
   the sign-in window doesn't open, check Settings → Safari → Block Pop-ups, or
   try from the site in a Safari tab.

**Later.** The device account's myaccount.google.com → Security → Your
connections to third-party apps lists the app with read-only access to Google
Drive; access can be removed there.

**Replacing the API key** (copied somewhere it shouldn't be, or its quota being
used up): Credentials → your key → Rotate key (or create a new key with the
same restrictions, then delete the old one) → update the `GOOGLE_API_KEY`
secret → redeploy the latest release.

## Why it's built this way

**An installable web app, not a native app.** A native iPad app runs into
Apple's signing paywall: a free Apple ID install stops launching after 7 days,
and a lasting one needs the $99/yr developer program. Capacitor/Cordova wrappers
need the same signing; AltStore/SideStore is fragile; Python (Kivy/BeeWare) adds
an interpreter on top. A browser is on every device already, so: no App Store,
no Xcode, no account, no expiry.

**Shaka Player offline storage** (stored videos). Shaka stores each video as many small
segments in IndexedDB and plays them through Media Source Extensions
(`ManagedMediaSource` on iPadOS 17+). No single big file is ever handed to the
`<video>` element, which avoids the iOS problems with large blob URLs (memory
blow-up on iOS 15, broken playback on iOS 17.4.1, crashes with 100–500 MB
files). It's production-grade, so nothing is hand-rolled on the storage side.
A streamed video goes through the same player, reading byte ranges of its
`.kidsvideo` straight from Google Drive as it plays.

**Each video is prepared once on the Mac**, or on any computer with Docker
(Shaka plays DASH, not plain `.mp4`), into one `.kidsvideo` file on the shelf,
so the iPad and iPhone never process anything. Tools: the pinned Shaka Packager
binary (repackages without re-encoding) and ffmpeg (re-encodes whatever is above
the size target of 540p, 0.7 Mbit/s and 64 kbit/s stereo audio, and grabs the
poster); the Go tool `tools/kidsvideo` drives them and packs the file. No
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
