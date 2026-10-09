// Create one result directory inside the recorded owner worktree.
// The query identity selects a stable path and the marker binds that path to its
// owner and worktree before native admission records it.
import { closeSync, constants, mkdirSync, openSync, readFileSync, realpathSync, statSync, writeFileSync, fsyncSync, fchmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRetainedWorktreeCapture } from './context-worktree-capture.mjs';

function refusal(reason, detail = null) {
  return Object.freeze({ status: 'refused', reason, detail });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function immutableWrite(path, bytes) {
  let descriptor;
  try {
    descriptor = openSync(path, 'wx', 0o600);
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    const directory = openSync(dirname(path), constants.O_RDONLY);
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
    return Object.freeze({ status: 'written', path, sha256: sha256(bytes) });
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (error.code !== 'EEXIST') return refusal('queryArtifactWriteFailed', error.message);
  }
  try {
    const retained = readFileSync(path);
    if (!retained.equals(bytes)) return refusal('queryArtifactReplayMismatch', path);
    return Object.freeze({ status: 'replayed', path, sha256: sha256(retained) });
  } catch (error) {
    return refusal('queryArtifactReadFailed', error.message);
  }
}

function databaseParent(database) {
  if (typeof database !== 'string' || database.length === 0) {
    throw new Error('database path is required');
  }
  const canonical = realpathSync(database);
  return dirname(canonical);
}

function decodeBootstrap(bytes, { database, owner, worktree, query, artifactPath }) {
  try {
    const text = bytes.toString('utf8');
    const value = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)
        || value.schema !== 'baton2-managed-context-bootstrap-v2'
        || value.query !== query || value.owner !== owner || value.artifactPath !== artifactPath
        || typeof value.databaseBinding !== 'string' || value.databaseBinding.length === 0
        || typeof value.request !== 'string' || value.request.length === 0
        || typeof value.cwd !== 'string' || value.cwd.length === 0
        || (value.originAttempt !== null
          && (typeof value.originAttempt !== 'string' || value.originAttempt.length === 0))
        || typeof value.planValue !== 'string' || value.planValue.length === 0
        || typeof value.planIdentity !== 'string' || value.planIdentity.length === 0
        || typeof value.resultSchema !== 'string' || value.resultSchema.length === 0
        || !/^[0-9a-f]{64}$/.test(value.artifactSha256)
        || typeof value.keeperPath !== 'string' || value.keeperPath.length === 0
        || typeof value.recoveryArgv !== 'string' || value.recoveryArgv.length === 0
        || !/^[0-9a-f]{64}$/.test(value.guardKey)
        || typeof value.guardIdentity !== 'string'
        || typeof value.physicalRoleKey !== 'string' || value.physicalRoleKey.length === 0
        || typeof value.ownerWitness !== 'string'
        || !/^[1-9][0-9]*:[1-9][0-9]*$/.test(value.ownerWitness)
        || typeof value.sourceIdentity !== 'string' || value.sourceIdentity.length === 0
        || typeof value.executablePath !== 'string' || value.executablePath.length === 0
        || typeof value.runtimePath !== 'string' || value.runtimePath.length === 0
        || typeof value.providerPath !== 'string' || value.providerPath.length === 0
        || value.invocationPath !== join(value.keeperPath, 'invocation.json')
        || !/^[0-9a-f]{64}$/.test(value.invocationSha256)
        || sha256(Buffer.from(value.guardIdentity, 'utf8')) !== value.guardKey
        || !validGuardIdentity(value.guardIdentity, value.databaseBinding, query)) {
      return refusal('queryBootstrapIdentityMismatch');
    }
    if (value.keeperPath !== join(databaseParent(database), value.guardKey)) {
      return refusal('queryBootstrapKeeperMismatch');
    }
    const root = realpathSync(worktree);
    const cwd = realpathSync(value.cwd);
    const within = relative(root, cwd);
    if (within !== '' && (within === '..'
        || within.startsWith('..' + sep) || within.startsWith(sep))) {
      return refusal('queryBootstrapWorkspaceMismatch');
    }
    return Object.freeze({ status: 'loaded', value });
  } catch (error) {
    return refusal('queryBootstrapMalformed', error.message);
  }
}

function validGuardIdentity(text, binding, query) {
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) && value.length === 6
      && value[0] === 'context-role' && value[1] === binding
      && value[2] === 'query' && value[3] === query
      && value[4] === 'starter' && value[5] === '0';
  } catch {
    return false;
  }
}

function readBootstrap(path, authority) {
  try {
    const bytes = readFileSync(path);
    const decoded = decodeBootstrap(bytes, authority);
    if (decoded.status !== 'loaded') return decoded;
    return Object.freeze({ status: 'loaded', bytes, value: decoded.value });
  } catch (error) {
    return refusal('queryBootstrapReadFailed', error.message);
  }
}

export function readQueryBootstrap({ database, owner, worktree, query, bootstrapPath } = {}) {
  if (typeof bootstrapPath !== 'string') return refusal('queryBootstrapPathMissing');
  const prepared = prepareQueryArtifact({ owner, worktree, query });
  if (prepared.status !== 'prepared') return prepared;
  const expectedPath = join(prepared.path, 'bootstrap.json');
  if (bootstrapPath !== expectedPath) return refusal('queryBootstrapPathMismatch', expectedPath);
  const loaded = readBootstrap(bootstrapPath, { database, owner: prepared.owner,
    worktree: prepared.worktree, query: prepared.query, artifactPath: prepared.path });
  if (loaded.status !== 'loaded') return loaded;
  return Object.freeze({ status: 'loaded', owner, worktree: prepared.worktree,
    query, path: bootstrapPath, sha256: sha256(loaded.bytes), value: loaded.value });
}

export function persistQueryBootstrap({ database, owner, worktree, query, bootstrapText } = {}) {
  if (typeof bootstrapText !== 'string') return refusal('queryBootstrapMissing');
  const prepared = prepareQueryArtifact({ owner, worktree, query });
  if (prepared.status !== 'prepared') return prepared;
  const path = join(prepared.path, 'bootstrap.json');
  const bytes = Buffer.from(bootstrapText + '\n');
  const decoded = decodeBootstrap(bytes, { database, owner: prepared.owner, worktree: prepared.worktree,
    query: prepared.query,
    artifactPath: prepared.path });
  if (decoded.status !== 'loaded') return decoded;
  const saved = immutableWrite(path, bytes);
  if (saved.status !== 'written' && saved.status !== 'replayed') return saved;
  return Object.freeze({ status: 'persisted', owner, worktree: prepared.worktree,
    query, path, sha256: saved.sha256, replay: saved.status === 'replayed' });
}

export function persistQueryOutcome({ database, owner, worktree, query, bootstrapSha256,
  exitStatus, eventFrame = '' } = {}) {
  if (typeof bootstrapSha256 !== 'string' || bootstrapSha256.length === 0
      || !Number.isInteger(exitStatus) || exitStatus < 0 || exitStatus > 255
      || typeof eventFrame !== 'string') return refusal('queryOutcomeAuthorityMalformed');
  const prepared = prepareQueryArtifact({ owner, worktree, query });
  if (prepared.status !== 'prepared') return prepared;
  const bootstrapPath = join(prepared.path, 'bootstrap.json');
  const bootstrap = readBootstrap(bootstrapPath, { database, owner, worktree: prepared.worktree,
    query, artifactPath: prepared.path });
  if (bootstrap.status !== 'loaded' || sha256(bootstrap.bytes) !== bootstrapSha256) {
    return refusal('queryOutcomeBootstrapMismatch', bootstrap.reason ?? null);
  }

  let eventSha256 = null;
  let outputSha256 = null;
  if (exitStatus === 0) {
    let event;
    try {
      event = JSON.parse(eventFrame);
    } catch (error) {
      return refusal('queryOutcomeEventMalformed', error.message);
    }
    if (event === null || typeof event !== 'object' || Array.isArray(event)
        || event.version !== 2 || event.query !== query
        || event.owner !== owner || event.type !== 'event') return refusal('queryOutcomeEventIdentityMismatch');
    const eventBytes = Buffer.from(eventFrame + '\n');
    const savedEvent = immutableWrite(join(prepared.path, 'event.json'), eventBytes);
    if (savedEvent.status !== 'written' && savedEvent.status !== 'replayed') return savedEvent;
    eventSha256 = savedEvent.sha256;
  } else if (eventFrame !== '') {
    const savedOutput = immutableWrite(join(prepared.path, 'stdout.txt'),
      Buffer.from(eventFrame + '\n'));
    if (savedOutput.status !== 'written' && savedOutput.status !== 'replayed') return savedOutput;
    outputSha256 = savedOutput.sha256;
  }

  const completion = Buffer.from(JSON.stringify({
    schema: 'baton2-managed-context-completion-v1',
    query,
    owner,
    bootstrapSha256,
    exitStatus,
    eventSha256,
    outputSha256,
  }) + '\n');
  const savedCompletion = immutableWrite(join(prepared.path, 'completion.json'), completion);
  if (savedCompletion.status !== 'written' && savedCompletion.status !== 'replayed') return savedCompletion;
  return Object.freeze({ status: 'persisted', query, owner, exitStatus,
    event: eventSha256 === null ? null : { path: join(prepared.path, 'event.json'), sha256: eventSha256, pointer: '' },
    output: outputSha256 === null ? null : { path: join(prepared.path, 'stdout.txt'), sha256: outputSha256, pointer: '' },
    completion: { path: savedCompletion.path, sha256: savedCompletion.sha256, pointer: '' },
    replay: savedCompletion.status === 'replayed' });
}

function createDirectory(path) {
  try {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    return Object.freeze({ status: 'directory', path });
  } catch (error) {
    return refusal('queryArtifactCreateFailed', error.message);
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
    const stateEntry = createDirectory(state);
    if (stateEntry.status !== 'directory') return stateEntry;

    const artifacts = join(state, 'context-artifacts');
    const artifactParent = createDirectory(artifacts);
    if (artifactParent.status !== 'directory') return artifactParent;

    const directory = join(artifacts, Buffer.from(query, 'utf8').toString('hex'));
    const created = createDirectory(directory);
    if (created.status !== 'directory') return created;
    const marker = Buffer.from(JSON.stringify({ schema: 'baton2-context-query-artifact-v1', owner, worktree: root, query }) + '\n');
    const identityPath = join(directory, 'identity.json');
    const markerMatches = (text) => {
      const existingMarker = JSON.parse(text);
      return existingMarker !== null && typeof existingMarker === 'object' && !Array.isArray(existingMarker)
        && existingMarker.schema === 'baton2-context-query-artifact-v1'
        && existingMarker.owner === owner && existingMarker.worktree === root && existingMarker.query === query;
    };
    try {
      if (!markerMatches(readFileSync(identityPath, 'utf8'))) return refusal('queryArtifactIdentityMismatch');
      return Object.freeze({ status: 'prepared', owner, worktree: root, query,
        path: directory, identityPath });
    } catch (error) {
      if (error.code !== 'ENOENT') return refusal('queryArtifactIdentityUnavailable', error.message);
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
      if (error.code === 'EEXIST') {
        try {
          if (markerMatches(readFileSync(identityPath, 'utf8'))) {
            return Object.freeze({ status: 'prepared', owner, worktree: root, query,
              path: directory, identityPath });
          }
          return refusal('queryArtifactIdentityMismatch');
        } catch (readError) {
          return refusal('queryArtifactIdentityUnavailable', readError.message);
        }
      }
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
    if (!statSync(examined.identity).isFile()) {
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
