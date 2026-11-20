# Preparing videos

The app plays only one format: a `.kidsvideo` file. Each video is prepared once,
on a computer, into one such file:

```
Kids Library/
  The Snowy Day.kidsvideo        ← the file name is the title shown in the app
  Bluey/Bluey - S01E03 - Keepy Uppy.kidsvideo
```

A `.kidsvideo` (format 2) is a plain, uncompressed `tar`: a small
`kidsvideo.json` first (format and title), then the 4 parts the app needs
(`<Title>.mpd`, `video.mp4`, `audio.mp4`, `poster.jpg`). The app refuses files
made by older versions of the tools; prepare those again.

## From a new video to the iPad

The library folder is normally the shelf: a "Kids Library" folder in Google
Drive, synced by Google Drive for desktop (see the main README).

1. Put the source video in `originals/` in this repo folder (gitignored), e.g.
   `originals/Films/`: it stays there, to prepare again later if needed.
2. Prepare it (once, the setup below):
   ```bash
   tools/run_prepare.sh "originals/Films/<the file>"           # title from the file name
   tools/run_prepare.sh --title "Frozen 2" "originals/Films/<the file>"
   tools/run_prepare.sh --series "Kipper the Dog" "originals/Kipper the Dog"
   ```
   Add `--tmux` for a long film: it keeps running after the terminal closes.
3. Google Drive for desktop uploads `Kids Library/<Title>.kidsvideo` (or
   `Kids Library/<Series>/...`); its menu-bar icon says when it's done.
4. In the app: Add from Google Drive → pick the file, or pick the series'
   folder again: only the new episodes are added.

Without Google Drive, AirDrop the file to the iPad or iPhone and use Add video.

There are two ways to run the preparation: with Docker on any computer, or
directly on a Mac or Linux machine. Both run the same `tools/run_prepare.sh`,
with the same options.

## With Docker (any computer)

Needs Docker (Docker Desktop on a Mac or Windows) and git. Once:

```bash
git clone https://github.com/roumail/youtube-clone.git
cd youtube-clone
docker build -t kids-prepare .
```

Then mount the folder with your videos as `/in` and your library folder as
`/out` (it must exist), and pass the inputs as `/in/...` paths:

```bash
docker run --rm -it --user "$(id -u):$(id -g)" \
  -v ~/Downloads:/in:ro -v ~/"Kids Library":/out \
  kids-prepare /in/Frozen.2.2019.1080p.WEB-DL.mkv
```

- A whole folder: `kids-prepare /in`. A series: `kids-prepare --series "Bluey" /in/Bluey`.
  Every option below works the same way.
- `-it` shows the re-encoding progress bar; leave it out to pipe paths in
  (`ls *.mp4 | sed 's|^|/in/|' | docker run --rm -i ... kids-prepare`).
- `--user` makes the prepared files yours, not root's.
- `--tmux` doesn't work in the container; Docker's own `-d` runs it detached
  (`docker logs -f <id>` to watch).

## Without Docker (Mac or Linux)

1. Get the repo (`git clone`, as above) and ffmpeg: `brew install ffmpeg` on a
   Mac, your package manager on Linux (`sudo apt install ffmpeg`).
2. Tell the tools where your library folder is. Copy the example and edit the
   path (`.env` is gitignored, so your path stays private):
   ```bash
   cp .env.example .env
   # then set, e.g.:
   # KIDS_LIBRARY="$HOME/Movies/Kids Library"
   ```
   The folder must exist. Keep it: it is your library's backup.

The pinned Shaka Packager is downloaded automatically on first use
(`tools/get-packager.sh`, checksum-verified).

### Put it on your PATH (once)
Link it into a `bin` folder on your PATH, so `run_prepare` works from any
folder. It follows the link back to the repo, so it still finds `.env` (your
`KIDS_LIBRARY`) and the other tools:

```bash
mkdir -p ~/bin
ln -sf "$PWD/tools/run_prepare.sh" ~/bin/run_prepare   # run from the repo folder
# if ~/bin isn't on your PATH yet (zsh):
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

## `tools/run_prepare.sh`: options and examples

```bash
tools/run_prepare.sh [--dest DIR] [--title "Clean Title"] [--series "Name"] INPUT...
ls *.mp4 | tools/run_prepare.sh        # paths on stdin, one per line
```

| Option | Meaning |
|---|---|
| `INPUT...` | Video files and/or folders. Folders are searched recursively for `.mp4 .m4v .mov .mkv .webm .avi`. With no `INPUT`, paths are read from stdin, one per line (`ls *.mp4 \| run_prepare`). |
| `--dest DIR` | Where the `.kidsvideo` files go. Default: `KIDS_LIBRARY` from the environment or `.env`. |
| `--title "…"` | Clean title for a **single** file (instead of its file name). With `--series`, the episode title. |
| `--series "Name"` | The inputs are episodes of a series (see below). |

### Examples

One file, with a clean title (handy for long download names):
```bash
tools/run_prepare.sh --title "The Snowy Day" ~/Downloads/The.Snowy.Day.2016.1080p.WEB-DL.mkv
```

One file, title taken from the file name:
```bash
tools/run_prepare.sh ~/Videos/"Bluey - Keepy Uppy.mp4"
```

Everything matching a pattern in the current folder, piped in (populates
`KIDS_LIBRARY`):
```bash
cd ~/Downloads/Bluey
ls *.mp4 | run_prepare
```

Pipe from `find` for nested folders or several extensions:
```bash
find ~/Downloads -iname '*.mkv' -o -iname '*.mp4' | run_prepare
```

A whole folder (batch):
```bash
tools/run_prepare.sh ~/Videos/Bluey/
```

Several files and folders at once, into a different destination:
```bash
tools/run_prepare.sh --dest ~/Desktop/test-library ep1.mp4 ep2.mkv ~/Videos/Specials/
```

### Progress
While a video is re-encoded (e.g. HEVC → H.264), a live line shows how far it is:
`re-encoding [########------------]  41%  16:12 / 39:28  speed 2.3x  ETA 10m`.
It's drawn on your terminal (also inside a `--tmux` session when you attach);
logs only get the start and the total time. Repackaging needs no bar: it takes
seconds.

### Long jobs: `--tmux`
Re-encoding a film (e.g. HEVC → H.264) can take an hour. With `--tmux` the job
runs in a detached tmux session, so closing the terminal doesn't stop it:
```bash
find ~/Downloads/test -iname '*.mkv' | run_prepare --tmux   # pipes work too
tmux attach -t kids-prepare-…                  # watch it (Ctrl-b then d to leave it running)
```
The full output is also saved to `logs/run_prepare-<session>.log`.

To make it the default, set `RUN_PREPARE_TMUX=1` in your `.env`; `--no-tmux`
runs one job in the terminal anyway. Without either, the tool prints a one-line
tip when tmux is installed.

### Series
Pass `--series` and the episodes get titles the app understands
(`Name - S01E03 - Episode title`) and go into a folder per series:

```bash
run_prepare --series "Bluey" ~/Downloads/Bluey/          # whole season folder
ls Bluey*.mkv | run_prepare --series "Bluey"              # piped
run_prepare --series "Bluey" --title "Keepy Uppy" ep3.mkv # name one episode yourself
```

```
Kids Library/
  Bluey/
    Bluey - S01E01 - Magic Xylophone/   (Bluey - S01E01 - Magic Xylophone.mpd + 3 files)
    Bluey - S01E03 - Keepy Uppy/
  The Snowy Day/                        (standalone videos stay at the top level)
```

- Each file name must contain its season and episode: `S01E03`, `s1e3` or
  `1x03`. Files without one are reported as failed (rename them, or prepare
  them without `--series`).
- The episode title is the text after that tag, with dots/underscores turned
  into spaces and release tags (`1080p`, `WEB-DL`, `x264`, …) cut off:
  `Bluey.S01E03.Keepy.Uppy.1080p.WEB-DL.mkv` → `Bluey - S01E03 - Keepy Uppy`.
- In the app, episodes of a series are listed together, in episode order.
  On the iPad, pick the episode's `.kidsvideo` file.

### What it does
- For each video, runs `kidsvideo prepare` (the Go tool in `tools/kidsvideo/`,
  which `run_prepare.sh` builds when Go is installed), which:
  - picks the **English** audio track if there are several (otherwise the first);
  - keeps each video small, to save space: at most 540p, video at most
    0.7 Mbit/s (H.264), stereo audio at 64 kbit/s, so about 0.35 GB per hour.
    A track already within that is copied (seconds); anything else is
    re-encoded (a film can take a while, done once). Videos prepared earlier at
    720p keep playing: there's no need to prepare them again;
  - writes one `<Title>.kidsvideo` file, all or nothing (`kidsvideo verify
    <file>` checks a file the way the app reads it).
- **Skips** videos already prepared in the destination, so re-running a batch
  is safe.
- Keeps going if one video fails, and prints a summary at the end
  (exit code is non-zero if anything failed).

Batch titles come from the file names, tidied: dots/underscores become spaces and release tags are cut (`Frozen.2.2019.1080p.BluRay.x264-GRP` → `Frozen 2 2019`). For nicer titles in a batch, rename the
files first, or prepare those one at a time with `--title`.

## Commit hygiene (once per clone)
```bash
git config core.hooksPath tools/hooks
```
Before every commit, this checks the staged changes for credentials, personal
data (home-folder paths, email addresses), `.env` files, video files and files
over 2 MB. If `gitleaks` is installed (`brew install gitleaks`) it runs too.

## Lower-level tools
- `tools/bin/kidsvideo prepare [--title T] [--dry-run] --dest DIR <video>` —
  prepares exactly one video; `--dry-run` says, per track, whether it would be
  copied or re-encoded. `run_prepare.sh` calls this. The Go tool also packs and
  checks `.kidsvideo` files, and is planned to take over `run_prepare.sh` and
  `get-packager.sh` too; see `tools/kidsvideo/README.md`.
- `tools/get-packager.sh` — downloads the pinned Shaka Packager into
  `tools/bin/` (gitignored).
- `node tools/real-episode-check.mjs "<Kids Library>/<Title>.kidsvideo"` — adds and plays a
  prepared video in the live app, in your installed Chrome, with a throwaway
  profile and PIN (manual; needs `npm ci --ignore-scripts` once).

## Releases
```bash
git checkout main && git pull
tools/release.sh 1.0.0 --dry-run   # first release: explicit version; preview
tools/release.sh 1.0.0
tools/release.sh minor             # later: major | minor | patch
```
It tags `main`'s current commit (it must have passed CI) and publishes the
GitHub Release with your own `gh` login. **Publishing the release deploys it**:
the site always runs the latest release. Watch the deploy with
`gh run list --workflow deploy.yml --limit 1`; if its live check fails, the
previous release is restored automatically.
