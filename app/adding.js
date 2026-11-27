// Adding videos: files picked on the device (stored: importVideo) or in Google
// Drive (streamed: addStreamed), one or several, and a picked Drive folder's
// videos to choose from.
import { CONTAINER_EXT } from './local-scheme.js';
import { listFolder, FOLDER } from './drive.js';
import { addStreamed } from './library.js';
import { state, $, update, refreshLibrary } from './state.js';
import { startJob, endJob, onJobProgress } from './jobs.js';

// Several files picked at once: added one after another; a bad file doesn't
// stop the rest, and the summary names what failed.
async function importSeveral(items, sourceOf, add) {
  const total = items.length;
  let added = 0;
  const failed = [];
  const job = startJob(`Adding ${total} videos…`);
  for (const [i, item] of items.entries()) {
    if (!item.name.toLowerCase().endsWith(CONTAINER_EXT)) {
      failed.push(`${item.name} (not a ${CONTAINER_EXT} file)`);
      continue;
    }
    const name = item.name.slice(0, -CONTAINER_EXT.length);
    Object.assign(job, { progress: 0, message: `Adding ${i + 1} of ${total}: ${name}…` });
    update();
    try {
      await add(sourceOf(item), onJobProgress(job));
      added += 1;
    } catch (e) {
      failed.push(`${name} (${e.message})`);
    }
    await refreshLibrary();
    update();
  }
  const summary = `Added ${added} of ${total} videos.`;
  if (failed.length) endJob(job, 'error', `${summary} Couldn't add: ${failed.join('; ')}.`);
  else endJob(job, 'done', summary);
}

// Picked in Google Drive: files alone are added as streamed. With a folder,
// every .kidsvideo in it and its subfolders (and any files picked with it) is
// listed to choose from: new ones ticked, titles already there greyed out.
export async function addFromDrive(docs, sourceOf) {
  const folders = docs.filter((d) => d.mimeType === FOLDER);
  if (!folders.length) return importItems(docs, sourceOf, addStreamed);
  const found = docs.filter((d) => d.mimeType !== FOLDER);
  const job = startJob(`Looking in "${folders[0].name}"…`);
  for (const folder of folders) {
    job.message = `Looking in "${folder.name}"…`;
    update();
    try {
      found.push(...await listFolder(folder));
    } catch (e) {
      return endJob(job, 'error', `Couldn't add the folder "${folder.name}": ${e.message}`);
    }
  }
  if (!found.length) return endJob(job, 'error', `There are no .kidsvideo files in "${folders[0].name}".`);
  state.jobs = state.jobs.filter((j) => j !== job); // the list takes over
  const titles = new Set(state.library.map((c) => c.appMetadata.title));
  const items = found.map((doc) => {
    const name = doc.name.slice(0, -CONTAINER_EXT.length);
    return { doc, name, inLibrary: titles.has(name), ticked: !titles.has(name) };
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const one = docs.length === 1;
  state.choosing = {
    title: one ? `Add from "${folders[0].name}"` : 'Add from Google Drive',
    from: one ? ` from "${folders[0].name}"` : '',
    sourceOf,
    items,
  };
  update();
}

// The list of a folder's videos: tick, untick, then add the ticked ones.
export function renderChoosing(s) {
  $('drive-choose').hidden = !s.choosing;
  if (!s.choosing) return;
  const { title, items } = s.choosing;
  const fresh = items.filter((i) => !i.inLibrary);
  const ticked = fresh.filter((i) => i.ticked).length;
  $('drive-choose').querySelector('[data-role="choose-title"]').textContent = title;
  $('drive-choose').querySelector('[data-role="choose-list"]').replaceChildren(...items.map((item) => {
    const li = document.createElement('li');
    li.dataset.testid = 'drive-choose-item';
    li.dataset.state = item.inLibrary ? 'in-library' : 'new';
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.testid = 'drive-choose-box';
    box.checked = item.ticked;
    box.disabled = item.inLibrary;
    box.addEventListener('change', () => { item.ticked = box.checked; update(); });
    const name = document.createElement('span');
    name.textContent = item.inLibrary ? `${item.name} · in the library` : item.name;
    label.append(box, name);
    li.append(label);
    return li;
  }));
  $('drive-choose-toggle').textContent = ticked === fresh.length ? 'Untick all' : 'Tick all';
  $('drive-choose-add').textContent = `Add ${ticked}`;
  $('drive-choose-add').disabled = ticked === 0;
}

export function onChooseToggle() {
  const fresh = state.choosing.items.filter((i) => !i.inLibrary);
  const tick = !fresh.every((i) => i.ticked);
  for (const item of fresh) item.ticked = tick;
  update();
}

export function onChooseCancel() {
  state.choosing = null;
  update();
}

// Add the ticked videos, one after another, in one row.
export async function onChooseAdd() {
  const { items, sourceOf, from } = state.choosing;
  state.choosing = null;
  const chosen = items.filter((i) => i.ticked);
  const skipped = items.filter((i) => i.inLibrary).length;
  let added = 0;
  const failed = [];
  const job = startJob('Adding…');
  for (const [i, { doc, name }] of chosen.entries()) {
    Object.assign(job, { progress: i / chosen.length, message: `Adding ${i + 1} of ${chosen.length}: ${name}…` });
    update();
    try {
      await addStreamed(sourceOf(doc));
      added += 1;
    } catch (e) {
      failed.push(`${name} (${e.message})`); // also a title already there under another file name
    }
    await refreshLibrary();
  }
  const summary = `Added ${added} of ${chosen.length} videos${from}${skipped ? ` (${skipped} already in the library)` : ''}.`;
  if (failed.length) endJob(job, 'error', `${summary} Couldn't add: ${failed.join('; ')}.`);
  else endJob(job, 'done', summary);
}

// Picked files (stored: importVideo) or files in Google Drive (streamed:
// addStreamed); sourceOf(item) gives its byte source.
export async function importItems(items, sourceOf, add) {
  if (items.length > 1) return importSeveral(items, sourceOf, add);
  const job = startJob('Adding video…');
  try {
    const stored = await add(sourceOf(items[0]), onJobProgress(job));
    endJob(job, 'done', `Added "${stored.appMetadata.title}".`);
  } catch (e) {
    endJob(job, 'error', `Couldn't add the video: ${e.message}`);
  }
  await refreshLibrary();
  update();
}
