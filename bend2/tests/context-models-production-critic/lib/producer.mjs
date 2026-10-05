// Producer source access for the critic fixtures.
//
// The fixtures import the captured producer modules directly from the
// producer worktree (CTX_PRODUCER_ROOT overrides) and record the SHA256 of
// every imported source file at run time. Each report therefore pins the
// exact bytes the checks exercised. No production file is modified.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const WORKTREE = resolve(THIS_DIR, '../../../..');
const SIBLING_DEFAULT = resolve(WORKTREE, '../semantic-impl-catalogs-models');

export const CATALOG_SOURCES = Object.freeze([
  'bend2/context/catalogs/index.mjs',
  'bend2/context/catalogs/adapter.mjs',
  'bend2/context/catalogs/canonical.mjs',
  'bend2/context/catalogs/operations.mjs',
  'bend2/context/catalogs/sql-identifiers.mjs',
  'bend2/context/catalogs/sql-scan.mjs',
  'bend2/context/catalogs/sqlite-catalog.mjs',
  'bend2/context/catalogs/sqlite-statement.mjs',
  'bend2/context/catalogs/sql-join.mjs',
]);

export const MODEL_SOURCES = Object.freeze([
  'bend2/context/models/index.mjs',
  'bend2/context/models/adapter.mjs',
  'bend2/context/models/json-schema.mjs',
  'bend2/context/models/model-use-join.mjs',
  'bend2/context/models/operations.mjs',
  'bend2/context/models/sample.mjs',
  'bend2/context/models/zod-child.mjs',
  'bend2/context/models/zod-model.mjs',
]);

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export async function loadProducer() {
  const root = resolve(process.env.CTX_PRODUCER_ROOT ?? SIBLING_DEFAULT);
  const pins = {};
  const modules = {};
  for (const relative of [...CATALOG_SOURCES, ...MODEL_SOURCES]) {
    const absolute = join(root, relative);
    pins[relative] = sha256File(absolute);
  }
  const load = async relative => import(pathToFileURL(join(root, relative)).href);
  modules.catalogs = {
    index: await load('bend2/context/catalogs/index.mjs'),
    canonical: await load('bend2/context/catalogs/canonical.mjs'),
    identifiers: await load('bend2/context/catalogs/sql-identifiers.mjs'),
    scan: await load('bend2/context/catalogs/sql-scan.mjs'),
    catalog: await load('bend2/context/catalogs/sqlite-catalog.mjs'),
    statement: await load('bend2/context/catalogs/sqlite-statement.mjs'),
    join: await load('bend2/context/catalogs/sql-join.mjs'),
  };
  modules.models = {
    index: await load('bend2/context/models/index.mjs'),
    jsonSchema: await load('bend2/context/models/json-schema.mjs'),
    modelUseJoin: await load('bend2/context/models/model-use-join.mjs'),
    sample: await load('bend2/context/models/sample.mjs'),
    zodChild: await load('bend2/context/models/zod-child.mjs'),
    zodModel: await load('bend2/context/models/zod-model.mjs'),
  };
  return { root, pins, modules };
}
