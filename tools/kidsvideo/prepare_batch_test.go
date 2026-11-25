package main

// Stage 3 of README.md: many videos, titles and series. The tools are faked as
// in prepare_test.go.

import (
	"bytes"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// batch: a folder of sources (by relative path) and an existing library.
type batch struct {
	setup
	in string
}

func newBatch(t *testing.T, sources ...string) batch {
	t.Helper()
	s := newSetup(t, smallSource(), "unused.mp4")
	in := filepath.Join(filepath.Dir(s.input), "in")
	for _, name := range sources {
		path := filepath.Join(in, name)
		os.MkdirAll(filepath.Dir(path), 0o755)
		os.WriteFile(path, []byte("source video"), 0o644)
	}
	return batch{setup: s, in: in}
}

func (b batch) run(t *testing.T, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	var out, errOut bytes.Buffer
	code = runWith(append([]string{"prepare"}, args...), &out, &errOut, b.tools)
	return code, out.String(), errOut.String()
}

// library: the .kidsvideo files under dest, as paths relative to it.
func (b batch) library(t *testing.T) []string {
	t.Helper()
	var found []string
	filepath.WalkDir(b.dest, func(path string, d os.DirEntry, err error) error {
		if err == nil && strings.HasSuffix(path, ext) {
			rel, _ := filepath.Rel(b.dest, path)
			found = append(found, rel)
		}
		return nil
	})
	slices.Sort(found)
	return found
}

func TestPrepareSearchesFoldersForVideoFiles(t *testing.T) {
	b := newBatch(t, "b.mp4", "nested/deeper/a.MKV", "c.webm", "d.m4v", "e.mov", "f.avi", "notes.txt", "poster.jpg")
	code, stdout, stderr := b.run(t, "--dest", b.dest, b.in)
	if code != 0 {
		t.Fatalf("code %d, stderr %q", code, stderr)
	}
	want := []string{"a.kidsvideo", "b.kidsvideo", "c.kidsvideo", "d.kidsvideo", "e.kidsvideo", "f.kidsvideo"}
	if got := b.library(t); !slices.Equal(got, want) {
		t.Fatalf("library %v", got)
	}
	// In path order, so a season goes in order.
	if i, j := strings.Index(stdout, "== b"), strings.Index(stdout, "== a"); i < 0 || j < i {
		t.Fatalf("stdout %q", stdout)
	}
	// A file given by name is prepared whatever its extension.
	b = newBatch(t, "clip.ts")
	if code, _, stderr := b.run(t, "--dest", b.dest, filepath.Join(b.in, "clip.ts")); code != 0 {
		t.Fatal(stderr)
	}
}

func TestPrepareReadsPathsFromStdinWhenGivenNone(t *testing.T) {
	b := newBatch(t, "One.mp4", "Two.mp4", "Three.mp4")
	b.tools.stdin = strings.NewReader(filepath.Join(b.in, "One.mp4") + "\n\n" + filepath.Join(b.in, "Two.mp4") + "\r\n")
	if code, _, stderr := b.run(t, "--dest", b.dest); code != 0 {
		t.Fatal(stderr)
	}
	if got := b.library(t); !slices.Equal(got, []string{"One.kidsvideo", "Two.kidsvideo"}) {
		t.Fatalf("library %v", got)
	}
	// Inputs on the command line win; stdin isn't read.
	b = newBatch(t, "One.mp4", "Two.mp4")
	b.tools.stdin = strings.NewReader(filepath.Join(b.in, "Two.mp4") + "\n")
	b.run(t, "--dest", b.dest, filepath.Join(b.in, "One.mp4"))
	if got := b.library(t); !slices.Equal(got, []string{"One.kidsvideo"}) {
		t.Fatalf("library %v", got)
	}
}

func TestPrepareDestinationComesFromDestElseKidsLibraryElseDotEnv(t *testing.T) {
	b := newBatch(t, "Film.mp4")
	film := filepath.Join(b.in, "Film.mp4")
	root := filepath.Dir(b.dest)
	for _, name := range []string{"from-dest", "from-env", "from-dotenv"} {
		os.Mkdir(filepath.Join(root, name), 0o755)
	}
	dotEnv := filepath.Join(root, ".env")
	os.WriteFile(dotEnv, []byte("# comment\nRUN_PREPARE_TMUX=1\nexport KIDS_LIBRARY=\"$ROOT/from-dotenv\"\n"), 0o644)
	env := map[string]string{"ROOT": root, "KIDS_LIBRARY": filepath.Join(root, "from-env")}
	b.tools.getenv = func(k string) string { return env[k] }
	b.tools.dotEnv = dotEnv
	where := func(args ...string) string {
		t.Helper()
		code, stdout, stderr := b.run(t, append(args, film)...)
		if code != 0 {
			t.Fatalf("code %d, stderr %q", code, stderr)
		}
		for _, name := range []string{"from-dest", "from-env", "from-dotenv"} {
			if _, err := os.Stat(filepath.Join(root, name, "Film.kidsvideo")); err == nil {
				os.Remove(filepath.Join(root, name, "Film.kidsvideo"))
				if !strings.Contains(stdout, "→ "+filepath.Join(root, name)) {
					t.Fatalf("summary %q", stdout)
				}
				return name
			}
		}
		return ""
	}
	if got := where("--dest", filepath.Join(root, "from-dest")); got != "from-dest" {
		t.Fatalf("--dest: went to %q", got)
	}
	if got := where(); got != "from-env" {
		t.Fatalf("KIDS_LIBRARY: went to %q", got)
	}
	delete(env, "KIDS_LIBRARY")
	if got := where(); got != "from-dotenv" {
		t.Fatalf(".env: went to %q", got)
	}
	// Single quotes: no expansion.
	os.WriteFile(dotEnv, []byte("KIDS_LIBRARY='$ROOT/from-dotenv'\n"), 0o644)
	if got := dotEnvValue(dotEnv, "KIDS_LIBRARY", b.tools.getenv); got != "$ROOT/from-dotenv" {
		t.Fatalf("single quotes: %q", got)
	}
	// None of them: the tool says so and stops.
	b.tools.dotEnv = filepath.Join(root, "missing.env")
	code, _, stderr := b.run(t, film)
	if code != 2 || !strings.Contains(stderr, "no destination") {
		t.Fatalf("code %d, stderr %q", code, stderr)
	}
	// A destination that doesn't exist isn't created (a typo, a drive not mounted).
	code, _, stderr = b.run(t, "--dest", filepath.Join(root, "typo"), film)
	if _, err := os.Stat(filepath.Join(root, "typo")); code != 1 || !strings.Contains(stderr, "does not exist") || err == nil {
		t.Fatalf("code %d, stderr %q", code, stderr)
	}
}

func TestPrepareTidiesTheTitleFromTheFileName(t *testing.T) {
	for name, want := range map[string]string{
		"Frozen.2.2019.1080p.BluRay.1400MB.DD5.1.x264-GalaxyRG": "Frozen 2 2019",
		"[GRP] Some_Film 720p":      "Some Film",
		"Mr. Bean":                  "Mr. Bean",
		"Bluey - Keepy Uppy":        "Bluey - Keepy Uppy",
		"The.Snowy.Day.2016.WEB-DL": "The Snowy Day 2016",
		"Show - S01E03":             "Show - S01E03",
		"raw-vp9":                   "raw-vp9",
	} {
		if got := tidy(name); got != want {
			t.Errorf("tidy(%q) = %q, want %q", name, got, want)
		}
	}
	b := newBatch(t, "Frozen.2.2019.1080p.BluRay.x264-GRP.mkv", "1080p.mp4")
	if code, _, stderr := b.run(t, "--dest", b.dest, b.in); code != 0 {
		t.Fatal(stderr)
	}
	// A name that tidies to nothing keeps the file name.
	if got := b.library(t); !slices.Equal(got, []string{"1080p.kidsvideo", "Frozen 2 2019.kidsvideo"}) {
		t.Fatalf("library %v", got)
	}
}

func TestPrepareTitleOptionNamesASingleInput(t *testing.T) {
	b := newBatch(t, "snowy.day.2016.1080p.mkv", "other.mp4")
	if code, _, stderr := b.run(t, "--title", "The Snowy Day", "--dest", b.dest, filepath.Join(b.in, "snowy.day.2016.1080p.mkv")); code != 0 {
		t.Fatal(stderr)
	}
	if got := b.library(t); !slices.Equal(got, []string{"The Snowy Day.kidsvideo"}) {
		t.Fatalf("library %v", got)
	}
	code, _, stderr := b.run(t, "--title", "Both", "--dest", b.dest, b.in)
	if code != 2 || !strings.Contains(stderr, "--title names a single video (got 2)") {
		t.Fatalf("code %d, stderr %q", code, stderr)
	}
	// Options may also come after the inputs.
	b = newBatch(t, "x.mp4")
	if code, _, stderr := b.run(t, filepath.Join(b.in, "x.mp4"), "--dest", b.dest, "--title", "After"); code != 0 {
		t.Fatal(stderr)
	}
	if got := b.library(t); !slices.Equal(got, []string{"After.kidsvideo"}) {
		t.Fatalf("library %v", got)
	}
}

func TestPrepareSeriesNamesEpisodesAndFilesThemInTheSeriesFolder(t *testing.T) {
	b := newBatch(t,
		"Bluey.S01E03.Hospital.1080p.WEB.mkv",
		"bluey s2e10 - Dance Mode.mp4",
		"Bluey 1x05.mp4",
	)
	if code, _, stderr := b.run(t, "--series", "Bluey", "--dest", b.dest, b.in); code != 0 {
		t.Fatal(stderr)
	}
	want := []string{
		filepath.Join("Bluey", "Bluey - S01E03 - Hospital.kidsvideo"),
		filepath.Join("Bluey", "Bluey - S01E05.kidsvideo"),
		filepath.Join("Bluey", "Bluey - S02E10 - Dance Mode.kidsvideo"),
	}
	if got := b.library(t); !slices.Equal(got, want) {
		t.Fatalf("library %v", got)
	}
	// With --series, --title names the single episode.
	b = newBatch(t, "ep S03E01.mp4")
	b.run(t, "--series", "Bluey", "--title", "Stickbird", "--dest", b.dest, filepath.Join(b.in, "ep S03E01.mp4"))
	if got := b.library(t); !slices.Equal(got, []string{filepath.Join("Bluey", "Bluey - S03E01 - Stickbird.kidsvideo")}) {
		t.Fatalf("library %v", got)
	}
}

func TestPrepareSeriesRefusesAFileWithoutSeasonAndEpisode(t *testing.T) {
	b := newBatch(t, "Bluey S01E01.mp4", "Bluey Special.mp4", "Bluey 2019.mp4")
	code, stdout, stderr := b.run(t, "--series", "Bluey", "--dest", b.dest, b.in)
	if code != 1 {
		t.Fatalf("code %d", code)
	}
	if got := b.library(t); !slices.Equal(got, []string{filepath.Join("Bluey", "Bluey - S01E01.kidsvideo")}) {
		t.Fatalf("library %v", got)
	}
	for _, name := range []string{"Bluey Special.mp4", "Bluey 2019.mp4"} {
		if !strings.Contains(stderr, "no season and episode (e.g. S01E03) in the file name: "+filepath.Join(b.in, name)) ||
			!strings.Contains(stdout, "FAILED: "+filepath.Join(b.in, name)) {
			t.Fatalf("%s: stdout %q, stderr %q", name, stdout, stderr)
		}
	}
}

func TestPrepareBatchGoesOnAfterAFailureAndEndsWithASummary(t *testing.T) {
	b := newBatch(t, "A.mp4", "B.mp4", "C.mp4")
	os.WriteFile(filepath.Join(b.dest, "C.kidsvideo"), []byte("already"), 0o644)
	// B is refused (no audio); A is prepared, C is already there.
	b.tools.r = &perFile{fakeTools: b.fake, silent: "B.mp4"}
	missing := filepath.Join(b.in, "gone.mp4")
	code, stdout, stderr := b.run(t, "--dest", b.dest, b.in, missing)
	if code != 1 {
		t.Fatalf("code %d", code)
	}
	if !strings.Contains(stderr, "no audio track") || !strings.Contains(stderr, "not found: "+missing) {
		t.Fatalf("stderr %q", stderr)
	}
	lines := strings.Split(strings.TrimSpace(stdout), "\n")
	summary := "prepared: 1   skipped (already there): 1   failed: 2   → " + b.dest
	tail := []string{summary, "   FAILED: " + missing, "   FAILED: " + filepath.Join(b.in, "B.mp4")}
	if len(lines) < 3 || !slices.Equal(lines[len(lines)-3:], tail) {
		t.Fatalf("stdout ends %q", lines)
	}
	if got := b.library(t); !slices.Equal(got, []string{"A.kidsvideo", "C.kidsvideo"}) {
		t.Fatalf("library %v", got)
	}
	// All well: exit 0. A dry run says what it would do.
	b = newBatch(t, "A.mp4")
	code, stdout, _ = b.run(t, "--dry-run", "--dest", b.dest, b.in)
	if code != 0 || !strings.Contains(stdout, "would prepare: 1   skipped (already there): 0   failed: 0") || len(b.library(t)) != 0 {
		t.Fatalf("code %d, stdout %q", code, stdout)
	}
	// Nothing to prepare.
	b = newBatch(t, "notes.txt")
	if code, _, stderr := b.run(t, "--dest", b.dest, b.in); code != 1 || !strings.Contains(stderr, "no video files found") {
		t.Fatalf("code %d, stderr %q", code, stderr)
	}
}

// perFile: the fake tools, but ffprobe finds no audio in one file.
type perFile struct {
	*fakeTools
	silent string
}

func (p *perFile) output(name string, args ...string) ([]byte, error) {
	if filepath.Base(args[len(args)-1]) == p.silent {
		source := smallSource()
		source.Streams = source.Streams[:1]
		saved := p.source
		p.source = source
		defer func() { p.source = saved }()
	}
	return p.fakeTools.output(name, args...)
}
