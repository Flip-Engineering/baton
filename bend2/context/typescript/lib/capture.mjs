// Capture the files, missing paths and directory names consulted by TypeScript.
// Retained records supply those recorded answers during replay.
// Explicit read roots limit access to those paths and provider resources.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

export class CaptureRefusal extends Error {
  constructor(condition, detail) {
    super(detail ? `${condition}: ${detail}` : condition);
    this.name = 'CaptureRefusal';
    this.condition = condition;
    this.detail = detail ?? null;
  }
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function within(root, path) {
  return path === root || path.startsWith(root + sep);
}

function listingDigest(names) {
  return sha256Hex(Buffer.from([...names].sort().join('\n'), 'utf8'));
}

// `null` captures live filesystem answers. An array replays its recorded answers,
// including a supplied empty set.
export function createCapture({ cwd, readRoots = [], providerRoots = [], supplied = null }) {
  const restricted = readRoots.length > 0;
  const managed = Array.isArray(supplied) || supplied === true;
  const suppliedPaths = new Set();
  const admitted = restricted
    ? [...readRoots, ...providerRoots].map((root) => realpathSync(resolve(cwd, root)))
    : [];
  const entries = new Map();

  // Entries the plan already captured are seeded before any read, so the provider consumes the
  // accepted bytes and makes no filesystem call for them: a supplied file is served from its own
  // bytes, a supplied absence is never probed, and no post-capture probe runs: the accepted bytes are
  // the inputs this analysis consumed.
  for (const entry of Array.isArray(supplied) ? supplied : []) {
    if (entry === null || typeof entry !== 'object') continue;
    if (typeof entry.path !== 'string' || entry.path.length === 0) continue;
    if (entry.kind === 'absent') {
      entries.set(entry.path, { kind: 'absent', path: entry.path, supplied: true });
      suppliedPaths.add(entry.path);
      continue;
    }
    // A directory answer is seeded with the membership its record carried, so a listing replays exactly
    // the names the producing host recorded. A record without names describes existence only, and the
    // listing then refuses rather than reporting an empty directory.
    if (entry.kind === 'dir' || entry.kind === 'directory') {
      entries.set(entry.path, {
        kind: 'directory',
        path: entry.path,
        real: entry.path,
        supplied: true,
        membership: 'unavailable',
        sha256: typeof entry.marker === 'string' ? entry.marker : null,
        names: Array.isArray(entry.names) ? Object.freeze([...entry.names]) : null,
      });
      suppliedPaths.add(entry.path);
      suppliedPaths.add(resolve(entry.path));
      continue;
    }
    if (!(entry.bytes instanceof Uint8Array)) continue;
    entries.set(entry.path, {
      kind: entry.kind === 'config' ? 'config' : 'file',
      path: entry.path,
      real: entry.path,
      sha256: typeof entry.sha256 === 'string' ? entry.sha256 : sha256Hex(entry.bytes),
      bytes: Buffer.from(entry.bytes),
      supplied: true,
    });
    // A supplied input is known under the identity the plan recorded and under its resolved path, so a
    // lexical difference between the two cannot look like an input that was never supplied.
    suppliedPaths.add(entry.path);
    suppliedPaths.add(resolve(entry.path));
  }

  function outsideSupplied(path) {
    return managed && !suppliedPaths.has(path) && !suppliedPaths.has(resolve(cwd, path));
  }

  function admit(path) {
    let real;
    try {
      real = realpathSync(path);
    } catch {
      return null;
    }
    if (restricted && !admitted.some((root) => within(root, real))) {
      throw new CaptureRefusal(
        'context-read-outside-admitted-roots',
        `${real} is outside every admitted read root`,
      );
    }
    return real;
  }

  function recordAbsent(path) {
    if (!entries.has(path)) entries.set(path, { kind: 'absent', path });
    return undefined;
  }

  function readBytes(path) {
    const key = path;
    const existing = entries.get(key);
    if (existing) {
      return existing.kind === 'file' || existing.kind === 'config' ? existing.bytes : undefined;
    }
    if (outsideSupplied(key)) {
      throw new CaptureRefusal('context-input-outside-supplied-set', `${key} is not in the supplied capture set`);
    }
    const real = admit(key);
    if (real === null) return recordAbsent(key);
    let bytes;
    try {
      const stats = statSync(real);
      if (stats.isDirectory()) return recordDirectory(key, real);
      bytes = readFileSync(real);
      const kind = key.includes('tsconfig') || key.endsWith('.json') ? 'config' : 'file';
      entries.set(key, { kind, path: key, real, sha256: sha256Hex(bytes), bytes });
      return bytes;
    } catch {
      entries.set(key, { kind: 'failed', path: key, detail: 'unreadable' });
      return undefined;
    }
  }

  function recordDirectory(path, real) {
    let names;
    try {
      names = readdirSync(real);
    } catch {
      entries.set(path, { kind: 'failed', path, detail: 'unlistable' });
      return undefined;
    }
    entries.set(path, { kind: 'directory', path, real, sha256: listingDigest(names), names });
    return undefined;
  }

  function readText(path) {
    const bytes = readBytes(path);
    return bytes === undefined ? undefined : bytes.toString('utf8');
  }

  function fileExists(path) {
    if (entries.has(path)) return entries.get(path).kind === 'file' || entries.get(path).kind === 'config';
    if (outsideSupplied(path)) {
      throw new CaptureRefusal('context-input-outside-supplied-set', `${path} is not in the supplied capture set`);
    }
    const real = admit(path);
    if (real === null) {
      recordAbsent(path);
      return false;
    }
    let stats;
    try {
      stats = statSync(real);
    } catch {
      recordAbsent(path);
      return false;
    }
    if (stats.isDirectory()) {
      recordDirectory(path, real);
      return false;
    }
    readBytes(path);
    return true;
  }

  function directoryExists(path) {
    const existing = entries.get(path);
    if (existing) return existing.kind === 'directory';
    if (outsideSupplied(path)) {
      throw new CaptureRefusal('context-input-outside-supplied-set', `${path} is not in the supplied capture set`);
    }
    const real = admit(path);
    if (real === null) {
      recordAbsent(path);
      entries.set(path, { kind: 'absent', path, directoryLookup: true });
      return false;
    }
    let isDirectory = false;
    try {
      isDirectory = statSync(real).isDirectory();
    } catch {
      entries.set(path, { kind: 'failed', path, detail: 'unstattable' });
      return false;
    }
    if (!isDirectory) {
      readBytes(path);
      return false;
    }
    return recordDirectory(path, real) === undefined;
  }

  function readDirectory(path) {
    const existing = entries.get(path);
    if (existing && existing.kind === 'directory') {
      // Replay the recorded directory names.
      if (existing.membership === 'unavailable') {
        if (Array.isArray(existing.names)) return [...existing.names];
        throw new CaptureRefusal('context-input-membership-unavailable', `${path} membership was not captured`);
      }
      return [...existing.names];
    }
    directoryExists(path);
    const recorded = entries.get(path);
    return recorded && recorded.kind === 'directory' ? [...recorded.names] : [];
  }

  // The descriptor list the native side composes into a snapshot identity.
  function descriptors() {
    return [...entries.values()]
      .filter((entry) => entry.fileLookup !== true)
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((entry) => {
        switch (entry.kind) {
          case 'file':
            return { kind: 'file', path: entry.path, real: entry.real, sha256: entry.sha256 };
          case 'config':
            return { kind: 'config', path: entry.path, real: entry.real, sha256: entry.sha256 };
          case 'directory':
            return { kind: 'directory', path: entry.path, real: entry.real, sha256: entry.sha256, lookup: entry.directoryLookup === true ? 'directory' : 'membership' };
          default:
            return { kind: entry.kind, path: entry.path, real: '', sha256: '' };
        }
      });
  }

  // The recorded digest of a file, reading and recording it when the compiler asks first.
  function digest(path) {
    const bytes = readBytes(path);
    if (bytes === undefined) return undefined;
    const entry = entries.get(path);
    return entry && entry.sha256 !== undefined ? entry.sha256 : sha256Hex(bytes);
  }

  // Everything this host was asked, in a stable order: the closure as the host saw it. A caller that
  // must reproduce these inputs elsewhere uses exactly this list, including the absences it observed and
  // the membership of every directory it listed.
  function answers() {
    return [...entries.values()]
      .filter((entry) => entry.fileLookup !== true)
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((entry) => {
        if (entry.kind === 'file' || entry.kind === 'config') {
          return Object.freeze({ kind: entry.kind, path: entry.path, sha256: entry.sha256, bytes: entry.bytes });
        }
        if (entry.kind === 'directory') {
          return Object.freeze({ kind: 'directory', path: entry.path, names: Object.freeze([...(entry.names ?? [])]) });
        }
        if (entry.kind === 'absent') return Object.freeze({ kind: 'absent', path: entry.path });
        return Object.freeze({ kind: 'failed', path: entry.path, detail: entry.detail ?? null });
      });
  }

  return {
    cwd,
    admitted: [...admitted],
    digest,
    answers,
    readBytes,
    readText,
    fileExists,
    directoryExists,
    readDirectory,
    descriptors,
    configPathFor: (path) => path,
    realpath: (path) => {
      const real = admit(path);
      if (real === null) return undefined;
      if (!entries.has(path)) entries.set(path, { kind: 'symlink', path, real });
      return real;
    },
    realpathSync: (path) => realpathSync(path),
    basename,
    dirname,
    join,
  };
}
