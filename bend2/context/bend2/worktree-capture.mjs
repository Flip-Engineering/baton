// Lazy retained custody for one selected semantic-context invocation. The pinned frontend owns
// import resolution and calls this reader for the paths it actually opens. This module admits
// those reads to a Git checkout and explicit package roots, captures each canonical file once and
// serves the retained bytes for every later request in the same query.

import { createHash } from 'node:crypto';
import { closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

function refusal(reason, detail) {
  return Object.freeze({ status: 'refused', reason, detail });
}

function inside(root, candidate) {
  const name = relative(root, candidate);
  return name === '' || (name !== '..' && !name.startsWith(`..${sep}`) && !isAbsolute(name));
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function identifyRoots(worktree, packages) {
  if (typeof worktree !== 'string' || worktree.length === 0) {
    return refusal('worktreeRootMissing', 'a direct Git worktree path is required');
  }
  if (!Array.isArray(packages)) return refusal('packageRootsMalformed', 'selected package roots must be an array');
  const roots = [];
  try {
    const root = realpathSync(worktree);
    if (!statSync(root).isDirectory()) return refusal('worktreeRootInvalid', root);
    const gitRoot = realpathSync(execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
    if (gitRoot !== root) return refusal('worktreeRootMismatch', gitRoot);
    roots.push(Object.freeze({ id: 'worktree', path: root }));
    for (const item of packages) {
      if (item === null || typeof item !== 'object' || typeof item.id !== 'string' || item.id.length === 0
          || typeof item.path !== 'string' || item.path.length === 0) {
        return refusal('packageRootMalformed', 'each selected package root needs an identity and a path');
      }
      const path = realpathSync(item.path);
      if (!statSync(path).isDirectory()) return refusal('packageRootInvalid', item.path);
      if (roots.some((entry) => entry.id === item.id || entry.path === path)) {
        return refusal('packageRootDuplicate', item.id);
      }
      roots.push(Object.freeze({ id: item.id, path }));
    }
  } catch (error) {
    return refusal('admittedRootUnavailable', error.message);
  }
  return Object.freeze({ status: 'roots', roots: Object.freeze(roots) });
}

function chooseRoot(roots, path) {
  const matches = roots.filter((root) => inside(root.path, path));
  matches.sort((left, right) => right.path.length - left.path.length);
  return matches[0];
}

function stableRead(path) {
  let descriptor;
  try {
    const real = realpathSync(path);
    const before = lstatSync(real, { bigint: true });
    if (!before.isFile()) return refusal('sourceNotRegularFile', real);
    descriptor = openSync(real, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      return refusal('sourceChangedBeforeRead', real);
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    const namedAfter = lstatSync(real, { bigint: true });
    if (after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs
        || namedAfter.dev !== before.dev || namedAfter.ino !== before.ino
        || namedAfter.size !== before.size || namedAfter.mtimeNs !== before.mtimeNs
        || namedAfter.ctimeNs !== before.ctimeNs || realpathSync(path) !== real) {
      return refusal('sourceChangedDuringRead', real);
    }
    return Object.freeze({ status: 'captured', path: real, bytes, sha256: digest(bytes) });
  } catch (error) {
    return refusal('sourceReadFailed', `${path}: ${error.message}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function resolveRequested(roots, requested, base) {
  if (typeof requested !== 'string' || requested.length === 0) return refusal('sourceIdentityMissing', 'the frontend supplied no source identity');
  if (!isAbsolute(requested) && (typeof base !== 'string' || base.length === 0)) {
    return refusal('sourceBaseMissing', 'a relative frontend read needs the importing source identity');
  }
  const lexical = isAbsolute(requested) ? resolve(requested) : resolve(base, requested);
  const lexicalRoot = chooseRoot(roots, lexical);
  if (lexicalRoot === undefined) return refusal('sourceOutsideAdmittedRoots', lexical);
  try {
    const real = realpathSync(lexical);
    const realRoot = chooseRoot(roots, real);
    if (realRoot === undefined) return refusal('sourceOutsideAdmittedRoots', real);
    return Object.freeze({ status: 'resolved', requested, lexical, identity: real, root: realRoot });
  } catch (error) {
    if (error.code !== 'ENOENT') return refusal('sourceIdentityFailed', `${lexical}: ${error.message}`);
    let parent = lexical;
    while (true) {
      try {
        const realParent = realpathSync(parent);
        if (chooseRoot(roots, realParent) === undefined) return refusal('sourceOutsideAdmittedRoots', realParent);
        break;
      } catch (parentError) {
        if (parentError.code !== 'ENOENT') return refusal('sourceIdentityFailed', `${parent}: ${parentError.message}`);
        const next = resolve(parent, '..');
        if (next === parent) return refusal('sourceIdentityFailed', `${lexical}: no admitted existing parent`);
        parent = next;
      }
    }
    return Object.freeze({ status: 'absent', requested, lexical, identity: lexical, root: lexicalRoot });
  }
}

// `owner` is minted by the query coordinator and bound here before a provider callback is
// installed. Requests carry no owner or capture records; the frontend callback can access only
// the read set retained by this one invocation.
export function createRetainedWorktreeCapture({ owner, worktree, packages = [] } = {}) {
  if (typeof owner !== 'string' || owner.length === 0) return refusal('queryOwnerMissing', 'a coordinator-owned query token is required');
  const identified = identifyRoots(worktree, packages);
  if (identified.status !== 'roots') return identified;

  const roots = identified.roots;
  const resolved = new Map();
  const files = new Map();
  const aliases = new Map();
  let closed = false;

  function checkOwner(candidate) {
    if (candidate !== owner) return refusal('queryOwnerMismatch', 'the read request belongs to another query');
    if (closed) return refusal('queryClosed', 'the retained query read set is sealed');
    return null;
  }

  function resolveFor(candidate, requested, base = '') {
    const invalid = checkOwner(candidate);
    if (invalid !== null) return invalid;
    const result = resolveRequested(roots, requested, base);
    if (result.status !== 'resolved' && result.status !== 'absent') return result;
    const key = `${base}\0${requested}`;
    resolved.set(key, result);
    resolved.set(`\0${result.identity}`, result);
    if (result.status === 'resolved' && result.lexical !== result.identity) aliases.set(result.lexical, result.identity);
    return result.status === 'resolved'
      ? Object.freeze({ status: 'resolved', identity: result.identity, exists: true })
      : Object.freeze({ status: 'resolved', identity: result.identity, exists: false });
  }

  function readFor(candidate, identity, base = '') {
    const invalid = checkOwner(candidate);
    if (invalid !== null) return invalid;
    const key = `${base}\0${identity}`;
    const answer = resolved.get(key);
    if (answer === undefined) return refusal('sourceReadUnadmitted', String(identity));
    if (answer.status === 'absent') return Object.freeze({ status: 'absent', identity: answer.identity });
    const prior = files.get(answer.identity);
    if (prior !== undefined) return Object.freeze({ status: 'captured', identity: answer.identity, bytes: prior.bytes, sha256: prior.sha256 });
    const captured = stableRead(answer.identity);
    if (captured.status !== 'captured') return captured;
    if (captured.path !== answer.identity || chooseRoot(roots, captured.path) === undefined) {
      return refusal('sourceIdentityChanged', answer.identity);
    }
    files.set(answer.identity, captured);
    return Object.freeze({ status: 'captured', identity: captured.path, bytes: captured.bytes, sha256: captured.sha256 });
  }

  const api = Object.freeze({
    owner,
    forOwner(candidate) {
      return Object.freeze({
        resolve: (requested, base = '') => resolveFor(candidate, requested, base),
        read: (identity, base = '') => readFor(candidate, identity, base),
      });
    },
    descriptors() {
      const rows = [...files.values()].map((entry) => Object.freeze({
        kind: 'file', path: entry.path, real: entry.path, sha256: entry.sha256,
      }));
      for (const [alias, target] of aliases) {
        if (!rows.some((row) => row.path === alias)) rows.push(Object.freeze({ kind: 'symlink', path: alias, real: target }));
      }
      for (const answer of resolved.values()) {
        if (answer.status === 'absent' && !rows.some((row) => row.kind === 'absent' && row.path === answer.identity)) {
          rows.push(Object.freeze({ kind: 'absent', path: answer.identity, real: answer.identity }));
        }
      }
      return Object.freeze(rows);
    },
    readBytes(identity) {
      const canonical = aliases.get(identity) ?? identity;
      return files.get(canonical)?.bytes;
    },
    basePin(identity) {
      const canonical = aliases.get(identity) ?? identity;
      const entry = files.get(canonical);
      return entry === undefined ? refusal('baseNotCaptured', String(identity))
        : Object.freeze({ path: canonical, sha256: entry.sha256 });
    },
    seal(candidate) {
      const invalid = checkOwner(candidate);
      if (invalid !== null) return invalid;
      closed = true;
      return Object.freeze({ status: 'sealed', descriptors: this.descriptors(), fileCount: files.size });
    },
  });
  return Object.freeze({ status: 'ready', capture: api, acquisition: api.forOwner(owner), roots });
}
