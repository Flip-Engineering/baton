import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  accessSync, chmodSync, constants as fsConstants, mkdirSync, readFileSync, realpathSync, statSync,
} from 'node:fs';
import { delimiter, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_CONTEXT_PROGRAM_POLICY, DurableContextSession, StatelessContextBench,
  contextValueDigest, normalizeContextManifest, normalizeContextProgramPolicy,
  normalizeManifestAny,
} from './context-program.mjs';
import { normalizeContextEffectCall } from './context-call.mjs';
import { normalizeContextMapCall } from './context-map.mjs';
import {
  contextProviderResultCapsule, contextProviderResultReference, contextRetainedCommitProjection,
  normalizeContextResultPathScope, validateContextProviderResultCapsule,
  validateContextProviderResultReference,
} from './context-result.mjs';
import { buildContextMapResultLineage } from './context-result-lineage.mjs';
import { buildContextEffectResultLineage } from './context-effect-result-lineage.mjs';
import { pathInScopes } from './path-scope.mjs';
import {
  validateWorkflowDefinitionLegacy, validateWorkflowDefinitionV3,
} from './workflow-definition.mjs';

const WORKFLOW_DEFINITION = 'application.workflow_definition_bound';
const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cjs', '.cpp', '.css', '.ex', '.exs', '.go', '.h', '.hpp', '.html', '.java',
  '.js', '.json', '.jsx', '.md', '.mjs', '.nix', '.php', '.py', '.rb', '.rs', '.sh', '.sql',
  '.svelte', '.swift', '.toml', '.ts', '.tsx', '.txt', '.vue', '.xml', '.yaml', '.yml', '.zig',
]);
const EXCLUDED_PATH = /(^|\/)(?:\.env(?:\.[^/]+)?|\.git|\.ssh|\.gnupg|\.aws|\.docker|\.kube|\.baton|baton|credentials?|secrets?|node_modules|vendor|deps|_build|target|dist|build|coverage)(?:\/|$)|(?:^|\/)(?:glm_key\.json|id_[a-z0-9_-]+|(?:credentials?|secrets?|auth)(?:\.[^/]+)?|.*\.(?:key|pem|p12|pfx))$/iu;
const SECRET_SHAPED = [
  /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/u,
  /\b(?:api[_-]?key|access[_-]?key|access[_-]?token|refresh[_-]?token|authorization|auth|client[_-]?secret|credential|password|private[_-]?key|secret|token)\s*["']?\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}/iu,
  /\b(?:sk|sk-proj)-[A-Za-z0-9_-]{16,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
];

function runtimeError(message, code = 'context_runtime_invalid') {
  return Object.assign(new Error(message), { code });
}

function exact(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) {
    throw runtimeError(`${label} is invalid`);
  }
}

const CONTEXT_EXECUTION_PROGRAM = fileURLToPath(
  new URL('./context-execution-worker.mjs', import.meta.url),
);
const CONTEXT_EXECUTION_ENV = Object.freeze({ LANG: 'C', LC_ALL: 'C', TZ: 'UTC' });

function gitExecutableAuthority(candidate) {
  const path = realpathSync(candidate);
  const stat = statSync(path);
  accessSync(path, fsConstants.X_OK);
  if (!stat.isFile()) throw runtimeError('Repository Context Git executable is invalid');
  const core = {
    schemaVersion: 1,
    kind: 'baton.context_git_executable',
    path,
    binaryDigest: createHash('sha256').update(readFileSync(path)).digest('hex'),
    bytes: stat.size,
    device: String(stat.dev),
    inode: String(stat.ino),
  };
  return Object.freeze({ ...core, authorityDigest: contextValueDigest(core) });
}

function verifyGitExecutableAuthority(value) {
  exact(value, [
    'authorityDigest', 'binaryDigest', 'bytes', 'device', 'inode', 'kind', 'path', 'schemaVersion',
  ], 'Repository Context Git executable authority');
  if (value.schemaVersion !== 1 || value.kind !== 'baton.context_git_executable'
    || !/^[a-f0-9]{64}$/u.test(value.binaryDigest ?? '')
    || !/^[a-f0-9]{64}$/u.test(value.authorityDigest ?? '')) {
    throw runtimeError('Repository Context Git executable authority is invalid');
  }
  let current;
  try { current = gitExecutableAuthority(value.path); }
  catch (cause) {
    throw Object.assign(runtimeError(
      'Repository Context Git executable authority is unavailable',
      'context_git_authority_invalid',
    ), { cause });
  }
  if (contextValueDigest(current) !== contextValueDigest(value)) {
    throw runtimeError('Repository Context Git executable authority changed',
      'context_git_authority_invalid');
  }
  return current;
}

function resolveGitExecutable(pathValue = process.env.PATH) {
  if (typeof pathValue !== 'string' || pathValue.length === 0) {
    throw runtimeError('Repository Context Git executable is unavailable');
  }
  const candidates = [
    '/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git',
    ...pathValue.split(delimiter).filter((directory) => directory.length > 0)
      .map((directory) => join(directory, 'git')),
  ];
  for (const candidate of [...new Set(candidates)]) {
    try {
      return gitExecutableAuthority(candidate);
    } catch { /* continue through the deployment PATH */ }
  }
  throw runtimeError('Repository Context Git executable is unavailable');
}

function immutableGit(repoRoot, gitAuthority, args, options) {
  return execFileSync(gitAuthority.path, args, {
    cwd: repoRoot,
    env: {
      ...CONTEXT_EXECUTION_ENV,
      HOME: typeof process.env.HOME === 'string' ? process.env.HOME : '/nonexistent',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: '/bin/false',
      SSH_ASKPASS: '/bin/false',
    },
    ...options,
  });
}

function gitObject(repoRoot, gitAuthority, type, oid, maxBuffer, cache = null) {
  const cacheKey = `${type}:${oid}`;
  if (cache?.has(cacheKey)) return cache.get(cacheKey);
  let bytes;
  try {
    bytes = immutableGit(repoRoot, gitAuthority, ['cat-file', type, oid], {
      encoding: 'buffer', maxBuffer,
    });
  } catch (cause) {
    throw Object.assign(runtimeError(
      `Pinned repository ${type} ${oid} is unavailable`, 'context_tree_integrity',
    ), { cause });
  }
  const actual = createHash('sha1')
    .update(Buffer.from(`${type} ${bytes.byteLength}\0`)).update(bytes).digest('hex');
  if (actual !== oid) {
    throw runtimeError(`Pinned repository ${type} ${oid} failed object identity`,
      'context_tree_integrity');
  }
  cache?.set(cacheKey, bytes);
  return bytes;
}

function verifiedRepositoryEntries(repoRoot, gitAuthority, commitSha, policy,
  objectCache = null, entryCache = null) {
  if (entryCache?.has(commitSha)) return entryCache.get(commitSha);
  const commit = gitObject(repoRoot, gitAuthority, 'commit', commitSha,
    Math.min(policy.maxArtifactBytes, 1024 * 1024), objectCache);
  const treeMatch = /^tree ([a-f0-9]{40})$/mu.exec(commit.toString('utf8'));
  if (!treeMatch) throw runtimeError('Pinned repository commit has no valid tree authority',
    'context_tree_integrity');
  const entries = [];
  const walk = (treeOid, prefix = '', depth = 0) => {
    if (depth > 256) throw runtimeError('Pinned repository tree exceeds structural authority',
      'context_tree_integrity');
    const tree = gitObject(repoRoot, gitAuthority, 'tree', treeOid, policy.maxArtifactBytes,
      objectCache);
    for (let offset = 0; offset < tree.byteLength;) {
      const space = tree.indexOf(0x20, offset);
      const nul = space < 0 ? -1 : tree.indexOf(0, space + 1);
      const oidEnd = nul + 21;
      if (space <= offset || nul <= space + 1 || oidEnd > tree.byteLength) {
        throw runtimeError('Pinned repository tree encoding is invalid', 'context_tree_integrity');
      }
      const mode = tree.subarray(offset, space).toString('ascii');
      const nameBytes = tree.subarray(space + 1, nul);
      const name = nameBytes.toString('utf8');
      if (!/^(?:40000|100644|100755|120000|160000)$/u.test(mode)
        || name.length === 0 || name.includes('/') || name === '.' || name === '..'
        || Buffer.from(name).compare(nameBytes) !== 0) {
        throw runtimeError('Pinned repository tree entry is invalid', 'context_tree_integrity');
      }
      const oid = tree.subarray(nul + 1, oidEnd).toString('hex');
      const path = prefix.length > 0 ? `${prefix}/${name}` : name;
      if (mode === '40000') walk(oid, path, depth + 1);
      else entries.push({ path, oid, mode });
      if (entries.length > policy.maxEvidenceCoordinates) {
        throw runtimeError('Pinned repository tree exceeds Context source authority',
          'context_source_oversize');
      }
      offset = oidEnd;
    }
  };
  walk(treeMatch[1]);
  const verified = Object.freeze({
    rootTreeOid: treeMatch[1],
    entries: Object.freeze(entries.sort(
      (left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    ).map(Object.freeze)),
  });
  entryCache?.set(commitSha, verified);
  return verified;
}

function retainedCommitIsDescendant(repoRoot, gitAuthority, baseSha, resultSha, policy,
  objectCache = null) {
  const pending = [resultSha];
  const visited = new Set();
  while (pending.length > 0) {
    const commitSha = pending.pop();
    if (commitSha === baseSha) return true;
    if (visited.has(commitSha)) continue;
    visited.add(commitSha);
    if (visited.size > policy.maxEvidenceCoordinates) {
      throw runtimeError('Retained result ancestry exceeds Context authority',
        'context_result_ancestry_invalid');
    }
    const commit = gitObject(repoRoot, gitAuthority, 'commit', commitSha,
      Math.min(policy.maxArtifactBytes, 1024 * 1024), objectCache);
    const parents = [...commit.toString('utf8').matchAll(/^parent ([a-f0-9]{40})$/gmu)]
      .map((match) => match[1]);
    pending.push(...parents);
  }
  return false;
}

function retainedResultSource(repoRoot, gitAuthority, entries, changedPaths, policy,
  objectCache = null) {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const items = [];
  let artifactBytes = 0;
  const chunkBytes = Math.min(12 * 1024, policy.maxTextBytes);
  for (const path of changedPaths) {
    const entry = byPath.get(path);
    if (!entry || !['100644', '100755'].includes(entry.mode)
      || EXCLUDED_PATH.test(path) || !TEXT_EXTENSIONS.has(extname(path).toLowerCase())) {
      throw runtimeError('Retained result contains an unsupported changed path',
        'context_result_content_invalid');
    }
    const content = gitObject(repoRoot, gitAuthority, 'blob', entry.oid,
      policy.maxArtifactBytes, objectCache);
    if (content.byteLength === 0
      || content.byteLength > Math.min(policy.maxArtifactBytes, 2 * 1024 * 1024)
      || content.includes(0)) {
      throw runtimeError('Retained result contains unsupported regular-file content',
        'context_result_content_invalid');
    }
    const text = content.toString('utf8');
    if (Buffer.from(text).compare(content) !== 0
      || SECRET_SHAPED.some((pattern) => pattern.test(text))) {
      throw runtimeError('Retained result contains sensitive or invalid text',
        'context_result_content_invalid');
    }
    const contentDigest = contextValueDigest(text);
    const firstItem = items.length;
    for (let offset = 0, byteOffset = 0, chunk = 0; offset < text.length; chunk += 1) {
      let end = Math.min(text.length, offset + chunkBytes);
      while (end > offset && Buffer.byteLength(text.slice(offset, end)) > chunkBytes) end -= 1;
      if (end < text.length && end > offset
        && /[\uD800-\uDBFF]/u.test(text[end - 1]) && /[\uDC00-\uDFFF]/u.test(text[end])) end -= 1;
      if (end <= offset) {
        throw runtimeError('Retained result text cannot be projected safely',
          'context_result_content_invalid');
      }
      const selected = text.slice(offset, end);
      offset = end;
      const selectedBytes = Buffer.byteLength(selected);
      const item = {
        path, chunk, gitMode: entry.mode, gitBlobOid: entry.oid,
        blobBytes: content.byteLength, byteStart: byteOffset,
        byteEnd: byteOffset + selectedBytes, contentDigest, text: selected,
        language: extname(path).slice(1).toLowerCase() || 'text',
      };
      byteOffset += selectedBytes;
      const itemBytes = Buffer.byteLength(JSON.stringify(item));
      if (artifactBytes + itemBytes > policy.maxArtifactBytes
        || items.length >= policy.maxResultItems) {
        throw runtimeError('Retained result projection exceeds Context authority',
          'context_result_content_invalid');
      }
      artifactBytes += itemBytes;
      items.push(item);
    }
    if (items.length === firstItem) {
      throw runtimeError('Retained result changed content produced no source item',
        'context_result_content_invalid');
    }
  }
  return items;
}

function validateRetainedResultRequest(value) {
  const fields = [
    'artifactDigest', 'baseSha', 'callId', 'childDigest', 'cleanupDigest', 'pathScope',
    'resultSha', 'retainedResultRef', 'route', 'taskId', 'taskVersion', 'terminalEvent', 'unitId',
  ];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== fields.sort().join(',')
    || !/^context-call:[a-f0-9]{64}$/u.test(value.callId ?? '')
    || !/^context-(?:partition|unit):[a-f0-9]{64}$/u.test(value.unitId ?? '')
    || !/^[A-Za-z0-9._:-]{1,512}$/u.test(value.taskId ?? '')
    || !Number.isSafeInteger(value.taskVersion) || value.taskVersion <= 0
    || !Number.isSafeInteger(value.terminalEvent) || value.terminalEvent <= 0
    || !/^[a-f0-9]{64}$/u.test(value.childDigest ?? '')
    || !/^[a-f0-9]{64}$/u.test(value.artifactDigest ?? '')
    || !/^[a-f0-9]{64}$/u.test(value.cleanupDigest ?? '')
    || !/^[a-f0-9]{40}$/u.test(value.baseSha ?? '')
    || !/^[a-f0-9]{40}$/u.test(value.resultSha ?? '')
    || !value.route || typeof value.route !== 'object' || Array.isArray(value.route)
    || Object.keys(value.route).sort().join(',') !== 'effort,harness,model'
    || ['effort', 'harness', 'model'].some((field) => (
      typeof value.route[field] !== 'string' || value.route[field].length === 0
      || value.route[field].includes('\0') || Buffer.byteLength(value.route[field]) > 256
    ))) {
    throw runtimeError('Retained result projection request is invalid',
      'context_result_integrity');
  }
  let pathScope;
  try { pathScope = normalizeContextResultPathScope(value.pathScope); }
  catch (cause) {
    throw Object.assign(runtimeError('Retained result path scope is invalid',
      'context_result_scope_invalid'), { cause });
  }
  return Object.freeze({ ...value, route: Object.freeze({ ...value.route }), pathScope });
}

function normalizeCallProviderResults(bench, call, children, cleanup, value) {
  const generic = call.kind === 'baton.context_effect_call';
  if (!cleanup || typeof cleanup !== 'object' || Array.isArray(cleanup)
    || cleanup.callId !== call.callId || !/^[a-f0-9]{64}$/u.test(cleanup.cleanupDigest ?? '')) {
    throw runtimeError('Context call cleanup authority is invalid',
      'context_call_settlement_invalid');
  }
  const accepted = children.filter((child) => (
    child.origin === 'inherited' || child.state === 'accepted'
  ));
  if (!Array.isArray(value) || value.length !== accepted.length) {
    throw runtimeError('Context provider result ref set is incomplete',
      'context_call_settlement_invalid');
  }
  return value.map((candidate, index) => {
    let providerResult; let capsule;
    try {
      capsule = bench.readProviderResult(candidate?.capsuleRef);
      providerResult = validateContextProviderResultReference(candidate, capsule);
    } catch (cause) {
      throw Object.assign(runtimeError('Context provider result CAS is invalid',
        'context_call_settlement_invalid'), { cause });
    }
    const child = accepted[index];
    const unitId = generic ? child.unitId : child.partitionId;
    if (generic && child.origin === 'inherited') {
      if (contextValueDigest(providerResult) !== child.resultRefDigest
        || providerResult.unitId !== unitId
        || providerResult.capsuleId !== capsule.capsuleId
        || providerResult.capsuleDigest !== capsule.capsuleDigest
        || providerResult.resultSourceDigest !== capsule.resultSourceDigest) {
        throw runtimeError('Context inherited provider result authority changed',
          'context_call_settlement_invalid');
      }
      return providerResult;
    }
    if (providerResult.unitId !== unitId
      || providerResult.childDigest !== child.childDigest
      || providerResult.capsuleId !== capsule.capsuleId
      || providerResult.capsuleDigest !== capsule.capsuleDigest
      || providerResult.resultSourceDigest !== capsule.resultSourceDigest
      || capsule.callId !== call.callId || capsule.unitId !== unitId
      || capsule.taskId !== child.taskId || capsule.taskVersion !== child.taskVersion
      || capsule.terminalEvent !== child.terminalEvent
      || capsule.childDigest !== child.childDigest
      || capsule.artifactDigest !== child.artifactDigest
      || capsule.cleanupDigest !== cleanup.cleanupDigest
      || child.cleanupDigest !== cleanup.cleanupDigest
      || contextValueDigest(capsule.route) !== contextValueDigest(child.route)
      || capsule.result.baseSha !== (generic ? call.authority.treeSha : call.source.treeSha)
      || capsule.result.resultSha !== child.resultSha
      || capsule.result.retainedResultRef !== `refs/baton/results/${child.resultSha}`) {
      throw runtimeError('Context provider result authority changed',
        'context_call_settlement_invalid');
    }
    return providerResult;
  });
}

export function produceRepositoryContextSource(repoRoot, treeSha, scopes, policy,
  gitAuthority = resolveGitExecutable()) {
  const verifiedGit = verifyGitExecutableAuthority(gitAuthority);
  const verified = verifiedRepositoryEntries(repoRoot, verifiedGit, treeSha, policy);
  const listed = verified.entries;
  const items = [];
  const coverage = {
    listedEntries: listed.length,
    outsideScopeEntries: 0,
    scopedEntries: 0,
    includedFiles: 0,
    includedItems: 0,
    excludedSensitivePaths: 0,
    excludedUnsupportedTypes: 0,
    excludedBinaryOrInvalidText: 0,
    excludedOversizeFiles: 0,
    excludedSensitiveContent: 0,
    complete: true,
  };
  let bytes = 0;
  const chunkBytes = Math.min(12 * 1024, policy.maxTextBytes);
  for (const { path, oid, mode: gitMode } of listed) {
    if (!pathInScopes(path, scopes)) {
      coverage.outsideScopeEntries += 1;
      continue;
    }
    coverage.scopedEntries += 1;
    if (EXCLUDED_PATH.test(path)) {
      coverage.excludedSensitivePaths += 1;
      continue;
    }
    if (!TEXT_EXTENSIONS.has(extname(path).toLowerCase())) {
      coverage.excludedUnsupportedTypes += 1;
      continue;
    }
    if (!['100644', '100755'].includes(gitMode)) {
      coverage.excludedUnsupportedTypes += 1;
      continue;
    }
    const content = gitObject(repoRoot, verifiedGit, 'blob', oid, policy.maxArtifactBytes);
    if (content.byteLength > Math.min(policy.maxArtifactBytes, 2 * 1024 * 1024)) {
      coverage.excludedOversizeFiles += 1;
      continue;
    }
    if (content.includes(0) || content.byteLength === 0) {
      coverage.excludedBinaryOrInvalidText += 1;
      continue;
    }
    const text = content.toString('utf8');
    if (Buffer.from(text).compare(content) !== 0) {
      coverage.excludedBinaryOrInvalidText += 1;
      continue;
    }
    if (SECRET_SHAPED.some((pattern) => pattern.test(text))) {
      coverage.excludedSensitiveContent += 1;
      continue;
    }
    const contentDigest = contextValueDigest(text);
    const fileStart = items.length;
    for (let offset = 0, byteOffset = 0, chunk = 0; offset < text.length; chunk += 1) {
      let end = Math.min(text.length, offset + chunkBytes);
      while (end > offset && Buffer.byteLength(text.slice(offset, end)) > chunkBytes) end -= 1;
      if (end <= offset) break;
      const selected = text.slice(offset, end);
      offset = end;
      const selectedBytes = Buffer.byteLength(selected);
      const byteStart = byteOffset;
      const byteEnd = byteStart + selectedBytes;
      byteOffset = byteEnd;
      if (SECRET_SHAPED.some((pattern) => pattern.test(selected))) continue;
      const item = {
        path, chunk, gitMode, gitBlobOid: oid, blobBytes: content.byteLength,
        byteStart, byteEnd, contentDigest, text: selected,
        language: extname(path).slice(1).toLowerCase() || 'text',
      };
      const itemBytes = Buffer.byteLength(JSON.stringify(item));
      if (bytes + itemBytes > policy.maxArtifactBytes
        || items.length >= policy.maxResultItems) {
        throw runtimeError('Repository Context safe projection exceeds deployment authority',
          'context_source_oversize');
      }
      bytes += itemBytes;
      items.push(item);
    }
    if (items.length > fileStart) coverage.includedFiles += 1;
  }
  coverage.includedItems = items.length;
  return { items, coverage, rootTreeOid: verified.rootTreeOid };
}

export class RepositoryContextRuntime {
  #sourceAttestations;
  #gitObjectCache;
  #repositoryEntriesCache;
  #retainedProjectionCache;

  constructor(options) {
    exact(options, ['artifactRoot', 'policy', 'repoId', 'repoRoot', 'treeSha'],
      'Repository Context runtime configuration');
    if (typeof options.repoId !== 'string' || options.repoId.length === 0
      || !/^[a-f0-9]{40}$/u.test(options.treeSha ?? '')) {
      throw runtimeError('Repository Context runtime authority is invalid');
    }
    this.repoRoot = realpathSync(options.repoRoot);
    this.repoId = options.repoId;
    this.treeSha = options.treeSha;
    this.policy = normalizeContextProgramPolicy(options.policy ?? DEFAULT_CONTEXT_PROGRAM_POLICY);
    this.gitAuthority = resolveGitExecutable();
    this.sourcePolicyDigest = contextValueDigest({
      schemaVersion: 1,
      kind: 'baton.context_repository_source_policy',
      extractor: 'verified-repository-text-v2',
      policyDigest: this.policy.policyDigest,
      textExtensions: [...TEXT_EXTENSIONS].sort(),
      excludedPathPattern: EXCLUDED_PATH.source,
      secretPatterns: SECRET_SHAPED.map((pattern) => pattern.source),
    });
    this.environmentDigest = contextValueDigest({
      schemaVersion: 1, kind: 'baton.context_environment', language: this.policy.language,
      runtime: 'repository-json-cas-v3', stateMode: this.policy.stateMode,
      executionProtocol: 'owned-process-group-v1',
      lineageProtocol: 'context-cell-evidence-v2',
      gitAuthorityDigest: this.gitAuthority.authorityDigest,
    });
    this.referenceIdentity = contextValueDigest({
      schemaVersion: 1, kind: 'baton.context_reference_store', format: 'json-cas-v1',
      environmentDigest: this.environmentDigest, repoId: this.repoId,
    });
    this.bench = new StatelessContextBench({
      artifactRoot: options.artifactRoot, sources: {},
      environmentDigest: this.environmentDigest, policy: this.policy,
    });
    this.coordination = null;
    this.contextHome = join(options.artifactRoot, '.context-home');
    mkdirSync(this.contextHome, { recursive: true, mode: 0o700 });
    chmodSync(this.contextHome, 0o700);
    this.executions = new Set();
    this.#sourceAttestations = new Map();
    this.#gitObjectCache = new Map();
    this.#repositoryEntriesCache = new Map();
    this.#retainedProjectionCache = new Map();
  }

  projectRetainedCommitResult(value) {
    return this._projectRetainedCommitResult(value, true);
  }

  _projectRetainedCommitResult(value, requireCurrentBase) {
    const request = validateRetainedResultRequest(value);
    if (request.retainedResultRef !== `refs/baton/results/${request.resultSha}`) {
      throw runtimeError('Retained result ref does not name the exact result commit',
        'context_result_ref_invalid');
    }
    let retainedSha;
    try {
      retainedSha = immutableGit(this.repoRoot, this.gitAuthority,
        ['show-ref', '--verify', '--hash', request.retainedResultRef], {
          encoding: 'utf8', maxBuffer: 4_096,
        }).trim();
    } catch (cause) {
      throw Object.assign(runtimeError('Retained result ref is unavailable',
        'context_result_ref_invalid'), { cause });
    }
    if (retainedSha !== request.resultSha) {
      throw runtimeError('Retained result ref changed target', 'context_result_ref_invalid');
    }
    if (requireCurrentBase && request.baseSha !== this.treeSha) {
      throw runtimeError('Retained result base differs from runtime tree authority',
        'context_result_ancestry_invalid');
    }
    const projectionKey = contextValueDigest(request);
    if (this.#retainedProjectionCache.has(projectionKey)) {
      return this.#retainedProjectionCache.get(projectionKey);
    }

    let baseTree;
    let resultTree;
    try {
      baseTree = verifiedRepositoryEntries(
        this.repoRoot, this.gitAuthority, request.baseSha, this.policy,
        this.#gitObjectCache, this.#repositoryEntriesCache,
      );
    } catch (cause) {
      throw Object.assign(runtimeError('Retained result base commit is invalid',
        'context_result_ancestry_invalid'), { cause });
    }
    try {
      resultTree = verifiedRepositoryEntries(
        this.repoRoot, this.gitAuthority, request.resultSha, this.policy,
        this.#gitObjectCache, this.#repositoryEntriesCache,
      );
    } catch (cause) {
      throw Object.assign(runtimeError('Retained result ref is not a supported commit',
        'context_result_ref_invalid'), { cause });
    }
    if (!retainedCommitIsDescendant(
      this.repoRoot, this.gitAuthority, request.baseSha, request.resultSha, this.policy,
      this.#gitObjectCache,
    )) {
      throw runtimeError('Retained result commit does not descend from its base',
        'context_result_ancestry_invalid');
    }

    const baseEntries = new Map(baseTree.entries.map((entry) => [entry.path, entry]));
    const resultEntries = new Map(resultTree.entries.map((entry) => [entry.path, entry]));
    const changedPaths = [...new Set([...baseEntries.keys(), ...resultEntries.keys()])]
      .filter((path) => {
        const before = baseEntries.get(path);
        const after = resultEntries.get(path);
        return !before || !after || before.mode !== after.mode || before.oid !== after.oid;
      }).sort();
    if (changedPaths.length === 0 || changedPaths.length > this.policy.maxEvidenceCoordinates) {
      throw runtimeError('Retained result changed path set is invalid',
        'context_result_content_invalid');
    }
    if (changedPaths.some((path) => !pathInScopes(path, request.pathScope))) {
      throw runtimeError('Retained result changed path escapes its path scope',
        'context_result_scope_invalid');
    }

    const source = retainedResultSource(
      this.repoRoot, this.gitAuthority, resultTree.entries, changedPaths, this.policy,
      this.#gitObjectCache,
    );
    const sourceDigest = contextValueDigest(source);
    const expectedSourceRef = Object.freeze({
      kind: 'context_source', ref: `ctx:sha256:${sourceDigest}`,
      digest: sourceDigest, mediaType: 'application/json', itemCount: source.length,
    });
    const result = contextRetainedCommitProjection({
      baseSha: request.baseSha,
      resultSha: request.resultSha,
      retainedResultRef: request.retainedResultRef,
      changedPaths,
      pathScope: request.pathScope,
      sourcePolicyDigest: this.sourcePolicyDigest,
      sourceRef: expectedSourceRef,
    });
    const capsule = validateContextProviderResultCapsule(contextProviderResultCapsule({
      callId: request.callId,
      unitId: request.unitId,
      taskId: request.taskId,
      taskVersion: request.taskVersion,
      terminalEvent: request.terminalEvent,
      childDigest: request.childDigest,
      route: request.route,
      artifactDigest: request.artifactDigest,
      cleanupDigest: request.cleanupDigest,
      result,
      sourceRef: expectedSourceRef,
    }));

    const sourceRef = this.bench.admitSource(source);
    if (contextValueDigest(sourceRef) !== contextValueDigest(expectedSourceRef)) {
      throw runtimeError('Retained result source admission changed identity',
        'context_result_integrity');
    }
    const capsuleRef = this.bench.admitProviderResult(capsule);
    const providerResult = contextProviderResultReference(capsule, capsuleRef);
    const projected = Object.freeze({ capsule, capsuleRef, providerResult });
    this.#retainedProjectionCache.set(projectionKey, projected);
    return projected;
  }

  _executeOwned(operation, payload, signal = null) {
    if (signal !== null && !(signal instanceof AbortSignal)) {
      throw runtimeError('Repository Context execution signal is invalid');
    }
    if (signal?.aborted) {
      throw runtimeError('Repository Context execution was stopped', 'context_execution_aborted');
    }
    const worker = spawn(process.execPath, [CONTEXT_EXECUTION_PROGRAM], {
      cwd: this.repoRoot,
      detached: true,
      env: { ...CONTEXT_EXECUTION_ENV, HOME: this.contextHome },
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    this.executions.add(worker);
    return new Promise((resolvePromise, rejectPromise) => {
      let closed = false;
      let aborted = false;
      let result = null;
      let resultCount = 0;
      let processError = null;
      let stderr = '';
      let escalation = null;
      const reap = (callback, value) => {
        if (closed) return;
        closed = true;
        if (escalation !== null) clearTimeout(escalation);
        signal?.removeEventListener('abort', abort);
        this.executions.delete(worker);
        callback(value);
      };
      const killGroup = (kind) => {
        if (!Number.isSafeInteger(worker.pid) || worker.pid <= 0) return;
        try { process.kill(-worker.pid, kind); }
        catch (error) {
          if (error?.code !== 'ESRCH') processError = Object.assign(
            runtimeError('Repository Context execution could not be reaped',
              'context_execution_reap_failed'), { cause: error },
          );
        }
      };
      const groupAlive = () => {
        if (!Number.isSafeInteger(worker.pid) || worker.pid <= 0) return false;
        try {
          process.kill(-worker.pid, 0);
          return true;
        } catch (error) {
          if (error?.code === 'ESRCH') return false;
          if (error?.code === 'EPERM') return true;
          processError = Object.assign(
            runtimeError('Repository Context process-group ownership could not be verified',
              'context_execution_reap_failed'), { cause: error },
          );
          return true;
        }
      };
      const proveGroupExtinct = async () => {
        if (!groupAlive()) return;
        killGroup('SIGKILL');
        const deadline = Date.now() + 2_000;
        while (groupAlive() && Date.now() < deadline) {
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
        }
        if (groupAlive()) {
          processError = runtimeError(
            'Repository Context process group remained live after reap',
            'context_execution_reap_failed',
          );
        }
      };
      const abort = () => {
        if (aborted || closed) return;
        aborted = true;
        killGroup('SIGTERM');
        escalation = setTimeout(() => killGroup('SIGKILL'), 2_000);
      };
      signal?.addEventListener('abort', abort, { once: true });
      worker.stderr?.on('data', (chunk) => {
        if (stderr.length < 16_384) stderr += chunk.toString('utf8').slice(0, 16_384 - stderr.length);
      });
      worker.on('message', (message) => {
        resultCount += 1;
        if (resultCount !== 1 || message?.schemaVersion !== 1 || message?.nonce !== nonce
          || typeof message?.ok !== 'boolean') {
          processError = runtimeError('Repository Context worker protocol is invalid',
            'context_execution_protocol_invalid');
          killGroup('SIGTERM');
          return;
        }
        result = message;
      });
      worker.once('error', (error) => {
        processError = Object.assign(
          runtimeError(error.message, 'context_execution_failed'), { cause: error },
        );
      });
      worker.once('close', async (code, closeSignal) => {
        await proveGroupExtinct();
        if (aborted) {
          reap(rejectPromise, processError ?? runtimeError(
            'Repository Context execution was stopped', 'context_execution_aborted',
          ));
        } else if (processError) {
          reap(rejectPromise, processError);
        } else if (code !== 0 || result === null) {
          const suffix = stderr.trim().length > 0 ? `: ${stderr.trim()}` : '';
          reap(rejectPromise, runtimeError(
            `Repository Context worker exited without a result${suffix}`,
            closeSignal ? 'context_execution_reap_failed' : 'context_execution_failed',
          ));
        } else if (result?.ok === true) {
          reap(resolvePromise, result.value);
        } else {
          reap(rejectPromise, runtimeError(
            result?.error?.message ?? 'Repository Context worker failed',
            result?.error?.code ?? 'context_execution_failed',
          ));
        }
      });
      const nonce = randomBytes(32).toString('hex');
      worker.send({
        schemaVersion: 1,
        nonce,
        operation,
        payload: operation === 'source' ? { ...payload, gitAuthority: this.gitAuthority } : payload,
      }, (error) => {
        if (error && !closed) {
          processError = Object.assign(
            runtimeError('Repository Context worker request failed', 'context_execution_failed'),
            { cause: error },
          );
          killGroup('SIGTERM');
        }
      });
      // Covers an abort that arrived between the entry check and listener registration.
      if (signal?.aborted) abort();
    });
  }

  attachCoordination(coordination) {
    if (!coordination || typeof coordination.contextSession !== 'function') {
      throw runtimeError('Repository Context coordination authority is invalid');
    }
    if (this.coordination && this.coordination !== coordination) {
      throw runtimeError('Repository Context coordination authority is already attached');
    }
    this.coordination = coordination;
    return this;
  }

  driverConfiguration() {
    return Object.freeze({
      environmentDigest: this.environmentDigest,
      policy: this.policy,
      referenceIdentity: this.referenceIdentity,
      referenceRead: (reference) => {
        const value = this.bench.readReference(reference);
        if (reference?.kind !== 'context_provider_result') return value;
        const reprojected = this._projectRetainedCommitResult({
          callId: value.callId, unitId: value.unitId,
          taskId: value.taskId, taskVersion: value.taskVersion,
          terminalEvent: value.terminalEvent, childDigest: value.childDigest,
          route: value.route, artifactDigest: value.artifactDigest,
          cleanupDigest: value.cleanupDigest,
          baseSha: value.result.baseSha, resultSha: value.result.resultSha,
          retainedResultRef: value.result.retainedResultRef,
          pathScope: value.result.pathScope,
        }, false);
        if (contextValueDigest(reprojected.capsule) !== contextValueDigest(value)
          || contextValueDigest(reprojected.capsuleRef) !== contextValueDigest(reference)) {
          throw runtimeError('Context provider result differs from its retained commit',
            'context_result_integrity');
        }
        return value;
      },
      sourceAttest: (request) => this.attestSource(request),
    });
  }

  _projectCallProviderResults(call, children, cleanup, requests) {
    const acceptedChildren = children.filter((child) => (
      child.origin === 'inherited' || child.state === 'accepted'
    ));
    const acceptedCount = acceptedChildren.length;
    if (!Array.isArray(requests) || requests.length !== acceptedCount) {
      throw runtimeError('Context provider result projection set is invalid',
        'context_call_settlement_invalid');
    }
    const providerResults = requests.map((projection, index) => (
      acceptedChildren[index].origin === 'inherited'
        ? projection.providerResult
        : this.projectRetainedCommitResult(projection).providerResult
    ));
    const normalized = normalizeCallProviderResults(
      this.bench, call, children, cleanup, providerResults,
    );
    const capsules = normalized.map((providerResult) => (
      this.bench.readProviderResult(providerResult.capsuleRef)
    ));
    return Object.freeze({
      providerResults: Object.freeze(normalized), capsules: Object.freeze(capsules),
    });
  }

  materializeCallResult(request) {
    if (request?.call?.kind === 'baton.context_effect_call') {
      return Object.hasOwn(request ?? {}, 'termination')
        ? this._materializeContextEffectCallFailure(request)
        : this._materializeContextEffectCallResult(request);
    }
    return this._materializeContextMapCallResult(request);
  }

  _materializeContextMapCallResult(request) {
    if (Object.hasOwn(request ?? {}, 'termination')) {
      return this._materializeContextMapCallFailure(request);
    }
    exact(request, ['call', 'children', 'cleanup', 'planDigest', 'providerResultRequests'],
      'Context call materialization request');
    const call = normalizeContextMapCall(request.call);
    if (!Array.isArray(request.children) || request.children.length !== call.partitions.length) {
      throw runtimeError('Context call terminal children are incomplete',
        'context_call_settlement_invalid');
    }
    let children;
    try { children = JSON.parse(JSON.stringify(request.children)); }
    catch {
      throw runtimeError('Context call terminal children are not JSON values',
        'context_call_settlement_invalid');
    }
    if (children.some((child, index) => (
      !child || typeof child !== 'object' || Array.isArray(child)
      || child.partitionId !== call.partitions[index].partitionId
      || child.partitionDigest !== call.partitions[index].partitionDigest
    ))) {
      throw runtimeError('Context call terminal child order differs from its partitions',
        'context_call_settlement_invalid');
    }
    if (!/^[a-f0-9]{64}$/u.test(request.planDigest ?? '')) {
      throw runtimeError('Context call successor Plan identity is invalid',
        'context_call_settlement_invalid');
    }
    const { providerResults, capsules } = this._projectCallProviderResults(
      call, children, request.cleanup, request.providerResultRequests,
    );
    const childDigest = contextValueDigest(children);
    const providerResultDigest = contextValueDigest(providerResults);
    const output = {
      schemaVersion: 1, kind: 'baton.context_value', items: providerResults,
      sourceBranches: ['context_provider_results'],
      sourceItems: call.partitions.length,
      selectedSourceItems: providerResults.length,
      chunks: providerResults.length,
    };
    const outputRef = this.bench._writeArtifact(
      output, 'context_value', 'application/vnd.baton.context-value+json',
    );
    let sourceOutput; let sourceEvidence; let lineage;
    try {
      sourceOutput = this.bench.readReference(call.source.outputRef);
      sourceEvidence = this.bench.readReference(call.source.evidenceRef);
      lineage = buildContextMapResultLineage({
        call, children, providerResults, capsules, sourceOutput, sourceEvidence,
        planDigest: request.planDigest, cleanupDigest: request.cleanup.cleanupDigest,
      });
    } catch (cause) {
      throw Object.assign(runtimeError('Context call output lineage is invalid',
        'context_call_settlement_invalid'), { cause });
    }
    const evidence = {
      schemaVersion: 3, kind: 'baton.context_call_evidence',
      callId: call.callId, callDigest: call.callDigest,
      programDigest: call.programDigest, generation: call.generation,
      source: call.source, partitions: call.partitions, children, childDigest,
      providerResults, providerResultDigest, cleanup: request.cleanup,
      providerEffects: children.length,
      sourceCoordinates: lineage.sourceCoordinates,
      coordinateDigest: lineage.coordinateDigest,
      outputLineages: lineage.outputLineages,
      outputLineageDigest: lineage.outputLineageDigest,
      outputRef,
    };
    const evidenceRef = this.bench._writeArtifact(
      evidence, 'context_call_evidence',
      'application/vnd.baton.context-call-evidence+json',
    );
    return Object.freeze({
      outputRef, evidenceRef, childDigest, providerResults, providerResultDigest,
      childCount: children.length,
      providerEffects: children.length,
    });
  }

  materializeCallFailure(request) {
    if (request?.call?.kind === 'baton.context_effect_call') {
      return this._materializeContextEffectCallFailure(request);
    }
    return this._materializeContextMapCallFailure(request);
  }

  _materializeContextMapCallFailure(request) {
    exact(request, ['call', 'children', 'cleanup', 'providerResultRequests', 'termination'],
      'Context call failure materialization request');
    const call = normalizeContextMapCall(request.call);
    if (!Array.isArray(request.children) || request.children.length !== call.partitions.length) {
      throw runtimeError('Context call terminal children are incomplete',
        'context_call_settlement_invalid');
    }
    let children; let cleanup; let termination;
    try {
      children = JSON.parse(JSON.stringify(request.children));
      cleanup = JSON.parse(JSON.stringify(request.cleanup));
      termination = JSON.parse(JSON.stringify(request.termination));
    } catch {
      throw runtimeError('Context call failure evidence is not a JSON value',
        'context_call_settlement_invalid');
    }
    if (children.some((child, index) => (
      !child || typeof child !== 'object' || Array.isArray(child)
      || child.partitionId !== call.partitions[index].partitionId
      || child.partitionDigest !== call.partitions[index].partitionDigest
    )) || children.every((child) => (
      child.origin === 'inherited' || child.state === 'accepted'
    ))) {
      throw runtimeError('Context call failed child order differs from its partitions',
        'context_call_settlement_invalid');
    }
    const { providerResults } = this._projectCallProviderResults(
      call, children, cleanup, request.providerResultRequests,
    );
    const childDigest = contextValueDigest(children);
    const providerResultDigest = contextValueDigest(providerResults);
    const evidence = {
      schemaVersion: 2, kind: 'baton.context_call_evidence',
      callId: call.callId, callDigest: call.callDigest,
      programDigest: call.programDigest, generation: call.generation,
      source: call.source, partitions: call.partitions, children, childDigest,
      providerResults, providerResultDigest,
      providerEffects: children.length,
      coordinateDigest: call.source.coordinateDigest,
      state: 'failed', cleanup, termination, outputRef: null,
    };
    const evidenceRef = this.bench._writeArtifact(
      evidence, 'context_call_evidence',
      'application/vnd.baton.context-call-evidence+json',
    );
    return Object.freeze({
      outputRef: null, evidenceRef, childDigest, providerResults, providerResultDigest,
      childCount: children.length,
      providerEffects: children.length,
    });
  }

  _materializeContextEffectCallResult(request) {
    exact(request, ['call', 'children', 'cleanup', 'planDigest', 'providerResultRequests'],
      'Context effect call materialization request');
    const call = normalizeContextEffectCall(request.call);
    if (!['map', 'reduce'].includes(call.operator)
      || !Array.isArray(request.children) || request.children.length !== call.units.length) {
      throw runtimeError('Context effect call terminal children are incomplete',
        'context_call_settlement_invalid');
    }
    let children;
    try { children = JSON.parse(JSON.stringify(request.children)); }
    catch {
      throw runtimeError('Context effect call terminal children are not JSON values',
        'context_call_settlement_invalid');
    }
    if (children.some((child, index) => (
      !child || typeof child !== 'object' || Array.isArray(child)
      || child.unitId !== call.units[index].unitId
      || child.unitDigest !== call.units[index].unitDigest
    ))) {
      throw runtimeError('Context effect call terminal child order differs from its units',
        'context_call_settlement_invalid');
    }
    if (!/^[a-f0-9]{64}$/u.test(request.planDigest ?? '')) {
      throw runtimeError('Context effect call successor Plan identity is invalid',
        'context_call_settlement_invalid');
    }
    const { providerResults, capsules } = this._projectCallProviderResults(
      call, children, request.cleanup, request.providerResultRequests,
    );
    const childDigest = contextValueDigest(children);
    const providerResultDigest = contextValueDigest(providerResults);
    const output = {
      schemaVersion: 1, kind: 'baton.context_value', items: providerResults,
      sourceBranches: ['context_provider_results'],
      sourceItems: call.source.itemCount,
      selectedSourceItems: providerResults.length,
      chunks: providerResults.length,
    };
    const outputRef = this.bench._writeArtifact(
      output, 'context_value', 'application/vnd.baton.context-value+json',
    );
    let lineage;
    try {
      lineage = buildContextEffectResultLineage({
        call, children, providerResults, capsules,
        sourceOutput: this.bench.readReference(call.source.outputRef),
        sourceEvidence: this.bench.readReference(call.source.evidenceRef),
        planDigest: request.planDigest, cleanupDigest: request.cleanup.cleanupDigest,
      });
    } catch (cause) {
      throw Object.assign(runtimeError('Context effect call output lineage is invalid',
        'context_call_settlement_invalid'), { cause });
    }
    const evidence = {
      schemaVersion: 4, kind: 'baton.context_call_evidence',
      call, children, childDigest,
      providerResults, providerResultDigest, cleanup: request.cleanup,
      providerEffects: call.executionUnitIds.length,
      sourceCoordinates: lineage.sourceCoordinates,
      coordinateDigest: lineage.coordinateDigest,
      outputLineages: lineage.outputLineages,
      outputLineageDigest: lineage.outputLineageDigest,
      outputRef,
    };
    const evidenceRef = this.bench._writeArtifact(
      evidence, 'context_call_evidence',
      'application/vnd.baton.context-call-evidence+json',
    );
    return Object.freeze({
      outputRef, evidenceRef, childDigest, providerResults, providerResultDigest,
      childCount: children.length, providerEffects: call.executionUnitIds.length,
    });
  }

  _materializeContextEffectCallFailure(request) {
    exact(request, ['call', 'children', 'cleanup', 'providerResultRequests', 'termination'],
      'Context effect call failure materialization request');
    const call = normalizeContextEffectCall(request.call);
    if (!['map', 'reduce'].includes(call.operator)
      || !Array.isArray(request.children) || request.children.length !== call.units.length) {
      throw runtimeError('Context effect call terminal children are incomplete',
        'context_call_settlement_invalid');
    }
    let children; let cleanup; let termination;
    try {
      children = JSON.parse(JSON.stringify(request.children));
      cleanup = JSON.parse(JSON.stringify(request.cleanup));
      termination = JSON.parse(JSON.stringify(request.termination));
    } catch {
      throw runtimeError('Context effect call failure evidence is not a JSON value',
        'context_call_settlement_invalid');
    }
    if (children.some((child, index) => (
      !child || typeof child !== 'object' || Array.isArray(child)
      || child.unitId !== call.units[index].unitId
      || child.unitDigest !== call.units[index].unitDigest
    )) || children.every((child) => (
      child.origin === 'inherited' || child.state === 'accepted'
    ))) {
      throw runtimeError('Context effect failed child order differs from its units',
        'context_call_settlement_invalid');
    }
    const { providerResults } = this._projectCallProviderResults(
      call, children, cleanup, request.providerResultRequests,
    );
    const childDigest = contextValueDigest(children);
    const providerResultDigest = contextValueDigest(providerResults);
    const evidence = {
      schemaVersion: 4, kind: 'baton.context_call_evidence',
      call, children, childDigest,
      providerResults, providerResultDigest,
      providerEffects: call.executionUnitIds.length,
      coordinateDigest: call.source.coordinateDigest,
      state: 'failed', cleanup, termination, outputRef: null,
    };
    const evidenceRef = this.bench._writeArtifact(
      evidence, 'context_call_evidence',
      'application/vnd.baton.context-call-evidence+json',
    );
    return Object.freeze({
      outputRef: null, evidenceRef, childDigest, providerResults, providerResultDigest,
      childCount: children.length, providerEffects: call.executionUnitIds.length,
    });
  }

  attestSource({ manifest, branch, source }) {
    const receipt = this.#sourceAttestations.get(branch?.ref);
    if (!receipt || manifest?.tree?.sha !== receipt.treeSha
      || manifest?.repoId !== receipt.repoId
      || manifest?.workflow?.node?.digest !== receipt.nodeDigest
      || manifest?.policyDigest !== this.policy.policyDigest
      || receipt.sourcePolicyDigest !== this.sourcePolicyDigest
      || branch?.name !== receipt.branch || branch?.ref !== receipt.sourceRef
      || branch?.digest !== receipt.sourceDigest || branch?.itemCount !== receipt.itemCount
      || contextValueDigest(source) !== receipt.sourceDigest) {
      throw runtimeError('Repository Context source lacks verified producer authority',
        'context_source_attestation_invalid');
    }
    return receipt;
  }

  async openSession({ authority, principal, signal = null }) {
    if (!this.coordination) throw runtimeError('Repository Context runtime is not attached');
    exact(authority, ['current', 'nodeKey', 'role'], 'Repository Context session authority');
    const current = authority.current;
    const node = current?.plan?.nodes?.find((candidate) => candidate.key === authority.nodeKey);
    const dispatch = current?.dispatches?.find(
      (candidate) => candidate.binding?.nodeKey === authority.nodeKey,
    );
    const task = dispatch ? this.coordination.task(dispatch.taskId) : null;
    const definition = this.coordination.events().find((event) => (
      event.kind === 'driver.recorded' && event.payload?.kind === WORKFLOW_DEFINITION
      && event.payload?.repoId === this.repoId
      && event.payload?.runId === current?.goal?.runId
      && event.payload?.planDigest === current?.plan?.digest
    ));
    if (!node || !task || task.status !== 'working' || !definition
      || current.goal.repoId !== this.repoId || current.plan.repoId !== this.repoId) {
      throw runtimeError('Repository Context session has no current Plan-gated Attempt',
        'context_session_stale');
    }
    if (definition.payload.schemaVersion === 3) {
      try {
        const ancestors = this.coordination.events().filter((candidate) => (
          candidate.seq < definition.seq && candidate.kind === 'driver.recorded'
            && candidate.payload?.kind === WORKFLOW_DEFINITION
            && candidate.payload?.repoId === this.repoId
            && candidate.payload?.runId === current.goal.runId
        )).map((candidate) => candidate.payload);
        validateWorkflowDefinitionV3(definition.payload, {
          nodes: current.plan.nodes, ancestors,
        });
      } catch (error) {
        throw runtimeError(error.message, 'context_session_integrity');
      }
    } else if (Array.isArray(definition.payload.attempts)) {
      try {
        validateWorkflowDefinitionLegacy(definition.payload, { nodes: current.plan.nodes });
      } catch (error) {
        throw runtimeError(error.message, 'context_session_integrity');
      }
    }
    if (Array.isArray(definition.payload.attempts)) {
      const attempt = definition.payload.attempts.find((candidate) => (
        candidate.nodeKey === node.key && candidate.role === authority.role
      ));
      if (!attempt) {
        throw runtimeError('Repository Context session Attempt is outside its role catalog',
          'context_session_integrity');
      }
    }
    const existing = (this.coordination.snapshot().context?.sessions ?? []).find((session) => (
      session.state === 'active'
      // REPL-1 rule 13a: skip ReplManifest sessions here — they ride the same _contextSessions
      // map but carry no `workflow` coordinate, so an unguarded deref below would wedge Workflow.
      && session.manifest.kind === 'baton.context_manifest'
      && session.repoId === this.repoId
      && session.runId === current.goal.runId
      && session.manifest.tree.sha === this.treeSha
      && session.manifest.policyDigest === this.policy.policyDigest
      && session.manifest.workflow.definitionDigest === definition.payload.definitionDigest
      && session.manifest.workflow.goal.digest === current.goal.digest
      && session.manifest.workflow.plan.digest === current.plan.digest
      && session.manifest.workflow.node.key === node.key
      && session.manifest.workflow.task.taskId === task.id
      && session.manifest.workflow.task.version === task.version
    ));
    let manifest = existing?.manifest ?? null;
    if (!manifest) {
      const contextScope = node.contextScope ?? node.pathScope;
      const produced = await this._executeOwned('source', {
        repoRoot: this.repoRoot, treeSha: this.treeSha,
        scopes: contextScope, policy: this.policy,
      }, signal);
      const source = produced.items;
      const sourceRef = this.bench.admitSource(source);
      const proofCoordinates = source.map((item) => ({
        path: item.path, chunk: item.chunk, gitMode: item.gitMode,
        gitBlobOid: item.gitBlobOid, blobBytes: item.blobBytes,
        byteStart: item.byteStart, byteEnd: item.byteEnd, contentDigest: item.contentDigest,
      }));
      const attestationCore = {
        schemaVersion: 2,
        kind: 'baton.context_source_attestation',
        repoId: this.repoId,
        producerIdentity: this.referenceIdentity,
        treeSha: this.treeSha,
        rootTreeOid: produced.rootTreeOid,
        gitObjectFormat: 'sha1',
        sourcePolicyDigest: this.sourcePolicyDigest,
        nodeDigest: contextValueDigest(node),
        scopeDigest: contextValueDigest([...contextScope].sort()),
        branch: 'repository',
        sourceRef: sourceRef.ref,
        sourceDigest: sourceRef.digest,
        itemCount: sourceRef.itemCount,
        proofDigest: contextValueDigest(proofCoordinates),
        coverage: produced.coverage,
      };
      this.#sourceAttestations.set(sourceRef.ref, Object.freeze({
        ...attestationCore, receiptDigest: contextValueDigest(attestationCore),
      }));
      manifest = normalizeContextManifest({
      schemaVersion: 1,
      kind: 'baton.context_manifest',
      repoId: this.repoId,
      tree: { sha: this.treeSha, source: 'deployment_snapshot' },
      workflow: {
        runId: current.goal.runId,
        definitionDigest: definition.payload.definitionDigest,
        goal: {
          goalId: current.goal.goalId, version: current.goal.version, digest: current.goal.digest,
        },
        plan: {
          planId: current.plan.planId, version: current.plan.version, digest: current.plan.digest,
        },
        node: { key: node.key, digest: contextValueDigest(node) },
        task: {
          taskId: task.id, version: task.version,
          createdEvent: task.createdEvent, claimedEvent: task.claimedEvent,
        },
      },
      branches: [{
        name: 'repository', ref: sourceRef.ref, digest: sourceRef.digest,
        mediaType: sourceRef.mediaType, itemCount: sourceRef.itemCount,
        summary: `Immutable repository context for Workflow role ${authority.role}.`,
      }],
      policyDigest: this.policy.policyDigest,
      }, this.policy);
    }
    return new DurableContextSession({
      coordination: this.coordination,
      bench: this.bench,
      manifest,
      principal: {
        actor: principal.actor, principalId: principal.principalId,
        repoId: this.repoId, runId: current.goal.runId,
      },
      execute: (request) => this._executeOwned('execute', {
        artifactRoot: this.bench.artifactRoot,
        environmentDigest: this.environmentDigest,
        policy: this.policy,
        ...request,
      }, signal),
    });
  }

  // REPL-1 rule 11: open a DurableContextSession against a settled `repl.manifest_admitted`
  // record instead of a Plan-gated Attempt. The constructor is reused as-is via the injected
  // `admitSession` (admitReplSession) and the kind-dispatching normalizer — no Workflow coupling.
  async openReplSession({ manifest, principal, signal = null }) {
    if (!this.coordination) throw runtimeError('Repository Context runtime is not attached');
    let normalized;
    try { normalized = normalizeManifestAny(manifest, this.policy); }
    catch (error) { throw runtimeError(error.message, error.code ?? 'repl_manifest_invalid'); }
    if (normalized.kind !== 'baton.repl_manifest') {
      throw runtimeError('Repository Context REPL session requires a repl manifest',
        'repl_session_unadmitted');
    }
    const records = (this.coordination.snapshot().repl?.manifests ?? []).filter((record) => (
      record.manifestDigest === normalized.digest && record.runId === normalized.repl.runId
      && record.replRole === normalized.repl.replRole
    ));
    if (records.length !== 1) {
      throw runtimeError('Repository Context REPL manifest is not admitted', 'repl_session_unadmitted');
    }
    const [record] = records;
    if (!principal || record.principal.principalId !== principal.principalId
      || record.principal.actor !== principal.actor) {
      throw runtimeError('Repository Context REPL principal does not match the admission',
        'repl_session_unadmitted');
    }
    return new DurableContextSession({
      coordination: this.coordination,
      bench: this.bench,
      manifest: normalized,
      principal: {
        actor: record.principal.actor, principalId: record.principal.principalId,
        repoId: this.repoId, runId: normalized.repl.runId,
      },
      admitSession: (fields, sessionAuth) => this.coordination.admitReplSession(fields, sessionAuth),
      execute: (request) => this._executeOwned('execute', {
        artifactRoot: this.bench.artifactRoot,
        environmentDigest: this.environmentDigest,
        policy: this.policy,
        ...request,
      }, signal),
    });
  }
}

export function defaultRepositoryContextPolicy() {
  return DEFAULT_CONTEXT_PROGRAM_POLICY;
}
