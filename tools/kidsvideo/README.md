# kidsvideo: the preparation tool, in Go

One program that turns a source video into the `.kidsvideo` file the app adds,
the same way on a Mac and on Linux (and in the Docker image). It grows in
stages; each stage replaces a shell script, which is deleted once that stage's
tests pass on the synthetic fixtures (`fixtures/generate.sh`).

**Built today:** stages 1–3 (tests: `main_test.go`, `prepare_test.go`,
`prepare_batch_test.go`, with ffprobe, ffmpeg and the packager faked; the real
ones run in CI through `fixtures/generate.sh`). Stage 4 is specified, not
built: its tests are in `prepare_spec_test.go` and skip with "not built yet"
(the Go equivalent of the app's `test.fixme`). Building a stage means removing those skips and
implementing until `go test` is green.

| Stage | Command | Replaces | Status |
|---|---|---|---|
| 1 | `kidsvideo pack <parts-folder>`, `kidsvideo verify <file>` | `tools/pack.sh` | built |
| 2 | `kidsvideo prepare --dest DIR <video>` | `tools/prepare.sh` (deleted) | built |
| 3 | `kidsvideo prepare <videos and folders…>` with titles and series | the work of `tools/run_prepare.sh` (now a launcher: see below) | built |
| 4 | the pinned Shaka Packager, downloaded and checked by the tool | `tools/get-packager.sh` | specified |

## Stage 2: prepare one video

`kidsvideo prepare [--title T] [--dry-run] --dest DIR <video>` writes
`DIR/<Title>.kidsvideo` (format 2, as `pack` writes it). It calls `ffprobe`,
`ffmpeg` and Shaka Packager as programs; it does not reimplement them.

- **Audio track:** the first English one (language en / eng / english),
  otherwise the first. A video without audio is refused.
- **Size target** (minimal storage, about 0.35 GB per hour): video H.264 at
  most 540p and 0.7 Mbit/s; audio AAC stereo at 64 kbit/s. (Until v5.2 it was
  720p / 1.2 Mbit/s / 96 kbit/s; files made then keep playing, so a library can
  mix both.) A track already within it is copied;
  anything else is re-encoded. An unknown bitrate counts as above the target.
  A container other than mp4 / m4v / mov is always re-encoded.
- **Parts:** `video.mp4` and `audio.mp4` from Shaka Packager, `<Title>.mpd`,
  and `poster.jpg` from 10% into the video, 640 pixels wide.
- **Already there:** a title whose `.kidsvideo` exists in DIR is skipped.
- **All or nothing:** work happens in a temporary folder and the finished file
  is moved into DIR in one step; a failed or interrupted run leaves nothing.
- **`--dry-run`:** prints, per track, whether it would be copied or
  re-encoded and why, and writes nothing.
- **Progress:** a re-encode shows percentage, time done / total and ETA on a
  terminal; without a terminal (CI, logs) it prints only start and end lines.

## Stage 3: many videos, titles and series

`kidsvideo prepare [--dest DIR] [--title T] [--series NAME] <videos and folders…>`

- **Inputs:** files and folders; folders are searched recursively for
  .mp4 .m4v .mov .mkv .webm .avi, in path order. A file given by name is
  prepared whatever its extension. With no inputs, paths are read from stdin,
  one per line. Options may come before or after the inputs.
- **Destination:** `--dest`, else `KIDS_LIBRARY` from the environment, else
  from the repo's `.env` (two folders up from `tools/bin/kidsvideo`). None of
  them: the tool says so and stops. It must exist: a typo or a drive that
  isn't mounted is refused, not created.
- **Titles:** the file name tidied ("Frozen.2.2019.1080p.BluRay.x264-GRP" →
  "Frozen 2 2019"); `--title` sets it for a single input.
- **Series:** with `--series NAME`, each file name must carry its season and
  episode (S01E03, s1e3, 1x03); the title becomes
  "NAME - S01E03 - Episode title" and the file goes in `DIR/NAME/`. A file
  without them is refused by name; the others go on.
- **Batch:** one failure (including an input that isn't there) doesn't stop
  the rest. Each video starts with `== <Title>`; the summary is
  `prepared: N   skipped (already there): N   failed: N   → DIR` (with
  `--dry-run`: `would prepare: N …`), then one `FAILED: <path>` line per
  failure, and the exit code is non-zero when anything failed.

Long jobs: the Go tool doesn't detach itself. `tools/run_prepare.sh` stays as
a thin launcher: it builds the tool when Go is installed, fetches the pinned
packager (until stage 4), and with `--tmux` (or `RUN_PREPARE_TMUX=1` in
`.env`) runs `kidsvideo prepare` in a detached tmux session, passing on this
shell's `KIDS_LIBRARY`; every other option goes to the tool unchanged.

## Stage 4: Shaka Packager

The tool finds the packager at `PACKAGER`, else `tools/bin/packager`. When it's
missing, it downloads the pinned version for this computer (Mac arm64, Linux
x64 / arm64) and checks its SHA-256 before using it; a mismatch is refused and
nothing is kept. The pins live in the tool, so a bump changes the pin only.

## Not part of this tool

From the earlier design notes, deliberately left out: cloud storage
destinations (the library folder can be a synced folder, such as Google Drive
for desktop), files named by their hash with a separate manifest
(`kidsvideo.json` carries the format and title), and several quality levels
per video (one size target).

## Working on it

`gofmt -l .`, `go vet ./...` and `go test ./...` in this folder; CI runs the
same (the `kidsvideo` job). Go version: `go.mod`.
