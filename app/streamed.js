// Streamed videos in this device's catalogue: what was picked in Google Drive,
// kept as { offlineUri: 'drive:<file id>', file: { id, name, size },
// appMetadata: { title, poster } }. Nothing of the video itself is stored.
const DB = 'kids-catalogue';
const STORE = 'streamed';

const done = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = reject;
});

async function withStore(mode, fn) {
  const open = indexedDB.open(DB, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: 'offlineUri' });
  const db = await done(open);
  try {
    return await done(fn(db.transaction(STORE, mode).objectStore(STORE)));
  } finally {
    db.close();
  }
}

export const listStreamed = () => withStore('readonly', (s) => s.getAll());
export const saveStreamed = (entry) => withStore('readwrite', (s) => s.put(entry));
export const hideStreamed = (offlineUri) => withStore('readwrite', (s) => s.delete(offlineUri));
