import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync, closeSync, constants as fsConstants, existsSync, fstatSync, lstatSync, mkdirSync,
  openSync, readFileSync, realpathSync, rmSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { BatonApplication } from './application.mjs';
import { bindBaton } from './application-client.mjs';
import { ClaudeSessionCli, GlmSessionCli, KimiSessionCli } from './claude-session.mjs';
import { CodexAppServerCli } from './codex-appserver.mjs';
import { GrokAcpCli } from './grok-acp.mjs';
import { KimiAcpCli } from './kimi-acp.mjs';
import { DEFAULT_RUN_LINEAGE_POLICY } from './run-lineage.mjs';
import { inspectToolchainProjection } from './toolchain-projection.mjs';
import { DEFAULT_WORKER_POLICY_REQUEST } from './worker-policy.mjs';
import { ensureBatonExcluded } from './worktree.mjs';

const DEFAULT_BUDGET = Object.freeze({
  tokens: 10_000_000, usd: 100, wallMin: 60, providerTurns: 128,
});

// Capacity ceilings are deployment authority, not Run arguments. The advanced seam may replace
// observation/estimation for deterministic tests or a host integration, but never these limits.
const DEFAULT_WORKTREE_CAPACITY = Object.freeze({
  maxReservedBytes: 8 * 1024 * 1024 * 1024,
  maxReservedInodes: 1_000_000,
  minFreeBytes: 2 * 1024 * 1024 * 1024,
  minFreeInodes: 100_000,
  runtimeReserveBytes: 64 * 1024 * 1024,
  runtimeReserveInodes: 10_000,
});

const DEPENDENCY_PROJECTION_LIMITS = Object.freeze({
  maxMappings: 128,
  maxFiles: 1_000_000,
  maxDirectories: 250_000,
  maxBytes: 2 * 1024 * 1024 * 1024,
  maxFileBytes: 512 * 1024 * 1024,
  maxPathBytes: 4096,
  maxDepth: 256,
});

const MAX_KIMI_CREDENTIAL_METADATA_BYTES = 64 * 1024;
const MAX_GROK_CREDENTIAL_METADATA_BYTES = 64 * 1024;
const GROK_AUTH_EARLY_INVALIDATION_MS = 5 * 60 * 1000;
const KIMI_CREDENTIAL_FILES = Object.freeze([
  'config.toml', 'device_id', 'credentials/kimi-code.json', 'oauth/kimi-code',
]);

const DEFAULT_ROUTES = Object.freeze([
  ...['minimal', 'low', 'medium', 'high', 'xhigh'].map((effort) => Object.freeze({
    harness: 'codex', model: 'gpt-5.6-sol', effort,
  })),
  ...['low', 'high', 'max'].map((effort) => Object.freeze({
    harness: 'kimi-code', model: 'kimi-code/k3', effort,
  })),
  ...['low', 'medium', 'high'].map((effort) => Object.freeze({
    harness: 'grok', model: 'grok-4.5', effort,
  })),
  ...['low', 'medium', 'high', 'xhigh', 'max'].map((effort) => Object.freeze({
    harness: 'claude-code', provider: 'claude', model: 'claude-opus-4-6', effort,
  })),
]);

function deploymentError(message) {
  return Object.assign(new TypeError(message), { code: 'deployment_config_invalid' });
}

function deploymentPreflightError(message) {
  return Object.assign(new Error(message), { code: 'deployment_preflight_failed' });
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function closed(value, fields, label) {
  if (!record(value)) throw deploymentError(`${label} must be an object`);
  const unknown = Object.keys(value).find((field) => !fields.includes(field));
  if (unknown) throw deploymentError(`${label} contains unsupported field ${unknown}`);
}

function privateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  return realpathSync(path);
}

function git(args, cwd, options = {}) {
  const { gitEnv = {}, ...execOptions } = options;
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_') && value !== undefined) env[key] = value;
  }
  return execFileSync('git', args, {
    cwd,
    env: {
      ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', ...gitEnv,
    },
    ...execOptions,
  });
}

function repositoryAuthority(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw deploymentError('repo must identify one Git repository');
  }
  let requested;
  try { requested = realpathSync(resolve(value)); }
  catch { throw deploymentError('repo must identify one existing Git repository'); }
  try {
    const root = realpathSync(git(['rev-parse', '--show-toplevel'], requested, { encoding: 'utf8' }).trim());
    const commonRaw = git(['rev-parse', '--git-common-dir'], root, { encoding: 'utf8' }).trim();
    const common = realpathSync(isAbsolute(commonRaw) ? commonRaw : resolve(root, commonRaw));
    const repoId = `repo-${createHash('sha256').update(common).digest('hex').slice(0, 32)}`;
    return Object.freeze({ root, common, repoId });
  } catch {
    throw deploymentError('repo must identify one readable Git worktree');
  }
}

const SNAPSHOT_CREDENTIAL_PATHS = Object.freeze([
  'glm_key.json', '.env', '.env.local', '.env.development', '.env.test', '.env.production',
]);

function repositorySnapshot(repoRoot, stateRoot) {
  const head = git(['rev-parse', 'HEAD'], repoRoot, { encoding: 'utf8' }).trim();
  const dirty = git(['status', '--porcelain=v1', '--untracked-files=all'], repoRoot, {
    encoding: 'utf8',
  }).trim().length > 0;
  const trackedCredentials = git(['ls-files', '-z', '--', ...SNAPSHOT_CREDENTIAL_PATHS], repoRoot)
    .toString('utf8').split('\0').filter(Boolean);
  if (!dirty && trackedCredentials.length === 0) {
    return Object.freeze({ sha: head, source: 'head' });
  }

  const indexPath = join(
    stateRoot,
    `snapshot-index-${process.pid}-${randomBytes(8).toString('hex')}`,
  );
  const timestamp = new Date().toISOString();
  const gitEnv = {
    GIT_INDEX_FILE: indexPath,
    GIT_AUTHOR_NAME: 'Baton deployment snapshot',
    GIT_AUTHOR_EMAIL: 'baton-snapshot@localhost',
    GIT_COMMITTER_NAME: 'Baton deployment snapshot',
    GIT_COMMITTER_EMAIL: 'baton-snapshot@localhost',
    GIT_AUTHOR_DATE: timestamp,
    GIT_COMMITTER_DATE: timestamp,
  };
  try {
    git(['read-tree', head], repoRoot, { gitEnv, stdio: 'ignore' });
    git(['add', '-A', '--', '.'], repoRoot, { gitEnv, stdio: 'ignore' });
    git(['update-index', '--force-remove', '--', ...SNAPSHOT_CREDENTIAL_PATHS], repoRoot, {
      gitEnv, stdio: 'ignore',
    });
    const tree = git(['write-tree'], repoRoot, { encoding: 'utf8', gitEnv }).trim();
    const headTree = git(['rev-parse', `${head}^{tree}`], repoRoot, { encoding: 'utf8' }).trim();
    if (tree === headTree) return Object.freeze({ sha: head, source: 'head' });
    const sha = git(['commit-tree', tree, '-p', head], repoRoot, {
      encoding: 'utf8', gitEnv, input: 'Baton private effective-tree snapshot\n',
    }).trim();
    return Object.freeze({ sha, source: 'effective-tree' });
  } catch (cause) {
    throw Object.assign(deploymentError('repository effective-tree snapshot failed'), { cause });
  } finally {
    rmSync(indexPath, { force: true });
  }
}

function normalizeRoutes(value = DEFAULT_ROUTES) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw deploymentError('advanced routes must be a non-empty bounded array');
  }
  const seen = new Set();
  return value.map((route) => {
    closed(route, ['effort', 'harness', 'model', 'provider'], 'advanced route');
    for (const field of ['harness', 'model', 'effort']) {
      if (typeof route[field] !== 'string' || route[field].length === 0 || route[field].length > 256) {
        throw deploymentError(`advanced route ${field} is invalid`);
      }
    }
    if (route.provider !== undefined
      && (typeof route.provider !== 'string' || route.provider.length === 0 || route.provider.length > 128)) {
      throw deploymentError('advanced route provider is invalid');
    }
    const assembly = JSON.stringify(route);
    if (seen.has(assembly)) throw deploymentError('advanced routes contain a duplicate');
    seen.add(assembly);
    return Object.freeze({ ...route });
  });
}

function publicRoute(route) {
  return Object.freeze({ harness: route.harness, model: route.model, effort: route.effort });
}

function normalizeVerification(value, repoRoot) {
  if (value !== undefined) {
    closed(value, ['arguments', 'command'], 'advanced verification');
    if (typeof value.command !== 'string' || value.command.length === 0 || value.command.includes('\0')
      || !Array.isArray(value.arguments) || value.arguments.length > 64
      || value.arguments.some((argument) => typeof argument !== 'string' || argument.includes('\0'))) {
      throw deploymentError('advanced verification is invalid');
    }
    return Object.freeze({ command: value.command, arguments: [...value.arguments] });
  }
  if (existsSync(join(repoRoot, 'impl', 'package.json'))) {
    return Object.freeze({ command: 'npm', arguments: ['test', '--prefix', 'impl'] });
  }
  if (existsSync(join(repoRoot, 'package.json'))) {
    return Object.freeze({ command: 'npm', arguments: ['test'] });
  }
  throw deploymentError('repository verification is ambiguous; configure advanced verification');
}

function normalizeCapacity(value) {
  if (value === undefined) return null;
  closed(value, ['estimate', 'observe'], 'advanced capacity');
  if (typeof value.estimate !== 'function' || typeof value.observe !== 'function') {
    throw deploymentError('advanced capacity must provide estimate and observe functions');
  }
  return Object.freeze({ estimate: value.estimate, observe: value.observe });
}

function existingRegular(path) {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch { return false; }
}

function existingDirectory(path) {
  try {
    const stat = lstatSync(path);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch { return false; }
}

function existingExecutable(path) {
  try {
    const resolved = realpathSync(path);
    const stat = lstatSync(resolved);
    return stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o111) !== 0;
  } catch { return false; }
}

function userConfigRoot() {
  const configured = process.env.XDG_CONFIG_HOME;
  if (configured === undefined || configured === '') return join(homedir(), '.config');
  if (!isAbsolute(configured) || configured.includes('\0')) {
    throw deploymentError('XDG_CONFIG_HOME must be an absolute path');
  }
  return configured;
}

function kimiThroughClaudeCredential() {
  return join(userConfigRoot(), 'baton', 'credentials', 'kimi.json');
}

function kimiAuthenticationSummary(code) {
  if (code === 'authentication_refresh_required') {
    return 'Kimi authentication has expired. Run the ordinary `kimi` login flow to refresh authentication, then reopen Baton.';
  }
  if (code === 'authentication_metadata_invalid') {
    return 'Kimi authentication metadata could not be validated. Run the ordinary `kimi` login flow to refresh authentication, then reopen Baton.';
  }
  return 'Kimi authentication is absent. Run the ordinary `kimi` login flow, then reopen Baton.';
}

function kimiAuthenticationState(kimiRoot, nowMs = Date.now()) {
  if (!KIMI_CREDENTIAL_FILES.every((path) => existingRegular(join(kimiRoot, path)))) {
    const code = 'authentication_required';
    return Object.freeze({ state: 'blocked', code, credentialState: 'absent', summary: kimiAuthenticationSummary(code) });
  }

  const credentialPath = join(kimiRoot, 'credentials', 'kimi-code.json');
  let descriptor;
  try {
    descriptor = openSync(credentialPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(descriptor);
    const ownerUid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (!stat.isFile() || stat.isSymbolicLink()
      || stat.size <= 0 || stat.size > MAX_KIMI_CREDENTIAL_METADATA_BYTES
      || (stat.mode & 0o400) === 0 || (ownerUid !== null && stat.uid !== ownerUid)) {
      throw new Error('credential metadata boundary refused');
    }
    const value = JSON.parse(readFileSync(descriptor, 'utf8'));
    const accessTokenPresent = record(value)
      && typeof value.access_token === 'string' && value.access_token.length > 0
      && value.access_token.length <= MAX_KIMI_CREDENTIAL_METADATA_BYTES;
    const tokenTypePresent = record(value)
      && typeof value.token_type === 'string' && value.token_type.toLowerCase() === 'bearer';
    const expiresAt = record(value) ? value.expires_at : null;
    if (!accessTokenPresent || !tokenTypePresent
      || !Number.isSafeInteger(expiresAt) || expiresAt <= 0
      || expiresAt > Math.floor(Number.MAX_SAFE_INTEGER / 1000)) {
      throw new Error('credential metadata schema refused');
    }
    if ((expiresAt * 1000) <= nowMs) {
      const code = 'authentication_refresh_required';
      return Object.freeze({ state: 'blocked', code, credentialState: 'expired', summary: kimiAuthenticationSummary(code) });
    }
    return Object.freeze({ state: 'ready', credentialState: 'available' });
  } catch {
    const code = 'authentication_metadata_invalid';
    return Object.freeze({ state: 'blocked', code, credentialState: 'invalid', summary: kimiAuthenticationSummary(code) });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function grokAuthenticationSummary(code) {
  if (code === 'authentication_refresh_required') {
    return 'Grok authentication has expired. Run the ordinary `grok login` flow to refresh authentication, then reopen Baton.';
  }
  if (code === 'authentication_metadata_invalid') {
    return 'Grok authentication metadata could not be validated. Run the ordinary `grok login` flow to refresh authentication, then reopen Baton.';
  }
  return 'Grok authentication is absent. Run the ordinary `grok login` flow, then reopen Baton.';
}

function grokAuthenticationState(credentialPath, nowMs = Date.now()) {
  if (!existingRegular(credentialPath)) {
    const code = 'authentication_required';
    return Object.freeze({
      state: 'blocked', code, credentialState: 'absent', summary: grokAuthenticationSummary(code),
    });
  }

  let descriptor;
  try {
    descriptor = openSync(credentialPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(descriptor);
    const ownerUid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (!stat.isFile() || stat.isSymbolicLink()
      || stat.size <= 0 || stat.size > MAX_GROK_CREDENTIAL_METADATA_BYTES
      || (stat.mode & 0o400) === 0 || (ownerUid !== null && stat.uid !== ownerUid)) {
      throw new Error('credential metadata boundary refused');
    }

    const value = JSON.parse(readFileSync(descriptor, 'utf8'));
    if (!record(value)) throw new Error('credential metadata schema refused');
    const entries = Object.entries(value);
    if (entries.length === 0 || entries.length > 32
      || entries.some(([scope]) => scope.length === 0 || scope.length > 1024 || /[\0\r\n]/u.test(scope))) {
      throw new Error('credential metadata schema refused');
    }

    const states = entries.map(([scope, entry]) => {
      if (!record(entry)
        || typeof entry.key !== 'string' || entry.key.length === 0
        || entry.key.length > MAX_GROK_CREDENTIAL_METADATA_BYTES) {
        return 'invalid';
      }
      // The CLI documents xai::api_key as its non-expiring, locally selected API-key scope.
      // Every cached subscription/OIDC session is time-bound and must carry explicit RFC3339
      // expiry metadata. No token, account identity, issuer, or scope is projected publicly.
      if (scope === 'xai::api_key') return 'available';
      if (typeof entry.expires_at !== 'string' || entry.expires_at.length > 128
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(entry.expires_at)) {
        return 'invalid';
      }
      const expiresAt = Date.parse(entry.expires_at);
      if (!Number.isFinite(expiresAt)) return 'invalid';
      return expiresAt <= (nowMs + GROK_AUTH_EARLY_INVALIDATION_MS) ? 'expired' : 'available';
    });
    // Baton cannot safely infer which locally cached scope the CLI will select when more than one
    // credential is present. Refuse that ambiguity instead of guessing a convenient ready entry.
    if (states.length !== 1 || states.includes('invalid')) {
      throw new Error('credential metadata schema refused');
    }
    if (states[0] === 'available') {
      return Object.freeze({ state: 'ready', credentialState: 'available' });
    }
    if (states[0] === 'expired') {
      const code = 'authentication_refresh_required';
      return Object.freeze({
        state: 'blocked', code, credentialState: 'expired', summary: grokAuthenticationSummary(code),
      });
    }
    throw new Error('credential metadata schema refused');
  } catch {
    const code = 'authentication_metadata_invalid';
    return Object.freeze({
      state: 'blocked', code, credentialState: 'invalid', summary: grokAuthenticationSummary(code),
    });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function requiredDependencyTrees(repoRoot) {
  const npmProjects = [
    { lock: 'package-lock.json', tree: 'node_modules', install: 'npm ci' },
    { lock: 'impl/package-lock.json', tree: 'impl/node_modules', install: 'npm ci --prefix impl' },
  ];
  return npmProjects.filter(({ lock }) => existingRegular(join(repoRoot, lock)));
}

function preflightDeployment(repoRoot, verification) {
  const missingDependency = requiredDependencyTrees(repoRoot)
    .find(({ tree }) => !existingDirectory(join(repoRoot, tree)));
  if (missingDependency) {
    throw deploymentPreflightError(
      `Required dependency tree ${missingDependency.tree} is absent; run ${missingDependency.install} before opening Baton.`,
    );
  }

  const command = verification.command;
  const candidates = isAbsolute(command) || command.includes('/')
    ? [isAbsolute(command) ? command : resolve(repoRoot, command)]
    : commandCandidates(command);
  if (!candidates.some(existingExecutable)) {
    throw deploymentPreflightError(
      `The verification executable ${command} is unavailable; install it or configure an executable verification command.`,
    );
  }
  return Object.freeze({
    repository: Object.freeze({ state: 'ready' }),
    verification: Object.freeze({ state: 'ready', command }),
    dependencies: Object.freeze({ state: 'ready' }),
  });
}

function dependencyDirectories(repoRoot) {
  return ['node_modules', 'impl/node_modules'].filter((path) => existingDirectory(join(repoRoot, path)));
}

function dependencyProjection(repoRoot, repoId) {
  const dependencies = dependencyDirectories(repoRoot);
  if (dependencies.length === 0) return null;
  const descriptor = Object.freeze({
    schemaVersion: 1,
    sourceRoot: repoRoot,
    sourceId: `${repoId}-dependencies`,
    mappings: Object.freeze(dependencies.map((path) => Object.freeze({
      sourcePath: path, targetPath: path,
    }))),
    limits: DEPENDENCY_PROJECTION_LIMITS,
  });
  try {
    const identity = inspectToolchainProjection(descriptor);
    return Object.freeze({ ...descriptor, expectedManifestDigest: identity.manifestDigest });
  } catch (cause) {
    throw Object.assign(deploymentPreflightError(
      'Installed dependency trees could not be attested for private worker projection; reinstall dependencies and retry.',
    ), { cause });
  }
}

function trackedTreeBounds(repoRoot, treeish) {
  const rows = git(['ls-tree', '-r', '-l', '-z', treeish], repoRoot).toString('utf8').split('\0').filter(Boolean);
  let bytes = 0;
  for (const row of rows) {
    const match = /^\d+ (?:blob|commit) [a-f0-9]+\s+(\d+|-)\t/u.exec(row);
    if (!match) throw deploymentError('repository tree inventory is invalid');
    if (match[1] !== '-') bytes += Number(match[1]);
  }
  return Object.freeze({
    maxFiles: Math.max(256, Math.ceil(rows.length * 1.5) + 64),
    maxBytes: Math.max(64 * 1024 * 1024, Math.ceil(bytes * 2) + (64 * 1024 * 1024)),
  });
}

function defaultCredentialProjection(repoRoot, { projectNativeKimi = false } = {}) {
  const credentials = {};
  const codex = join(homedir(), '.codex', 'auth.json');
  const grok = join(homedir(), '.grok', 'auth.json');
  const claude = join(homedir(), '.claude', '.credentials.json');
  if (existingRegular(codex)) credentials.codex = [codex];
  if (existingRegular(grok)) credentials.grok = [grok];
  if (existingRegular(claude)) credentials.claude = [claude];
  const kimiRoot = join(homedir(), '.kimi-code');
  const credentialTrees = projectNativeKimi
    ? { 'kimi-code': [{ sourceRoot: kimiRoot, relativeFiles: KIMI_CREDENTIAL_FILES }] } : {};
  return Object.freeze({ credentialFiles: credentials, credentialTrees, repoRoot });
}

function locallyReadyRoutes(repoRoot) {
  const codexReady = existingRegular(join(homedir(), '.codex', 'auth.json'));
  const grokReady = existingRegular(join(homedir(), '.grok', 'auth.json'));
  const claudeReady = existingRegular(join(homedir(), '.claude', '.credentials.json'));
  const kimiRoot = join(homedir(), '.kimi-code');
  const kimiReady = KIMI_CREDENTIAL_FILES
    .every((path) => existingRegular(join(kimiRoot, path)));
  const routes = DEFAULT_ROUTES.filter((route) => (
    route.harness === 'codex' ? codexReady
      : route.harness === 'grok' ? grokReady
        : route.harness === 'kimi-code' ? kimiReady
          : route.harness === 'claude-code' ? claudeReady : false
  ));
  if (existingRegular(kimiThroughClaudeCredential())) {
    routes.push(Object.freeze({
      harness: 'claude-code', provider: 'kimi', model: 'kimi-k3[1m]', effort: 'max',
    }));
  }
  if (existingRegular(join(repoRoot, 'glm_key.json'))) {
    routes.push(Object.freeze({ harness: 'glm', model: 'glm-5.2', effort: 'xhigh' }));
  }
  return routes;
}

function commandCandidates(name, extras = []) {
  const candidates = [...extras];
  try {
    candidates.push(...execFileSync('/usr/bin/which', ['-a', name], {
      encoding: 'utf8', timeout: 5_000,
    }).split('\n').filter(Boolean));
  } catch { /* an unavailable executable is handled by the caller's capability probe */ }
  return [...new Set(candidates)];
}

function codexCommand() {
  const candidates = commandCandidates('codex', [join(dirname(process.execPath), 'codex')]);
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['app-server', '--help'], {
        stdio: 'ignore', timeout: 5_000, maxBuffer: 1024 * 1024,
      });
      return candidate;
    } catch { /* keep probing exact candidates */ }
  }
  throw deploymentError('Codex route requires a compatible app-server executable');
}

function builtInAdapters(routes, repoRoot) {
  const adapters = {};
  const kimiCommand = existingRegular(join(homedir(), '.kimi-code', 'bin', 'kimi'))
    ? join(homedir(), '.kimi-code', 'bin', 'kimi') : 'kimi';
  const grouped = new Map();
  for (const route of routes) {
    const provider = route.provider ?? (route.harness === 'claude-code' ? 'claude' : route.harness);
    const key = `${route.harness}:${provider}`;
    const rows = grouped.get(key) ?? [];
    rows.push(route);
    grouped.set(key, rows);
  }
  for (const [key, rows] of grouped) {
    const route = rows[0];
    if (route.harness === 'codex') {
      adapters[key] = new CodexAppServerCli({
        cmd: codexCommand(), requestTimeoutMs: 45_000, model: route.model, ceiling: 4,
      });
    } else if (route.harness === 'grok') {
      adapters[key] = new GrokAcpCli({ requestTimeoutMs: 45_000, model: route.model, ceiling: 4 });
    } else if (route.harness === 'kimi-code') {
      const catalog = Object.fromEntries([...new Set(rows.map((row) => row.model))].map((model) => [
        model, [...new Set(rows.filter((row) => row.model === model).map((row) => row.effort))],
      ]));
      adapters[key] = new KimiAcpCli({
        cmd: kimiCommand, requestTimeoutMs: 45_000, model: route.model, modelCatalog: catalog, ceiling: 1,
      });
    } else if (route.harness === 'claude-code' && (route.provider ?? 'claude') === 'claude') {
      adapters[key] = new ClaudeSessionCli({ model: route.model, approvals: false, ceiling: 4 });
    } else if (route.harness === 'claude-code' && route.provider === 'kimi') {
      const credential = kimiThroughClaudeCredential();
      if (!existingRegular(credential)) throw deploymentError('Kimi-through-Claude requires the private Baton Kimi credential file');
      adapters[key] = new KimiSessionCli({ authTokenFile: credential, repoRoot, model: route.model, approvals: false, ceiling: 2 });
    } else if (route.harness === 'glm') {
      if (rows.some((row) => row.model !== 'glm-5.2')) {
        throw deploymentError('current GLM routes permit only glm-5.2');
      }
      const credential = join(repoRoot, 'glm_key.json');
      if (!existingRegular(credential)) throw deploymentError('GLM 5.2 requires the project credential file');
      adapters[key] = new GlmSessionCli({
        authTokenFile: credential, authTokenJsonPointer: '/glm_key', harness: 'glm',
        model: 'glm-5.2', approvals: false, ceiling: 1,
      });
    } else {
      throw deploymentError(`unsupported built-in route ${route.harness}`);
    }
  }
  return Object.freeze(adapters);
}

function goalPlanPolicy(repoId) {
  return Object.freeze({
    schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: DEFAULT_BUDGET.wallMin * 60_000,
    riskClasses: ['low', 'medium', 'high', 'critical'],
    effectClasses: ['provider_call', 'repository_edit'],
    capabilityClasses: ['baton_orchestrator', 'code', 'test'],
    limits: {
      maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 16, maxDepsPerNode: 16,
      maxTextBytes: 16_384, maxItems: 128, maxScopePaths: 128, maxRouteValues: 64,
      maxGoalBytes: 256 * 1024, maxPlanBytes: 512 * 1024, maxStatusBytes: 1024 * 1024,
      maxTokens: DEFAULT_BUDGET.tokens, maxUsd: DEFAULT_BUDGET.usd,
      maxWallMin: DEFAULT_BUDGET.wallMin, maxProviderTurns: DEFAULT_BUDGET.providerTurns,
    },
  });
}

function applicationProfile(repoId, routes, verification, exportBounds) {
  return Object.freeze({
    schemaVersion: 2,
    repoId,
    definitionOfDone: [
      'The requested repository improvement is implemented and verified.',
      'Baton preserves exact route, result, and cleanup truth.',
    ],
    constraints: [
      'Use the unified Baton Run application and its advertised actions.',
      'Do not claim completion without the deployment verification command.',
    ],
    risk: 'high',
    goalBudget: DEFAULT_BUDGET,
    nodeBudget: DEFAULT_BUDGET,
    pathScope: ['**'],
    verification: {
      command: verification.command, arguments: verification.arguments,
      cwd: '.', envAllowlist: ['PATH'], expectExit: 0, expectResult: 'exit_code',
      timeoutMs: DEFAULT_BUDGET.wallMin * 60_000, maxOutputBytes: 1024 * 1024,
      requiredPredecessorEvidence: [],
    },
    routes: routes.map(publicRoute),
    capabilities: ['baton_orchestrator', 'code', 'test'],
    effects: ['provider_call', 'repository_edit'],
    requiredEffects: ['repository_edit'],
    workerPolicy: DEFAULT_WORKER_POLICY_REQUEST,
    resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
    integrationPolicy: {
      mode: 'manual', strategies: ['ff-only', 'structured'],
      requireAdoptedResult: true, requireSemanticReview: false,
    },
    followPolicy: {
      mode: 'enabled', maxWaitMs: 30_000, maxChanges: 128,
      maxResponseBytes: 512 * 1024, maxScanEvents: 1024,
    },
    exportPolicy: {
      mode: 'manual', format: 'directory-v1',
      maxFiles: exportBounds.maxFiles, maxBytes: exportBounds.maxBytes,
      requireAdoptedResult: true, requireSemanticReview: false, requireIntegration: true,
    },
  });
}

function routeCardMatches(card, route) {
  if (card?.harness !== route.harness) return false;
  const selection = card?.modelSelection;
  const modelAvailable = selection?.mode === 'exact'
    && (Array.isArray(selection.available)
      ? selection.available.includes(route.model)
      : selection.configuredDefault === route.model
        || selection.acceptedAliases?.includes(route.model) === true
        || selection.acceptedPrefixes?.some((prefix) => route.model.startsWith(prefix)) === true);
  return modelAvailable && Array.isArray(selection?.reasoningEffort)
    && selection.reasoningEffort.includes(route.effort);
}

function publicCardAtom(value, fallback = 'unobserved') {
  return typeof value === 'string' && value.length > 0 && value.length <= 64
    && /^[A-Za-z0-9][A-Za-z0-9._+:/-]*$/u.test(value) ? value : fallback;
}

function publicHarnessVersion(value) {
  if (value === 'unavailable') return Object.freeze({ state: 'unavailable', value: 'unavailable' });
  if (value === 'unknown') return Object.freeze({ state: 'unknown', value: 'unknown' });
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || /[\0\r\n]/u.test(value)) {
    return Object.freeze({ state: 'unknown', value: 'unknown' });
  }
  // Project only a bounded version token from vendor output. Arbitrary probe output, executable
  // paths, and adapter-authored prose never enter the ordinary deployment card.
  const observed = /(?:^|[^0-9])v?(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]{1,64})?)(?:$|[^A-Za-z0-9.+-])/u.exec(value)?.[1];
  return observed
    ? Object.freeze({ state: 'observed', value: observed })
    : Object.freeze({ state: 'unknown', value: 'unknown' });
}

function publicRouteRuntime(card) {
  const isolation = record(card?.isolation) ? card.isolation : {};
  const permissions = record(card?.permissions) ? card.permissions : {};
  const policy = record(card?.workerPolicy) ? card.workerPolicy : {};
  const containment = record(policy.containment) ? policy.containment : {};
  const guarantees = Array.isArray(containment.guarantees)
    ? [...new Set(containment.guarantees.map((value) => publicCardAtom(value, null)).filter(Boolean))].slice(0, 16)
    : [];
  return Object.freeze({
    version: publicHarnessVersion(card?.version),
    authentication: Object.freeze({
      posture: publicCardAtom(card?.authPosture),
      state: publicCardAtom(card?.providerCompatibility?.credentialState),
    }),
    permissions: Object.freeze({
      mode: publicCardAtom(permissions.mode),
      sandbox: publicCardAtom(permissions.sandbox),
      autonomy: publicCardAtom(policy.autonomy?.default),
      access: publicCardAtom(policy.access?.default),
    }),
    containment: Object.freeze({
      filesystem: publicCardAtom(isolation.filesystem),
      osSandbox: publicCardAtom(isolation.osSandbox),
      network: publicCardAtom(isolation.network),
      hostProcess: publicCardAtom(containment.hostProcess),
      guarantees: Object.freeze(guarantees),
      observation: publicCardAtom(containment.observation),
    }),
  });
}

function deploymentReadiness(
  preflight,
  routes,
  adapters,
  nativeKimiAuthentication = null,
  nativeGrokAuthentication = null,
) {
  const cards = Object.entries(adapters).map(([name, adapter]) => Object.freeze({
    name, card: adapter.card(),
  }));
  const routeStates = routes.map((route) => {
    const preferredName = route.provider ? `${route.harness}:${route.provider}` : null;
    const preferred = preferredName
      ? cards.filter(({ name, card }) => name === preferredName && routeCardMatches(card, route)) : [];
    const matches = preferred.length > 0 ? preferred : cards.filter(({ card }) => routeCardMatches(card, route));
    const publicFields = publicRoute(route);
    if (matches.length !== 1) {
      return Object.freeze({
        ...publicFields,
        state: 'blocked',
        code: matches.length === 0 ? 'route_unavailable' : 'route_ambiguous',
        summary: matches.length === 0
          ? 'No adapter advertises this exact route.'
          : 'More than one adapter advertises this exact route.',
      });
    }
    const matchedCard = matches[0].card;
    let runtime = publicRouteRuntime(matchedCard);
    if (route.harness === 'kimi-code' && nativeKimiAuthentication) {
      runtime = Object.freeze({
        ...runtime,
        authentication: Object.freeze({
          ...runtime.authentication,
          state: nativeKimiAuthentication.credentialState,
        }),
      });
      if (nativeKimiAuthentication.state === 'blocked') {
        return Object.freeze({
          ...publicFields,
          state: 'blocked',
          code: nativeKimiAuthentication.code,
          summary: nativeKimiAuthentication.summary,
          runtime,
        });
      }
    }
    if (route.harness === 'grok' && nativeGrokAuthentication) {
      runtime = Object.freeze({
        ...runtime,
        authentication: Object.freeze({
          ...runtime.authentication,
          state: nativeGrokAuthentication.credentialState,
        }),
      });
      if (nativeGrokAuthentication.state === 'blocked') {
        return Object.freeze({
          ...publicFields,
          state: 'blocked',
          code: nativeGrokAuthentication.code,
          summary: nativeGrokAuthentication.summary,
          runtime,
        });
      }
    }
    const advertised = matchedCard.readiness;
    if (advertised?.state === 'blocked') {
      const code = typeof advertised.code === 'string' && advertised.code.length > 0
        ? advertised.code : 'route_not_ready';
      const summary = typeof advertised.summary === 'string' && advertised.summary.length > 0
        ? advertised.summary : 'The route is not ready.';
      return Object.freeze({ ...publicFields, state: 'blocked', code, summary, runtime });
    }
    const credentialState = runtime.authentication.state;
    if (['absent', 'expired', 'invalid', 'unavailable'].includes(credentialState)) {
      return Object.freeze({
        ...publicFields, state: 'blocked', code: 'authentication_required',
        summary: 'The configured provider credential is not ready.', runtime,
      });
    }
    if (runtime.version.state !== 'observed') {
      return Object.freeze({
        ...publicFields, state: 'blocked', code: 'harness_unavailable',
        summary: 'The configured harness executable was not observed as compatible.', runtime,
      });
    }
    return Object.freeze({
      ...publicFields, state: 'ready',
      summary: 'The exact route passed static deployment readiness.', runtime,
    });
  });
  return Object.freeze({
    schemaVersion: 1,
    ready: routeStates.some((route) => route.state === 'ready'),
    repository: preflight.repository,
    verification: preflight.verification,
    dependencies: preflight.dependencies,
    routes: Object.freeze(routeStates),
  });
}

function requestedReadiness(options, routeStates) {
  if (!record(options)) return null;
  let selector = null;
  if (record(options.exact)) selector = options.exact;
  else if (['harness', 'model', 'effort'].some((field) => options[field] !== undefined)) {
    selector = options;
  } else if (routeStates.length === 1) {
    return routeStates[0];
  }
  if (!selector) return null;
  const matches = routeStates.filter((route) => (
    (selector.harness === undefined || selector.harness === route.harness)
    && (selector.model === undefined || selector.model === route.model)
    && (selector.effort === undefined || selector.effort === route.effort)
  ));
  return matches.length === 1 ? matches[0] : null;
}

function assertRouteReady(options, readiness) {
  const route = requestedReadiness(options, readiness.routes);
  if (route?.state !== 'blocked') return;
  throw Object.assign(new Error(route.summary), {
    code: route.code,
    route: Object.freeze({ harness: route.harness, model: route.model, effort: route.effort }),
  });
}

class BatonDeployment {
  #application;
  #baton;
  #card;
  #principal;
  #readiness;
  #closePromise = null;

  constructor(application, principal, readiness) {
    this.#application = application;
    this.#principal = principal;
    this.#baton = bindBaton(application, principal);
    this.#readiness = readiness;
    this.#card = Object.freeze({ ...application.card(), readiness });
    this.ready = application.ready;
    Object.freeze(this);
  }

  card() { return this.#card; }
  async doctor() { return this.#readiness; }

  async run(objective, route = {}) {
    assertRouteReady(route, this.#readiness);
    return this.#baton.runs.start(objective, route);
  }

  async startMany(requests) {
    if (Array.isArray(requests)) {
      for (const request of requests) {
        if (record(request)) assertRouteReady(request, this.#readiness);
      }
    }
    return this.#baton.runs.startMany(requests);
  }

  async workflow(objective, options = {}) {
    if (record(options) && Array.isArray(options.team)) {
      for (const member of options.team) {
        if (record(member) && record(member.exact)) assertRouteReady({ exact: member.exact }, this.#readiness);
      }
    }
    return this.#baton.workflow(objective, options);
  }

  open(runId) { return this.#baton.runs.open(runId); }

  close() {
    if (!this.#closePromise) this.#closePromise = this.#application.shutdown(this.#principal);
    return this.#closePromise;
  }
}

export async function openBatonDeployment(rawOptions, createDriver) {
  closed(rawOptions, ['advanced', 'repo'], 'deployment options');
  const repository = repositoryAuthority(rawOptions.repo ?? process.cwd());
  const advanced = rawOptions.advanced ?? {};
  closed(advanced, ['adapters', 'capacity', 'deploymentRoot', 'routes', 'verification'], 'advanced');
  const capacity = normalizeCapacity(advanced.capacity);
  const routes = normalizeRoutes(advanced.routes ?? locallyReadyRoutes(repository.root));
  const publicRoutes = routes.map(publicRoute);
  if (new Set(publicRoutes.map((route) => JSON.stringify(route))).size !== publicRoutes.length) {
    throw deploymentError('advanced routes collapse to a duplicate public exact tuple');
  }
  const verification = normalizeVerification(advanced.verification, repository.root);
  const preflight = preflightDeployment(repository.root, verification);
  const toolchainProjection = dependencyProjection(repository.root, repository.repoId);
  const usesBuiltInAdapters = advanced.adapters === undefined;
  const nativeKimiAuthentication = usesBuiltInAdapters
    && routes.some((route) => route.harness === 'kimi-code')
    ? kimiAuthenticationState(join(homedir(), '.kimi-code')) : null;
  const nativeGrokAuthentication = usesBuiltInAdapters
    && routes.some((route) => route.harness === 'grok')
    ? grokAuthenticationState(join(homedir(), '.grok', 'auth.json')) : null;
  ensureBatonExcluded(repository.root);
  const deploymentRoot = privateDirectory(advanced.deploymentRoot
    ?? join(repository.common, 'baton', 'application-v1'));
  const stateRoot = privateDirectory(join(deploymentRoot, 'state'));
  const runtimeRoot = privateDirectory(join(deploymentRoot, 'runtime'));
  const evidenceRoot = privateDirectory(join(deploymentRoot, 'evidence'));
  const snapshot = repositorySnapshot(repository.root, stateRoot);
  const adapters = advanced.adapters ?? builtInAdapters(routes, repository.root);
  if (!record(adapters) || Object.keys(adapters).length === 0) {
    throw deploymentError('advanced adapters must be a non-empty object');
  }
  const readiness = deploymentReadiness(
    preflight, routes, adapters, nativeKimiAuthentication, nativeGrokAuthentication,
  );
  const projection = defaultCredentialProjection(repository.root, {
    projectNativeKimi: nativeKimiAuthentication?.state === 'ready',
  });
  const policy = goalPlanPolicy(repository.repoId);
  const driver = createDriver({
    repoRoot: repository.root,
    repoId: repository.repoId,
    deploymentBaseSha: snapshot.sha,
    logDir: stateRoot,
    adapters,
    worktreeCapacity: DEFAULT_WORKTREE_CAPACITY,
    ...(capacity ? {
      worktreeCapacityEstimate: capacity.estimate,
      worktreeCapacityObserve: capacity.observe,
    } : {}),
    ...(toolchainProjection ? { toolchainProjection } : {}),
    runtimeIsolation: {
      root: runtimeRoot,
      credentialFiles: projection.credentialFiles,
      credentialTrees: projection.credentialTrees,
    },
    goalPlanAuthority: { policy, authorize: async () => true },
    runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY,
    approvalTimeoutMs: DEFAULT_BUDGET.wallMin * 60_000,
    stopDeadlineMs: 15_000,
    drainPolicy: { maxWorkers: 64, timeoutMs: 90_000, pollMs: 10 },
    budgetPolicy: { terminalGraceMs: 2_000 },
    watchdog: { stallMs: DEFAULT_BUDGET.wallMin * 60_000 },
  });
  const principal = Object.freeze({
    actor: `deployment:${repository.repoId}`, principalId: 'local-owner', sessionId: 'local-owner-session',
  });
  const service = (name) => Object.freeze({
    actor: `deployment:${name}`, principalId: `service-${name}`, sessionId: `service-${name}-session`,
  });
  let application;
  try {
    application = new BatonApplication({
      driver,
      repoId: repository.repoId,
      profiles: {
        default: applicationProfile(
          repository.repoId, routes, verification,
          trackedTreeBounds(repository.root, snapshot.sha),
        ),
      },
      defaults: { profile: 'default', route: publicRoutes.length === 1 ? publicRoutes[0] : null },
      exportRoot: evidenceRoot,
      principals: { planner: service('planner'), dispatcher: service('dispatcher'), observer: service('observer') },
      authorize: async () => true,
    });
    await application.ready;
    return new BatonDeployment(application, principal, readiness);
  } catch (error) {
    try {
      if (application) await application.shutdown(principal);
      else await driver.closeAsync();
    } catch {
      try { await driver.closeAsync(); } catch { /* original construction failure remains authoritative */ }
    }
    throw error;
  }
}

export { DEFAULT_ROUTES as DEFAULT_BATON_DEPLOYMENT_ROUTES };
