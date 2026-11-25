// "Time is up" picture and sound, part of the watch-time limit
// (watch-time.js). When the budget runs out the player shows the parent's
// picture, if any, and plays a little tune: the built-in one, or the parent's
// own sound file. Both are chosen in Settings and kept on this device only
// (IndexedDB), like the videos.
const DB = 'kids-time-up';
const STORE = 'files'; // 'picture' | 'sound' -> { name, type, data: ArrayBuffer }

const done = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = reject;
});

async function withStore(mode, fn) {
  const open = indexedDB.open(DB, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(STORE);
  const db = await done(open);
  try {
    return await done(fn(db.transaction(STORE, mode).objectStore(STORE)));
  } finally {
    db.close();
  }
}

// ---------- the built-in tune ----------

// An original music-box melody, about 11 seconds: eighth notes at 100 bpm,
// over a soft bass line. Synthesized here, so the app ships no media file.
const RATE = 22050;
const EIGHTH = 0.3;
const MELODY = [
  ['E5', 1], ['G5', 1], ['C6', 1], ['G5', 1], ['A5', 1], ['G5', 1], ['E5', 2],
  ['F5', 1], ['A5', 1], ['D6', 1], ['A5', 1], ['G5', 1], ['F5', 1], ['E5', 2],
  ['D5', 1], ['E5', 1], ['F5', 1], ['G5', 1], ['A5', 1], ['G5', 1], ['F5', 1], ['D5', 1],
  ['C5', 1], ['E5', 1], ['G5', 1], ['E5', 1], ['C5', 4],
];
const BASS = [['C3', 4], ['G3', 4], ['F3', 4], ['C4', 4], ['G3', 4], ['B2', 4], ['C3', 8]];
const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const hz = (note) => 440 * 2 ** ((SEMITONE[note[0]] + 12 * (Number(note[1]) + 1) - 69) / 12);

// A plucked note: a quick attack, a music-box decay, a few fading overtones.
function pluck(samples, note, start, seconds, volume, bright) {
  const f = hz(note);
  const from = Math.round(start * RATE);
  const count = Math.min(Math.round((seconds + 1.2) * RATE), samples.length - from);
  for (let i = 0; i < count; i++) {
    const t = i / RATE;
    const envelope = Math.exp(-t * 3.2) * Math.min(1, t / 0.004);
    samples[from + i] += volume * envelope * (Math.sin(2 * Math.PI * f * t)
      + bright * 0.35 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t * 6)
      + bright * 0.15 * Math.sin(6 * Math.PI * f * t) * Math.exp(-t * 9));
  }
}

function play(samples, notes, volume, bright) {
  let at = 0;
  for (const [note, eighths] of notes) {
    pluck(samples, note, at, eighths * EIGHTH, volume, bright);
    at += eighths * EIGHTH;
  }
}

/** The built-in tune as a 16-bit mono WAV. */
export function builtInTune() {
  const length = MELODY.reduce((sum, [, eighths]) => sum + eighths, 0) * EIGHTH + 2;
  const samples = new Float32Array(Math.round(length * RATE));
  play(samples, MELODY, 0.28, 1);
  play(samples, BASS, 0.16, 0.3);
  const peak = samples.reduce((max, x) => Math.max(max, Math.abs(x)), 0);
  const fade = 0.8 * RATE;
  const wav = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at, s) => [...s].forEach((c, i) => wav.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); wav.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
  wav.setUint32(24, RATE, true); wav.setUint32(28, RATE * 2, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true);
  text(36, 'data'); wav.setUint32(40, samples.length * 2, true);
  samples.forEach((x, i) => {
    const gain = Math.min(1, (samples.length - i) / fade);
    wav.setInt16(44 + i * 2, Math.round(23000 * (x / peak) * gain), true);
  });
  return new Blob([wav], { type: 'audio/wav' });
}

// ---------- settings and the player ----------

const KINDS = {
  picture: { mime: 'image/', choose: 'Choose picture', refused: "That isn't a picture." },
  sound: { mime: 'audio/', choose: 'Choose sound', refused: "That isn't a sound." },
};

function element(tag, testid, text = '') {
  const el = document.createElement(tag);
  if (testid) el.dataset.testid = testid;
  el.textContent = text;
  return el;
}

function button(testid, text, onClick) {
  const b = element('button', testid, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/**
 * $: the app's test-id lookup. Returns render(status), sounded() (the budget
 * just ran out), unlockSound() (call within a tap), settings (the Settings
 * rows, one element) and stop().
 */
export function initTimeUp($) {
  const picture = $('time-up-picture');
  const sound = $('time-up-sound');
  const builtIn = URL.createObjectURL(builtInTune());
  const chosen = { picture: null, sound: null }; // { name, url } or null

  // Settings: a row for the picture, one for the sound; each with a hidden file input.
  const settings = element('div');
  settings.className = 'time-up-settings';
  const heading = element('h2', null, '"Time is up"');
  const preview = element('img', 'time-up-picture-preview');
  preview.alt = '';
  const remove = button('time-up-picture-remove', 'Remove', () => forget('picture'));
  const soundName = element('span', 'time-up-sound-name');
  const reset = button('time-up-sound-reset', 'Use the built-in tune', () => forget('sound'));
  const status = {};
  const rows = Object.entries(KINDS).map(([kind, k]) => {
    const input = element('input');
    input.type = 'file';
    input.accept = `${k.mime}*`;
    input.hidden = true;
    input.addEventListener('change', () => {
      const files = [...input.files];
      input.value = '';
      for (const file of files) pick(kind, file);
    });
    status[kind] = element('span', `time-up-${kind}-status`);
    const row = element('div');
    row.className = 'time-up-row';
    row.append(
      element('span', null, kind === 'picture' ? 'Picture' : 'Sound'),
      ...(kind === 'picture' ? [preview, remove] : [soundName, reset]),
      button(`time-up-${kind}-choose`, k.choose, () => input.click()),
      status[kind],
      input,
    );
    return row;
  });
  settings.append(heading, ...rows);

  function draw() {
    if (chosen.picture) {
      picture.src = chosen.picture.url;
      preview.src = chosen.picture.url;
    } else {
      picture.removeAttribute('src');
      preview.removeAttribute('src');
    }
    preview.hidden = !chosen.picture;
    remove.hidden = !chosen.picture;
    const own = chosen.sound;
    if (sound.dataset.src !== (own?.url ?? builtIn)) {
      sound.dataset.src = own?.url ?? builtIn;
      sound.src = sound.dataset.src;
    }
    sound.dataset.sound = own ? 'own' : 'built-in';
    soundName.textContent = own?.name ?? 'Built-in tune';
    reset.hidden = !own;
  }

  function use(kind, entry) {
    chosen[kind] = entry && { name: entry.name, url: URL.createObjectURL(new Blob([entry.data], { type: entry.type })) };
    draw();
  }

  async function pick(kind, file) {
    const ok = file.type.startsWith(KINDS[kind].mime);
    status[kind].dataset.state = ok ? 'ok' : 'refused';
    status[kind].textContent = ok ? '' : KINDS[kind].refused;
    if (!ok) return;
    const entry = { name: file.name, type: file.type, data: await file.arrayBuffer() };
    await withStore('readwrite', (s) => s.put(entry, kind));
    use(kind, entry);
  }

  async function forget(kind) {
    await withStore('readwrite', (s) => s.delete(kind));
    use(kind, null);
  }

  // Safari plays a sound without a tap only once the element was given one.
  const unlockSound = () => sound.load();
  $('play-button').addEventListener('click', unlockSound);

  draw();
  Promise.all(['picture', 'sound'].map((kind) => withStore('readonly', (s) => s.get(kind))))
    .then(([p, s]) => { use('picture', p); use('sound', s); });

  return {
    settings,
    unlockSound,
    render(status) {
      picture.hidden = !(status === 'time-up' && chosen.picture);
    },
    sounded() {
      sound.currentTime = 0;
      sound.play().catch(console.warn);
    },
    stop() {
      $('play-button').removeEventListener('click', unlockSound);
      picture.hidden = true;
      sound.pause();
    },
  };
}
