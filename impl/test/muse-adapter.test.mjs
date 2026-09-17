// muse-adapter.test.mjs — Muse (`muse exec --json`) harness support. No live CLI is
// invoked: parsers are checked against REAL captured output lines (echo + meta
// providers, captured 2026-09-15), cards/argv against construction, and
// route/isolation facts against the deployment modules. Hermetic: temp dirs under
// os.tmpdir() only; no provider process and no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MuseCli, CLI_ADAPTERS, parseMuseEvent, renderPrompt,
} from '../src/cli-adapters.mjs';
import { assertIsAdapter } from '../src/adapter.mjs';
import * as deploymentModule from '../src/application-deployment.mjs';
import { RuntimeIsolation, runtimeIdentity } from '../src/runtime-isolation.mjs';
import { createDriver, openBaton } from '../src/index.mjs';

// Real captured shapes (verbatim payload_type/payload vocabulary).
const STARTED = { payload_type: 'run.lifecycle.started', payload: { kind: 'run_started' } };
const DELTA = {
  payload_type: 'run.output.delta',
  payload: { kind: 'run_output_delta', text: 'Hello,' },
};
const TOOL = {
  payload_type: 'tool.result',
  payload: {
    kind: 'tool_result', call_id: 'call_01', text: 'file contents',
    correlation_facts: { tool_name: 'read_file', outcome: 'success' },
  },
};
const TERMINAL = {
  payload_type: 'run.terminal.completed',
  payload: { kind: 'run_terminal', terminal: 'completed', text: 'Hello, done.', reason: null },
};
const TASK_NOISE = {
  payload_type: 'task.lifecycle.status',
  payload: { kind: 'task_lifecycle', event: { kind: 'status', message: 'opening stream' } },
};

test('parseMuseEvent maps the real stream: started->turn_started, tool.result->tool_call, terminal->completed with message', () => {
  const started = parseMuseEvent(STARTED, 'w1', 'muse', 1);
  assert.equal(started.event.kind, 'lifecycle.turn_started');
  assert.equal(started.event.worker, 'w1');

  const tool = parseMuseEvent(TOOL, 'w1', 'muse', 1, 7);
  assert.equal(tool.event.kind, 'content.tool_call');
  assert.deepEqual(tool.event.payload, {
    callId: 'call_01', phase: 'completed', name: 'read_file', output: 'file contents',
  });

  const terminal = parseMuseEvent(TERMINAL, 'w1', 'muse', 1);
  assert.equal(terminal.terminal, true);
  assert.equal(terminal.event.kind, 'lifecycle.turn_completed');
  assert.equal(terminal.event.payload.result.status, 'completed');
  assert.equal(terminal.event.payload.result.summary, 'Hello, done.');
  assert.equal(terminal.beforeTerminal.length, 1);
  assert.equal(terminal.beforeTerminal[0].kind, 'content.message');
  assert.equal(terminal.beforeTerminal[0].payload.text, 'Hello, done.');
  assert.deepEqual(terminal.event.payload.usageSeal, {
    tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null,
  });
});

test('parseMuseEvent ignores streaming deltas and task noise; malformed input is not surfaced', () => {
  assert.deepEqual(parseMuseEvent(DELTA, 'w1', 'muse', 1), {});
  assert.deepEqual(parseMuseEvent(TASK_NOISE, 'w1', 'muse', 1), {});
  assert.deepEqual(
    parseMuseEvent({ payload_type: 'session.workspace_branch.observed', payload: {} }, 'w1', 'muse', 1),
    {},
  );
  assert.deepEqual(parseMuseEvent(null, 'w1', 'muse', 1), {});
  assert.deepEqual(parseMuseEvent('nope', 'w1', 'muse', 1), {});
  assert.deepEqual(parseMuseEvent([], 'w1', 'muse', 1), {});
});

test('parseMuseEvent treats a non-completed terminal as a crash with the reason preserved', () => {
  const failed = parseMuseEvent(
    { payload_type: 'run.terminal.failed', payload: { kind: 'run_terminal', terminal: 'failed', reason: 'boom' } },
    'w1', 'muse', 2,
  );
  assert.equal(failed.crashed, true);
  assert.equal(failed.event.kind, 'lifecycle.crashed');
  assert.equal(failed.event.payload.error, 'boom');

  const bare = parseMuseEvent(
    { payload_type: 'run.terminal.cancelled', payload: { kind: 'run_terminal', terminal: 'cancelled' } },
    'w1', 'muse', 2,
  );
  assert.equal(bare.crashed, true);
  assert.match(bare.event.payload.error, /cancelled/);
});

test('parseMuseEvent falls back to stable call ids and an unknown tool name', () => {
  const fallback = parseMuseEvent(
    { payload_type: 'tool.result', payload: { kind: 'tool_result' } }, 'w9', 'muse', 3, 4,
  );
  assert.deepEqual(fallback.event.payload, {
    callId: 'muse:3:4', phase: 'completed', name: 'unknown', output: '',
  });
});

test('MuseCli conforms to the session Adapter interface and reports the muse identity', () => {
  assert.doesNotThrow(() => assertIsAdapter(new MuseCli({ version: '1.3.0' })));
  assert.equal(CLI_ADAPTERS.muse, MuseCli);
  const card = new MuseCli({ version: '1.3.0' }).card();
  assert.equal(card.harness, 'muse');
  assert.equal(card.version, '1.3.0');
  assert.equal(card.concurrencyCeiling, null);
  assert.deepEqual(card.verbs, {
    spawn: 'native', prompt: 'unsupported', steer: 'unsupported', interrupt: 'emulated',
    approve: 'unsupported', answer: 'unsupported', kill: 'native', pause: 'unsupported',
  });
  assert.deepEqual(card.governance.usage, {
    tokens: 'unavailable', usd: 'unavailable', tokenMetric: null, terminalSeal: 'native',
  });
  assert.deepEqual(card.modelSelection.family, 'muse');
  assert.deepEqual(card.modelSelection.acceptedPrefixes, ['muse-']);
  assert.ok(card.modelSelection.reasoningEffort.includes('low'));
  assert.ok(card.modelSelection.reasoningEffort.includes('max'));
  assert.deepEqual(card.permissions, {
    mode: 'never', sandbox: 'danger-full-access',
    boundary: 'Unattended full host permissions by default; containment is a separate deployment boundary',
  });
});

test('muse argv runs headless and unattended, binding the coordinator-selected model and effort', () => {
  const adapter = new MuseCli({ version: '1.3.0' });
  const argv = adapter._cfg.args(
    { goal: 'ship it', verification: { command: 'true', expectExit: 0 } },
    { model: 'muse-spark-1.3-contributor', reasoningEffort: 'xhigh' },
  );
  assert.equal(argv[0], 'exec');
  assert.ok(argv.includes('--json'));
  assert.ok(argv.includes('meta'));
  assert.deepEqual(argv.slice(argv.indexOf('--approval-mode'), argv.indexOf('--approval-mode') + 2), ['--approval-mode', 'never']);
  assert.ok(argv.includes('--disable-sandbox'));
  assert.ok(argv.includes('--trust-workspace'));
  assert.ok(argv.includes('--no-session-log'));
  assert.ok(argv.includes('--user-input-auto-resolve'));
  assert.deepEqual(argv.slice(argv.indexOf('--model'), argv.indexOf('--model') + 2), ['--model', 'muse-spark-1.3-contributor']);
  assert.deepEqual(argv.slice(argv.indexOf('--reasoning-effort'), argv.indexOf('--reasoning-effort') + 2), ['--reasoning-effort', 'xhigh']);
  const prompt = argv[argv.length - 1];
  assert.match(prompt, /\[baton brief:cli\]/);
  assert.match(prompt, /ship it/);
  assert.equal(renderPrompt({ goal: 'ship it', verification: { command: 'true', expectExit: 0 } }).split('\n')[0], '[baton brief:cli]');
});

test('muse spawn() with live:false refuses to launch a real CLI', async () => {
  const ack = await new MuseCli({ version: '1.3.0' }).spawn(
    'w1', { goal: 'x', verification: { command: 'true', expectExit: 0 } },
    { live: false, worktree: '/tmp' },
  );
  assert.equal(ack.ok, false);
  assert.match(ack.reason, /live:false/);
});

test('deployment serves five muse routes whose readiness names the file-backed login', () => {
  const routes = deploymentModule.DEFAULT_BATON_DEPLOYMENT_ROUTES.filter((route) => route.harness === 'muse');
  assert.equal(routes.length, 5);
  assert.ok(routes.every((route) => route.model === 'muse-spark-1.3-contributor'));
  assert.deepEqual(routes.map((route) => route.effort), ['low', 'medium', 'high', 'xhigh', 'max']);
  for (const route of routes) {
    assert.equal(
      deploymentModule.routeReadinessContract(route),
      'a file-backed muse login (`TBH_CREDENTIAL_BACKEND=file muse login`)',
    );
  }
  const card = new MuseCli({ version: '1.3.0', model: 'muse-spark-1.3-contributor' }).card();
  assert.equal(card.modelSelection.configuredDefault, 'muse-spark-1.3-contributor');
  for (const route of routes) {
    assert.ok(card.modelSelection.reasoningEffort.includes(route.effort));
    assert.ok(route.model.startsWith('muse-'));
  }
});

test('muse is its own runtime-isolation surface resolving XDG config, never Claude config', () => {
  assert.deepEqual(
    runtimeIdentity({ card: { harness: 'muse', modelSelection: { family: 'muse' } } }),
    { family: 'muse', surface: 'muse', authPosture: 'unknown', adapterCredentialState: null },
  );
  const root = mkdtempSync(join(tmpdir(), 'baton-muse-isolation-'));
  try {
    const isolation = new RuntimeIsolation({
      repoRoot: root, root: join(root, 'runtime'), baseEnv: {}, credentialFiles: {}, credentialTrees: {},
    });
    const scope = isolation.create('w1', { card: new MuseCli({ version: '1.3.0' }).card() });
    try {
      assert.equal(scope.env.XDG_CONFIG_HOME, join(scope.paths.root, 'config'));
      assert.equal(scope.env.TBH_CREDENTIAL_BACKEND, 'file');
      assert.equal(scope.env.CLAUDE_CONFIG_DIR, undefined);
      assert.equal(scope.env.HOME, scope.paths.home);
    } finally {
      isolation.remove('w1');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('muse workers pin the file credential backend, overridable by the caller', () => {
  assert.equal(new MuseCli({ version: '1.3.0' })._cfg.env.TBH_CREDENTIAL_BACKEND, 'file');
  assert.equal(
    new MuseCli({ version: '1.3.0', env: { TBH_CREDENTIAL_BACKEND: 'keychain' } })._cfg.env.TBH_CREDENTIAL_BACKEND,
    'keychain',
  );
});

// ---------- file-backend auth: the OS-independent muse CLI credential ----------

const MUSE_FILE_MODEL = 'muse-spark-1.3-contributor';
// A keychain-only login: real metadata shape, no token — what `muse login` writes on
// macOS by default. Never enough for a file-backend worker.
const MUSE_KEYCHAIN_STYLE_AUTH = () => JSON.stringify({
  schema_version: 2,
  providers: {
    meta: {
      mechanism: 'oauth', storage: 'keychain', obtained_via: 'device_code',
      api_base_url: 'https://api.meta.ai/v1',
      user_full_name: 'Fixture User', user_email: 'fixture@example.invalid',
    },
  },
});
// A file-backed login: the same shape carrying an inline OAuth token, as
// `TBH_CREDENTIAL_BACKEND=file muse login` provisions. The token below is bogus and is
// never sent anywhere: readiness resolves shape presence only, never validity.
const MUSE_FILE_BACKED_AUTH = () => JSON.stringify({
  schema_version: 2,
  providers: {
    meta: {
      mechanism: 'oauth', storage: 'file', obtained_via: 'device_code',
      api_base_url: 'https://api.meta.ai/v1',
      user_full_name: 'Fixture User', user_email: 'fixture@example.invalid',
      access_token: 'bogus-token-for-shape-probe', expires_at: 4102444800,
    },
  },
});

const fileDirs = [];
function fileTmp(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-muse-fileauth-${label}-`));
  fileDirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of fileDirs) rmSync(dir, { recursive: true, force: true }); });

function writeMuseAuth(home, contents) {
  const dir = join(home, 'muse');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'auth.json'), contents, { mode: 0o600 });
}

/** Scope HOME/XDG_CONFIG_HOME at a fixture home for one closure (sync or async). */
async function withMuseHome(home, fn) {
  const previousHome = process.env.HOME;
  const previousXdg = process.env.XDG_CONFIG_HOME;
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = home;
  try {
    return await fn();
  } finally {
    process.env.HOME = previousHome;
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
  }
}

test('file-backend gate: no auth file is blocked with the file-login remedy', async () => {
  const verdict = await withMuseHome(fileTmp('home-bare'), () => deploymentModule.museRouteReadiness());
  assert.equal(verdict.state, 'blocked');
  assert.equal(verdict.code, 'authentication_required');
  assert.match(verdict.summary, /TBH_CREDENTIAL_BACKEND=file muse login/);
});

test('file-backend gate: a malformed auth file is blocked as invalid metadata', async () => {
  const home = fileTmp('home-malformed');
  writeMuseAuth(home, 'not-json{');
  const verdict = await withMuseHome(home, () => deploymentModule.museRouteReadiness());
  assert.equal(verdict.state, 'blocked');
  assert.equal(verdict.code, 'authentication_metadata_invalid');
});

test('file-backend gate: keychain-only metadata without a token stays blocked', async () => {
  const home = fileTmp('home-keychain');
  writeMuseAuth(home, MUSE_KEYCHAIN_STYLE_AUTH());
  const verdict = await withMuseHome(home, () => deploymentModule.museRouteReadiness());
  assert.equal(verdict.state, 'blocked');
  assert.equal(verdict.code, 'authentication_required');
  assert.match(verdict.summary, /keychain-only/);
});

test('file-backend gate: a file-backed token reads ready (shape only, never validated)', async () => {
  const home = fileTmp('home-file');
  writeMuseAuth(home, MUSE_FILE_BACKED_AUTH());
  const verdict = await withMuseHome(home, () => deploymentModule.museRouteReadiness());
  assert.deepEqual(verdict, { state: 'ready' });
});

// The card a served muse route matches: satisfies every pre-existing readiness gate
// (exact route match, observed version, the #230 worker policy), so each row's verdict is
// decided by the file-backend derivation alone. Worker policy mirrors route-truth.test.mjs.
const MUSE_FILE_WORKER_POLICY = Object.freeze({
  schemaVersion: 1,
  autonomy: {
    supported: ['unattended'], default: 'unattended', perTask: false,
    observation: 'launch', mechanisms: ['permission-mode-yolo'],
  },
  access: {
    supported: ['full'], default: 'full', perTask: false,
    observation: 'launch', mechanisms: ['muse-unsandboxed-permissions'],
  },
  containment: {
    hostProcess: 'same_uid', guarantees: ['private_runtime'],
    configuredPreferences: ['worktree-cwd', 'profile-isolation'], observation: 'unavailable',
  },
});
const MUSE_FILE_CARD = Object.freeze({
  harness: 'muse',
  version: '1.0.0',
  authPosture: 'subscription',
  modelSelection: {
    mode: 'exact',
    configuredDefault: MUSE_FILE_MODEL,
    available: [MUSE_FILE_MODEL],
    family: 'muse', acceptedPrefixes: ['muse-'], acceptedAliases: [],
    reasoningEffort: ['low', 'medium', 'high', 'xhigh', 'max'],
    provenance: 'muse-adapter-test', refreshedAt: null,
  },
  workerPolicy: MUSE_FILE_WORKER_POLICY,
  permissions: { mode: 'never', sandbox: 'danger-full-access', boundary: 'muse-adapter-test fixture' },
});
const CLAUDE_FILE_CARD = Object.freeze({
  harness: 'claude-code',
  version: '2.0.0',
  authPosture: 'subscription',
  modelSelection: {
    mode: 'exact',
    configuredDefault: 'claude-opus-4-6',
    available: ['claude-opus-4-6'],
    family: 'claude', acceptedPrefixes: ['claude-'], acceptedAliases: [],
    reasoningEffort: ['low', 'medium', 'high', 'xhigh', 'max'],
    provenance: 'muse-adapter-test', refreshedAt: null,
  },
  workerPolicy: MUSE_FILE_WORKER_POLICY,
  permissions: { mode: 'bypassPermissions', sandbox: 'unverified', boundary: 'muse-adapter-test fixture' },
});
class MuseFileRouteCard {
  constructor(card) { this._card = card; this._onEvent = null; }
  card() { return this._card; }
  onEvent(callback) { this._onEvent = callback; }
  emit(event) { this._onEvent?.(event); }
  async spawn() { return { ok: true }; }
  async prompt() { return { ok: true }; }
  async approve() { return { ok: true }; }
  async answer() { return { ok: true }; }
  async interrupt() { return { ok: true }; }
  async kill() { return { ok: true }; }
}

function fileRepo() {
  const root = fileTmp('repo');
  const repo = join(root, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'muse-fileauth@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Muse fileauth'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# Muse fileauth fixture\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  return { root, repo };
}

/** Open the deployment over a fixture HOME holding the given muse auth file (or none).
 * Routes stay default so the real admission path runs; adapters are fixture cards (no muse
 * binary needed, no network, no quota). The claude card covers the always-admitted
 * claude-code rows; only the muse rows carry verdicts under test. */
async function fileDoctorOver({ repo, home, authContents = null, label }) {
  if (authContents !== null) writeMuseAuth(home, authContents);
  return withMuseHome(home, async () => {
    let deployment = null;
    try {
      deployment = await openBaton({
        repo,
        advanced: {
          deploymentRoot: join(fileTmp(`deployment-${label}`), 'deployment'),
          adapters: {
            muse: new MuseFileRouteCard(MUSE_FILE_CARD),
            'claude-code:claude': new MuseFileRouteCard(CLAUDE_FILE_CARD),
          },
          verification: { command: process.execPath, arguments: ['--version'] },
          capacity: {
            estimate: () => ({ bytes: 1, inodes: 1 }),
            observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
          },
        },
      });
      return await deployment.doctor();
    } finally {
      try { await deployment?.close(); } catch { /* the fixture tree is removed below */ }
    }
  });
}

const fileMuseRows = (doctor) => doctor.routes.filter((route) => route.harness === 'muse');

test('file-backend doctor: a file-backed login serves every muse route ready', async () => {
  const fixture = fileRepo();
  const doctor = await fileDoctorOver({
    repo: fixture.repo, home: fileTmp('home-file'), authContents: MUSE_FILE_BACKED_AUTH(), label: 'file-ready',
  });
  const rows = fileMuseRows(doctor);
  assert.equal(rows.length, 5, 'every served muse effort is admitted on a file-backed login');
  for (const row of rows) {
    assert.equal(row.state, 'ready', `muse ${row.model}@${row.effort} must be ready: ${row.code} ${row.summary}`);
  }
  assert.equal(doctor.ready, true);
});

test('file-backend doctor: a keychain-only login serves muse rows blocked with the remedy', async () => {
  const fixture = fileRepo();
  const doctor = await fileDoctorOver({
    repo: fixture.repo, home: fileTmp('home-keychain'), authContents: MUSE_KEYCHAIN_STYLE_AUTH(), label: 'keychain-blocked',
  });
  const rows = fileMuseRows(doctor);
  assert.equal(rows.length, 5, 'the family is admitted on file presence; readiness decides per row');
  for (const row of rows) {
    assert.equal(row.state, 'blocked');
    assert.equal(row.code, 'authentication_required');
    assert.match(row.summary, /TBH_CREDENTIAL_BACKEND=file muse login/);
  }
});

// ── #323: a served deployment's built-in muse adapter must be LIVE ──────────────────────────
// Every other built-in route is a native RPC/ACP adapter; MuseCli is the only served route on
// the CliAdapter base, whose `live` defaults to false so unit tests never spawn a real CLI.
// A served deployment IS the real run: builtInAdapters must construct it live, or every muse
// run crashes at spawn with "live:false — refusing to launch a real CLI". The fake `muse` here
// answers the two probes the deployment makes (`exec --help`, `--version`) and completes one
// exec with a terminal MSP record — no real binary, no network, no quota.
function fakeMuseBin() {
  const bin = fileTmp('fake-muse-bin');
  const script = [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "Muse Code 1.3.0 (fake)"; exit 0; fi',
    'if [ "$1" = "exec" ] && [ "$2" = "--help" ]; then echo "muse exec (fake)"; exit 0; fi',
    `printf '%s\\n' '{"schema_version":1,"payload_type":"run.terminal.completed","payload":{"kind":"run_terminal","terminal":"completed","text":"pong","reason":null}}'`,
    'exit 0',
    '',
  ].join('\n');
  writeFileSync(join(bin, 'muse'), script, { mode: 0o755 });
  return bin;
}

test('#323: a served deployment constructs its built-in muse adapter live — spawn never refuses for live:false', async () => {
  const fixture = fileRepo();
  const home = fileTmp('home-live');
  writeMuseAuth(home, MUSE_FILE_BACKED_AUTH());
  const bin = fakeMuseBin();
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;
  let captured = null;
  const spyDriver = (opts) => { captured = opts.adapters; return createDriver(opts); };
  const museRoutes = deploymentModule.DEFAULT_BATON_DEPLOYMENT_ROUTES.filter((route) => route.harness === 'muse');
  let deployment = null;
  try {
    deployment = await withMuseHome(home, () => deploymentModule.openBatonDeployment({
      repo: fixture.repo,
      advanced: {
        deploymentRoot: join(fileTmp('deployment-live'), 'deployment'),
        routes: museRoutes,
        verification: { command: process.execPath, arguments: ['--version'] },
        capacity: {
          estimate: () => ({ bytes: 1, inodes: 1 }),
          observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
        },
      },
    }, spyDriver));
    const adapter = captured?.['muse:muse'];
    assert.ok(adapter instanceof MuseCli, 'the deployment built its muse adapter through builtInAdapters');
    assert.equal(adapter._live, true, 'a served deployment is the real run: its muse adapter must be live');
    const ack = await adapter.spawn('w-live', { goal: 'x', verification: { command: 'true', expectExit: 0 } }, { worktree: fixture.repo });
    assert.doesNotMatch(String(ack.reason ?? ''), /live:false/, `spawn refused the served adapter: ${ack.reason}`);
  } finally {
    process.env.PATH = previousPath;
    try { await deployment?.close(); } catch { /* fixture tree removed by fileTmp */ }
  }
});
