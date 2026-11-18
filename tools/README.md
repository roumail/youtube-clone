# Preparing videos (owner's Mac)

Videos must be prepared once on the Mac before the app can store them
(DESIGN.md §4). Each prepared video becomes a folder of 4 files:

```
Kids Library/The Snowy Day/
  The Snowy Day.mpd   ← the file name is the title shown in the app
  video.mp4
  audio.mp4
  poster.jpg
```

## One-time setup

1. ffmpeg (already installed via Homebrew): `brew install ffmpeg`
2. Tell the tools where your library folder is. Copy the example and edit the
   path (`.env` is gitignored, so your path stays private):
   ```bash
   cp .env.example .env
   # then set, e.g.:
   # KIDS_LIBRARY="$HOME/Library/CloudStorage/GoogleDrive-<you>/My Drive/Kids Library"
   ```
   The folder must exist. Pointing it at your Google Drive folder means
   prepared videos upload automatically and the iPad can pick them from Files.

The pinned Shaka Packager is downloaded automatically on first use
(`tools/get-packager.sh`, checksum-verified).

## `tools/run_prepare.sh` — the everyday command

```bash
tools/run_prepare.sh [--dest DIR] [--title "Clean Title"] [--series "Name"] INPUT...
ls *.mp4 | tools/run_prepare.sh        # paths on stdin, one per line
```

### Put it on your PATH (once)
Link it into a `bin` folder on your PATH, so `run_prepare` works from any
folder. It follows the link back to the repo, so it still finds `.env` (your
`KIDS_LIBRARY`) and the other tools:

```bash
mkdir -p ~/bin
ln -sf ~/home/2_AREAS/work/youtube-clone/tools/run_prepare.sh ~/bin/run_prepare
# if ~/bin isn't on your PATH yet (zsh):
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

| Option | Meaning |
|---|---|
| `INPUT...` | Video files and/or folders. Folders are searched recursively for `.mp4 .m4v .mov .mkv .webm .avi`. With no `INPUT`, paths are read from stdin, one per line (`ls *.mp4 \| run_prepare`). |
| `--dest DIR` | Where prepared folders go. Default: `KIDS_LIBRARY` from the environment or `.env`. |
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
`KIDS_LIBRARY` on Google Drive):
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
  On the iPad, pick the 4 files from inside the episode's folder, as usual.

### What it does
- For each video, runs `tools/prepare.sh`, which:
  - picks the **English** audio track if there are several (otherwise the first);
  - re-encodes only when needed (not H.264 + AAC, or not MP4/MOV), otherwise
    just repackages, which is fast;
  - writes the 4-file folder named after the title.
- **Skips** videos already prepared in the destination, so re-running a batch
  is safe.
- Keeps going if one video fails, and prints a summary at the end
  (exit code is non-zero if anything failed).

Batch titles come from file names. For nicer titles in a batch, rename the
files first, or prepare those one at a time with `--title`.

## Commit hygiene (once per clone)
```bash
git config core.hooksPath tools/hooks
```
Before every commit, this checks the staged changes for credentials, personal
data (home-folder paths, email addresses), `.env` files, video files and files
over 2 MB. If `gitleaks` is installed (`brew install gitleaks`) it runs too.

## Lower-level tools
- `tools/prepare.sh <video> [output-root]` — prepares exactly one video
  (default output: `./prepared`, gitignored). `run_prepare.sh` calls this.
- `tools/get-packager.sh` — downloads the pinned Shaka Packager into
  `tools/bin/` (gitignored).
- `node tools/real-episode-check.mjs "<prepared folder>"` — adds and plays a
  prepared video in the live app, in your installed Chrome, with a throwaway
  profile and PIN (manual; needs `npm ci --ignore-scripts` once).

## Releases
```bash
git checkout main && git pull
tools/release.sh 1.0.0 --dry-run   # first release: explicit version; preview
tools/release.sh 1.0.0
tools/release.sh minor             # later: major | minor | patch
```
It only releases the commit that is live and verified, and creates the tag and
GitHub Release with your own `gh` login.
