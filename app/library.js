// This device's catalogue: stored videos (a copy in Shaka offline storage, added
// with "Add video") and streamed videos (title and poster only; they play from
// Google Drive, streamed.js).
import { readHead, readParts, describeParts, registerParts, releaseParts, posterDataUrl } from './local-scheme.js';
import { listStreamed, saveStreamed } from './streamed.js';

// Never use Shaka's default track picker: on P3 screens it drops SDR video and
// stores 0 tracks without an error. kidsvideo prepare produces exactly one variant.
const pickSingleVariant = async (tracks) => tracks.filter((t) => t.type === 'variant').slice(0, 1);

async function withStorage(fn) {
  const storage = new shaka.offline.Storage();
  try {
    return await fn(storage);
  } finally {
    await storage.destroy();
  }
}

const isUsable = (c) => c.size > 0 && !c.isIncomplete;

const sizeText = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

// Space is checked against the video's real size (its .kidsvideo). Shaka's own
// check guesses the size from the manifest's peak bitrate, which for films is
// several times too big, and refuses videos that would fit.
async function checkSpace(title, needed) {
  const estimate = await navigator.storage.estimate();
  const free = Math.max(0, estimate.quota - estimate.usage);
  if (needed > free) {
    throw new Error(`not enough space on this device ("${title}" needs ${sizeText(needed)}, ${sizeText(free)} is free)`);
  }
}

/**
 * The catalogue, in library order: stored videos that can actually be played
 * (Shaka StoredContent) and streamed ones; playsFrom says which ('device' / 'drive').
 * A streamed video's download (a stored copy, appMetadata.downloadOf) is not
 * listed on its own: it is the streamed entry's `download` (its offline URI).
 */
export async function listVideos() {
  const usable = (await withStorage((s) => s.list())).filter(isUsable);
  const downloads = new Map(usable.filter((c) => c.appMetadata.downloadOf).map((c) => [c.appMetadata.downloadOf, c.offlineUri]));
  const stored = usable.filter((c) => !c.appMetadata.downloadOf).map((c) => ({ ...c, playsFrom: 'device' }));
  const streamed = (await listStreamed()).map((c) => ({ ...c, playsFrom: 'drive', download: downloads.get(c.offlineUri) }));
  return grouped([...stored, ...streamed]).sort(byLibraryOrder);
}

// No duplicates: a title already in the catalogue, stored or streamed, is
// refused before anything is stored (owner decision 2026-11-19).
async function refuseDuplicate(title) {
  const existing = await listVideos();
  if (existing.some((c) => c.appMetadata.title.toLocaleLowerCase() === title.toLocaleLowerCase())) {
    throw Object.assign(new Error(`"${title}" is already in the library`), { duplicate: true });
  }
}

/**
 * Add a video from Google Drive as streamed: reads kidsvideo.json, the part
 * headers and the poster, never the audio or video. Needs no free space.
 */
export async function addStreamed(source) {
  const { title, next } = await readHead(source);
  await refuseDuplicate(title);
  const { poster } = describeParts(await readParts(source, next));
  const entry = {
    offlineUri: `drive:${source.id}`,
    file: { id: source.id, name: source.name, size: source.size },
    appMetadata: { title, poster: await posterDataUrl(poster) },
  };
  await saveStreamed(entry);
  return entry;
}

/** A streamed video's local: URI for the player, read from Google Drive now. */
export async function streamUri(source) {
  const { next } = await readHead(source);
  return registerParts(await readParts(source, next), 'player');
}

/**
 * Series info lives in the title (= the .mpd file name):
 * "Bluey - S01E03 - Keepy Uppy" -> { series: 'Bluey', season: 1, episode: 3, episodeTitle: 'Keepy Uppy' }.
 * Any other "Name - Rest" -> { series: null, prefix: 'Name', episodeTitle: 'Rest' }; it joins
 * the series Name only next to another video of that name (see grouped).
 */
function parseTitle(title) {
  const m = /^(.+?) - S(\d{1,3})E(\d{1,3})(?: - (.*))?$/i.exec(title.trim());
  if (m) return { series: m[1], season: Number(m[2]), episode: Number(m[3]), episodeTitle: m[4] ?? '', title };
  const n = /^(.+?) - (.+)$/.exec(title.trim());
  if (n) return { series: null, prefix: n[1], episodeTitle: n[2], title };
  return { series: null, title };
}

// Each video's group: { name, season, episode, title } or null (standalone).
// "Name - S01E03 - …" is always an episode of Name; any other "Name - Rest" is
// in the series Name when at least one other video has that name before its
// " - " (owner decision 2026-11-27).
function grouped(list) {
  const parsed = list.map((c) => parseTitle(c.appMetadata.title));
  const count = new Map();
  for (const p of parsed) {
    const name = p.series ?? p.prefix;
    if (name) count.set(name, (count.get(name) ?? 0) + 1);
  }
  return list.map((c, i) => {
    const p = parsed[i];
    const name = p.series ?? (count.get(p.prefix) > 1 ? p.prefix : null);
    return { ...c, group: name ? { name, season: p.season, episode: p.episode, title: p.episodeTitle } : null };
  });
}

// A series sits among the other videos by its name; its numbered episodes come
// first, in season/episode order, then the others A–Z. Everything else is
// alphabetical, a video named like a series just before it.
function byLibraryOrder(a, b) {
  const key = (c) => (c.group ? c.group.name : c.appMetadata.title).toLocaleLowerCase();
  const byName = key(a).localeCompare(key(b));
  if (byName !== 0) return byName;
  const [ga, gb] = [a.group, b.group];
  if (!ga || !gb) return Boolean(ga) - Boolean(gb);
  const [na, nb] = [ga.season === undefined, gb.season === undefined];
  if (na !== nb) return na - nb;
  return na ? ga.title.localeCompare(gb.title) : ga.season - gb.season || ga.episode - gb.episode;
}

/**
 * Store one prepared video from a .kidsvideo byte source: a picked file, or a
 * streamed video's file in Google Drive when downloading it (downloadOf: the
 * streamed entry's URI). Reports progress 0..1.
 * Throws on any failure and leaves nothing behind: an entry that kept 0 tracks
 * is removed. Format, duplicates and space are checked from kidsvideo.json and
 * the file's size, before the parts are read.
 */
export async function importVideo(source, onProgress, downloadOf) {
  const { title, next } = await readHead(source);
  if (!downloadOf) await refuseDuplicate(title); // a download belongs to its streamed entry
  await checkSpace(title, source.size);
  const parts = await readParts(source, next);
  const { poster } = describeParts(parts);
  const posterUrl = await posterDataUrl(poster);
  const uri = registerParts(parts);
  try {
    return await storeParts(uri, title, posterUrl, onProgress, downloadOf);
  } finally {
    releaseParts(uri);
  }
}

function storeParts(uri, title, posterUrl, onProgress, downloadOf) {
  return withStorage(async (storage) => {
    storage.configure({
      offline: {
        trackSelectionCallback: pickSingleVariant,
        downloadSizeCallback: async () => true, // checked by checkSpace, with the real size
        progressCallback: (_content, progress) => onProgress?.(progress),
      },
    });
    const stored = await storage.store(uri, { title, poster: posterUrl, downloadOf }).promise;
    const kept = stored.tracks.filter((t) => t.type === 'variant').length;
    if (!kept || !stored.size) {
      await storage.remove(stored.offlineUri);
      throw new Error(`"${title}" can't be played on this device (no playable tracks).`);
    }
    return stored;
  });
}

export async function removeVideo(offlineUri) {
  await withStorage((s) => s.remove(offlineUri));
}
