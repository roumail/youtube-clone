// Shared test fixtures and helpers.
// Rule: wait on observable state, never on time. No waitForTimeout anywhere.
import { test as base, expect } from '@playwright/test';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import path from 'node:path';
import { COVERAGE, coverageReport, recordServiceWorkers } from './coverage.js';
import { readFileSync, statSync } from 'node:fs';

export { expect };

export const sha256Hex = (s) => createHash('sha256').update(s).digest('hex');

// Generated in CI (not committed). Served by the test server (repo root) under /fixtures/out/.
export const FIXTURES_DIR = path.resolve(import.meta.dirname, '..', 'fixtures', 'out');
export const fixtureUrl = (name) => `/fixtures/out/${name}/${name}.mpd`;
export const fixtureContainer = (name) => path.join(FIXTURES_DIR, `${name}.kidsvideo`);
// Loose parts of a fixture, only for a test that checks loose files are refused.
export const fixtureParts = (name) =>
  [`${name}.mpd`, 'video.mp4', 'audio.mp4', 'poster.jpg'].map((f) => path.join(FIXTURES_DIR, name, f));

export const test = base.extend({
  // Optional features seeded for a fresh install, unless the app already has
  // flags. Tests that aren't about the watch-time limit start with it switched
  // off (as a parent can in Settings), so a first play doesn't ask for a
  // budget. Feature files about it use test.use({ features: null }) to get the
  // app's real defaults.
  features: [{ watchTimeLimit: false }, { option: true }],

  // Every test runs on a device with Face ID / Touch ID: Chromium's virtual
  // authenticator (passes unless told to fail), and in WebKit (no virtual
  // authenticator there) a simulated one that always passes. Scenarios about a
  // device without it use test.use({ faceIdDevice: false }).
  faceIdDevice: [true, { option: true }],

  // Coverage only: a debugging port per test worker, so the service worker's
  // coverage can be recorded too (e2e/coverage.js).
  coveragePort: [async ({ browserName }, use, workerInfo) => {
    await use(COVERAGE && browserName === 'chromium' ? 9300 + workerInfo.parallelIndex : 0);
  }, { scope: 'worker' }],
  launchOptions: [async ({ launchOptions, coveragePort }, use) => {
    await use(coveragePort
      ? { ...launchOptions, args: [...(launchOptions.args ?? []), `--remote-debugging-port=${coveragePort}`] }
      : launchOptions);
  }, { scope: 'worker' }],

  // Capture Media Session handlers the app registers, so tests can fire
  // "play" as if from headphones / lock screen. No hooks needed in the app.
  // Every test sees a wide-gamut (P3) screen, like the family's MacBook and
  // iPad. Shaka changes its track choices on such screens.
  page: async ({ page, features, browserName, coveragePort, faceIdDevice }, use) => {
    // Coverage of app/ (CI sets COVERAGE): Chromium only, whole test incl. reloads.
    // Chromium drops a page's coverage when it navigates, so it's saved before
    // every goto/reload and recording starts again.
    const collect = COVERAGE && browserName === 'chromium';
    const saveCoverage = async () => {
      const entries = await page.coverage.stopJSCoverage();
      if (entries.length) await coverageReport().add(entries);
    };
    const serviceWorkers = collect && coveragePort ? await recordServiceWorkers(coveragePort) : null;
    if (collect) {
      await page.coverage.startJSCoverage({ resetOnNavigation: false });
      for (const method of ['goto', 'reload']) {
        const original = page[method].bind(page);
        page[method] = async (...args) => {
          await saveCoverage();
          await page.coverage.startJSCoverage({ resetOnNavigation: false });
          return original(...args);
        };
      }
    }
    if (faceIdDevice) faceIdDevices.set(page, await addFaceIdDevice(page, browserName));
    if (features) {
      await page.addInitScript((f) => {
        try {
          if (!localStorage.getItem('features')) localStorage.setItem('features', JSON.stringify(f));
        } catch {
          // pages without storage (e.g. about:blank) have no app to configure
        }
      }, features);
    }
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (q) => (/color-gamut:\s*p3|dynamic-range:\s*high/.test(q)
        ? { matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } }
        : original(q));
    });
    await page.addInitScript(() => {
      window.__mediaSessionHandlers = {};
      const ms = navigator.mediaSession;
      if (ms) {
        const original = ms.setActionHandler.bind(ms);
        ms.setActionHandler = (action, handler) => {
          window.__mediaSessionHandlers[action] = handler;
          return original(action, handler);
        };
      }
    });
    // Any Content Security Policy
    // violation or uncaught page error fails the test, whatever it was testing.
    const problems = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) problems.push(`CSP: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    await use(page);
    if (collect) await saveCoverage();
    if (serviceWorkers) {
      const entries = await serviceWorkers.stop();
      if (entries.length) await coverageReport().add(entries);
    }
    expect(problems, 'CSP violations / uncaught page errors').toEqual([]);
  },

  // This device's Face ID (see faceIdDevice): willFail(), willPass() and
  // uses(); in Chromium also passkeys() and deletePasskeys().
  faceId: async ({ page }, use) => {
    await use(faceIdDevices.get(page));
  },

  // Face ID is already set up (a passkey for this app on this device), so
  // first run is skipped. Only seeds once, across reloads.
  setUp: async ({ page, baseURL }, use) => {
    await faceIdDevices.get(page).addPasskey(new URL(baseURL).hostname);
    await page.addInitScript(() => {
      if (!localStorage.getItem('faceId.setUp')) localStorage.setItem('faceId.setUp', 'true');
    });
    await use();
  },

  // Arrange via API: store fixtures through Shaka directly, bypassing the
  // import UI (which has its own spec). Call after the app has booted.
  seedLibrary: async ({ page }, use) => {
    await use(async (...names) => {
      for (const name of names) {
        await page.evaluate(async ({ url, title, posterUrl }) => {
          const blob = await (await fetch(posterUrl)).blob();
          const poster = await new Promise((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.readAsDataURL(blob);
          });
          const storage = new shaka.offline.Storage();
          // Same rule as the app: never Shaka's default picker,
          // which drops SDR video on P3 screens (emulated for every test).
          storage.configure({ offline: {
            trackSelectionCallback: async (tracks) => tracks.filter((t) => t.type === 'variant').slice(0, 1),
          } });
          let stored;
          try {
            // Shaka needs an absolute URI (it picks the network plugin by scheme).
            stored = await storage.store(new URL(url, location.href).href, { title, poster }).promise;
          } catch (e) {
            // Shaka's compiled errors stringify to nothing useful; surface code + data.
            throw new Error(`seedLibrary: storing "${title}" failed: Shaka ${e.code} ${JSON.stringify(e.data ?? e.message)}`);
          } finally {
            await storage.destroy();
          }
          if (!stored.size) throw new Error(`seedLibrary: "${title}" stored 0 bytes`);
        }, { url: fixtureUrl(name), title: name, posterUrl: `/fixtures/out/${name}/poster.jpg` });
      }
      await page.reload();
      await appReady(page);
    });
  },
});

// ---------- Face ID ----------

const faceIdDevices = new WeakMap();

async function addFaceIdDevice(page, browserName) {
  if (browserName !== 'chromium') {
    await page.addInitScript(() => {
      window.__faceId = { uses: 0, fail: false };
      const pass = async () => {
        if (window.__faceId.fail) throw new DOMException('Face ID failed', 'NotAllowedError');
        window.__faceId.uses += 1;
        return { rawId: new Uint8Array([7, 7, 7, 7]).buffer, response: { userHandle: new TextEncoder().encode('parent').buffer } };
      };
      Object.defineProperty(navigator, 'credentials', { configurable: true, value: { create: pass, get: pass } });
      const PKC = window.PublicKeyCredential ?? function PublicKeyCredential() {};
      Object.defineProperty(PKC, 'isUserVerifyingPlatformAuthenticatorAvailable', { configurable: true, value: async () => true });
      window.PublicKeyCredential = PKC;
    });
    // Simulated: willFail / willPass / uses for this page (until a reload).
    return {
      willFail: () => page.evaluate(() => { window.__faceId.fail = true; }),
      willPass: () => page.evaluate(() => { window.__faceId.fail = false; }),
      uses: () => page.evaluate(() => window.__faceId.uses),
      addPasskey: async () => {},
    };
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });
  const credentials = async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials;
  return {
    willFail: () => cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false }),
    willPass: () => cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true }),
    passkeys: async () => (await credentials()).length,
    // How often Face ID was passed with this app's passkey.
    uses: async () => (await credentials()).reduce((n, c) => n + c.signCount, 0),
    deletePasskeys: () => cdp.send('WebAuthn.clearCredentials', { authenticatorId }),
    // A passkey made earlier (as first run would).
    addPasskey: async (rpId) => {
      const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      await cdp.send('WebAuthn.addCredential', { authenticatorId, credential: {
        credentialId: randomBytes(16).toString('base64'), isResidentCredential: true, rpId,
        userHandle: Buffer.from('parent').toString('base64'),
        privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'), signCount: 0,
      } });
    },
  };
}

// ---------- helpers ----------

export async function appReady(page) {
  await expect(page.getByTestId('app')).toHaveAttribute('data-ready', 'true');
}

export async function goto(page, route) {
  await page.goto(`./${route}`);
  await appReady(page);
}

// A Google sign-in is due (none yet, or it ran out): adding from Drive,
// downloading or playing a streamed video then needs "Continue" after Face ID.
export const signInDue = (page) => page.evaluate(() => {
  const kept = JSON.parse(localStorage.getItem('kids-google-sign-in-readonly'));
  return !kept || Date.now() >= kept.expiresAt;
});

// After Face ID, an action that must start within a tap (the file picker, a
// Google sign-in that is due) waits for "Continue": tap it.
export async function tapContinue(page) {
  await page.getByTestId('unlock-continue-button').tap();
}

export async function openVideo(page, title) {
  await page.getByTestId('library-item').filter({ hasText: title }).tap();
  await expect(page.getByTestId('screen-player')).toHaveAttribute('data-state', 'paused');
}

export const playerState = (page) => page.getByTestId('screen-player');
const video = (page) => page.getByTestId('player-video');
const currentTime = (page) => video(page).evaluate((v) => v.currentTime);

// "Playing" = state says so AND media time actually advances.
export async function expectPlaying(page) {
  await expect(playerState(page)).toHaveAttribute('data-state', 'playing');
  const t0 = await currentTime(page);
  await expect.poll(() => currentTime(page)).toBeGreaterThan(t0);
}

// "Not playing" = element paused AND media time does not move across
// several rendered frames. A paused video never advances, so this has no race.
export async function expectNotPlaying(page) {
  await expect.poll(() => video(page).evaluate((v) => v.paused)).toBe(true);
  const moved = await video(page).evaluate(async (v) => {
    const t0 = v.currentTime;
    for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
    return v.currentTime !== t0;
  });
  expect(moved).toBe(false);
}

// Simulate the app being backgrounded / foregrounded.
export async function setVisibility(page, state) {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
    Object.defineProperty(document, 'hidden', { value: s === 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

// Model the iPhone's on-screen keyboard: while a text field has
// focus, window.visualViewport is shorter by the keyboard's height, as iPhone
// Safari reports it; it closes ≈300 ms after the field loses focus. The page itself doesn't move. Call before goto().
// The device's storage as the browser reports it (navigator.storage.estimate):
// `free` bytes left for the app. Call before the app loads.
export async function freeSpace(page, free) {
  await page.addInitScript((bytes) => {
    Object.defineProperty(navigator.storage, 'estimate', {
      configurable: true,
      value: async () => ({ usage: 0, quota: bytes }),
    });
  }, free);
}

// Shaka's own size guess for a fixture: declared bitrates x duration.
export function declaredSize(name) {
  const mpd = readFileSync(path.join(FIXTURES_DIR, name, `${name}.mpd`), 'utf8');
  const seconds = Number(/mediaPresentationDuration="PT([\d.]+)S"/.exec(mpd)[1]);
  const bitrate = [...mpd.matchAll(/bandwidth="(\d+)"/g)].reduce((sum, m) => sum + Number(m[1]), 0);
  return (bitrate * seconds) / 8;
}

export const containerSize = (name) => statSync(fixtureContainer(name)).size;

export async function onScreenKeyboard(page) {
  await page.addInitScript(() => {
    const fake = new EventTarget();
    let keyboard = 0;
    const keyboardHeight = () => (window.innerWidth > window.innerHeight ? 200 : 300);
    Object.defineProperties(fake, {
      width: { get: () => window.innerWidth },
      height: { get: () => window.innerHeight - keyboard },
      offsetTop: { get: () => 0 },
      offsetLeft: { get: () => 0 },
      pageTop: { get: () => window.scrollY },
      pageLeft: { get: () => window.scrollX },
      scale: { get: () => 1 },
    });
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
    const typing = (el) => el instanceof HTMLInputElement && !['range', 'file', 'checkbox', 'radio', 'button', 'submit'].includes(el.type);
    const set = (h) => { if (h !== keyboard) { keyboard = h; fake.dispatchEvent(new Event('resize')); } };
    document.addEventListener('focusin', (e) => { if (typing(e.target)) set(keyboardHeight()); });
    // Like the real keyboard, it slides away after the tap that took focus
    // away has landed (≈300 ms), not in the middle of it.
    document.addEventListener('focusout', (e) => {
      if (typing(e.target)) setTimeout(() => { if (!typing(document.activeElement)) set(0); }, 300);
    });
    window.addEventListener('resize', () => fake.dispatchEvent(new Event('resize')));
  });
}

// A slow device (a big film on the iPad): opening a video (Shaka's load) or
// closing it (unload) waits while the test holds it. Call once the app has
// loaded; release() returns when the held calls have finished.
export async function slowPlayer(page) {
  await page.evaluate(() => {
    const gates = {};
    const running = {};
    window.__player = { gates, running };
    for (const kind of ['load', 'unload']) {
      const original = shaka.Player.prototype[kind];
      shaka.Player.prototype[kind] = function (...args) {
        const call = (async () => {
          await gates[kind]?.promise;
          return original.apply(this, args);
        })();
        running[kind] = call.catch(() => {});
        return call;
      };
    }
  });
  return {
    hold: (kind) => page.evaluate((k) => {
      let release;
      window.__player.gates[k] = { promise: new Promise((resolve) => { release = resolve; }), release };
    }, kind),
    release: (kind) => page.evaluate(async (k) => {
      window.__player.gates[k].release();
      delete window.__player.gates[k];
      await window.__player.running[k];
    }, kind),
  };
}

// Google, faked at the network boundary: the app's google.json, Google's
// sign-in script, its Picker script and Drive's download endpoint (routed on
// the context, so requests the service worker makes are caught too). `files` maps each file name shared with the
// signed-in account to a local file. By default sign-in succeeds and the Picker
// picks nothing (closed). Call before the app loads.
// files: { name: path } shared with the account; folders: { 'A' or 'A/B': [file names] },
// shared folders and what is in them ('A/B' is folder B inside A).
export async function fakeGoogle(page, files, folders = {}) {
  const shared = Object.entries(files).map(([name, file], i) => ({ id: `drive-file-${i}`, name, file }));
  const folderList = Object.keys(folders).map((p, i) => ({ id: `drive-folder-${i}`, path: p, name: p.split('/').pop() }));
  const denied = new Set();
  const dropped = new Set();
  const served = new Map();
  let otherThanReads = 0;
  let pickedForThisProject = false; // Google remembers it across reloads
  const held = new Map(); // file name -> a promise its reads wait for
  const token = 'fake-token';
  // As with Google: picked files become readable only by the Cloud project the
  // Picker was opened for, given by its project number (setAppId).
  const projectNumber = '123456789012';
  await page.addInitScript(() => {
    window.__fakeGoogle = { signIn: 'accept', pick: [], signIns: 0 };
  });
  const context = page.context();
  await context.route('**/google.json', (route) => route.fulfill({ json: { clientId: `${projectNumber}-fake.apps.googleusercontent.com`, apiKey: 'key1' } }));
  await context.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `(${(accessToken) => {
      window.google = window.google ?? {};
      window.google.accounts = { oauth2: { initTokenClient: ({ callback, error_callback: failed }) => ({
        requestAccessToken: () => {
          const fake = window.__fakeGoogle;
          fake.signIns += 1;
          Promise.resolve().then(() => (fake.signIn === 'accept'
            ? callback({ access_token: accessToken, expires_in: 3599, scope: 'https://www.googleapis.com/auth/drive.file' })
            : failed?.({ type: 'popup_closed' })));
        },
      }) } };
    }})(${JSON.stringify(token)})`,
  }));
  await context.route('https://apis.google.com/js/api.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `(${(docs, topFolders) => {
      // Any setter returns the same object, so calls chain like Google's builders.
      const chainable = (onCall) => {
        const self = new Proxy({}, { get: (target, key) => (key === 'then' ? undefined : (...args) => onCall(key, args) ?? self) });
        return self;
      };
      window.google = window.google ?? {};
      window.google.picker = {
        Action: { PICKED: 'picked', CANCEL: 'cancel' },
        Feature: { MULTISELECT_ENABLED: 'multiselect' },
        ViewId: { DOCS: 'all' },
        // As in Google's Picker, a folder can be selected only in a view with
        // setSelectFolderEnabled(true); otherwise tapping it just opens it.
        DocsView: function DocsView() {
          return chainable((key, args) => {
            if (key === 'setSelectFolderEnabled' && args[0]) window.__fakeGoogle.foldersSelectable = true;
          });
        },
        PickerBuilder: function PickerBuilder() {
          let callback;
          return chainable((key, args) => {
            if (key === 'setCallback') [callback] = args;
            if (key === 'setAppId') [window.__fakeGoogle.appId] = args;
            if (key !== 'build') return undefined;
            return { setVisible: (visible) => {
              if (!visible) return;
              const { pick: names, foldersSelectable } = window.__fakeGoogle;
              const picked = [
                ...docs.filter((d) => names.includes(d.name)),
                ...(foldersSelectable ? topFolders.filter((f) => names.includes(f.name))
                  .map((f) => ({ ...f, mimeType: 'application/vnd.google-apps.folder' })) : []),
              ];
              Promise.resolve().then(() => callback(picked.length
                ? { action: 'picked', docs: picked }
                : { action: 'cancel', docs: [] }));
            } };
          });
        },
      };
      window.gapi = { load: (name, ready) => { (typeof ready === 'function' ? ready : ready.callback)(); } };
    }})(${JSON.stringify(shared.map(({ id, name, file }) => ({ id, name, sizeBytes: String(statSync(file).size) })))}, ${JSON.stringify(folderList.filter((f) => !f.path.includes('/')).map(({ id, name }) => ({ id, name })))})`,
  }));
  // Listing a folder (files.list with q="'<id>' in parents"), two entries a page
  // so that paging is used.
  await context.route(/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\?/, async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const folder = folderList.find((f) => params.get('q').includes(`'${f.id}' in parents`));
    if (dropped.has(folder.name)) return route.abort('connectionreset');
    if (denied.has(folder.name)) return route.fulfill({ status: 404, json: { error: { code: 404, message: 'File not found.' } } });
    const children = [
      ...folders[folder.path].map((n) => {
        const entry = shared.find((f) => f.name === n);
        return { id: entry.id, name: n, size: String(statSync(entry.file).size), mimeType: 'application/octet-stream' };
      }),
      ...folderList.filter((f) => f.path === `${folder.path}/${f.name}`)
        .map(({ id, name }) => ({ id, name, mimeType: 'application/vnd.google-apps.folder' })),
    ];
    const start = Number(params.get('pageToken') || 0);
    const next = start + 2 < children.length ? String(start + 2) : undefined;
    return route.fulfill({ json: { files: children.slice(start, start + 2), nextPageToken: next } });
  });
  await context.route('https://www.googleapis.com/drive/v3/files/*', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET') otherThanReads += 1;
    const entry = shared.find(({ id }) => new URL(request.url()).pathname.endsWith(`/${id}`));
    const signedIn = (await request.headerValue('authorization')) === `Bearer ${token}`;
    pickedForThisProject ||= (await page.evaluate(() => window.__fakeGoogle.appId)) === projectNumber;
    if (!entry || !signedIn || !pickedForThisProject || denied.has(entry.name)) {
      return route.fulfill({ status: 403, json: { error: { code: 403, message: 'The user does not have sufficient permissions for this file.' } } });
    }
    if (dropped.has(entry.name)) return route.abort('connectionreset');
    await held.get(entry.name);
    const data = readFileSync(entry.file);
    const range = /^bytes=(\d+)-(\d+)$/.exec((await request.headerValue('range')) ?? '');
    const [start, end] = range ? [Number(range[1]), Math.min(Number(range[2]), data.length - 1)] : [0, data.length - 1];
    served.set(entry.name, (served.get(entry.name) ?? 0) + end - start + 1);
    if (!range) return route.fulfill({ status: 200, body: data, headers: { 'Content-Length': String(data.length) } });
    return route.fulfill({
      status: 206,
      body: data.subarray(start, end + 1),
      headers: { 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': String(end - start + 1) },
    });
  });
  return {
    signInWillBeCancelled: () => page.evaluate(() => { window.__fakeGoogle.signIn = 'cancel'; }),
    willPick: (...names) => page.evaluate((n) => { window.__fakeGoogle.pick = n; }, names),
    deny: (name) => denied.add(name),
    // Reads of this file wait until the returned release() is called.
    holdReads: (name) => {
      let release;
      held.set(name, new Promise((resolve) => { release = resolve; }));
      return () => { held.delete(name); release(); };
    },
    dropConnection: (name) => dropped.add(name),
    signIns: () => page.evaluate(() => window.__fakeGoogle.signIns),
    requestsOtherThanReads: () => otherThanReads,
    bytesRead: (name) => (name ? served.get(name) ?? 0 : [...served.values()].reduce((a, b) => a + b, 0)),
  };
}

// Fire a Media Session action as the OS would (headphones, lock screen, media keys).
export async function mediaSessionAction(page, action) {
  await page.evaluate((a) => window.__mediaSessionHandlers[a]?.({ action: a }), action);
}

// Tap play (Face ID passes), and wait until media time actually advances.
export async function startPlaying(page) {
  await page.getByTestId('play-button').tap();
  await expectPlaying(page);
}
