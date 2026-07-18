import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, realpathSync, rmSync,
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
import { DEFAULT_WORKER_POLICY_REQUEST } from './worker-policy.mjs';

const DEFAULT_BUDGET = Object.freeze({
  tokens: 10_000_000, usd: 100, wallMin: 60, providerTurns: 128,
});

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
    if (typeof value.command !== 'string' || value.command.length === 0
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

function dependencyDirectories(repoRoot) {
  return ['node_modules', 'impl/node_modules'].filter((path) => existingDirectory(join(repoRoot, path)));
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

function defaultCredentialProjection(repoRoot) {
  const credentials = {};
  const codex = join(homedir(), '.codex', 'auth.json');
  const grok = join(homedir(), '.grok', 'auth.json');
  const claude = join(homedir(), '.claude', '.credentials.json');
  if (existingRegular(codex)) credentials.codex = [codex];
  if (existingRegular(grok)) credentials.grok = [grok];
  if (existingRegular(claude)) credentials.claude = [claude];
  const kimiRoot = join(homedir(), '.kimi-code');
  const kimiFiles = ['config.toml', 'device_id', 'credentials/kimi-code.json', 'oauth/kimi-code'];
  const credentialTrees = kimiFiles.every((path) => existingRegular(join(kimiRoot, path)))
    ? { 'kimi-code': [{ sourceRoot: kimiRoot, relativeFiles: kimiFiles }] } : {};
  return Object.freeze({ credentialFiles: credentials, credentialTrees, repoRoot });
}

function locallyReadyRoutes(repoRoot) {
  const codexReady = existingRegular(join(homedir(), '.codex', 'auth.json'));
  const grokReady = existingRegular(join(homedir(), '.grok', 'auth.json'));
  const claudeReady = existingRegular(join(homedir(), '.claude', '.credentials.json'));
  const kimiRoot = join(homedir(), '.kimi-code');
  const kimiReady = ['config.toml', 'device_id', 'credentials/kimi-code.json', 'oauth/kimi-code']
    .every((path) => existingRegular(join(kimiRoot, path)));
  const routes = DEFAULT_ROUTES.filter((route) => (
    route.harness === 'codex' ? codexReady
      : route.harness === 'grok' ? grokReady
        : route.harness === 'kimi-code' ? kimiReady
          : route.harness === 'claude-code' ? claudeReady : false
  ));
  if (existingRegular(join(homedir(), '.config', 'baton', 'credentials', 'kimi.json'))) {
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
      const credential = join(homedir(), '.config', 'baton', 'credentials', 'kimi.json');
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
    followPolicy: {
      mode: 'enabled', maxWaitMs: 30_000, maxChanges: 128,
      maxResponseBytes: 512 * 1024, maxScanEvents: 1024,
    },
    exportPolicy: {
      mode: 'manual', format: 'directory-v1',
      maxFiles: exportBounds.maxFiles, maxBytes: exportBounds.maxBytes,
      requireAdoptedResult: true, requireSemanticReview: false, requireIntegration: false,
    },
  });
}

class BatonDeployment {
  #application;
  #baton;
  #principal;
  #closePromise = null;

  constructor(application, principal) {
    this.#application = application;
    this.#principal = principal;
    this.#baton = bindBaton(application, principal);
    this.ready = application.ready;
    Object.freeze(this);
  }

  card() { return this.#application.card(); }
  run(objective, route = {}) { return this.#baton.runs.start(objective, route); }
  startMany(requests) { return this.#baton.runs.startMany(requests); }
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
  closed(advanced, ['adapters', 'deploymentRoot', 'routes', 'verification'], 'advanced');
  const routes = normalizeRoutes(advanced.routes ?? locallyReadyRoutes(repository.root));
  const publicRoutes = routes.map(publicRoute);
  if (new Set(publicRoutes.map((route) => JSON.stringify(route))).size !== publicRoutes.length) {
    throw deploymentError('advanced routes collapse to a duplicate public exact tuple');
  }
  const verification = normalizeVerification(advanced.verification, repository.root);
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
  const dependencies = dependencyDirectories(repository.root);
  const projection = defaultCredentialProjection(repository.root);
  const policy = goalPlanPolicy(repository.repoId);
  const driver = createDriver({
    repoRoot: repository.root,
    repoId: repository.repoId,
    deploymentBaseSha: snapshot.sha,
    logDir: stateRoot,
    adapters,
    workerDependencyDirs: dependencies,
    verifyDependencyDirs: dependencies,
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
    return new BatonDeployment(application, principal);
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
