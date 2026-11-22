# Kids video library

A video library for a family's Mac, iPad and iPhone, unlocked by a parent's
Face ID or Touch ID: an installable web app (PWA). Videos are prepared once on
the Mac into `.kidsvideo` files. Pausing is free; playing needs Face ID every
time; nothing plays by itself, except the next video of a playlist a parent
started.

**Two words used throughout:**
- **The shelf:** where the prepared videos live, normally a "Kids Library"
  folder in Google Drive. It holds everything.
- **The catalogue:** what one device shows the child. A parent adds videos to
  it, behind Face ID. Each device has its own.

Each video in a catalogue is either:
- **streamed:** added from Google Drive. The device keeps only its title and
  poster; it plays from the shelf and needs the internet.
- **stored:** added with "Add video" (from Files, e.g. after AirDrop). A copy
  is kept on the device; it plays offline and uses the device's space.

- **Live app:** https://www.rohailtaimour.com/youtube-clone/
- **What it does:** the behaviour specs in `e2e/features/` are the source of truth.
- **Working on it:** `AGENTS.md`. **Preparing videos:** `tools/README.md`.
- **How it is built, and the one-time Google Drive setup:** [`docs/`](docs/README.md).

## Using it

- **Install.** Mac: Chrome → ⋮ → Cast, save and share → Install page as app
  (or Safari → Add to Dock). iPad and iPhone: Safari or Chrome → Share → Add to
  Home Screen. On iPad and iPhone every browser uses Apple's WebKit, so the
  choice of browser changes nothing.
- **Each device has its own catalogue**, kept in that device's browser storage,
  and is unlocked with that device's Face ID or Touch ID (see Unlocking below).
- **Streaming from Google Drive:** "Add from Google Drive" (behind Face ID) signs
  in to Google and opens Google's file picker, including "Shared with me". Pick
  `.kidsvideo` files or a whole folder (on the iPad Google's picker takes one
  item at a time, so pick a series' folder): a folder adds every `.kidsvideo`
  in it and its subfolders, skipping titles already there, so picking it again
  later adds only new episodes. They're added as streamed: only their title and
  poster are read. The app only reads Google Drive (read-only permission), and
  the device account sees nothing but the shelf. The button appears once the site is
  deployed with a Google project's values: see
  [Setting up Google Drive](docs/google-drive-setup.md).
- **Playing a streamed video** needs the internet and a Google sign-in. Google
  gives a web app like this one (no server of its own) a sign-in that lasts
  about an hour, and renewing it needs a tap. So it is renewed on the tap that
  opens a streamed video, kept across reopening the app until it runs out, and
  a video pauses just before it runs out (play to go on: Face ID, then
  Continue). Once the
  device account has approved the app, renewing asks nothing: Google's window
  opens and closes by itself.
- **Storing a video on the iPad or iPhone** (to watch offline): AirDrop its
  `.kidsvideo` from the Mac (it lands in Files → Downloads), or download it from
  Google Drive into Files. In the app: Add video → Face ID → Continue → pick it there. Then
  delete it from Downloads: the app keeps its own copy, so leaving it there
  stores the video twice.
- **Downloading a streamed video** (for a trip, or a bad connection): its tile
  in the library has **Download** (behind Face ID). A downloaded video plays and
  seeks with no internet, like a stored one. A download is meant to be
  short-lived: Settings → **Remove download** frees the space, and if the
  browser clears it, the video simply streams again.
- **Playing several in a row** (a playlist): hold a video in the library or a
  series to start selecting, tap more to tick them, then Play. They play in
  the order ticked; Face ID is asked once, at the start, and each next video
  starts by itself. Pausing is free and going on needs Face ID; back ends the
  playlist. A tap on a video still plays it alone. Playlists aren't saved yet.
- **Removing and hiding** (Settings, behind Face ID): a stored video can be
  removed, which deletes its copy and frees the space. A streamed video can
  only be hidden from this device (with its download, if any); it stays on the
  shelf and can be added again.
- **Deleting the home-screen app** (or clearing its data) empties its
  catalogue and deletes its stored copies. The shelf is the backup: add the
  videos again from it.
- **Keep a child inside the app:** turn on iPad Guided Access.
- **Honest limits.** Face ID and the watch-time limit stop a child, not a
  determined adult: someone who knows the device passcode, or can change the
  browser's storage, gets past them, and clearing the browser data resets
  everything.

## Unlocking

Everything a parent does (play and going on after a pause, Settings, search,
adding, downloading) is unlocked with the device's **Face ID or Touch ID**.
There is no PIN of the app's own.

- **The rules for parents:** your child must not know the device's passcode,
  and must not have their face (or finger) enrolled on the device. When Face ID
  fails, the device offers its passcode instead, so the passcode unlocks the
  app too.
- **First run** sets up Face ID: the device saves a passkey for this app
  ("Continue", then Face ID). It can't be skipped. A device without Face ID,
  Touch ID or a passcode can't use the app, and says so.
- **Every unlock:** tap, and the device's own Face ID sheet shows. Adding a
  video, adding from Google Drive when a Google sign-in is due, downloading
  then, and playing a streamed video after its sign-in ran out need one more
  tap, on **Continue**: the browser only opens a file picker or Google's window
  during a tap, and Face ID takes a moment.
- **When Face ID fails or is cancelled**, the app shows "Use Face ID" to try
  again, and Cancel. Play from Control Center or the lock screen also waits for
  a tap on "Use Face ID".
- **Failed tries are the device's business.** After several, it asks for the
  passcode; wrong passcodes can lock the whole device for a while, as on its
  lock screen. The app itself never locks.
- **If the passkey is gone** (deleted in Passwords, or the browser's data
  cleared): "Set up Face ID again" makes a new one, which needs Face ID or the
  passcode. Deleting the home-screen app also empties its catalogue.
- **Installs from before** (with a PIN): on the next start they set up Face ID,
  or keep the passkey they already had; the old PIN is forgotten.
