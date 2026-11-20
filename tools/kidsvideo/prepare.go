package main

// kidsvideo prepare: one source video -> "<dest>/<Title>.kidsvideo" (stage 2 in
// README.md). ffprobe, ffmpeg and Shaka Packager do the work; this decides
// what to ask of them, and writes the file all or nothing.

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
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
		args = append(args, "-c:v", "libx264", "-preset", "slow", "-crf", "26", "-maxrate", videoRate, "-bufsize", videoBuffer,
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

// prepare writes dest/<title>.kidsvideo from input, saying what it does line by line.
func prepare(t toolset, input, dest, title string, dryRun bool, say func(string)) error {
	if info, err := os.Stat(input); err != nil || !info.Mode().IsRegular() {
		return fmt.Errorf("no such file: %s", input)
	}
	if title == "" {
		title = strings.TrimSuffix(filepath.Base(input), filepath.Ext(input))
	}
	// The tar name field holds 100 bytes: "<Title>.mpd" and its closing NUL must fit.
	if len(title) > 95 {
		return fmt.Errorf("title too long for the container (max 95 bytes; an accented letter counts as 2): %s", title)
	}
	out := filepath.Join(dest, title+ext)
	if _, err := os.Stat(out); err == nil {
		say("already prepared: " + title)
		return nil
	}
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

// runPrepare: kidsvideo prepare [--title T] [--dry-run] --dest DIR <video>
func runPrepare(args []string, stdout, stderr io.Writer, t toolset) int {
	fs := flag.NewFlagSet("prepare", flag.ContinueOnError)
	fs.SetOutput(stderr)
	dest := fs.String("dest", "", "where the .kidsvideo file goes")
	title := fs.String("title", "", "the title (default: the file name)")
	dryRun := fs.Bool("dry-run", false, "say what would be done, write nothing")
	if err := fs.Parse(args); err != nil || fs.NArg() != 1 || *dest == "" {
		fmt.Fprintln(stderr, "usage: kidsvideo prepare [--title T] [--dry-run] --dest DIR <video>")
		return 2
	}
	say := func(line string) { fmt.Fprintln(stdout, line) }
	if err := prepare(t, fs.Arg(0), *dest, *title, *dryRun, say); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	return 0
}

// realTools: from the environment (FFMPEG, FFPROBE, PACKAGER), else ffmpeg and
// ffprobe on PATH and the packager next to this program (tools/bin/packager).
func realTools() toolset {
	env := func(key, fallback string) string {
		if v := os.Getenv(key); v != "" {
			return v
		}
		return fallback
	}
	self, _ := os.Executable()
	t := toolset{
		ffmpeg: env("FFMPEG", "ffmpeg"), ffprobe: env("FFPROBE", "ffprobe"),
		packager: env("PACKAGER", filepath.Join(filepath.Dir(self), "packager")), r: execRunner{},
	}
	// The progress line goes straight to the terminal (callers like run_prepare.sh
	// filter stdout line by line, which would hide it); no terminal, no line.
	if tty, err := os.OpenFile(env("PROGRESS_OUT", "/dev/tty"), os.O_WRONLY, 0); err == nil {
		t.progress = tty
	}
	return t
}
