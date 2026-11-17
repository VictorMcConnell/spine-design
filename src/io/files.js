// Opening and saving spine files. Everything happens in the browser. Nothing is uploaded.

import { validateSpine } from '../core/spinefile.js';

// Read a file the person picked. Resolves to { spine, problems }.
export function readSpineFile(file) {
  return file.text().then((text) => {
    let spine = null;
    try { spine = JSON.parse(text); } catch (e) { return { spine: null, problems: ['That file could not be read as a spine file.'] }; }
    return { spine, problems: validateSpine(spine) };
  });
}

// Offer something as a download: a Blob, under a file name.
export function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// A file name made from the name of a spine.
export const fileNameFor = (spine) => (spine.name || 'my-spine').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'my-spine';

// Offer the spine as a download.
export function saveSpineFile(spine) {
  download(new Blob([JSON.stringify(spine, null, 1) + '\n'], { type: 'application/json' }), fileNameFor(spine) + '.spine.json');
}

// The examples that ship with the app. In the single-file build they are stored inside the
// page. When the app runs from the source folder they are fetched from the examples folder.
export function loadExample(name) {
  const stored = window.SPINE_EXAMPLES && window.SPINE_EXAMPLES[name];
  if (stored) return Promise.resolve(stored);
  return fetch('../examples/' + name).then((r) => r.json());
}

// The list the gallery shows: [{ file, name, about }].
export function listExamples() {
  if (window.SPINE_EXAMPLE_LIST) return Promise.resolve(window.SPINE_EXAMPLE_LIST);
  return fetch('../examples/index.json').then((r) => r.json());
}
