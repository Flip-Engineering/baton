// The immutable captured filesystem host.
//
// The provider consumes exactly the bytes this host captured. Every read, every failed lookup and
// every directory membership query is recorded with its identity, so a later revalidation can
// decide whether the snapshot is still current, and a change during capture can be detected
// before a result is published.
//
// Identity per entry:
//   file      requested path, resolved real path, sha256 of the bytes
//   directory resolved real path, sha256 of the sorted membership listing
//   config    a file consumed as configuration (same fields as a file, distinct role)
//   symlink   requested path and the real path the resolution followed
//   absent    a failed lookup, recorded so a later appearance invalidates the snapshot
//   failed    a probe that raised; it never agrees with anything
//
// Explicit read roots constrain reads to those paths and the provider's resources.
// Requests without read roots use ordinary filesystem resolution.

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

export function createCapture({ cwd, readRoots = [], providerRoots = [] }) {
  const restricted = readRoots.length > 0;
  const admitted = restricted
    ? [...readRoots, ...providerRoots].map((root) => realpathSync(resolve(cwd, root)))
    : [];
  const entries = new Map();

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
    if (existing && existing.kind === 'directory') return [...existing.names];
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

  // Read-time revalidation: re-probe the recorded closure and report every input that no longer
  // matches. A probe that raises yields a failed descriptor, which never counts as unchanged.
  function revalidate() {
    const changed = [];
    const failed = [];
    for (const entry of [...entries.values()]) {
      if (entry.fileLookup === true) continue;
      let real = null;
      try {
        real = realpathSync(entry.path);
      } catch {
        real = null;
      }
      if (entry.kind === 'absent') {
        if (real === null) continue;
        // A recorded missing directory appearing, or a recorded missing file appearing, both
        // change the resolution closure; a directory that is still absent stays unchanged.
        if (entry.directoryLookup === true) {
          let nowDirectory = false;
          try {
            nowDirectory = statSync(real).isDirectory();
          } catch {
            nowDirectory = false;
          }
          if (nowDirectory) changed.push({ path: entry.path, reason: 'directoryAppeared' });
          continue;
        }
        changed.push({ path: entry.path, reason: 'appeared' });
        continue;
      }
      if (real === null) {
        changed.push({ path: entry.path, reason: 'missing' });
        continue;
      }
      try {
        if (entry.kind === 'directory') {
          const digest = listingDigest(readdirSync(real));
          if (digest !== entry.sha256) changed.push({ path: entry.path, reason: 'membershipChanged' });
          continue;
        }
        const digest = sha256Hex(readFileSync(real));
        if (digest !== entry.sha256) changed.push({ path: entry.path, reason: 'bytesChanged' });
        if (entry.real !== real) changed.push({ path: entry.path, reason: 'resolutionChanged' });
      } catch (error) {
        failed.push({ path: entry.path, reason: String(error && error.message) });
      }
    }
    return { changed, failed };
  }

  // The recorded digest of a file, reading and recording it when the compiler asks first.
  function digest(path) {
    const bytes = readBytes(path);
    if (bytes === undefined) return undefined;
    const entry = entries.get(path);
    return entry && entry.sha256 !== undefined ? entry.sha256 : sha256Hex(bytes);
  }

  return {
    cwd,
    admitted: [...admitted],
    digest,
    readBytes,
    readText,
    fileExists,
    directoryExists,
    readDirectory,
    descriptors,
    revalidate,
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
