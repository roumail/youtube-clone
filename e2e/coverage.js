// Line and branch coverage of app/ (not app/vendor/), like pytest-cov.
// Collected per test in the Chromium project only (V8 coverage) when COVERAGE
// is set, merged after the run. Files no test loads count as 0%.
import MCR from 'monocart-coverage-reports';

export const COVERAGE = Boolean(process.env.COVERAGE);

const options = {
  name: 'App coverage (app/, Chromium)',
  outputDir: './coverage-report',
  entryFilter: (entry) => /\/app\//.test(entry.url) && !/\/app\/vendor\//.test(entry.url),
  // "127.0.0.1-4173/app/app.js" -> "app/app.js", matching the files on disk.
  sourcePath: (p) => (p.includes('app/') ? p.slice(p.indexOf('app/')) : p),
  all: { dir: ['./app'], filter: { '**/vendor/**': false, '**/*.js': true } },
  reports: [
    'v8',
    'lcovonly', // lcov.info, read by tools/diff-coverage.mjs
    ['console-details', { metrics: ['lines', 'branches'] }],
    ['markdown-details', { metrics: ['lines', 'branches'] }],
  ],
};

export const coverageReport = () => MCR(options);

// Playwright globalSetup: start from an empty cache.
export default async function globalSetup() {
  if (COVERAGE) coverageReport().cleanCache();
}

// The service worker runs outside the page, so page coverage can't see it.
// With Chromium's debugging port open (COVERAGE only), this attaches to every
// service worker before it starts, records its V8 coverage, and returns it in
// the same format as page coverage. Node's built-in WebSocket; no dependency.
export async function recordServiceWorkers(port) {
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let lastId = 0;
  const pending = new Map();
  const workers = new Set();
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++lastId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  ws.onmessage = async ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p?.reject(new Error(msg.error.message));
      else p?.resolve(msg.result);
      return;
    }
    if (msg.method !== 'Target.attachedToTarget') return;
    const { sessionId, targetInfo, waitingForDebugger } = msg.params;
    try {
      if (targetInfo.type === 'service_worker') {
        await send('Profiler.enable', {}, sessionId);
        await send('Profiler.startPreciseCoverage', { callCount: true, detailed: true }, sessionId);
        await send('Debugger.enable', {}, sessionId);
        workers.add(sessionId);
      }
    } finally {
      if (waitingForDebugger) send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
    }
  };
  await send('Target.setAutoAttach', {
    autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
    filter: [{ type: 'service_worker', exclude: false }, { exclude: true }],
  });
  return {
    async stop() {
      const entries = [];
      for (const sessionId of workers) {
        try {
          const { result } = await send('Profiler.takePreciseCoverage', {}, sessionId);
          for (const script of result.filter((s) => s.url.endsWith('/sw.js'))) {
            const { scriptSource } = await send('Debugger.getScriptSource', { scriptId: script.scriptId }, sessionId);
            entries.push({ url: script.url, source: scriptSource, functions: script.functions });
          }
        } catch {
          // the worker already stopped: its coverage is gone
        }
      }
      await send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }).catch(() => {});
      ws.close();
      return entries;
    },
  };
}
