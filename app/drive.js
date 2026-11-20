// Google Drive, the shelf that streamed videos play from: Google's sign-in (a
// read-only token: drive.readonly, so a picked folder can be listed), Google's
// Picker, and a byte source that reads ranges of a file with the current token.
// Set up only when the deploy wrote google.json (the client ID and Picker API
// key); otherwise "Add from Google Drive" stays hidden.
import { requireContainerName } from './local-scheme.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export const FOLDER = 'application/vnd.google-apps.folder';
let config;
// The sign-in, { value, expiresAt }, kept across reopening the app until it
// runs out. (Named after the scope: a sign-in for an earlier scope is not reused.)
const KEPT = 'kids-google-sign-in-readonly';
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

// A Drive API request with the current sign-in (waiting for one in progress).
// name: the file or folder, for the error.
async function driveFetch(url, name, headers) {
  await pending;
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token.value}`, ...headers } });
  } catch {
    throw Object.assign(new Error('the connection to Google Drive was lost'), { offline: true });
  }
  if (!res.ok) throw new Error(`no access to "${name}" in Google Drive`);
  return res;
}

/** A Drive file as a byte source; reads wait for a sign-in in progress. */
export function driveSource({ id, name, size }) {
  return {
    id,
    name,
    size,
    read: async (start, end) => (await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, name,
      { Range: `bytes=${start}-${end - 1}` })).arrayBuffer(),
  };
}

/**
 * The .kidsvideo files in a Drive folder and its subfolders, as Picker-like
 * docs ({ id, name, sizeBytes }); other files are left out.
 */
export async function listFolder(folder) {
  const found = [];
  let pageToken = '';
  do {
    const q = encodeURIComponent(`'${folder.id}' in parents and trashed = false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,size,mimeType)`
      + `&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&pageToken=${pageToken}`;
    const page = await (await driveFetch(url, folder.name, {})).json();
    for (const f of page.files) {
      if (f.mimeType === FOLDER) found.push(...await listFolder(f));
      else if (f.name.toLowerCase().endsWith('.kidsvideo')) found.push({ id: f.id, name: f.name, sizeBytes: f.size });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return found;
}

function openPicker(onPicked) {
  const { picker } = google;
  new picker.PickerBuilder()
    .addView(new picker.DocsView(picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(true))
    .addView(new picker.DocsView(picker.ViewId.DOCS).setOwnedByMe(false).setSelectFolderEnabled(true))
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
