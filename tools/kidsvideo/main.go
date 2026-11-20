// kidsvideo: the .kidsvideo container, the only format the app adds. It is an
// uncompressed ustar archive of "<Title>.mpd", poster.jpg, audio.mp4 and
// video.mp4; the app reads the parts straight out of it (app/local-scheme.js).
//
//	kidsvideo pack <prepared-parts-folder>   "<dir>/Frozen 2" -> "<dir>/Frozen 2.kidsvideo"
//	kidsvideo verify <file.kidsvideo>        checks it the way the app reads it
//
// Packing the same parts always gives the same bytes: every header has the
// same time and owner.
package main

import (
	"archive/tar"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const ext = ".kidsvideo"

var parts = []string{"poster.jpg", "audio.mp4", "video.mp4"}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) != 2 || (args[0] != "pack" && args[0] != "verify") {
		fmt.Fprintln(stderr, "usage: kidsvideo pack <prepared-parts-folder> | kidsvideo verify <file.kidsvideo>")
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
	if err := writeArchive(tmp, dir, names); err != nil {
		os.Remove(tmp)
		return "", err
	}
	return "packed: " + out, os.Rename(tmp, out)
}

func writeArchive(path, dir string, names []string) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	w := tar.NewWriter(f)
	for _, name := range names {
		src, err := os.Open(filepath.Join(dir, name))
		if err != nil {
			return err
		}
		info, err := src.Stat()
		if err == nil {
			err = w.WriteHeader(&tar.Header{
				Typeflag: tar.TypeReg, Name: name, Size: info.Size(), Mode: 0o644,
				ModTime: time.Unix(0, 0), Format: tar.FormatUSTAR,
			})
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
	for {
		h, err := r.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", fmt.Errorf("%s isn't a readable %s file", name, ext)
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
