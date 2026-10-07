#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

import {
  BatonApplication, CodexAppServerCli, GlmSessionCli, GrokAcpCli, KimiAcpCli, KimiSessionCli,
  SignalLifecycleOwner, bindBaton, createDriver,
} from '../../../../impl/src/index.mjs';

const rawArgs = process.argv.slice(2);
const take = (name) => {
  const index = rawArgs.indexOf(name);
  if (index === -1) return null;
  const value = rawArgs[index + 1];
  if (!value || value.startsWith('--')) throw new Error('usage: run.mjs OBJECTIVE --model MODEL --effort EFFORT [--harness HARNESS]');
  rawArgs.splice(index, 2);
  return value;
};
const requestedModel = take('--model');
const requestedHarness = take('--harness');
const requestedEffort = take('--effort');
if (rawArgs.length !== 1 || rawArgs[0].startsWith('--')) {
  throw new Error('usage: run.mjs OBJECTIVE --model MODEL --effort EFFORT [--harness HARNESS]');
}
const TASK_OBJECTIVE = rawArgs[0];

function inside(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function sourceState(root, relativeFiles) {
  const files = relativeFiles.map((relativePath) => {
    const absolutePath = resolve(root, relativePath);
    if (!inside(root, absolutePath)) throw new Error('PENDING-LIVE-kimi-code-source-state-path-invalid');
    const stat = lstatSync(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('PENDING-LIVE-kimi-code-source-state-file-invalid');
    return {
      path: relativePath,
      sha256: createHash('sha256').update(readFileSync(absolutePath)).digest('hex'),
      bytes: stat.size,
      mode: stat.mode & 0o777,
      uid: stat.uid,
      gid: stat.gid,
    };
  });
  return {
    digest: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
    files: files.map(({ path, bytes, mode, uid, gid }) => ({ path, bytes, mode, uid, gid })),
  };
}

function inferHarness(model) {
  if (model.startsWith('glm-')) return 'glm';
  if (model.startsWith('grok-')) return 'grok';
  if (model === 'kimi-k3[1m]') return 'claude-code';
  if (model.startsWith('kimi-code/')) return 'kimi-code';
  if (/^(?:gpt-|codex-|o[134])/u.test(model)) return 'codex';
  throw new Error('PENDING-LIVE-dogfood-model-family-ambiguous');
}

function discoverCodexCommand() {
  let candidates = [];
  try {
    candidates = execFileSync('which', ['-a', 'codex'], { encoding: 'utf8' })
      .split('\n').map((value) => value.trim()).filter(Boolean);
  } catch { /* typed refusal below */ }
  const observed = candidates.flatMap((command) => {
    try {
      const version = execFileSync(command, ['--version'], { encoding: 'utf8' });
      const match = /(\d+)\.(\d+)\.(\d+)/u.exec(version);
      return match ? [{ command, version: match.slice(1).map(Number) }] : [];
    } catch { return []; }
  }).sort((left, right) => {
    for (let index = 0; index < 3; index += 1) {
      if (left.version[index] !== right.version[index]) return right.version[index] - left.version[index];
    }
    return left.command < right.command ? -1 : left.command > right.command ? 1 : 0;
  });
  if (observed.length === 0) throw new Error('PENDING-LIVE-codex-executable-unavailable');
  return realpathSync(observed[0].command);
}

function trackedTreePolicy(repo) {
  const rows = execFileSync('git', ['ls-tree', '-r', '-l', '-z', 'HEAD'], { cwd: repo })
    .toString('utf8').split('\0').filter(Boolean);
  let bytes = 0;
  for (const row of rows) {
    const match = /^\d+ blob [a-f0-9]+\s+(\d+)\t/u.exec(row);
    if (!match) throw new Error('PENDING-LIVE-dogfood-tree-inventory-invalid');
    bytes += Number(match[1]);
  }
  return {
    maxFiles: Math.max(128, Math.ceil(rows.length * 1.25) + 32),
    maxBytes: Math.max(64 * 1024 * 1024, Math.ceil(bytes * 1.5) + (64 * 1024 * 1024)),
  };
}

const SOURCE_REPO = realpathSync(resolve(import.meta.dirname, '../../../..'));
const TARGET_REPO = SOURCE_REPO;
const ownerPath = resolve(join(tmpdir(), 'baton-recursive-dogfood'));
mkdirSync(ownerPath, { recursive: true, mode: 0o700 });
const OWNER_ROOT = realpathSync(ownerPath);
const OUTPUT = mkdtempSync(resolve(OWNER_ROOT, 'evidence-'));
const GLM_AUTH = resolve(SOURCE_REPO, 'glm_key.json');
const KIMI_AUTH = resolve(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'baton', 'credentials', 'kimi.json');
const KIMI_CODE_HOME = resolve(join(homedir(), '.kimi-code'));
const KIMI_CODE_FILES = Object.freeze(['config.toml', 'device_id', 'credentials/kimi-code.json', 'oauth/kimi-code']);
// This legacy evidence runner retains the old Goal/Plan schema internally, but its circuit breaker
// is deployment-owned. Ordinary callers select objective plus exact harness/model/effort only.
const TOKEN_BUDGET = 10_000_000;
const USD_BUDGET = 100;
const WALL_MINUTES = 30;
const PROVIDER_TURNS = 64;
const treePolicy = trackedTreePolicy(TARGET_REPO);
const EXPORT_MAX_FILES = treePolicy.maxFiles;
const EXPORT_MAX_BYTES = treePolicy.maxBytes;
const MODEL = requestedModel;
const EFFORT = requestedEffort;
if (!MODEL || !EFFORT) throw new Error('usage: run.mjs OBJECTIVE --model MODEL --effort EFFORT [--harness HARNESS]');
const HARNESS = requestedHarness ?? inferHarness(MODEL);
const CODEX_CMD = HARNESS === 'codex' ? discoverCodexCommand() : null;
const KIMI_CODE_CMD = HARNESS === 'kimi-code'
  ? realpathSync(resolve(join(KIMI_CODE_HOME, 'bin', 'kimi')))
  : null;
const REPO_ID = 'baton-recursive-dogfood';
const RUN_ID = `recursive-${createHash('sha256').update(JSON.stringify({ TASK_OBJECTIVE, MODEL, EFFORT }))
  .digest('hex').slice(0, 32)}`;
const LOG_DIR = mkdtempSync(resolve(OWNER_ROOT, 'log-'));
const EXPORT_ROOT = mkdtempSync(resolve(OWNER_ROOT, 'exports-'));
const terminalWithoutAdoption = new Set(['completed', 'failed', 'cancelled', 'denied', 'stopped']);
const APPLICATION_ACCEPTANCE_TESTS = Object.freeze([
  'impl/test/phase64-application-cli.test.mjs',
  'impl/test/phase64-integrated-run-application.test.mjs',
  'impl/test/phase64-result-finalization-store.test.mjs',
  'impl/test/phase65-run-semantic-review-integration.test.mjs',
  'impl/test/phase66-export-lifecycle-red.test.mjs',
  'impl/test/phase66-materialized-result-export.test.mjs',
  'impl/test/phase66-plan-authorized-recovery.test.mjs',
  'impl/test/phase66-result-export-adversarial.test.mjs',
  'impl/test/phase66-result-export-projection-reds.test.mjs',
  'impl/test/phase66-result-export-store.test.mjs',
  'impl/test/phase66-retained-export-delivery-red.test.mjs',
  'impl/test/phase66-run-continuation-export.test.mjs',
  'impl/test/phase66-run-recovery-application.test.mjs',
  'impl/test/phase67-change-aware-inspect.test.mjs',
  'impl/test/phase67-progressive-agent-experience.test.mjs',
  'impl/test/phase67-route-attestation.test.mjs',
  'impl/test/phase67-run-terminality.test.mjs',
  'impl/test/phase67-self-describing-continuation.test.mjs',
  'impl/test/phase67-signal-reap.test.mjs',
  'impl/test/phase67-terminal-cause.test.mjs',
  'impl/test/phase68-unified-agent-entrypoint.test.mjs',
  'impl/test/acp-json-rpc-process.test.mjs',
  'impl/test/credential-projection.test.mjs',
  'impl/test/kimi-acp.test.mjs',
  'impl/test/phase72-native-kimi-integration.test.mjs',
  'impl/test/phase71-kimi-session.test.mjs',
  'impl/test/phase73-required-effects.test.mjs',
  'impl/test/runtime-isolation.test.mjs',
  'impl/test/phase14-route-tuple.test.mjs',
]);

if (!['glm', 'grok', 'codex', 'claude-code', 'kimi-code'].includes(HARNESS)) throw new Error('PENDING-LIVE-dogfood-harness-unsupported');
if (HARNESS === 'glm' && !existsSync(GLM_AUTH)) throw new Error('PENDING-LIVE-project-glm-key-absent');
if (HARNESS === 'claude-code' && MODEL === 'kimi-k3[1m]' && !existsSync(KIMI_AUTH)) throw new Error('PENDING-LIVE-baton-kimi-key-absent');
if (HARNESS === 'claude-code' && MODEL === 'kimi-k3[1m]' && inside(TARGET_REPO, KIMI_AUTH)) throw new Error('PENDING-LIVE-baton-kimi-key-must-be-outside-repository');
if (HARNESS === 'kimi-code' && KIMI_CODE_FILES.some((file) => !existsSync(join(KIMI_CODE_HOME, file)))) throw new Error('PENDING-LIVE-kimi-code-subscription-state-absent');
if (HARNESS === 'kimi-code' && inside(TARGET_REPO, KIMI_CODE_HOME)) throw new Error('PENDING-LIVE-kimi-code-state-must-be-outside-repository');
if (execFileSync('git', ['status', '--porcelain'], { cwd: TARGET_REPO, encoding: 'utf8' }).trim()) {
  throw new Error('PENDING-LIVE-dogfood-target-must-be-clean');
}
const KIMI_CODE_SOURCE_BEFORE = HARNESS === 'kimi-code' ? sourceState(KIMI_CODE_HOME, KIMI_CODE_FILES) : null;

const route = { harness: HARNESS, model: MODEL, effort: EFFORT };
const budget = { tokens: TOKEN_BUDGET, usd: USD_BUDGET, wallMin: WALL_MINUTES, providerTurns: PROVIDER_TURNS };
const policy = Object.freeze({
  schemaVersion: 1, repoId: REPO_ID, mandatory: true, approvalTtlMs: WALL_MINUTES * 60 * 1_000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'], capabilityClasses: ['code', 'test'],
  limits: {
    maxGoalVersions: 8, maxPlanVersions: 8, maxNodes: 8, maxDepsPerNode: 8,
    maxTextBytes: 8_192, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 128 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 512 * 1_024,
    maxTokens: TOKEN_BUDGET, maxUsd: USD_BUDGET, maxWallMin: WALL_MINUTES, maxProviderTurns: PROVIDER_TURNS,
  },
});
const profile = Object.freeze({
  schemaVersion: 1, repoId: REPO_ID,
  definitionOfDone: [
    'The requested Baton improvement is implemented through the unified agent-oriented application surface.',
    'The pinned Phase 64-68 application acceptance suite passes without weakening lifecycle, authorization, or evidence guarantees.',
    'The ordinary invocation remains objective-first and does not require agent-managed budgets, state roots, or export ceilings.',
  ],
  constraints: [
    'Do not add homelab integration.',
    'Use rtk for every shell command and keep every read or search narrowly bounded; never emit a broad repository dump.',
    'Preserve exact harness, model, and effort attestation; manual routing always selects model and effort together.',
    'Keep budgets, filesystem roots, export ceilings, and provider-turn ceilings in deployment policy rather than Run arguments.',
    'Prefer the shared semantic registry and bound Baton Run methods over raw command envelopes or caller-side lifecycle choreography.',
    'Add deterministic tests for every changed contract and preserve compatibility only behind the same semantic authority.',
  ],
  risk: 'high', goalBudget: budget, nodeBudget: budget,
  pathScope: [
    'impl/**',
    'spec/**',
    'docs/reference/evidence/phase67-progressive-application-dogfood-2026-07-14/**',
  ],
  verification: {
    command: 'node', arguments: ['impl/scripts/run-suite.mjs', ...APPLICATION_ACCEPTANCE_TESTS],
    cwd: '.', envAllowlist: ['PATH'], expectExit: 0, expectResult: 'exit_code',
    timeoutMs: WALL_MINUTES * 60 * 1_000, maxOutputBytes: 256 * 1_024, requiredPredecessorEvidence: [],
  },
  routes: [route], capabilities: ['code', 'test'], effects: ['repository_edit', 'provider_call'], requiredEffects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
  followPolicy: {
    mode: 'enabled', maxWaitMs: 30_000, maxChanges: 64,
    maxResponseBytes: 256 * 1_024, maxScanEvents: 256,
  },
  exportPolicy: {
    mode: 'manual', format: 'directory-v1', maxFiles: EXPORT_MAX_FILES, maxBytes: EXPORT_MAX_BYTES,
    requireAdoptedResult: true, requireSemanticReview: false, requireIntegration: false,
  },
});
const principal = (id) => ({ actor: `dogfood:${id}`, principalId: id, sessionId: `${id}-session` });
const credentialFiles = {
  ...(existsSync(join(homedir(), '.codex', 'auth.json')) ? { codex: [join(homedir(), '.codex', 'auth.json')] } : {}),
  ...(existsSync(join(homedir(), '.grok', 'auth.json')) ? { grok: [join(homedir(), '.grok', 'auth.json')] } : {}),
};
const credentialTrees = HARNESS === 'kimi-code' ? {
  'kimi-code': [{ sourceRoot: KIMI_CODE_HOME, relativeFiles: KIMI_CODE_FILES }],
} : {};
const adapter = HARNESS === 'glm' ? new GlmSessionCli({
  authTokenFile: GLM_AUTH,
  authTokenJsonPointer: '/glm_key',
  model: route.model, approvals: false,
  args: ['--safe-mode', '--no-session-persistence', '--max-budget-usd', USD_BUDGET.toFixed(2)], ceiling: 1,
}) : HARNESS === 'grok' ? new GrokAcpCli({ requestTimeoutMs: 45_000, ceiling: 1 })
  : HARNESS === 'kimi-code' ? new KimiAcpCli({
    cmd: KIMI_CODE_CMD, requestTimeoutMs: 45_000, ceiling: 1,
    model: route.model, modelCatalog: { 'kimi-code/k3': ['low', 'high', 'max'] },
  })
  : HARNESS === 'claude-code' ? new KimiSessionCli({
    authTokenFile: KIMI_AUTH, repoRoot: TARGET_REPO,
    model: route.model, approvals: false, ceiling: 1,
  })
  : new CodexAppServerCli({
    cmd: CODEX_CMD, requestTimeoutMs: 45_000, model: route.model, ceiling: 1,
  });
const driver = createDriver({
  repoRoot: TARGET_REPO, repoId: REPO_ID, logDir: LOG_DIR,
  workerDependencyDirs: ['impl/node_modules'],
  verifyDependencyDirs: ['impl/node_modules'],
  adapters: { [`${HARNESS}:dogfood`]: adapter },
  runtimeIsolation: { credentialFiles, credentialTrees },
  goalPlanAuthority: { policy, authorize: async () => true },
  approvalTimeoutMs: Math.min(60_000, WALL_MINUTES * 60 * 1_000),
  stopDeadlineMs: 15_000,
  drainPolicy: { maxWorkers: 1, timeoutMs: 90_000, pollMs: 10 },
  budgetPolicy: { terminalGraceMs: 2_000 }, watchdog: { stallMs: WALL_MINUTES * 60 * 1_000 },
});
const application = new BatonApplication({
  driver, repoId: REPO_ID, profiles: { progressive: profile }, exportRoot: EXPORT_ROOT,
  principals: {
    planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer'),
  },
  authorize: async () => true,
});
const baton = bindBaton(application, principal('owner'));

const ordinaryCalls = [];
let lastOutline = null;
let kimiCodeSourceState = KIMI_CODE_SOURCE_BEFORE ? {
  checked: true, unchanged: null, beforeDigest: KIMI_CODE_SOURCE_BEFORE.digest,
  afterDigest: null, files: KIMI_CODE_SOURCE_BEFORE.files,
} : { checked: false, unchanged: null, beforeDigest: null, afterDigest: null, files: [] };
const interrupted = () => Object.assign(new Error('dogfood_interrupted'), { code: 'dogfood_interrupted' });
const assertActive = (signal) => { if (signal.aborted) throw interrupted(); };
let lastProgress = null;
const semanticToken = (value) => typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/u.test(value)
  ? value : 'unknown';
const emitProgress = (view) => {
  const phase = semanticToken(view?.outline?.phase);
  const stages = Array.isArray(view?.outline?.progress?.stages) ? view.outline.progress.stages : [];
  const stage = stages.find((candidate) => ['active', 'blocked', 'failed', 'stopped'].includes(candidate?.state))
    ?? stages.findLast?.((candidate) => candidate?.state === 'complete') ?? null;
  const progress = stage ? `${semanticToken(stage.key)}:${semanticToken(stage.state)}` : 'none';
  const transition = `${phase}/${progress}`;
  if (transition !== lastProgress) {
    process.stderr.write(`[baton] phase=${phase} progress=${progress}\n`);
    lastProgress = transition;
  }
};
const signalOwner = new SignalLifecycleOwner({
  signalEmitter: process,
  shutdown: () => application.shutdown(principal('shutdown')),
});

async function dogfood({ signal }) {
  let final = null;
  let exported = null;
  assertActive(signal);
  ordinaryCalls.push('run.start');
  const run = await baton.runs.start(
    TASK_OBJECTIVE,
    { runId: RUN_ID, model: MODEL, effort: EFFORT },
  );
  assertActive(signal);
  ordinaryCalls.push('run.changes:outline');
  let outline = null;
  let approve = null;
  for await (const changed of run.changes({ signal })) {
    outline = changed;
    lastOutline = changed;
    emitProgress(changed);
    approve = changed.outline.actions.find((action) => action.kind === 'approve_plan');
    if (approve) break;
  }
  if (!approve) throw new Error('progressive-approve-action-absent');
  ordinaryCalls.push('run.act:approve_plan');
  outline = await run.approve();
  lastOutline = outline;
  emitProgress(outline);

  let adopt = null;
  ordinaryCalls.push('run.changes:outline:result');
  for (;;) {
    let attention = null;
    for await (const changed of run.changes({ signal })) {
      outline = changed;
      lastOutline = changed;
      emitProgress(changed);
      adopt = outline.outline.actions.find((action) => action.kind === 'adopt_result');
      attention = outline.outline.actions.find((action) => ['answer_approval', 'answer_question'].includes(action.kind));
      if (adopt || attention || terminalWithoutAdoption.has(outline.outline.phase)) break;
    }
    if (attention?.kind === 'answer_approval') {
      // This deployment deliberately gives the contained worker full tool permission. If a
      // provider still requests approval, answer it through the same advertised Run action.
      ordinaryCalls.push('run.act:answer_approval');
      outline = await run.act(attention.actionId, { decision: 'allow' });
      lastOutline = outline;
      emitProgress(outline);
      continue;
    }
    if (attention?.kind === 'answer_question') {
      throw Object.assign(new Error('progressive-question-attention-required'), {
        code: 'progressive_question_attention_required',
      });
    }
    break;
  }
  if (outline?.outline?.phase !== 'work_completed') throw new Error(`progressive-worker-${outline?.outline?.phase ?? 'unobserved'}`);
  if (!adopt) throw new Error('progressive-adopt-action-absent');
  ordinaryCalls.push('run.act:adopt_result');
  assertActive(signal);
  outline = await run.adopt('Adopt the verified recursive implementation.');
  lastOutline = outline;
  emitProgress(outline);

  const exportAction = outline.outline.actions.find((action) => action.kind === 'export_result');
  if (!exportAction) throw new Error('progressive-export-action-absent');
  ordinaryCalls.push('run.act:export_result');
  assertActive(signal);
  outline = await run.export();
  lastOutline = outline;
  emitProgress(outline);
  ordinaryCalls.push('run.inspect:result');
  const resultSection = await run.inspect({ depth: 'section', section: 'result' });
  ordinaryCalls.push('run.inspect:delivery');
  const deliverySection = await run.inspect({ depth: 'section', section: 'delivery' });
  final = resultSection.section.items[0]?.value ?? null;
  exported = deliverySection.section.items[0]?.value ?? null;
  if (final?.state !== 'adopted' || exported?.state !== 'completed') {
    throw new Error('progressive-result-cascade-incomplete');
  }
  return { phase: outline.outline.phase, final, exported };
}

try {
  const lifecycle = await signalOwner.run(dogfood);
  if (KIMI_CODE_SOURCE_BEFORE) {
    const after = sourceState(KIMI_CODE_HOME, KIMI_CODE_FILES);
    kimiCodeSourceState = {
      checked: true, unchanged: after.digest === KIMI_CODE_SOURCE_BEFORE.digest,
      beforeDigest: KIMI_CODE_SOURCE_BEFORE.digest, afterDigest: after.digest,
      files: after.files,
    };
    if (!kimiCodeSourceState.unchanged) {
      throw Object.assign(new Error('native Kimi source state changed during live Run'), {
        code: 'PENDING-LIVE-kimi-code-global-state-mutated',
      });
    }
  }
  mkdirSync(OUTPUT, { recursive: true });
  const signalExit = lifecycle.trigger.kind === 'SIGINT' ? 130
    : lifecycle.trigger.kind === 'SIGTERM' ? 143
      : lifecycle.trigger.kind === 'SIGHUP' ? 129 : 0;
  const result = lifecycle.operation.status === 'fulfilled' ? lifecycle.operation.value : null;
  const summary = {
    schemaVersion: 1, runId: RUN_ID, route,
    state: signalExit === 0 ? 'completed' : 'interrupted',
    phase: result?.phase ?? null,
    registryDigest: application.card().agentExperience.registryDigest,
    ordinaryCalls, compatibilityCalls: [], compatibilityFriction: null,
    result: result?.final ?? null,
    export: result?.exported ?? null,
    exportedTree: result?.exported ? resolve(EXPORT_ROOT, result.exported.exportId) : null,
    kimiCodeSourceState,
    lifecycle,
  };
  writeFileSync(resolve(OUTPUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (signalExit !== 0) process.exitCode = signalExit;
} catch (error) {
  mkdirSync(OUTPUT, { recursive: true });
  const failure = {
    schemaVersion: 1, runId: RUN_ID, route, state: 'failed',
    phase: lastOutline?.outline?.phase ?? null,
    terminalCause: {
      code: error?.code ?? error?.message ?? 'unknown',
      trigger: error?.closed ? 'operation_failed' : null,
    },
    outline: lastOutline?.outline ?? null,
    ordinaryCalls, compatibilityCalls: [],
    kimiCodeSourceState,
    closed: error?.closed ?? null,
  };
  writeFileSync(resolve(OUTPUT, 'summary.json'), `${JSON.stringify(failure, null, 2)}\n`, { mode: 0o600 });
  process.stderr.write(`phase67 progressive dogfood failed: ${error?.code ?? error?.message ?? 'unknown'}\n`);
  process.exitCode = 1;
}
