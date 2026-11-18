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
  const started = performance.now();
  const s = await storage();
  try {
    const uri = registerPickedFiles(files);
    const poster = await fileToDataUrl(info.poster);
    progress.hidden = false;
    s.configure({ offline: { progressCallback: (_c, p) => { progress.value = p; } } });
    log(`storing "${info.title}"…`);
    const stored = await s.store(uri, { title: info.title, poster }).promise;
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    check('store', 'pass', `"${info.title}" stored: ${mb(stored.size)} in ${secs} s`);
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
