// Google Drive as a source of .kidsvideo files: Google's sign-in (a token for
// drive.file: only the files picked here), Google's Picker, and a byte source
// that reads ranges of a picked file with that token.
// Set up only when the deploy wrote google.json (the client ID and Picker API
// key); otherwise "Add from Google Drive" stays hidden.
import { requireContainerName } from './local-scheme.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
let config;
let token = null; // { value, expiresAt } for this session

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

function source(doc, access) {
  requireContainerName(doc.name);
  return {
    name: doc.name,
    size: Number(doc.sizeBytes),
    read: async (start, end) => {
      let res;
      try {
        res = await fetch(`https://www.googleapis.com/drive/v3/files/${doc.id}?alt=media`, {
          headers: { Authorization: `Bearer ${access}`, Range: `bytes=${start}-${end - 1}` },
        });
      } catch {
        throw new Error('the connection to Google Drive was lost');
      }
      if (!res.ok) throw new Error(`no access to "${doc.name}" in Google Drive`);
      return res.arrayBuffer();
    },
  };
}

function openPicker(access, onPicked) {
  const { picker } = google;
  new picker.PickerBuilder()
    .addView(new picker.DocsView(picker.ViewId.DOCS).setIncludeFolders(true))
    .addView(new picker.DocsView(picker.ViewId.DOCS).setOwnedByMe(false))
    .enableFeature(picker.Feature.MULTISELECT_ENABLED)
    .setOAuthToken(access)
    .setDeveloperKey(config.apiKey)
    .setAppId(config.clientId.split('-')[0]) // the project number starts the client ID
    .setCallback((data) => {
      if (data.action === picker.Action.PICKED) onPicked(data.docs, (doc) => source(doc, access));
    })
    .build()
    .setVisible(true);
}

/**
 * Called within the parent's tap (the PIN's OK): Google's sign-in pop-up, unless
 * this session's token is still valid, then the Picker. Closing either adds
 * nothing. onPicked(docs, sourceOf) gets the picked files.
 */
export function pickFromDrive(onPicked) {
  if (token && Date.now() < token.expiresAt) return openPicker(token.value, onPicked);
  google.accounts.oauth2.initTokenClient({
    client_id: config.clientId,
    scope: SCOPE,
    callback: (response) => {
      token = { value: response.access_token, expiresAt: Date.now() + (response.expires_in - 60) * 1000 };
      openPicker(token.value, onPicked);
    },
    error_callback: () => {},
  }).requestAccessToken();
}
