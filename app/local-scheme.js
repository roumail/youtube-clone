// Shaka "local:" scheme plugin: lets Shaka read a packaged video
// from files the parent picked (Files / Google Drive / Finder) instead of HTTP.
//
//   const uri = registerPickedFiles(fileList);   // -> "local://pick/My%20Video.mpd"
//   await storage.store(uri, { title, poster }).promise;
//
// Relative segment URLs in the manifest ("video.mp4") resolve against
// local://pick/, so every request maps to a picked file by name. Byte-range
// requests (DASH on-demand profile) are served with File.slice, which is lazy:
// only the requested bytes are read.

const HOST = 'local://pick/';
let picked = new Map();

export const PICK_SET = ['.mpd', 'video.mp4', 'audio.mp4', 'poster.jpg'];

// ---------- single-file container (.kidsvideo) ----------
// A .kidsvideo is an uncompressed tar of "<Title>.mpd", video.mp4, audio.mp4
// and poster.jpg (tools/pack.sh). We read only the 512-byte headers and hand
// out each part as a lazy slice of the picked file: nothing is copied.
export const CONTAINER_EXT = '.kidsvideo';
const isContainer = (f) => f.name.toLowerCase().endsWith(CONTAINER_EXT);

const text = (bytes, start, len) => {
  const raw = bytes.subarray(start, start + len);
  const end = raw.indexOf(0);
  return new TextDecoder().decode(end === -1 ? raw : raw.subarray(0, end));
};
const octal = (bytes, start, len) => parseInt(text(bytes, start, len).trim() || '0', 8);

async function readContainer(file) {
  const parts = [];
  let offset = 0;
  let paxPath = null;
  while (offset + 512 <= file.size) {
    const h = new Uint8Array(await file.slice(offset, offset + 512).arrayBuffer());
    if (h.every((b) => b === 0)) break; // end of archive
    const size = octal(h, 124, 12);
    const type = String.fromCharCode(h[156] || 48); // '0' when NUL
    const prefix = text(h, 257, 6).startsWith('ustar') ? text(h, 345, 155) : '';
    const dataStart = offset + 512;
    if (type === 'x') {
      // pax extended header: may carry the real path of the next entry
      const pax = await file.slice(dataStart, dataStart + size).text();
      paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(pax)?.[1] ?? null;
    } else if (type === '0' || type === '7') {
      const name = paxPath ?? (prefix ? `${prefix}/${text(h, 0, 100)}` : text(h, 0, 100));
      paxPath = null;
      const base = name.split('/').pop();
      if (!base.startsWith('._')) {
        parts.push(new File([file.slice(dataStart, dataStart + size)], base));
      }
    } else {
      paxPath = null; // directories, links, global headers: ignored
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  if (!parts.length) throw new Error(`${file.name} isn't a readable ${CONTAINER_EXT} file`);
  return parts;
}

/** The pick must be exactly one .kidsvideo; it becomes its 4 parts. */
export async function expandPick(files) {
  const list = [...files];
  if (list.length !== 1 || !isContainer(list[0])) {
    throw new Error(`pick the video's ${CONTAINER_EXT} file (one file per video)`);
  }
  return readContainer(list[0]);
}

/** Check the picked files form one prepared video. Returns {manifest, poster, title} or throws. */
export function describePick(files) {
  const list = [...files];
  const manifests = list.filter((f) => f.name.toLowerCase().endsWith('.mpd'));
  if (manifests.length !== 1) throw new Error(`expected exactly one .mpd file, got ${manifests.length}`);
  const names = new Set(list.map((f) => f.name));
  const missing = ['video.mp4', 'audio.mp4', 'poster.jpg'].filter((n) => !names.has(n));
  if (missing.length) throw new Error(`missing: ${missing.join(', ')}`);
  const manifest = manifests[0];
  return {
    manifest,
    poster: list.find((f) => f.name === 'poster.jpg'),
    title: manifest.name.replace(/\.mpd$/i, ''),
  };
}

/** Make these files readable by Shaka; returns the local: URI of the manifest. */
export function registerPickedFiles(files) {
  const { manifest } = describePick(files);
  picked = new Map([...files].map((f) => [f.name, f]));
  return HOST + encodeURIComponent(manifest.name);
}

function plugin(uri, request) {
  const file = picked.get(decodeURIComponent(uri.slice(HOST.length)));
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers?.Range ?? request.headers?.range ?? '');
  const part = range ? file.slice(Number(range[1]), range[2] ? Number(range[2]) + 1 : undefined) : file;
  const op = part.arrayBuffer().then((data) => ({
    uri, originalUri: uri, data, headers: {}, status: range ? 206 : 200, fromCache: false,
  }));
  return shaka.util.AbortableOperation.notAbortable(op);
}

export function installLocalScheme() {
  shaka.net.NetworkingEngine.registerScheme('local', plugin,
    shaka.net.NetworkingEngine.PluginPriority.APPLICATION);
}

/** Read a picked image as a data: URL (stored in appMetadata.poster). */
export function fileToDataUrl(file) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(file);
  });
}
