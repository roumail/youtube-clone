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
tools/run_prepare.sh [--dest DIR] [--title "Clean Title"] INPUT...
```

| Option | Meaning |
|---|---|
| `INPUT...` | Video files and/or folders. Folders are searched recursively for `.mp4 .m4v .mov .mkv .webm .avi`. |
| `--dest DIR` | Where prepared folders go. Default: `KIDS_LIBRARY` from the environment or `.env`. |
| `--title "…"` | Clean title for a **single** file (instead of its file name). |

### Examples

One file, with a clean title (handy for long download names):
```bash
tools/run_prepare.sh --title "The Snowy Day" ~/Downloads/The.Snowy.Day.2016.1080p.WEB-DL.mkv
```

One file, title taken from the file name:
```bash
tools/run_prepare.sh "~/Videos/Bluey - Keepy Uppy.mp4"
```

A whole folder (batch):
```bash
tools/run_prepare.sh ~/Videos/Bluey/
```

Several files and folders at once, into a different destination:
```bash
tools/run_prepare.sh --dest ~/Desktop/test-library ep1.mp4 ep2.mkv ~/Videos/Specials/
```

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

## Lower-level tools
- `tools/prepare.sh <video> [output-root]` — prepares exactly one video
  (default output: `./prepared`, gitignored). `run_prepare.sh` calls this.
- `tools/get-packager.sh` — downloads the pinned Shaka Packager into
  `tools/bin/` (gitignored).
- `node tools/real-episode-check.mjs "<prepared folder>"` — stores and plays a
  prepared video in your local Chrome to check it end to end (manual; needs
  `npm ci` once).
