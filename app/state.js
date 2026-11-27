// The app's one state object and what every part of the UI shares: finding an
// element by its test id, redrawing (update), going to a route, and reading
// the catalogue again. app.js draws the screens (render) and registers it here.
import { playerState } from './player.js';
import { signedIn, signIn } from './drive.js';
import { listVideos } from './library.js';

export const $ = (testid, root = document) => root.querySelector(`[data-testid="${testid}"]`);

export const state = {
  route: { name: 'library' },
  setUp: false, // first run is done: Face ID is set up on this device
  library: [], // the catalogue: stored and streamed videos (library.js listVideos)
  settingsUnlocked: false,
  search: '', // library search text (not saved); typing needs unlocking
  searchUnlocked: false, // until the search field loses focus
  // Unlock prompt: { purpose: 'setup' | 'import' | 'drive' | 'download' | 'settings' | 'play' | 'search',
  //                 mode: 'unavailable' | 'setup' | 'unlock' | 'continue', asking, failures }
  // ('unavailable': no Face ID, Touch ID or passcode; 'setup': first run;
  //  'unlock': Face ID failed, was cancelled, or waits for a tap; 'continue':
  //  Face ID passed, and an action that needs a tap waits for "Continue").
  // While asking, Face ID is being asked and the prompt is out of sight.
  prompt: null,
  returnTo: '#/library', // where the player's Back goes (the library or a series list)
  features: {}, // running optional features, by id (features.js)
  jobs: [], // adds and downloads, one row each: { phase: 'storing' | 'done' | 'error' | 'cancelled', progress, message, cancel }
  signingIn: null, // a Google sign-in started by the tap that opened a streamed video
  online: navigator.onLine, // with no connection, streamed videos can't play
  downloadedOnly: false, // the library's "Downloaded" filter (not saved)
  downloading: new Set(), // the streamed videos being downloaded (their URIs)
  // Videos ticked to play in a row (catalogue ids, in the order ticked); null
  // while not selecting. Not saved.
  selection: null,
  // The playlist playing: { ids, index, advancing }; null for a video played alone.
  playlist: null,
  // A picked folder's videos, to choose from: { title, from, sourceOf,
  // items: [{ doc, name, inLibrary, ticked }] }; null when not choosing.
  choosing: null,
};

export const go = (hash) => { location.hash = hash; };

let render;
/** app.js gives its render(state) here, once, when it loads. */
export const setRender = (fn) => { render = fn; };
/** Redraw every screen from state. */
export const update = () => render(state);

export async function refreshLibrary() {
  state.library = await listVideos();
}

// A streamed video that isn't downloaded plays from Google Drive.
export const streamsNow = (c) => c.playsFrom === 'drive' && !c.download;
export const playing = () => state.library.find((c) => c.offlineUri === playerState.offlineUri);
// Call within a tap: the sign-in in progress, or null if still signed in.
export const signInIfNeeded = () => (signedIn() ? null : signIn());
// Plays with no connection: stored, or streamed and downloaded.
export const onDevice = (c) => !streamsNow(c);
