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
    ['console-details', { metrics: ['lines', 'branches'] }],
    ['markdown-details', { metrics: ['lines', 'branches'] }],
  ],
};

export const coverageReport = () => MCR(options);

// Playwright globalSetup: start from an empty cache.
export default async function globalSetup() {
  if (COVERAGE) coverageReport().cleanCache();
}
