// Playwright globalTeardown: merge every test's coverage into one report
// (coverage-report/: HTML, lcov.info, plus a per-file table in the log and in
// coverage-details.md).
import { COVERAGE, coverageReport } from './coverage.js';

export default async function globalTeardown() {
  if (COVERAGE) await coverageReport().generate();
}
