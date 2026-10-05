// Resolves the pinned TypeScript package the provider loads.
//
// Production resolution is package-relative: the staged adapter resolves "typescript" from its own
// location, and a resolution that leaves the staged context tree is refused rather than used. No
// environment variable selects a different install on this path, so an ambient override cannot
// change what the provider analyzes with.
//
// The resolved identity is the executable provenance the caller records: the node binary that
// ran, its runtime version, the library file path and that file's sha256.

import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';

export const PROVIDER_NAME = 'typescript';
export const REQUIRED_VERSION = '5.9.3';

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// The staged context root owns the provider tree: <stage>/libexec/baton2/context.
export function contextRootFor(adapterUrl) {
  return resolve(dirname(adapterUrl), '..', '..');
}

export function resolveTypeScript({ adapterUrl = import.meta.url } = {}) {
  const contextRoot = contextRootFor(adapterUrl);
  const require = createRequire(adapterUrl);
  let entry;
  try {
    entry = require.resolve('typescript');
  } catch {
    return {
      ok: false,
      reason: 'providerUnresolvedTypeScript',
      detail: `typescript did not resolve from the staged context tree at ${contextRoot}`,
      contextRoot,
    };
  }
  let real;
  let root;
  try {
    real = realpathSync(entry);
    root = realpathSync(contextRoot);
  } catch {
    return { ok: false, reason: 'providerIdentityUnavailable', detail: entry, contextRoot };
  }
  if (real !== root && !real.startsWith(root + sep)) {
    // An ancestor node_modules or a global install is not the packaged provider.
    return { ok: false, reason: 'providerResolutionOutsidePackage', detail: real, contextRoot: root };
  }
  const libDir = dirname(real);
  const packageRoot = dirname(libDir);
  let version;
  try {
    version = readJson(join(packageRoot, 'package.json')).version;
  } catch {
    return { ok: false, reason: 'providerIdentityUnavailable', detail: packageRoot, contextRoot: root };
  }
  if (version !== REQUIRED_VERSION) {
    return {
      ok: false,
      reason: 'providerVersionMismatch',
      detail: `resolved typescript ${version}, required ${REQUIRED_VERSION}`,
      contextRoot: root,
    };
  }
  const libraryPath = join(libDir, 'typescript.js');
  let librarySha;
  try {
    librarySha = sha256Hex(readFileSync(libraryPath));
  } catch {
    return { ok: false, reason: 'providerIdentityUnavailable', detail: libraryPath, contextRoot: root };
  }
  return {
    ok: true,
    module: require(real),
    version,
    libraryPath,
    libraryDir: libDir,
    librarySha,
    node: process.execPath,
    runtime: process.version,
    contextRoot: root,
  };
}

// The discovery line core consumes for context-engines. It runs no target code and loads no
// project; an unresolved dependency is reported as unavailable with the searched location.
export function providerIdentity(resolved) {
  return {
    name: PROVIDER_NAME,
    version: resolved.version,
    path: resolved.libraryPath,
    sha256: resolved.librarySha,
    node: resolved.node,
    runtime: resolved.runtime,
  };
}

export function enginesProbe(resolved) {
  if (!resolved.ok) {
    return {
      version: 1,
      engine: 'typescript',
      provider: null,
      executable: null,
      availability: 'unavailable',
      prerequisites: { node: '22.15.0', typescript: REQUIRED_VERSION },
      projections: [],
      effects: [],
      limits: [{ code: resolved.reason, detail: resolved.detail }],
    };
  }
  return {
    version: 1,
    engine: 'typescript',
    provider: providerIdentity(resolved),
    executable: resolved.node,
    availability: 'available',
    prerequisites: { node: '22.15.0', typescript: REQUIRED_VERSION },
    projections: [
      'definition',
      'type',
      'references',
      'calls',
      'callers',
      'dependencies',
      'diagnostics',
      'flow',
      'exceptions',
      'databaseAccesses',
    ],
    effects: [],
    limits: [],
  };
}
