// Google Drive, the shelf that streamed videos play from: Google's sign-in (a
// token for drive.file: only the files picked here), Google's Picker, and a
// byte source that reads ranges of a file with the current token.
// Set up only when the deploy wrote google.json (the client ID and Picker API
// key); otherwise "Add from Google Drive" stays hidden.
import { requireContainerName } from './local-scheme.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
let config;
// The sign-in, { value, expiresAt }, kept across reopening the app until it runs out.
const KEPT = 'kids-google-sign-in';
let token = JSON.parse(localStorage.getItem(KEPT));
let pending = null; // a sign-in in progress

const loadScript = (src) => new Promise((resolve, reject) => {
  const script = document.createElement('script');
  script.src = src;
  script.onload = resolve;
  script.onerror = reject;
  document.head.append(script);
});

/** True once Google's sign-in and Picker are ready. */
export async function initDrive() {
  const res = await fetch('google.json', { cache: 'no-cache' }).catch(() => null);
  if (!res?.ok) return false;
  config = await res.json();
  await Promise.all([loadScript('https://accounts.google.com/gsi/client'), loadScript('https://apis.google.com/js/api.js')]);
  await new Promise((resolve) => { gapi.load('picker', resolve); });
  return true;
}

/** True while this session's sign-in is valid (it ends a minute before Google's does). */
export const signedIn = () => Boolean(token) && Date.now() < token.expiresAt;
/** When this session's sign-in ends (ms since 1970). */
export const signInEnds = () => token.expiresAt;

/**
 * Google's sign-in pop-up. Call it within a tap. Resolves once
 * signed in; rejects if the pop-up was closed or Google isn't reachable.
 */
export function signIn() {
  pending = new Promise((resolve, reject) => {
    google.accounts.oauth2.initTokenClient({
      client_id: config.clientId,
      scope: SCOPE,
      prompt: '', // once the account has approved the app, Google asks nothing
      callback: (response) => {
        token = { value: response.access_token, expiresAt: Date.now() + (response.expires_in - 60) * 1000 };
        localStorage.setItem(KEPT, JSON.stringify(token));
        resolve();
      },
      error_callback: () => reject(new Error('the Google sign-in was closed')),
    }).requestAccessToken();
  }).finally(() => { pending = null; });
  return pending;
}

/** A Drive file as a byte source; reads wait for a sign-in in progress. */
export function driveSource({ id, name, size }) {
  return {
    id,
    name,
    size,
    read: async (start, end) => {
      await pending;
      let res;
      try {
        res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
          headers: { Authorization: `Bearer ${token.value}`, Range: `bytes=${start}-${end - 1}` },
        });
      } catch {
        throw Object.assign(new Error('the connection to Google Drive was lost'), { offline: true });
      }
      if (!res.ok) throw new Error(`no access to "${name}" in Google Drive`);
      return res.arrayBuffer();
    },
  };
}

function openPicker(onPicked) {
  const { picker } = google;
  new picker.PickerBuilder()
    .addView(new picker.DocsView(picker.ViewId.DOCS).setIncludeFolders(true))
    .addView(new picker.DocsView(picker.ViewId.DOCS).setOwnedByMe(false))
    .enableFeature(picker.Feature.MULTISELECT_ENABLED)
    .setOAuthToken(token.value)
    .setDeveloperKey(config.apiKey)
    .setAppId(config.clientId.split('-')[0]) // the project number starts the client ID
    .setCallback((data) => {
      if (data.action !== picker.Action.PICKED) return;
      onPicked(data.docs, (doc) => {
        requireContainerName(doc.name);
        return driveSource({ id: doc.id, name: doc.name, size: Number(doc.sizeBytes) });
      });
    })
    .build()
    .setVisible(true);
}

/**
 * Called within the parent's tap (the PIN's OK): Google's sign-in pop-up, unless
 * this session's sign-in is still valid, then the Picker. Closing either adds
 * nothing. onPicked(docs, sourceOf) gets the picked files.
 */
export function pickFromDrive(onPicked) {
  if (signedIn()) return openPicker(onPicked);
  signIn().then(() => openPicker(onPicked), () => {});
}
