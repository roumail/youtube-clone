// Minimal static server for tests (no dependencies). Serves the repo root so
// /app/ and /fixtures/ are both reachable. Supports HTTP Range requests,
// which Shaka needs for byte-range (on-demand profile) DASH segments.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.argv[2] ?? 4173);
const root = path.resolve(import.meta.dirname, '..');
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.mpd': 'application/dash+xml', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') return void res.writeHead(200).end('ok');

  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) return void res.writeHead(403).end();
  if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return void res.writeHead(404).end('not found');
    const headers = {
      'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range) {
      const start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
      const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
      if (start > end || start >= stat.size) {
        return void res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
      return void fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    fs.createReadStream(file).pipe(res);
  });
}).listen(port, '127.0.0.1', () => console.log(`test server on http://127.0.0.1:${port}`));
