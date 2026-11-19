// The video library: Shaka offline storage.
import { expandPick, describePick, registerPickedFiles, fileToDataUrl } from './local-scheme.js';

// Never use Shaka's default track picker: on P3 screens it drops SDR video and
// stores 0 tracks without an error. prepare.sh produces exactly one variant.
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

// Space is checked against the video's real size (its parts). Shaka's own check
// guesses the size from the manifest's peak bitrate, which for films is several
// times too big, and refuses videos that would fit.
async function checkSpace(title, files) {
  const estimate = await navigator.storage.estimate();
  const needed = files.reduce((sum, f) => sum + f.size, 0);
  const free = Math.max(0, estimate.quota - estimate.usage);
  if (needed > free) {
    throw new Error(`not enough space on this device ("${title}" needs ${sizeText(needed)}, ${sizeText(free)} is free)`);
  }
}

/** Stored videos that can actually be played, as Shaka StoredContent. */
export async function listVideos() {
  const all = await withStorage((s) => s.list());
  return all.filter(isUsable).sort(byLibraryOrder);
}

/**
 * Series info lives in the title (= the .mpd file name):
 * "Bluey - S01E03 - Keepy Uppy" -> { series: 'Bluey', season: 1, episode: 3, episodeTitle: 'Keepy Uppy' }.
 * Anything else is a standalone video: { series: null }.
 */
export function parseTitle(title = '') {
  const m = /^(.+?) - S(\d{1,3})E(\d{1,3})(?: - (.*))?$/i.exec(title.trim());
  if (!m) return { series: null, title };
  return { series: m[1], season: Number(m[2]), episode: Number(m[3]), episodeTitle: m[4] ?? '', title };
}

// Episodes of a series sit together, in season/episode order; everything is
// otherwise alphabetical (a series sorts by its name).
function byLibraryOrder(a, b) {
  const pa = parseTitle(a.appMetadata?.title);
  const pb = parseTitle(b.appMetadata?.title);
  const key = (p) => (p.series ?? p.title).toLocaleLowerCase();
  const byName = key(pa).localeCompare(key(pb));
  if (byName !== 0) return byName;
  if (pa.series && pb.series) return pa.season - pb.season || pa.episode - pb.episode;
  return Boolean(pa.series) - Boolean(pb.series);
}

/**
 * Store one prepared video from the picked files (manifest, video, audio,
 * poster). Reports progress 0..1. Throws on any failure and leaves nothing
 * behind: an entry that kept 0 tracks is removed.
 */
export async function importVideo(picked, onProgress) {
  // Exactly one .kidsvideo file per video.
  const files = await expandPick(picked);
  const { title, poster } = describePick(files);
  // No duplicates: a title already in the library is refused before anything
  // is stored (owner decision 2026-11-19).
  const existing = await listVideos();
  if (existing.some((c) => c.appMetadata.title.toLocaleLowerCase() === title.toLocaleLowerCase())) {
    throw new Error(`"${title}" is already in the library`);
  }
  await checkSpace(title, files);
  const uri = registerPickedFiles(files);
  const posterUrl = await fileToDataUrl(poster);
  return withStorage(async (storage) => {
    storage.configure({
      offline: {
        trackSelectionCallback: pickSingleVariant,
        downloadSizeCallback: async () => true, // checked by checkSpace, with the real size
        progressCallback: (_content, progress) => onProgress?.(progress),
      },
    });
    const stored = await storage.store(uri, { title, poster: posterUrl }).promise;
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
