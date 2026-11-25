package main

// kidsvideo prepare: source videos -> "<dest>/<Title>.kidsvideo" (stages 2 and 3
// in README.md). ffprobe, ffmpeg and Shaka Packager do the work; this decides
// what to ask of them, and writes each file all or nothing. Stage 3 (folders,
// stdin, the destination, titles, series, the batch) is runPrepare.

import (
	"bufio"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// The size target, for minimal storage: video H.264 at most 540p and
// 0.7 Mbit/s, audio AAC stereo at 64 kbit/s. A track already within it is
// copied; anything else is re-encoded.
const (
	maxHeight     = 540
	maxVideoRate  = 700_000
	maxAudioRate  = 72_000 // 64 kbit/s plus what encoders overshoot
	videoRate     = "700k"
	videoBuffer   = "1400k"
	audioRate     = "64k"
	posterWidth   = "640"
	posterAtShare = 0.1
)

// runner runs the external tools; tests replace it.
type runner interface {
	output(name string, args ...string) ([]byte, error)
	run(name string, stdout io.Writer, args ...string) error
}

type execRunner struct{}

func (execRunner) output(name string, args ...string) ([]byte, error) {
	return exec.Command(name, args...).Output()
}

func (execRunner) run(name string, stdout io.Writer, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Stdin = nil
	cmd.Stdout = stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

type toolset struct {
	ffmpeg, ffprobe, packager string
	r                         runner
	progress                  io.Writer // a terminal for the re-encode progress line, or nil
	stdin                     io.Reader // paths, one per line, when none are given; nil on a terminal
	getenv                    func(string) string
	dotEnv                    string // the repo's .env (KIDS_LIBRARY), if any
}

func (t toolset) env(key string) string {
	if t.getenv == nil {
		return ""
	}
	return t.getenv(key)
}

type stream struct {
	Index     int               `json:"index"`
	CodecType string            `json:"codec_type"`
	CodecName string            `json:"codec_name"`
	Height    int               `json:"height"`
	Channels  int               `json:"channels"`
	BitRate   string            `json:"bit_rate"`
	Tags      map[string]string `json:"tags"`
}

type probed struct {
	Streams []stream `json:"streams"`
	Format  struct {
		Duration string `json:"duration"`
	} `json:"format"`
}

// rate is a stream's bitrate, 0 when the container doesn't record it.
func rate(s stream) int {
	n, _ := strconv.Atoi(s.BitRate)
	return n
}

// pickAudio: the first English audio track (en / eng / english), else the first.
func pickAudio(streams []stream) (stream, int, error) {
	var audio []stream
	for _, s := range streams {
		if s.CodecType == "audio" {
			audio = append(audio, s)
		}
	}
	if len(audio) == 0 {
		return stream{}, 0, errors.New("no audio track")
	}
	for _, s := range audio {
		switch strings.ToLower(s.Tags["language"]) {
		case "en", "eng", "english":
			return s, len(audio), nil
		}
	}
	return audio[0], len(audio), nil
}

func firstVideo(streams []stream) (stream, error) {
	for _, s := range streams {
		if s.CodecType == "video" {
			return s, nil
		}
	}
	return stream{}, errors.New("no video track")
}

// An unknown bitrate counts as above the target.
func videoWithin(v stream) bool {
	return v.CodecName == "h264" && v.Height > 0 && v.Height <= maxHeight && rate(v) > 0 && rate(v) <= maxVideoRate
}

func audioWithin(a stream) bool {
	return a.CodecName == "aac" && a.Channels > 0 && a.Channels <= 2 && rate(a) > 0 && rate(a) <= maxAudioRate
}

// plan says, per track, whether it is copied or re-encoded and why; the
// container must be mp4 / m4v / mov to be packaged as it is.
type plan struct {
	copyVideo, copyAudio, copyContainer bool
	video, audio                        stream
	audioTracks                         int
}

func (p plan) reencode() bool { return !p.copyVideo || !p.copyAudio || !p.copyContainer }

func (p plan) describe() []string {
	track := func(copied bool, what string) string {
		if copied {
			return "copy (within the size target)"
		}
		return "re-encode (" + what + ")"
	}
	lines := []string{
		fmt.Sprintf("video: %s", track(p.copyVideo, fmt.Sprintf("%s %dp %d bit/s -> at most %dp %s", p.video.CodecName, p.video.Height, rate(p.video), maxHeight, videoRate))),
		fmt.Sprintf("audio: stream %d (%s) of %d audio track(s): %s", p.audio.Index, language(p.audio), p.audioTracks,
			track(p.copyAudio, fmt.Sprintf("%s %dch %d bit/s -> stereo %s", p.audio.CodecName, p.audio.Channels, rate(p.audio), audioRate))),
	}
	if !p.copyContainer {
		lines = append(lines, "container: re-encode (not mp4 / m4v / mov)")
	}
	return lines
}

func language(s stream) string {
	if l := s.Tags["language"]; l != "" {
		return l
	}
	return "unknown"
}

func makePlan(input string, info probed) (plan, error) {
	video, err := firstVideo(info.Streams)
	if err != nil {
		return plan{}, err
	}
	audio, tracks, err := pickAudio(info.Streams)
	if err != nil {
		return plan{}, err
	}
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(input), "."))
	return plan{
		copyVideo: videoWithin(video), copyAudio: audioWithin(audio),
		copyContainer: ext == "mp4" || ext == "m4v" || ext == "mov",
		video:         video, audio: audio, audioTracks: tracks,
	}, nil
}

// encodeArgs: the ffmpeg arguments for a re-encode of input into out.
func (p plan) encodeArgs(input, out string, progress bool) []string {
	args := []string{"-hide_banner", "-loglevel", "error", "-y", "-nostdin", "-i", input,
		"-map", "0:v:0", "-map", fmt.Sprintf("0:%d", p.audio.Index)}
	if p.copyVideo {
		args = append(args, "-c:v", "copy")
	} else {
		args = append(args, "-c:v", "libx264", "-preset", "slow", "-crf", "28", "-tune", "animation", "-maxrate", videoRate, "-bufsize", videoBuffer,
			"-vf", fmt.Sprintf("scale=-2:min(%d\\,ih)", maxHeight), "-pix_fmt", "yuv420p")
	}
	if p.copyAudio {
		args = append(args, "-c:a", "copy")
	} else {
		args = append(args, "-c:a", "aac", "-b:a", audioRate, "-ac", "2")
	}
	args = append(args, "-movflags", "+faststart")
	if progress {
		args = append(args, "-nostats", "-progress", "pipe:1")
	}
	return append(args, out)
}

// progressLine draws ffmpeg's "-progress" key=value lines as one line on a terminal.
type progressLine struct {
	to      io.Writer
	totalUs float64
	buf     []byte
	doneUs  float64
}

func (w *progressLine) Write(b []byte) (int, error) {
	w.buf = append(w.buf, b...)
	for {
		i := strings.IndexByte(string(w.buf), '\n')
		if i < 0 {
			return len(b), nil
		}
		key, val, _ := strings.Cut(strings.TrimSpace(string(w.buf[:i])), "=")
		w.buf = w.buf[i+1:]
		switch key {
		case "out_time_us":
			w.doneUs, _ = strconv.ParseFloat(val, 64)
		case "progress":
			pct := 100
			if val != "end" {
				pct = min(100, int(w.doneUs*100/max(w.totalUs, 1)))
			}
			fmt.Fprintf(w.to, "\r   re-encoding %3d%%", pct)
			if val == "end" {
				fmt.Fprintln(w.to)
			}
		}
	}
}

// prepare writes dest/<title>.kidsvideo from input, saying what it does line by
// line. skipped: the title was already there.
func prepare(t toolset, input, dest, title string, dryRun bool, say func(string)) (skipped bool, err error) {
	if info, err := os.Stat(input); err != nil || !info.Mode().IsRegular() {
		return false, fmt.Errorf("no such file: %s", input)
	}
	// The tar name field holds 100 bytes: "<Title>.mpd" and its closing NUL must fit.
	if len(title) > 95 {
		return false, fmt.Errorf("title too long for the container (max 95 bytes; an accented letter counts as 2): %s", title)
	}
	out := filepath.Join(dest, title+ext)
	if _, err := os.Stat(out); err == nil {
		say("already prepared: " + title)
		return true, nil
	}
	return false, prepareNew(t, input, dest, title, out, dryRun, say)
}

func prepareNew(t toolset, input, dest, title, out string, dryRun bool, say func(string)) error {
	raw, err := t.r.output(t.ffprobe, "-v", "error", "-show_entries",
		"stream=index,codec_type,codec_name,height,channels,bit_rate:stream_tags=language:format=duration", "-of", "json", input)
	if err != nil {
		return fmt.Errorf("can't read %s: %v", input, err)
	}
	var info probed
	if err := json.Unmarshal(raw, &info); err != nil {
		return fmt.Errorf("can't read %s: %v", input, err)
	}
	p, err := makePlan(input, info)
	if err != nil {
		return fmt.Errorf("%s: %v", input, err)
	}
	for _, line := range p.describe() {
		say(line)
	}
	if dryRun {
		say("would write: " + out)
		return nil
	}
	if _, err := os.Stat(t.packager); err != nil {
		return errors.New("Shaka Packager not found; run tools/get-packager.sh (or set PACKAGER)")
	}

	work, err := os.MkdirTemp("", "kidsvideo-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(work)
	src, audioSel := input, strconv.Itoa(p.audio.Index)
	if p.reencode() {
		src, audioSel = filepath.Join(work, "src.mp4"), "audio" // the re-encode keeps exactly one audio track
		var stdout io.Writer
		if t.progress != nil {
			seconds, _ := strconv.ParseFloat(info.Format.Duration, 64)
			stdout = &progressLine{to: t.progress, totalUs: seconds * 1e6}
		}
		say("re-encoding: slow, but done once")
		if err := t.r.run(t.ffmpeg, stdout, p.encodeArgs(input, src, stdout != nil)...); err != nil {
			return fmt.Errorf("re-encoding failed: %v", err)
		}
	} else {
		say("already within the size target: repackaging only")
	}
	parts := filepath.Join(work, title)
	if err := os.Mkdir(parts, 0o755); err != nil {
		return err
	}
	if err := t.r.run(t.packager, nil, "--quiet",
		fmt.Sprintf("in=%s,stream=video,output=%s", src, filepath.Join(parts, "video.mp4")),
		fmt.Sprintf("in=%s,stream=%s,output=%s", src, audioSel, filepath.Join(parts, "audio.mp4")),
		"--mpd_output", filepath.Join(parts, title+".mpd")); err != nil {
		return fmt.Errorf("packaging failed: %v", err)
	}
	seconds, _ := strconv.ParseFloat(info.Format.Duration, 64)
	if err := t.r.run(t.ffmpeg, nil, "-hide_banner", "-loglevel", "error", "-y", "-nostdin",
		"-ss", fmt.Sprintf("%.2f", seconds*posterAtShare), "-i", src, "-frames:v", "1",
		"-vf", "scale="+posterWidth+":-2", "-q:v", "4", filepath.Join(parts, "poster.jpg")); err != nil {
		return fmt.Errorf("poster failed: %v", err)
	}
	if _, err := pack(parts); err != nil {
		return err
	}
	// Into dest in one step: copy next to the final name, then rename (the work
	// folder may be on another disk than dest).
	if err := os.MkdirAll(dest, 0o755); err != nil {
		return err
	}
	if err := copyFile(parts+ext, out+".partial"); err != nil {
		os.Remove(out + ".partial")
		return err
	}
	if err := os.Rename(out+".partial", out); err != nil {
		return err
	}
	say("prepared: " + out)
	return nil
}

func copyFile(from, to string) error {
	src, err := os.Open(from)
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := os.Create(to)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		return err
	}
	if err := dst.Sync(); err != nil {
		dst.Close()
		return err
	}
	return dst.Close()
}

const prepareUsage = "usage: kidsvideo prepare [--dest DIR] [--title T] [--series NAME] [--dry-run] <videos and folders…>  (no inputs: paths from stdin)"

// Folders are searched for these.
var videoExts = map[string]bool{".mp4": true, ".m4v": true, ".mov": true, ".mkv": true, ".webm": true, ".avi": true}

// videosIn: a file is itself; a folder, its video files (recursively, sorted).
func videosIn(input string) ([]string, error) {
	info, err := os.Stat(input)
	if err != nil {
		return nil, fmt.Errorf("not found: %s", input)
	}
	if !info.IsDir() {
		return []string{input}, nil
	}
	var found []string
	err = filepath.WalkDir(input, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.Type().IsRegular() && videoExts[strings.ToLower(filepath.Ext(path))] {
			found = append(found, path)
		}
		return nil
	})
	sort.Strings(found)
	return found, err
}

// Title tidying: a release-style file name -> a title.
var (
	leadingGroup    = regexp.MustCompile(`^\s*[\[(][^\])]*[\])]\s*`)
	dotsUnderscores = regexp.MustCompile(`[._]+`)
	underscores     = regexp.MustCompile(`_+`)
	releaseTag      = regexp.MustCompile(`(?i)\b(2160p|1080p|720p|576p|480p|4k|uhd|hdr10?|dv|web[- ]?dl|webrip|web|bluray|blu ray|bdrip|brrip|hdtv|dvdrip|remux|amzn|nf|dsnp|hmax|atvp|x26[45]|h ?26[45]|hevc|avc|aac\d?|ac3|eac3|ddp?\d?|dts|truehd|atmos|proper|repack|extended|multi|\d+(?:\.\d+)? ?[mg]b)\b.*$`)
	manySpaces      = regexp.MustCompile(`\s{2,}`)
	edges           = regexp.MustCompile(`^[\s\-]+|[\s\-.\[(]+$`)
	seasonEpisode   = regexp.MustCompile(`[Ss]([0-9]{1,3})[Ee]([0-9]{1,3})`)
	crossEpisode    = regexp.MustCompile(`(?:^|[^0-9])(([0-9]{1,2})x([0-9]{1,3}))(?:[^0-9]|$)`)
)

// tidy: dots/underscores become spaces (only when the name has no spaces, so
// "Mr. Bean" keeps its dot), a leading [group] is dropped, and everything from
// the first quality/source/size tag on is cut.
//
//	"Frozen.2.2019.1080p.BluRay.1400MB.DD5.1.x264-GalaxyRG" -> "Frozen 2 2019"
func tidy(name string) string {
	name = leadingGroup.ReplaceAllString(name, "")
	if !strings.Contains(name, " ") {
		name = dotsUnderscores.ReplaceAllString(name, " ")
	} else {
		name = underscores.ReplaceAllString(name, " ")
	}
	name = releaseTag.ReplaceAllString(name, "")
	name = manySpaces.ReplaceAllString(name, " ")
	return edges.ReplaceAllString(name, "")
}

// episodeTitle: "NAME - S01E03 - Episode title" from a file name carrying its
// season and episode (S01E03, s1e3, 1x03); the episode title is the tidied
// text after them, unless given. ok is false without season and episode.
func episodeTitle(stem, series, given string) (title string, ok bool) {
	var tag, season, episode string
	if m := seasonEpisode.FindStringSubmatch(stem); m != nil {
		tag, season, episode = m[0], m[1], m[2]
	} else if m := crossEpisode.FindStringSubmatch(stem); m != nil {
		tag, season, episode = m[1], m[2], m[3]
	} else {
		return "", false
	}
	if given == "" {
		_, after, _ := strings.Cut(stem, tag)
		given = tidy(after)
	}
	s, _ := strconv.Atoi(season)
	e, _ := strconv.Atoi(episode)
	title = fmt.Sprintf("%s - S%02dE%02d", series, s, e)
	if given != "" {
		title += " - " + given
	}
	return title, true
}

// dotEnvValue: key's value in a shell-style .env file (the last one wins;
// "$HOME" and the like are expanded except in single quotes), "" when absent.
func dotEnvValue(path, key string, getenv func(string) string) string {
	body, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	value := ""
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimPrefix(strings.TrimSpace(line), "export ")
		k, v, ok := strings.Cut(line, "=")
		if !ok || strings.TrimSpace(k) != key {
			continue
		}
		v = strings.TrimSpace(v)
		if len(v) >= 2 && v[0] == '\'' && v[len(v)-1] == '\'' {
			value = v[1 : len(v)-1]
			continue
		}
		if len(v) >= 2 && v[0] == '"' && v[len(v)-1] == '"' {
			v = v[1 : len(v)-1]
		}
		value = os.Expand(v, func(name string) string {
			if getenv == nil {
				return ""
			}
			return getenv(name)
		})
	}
	return value
}

// parseInterspersed: options may come before, between or after the inputs.
func parseInterspersed(f *flag.FlagSet, args []string) ([]string, error) {
	var inputs []string
	for {
		if err := f.Parse(args); err != nil {
			return nil, err
		}
		if f.NArg() == 0 {
			return inputs, nil
		}
		inputs = append(inputs, f.Arg(0))
		args = f.Args()[1:]
	}
}

// runPrepare: kidsvideo prepare [--dest DIR] [--title T] [--series NAME] [--dry-run] <videos and folders…>
func runPrepare(args []string, stdout, stderr io.Writer, t toolset) int {
	f := flag.NewFlagSet("prepare", flag.ContinueOnError)
	f.SetOutput(stderr)
	dest := f.String("dest", "", "where the .kidsvideo files go (default: KIDS_LIBRARY)")
	title := f.String("title", "", "the title of a single video (default: the file name, tidied); with --series, the episode title")
	series := f.String("series", "", "these are episodes of NAME, filed under DEST/NAME/")
	dryRun := f.Bool("dry-run", false, "say what would be done, write nothing")
	inputs, err := parseInterspersed(f, args)
	if err != nil {
		fmt.Fprintln(stderr, prepareUsage)
		return 2
	}
	if len(inputs) == 0 && t.stdin != nil {
		lines := bufio.NewScanner(t.stdin)
		for lines.Scan() {
			if line := strings.TrimRight(lines.Text(), "\r"); line != "" {
				inputs = append(inputs, line)
			}
		}
	}
	if len(inputs) == 0 {
		fmt.Fprintln(stderr, prepareUsage)
		return 2
	}

	library := *dest
	if library == "" {
		library = t.env("KIDS_LIBRARY")
	}
	if library == "" && t.dotEnv != "" {
		library = dotEnvValue(t.dotEnv, "KIDS_LIBRARY", t.getenv)
	}
	if library == "" {
		fmt.Fprintln(stderr, "no destination: use --dest DIR, or set KIDS_LIBRARY (in the environment or in the repo's .env; see .env.example)")
		return 2
	}
	if info, err := os.Stat(library); err != nil || !info.IsDir() {
		fmt.Fprintf(stderr, "destination does not exist: %s (create it first, e.g. a \"Kids Library\" folder)\n", library)
		return 1
	}

	var files, failed []string
	for _, input := range inputs {
		found, err := videosIn(input)
		if err != nil {
			fmt.Fprintln(stderr, err)
			failed = append(failed, input)
			continue
		}
		files = append(files, found...)
	}
	if len(files) == 0 && len(failed) == 0 {
		fmt.Fprintln(stderr, "no video files found")
		return 1
	}
	if *title != "" && len(files)+len(failed) != 1 {
		fmt.Fprintf(stderr, "--title names a single video (got %d)\n", len(files)+len(failed))
		return 2
	}

	say := func(line string) { fmt.Fprintln(stdout, line) }
	indented := func(line string) { say("   " + line) }
	done, skipped := 0, 0
	for _, file := range files {
		stem := strings.TrimSuffix(filepath.Base(file), filepath.Ext(file))
		name, dir := *title, library
		if *series != "" {
			var ok bool
			if name, ok = episodeTitle(stem, *series, *title); !ok {
				say("== " + stem)
				fmt.Fprintln(stderr, "   no season and episode (e.g. S01E03) in the file name: "+file)
				failed = append(failed, file)
				continue
			}
			dir = filepath.Join(library, *series)
		} else if name == "" {
			if name = tidy(stem); name == "" {
				name = stem
			}
		}
		say("== " + name)
		wasThere, err := prepare(t, file, dir, name, *dryRun, indented)
		switch {
		case err != nil:
			fmt.Fprintln(stderr, "   "+err.Error())
			failed = append(failed, file)
		case wasThere:
			skipped++
		default:
			done++
		}
	}

	verb := "prepared"
	if *dryRun {
		verb = "would prepare"
	}
	say("")
	say(fmt.Sprintf("%s: %d   skipped (already there): %d   failed: %d   → %s", verb, done, skipped, len(failed), library))
	for _, file := range failed {
		indented("FAILED: " + file)
	}
	if len(failed) > 0 {
		return 1
	}
	return 0
}

// realTools: from the environment (FFMPEG, FFPROBE, PACKAGER), else ffmpeg and
// ffprobe on PATH and the packager next to this program (tools/bin/packager).
// The repo's .env is two folders up from this program (tools/bin/kidsvideo).
func realTools() toolset {
	env := func(key, fallback string) string {
		if v := os.Getenv(key); v != "" {
			return v
		}
		return fallback
	}
	self, _ := os.Executable()
	if real, err := filepath.EvalSymlinks(self); err == nil {
		self = real
	}
	t := toolset{
		ffmpeg: env("FFMPEG", "ffmpeg"), ffprobe: env("FFPROBE", "ffprobe"),
		packager: env("PACKAGER", filepath.Join(filepath.Dir(self), "packager")), r: execRunner{},
		getenv: os.Getenv, dotEnv: filepath.Join(filepath.Dir(self), "..", "..", ".env"),
	}
	if info, err := os.Stdin.Stat(); err == nil && info.Mode()&os.ModeCharDevice == 0 {
		t.stdin = os.Stdin
	}
	// The progress line goes straight to the terminal (callers like run_prepare.sh
	// filter stdout line by line, which would hide it); no terminal, no line.
	if tty, err := os.OpenFile(env("PROGRESS_OUT", "/dev/tty"), os.O_WRONLY, 0); err == nil {
		t.progress = tty
	}
	return t
}
