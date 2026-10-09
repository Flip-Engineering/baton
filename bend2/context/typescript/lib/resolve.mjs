// Resolve TypeScript from the selected module and record the loaded compiler identity.

import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Convert a module URL before resolving paths inside the selected module.
export function adapterPathFor(adapterUrl) {
  return adapterUrl.startsWith('file:') ? fileURLToPath(adapterUrl) : adapterUrl;
}

export function contextRootFor(adapterUrl) {
  return resolve(dirname(adapterPathFor(adapterUrl)), '..');
}

export function resolveTypeScript({ adapterUrl = import.meta.url } = {}) {
  const adapterPath = adapterPathFor(adapterUrl);
  const contextRoot = contextRootFor(adapterPath);
  const require = createRequire(adapterPath);
  try {
    const libraryPath = realpathSync(require.resolve('typescript'));
    const libraryDir = dirname(libraryPath);
    const version = readJson(join(dirname(libraryDir), 'package.json')).version;
    const librarySha = sha256Hex(readFileSync(libraryPath));
    return {
      ok: true,
      module: require(libraryPath),
      version,
      libraryPath,
      libraryDir,
      librarySha,
      node: process.execPath,
      runtime: process.version,
      contextRoot,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error.code ?? error.name,
      detail: error.stack ?? error.message,
      contextRoot,
    };
  }
}

