#!/usr/bin/env bash
# Internal step of prepare.sh: pack the 4 prepared parts into ONE file, the
# only format the app adds:
#
#   tools/pack.sh "<dir>/Frozen 2"   ->  "<dir>/Frozen 2.kidsvideo"
#
# The folder must hold "<Title>.mpd", video.mp4, audio.mp4 and poster.jpg (what
# prepare.sh makes). The .kidsvideo is a plain, uncompressed tar (ustar) of
# exactly those 4 files; the app reads the parts straight out of it.
set -euo pipefail

[[ $# -eq 1 ]] || { echo "usage: $0 <prepared-parts-folder>" >&2; exit 2; }

DIR="${1%/}"
TITLE="$(basename "$DIR")"
OUT="$(dirname "$DIR")/$TITLE.kidsvideo"
for f in "$TITLE.mpd" video.mp4 audio.mp4 poster.jpg; do
  [[ -f "$DIR/$f" ]] || { echo "not a prepared video folder (missing $f): $DIR" >&2; exit 1; }
done
# The tar name field holds 100 bytes: "<Title>.mpd" and its closing NUL must fit.
(( $(printf '%s' "$TITLE" | wc -c) <= 95 )) || { echo "title too long for the container (max 95 bytes; an accented letter counts as 2): $TITLE" >&2; exit 1; }

TMP="$OUT.partial"
# ustar, no macOS metadata (._ files / xattrs): a plain archive any tar reads.
COPYFILE_DISABLE=1 tar --format=ustar -cf "$TMP" -C "$DIR" "$TITLE.mpd" poster.jpg audio.mp4 video.mp4
mv "$TMP" "$OUT"
echo "packed: $OUT ($(du -h "$OUT" | cut -f1))"
