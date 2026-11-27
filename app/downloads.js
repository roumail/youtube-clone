// Downloads: a stored copy of a streamed video for offline viewing, started
// from the selection bar; its tile badge; and Settings' list of downloads.
import { driveSource } from './drive.js';
import { importVideo, removeVideo } from './library.js';
import { state, update, refreshLibrary, streamsNow } from './state.js';
import { startJob, endJob, onJobProgress } from './jobs.js';

// A streamed video's tile says whether it is downloaded (a "Downloaded"
// badge), and is dimmed with no connection unless it is. Stored videos are
// always on the device. Downloading is from the selection bar.
export function downloadControls(li, c) {
  if (c.playsFrom !== 'drive') return;
  li.dataset.downloaded = c.download ? 'true' : (state.downloading.has(c.offlineUri) ? 'downloading' : 'false');
  if (!state.online && streamsNow(c)) li.dataset.unavailable = 'true';
  if (!c.download) return;
  const badge = document.createElement('span');
  badge.dataset.testid = 'downloaded-badge';
  badge.textContent = 'Downloaded';
  li.append(badge);
}

// Ticked videos that Download would download: streamed, not downloaded or
// downloading. None with no connection (it would only fail).
export const toDownload = (s) => (s.online ? s.library.filter((c) => s.selection.includes(c.offlineUri)
  && c.playsFrom === 'drive' && !c.download && !s.downloading.has(c.offlineUri)) : []);

// Settings lists the downloads: removing one frees the space, and the video
// streams again. (Videos leave the library from the selection bar: Remove.)
export function downloadRow(c) {
  const li = document.createElement('li');
  li.dataset.testid = 'settings-download-item';
  const title = document.createElement('span');
  title.textContent = c.appMetadata.title;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.testid = 'remove-download-button';
  button.textContent = 'Remove download';
  button.addEventListener('click', () => onRemoveDownload(c.download));
  li.append(title, button);
  return li;
}

async function onRemoveDownload(offlineUri) {
  await removeVideo(offlineUri);
  await refreshLibrary();
  update();
}

// Download a streamed video: a stored copy for offline viewing, kept with it.
// Cancel stops it at its next read of Google Drive; nothing of it is kept.
export async function downloadVideo(entry, signing) {
  const { title } = entry.appMetadata;
  const cancel = new AbortController();
  state.downloading.add(entry.offlineUri);
  const job = startJob(`Downloading "${title}"…`, cancel);
  const source = driveSource(entry.file);
  const read = source.read;
  source.read = (start, end) => {
    cancel.signal.throwIfAborted();
    return read(start, end);
  };
  try {
    await signing;
    await importVideo(source, onJobProgress(job), entry.offlineUri);
    endJob(job, 'done', `Downloaded "${title}".`);
  } catch (e) {
    if (cancel.signal.aborted) endJob(job, 'cancelled', `Download of "${title}" cancelled.`);
    else endJob(job, 'error', `Couldn't download "${title}": ${e.message}`);
  }
  state.downloading.delete(entry.offlineUri);
  await refreshLibrary();
  update();
}
