package main

import (
	"archive/tar"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// A prepared video folder as prepare.sh leaves it: "<Title>.mpd" and the three parts.
func preparedFolder(t *testing.T, title string) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), title)
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{
		title + ".mpd": "<MPD/>",
		"poster.jpg":   "poster",
		"audio.mp4":    "audio bytes",
		"video.mp4":    strings.Repeat("video bytes ", 100),
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func cli(args ...string) (code int, stdout, stderr string) {
	var out, errOut bytes.Buffer
	code = run(args, &out, &errOut)
	return code, out.String(), errOut.String()
}

func TestPackThenVerify(t *testing.T) {
	dir := preparedFolder(t, "Show - S01E03")
	file := filepath.Join(filepath.Dir(dir), "Show - S01E03.kidsvideo")

	code, stdout, stderr := cli("pack", dir)
	if code != 0 || stdout != "packed: "+file+"\n" || stderr != "" {
		t.Fatalf("pack: code %d, stdout %q, stderr %q", code, stdout, stderr)
	}
	code, stdout, stderr = cli("verify", file)
	if code != 0 || stdout != "ok: \"Show - S01E03\" (4 parts)\n" || stderr != "" {
		t.Fatalf("verify: code %d, stdout %q, stderr %q", code, stdout, stderr)
	}
}

func TestPackWritesThePartsInOrderAsPlainUstarWithFixedTimesAndOwners(t *testing.T) {
	dir := preparedFolder(t, "Frozen 2")
	if code, _, stderr := cli("pack", dir); code != 0 {
		t.Fatalf("pack: %s", stderr)
	}
	data, err := os.ReadFile(filepath.Join(filepath.Dir(dir), "Frozen 2.kidsvideo"))
	if err != nil {
		t.Fatal(err)
	}
	if got := string(data[257:263]); got != "ustar\x00" {
		t.Fatalf("magic %q, want %q", got, "ustar\x00")
	}
	r := tar.NewReader(bytes.NewReader(data))
	var names []string
	for {
		h, err := r.Next()
		if err != nil {
			break
		}
		names = append(names, h.Name)
		if !h.ModTime.Equal(time.Unix(0, 0)) || h.Uid != 0 || h.Gid != 0 || h.Uname != "" || h.Gname != "" || h.Mode != 0o644 || h.Typeflag != tar.TypeReg {
			t.Fatalf("%s: header %+v", h.Name, h)
		}
	}
	want := []string{"Frozen 2.mpd", "poster.jpg", "audio.mp4", "video.mp4"}
	if strings.Join(names, "|") != strings.Join(want, "|") {
		t.Fatalf("parts %q, want %q", names, want)
	}
}

func TestPackingTheSamePartsTwiceGivesTheSameBytes(t *testing.T) {
	dir := preparedFolder(t, "Tiny")
	file := filepath.Join(filepath.Dir(dir), "Tiny.kidsvideo")
	cli("pack", dir)
	first, _ := os.ReadFile(file)
	later := time.Now().Add(time.Hour)
	for _, name := range []string{"Tiny.mpd", "poster.jpg", "audio.mp4", "video.mp4"} {
		os.Chtimes(filepath.Join(dir, name), later, later)
	}
	os.Remove(file)
	cli("pack", dir)
	second, _ := os.ReadFile(file)
	if len(first) == 0 || !bytes.Equal(first, second) {
		t.Fatalf("packing again gave different bytes (%d vs %d)", len(first), len(second))
	}
}

func TestPackRefuses(t *testing.T) {
	accented := "The Longest Title Allowed - A Café About Many Long Words That Keeps Going Until It Finally Ends" // 95 characters, 96 bytes
	for _, c := range []struct {
		name, title, remove, want string
	}{
		{"a missing part", "Tiny", "audio.mp4", "not a prepared video folder (missing audio.mp4): %s"},
		{"a title over 95 bytes", accented, "", "title too long for the container (max 95 bytes; an accented letter counts as 2): " + accented},
	} {
		t.Run(c.name, func(t *testing.T) {
			dir := preparedFolder(t, c.title)
			if c.remove != "" {
				os.Remove(filepath.Join(dir, c.remove))
			}
			code, stdout, stderr := cli("pack", dir)
			want := c.want
			if strings.Contains(want, "%s") {
				want = strings.Replace(want, "%s", dir, 1)
			}
			if code != 1 || stdout != "" || stderr != want+"\n" {
				t.Fatalf("code %d, stdout %q, stderr %q; want stderr %q", code, stdout, stderr, want+"\n")
			}
			if left, _ := filepath.Glob(filepath.Join(filepath.Dir(dir), "*.kidsvideo*")); len(left) != 0 {
				t.Fatalf("left behind: %q", left)
			}
		})
	}
}

// The same refusals, in the same words, as the app (app/local-scheme.js).
func TestVerifyRefuses(t *testing.T) {
	archive := func(t *testing.T, parts ...string) []byte {
		var buf bytes.Buffer
		w := tar.NewWriter(&buf)
		for _, p := range parts {
			w.WriteHeader(&tar.Header{Name: p, Mode: 0o644, Size: 4, Format: tar.FormatUSTAR})
			w.Write([]byte("data"))
		}
		w.Close()
		return buf.Bytes()
	}
	for _, c := range []struct {
		name, file string
		data       func(t *testing.T) []byte
		want       string
	}{
		{"not a .kidsvideo", "photo.jpg", func(t *testing.T) []byte { return []byte("jpeg") }, "photo.jpg isn't a .kidsvideo file"},
		{"not a tar inside", "photo.kidsvideo", func(t *testing.T) []byte { return bytes.Repeat([]byte("x"), 2048) }, "photo.kidsvideo isn't a readable .kidsvideo file"},
		{"no manifest", "x.kidsvideo", func(t *testing.T) []byte { return archive(t, "poster.jpg", "audio.mp4", "video.mp4") }, "expected exactly one .mpd file, got 0"},
		{"a part missing", "x.kidsvideo", func(t *testing.T) []byte { return archive(t, "x.mpd", "poster.jpg", "video.mp4") }, "missing: audio.mp4"},
	} {
		t.Run(c.name, func(t *testing.T) {
			file := filepath.Join(t.TempDir(), c.file)
			os.WriteFile(file, c.data(t), 0o644)
			code, stdout, stderr := cli("verify", file)
			if code != 1 || stdout != "" || stderr != c.want+"\n" {
				t.Fatalf("code %d, stdout %q, stderr %q; want stderr %q", code, stdout, stderr, c.want+"\n")
			}
		})
	}
}

func TestUsage(t *testing.T) {
	code, stdout, stderr := cli("unpack")
	if code != 2 || stdout != "" || stderr != "usage: kidsvideo pack <prepared-parts-folder> | kidsvideo verify <file.kidsvideo>\n" {
		t.Fatalf("code %d, stdout %q, stderr %q", code, stdout, stderr)
	}
}
