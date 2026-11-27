// Adds and downloads show one row each (data-testid="import-status") with
// progress, and Cancel for a download.
import { state, update } from './state.js';

// Adds and downloads: a row each, kept (not rebuilt) while it runs, so its
// Cancel stays under the finger. A finished row clears itself after a while;
// one that failed stays longer, so it can be read.
const CLEAR_AFTER_MS = { done: 10_000, cancelled: 10_000, error: 60_000 };
const jobRows = new Map(); // job -> { li, text, bar, cancel }

export function renderJobs(jobs) {
  for (const [job, row] of jobRows) {
    if (!jobs.includes(job)) {
      row.li.remove();
      jobRows.delete(job);
    }
  }
  for (const job of jobs) {
    let row = jobRows.get(job);
    if (!row) {
      const li = document.createElement('li');
      li.dataset.testid = 'import-status';
      li.setAttribute('role', 'status');
      const text = document.createElement('span');
      const bar = document.createElement('progress');
      bar.dataset.testid = 'import-progress';
      bar.max = 1;
      li.append(text, bar);
      document.querySelector('[data-role="jobs"]').append(li);
      row = { li, text, bar, cancel: null };
      jobRows.set(job, row);
    }
    row.li.dataset.import = job.phase;
    row.text.textContent = job.message;
    row.bar.hidden = job.phase !== 'storing';
    row.bar.value = job.progress;
    if (job.cancel && !row.cancel) {
      row.cancel = document.createElement('button');
      row.cancel.type = 'button';
      row.cancel.dataset.testid = 'cancel-download-button';
      row.cancel.textContent = 'Cancel';
      const { cancel } = job;
      row.cancel.addEventListener('click', () => cancel.abort());
      row.li.append(row.cancel);
    } else if (!job.cancel && row.cancel) {
      row.cancel.remove();
      row.cancel = null;
    }
  }
}


export function startJob(message, cancel = null) {
  const job = { phase: 'storing', progress: 0, message, cancel };
  state.jobs.push(job);
  update();
  return job;
}

export function endJob(job, phase, message) {
  Object.assign(job, { phase, message, cancel: null });
  setTimeout(() => {
    state.jobs = state.jobs.filter((j) => j !== job);
    update();
  }, CLEAR_AFTER_MS[phase]);
  update();
}

export const onJobProgress = (job) => (p) => {
  job.progress = p;
  update();
};
