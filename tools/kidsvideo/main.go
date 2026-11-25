// kidsvideo: the .kidsvideo container, the only format the app adds. Format 2
// is an uncompressed ustar archive of kidsvideo.json ({"format":2,"title":…},
// always first), "<Title>.mpd", poster.jpg, audio.mp4 and video.mp4; the app
// reads the parts straight out of it (app/local-scheme.js) and refuses files
// made by older tools, which have no kidsvideo.json.
//
//	kidsvideo prepare [--dest DIR] <videos and folders…>   source videos -> "DIR/<Title>.kidsvideo" (prepare.go)
//	kidsvideo pack <prepared-parts-folder>   "<dir>/Frozen 2" -> "<dir>/Frozen 2.kidsvideo"
//	kidsvideo verify <file.kidsvideo>        checks it the way the app reads it
//
// Packing the same parts always gives the same bytes: every header has the
// same time and owner.
package main

import (
	"archive/tar"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	ext    = ".kidsvideo"
	meta   = "kidsvideo.json"
	format = 2
)

type metadata struct {
	Format int    `json:"format"`
	Title  string `json:"title"`
}

var parts = []string{"poster.jpg", "audio.mp4", "video.mp4"}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

const usage = "usage: kidsvideo prepare [--dest DIR] [--title T] [--series NAME] [--dry-run] <videos and folders…> | kidsvideo pack <prepared-parts-folder> | kidsvideo verify <file.kidsvideo>"

func run(args []string, stdout, stderr io.Writer) int {
	return runWith(args, stdout, stderr, realTools())
}

func runWith(args []string, stdout, stderr io.Writer, tools toolset) int {
	if len(args) > 0 && args[0] == "prepare" {
		return runPrepare(args[1:], stdout, stderr, tools)
	}
	if len(args) != 2 || (args[0] != "pack" && args[0] != "verify") {
		fmt.Fprintln(stderr, usage)
		return 2
	}
	var msg string
	var err error
	if args[0] == "pack" {
		msg, err = pack(args[1])
	} else {
		msg, err = verify(args[1])
	}
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	fmt.Fprintln(stdout, msg)
	return 0
}

func pack(dir string) (string, error) {
	dir = filepath.Clean(dir)
	title := filepath.Base(dir)
	names := append([]string{title + ".mpd"}, parts...)
	for _, name := range names {
		if info, err := os.Stat(filepath.Join(dir, name)); err != nil || !info.Mode().IsRegular() {
			return "", fmt.Errorf("not a prepared video folder (missing %s): %s", name, dir)
		}
	}
	// The tar name field holds 100 bytes: "<Title>.mpd" and its closing NUL must fit.
	if len(title) > 95 {
		return "", fmt.Errorf("title too long for the container (max 95 bytes; an accented letter counts as 2): %s", title)
	}
	out := filepath.Join(filepath.Dir(dir), title+ext)
	tmp := out + ".partial"
	if err := writeArchive(tmp, dir, title, names); err != nil {
		os.Remove(tmp)
		return "", err
	}
	return "packed: " + out, os.Rename(tmp, out)
}

func writeArchive(path, dir, title string, names []string) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	w := tar.NewWriter(f)
	body, err := json.Marshal(metadata{Format: format, Title: title})
	if err != nil {
		return err
	}
	body = append(body, '\n')
	if err := w.WriteHeader(header(meta, int64(len(body)))); err != nil {
		return err
	}
	if _, err := w.Write(body); err != nil {
		return err
	}
	for _, name := range names {
		src, err := os.Open(filepath.Join(dir, name))
		if err != nil {
			return err
		}
		info, err := src.Stat()
		if err == nil {
			err = w.WriteHeader(header(name, info.Size()))
		}
		if err == nil {
			_, err = io.Copy(w, src)
		}
		src.Close()
		if err != nil {
			return err
		}
	}
	if err := w.Close(); err != nil {
		return err
	}
	return f.Sync()
}

func header(name string, size int64) *tar.Header {
	return &tar.Header{
		Typeflag: tar.TypeReg, Name: name, Size: size, Mode: 0o644,
		ModTime: time.Unix(0, 0), Format: tar.FormatUSTAR,
	}
}

func verify(path string) (string, error) {
	name := filepath.Base(path)
	if !strings.HasSuffix(strings.ToLower(name), ext) {
		return "", fmt.Errorf("%s isn't a %s file", name, ext)
	}
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	r := tar.NewReader(f)
	var manifests []string
	found := map[string]bool{}
	for first := true; ; first = false {
		h, err := r.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", fmt.Errorf("%s isn't a readable %s file", name, ext)
		}
		if first {
			var m metadata
			if h.Name != meta || json.NewDecoder(r).Decode(&m) != nil || m.Format != format {
				return "", fmt.Errorf("%s was made by an older version of the tools: prepare it again", name)
			}
			continue
		}
		found[h.Name] = true
		if strings.HasSuffix(strings.ToLower(h.Name), ".mpd") {
			manifests = append(manifests, h.Name)
		}
	}
	if len(found) == 0 {
		return "", fmt.Errorf("%s isn't a readable %s file", name, ext)
	}
	if len(manifests) != 1 {
		return "", fmt.Errorf("expected exactly one .mpd file, got %d", len(manifests))
	}
	var missing []string
	for _, p := range parts {
		if !found[p] {
			missing = append(missing, p)
		}
	}
	if len(missing) > 0 {
		return "", fmt.Errorf("missing: %s", strings.Join(missing, ", "))
	}
	return fmt.Sprintf("ok: %q (%d parts)", strings.TrimSuffix(manifests[0], filepath.Ext(manifests[0])), len(found)), nil
}
