// #234 red pin — deployment-doctor readiness honesty at the routeStates seam.
//
// Measured 2026-08-15 (issue #230 background): the doctor showed all four omp routes
// state:'ready' while (a) every dispatch refused worker_policy_invalid (the omp card
// advertised no workerPolicy) and (b) after that fix, members spawned auth-less (runtime
// isolation projected no ~/.omp credential tree). routeCardMatches checked
// harness/model/effort only — so 'ready' claimed dispatchability and authentication the
// deployment did not have.
//
// RED   = a route whose matched card lacks a resolvable worker policy, or whose family has
//         no resolvable credential projection, still reads state:'ready'.
// GREEN = the first reads blocked/route_policy_unsupported, the second
//         blocked/route_credentials_unprojected, and a fully-satisfied route still reads
//         ready (the over-block guard).
//
// The readiness gates must resolve exactly the STATIC facts the dispatch path resolves —
// coordinator selection's resolveWorkerPolicy(DEFAULT_WORKER_POLICY_REQUEST, card.workerPolicy)
// and RuntimeIsolation's adapterManaged credential rule (env/files/trees non-empty for the
// adapter's family, or providerCompatibility.credentialState === 'available'). Never a
// network probe, never a projection copy.
//
// Fixture shape: deployment-omp-dispatch-red.test.mjs (real openBaton over a temp git repo)
// with the readiness-credentials-red ProbeAdapter card discipline (a fake adapter whose
// card satisfies the exact-route gates). Hermetic: every root is mkdtempSync'd under
// os.tmpdir(); the credential projection is scoped by pointing HOME at a temp directory
// (os.homedir() honors $HOME on POSIX) — the operator's real home is never read or mutated,
// and no provider process is ever spawned.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBaton } from '../src/index.mjs';

const ROUTE = Object.freeze({ harness: 'omp', model: 'deepseek/deepseek-v4-flash', effort: 'high' });

// The omp card's post-#230 worker-policy advertisement (omp-rpc.mjs card() shape) — the very
// tuple the deployment's DEFAULT_WORKER_POLICY_REQUEST resolves against at dispatch.
const WORKER_POLICY = Object.freeze({
  schemaVersion: 1,
  autonomy: {
    supported: ['unattended'], default: 'unattended', perTask: false,
    observation: 'launch', mechanisms: ['permission-mode-yolo'],
  },
  access: {
    supported: ['full'], default: 'full', perTask: false,
    observation: 'launch', mechanisms: ['omp-unsandboxed-permissions'],
  },
  containment: {
    hostProcess: 'same_uid', guarantees: ['private_runtime'],
    configuredPreferences: ['worktree-cwd', 'profile-isolation'], observation: 'unavailable',
  },
});

// An interactive-only card — schema-valid, but it cannot satisfy the deployment's
// unattended/full request, so resolveWorkerPolicy throws autonomy_unavailable.
const INTERACTIVE_ONLY_POLICY = Object.freeze({
  ...WORKER_POLICY,
  autonomy: {
    supported: ['interactive'], default: 'interactive', perTask: false,
    observation: 'launch', mechanisms: ['permission-mode-default'],
  },
});

const dirs = [];
function tmpDir(label = 'tmp') {
  const dir = mkdtempSync(join(tmpdir(), `baton-rh234-${label}-`));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

// ── The card-only fixture adapter ───────────────────────────────────────────────────────────
// No runs are started — the doctor row is the observable — but the full verb surface keeps the
// driver wiring identical to a real deployment (the readiness-credentials-red ProbeAdapter law).
class CardAdapter {
  constructor(card) {
    this._card = card;
    this._onEvent = null;
  }

  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  emit(event) { this._onEvent?.(event); }
  async spawn() { return { ok: true }; }
  async prompt() { return { ok: true }; }
  async approve() { return { ok: true }; }
  async answer() { return { ok: true }; }
  async interrupt() { return { ok: true }; }
  async kill() { return { ok: true }; }
}

// An omp-family card that passes every PRE-EXISTING readiness gate: exact route match,
// observed version, and (optionally) an adapter-managed credential. `workerPolicy: null`
// omits the field entirely — the #230 incident shape.
function ompCard({ workerPolicy = WORKER_POLICY, credentialState = null } = {}) {
  return {
    harness: 'omp',
    version: '1.0.0',
    authPosture: 'api-key',
    concurrencyCeiling: 4,
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model],
      family: 'omp', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: ['low', 'medium', 'high'], effortRequired: true,
      effortObservation: 'unavailable',
      provenance: 'readiness-honesty-234-red', refreshedAt: null,
    },
    ...(workerPolicy ? { workerPolicy } : {}),
    ...(credentialState ? { providerCompatibility: { credentialState } } : {}),
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
  };
}

// ── The deployment fixture (deployment-omp-dispatch-red shape) ──────────────────────────────
function repository() {
  const root = tmpDir('repo');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'rh234@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'RH234 fixture'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }));
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

// A fake HOME: os.homedir() honors $HOME on POSIX, so defaultCredentialProjection resolves
// ~/.omp (and every other credential root) inside the temp directory. `plantOmp` creates the
// ~/.omp/agent tree the real projection requires (agent.db is its admission sentinel).
function fakeHome({ plantOmp = false } = {}) {
  const home = tmpDir('home');
  if (plantOmp) {
    mkdirSync(join(home, '.omp', 'agent'), { recursive: true });
    writeFileSync(join(home, '.omp', 'agent', 'agent.db'), 'fixture-agent-db\n');
    writeFileSync(join(home, '.omp', 'agent', 'config.yml'), 'fixture-config\n');
  }
  return home;
}

// Open the deployment with HOME scoped to the fake home. Readiness is frozen at open, so HOME
// is restored as soon as openBaton resolves; nothing later re-reads the operator's home.
async function openDeployment(card, home) {
  const repo = repository();
  const deploymentRoot = tmpDir('deployment');
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  let deployment = null;
  try {
    deployment = await openBaton({
      repo,
      advanced: {
        deploymentRoot,
        routes: [ROUTE],
        adapters: { omp: new CardAdapter(card) },
        verification: Object.freeze({ command: 'true', arguments: [] }),
        capacity: {
          estimate: () => ({ bytes: 60, inodes: 5 }),
          observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
        },
      },
    });
    return deployment;
  } catch (error) {
    try { await deployment?.close(); } catch { /* the open failure stays authoritative */ }
    throw error;
  } finally {
    process.env.HOME = previousHome;
  }
}

function routeRow(doctor, route = ROUTE) {
  return (doctor?.routes ?? []).find((row) => row.harness === route.harness
    && row.model === route.model && row.effort === route.effort) ?? null;
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// RED ROWS — fail today (the row reads 'ready'); green only on a #234-correct gate.
// ════════════════════════════════════════════════════════════════════════════════════════════

test('RH234-1 (stage: worker-policy gate missing): a matched card with NO workerPolicy reads blocked/route_policy_unsupported, never ready', async () => {
  // The credential axis is satisfied (adapter-managed), so this row isolates the policy gate.
  const deployment = await openDeployment(ompCard({ workerPolicy: null, credentialState: 'available' }), fakeHome());
  try {
    const row = routeRow(await deployment.doctor());
    assert.ok(row, 'the omp route must appear in the doctor rows');
    assert.notEqual(row.state, 'ready',
      `a card without workerPolicy must never read ready (got state=${row.state}, code=${row.code})`);
    assert.equal(row.state, 'blocked');
    assert.equal(row.code, 'route_policy_unsupported');
    assert.ok(/worker policy/i.test(row.summary ?? ''), `the summary must name the worker policy (got ${row.summary})`);
  } finally {
    await deployment.close();
  }
});

test('RH234-1b (stage: worker-policy gate missing): a schema-valid but unsatisfiable card (interactive-only autonomy) reads blocked/route_policy_unsupported — the throw branch, not just absence', async () => {
  const deployment = await openDeployment(
    ompCard({ workerPolicy: INTERACTIVE_ONLY_POLICY, credentialState: 'available' }),
    fakeHome(),
  );
  try {
    const row = routeRow(await deployment.doctor());
    assert.ok(row, 'the omp route must appear in the doctor rows');
    assert.notEqual(row.state, 'ready',
      `an unsatisfiable worker policy must never read ready (got state=${row.state}, code=${row.code})`);
    assert.equal(row.state, 'blocked');
    assert.equal(row.code, 'route_policy_unsupported');
  } finally {
    await deployment.close();
  }
});

test('RH234-2 (stage: credential gate missing): an omp-family route with no resolvable credential projection reads blocked/route_credentials_unprojected, never ready', async () => {
  // Valid worker policy, no adapter-managed credential, and a HOME with no ~/.omp — exactly
  // the auth-less-member shape measured in the #230 background.
  const deployment = await openDeployment(ompCard({}), fakeHome());
  try {
    const row = routeRow(await deployment.doctor());
    assert.ok(row, 'the omp route must appear in the doctor rows');
    assert.notEqual(row.state, 'ready',
      `an unprojected credential family must never read ready (got state=${row.state}, code=${row.code})`);
    assert.equal(row.state, 'blocked');
    assert.equal(row.code, 'route_credentials_unprojected');
    assert.ok(/credential|project/i.test(row.summary ?? ''), `the summary must name the credential projection (got ${row.summary})`);
    const doctor = await deployment.doctor();
    assert.equal(doctor.ready, false, 'a deployment whose only route is credential-blocked is not ready');
  } finally {
    await deployment.close();
  }
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// OVER-BLOCK GUARD — green today; must STAY green once the gates land.
// ════════════════════════════════════════════════════════════════════════════════════════════

test('RH234-3 (guard): a fully-satisfied route still reads ready — via the projected ~/.omp tree AND via an adapter-managed credential', async () => {
  // (a) The projection channel: a fake HOME carrying ~/.omp/agent/agent.db resolves the omp
  //     credential tree exactly like the operator's real home would.
  const projected = await openDeployment(ompCard({}), fakeHome({ plantOmp: true }));
  try {
    const row = routeRow(await projected.doctor());
    assert.ok(row, 'the omp route must appear in the doctor rows');
    assert.equal(row.state, 'ready',
      `a route with a resolvable worker policy and a projected ~/.omp tree must read ready (got state=${row.state}, code=${row.code})`);
    assert.equal(row.summary, 'The exact route passed static deployment readiness.');
  } finally {
    await projected.close();
  }

  // (b) The adapter-managed channel: providerCompatibility.credentialState 'available' is
  //     RuntimeIsolation's adapterManaged rule — no projection entry required.
  const managed = await openDeployment(ompCard({ credentialState: 'available' }), fakeHome());
  try {
    const row = routeRow(await managed.doctor());
    assert.ok(row, 'the omp route must appear in the doctor rows');
    assert.equal(row.state, 'ready',
      `an adapter-managed credential must read ready without a projection entry (got state=${row.state}, code=${row.code})`);
  } finally {
    await managed.close();
  }
});
