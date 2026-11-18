// M0 diagnostic page. Not part of the product: it exists to prove Shaka offline
// storage + playback work on the real iPad (DESIGN.md Milestones, M0).
import { installLocalScheme, registerPickedFiles, describePick, fileToDataUrl } from '../local-scheme.js';

const $ = (id) => document.querySelector(`[data-testid="${id}"]`);
const video = $('spike-video');
let player;

function log(msg) {
  const line = `${new Date().toLocaleTimeString()}  ${msg}`;
  $('spike-log').textContent = `${line}\n${$('spike-log').textContent}`;
  console.log(msg);
}

function check(id, result, text) {
  const el = $(`check-${id}`);
  el.dataset.result = result;
  el.textContent = text;
}

const mb = (n) => `${(n / 1e6).toFixed(0)} MB`;

async function environmentChecks() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  check('standalone', standalone ? 'pass' : 'info', standalone ? 'running as installed app' : 'running in a browser tab (install it for the real test)');

  const MS = window.ManagedMediaSource ?? window.MediaSource;
  const h264 = MS?.isTypeSupported('video/mp4; codecs="avc1.4d401e"');
  const aac = MS?.isTypeSupported('audio/mp4; codecs="mp4a.40.2"');
  check('mse', MS && h264 && aac ? 'pass' : 'fail',
    `${window.ManagedMediaSource ? 'ManagedMediaSource' : window.MediaSource ? 'MediaSource' : 'none'}, H.264 ${h264 ? 'yes' : 'no'}, AAC ${aac ? 'yes' : 'no'}`);

  const okPlayer = shaka.Player.isBrowserSupported();
  const okStorage = shaka.offline.Storage.support();
  check('shaka', okPlayer && okStorage ? 'pass' : 'fail', `Shaka ${shaka.Player.version}: player ${okPlayer ? 'yes' : 'no'}, offline ${okStorage ? 'yes' : 'no'}`);

  if (navigator.storage?.persist) {
    const granted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    check('persist', granted ? 'pass' : 'fail', granted ? 'granted' : 'not granted (browser may evict under pressure)');
  } else {
    check('persist', 'fail', 'navigator.storage.persist() unavailable');
  }
  await quotaCheck();
}

async function quotaCheck() {
  const est = await navigator.storage?.estimate?.();
  if (!est) return check('quota', 'fail', 'estimate() unavailable');
  check('quota', 'info', `${mb(est.usage)} used of ${mb(est.quota)} available`);
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return check('sw', 'fail', 'no service worker support');
  await navigator.serviceWorker.register('sw.js');
  await navigator.serviceWorker.ready;
  check('sw', 'pass', navigator.serviceWorker.controller ? 'active: app opens offline' : 'installed: reload once to go offline-ready');
}

// Media Session: record OS commands, never act on "play" (the real app will
// show the PIN prompt instead). The check passes if play arrives and the video
// stays paused.
function mediaSession() {
  if (!('mediaSession' in navigator)) return check('media-session', 'fail', 'Media Session API unavailable');
  for (const action of ['play', 'pause']) {
    navigator.mediaSession.setActionHandler(action, () => {
      log(`OS sent "${action}"`);
      if (action === 'pause') video.pause();
      if (action === 'play') {
        requestAnimationFrame(() => check('media-session', video.paused ? 'pass' : 'fail',
          video.paused ? 'received and ignored: video stayed paused' : 'received, but the video is playing'));
      }
    });
  }
}

async function storage() {
  const s = new shaka.offline.Storage();
  return s;
}

async function renderList() {
  const s = await storage();
  const items = await s.list();
  await s.destroy();
  const ul = $('spike-list');
  ul.replaceChildren(...items.map((c) => {
    const li = document.createElement('li');
    li.dataset.testid = 'spike-item';
    const img = document.createElement('img');
    img.src = c.appMetadata?.poster ?? '';
    const span = document.createElement('span');
    span.textContent = `${c.appMetadata?.title ?? '?'} (${mb(c.size)}, ${Math.round(c.duration / 60)} min)`;
    const play = Object.assign(document.createElement('button'), { textContent: 'Play' });
    play.dataset.testid = 'spike-play';
    play.onclick = () => playItem(c);
    const del = Object.assign(document.createElement('button'), { textContent: 'Delete' });
    del.onclick = async () => { const st = await storage(); await st.remove(c.offlineUri); await st.destroy(); log(`deleted ${c.appMetadata?.title}`); await renderList(); await quotaCheck(); };
    li.append(img, span, play, del);
    return li;
  }));
}

async function onPick(files) {
  const progress = $('spike-progress');
  let info;
  try {
    info = describePick(files);
  } catch (e) {
    check('store', 'fail', `bad pick: ${e.message}`);
    return log(`pick rejected: ${e.message}`);
  }
  await codecProbe(await info.manifest.text());
  const started = performance.now();
  const s = await storage();
  try {
    const uri = registerPickedFiles(files);
    const poster = await fileToDataUrl(info.poster);
    progress.hidden = false;
    s.configure({ offline: {
      progressCallback: (_c, p) => { progress.value = p; },
      // Log what survives Shaka's capability filter, then store the first variant.
      trackSelectionCallback: async (tracks) => {
        const variants = tracks.filter((t) => t.type === 'variant');
        log(`Shaka offered ${variants.length} variant(s) after filtering: ${variants.map((t) => `${t.videoCodec}+${t.audioCodec} ${t.width}x${t.height} lang=${t.language}`).join('; ') || 'none'}`);
        return variants.slice(0, 1);
      },
    } });
    log(`storing "${info.title}"…`);
    const stored = await s.store(uri, { title: info.title, poster }).promise;
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    const kept = (stored.tracks ?? []).filter((t) => t.type === 'variant').length;
    if (kept === 0 || stored.size === 0) {
      check('store', 'fail', `"${info.title}": Shaka kept 0 playable tracks (all filtered as unsupported); nothing downloaded. See codec probe.`);
    } else {
      check('store', 'pass', `"${info.title}" stored: ${mb(stored.size)}, ${kept} track(s) in ${secs} s`);
    }
    log(`stored ${stored.offlineUri}`);
  } catch (e) {
    check('store', 'fail', `store failed: ${e.code ?? ''} ${e.message ?? e}`);
    log(`store failed: ${JSON.stringify(e)}`);
  } finally {
    await s.destroy();
    progress.hidden = true;
  }
  await renderList();
  await quotaCheck();
}

async function playItem(c) {
  try {
    if (!player) { player = new shaka.Player(); await player.attach(video); }
    await player.load(c.offlineUri);
    await video.play();
    const t0 = video.currentTime;
    const advanced = await new Promise((resolve) => {
      const deadline = performance.now() + 5000;
      const tick = () => {
        if (video.currentTime > t0 + 0.5) return resolve(true);
        if (performance.now() > deadline) return resolve(false);
        requestAnimationFrame(tick);
      };
      tick();
    });
    check('play', advanced ? 'pass' : 'fail', advanced ? `"${c.appMetadata?.title}" is playing${navigator.onLine ? '' : ' (offline)'}` : 'started but time did not advance');
  } catch (e) {
    check('play', 'fail', `playback failed: ${e.code ?? ''} ${e.message ?? e}`);
    log(`playback failed: ${JSON.stringify(e)}`);
  }
}

// Ask the browser exactly what Shaka asks it before storing (one combined
// MediaCapabilities query per variant), plus variations to pinpoint which field
// makes it say "unsupported". Input: the picked .mpd text.
async function codecProbe(mpdText) {
  const lines = [`UA: ${navigator.userAgent}`, `Shaka ${shaka.Player.version}`];
  try {
    const dev = shaka.device?.DeviceFactory?.getDevice?.();
    if (dev) lines.push(`Shaka device: ${dev.getDeviceName?.()} ${dev.getVersion?.() ?? ''}, native MediaCapabilities: ${dev.supportsMediaCapabilities?.()}`);
  } catch (e) { lines.push(`Shaka device: ${e.message}`); }
  lines.push(`window.MediaSource: ${typeof window.MediaSource}, window.ManagedMediaSource: ${typeof window.ManagedMediaSource}`);

  const doc = new DOMParser().parseFromString(mpdText, 'application/xml');
  const reps = [...doc.getElementsByTagName('Representation')].map((rep) => {
    const set = rep.parentElement;
    const attr = (n) => rep.getAttribute(n) ?? set?.getAttribute(n);
    return {
      mime: attr('mimeType'), codecs: attr('codecs'), width: Number(attr('width')) || 0, height: Number(attr('height')) || 0,
      fps: attr('frameRate'), bandwidth: Number(attr('bandwidth')) || 1, rate: Number(attr('audioSamplingRate')) || 1,
    };
  });
  const v = reps.find((x) => x.mime?.startsWith('video'));
  const a = reps.find((x) => x.mime?.startsWith('audio'));
  const fps = v?.fps?.includes('/') ? (([n, d]) => n / d)(v.fps.split('/').map(Number)) : Number(v?.fps) || 30;
  lines.push(`manifest video: ${v?.mime} ${v?.codecs} ${v?.width}x${v?.height}@${fps} ${v?.bandwidth}bps`);
  lines.push(`manifest audio: ${a?.mime} ${a?.codecs} ${a?.rate}Hz ${a?.bandwidth}bps`);

  const vType = `${v?.mime}; codecs="${v?.codecs}"`;
  const aType = `${a?.mime}; codecs="${a?.codecs}"`;
  for (const [name, type] of [['video', vType], ['audio', aType]]) {
    lines.push(`${name} isTypeSupported: MS=${window.MediaSource?.isTypeSupported(type) ?? '-'} MMS=${window.ManagedMediaSource?.isTypeSupported(type) ?? '-'} canPlayType="${document.createElement('video').canPlayType(type)}"`);
  }

  // Exactly as Shaka 5.3.5 StreamUtils.getDecodingConfigs_ builds it.
  const shakaVideo = { contentType: vType, width: v?.width || 64, height: v?.height || 64, bitrate: v?.bandwidth || 1, framerate: fps || 30 };
  const shakaAudio = { contentType: aType, channels: 2, bitrate: a?.bandwidth || 1, samplerate: a?.rate || 1, spatialRendering: false };
  const { spatialRendering, ...audioNoSpatial } = shakaAudio;
  const cases = [
    ['SHAKA: media-source video+audio', { type: 'media-source', video: shakaVideo, audio: shakaAudio }],
    ['media-source video only', { type: 'media-source', video: shakaVideo }],
    ['media-source audio only', { type: 'media-source', audio: shakaAudio }],
    ['media-source audio without spatialRendering', { type: 'media-source', audio: audioNoSpatial }],
    ['media-source video+audio without spatialRendering', { type: 'media-source', video: shakaVideo, audio: audioNoSpatial }],
    ['media-source video at 720p', { type: 'media-source', video: { ...shakaVideo, width: 1280, height: 720, bitrate: 4e6 } }],
    ['file video+audio', { type: 'file', video: shakaVideo, audio: shakaAudio }],
  ];
  for (const [label, cfg] of cases) {
    try {
      const res = await navigator.mediaCapabilities.decodingInfo(cfg);
      lines.push(`${label}: supported=${res.supported}`);
    } catch (e) {
      lines.push(`${label}: threw ${e.name}: ${e.message}`);
    }
  }
  const text = lines.join('\n');
  $('check-codec-probe').dataset.result = 'info';
  $('check-codec-probe').textContent = text;
  log(text);
}

async function main() {
  shaka.polyfill.installAll();
  installLocalScheme();
  $('spike-files').addEventListener('change', (e) => onPick(e.target.files));
  mediaSession();
  await Promise.all([environmentChecks(), registerServiceWorker().catch((e) => check('sw', 'fail', String(e)))]);
  await renderList();
  log(`ready (${navigator.onLine ? 'online' : 'offline'})`);
}

main();
