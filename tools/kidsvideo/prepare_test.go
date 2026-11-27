package main

// Stage 2 of README.md: kidsvideo prepare. ffprobe, ffmpeg and Shaka Packager
// are faked: the fake answers ffprobe with a described source and makes the
// files ffmpeg and the packager would make, so prepare runs end to end here.
// The real tools run in CI through fixtures/generate.sh.

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

type fakeTools struct {
	source probed
	fail   string // "ffmpeg" or "packager": that tool fails
	calls  [][]string
}

func (f *fakeTools) output(name string, args ...string) ([]byte, error) {
	f.calls = append(f.calls, append([]string{name}, args...))
	return json.Marshal(f.source)
}

func (f *fakeTools) run(name string, stdout io.Writer, args ...string) error {
	name = filepath.Base(name) // the packager is called by its path
	f.calls = append(f.calls, append([]string{name}, args...))
	if name == f.fail {
		return errors.New("exit status 1")
	}
	write := func(path string) { os.WriteFile(path, []byte(name+" output"), 0o644) }
	switch name {
	case "ffmpeg":
		write(args[len(args)-1])
		if slices.Contains(args, "-progress") {
			io.WriteString(stdout, "out_time_us=1500000\nprogress=continue\nout_time_us=3000000\nprogress=end\n")
		}
	case "packager":
		for i, a := range args {
			if _, out, ok := strings.Cut(a, "output="); ok {
				write(out)
			}
			if a == "--mpd_output" {
				write(args[i+1])
			}
		}
	}
	return nil
}

func (f *fakeTools) called(tool string) [][]string {
	var found [][]string
	for _, c := range f.calls {
		if c[0] == tool {
			found = append(found, c[1:])
		}
	}
	return found
}

// A source within the size target: H.264 360p at 0.5 Mbit/s, AAC stereo 64 kbit/s.
func smallSource() probed {
	var p probed
	p.Streams = []stream{
		{Index: 0, CodecType: "video", CodecName: "h264", Height: 360, BitRate: "500000"},
		{Index: 1, CodecType: "audio", CodecName: "aac", Channels: 2, BitRate: "64000"},
	}
	p.Format.Duration = "30.0"
	return p
}

// A film-like source: 1080p at 5 Mbit/s, 5.1 audio at 384 kbit/s.
func bigSource() probed {
	p := smallSource()
	p.Streams[0].Height, p.Streams[0].BitRate = 1080, "5000000"
	p.Streams[1].Channels, p.Streams[1].BitRate = 6, "384000"
	return p
}

type setup struct {
	fake         *fakeTools
	tools        toolset
	input, dest  string
	progressSeen *bytes.Buffer
}

func newSetup(t *testing.T, source probed, inputName string) setup {
	t.Helper()
	dir := t.TempDir()
	input := filepath.Join(dir, inputName)
	os.WriteFile(input, []byte("source video"), 0o644)
	packager := filepath.Join(dir, "packager")
	os.WriteFile(packager, nil, 0o755)
	fake := &fakeTools{source: source}
	dest := filepath.Join(dir, "Kids Library")
	os.Mkdir(dest, 0o755)
	return setup{
		fake:  fake,
		tools: toolset{ffmpeg: "ffmpeg", ffprobe: "ffprobe", packager: packager, r: fake},
		input: input, dest: dest,
	}
}

func (s setup) prepare(t *testing.T, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	var out, errOut bytes.Buffer
	code = runWith(append(append([]string{"prepare"}, args...), "--dest", s.dest, s.input), &out, &errOut, s.tools)
	return code, out.String(), errOut.String()
}

func entries(t *testing.T, dir string) []string {
	t.Helper()
	list, _ := os.ReadDir(dir)
	var names []string
	for _, e := range list {
		names = append(names, e.Name())
	}
	return names
}

func reencodeArgs(t *testing.T, f *fakeTools) []string {
	t.Helper()
	for _, c := range f.called("ffmpeg") {
		if slices.Contains(c, "-map") {
			return c
		}
	}
	t.Fatal("no re-encode")
	return nil
}

func TestPrepareWritesOneFormat2FileNamedAfterTheTitle(t *testing.T) {
	s := newSetup(t, smallSource(), "The Snowy Day.mp4")
	code, stdout, stderr := s.prepare(t)
	if code != 0 {
		t.Fatalf("code %d, stderr %q", code, stderr)
	}
	out := filepath.Join(s.dest, "The Snowy Day.kidsvideo")
	if got := entries(t, s.dest); !slices.Equal(got, []string{"The Snowy Day.kidsvideo"}) {
		t.Fatalf("dest holds %v", got)
	}
	if msg, err := verify(out); err != nil || !strings.Contains(msg, `"The Snowy Day"`) {
		t.Fatalf("verify: %q, %v", msg, err)
	}
	if !strings.Contains(stdout, "prepared: "+out) {
		t.Fatalf("stdout %q", stdout)
	}
}

func TestPrepareTakesATitleWithACommaOrEquals(t *testing.T) {
	s := newSetup(t, smallSource(), "in.mp4")
	if code, _, stderr := s.prepare(t, "--title", "Song (A, B) x=y"); code != 0 {
		t.Fatal(stderr)
	}
	// The packager is given plain paths: its stream descriptors are comma-separated.
	for _, a := range s.fake.called("packager")[0] {
		if strings.Contains(a, "Song") {
			t.Fatalf("packager argument %q carries the title", a)
		}
	}
	if _, err := os.Stat(filepath.Join(s.dest, "Song (A, B) x=y"+ext)); err != nil {
		t.Fatal(err)
	}
}

func TestPrepareTitleOptionNamesTheFile(t *testing.T) {
	s := newSetup(t, smallSource(), "snowy.day.2016.1080p.mkv")
	if code, _, stderr := s.prepare(t, "--title", "The Snowy Day"); code != 0 {
		t.Fatal(stderr)
	}
	if got := entries(t, s.dest); !slices.Equal(got, []string{"The Snowy Day.kidsvideo"}) {
		t.Fatalf("dest holds %v", got)
	}
}

func TestPrepareUsesTheFirstEnglishAudioTrackElseTheFirst(t *testing.T) {
	audio := func(index int, lang string) stream {
		return stream{Index: index, CodecType: "audio", CodecName: "aac", Channels: 2, BitRate: "64000", Tags: map[string]string{"language": lang}}
	}
	video := stream{Index: 0, CodecType: "video"}
	for _, c := range []struct {
		streams []stream
		want    int
	}{
		{[]stream{video, audio(1, "zho"), audio(2, "eng")}, 2},
		{[]stream{video, audio(1, "fra"), audio(2, "English")}, 2},
		{[]stream{video, audio(1, "zho"), audio(2, "fra")}, 1},
		{[]stream{video, audio(1, ""), audio(2, "en")}, 2},
	} {
		got, _, err := pickAudio(c.streams)
		if err != nil || got.Index != c.want {
			t.Fatalf("%v: got stream %d (%v), want %d", c.streams, got.Index, err, c.want)
		}
	}
}

func TestPrepareRefusesAVideoWithoutAudio(t *testing.T) {
	source := smallSource()
	source.Streams = source.Streams[:1]
	s := newSetup(t, source, "Silent.mp4")
	code, _, stderr := s.prepare(t)
	if code != 1 || !strings.Contains(stderr, "no audio track") {
		t.Fatalf("code %d, stderr %q", code, stderr)
	}
	if len(entries(t, s.dest)) != 0 {
		t.Fatal("something was written")
	}
}

func TestPrepareCopiesATrackAlreadyWithinTheSizeTarget(t *testing.T) {
	s := newSetup(t, smallSource(), "Small.mp4")
	_, stdout, _ := s.prepare(t)
	if !strings.Contains(stdout, "repackaging only") {
		t.Fatalf("stdout %q", stdout)
	}
	for _, c := range s.fake.called("ffmpeg") {
		if slices.Contains(c, "-map") {
			t.Fatalf("re-encoded: %v", c)
		}
	}
	// One track over the target: only that one is re-encoded.
	source := smallSource()
	source.Streams[1].BitRate = "128000"
	s = newSetup(t, source, "Loud.mp4")
	s.prepare(t)
	args := strings.Join(reencodeArgs(t, s.fake), " ")
	if !strings.Contains(args, "-c:v copy") || !strings.Contains(args, "-c:a aac -b:a 64k -ac 2") {
		t.Fatalf("args %q", args)
	}
}

func TestPrepareReencodesToAtMost540pAnd700kbitsStereo64k(t *testing.T) {
	// Quality: CRF 28 tuned for animation (smaller files; checked by eye
	// against CRF 26 on real episodes and films).
	s := newSetup(t, bigSource(), "Film.mp4")
	if code, _, stderr := s.prepare(t); code != 0 {
		t.Fatal(stderr)
	}
	args := strings.Join(reencodeArgs(t, s.fake), " ")
	for _, want := range []string{"-c:v libx264", "-crf 28 -tune animation", "-maxrate 700k", `scale=-2:min(540\,ih)`, "-c:a aac -b:a 64k -ac 2", "-map 0:1"} {
		if !strings.Contains(args, want) {
			t.Fatalf("args %q lack %q", args, want)
		}
	}
	// The packager takes the re-encoded file's only audio track.
	pack := strings.Join(s.fake.called("packager")[0], " ")
	if !strings.Contains(pack, "src.mp4,stream=audio,") {
		t.Fatalf("packager %q", pack)
	}
}

func TestPrepareCountsAnUnknownBitrateAsAboveTheTarget(t *testing.T) {
	source := smallSource()
	source.Streams[0].BitRate = ""
	p, _ := makePlan("x.mp4", source)
	if p.copyVideo || !p.copyAudio {
		t.Fatalf("plan %+v", p)
	}
	source = smallSource()
	source.Streams[1].BitRate = "N/A"
	if p, _ := makePlan("x.mp4", source); p.copyAudio || !p.copyVideo {
		t.Fatalf("plan %+v", p)
	}
}

func TestPrepareReencodesContainersOtherThanMp4M4vMov(t *testing.T) {
	for name, want := range map[string]bool{"a.mp4": false, "a.M4V": false, "a.mov": false, "a.mkv": true, "a.webm": true, "a.avi": true} {
		p, _ := makePlan(name, smallSource())
		if p.reencode() != want {
			t.Fatalf("%s: re-encode %v, want %v", name, p.reencode(), want)
		}
	}
}

func TestPrepareTakesThePosterFrom10PercentIn640Wide(t *testing.T) {
	s := newSetup(t, smallSource(), "Small.mp4")
	s.prepare(t)
	var poster string
	for _, c := range s.fake.called("ffmpeg") {
		if slices.Contains(c, "-frames:v") {
			poster = strings.Join(c, " ")
		}
	}
	if !strings.Contains(poster, "-ss 3.00 ") || !strings.Contains(poster, "scale=640:-2") {
		t.Fatalf("poster %q", poster)
	}
}

func TestPrepareSkipsATitleAlreadyInTheDestination(t *testing.T) {
	s := newSetup(t, smallSource(), "Small.mp4")
	os.MkdirAll(s.dest, 0o755)
	os.WriteFile(filepath.Join(s.dest, "Small.kidsvideo"), []byte("already"), 0o644)
	code, stdout, _ := s.prepare(t)
	if code != 0 || !strings.Contains(stdout, "already prepared: Small") || len(s.fake.calls) != 0 {
		t.Fatalf("code %d, stdout %q, calls %v", code, stdout, s.fake.calls)
	}
}

func TestPrepareLeavesNothingBehindWhenItFails(t *testing.T) {
	for _, tool := range []string{"ffmpeg", "packager"} {
		s := newSetup(t, bigSource(), "Film.mp4")
		s.fake.fail = tool
		before, _ := filepath.Glob(filepath.Join(os.TempDir(), "kidsvideo-*"))
		code, _, stderr := s.prepare(t)
		if code != 1 || stderr == "" {
			t.Fatalf("%s: code %d", tool, code)
		}
		if len(entries(t, s.dest)) != 0 {
			t.Fatalf("%s: dest holds %v", tool, entries(t, s.dest))
		}
		if after, _ := filepath.Glob(filepath.Join(os.TempDir(), "kidsvideo-*")); len(after) > len(before) {
			t.Fatalf("%s: work folder left behind", tool)
		}
	}
}

func TestPrepareDryRunSaysCopyOrReencodePerTrackAndWritesNothing(t *testing.T) {
	source := smallSource()
	source.Streams[0].Height = 1080
	s := newSetup(t, source, "Film.mp4")
	code, stdout, _ := s.prepare(t, "--dry-run")
	if code != 0 {
		t.Fatal(code)
	}
	for _, want := range []string{"video: re-encode (h264 1080p", "audio: stream 1 (unknown) of 1 audio track(s): copy", "would write: "} {
		if !strings.Contains(stdout, want) {
			t.Fatalf("stdout %q lacks %q", stdout, want)
		}
	}
	if len(s.fake.called("ffmpeg"))+len(s.fake.called("packager")) != 0 || len(entries(t, s.dest)) != 0 {
		t.Fatal("dry run did something")
	}
}

func TestPrepareShowsProgressOnlyOnATerminal(t *testing.T) {
	s := newSetup(t, bigSource(), "Film.mp4")
	s.prepare(t)
	if slices.Contains(reencodeArgs(t, s.fake), "-progress") {
		t.Fatal("asked for progress without a terminal")
	}
	s = newSetup(t, bigSource(), "Film.mp4")
	var terminal bytes.Buffer
	s.tools.progress = &terminal
	s.prepare(t)
	if !slices.Contains(reencodeArgs(t, s.fake), "-progress") || !strings.Contains(terminal.String(), "re-encoding   5%") || !strings.HasSuffix(terminal.String(), "100%\n") {
		t.Fatalf("terminal %q", terminal.String())
	}
}

func TestPrepareUsage(t *testing.T) {
	for _, args := range [][]string{{"prepare"}, {"prepare", "--nope", "film.mp4"}} {
		var out, errOut bytes.Buffer
		if code := runWith(args, &out, &errOut, toolset{}); code != 2 || !strings.Contains(errOut.String(), "usage: kidsvideo prepare") {
			t.Fatalf("%v: code %d, stderr %q", args, code, errOut.String())
		}
	}
}
