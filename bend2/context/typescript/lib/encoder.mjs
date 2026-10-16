// Load the shared capture encoder from the installed module or source checkout.

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
  // Propagate errors from the selected module.
  loaded = await import(pathToFileURL(chosen).href);
  return loaded;
}
