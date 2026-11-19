#!/usr/bin/env node
// Every line and branch of app/ (not app/vendor/) that a change adds or edits
// must be run by some scenario. Lines excluded with a coverage-ignore comment
// aren't in the report, so they pass.
//
//   node tools/diff-coverage.mjs <git range> <lcov.info>
//   node tools/diff-coverage.mjs origin/main...HEAD coverage-report/lcov.info
//
// Exits 1 and lists file:line for anything uncovered.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [range, lcovPath] = process.argv.slice(2);
if (!range || !lcovPath) {
  console.error('usage: node tools/diff-coverage.mjs <git range> <lcov.info>');
  process.exit(2);
}

const changed = new Map();
let file = null;
const diff = execFileSync('git', ['diff', '-U0', '--no-color', '--end-of-options', range, '--', 'app/', ':(exclude)app/vendor/'], { encoding: 'utf8' });
for (const line of diff.split('\n')) {
  if (line.startsWith('+++ ')) {
    file = line.startsWith('+++ b/') && line.endsWith('.js') ? line.slice(6) : null;
    continue;
  }
  const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!hunk || !file) continue;
  const first = Number(hunk[1]);
  const lines = changed.get(file) ?? new Set();
  for (let n = first; n < first + Number(hunk[2] ?? 1); n++) lines.add(n);
  changed.set(file, lines);
}

const coverage = new Map();
let current = null;
for (const line of readFileSync(lcovPath, 'utf8').split('\n')) {
  if (line.startsWith('SF:')) {
    current = { lines: new Map(), branches: new Map() };
    coverage.set(line.slice(line.indexOf('app/')), current);
  } else if (line.startsWith('DA:')) {
    const [n, hits] = line.slice(3).split(',').map(Number);
    current.lines.set(n, hits);
  } else if (line.startsWith('BRDA:')) {
    const [n, , , taken] = line.slice(5).split(',');
    current.branches.set(Number(n), [...(current.branches.get(Number(n)) ?? []), taken]);
  }
}

const problems = [];
let checked = 0;
for (const [path, lines] of changed) {
  const cov = coverage.get(path);
  if (!cov) {
    problems.push(`${path}: no coverage data for this file`);
    continue;
  }
  for (const n of [...lines].sort((a, b) => a - b)) {
    if (!cov.lines.has(n)) continue;
    checked += 1;
    if (cov.lines.get(n) === 0) problems.push(`${path}:${n} never runs in any scenario`);
    else if ((cov.branches.get(n) ?? []).some((taken) => taken === '0' || taken === '-')) {
      problems.push(`${path}:${n} has a branch no scenario takes`);
    }
  }
}

if (problems.length) {
  console.error(`Changed app/ code that no scenario covers (${problems.length}):`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('Add a scenario that reaches it, or remove it if nothing can. A coverage-ignore comment needs the owner\'s OK.');
  process.exit(1);
}
console.log(`Diff coverage: all ${checked} changed app/ lines are covered, with every branch taken.`);
