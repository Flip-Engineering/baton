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

// Resolve the compiler the module will use, and record which resolution supplied it.
//
// Installed, the compiler sits beside the module in `node_modules/typescript`; run from source, it is
// reached from the checkout or given explicitly by the caller. Both paths are ordinary resolutions of the
// same package, and the answer names which one was used so a qualification records the actual origin.
function loadCompiler(adapterPath, contextRoot, compilerPath) {
  const candidates = [];
  if (typeof compilerPath === 'string' && compilerPath.length > 0) {
    candidates.push({ source: 'option', path: resolve(compilerPath) });
  }
  const local = join(contextRoot, 'node_modules/typescript/lib/typescript.js');
  candidates.push({ source: 'module', path: local });
  const require = createRequire(adapterPath);
  try {
    candidates.push({ source: 'require', path: require.resolve('typescript') });
  } catch (error) {
    void error;
  }
  let lastFailure = null;
  for (const candidate of candidates) {
    try {
      const libraryPath = realpathSync(candidate.path);
      const libraryDir = dirname(libraryPath);
      const version = readJson(join(dirname(libraryDir), 'package.json')).version;
      const librarySha = sha256Hex(readFileSync(libraryPath));
      return {
        ok: true,
        module: createRequire(adapterPath)(libraryPath),
        version,
        libraryPath,
        libraryDir,
        librarySha,
        source: candidate.source,
        node: process.execPath,
        runtime: process.version,
        contextRoot,
      };
    } catch (error) {
      lastFailure = error;
    }
  }
  return {
    ok: false,
    reason: lastFailure === null ? 'typescriptUnavailable' : lastFailure.code ?? lastFailure.name,
    detail: lastFailure === null ? 'no compiler candidate was available' : lastFailure.message,
    contextRoot,
  };
}

export function resolveTypeScript({ adapterUrl = import.meta.url, compilerPath = null } = {}) {
  const adapterPath = adapterPathFor(adapterUrl);
  return loadCompiler(adapterPath, contextRootFor(adapterPath), compilerPath);
}

