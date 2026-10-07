// Create one private result directory inside the authenticated owner worktree.
// The query identity selects a stable path and the marker binds that path to its
// owner and worktree before native admission records it.
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync, fsyncSync, fchmodSync, unlinkSync, rmdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRetainedWorktreeCapture } from './context-worktree-capture.mjs';

function refusal(reason, detail = null) {
  return Object.freeze({ status: 'refused', reason, detail });
}

function secureDirectory(path, parent) {
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') return refusal('queryArtifactCreateFailed', error.message);
    try {
      const stat = lstatSync(path);
      if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path
          || realpathSync(dirname(path)) !== parent || (stat.mode & 0o077) !== 0) {
        return refusal('queryArtifactDirectoryInvalid', path);
      }
      return Object.freeze({ status: 'existing-directory', path });
    } catch (readError) {
      return refusal('queryArtifactDirectoryInvalid', readError.message);
    }
  }
  try {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path
        || realpathSync(dirname(path)) !== parent || (stat.mode & 0o077) !== 0) {
      return refusal('queryArtifactDirectoryInvalid', path);
    }
    return Object.freeze({ status: 'directory', path });
  } catch (error) {
    return refusal('queryArtifactDirectoryInvalid', error.message);
  }
}

export function prepareQueryArtifact({ owner, worktree, query } = {}) {
  if (typeof owner !== 'string' || owner.length === 0
      || typeof query !== 'string' || query.length === 0
      || typeof worktree !== 'string' || worktree.length === 0) {
    return refusal('queryArtifactAuthorityMissing');
  }
  try {
    const root = realpathSync(worktree);
    const gitRoot = realpathSync(execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
    if (gitRoot !== root) return refusal('queryArtifactWorktreeMismatch', gitRoot);

    const state = join(root, '.baton');
    const stateEntry = secureDirectory(state, root);
    if (stateEntry.status !== 'directory' && stateEntry.status !== 'existing-directory') return stateEntry;
    const stateStat = lstatSync(state);
    if (!stateStat.isDirectory() || stateStat.isSymbolicLink() || realpathSync(state) !== state
        || realpathSync(dirname(state)) !== root || (stateStat.mode & 0o077) !== 0) return refusal('queryArtifactStateDirectoryInvalid');

    const artifacts = join(state, 'context-artifacts');
    const artifactParent = secureDirectory(artifacts, state);
    if (artifactParent.status !== 'directory' && artifactParent.status !== 'existing-directory') return artifactParent;
    const artifactStat = lstatSync(artifacts);
    if (!artifactStat.isDirectory() || artifactStat.isSymbolicLink() || realpathSync(artifacts) !== artifacts
        || realpathSync(dirname(artifacts)) !== state || (artifactStat.mode & 0o077) !== 0) {
      return refusal('queryArtifactParentInvalid');
    }

    const directory = join(artifacts, Buffer.from(query, 'utf8').toString('hex'));
    const created = secureDirectory(directory, artifacts);
    if (created.status !== 'directory' && created.status !== 'existing-directory') return created;
    const marker = Buffer.from(JSON.stringify({ schema: 'baton2-context-query-artifact-v1', owner, worktree: root, query }) + '\n');
    if (created.status === 'existing-directory') {
      try {
        const markerPath = join(directory, 'identity.json');
        const markerStat = lstatSync(markerPath);
        if (!markerStat.isFile() || markerStat.isSymbolicLink() || (markerStat.mode & 0o077) !== 0
            || !readFileSync(markerPath).equals(marker)) return refusal('queryArtifactIdentityMismatch');
        return Object.freeze({ status: 'prepared', owner, worktree: root, query,
          path: directory, identityPath: markerPath });
      } catch (error) {
        return refusal('queryArtifactIdentityUnavailable', error.message);
      }
    }
    let descriptor;
    try {
      descriptor = openSync(join(directory, 'identity.json'), 'wx', 0o600);
      fchmodSync(descriptor, 0o600);
      writeFileSync(descriptor, marker);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      try { unlinkSync(join(directory, 'identity.json')); } catch {}
      try { rmdirSync(directory); } catch {}
      return refusal('queryArtifactIdentityWriteFailed', error.message);
    }
    return Object.freeze({ status: 'prepared', owner, worktree: root, query,
      path: directory, identityPath: join(directory, 'identity.json') });
  } catch (error) {
    return refusal('queryArtifactPrepareFailed', error.message);
  }
}

export function examineQuerySource({ owner, worktree, cwd = worktree, path } = {}) {
  if (typeof owner !== 'string' || owner.length === 0
      || typeof worktree !== 'string' || worktree.length === 0
      || typeof cwd !== 'string' || cwd.length === 0
      || typeof path !== 'string' || path.length === 0) {
    return refusal('querySourceAuthorityMissing');
  }
  const retained = createRetainedWorktreeCapture({ owner, worktree });
  if (retained.status !== 'ready') return refusal(retained.reason, retained.detail);
  const reader = retained.capture.forOwner(owner);
  const examined = reader.resolve(path, cwd);
  if (examined.status !== 'resolved' || examined.exists !== true) {
    retained.capture.seal(owner);
    return refusal('querySourceUnavailable', examined.reason ?? examined.identity ?? null);
  }
  try {
    const stat = lstatSync(examined.identity);
    if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(examined.identity) !== examined.identity) {
      retained.capture.seal(owner);
      return refusal('querySourceNotRegularFile', examined.identity);
    }
  } catch (error) {
    retained.capture.seal(owner);
    return refusal('querySourceUnavailable', error.message);
  }
  const sealed = retained.capture.seal(owner);
  if (sealed.status !== 'sealed') return refusal('querySourceCaptureFailed', sealed.reason ?? null);
  return Object.freeze({ status: 'examined', owner, worktree: retained.roots[0].path,
    cwd: realpathSync(cwd), requested: path, identity: examined.identity, readSet: sealed });
}
