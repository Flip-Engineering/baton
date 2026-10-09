// The shared encoder, reached in whichever layout is running.
//
// An installed module carries its own copy of the encoder at lib/capture-records.mjs, placed there by the
// packaging mapping from the single original source; a source checkout has no such copy and reaches the
// original at bend2/context/bend2/capture-records.mjs instead. The candidate that exists is chosen before
// any import, so the two layouts use one rendering and no second implementation exists; the chosen module
// is then imported once, and any failure it raises propagates.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = Object.freeze([
  join(HERE, 'capture-records.mjs'),
  join(HERE, '..', '..', 'bend2', 'capture-records.mjs'),
]);

let loaded = null;

export async function loadEncoder() {
  if (loaded !== null) return loaded;
  const chosen = CANDIDATES.find((path) => existsSync(path));
  if (chosen === undefined) return null;
  // Exactly one candidate is imported. A module-not-found raised while it evaluates — a missing transitive
  // dependency — is a real failure of the layout that was chosen, not a reason to try the other one, so
  // every error here propagates.
  loaded = await import(pathToFileURL(chosen).href);
  return loaded;
}
