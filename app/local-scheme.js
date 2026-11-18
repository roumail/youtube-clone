// Shaka "local:" scheme plugin (DESIGN.md §2): lets Shaka read a packaged video
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
  const { Error: ShakaError, AbortableOperation } = shaka.util;
  const name = decodeURIComponent(uri.startsWith(HOST) ? uri.slice(HOST.length) : uri.split('/').pop());
  const file = picked.get(name);
  if (!file) {
    return AbortableOperation.failed(new ShakaError(
      ShakaError.Severity.CRITICAL, ShakaError.Category.NETWORK, ShakaError.Code.BAD_HTTP_STATUS,
      uri, 404, `not among picked files: ${name}`, {}, request.type ?? null, uri,
    ));
  }
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers?.Range ?? request.headers?.range ?? '');
  const part = range ? file.slice(Number(range[1]), range[2] ? Number(range[2]) + 1 : undefined) : file;
  const op = part.arrayBuffer().then((data) => ({
    uri, originalUri: uri, data, headers: {}, status: range ? 206 : 200, fromCache: false,
  }));
  return AbortableOperation.notAbortable(op);
}

let registered = false;
export function installLocalScheme() {
  if (registered) return;
  shaka.net.NetworkingEngine.registerScheme('local', plugin,
    shaka.net.NetworkingEngine.PluginPriority.APPLICATION);
  registered = true;
}

/** Read a picked image as a data: URL (stored in appMetadata.poster). */
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
