// Shaka "local:" scheme plugin: lets Shaka read a packaged video from a byte
// source (a .kidsvideo the parent picked) instead of HTTP.
//
//   const uri = registerParts(parts);   // -> "local://v1/My%20Video.mpd"
//   await storage.store(uri, { title, poster }).promise;
//   releaseParts(uri);
//
// Each registration has its own host (every video's parts have the same
// names, and several can be read at once: adds, downloads, playback).
// Relative segment URLs in the manifest ("video.mp4") resolve against it, so
// every request maps to a part by name. Byte-range requests (DASH on-demand
// profile) read just those bytes of the source.

const registered = new Map(); // host -> Map(part name -> part)
let lastHost = 0;
const parse = (uri) => /^local:\/\/([^/]+)\/(.*)$/.exec(uri); // [, host, part name]

// ---------- single-file container (.kidsvideo) ----------
// A .kidsvideo (format 2, tools/kidsvideo) is an uncompressed tar of
// kidsvideo.json ({"format":2,"title":…}, always first), "<Title>.mpd",
// video.mp4, audio.mp4 and poster.jpg. It is read through a byte source,
// { name, size, read(start, end) }: only the 512-byte headers and
// kidsvideo.json are read up front; each part is read later, as Shaka asks.
export const CONTAINER_EXT = '.kidsvideo';

export function requireContainerName(name) {
  if (!name.toLowerCase().endsWith(CONTAINER_EXT)) throw new Error(`${name} isn't a ${CONTAINER_EXT} file`);
}

export function pickedSource(file) {
  requireContainerName(file.name);
  return { name: file.name, size: file.size, read: (start, end) => file.slice(start, end).arrayBuffer() };
}

// The tar header at `offset`, or null at the end of the archive (or if it isn't one).
async function header(source, offset) {
  const h = new Uint8Array(await source.read(offset, offset + 512));
  if (String.fromCharCode(...h.subarray(257, 262)) !== 'ustar') return null;
  // bsdtar ends the size with a space, GNU tar with a NUL: parseInt stops at either.
  const size = parseInt(String.fromCharCode(...h.subarray(124, 136)), 8);
  const data = offset + 512;
  return { name: new TextDecoder().decode(h.subarray(0, h.indexOf(0))), size, data, next: data + Math.ceil(size / 512) * 512 };
}

/** Format and title, from kidsvideo.json alone. Returns { title, next }, `next` being where the parts start. */
export async function readHead(source) {
  const h = await header(source, 0);
  if (!h) throw new Error(`${source.name} isn't a readable ${CONTAINER_EXT} file`);
  const meta = h.name === 'kidsvideo.json'
    ? JSON.parse(new TextDecoder().decode(await source.read(h.data, h.data + h.size)))
    : {};
  if (meta.format !== 2) throw new Error(`${source.name} was made by an older version of the tools: prepare it again`);
  return { title: meta.title, next: h.next };
}

/** The parts after kidsvideo.json, each { name, size, read(start, end) }. */
export async function readParts(source, offset) {
  const parts = [];
  for (let h = await header(source, offset); h; h = await header(source, h.next)) {
    const { data } = h;
    parts.push({ name: h.name, size: h.size, read: (start, end) => source.read(data + start, data + end) });
  }
  return parts;
}

/** Check the parts form one prepared video. Returns {manifest, poster} or throws. */
export function describeParts(parts) {
  const manifests = parts.filter((p) => p.name.toLowerCase().endsWith('.mpd'));
  if (manifests.length !== 1) throw new Error(`expected exactly one .mpd file, got ${manifests.length}`);
  const names = new Set(parts.map((p) => p.name));
  const missing = ['video.mp4', 'audio.mp4', 'poster.jpg'].filter((n) => !names.has(n));
  if (missing.length) throw new Error(`missing: ${missing.join(', ')}`);
  return { manifest: manifests[0], poster: parts.find((p) => p.name === 'poster.jpg') };
}

/**
 * Make these parts readable by Shaka; returns the local: URI of the manifest.
 * `host` reuses a fixed slot (the player's: only one video plays at a time);
 * otherwise the parts get a new one, to be freed with releaseParts.
 */
export function registerParts(parts, host = `v${++lastHost}`) {
  const { manifest } = describeParts(parts);
  registered.set(host, new Map(parts.map((p) => [p.name, p])));
  return `local://${host}/${encodeURIComponent(manifest.name)}`;
}

export function releaseParts(uri) {
  registered.delete(parse(uri)[1]);
}

function plugin(uri, request) {
  const [, host, name] = parse(uri);
  const part = registered.get(host).get(decodeURIComponent(name));
  const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers?.Range ?? request.headers?.range ?? '');
  const op = (range ? part.read(Number(range[1]), Number(range[2]) + 1) : part.read(0, part.size)).then((data) => ({
    uri, originalUri: uri, data, headers: {}, status: range ? 206 : 200, fromCache: false,
  }));
  return shaka.util.AbortableOperation.notAbortable(op);
}

export function installLocalScheme() {
  shaka.net.NetworkingEngine.registerScheme('local', plugin,
    shaka.net.NetworkingEngine.PluginPriority.APPLICATION);
}

/** The poster part as a data: URL (stored in appMetadata.poster). */
export async function posterDataUrl(poster) {
  const blob = new Blob([await poster.read(0, poster.size)]);
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
}
