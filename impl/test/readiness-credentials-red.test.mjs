// Readiness + Roster + Credential Controllers red suite — epic #47 + #83 + #84.
//
// Binding contract: docs/reference/evidence/frontier-sweep-2026-08-03/
// readiness-credentials-contract.md (v1.0, post-red-team fold). Rows are named after the
// contract's acceptance IDs (RT-1..RT-14); every row fails TODAY for the named stage and goes
// green only on a contract-correct implementation. Pins (green today) guard the behavior the
// contract says is unchanged (kimi tombstone exactness, per-vendor remedy text, the static
// readiness substrate, the existing wave_driver_route_unready preflight code).
//
// Harness architecture mirrors test/bidirectional-v3-red.test.mjs (ScriptableAdapter pattern,
// here opened through a full openBatonDeployment like phase85-context-effect-admission-red) and
// test/claude-credential-projection-red.test.mjs (#11 cache fixture + scanTree + source scans).
//
// SUITE-CHOSEN SEAMS (the contract pins behavior, not these JS spellings; each is the most
// sibling-consistent reading of the named contract surface):
//   - the §4.2.2 fleet_roster projection is read as `deployment.fleet.roster()`
//     (CLI `baton fleet roster` ↔ facade `fleet.roster()`, sibling of `waves.start`);
//   - the §4.3.1 controller is `GrokCredentialCache` (re-exported from
//     application-deployment.mjs like ClaudeCredentialCache, or living in
//     src/grok-credential-cache.mjs — either home satisfies the row);
//   - the §4.3.3 deployment wiring is `advanced.grokCredentials` (sibling of
//     advanced.claudeCredentials, application-deployment.mjs:1606);
//   - the probe rides the real adapter's spawn/prompt path carrying the bounded probe prompt
//     (§4.1.1: "the same code path a real spawn rides"), so the fixture adapter detects probe
//     turns by the contract's `<route>-probe ok` pin text and answers by parsing the expected
//     line out of the probe instruction — exactly what a cooperative provider does.
//
// WIRE-SHAPE ASSUMPTION (UNVERIFIED): a worker turn that surfaces refresh-token death carries
// the `invalid_grant` wire text in its failed output (the matcher class of
// claude-credential-cache.mjs:149). RT-14b pins the PROPAGATION (§4.1.3 fold F-1), not the
// detection grammar; a live receipt must confirm the exact detection wire.
//
// Control law: no clocks or turn-limits in assertions. The only wall-clock dependencies are
// bounded async settling (flush loops, <100ms sleeps) and the credential-lockfile timeout row
// (a resource bound, not a work control).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  claudeAuthenticationSummary, openBatonDeployment,
} from '../src/application-deployment.mjs';
import * as deploymentModule from '../src/application-deployment.mjs';
import { createDriver, createWaveDriver } from '../src/index.mjs';
import { RuntimeIsolation } from '../src/runtime-isolation.mjs';

const deploymentSource = readFileSync(new URL('../src/application-deployment.mjs', import.meta.url), 'utf8');
const semanticsSource = readFileSync(new URL('../src/application-semantics.mjs', import.meta.url), 'utf8');
const fakeGrokRefresh = fileURLToPath(new URL('./fixtures/fake-grok-credential-refresh.mjs', import.meta.url));
const srcDir = fileURLToPath(new URL('../src', import.meta.url));

const ROUTE_LOW = Object.freeze({ harness: 'grok', model: 'grok-4.5', effort: 'low' });
const ROUTE_HIGH = Object.freeze({ harness: 'grok', model: 'grok-4.5', effort: 'high' });
const STATIC_SUMMARY = 'The exact route passed static deployment readiness.';

const dirs = [];
function tmpDir(label = 'tmp') {
  const dir = mkdtempSync(join(tmpdir(), `baton-rc-${label}-`));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

async function flush(times = 30) {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}
async function settle(ms = 15) {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await flush(40);
}

// ── The scriptable fixture adapter ──────────────────────────────────────────────────────────
// A bidirectional-v3-style ScriptableAdapter whose card satisfies the deployment's exact-route
// gates (phase85 shape). Probe turns (the bounded liveness probe riding the real spawn path)
// are scripted by `mode`; ordinary worker spawns stay in-flight (occupancy fixtures) unless
// their objective carries the '(auth-refusal)' marker, which completes the turn with the
// invalid_grant wire text (the §4.3.3 worker-sourced verdict).
class ProbeAdapter {
  constructor({ route = ROUTE_LOW, mode = 'complete', cardCanary = null, credentialState = 'available' } = {}) {
    this._route = route;
    this.mode = mode;
    this.calls = { spawn: [], prompt: [] };
    this._onEvent = null;
    this._cardCanary = cardCanary;
    this._credentialState = credentialState;
  }

  card() {
    return {
      harness: this._route.harness,
      version: '1.0.0',
      authPosture: 'subscription',
      concurrencyCeiling: 64,
      maxContext: 128000,
      modelSelection: {
        mode: 'exact', configuredDefault: this._route.model, available: [this._route.model],
        family: 'grok', acceptedPrefixes: [], acceptedAliases: [],
        reasoningEffort: ['low', 'high'], serviceTier: null,
        provenance: 'readiness-credentials-red', refreshedAt: null,
      },
      providerCompatibility: { credentialState: this._credentialState },
      permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
      workerPolicy: {
        schemaVersion: 1,
        autonomy: {
          supported: ['unattended'], default: 'unattended', perTask: false,
          observation: 'unavailable', mechanisms: [],
        },
        access: {
          supported: ['full'], default: 'full', perTask: false,
          observation: 'unavailable', mechanisms: [],
        },
        containment: {
          hostProcess: 'same_uid', guarantees: ['private_runtime'],
          configuredPreferences: [], observation: 'unavailable',
        },
      },
      verbs: { spawn: 'native', prompt: 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native' },
      decision: 'native',
      turnCompletion: 'pausable',
      // A card-local canary a parallel/weaker roster sanitizer would copy verbatim (RT-8).
      ...(this._cardCanary ? { description: this._cardCanary } : {}),
    };
  }

  onEvent(cb) { this._onEvent = cb; }
  emit(event) { if (this._onEvent) this._onEvent(event); }

  _emitFor(worker, kind, payload, turnEpoch = 1) {
    this.emit({
      worker, harness: `${this._route.harness}@1.0.0`, turnEpoch, kind, actor: 'worker', payload,
    });
  }

  static isProbeText(text) {
    return /probe/i.test(String(text ?? ''));
  }

  static expectedLine(text) {
    const match = /exactly one line:?\s*[`'"]([^`'"\n]+?)[`'"]/i.exec(String(text ?? ''));
    return match?.[1] ?? `${ROUTE_LOW.model}-probe ok`;
  }

  _runProbeTurn(worker, text) {
    const line = ProbeAdapter.expectedLine(text);
    const mode = this.mode;
    // Deferred so any per-probe listener the runtime attaches after spawn/prompt still observes
    // the wire (bounded async settling, never a work clock).
    setTimeout(() => {
      if (mode === 'refuse') return; // spawn-time refusal; no wire follows
      this._emitFor(worker, 'lifecycle.spawned', {});
      if (mode === 'die') {
        this._emitFor(worker, 'lifecycle.process_closed', { code: 1 });
        return;
      }
      this._emitFor(worker, 'resource.provider_call', { callId: `probe-${worker}`, phase: 'completed' });
      if (mode === 'invalid_grant') {
        this._emitFor(worker, 'lifecycle.turn_completed', {
          status: 'failed', output: 'OIDC token exchange failed: invalid_grant (refresh token revoked)',
        });
        return;
      }
      if (mode === 'wrong') {
        this._emitFor(worker, 'lifecycle.turn_completed', {
          status: 'completed', output: 'this is not the content-verified line',
        });
        return;
      }
      if (mode === 'noisy') {
        // The exact pin placed BEYOND the 2KiB expected-response capture bound (§4.1.2): a
        // bounded capture must never see it, so this probe must fail, never verify.
        this._emitFor(worker, 'lifecycle.turn_completed', {
          status: 'completed', output: `${'x'.repeat(3072)}\n${line}`,
        });
        return;
      }
      this._emitFor(worker, 'lifecycle.turn_completed', { status: 'completed', output: line });
    }, 0);
  }

  async spawn(worker, brief) {
    this.calls.spawn.push({ worker, brief });
    const text = JSON.stringify(brief ?? {});
    if (ProbeAdapter.isProbeText(text)) {
      if (this.mode === 'refuse') {
        return { ok: false, code: 'fixture_adapter_refusal', reason: 'fixture adapter refused the probe spawn' };
      }
      this._runProbeTurn(worker, text);
      return { ok: true };
    }
    if (String(brief?.goal ?? '').includes('(auth-refusal)')) {
      setTimeout(() => {
        this._emitFor(worker, 'resource.provider_call', { callId: `turn-${worker}`, phase: 'completed' });
        this._emitFor(worker, 'lifecycle.turn_completed', {
          status: 'failed', output: 'provider rejected the turn: invalid_grant (refresh token revoked)',
        });
      }, 0);
    }
    return { ok: true };
  }

  async prompt(worker, content, mode) {
    this.calls.prompt.push({ worker, content, mode });
    if (ProbeAdapter.isProbeText(content)) this._runProbeTurn(worker, content);
    return { ok: true };
  }

  // The coordinator's two-phase stop settles on the adapter's typed confirmation
  // (coordinator.mjs:8632) — mirror MockAdapter._finalizeStop's wire so deployment.close()
  // drains immediately instead of waiting out the 15s stop deadline.
  _confirmStop(worker, kind) {
    setTimeout(() => {
      this._emitFor(worker, kind, {
        result: {
          status: 'cancelled', progress: 0, summary: `stopped via ${kind}`,
          artifacts: { commits: [], files: [] },
          verification: { command: 'true', claimedExit: -1 },
          openQuestions: [], budgetUsed: { tokens: 0, usd: 0 },
        },
      });
    }, 0);
  }

  async interrupt(worker) { this._confirmStop(worker, 'control.interrupt_confirmed'); return { ok: true }; }
  async approve() { return { ok: true }; }
  async answer() { return { ok: true }; }
  async kill(worker) { this._confirmStop(worker, 'kill.confirmed'); return { ok: true }; }
}

function probeInvocations(adapter) {
  return [
    ...adapter.calls.spawn.filter(({ brief }) => ProbeAdapter.isProbeText(JSON.stringify(brief ?? {}))),
    ...adapter.calls.prompt.filter(({ content }) => ProbeAdapter.isProbeText(content)),
  ];
}

// ── The deployment fixture (phase85 pattern) ────────────────────────────────────────────────
function repository() {
  const root = tmpDir('repo');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'rc@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'RC fixture'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }));
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

async function openFixture({ routes = [ROUTE_LOW], adapters, extraAdvanced = {} }) {
  const repo = repository();
  const deploymentRoot = tmpDir('deployment');
  let driver = null;
  let wiringError = null;
  let deployment = null;
  try {
    deployment = await openBatonDeployment({
      repo,
      advanced: {
        deploymentRoot,
        routes,
        adapters,
        verification: { command: 'true', arguments: [] },
        capacity: {
          estimate: () => ({ bytes: 60, inodes: 5 }),
          observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
        },
        ...extraAdvanced,
      },
    }, (driverOptions) => { driver = createDriver(driverOptions); return driver; });
  } catch (error) {
    wiringError = error;
  }
  return {
    repo, deploymentRoot, driver, deployment, wiringError,
    async close() { try { await deployment?.close(); } catch { /* teardown is best-effort */ } },
  };
}

let objectiveSeq = 0;
async function spawnWorker(deployment, route, tag = 'worker') {
  objectiveSeq += 1;
  const run = await deployment.run(`${tag} objective ${objectiveSeq}`, { exact: route });
  await run.approve();
  await settle();
  return run;
}

async function gateOutcome(deployment, route, tag = 'gated') {
  objectiveSeq += 1;
  try {
    const run = await deployment.run(`${tag} objective ${objectiveSeq}`, { exact: route });
    await run.approve();
    await settle();
    return { refused: null, run };
  } catch (error) {
    return { refused: error, run: null };
  }
}

function routeRow(readiness, route) {
  return (readiness?.routes ?? []).find((row) => row.harness === route.harness
    && row.model === route.model && row.effort === route.effort) ?? null;
}

function allDeploymentEvents(driver, adapter) {
  const events = [...(driver?.coordination?.events?.() ?? [])];
  const workers = new Set(adapter.calls.spawn.map(({ worker }) => worker));
  for (const worker of workers) {
    try { events.push(...(driver?.coordinator?._log?.read(worker) ?? [])); } catch { /* stream absent */ }
  }
  return events;
}

function probeRecords(driver, adapter, kind) {
  return allDeploymentEvents(driver, adapter).filter((event) => event?.kind === kind);
}

const ms = (value) => (typeof value === 'number' ? value : Date.parse(value));

// The §4.2.2 wave-preflight consumer, driven exactly as wave-driver.mjs:274-282 drives it, with
// the wave itself stopped at the fixture boundary (RT-5 gates on preflight probe counts only).
async function runWavePreflight(deployment, route, members = 64) {
  const facade = {
    doctor: () => deployment.doctor(),
    waves: {
      start: async () => {
        throw Object.assign(new Error('fixture stop after preflight'), { code: 'fixture_preflight_passed' });
      },
    },
  };
  const wave = createWaveDriver(facade, { preflight: true });
  const request = {
    members: Array.from({ length: members }, (_, index) => ({
      role: `member-${index}`, objective: `fixture wave member ${index}`, exact: route,
    })),
  };
  return wave.run(request).then(
    () => 'resolved',
    (error) => error?.code ?? String(error?.message ?? error),
  );
}

function scanTree(root) {
  const values = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) values.push(...scanTree(path));
    else values.push(readFileSync(path, 'utf8'));
  }
  return values;
}

async function resolveGrokCredentialCache() {
  const dedicated = await import('../src/grok-credential-cache.mjs').catch(() => null);
  return deploymentModule.GrokCredentialCache ?? dedicated?.GrokCredentialCache ?? null;
}

function grokWire(accessToken, expiresAt) {
  return {
    'xai::oauth': {
      key: accessToken,
      refresh_token: `refresh-for-${accessToken}`,
      expires_at: expiresAt,
    },
  };
}

function grokCacheOptions(root, overrides = {}) {
  return {
    credentialPath: join(root, 'auth.json'),
    refreshRoot: join(root, 'refresh'),
    now: () => Date.parse('2026-08-03T00:00:00.000Z'),
    ...overrides,
  };
}

// ===========================================================================
// #47 — the bounded actual-inference readiness tier (stage: liveness tier missing)
// ===========================================================================

test('RT-1a (stage: #47 probe tier missing): a content-verified probe marks the route live-verified with the minted receipts', async () => {
  const adapter = new ProbeAdapter({ route: ROUTE_LOW, mode: 'complete' });
  const fixture = await openFixture({ routes: [ROUTE_LOW], adapters: { grok: adapter } });
  try {
    assert.equal(fixture.wiringError, null, 'fixture must open');
    await spawnWorker(fixture.deployment, ROUTE_LOW, 'rt1a');
    assert.ok(probeInvocations(adapter).length >= 1,
      'stage #47: the spawn gate never probed the route (no bounded actual-inference tier)');

    const doctor = await fixture.deployment.doctor();
    const row = routeRow(doctor, ROUTE_LOW);
    assert.ok(row?.liveness, 'stage #47: doctor route rows carry no liveness attribute (§4.2.2)');
    assert.equal(row.liveness.state, 'verified',
      'a probe completing with the exact expected output is provider-alive (§4.1.4)');
    for (const field of ['verifiedAt', 'expiresAt', 'probeId', 'latencyMs', 'credentialKey']) {
      assert.ok(row.liveness[field] !== undefined && row.liveness[field] !== null,
        `the §4.1.3 liveness tuple carries ${field}`);
    }
    assert.ok(ms(row.liveness.expiresAt) > ms(row.liveness.verifiedAt),
      'the verified window is bounded (expiresAt after verifiedAt)');

    // §4.1.1: the probe mints a typed readiness.probe_verified record AND a
    // resource.provider_call-class receipt — evidence (up), never a control (down).
    const verified = probeRecords(fixture.driver, adapter, 'readiness.probe_verified');
    assert.ok(verified.length >= 1,
      'stage #47: no readiness.probe_verified record was minted on the evidence stream');
    const record = verified.at(-1).payload ?? {};
    for (const field of ['probeId', 'latencyMs', 'observedAt', 'expiresAt']) {
      assert.ok(record[field] !== undefined, `the probe receipt carries ${field} (§4.1.1)`);
    }
    assert.ok(
      allDeploymentEvents(fixture.driver, adapter).some((event) => String(event?.kind ?? '').includes('provider_call')),
      'a resource.provider_call-class receipt exists for the probe turn',
    );

    // Fold F-4: the probe's content check rides the shared verify.reverified-sourced evidence
    // path (coordination-store.mjs:3378-3384) — a bespoke probe-only verifier fails this row.
    const evidenceRef = record.verificationEvidence;
    assert.ok(Number.isSafeInteger(evidenceRef?.coordinationSeq),
      'fold F-4: the probe verdict must carry verificationEvidence traced into the shared evidence path');
    const mapped = fixture.driver.coordination.events().find((event) => event.seq === evidenceRef.coordinationSeq);
    assert.equal(mapped?.kind, 'evidence.mapped',
      'fold F-4: the probe evidence resolves to an evidence.mapped event (the route-observation path)');
    assert.equal(mapped?.payload?.kind, 'verify.reverified',
      'fold F-4: the probe evidence is verify.reverified-sourced, checked digest-for-digest');
  } finally {
    await fixture.close();
  }
});

test('RT-1b (stage: #47 probe tier missing): spawned-but-never-content-verified and wrong-content probes are probe_failed, never verified', async () => {
  for (const mode of ['die', 'wrong']) {
    const adapter = new ProbeAdapter({ route: ROUTE_LOW, mode });
    const fixture = await openFixture({ routes: [ROUTE_LOW], adapters: { grok: adapter } });
    try {
      assert.equal(fixture.wiringError, null, 'fixture must open');
      const outcome = await gateOutcome(fixture.deployment, ROUTE_LOW, `rt1b-${mode}`);
      assert.ok(outcome.refused,
        `stage #47: a ${mode} probe did not refuse the spawn — proving-too-little is the probe-as-fake gap (§4.1.1)`);
      const doctor = await fixture.deployment.doctor();
      const row = routeRow(doctor, ROUTE_LOW);
      assert.equal(row?.liveness?.state ?? null, 'failed',
        `${mode}: a probe without the content-verified turn receipt is probe_failed, never verified`);
      assert.ok(probeRecords(fixture.driver, adapter, 'readiness.probe_failed').length >= 1,
        `${mode}: a readiness.probe_failed record is minted (§4.1.1)`);
      assert.equal(probeRecords(fixture.driver, adapter, 'readiness.probe_verified').length, 0,
        `${mode}: a bare lifecycle.spawned / wrong output NEVER mints probe_verified`);
    } finally {
      await fixture.close();
    }
  }
});

test('RT-2 (stage: #47 cache missing): never probe per call — fresh-window spawns probe zero, a cold consult probes once, concurrent stale spawns coalesce', async () => {
  const adapter = new ProbeAdapter({ route: ROUTE_LOW, mode: 'complete' });
  const fixture = await openFixture({ routes: [ROUTE_LOW], adapters: { grok: adapter } });
  try {
    assert.equal(fixture.wiringError, null, 'fixture must open');
    await spawnWorker(fixture.deployment, ROUTE_LOW, 'rt2-first');
    assert.equal(probeInvocations(adapter).length, 1,
      'stage #47: the first (cache-absent) consult performs exactly one probe (§4.1.3)');
    for (let index = 0; index < 4; index += 1) await spawnWorker(fixture.deployment, ROUTE_LOW, 'rt2-fresh');
    assert.equal(probeInvocations(adapter).length, 1,
      'N spawns within a fresh liveness window perform ZERO further probes (never probe per call)');

    const row = routeRow(await fixture.deployment.doctor(), ROUTE_LOW);
    const windowMs = ms(row?.liveness?.expiresAt) - ms(row?.liveness?.verifiedAt);
    assert.ok(windowMs > 0, 'the verified window is positive');
    assert.ok(windowMs <= 28 * 60 * 1000,
      '§4.1.3: the grok OIDC-subscription default window is bounded by the observed 28-min credential TTL');
  } finally {
    await fixture.close();
  }

  const coldAdapter = new ProbeAdapter({ route: ROUTE_LOW, mode: 'complete' });
  const cold = await openFixture({ routes: [ROUTE_LOW], adapters: { grok: coldAdapter } });
  try {
    assert.equal(cold.wiringError, null, 'fixture must open');
    await Promise.all(Array.from({ length: 8 }, (_, index) => spawnWorker(cold.deployment, ROUTE_LOW, `rt2-concurrent-${index}`)));
    assert.equal(probeInvocations(coldAdapter).length, 1,
      'N concurrent stale/absent spawns coalesce into ONE probe (single-flight per route, §4.1.2/§4.1.3)');
  } finally {
    await cold.close();
  }
});

test('RT-3 (stage: #47 probe bounds missing): one probe is one bounded provider call — prompt ≤1KiB, capture ≤2KiB, latency ≤120s, no retry loop', async () => {
  const adapter = new ProbeAdapter({ route: ROUTE_LOW, mode: 'complete' });
  const fixture = await openFixture({ routes: [ROUTE_LOW], adapters: { grok: adapter } });
  try {
    assert.equal(fixture.wiringError, null, 'fixture must open');
    await spawnWorker(fixture.deployment, ROUTE_LOW, 'rt3');
    const probes = probeInvocations(adapter);
    assert.equal(probes.length, 1, 'stage #47: one consult is exactly one provider call (§4.1.2) — zero probes means the tier is not landed');
    const promptBytes = Buffer.byteLength(
      String(probes[0].brief?.goal ?? probes[0].content ?? JSON.stringify(probes[0].brief ?? '')),
    );
    assert.ok(promptBytes <= 1024, `the probe prompt is bounded at ≤1KiB (observed ${promptBytes}B)`);
  } finally {
    await fixture.close();
  }

  const noisyAdapter = new ProbeAdapter({ route: ROUTE_LOW, mode: 'noisy' });
  const noisy = await openFixture({ routes: [ROUTE_LOW], adapters: { grok: noisyAdapter } });
  try {
    assert.equal(noisy.wiringError, null, 'fixture must open');
    const outcome = await gateOutcome(noisy.deployment, ROUTE_LOW, 'rt3-noisy');
    assert.ok(outcome.refused,
      'stage #47: the expected pin placed beyond the 2KiB capture bound must NOT verify (§4.1.2)');
    assert.equal(probeInvocations(noisyAdapter).length, 1,
      'a failing probe performs exactly one provider call — no retry loop (§4.1.2)');
    const failed = probeRecords(noisy.driver, noisyAdapter, 'readiness.probe_failed');
    assert.ok(failed.length >= 1, 'a readiness.probe_failed record is minted for the over-capture probe');
    const latency = Number(failed.at(-1).payload?.latencyMs);
    assert.ok(Number.isFinite(latency) && latency <= 120_000,
      'the probe verdict carries latencyMs within the ≤120s wall bound (§4.1.2)');
  } finally {
    await noisy.close();
  }
});

test('RT-4 (stage: #47 gate missing): static-ready and provider-alive are separable; only failed liveness refuses, with the classified typed code', async () => {
  const adapter = new ProbeAdapter({ route: ROUTE_LOW, mode: 'complete' });
  const fixture = await openFixture({ routes: [ROUTE_LOW], adapters: { grok: adapter } });
  try {
    assert.equal(fixture.wiringError, null, 'fixture must open');
    const coldRow = routeRow(await fixture.deployment.doctor(), ROUTE_LOW);
    assert.equal(coldRow?.state, 'ready', 'static readiness is the unchanged substrate (§4.1.4)');
    assert.equal(coldRow?.liveness?.state ?? null, 'unverified',
      'stage #47: the advisory view must show the not-yet-verified window honestly, as a SEPARATE field (RT-4)');
    const outcome = await gateOutcome(fixture.deployment, ROUTE_LOW, 'rt4');
    assert.equal(outcome.refused, null,
      'a static-ready route with a lapsed/absent liveness window is NOT refused — the gate probes and admits (§4.1.4)');
    const warmRow = routeRow(await fixture.deployment.doctor(), ROUTE_LOW);
    assert.equal(warmRow?.liveness?.state ?? null, 'verified', 'the gate probe verifies the route (§4.1.4)');
  } finally {
    await fixture.close();
  }

  const cases = [
    ['invalid_grant', 'authentication_refresh_required', /grok login/i],
    ['die', 'provider_unreachable', null],
    ['refuse', 'fixture_adapter_refusal', null],
  ];
  for (const [mode, code, remedy] of cases) {
    const caseAdapter = new ProbeAdapter({ route: ROUTE_LOW, mode });
    const caseFixture = await openFixture({ routes: [ROUTE_LOW], adapters: { grok: caseAdapter } });
    try {
      assert.equal(caseFixture.wiringError, null, 'fixture must open');
      const first = await gateOutcome(caseFixture.deployment, ROUTE_LOW, `rt4-${mode}`);
      assert.equal(first.refused?.code ?? null, code,
        `${mode}: the blocked liveness classifies to the typed code, never a generic "not ready" (§4.1.1)`);
      const row = routeRow(await caseFixture.deployment.doctor(), ROUTE_LOW);
      assert.equal(row?.state, 'ready', `${mode}: static readiness stays separable from liveness`);
      assert.equal(row?.liveness?.state ?? null, 'failed', `${mode}: the liveness field is failed`);
      assert.equal(row?.liveness?.code ?? null, code, `${mode}: the liveness row carries the typed code`);
      if (remedy) {
        assert.match(String(row?.liveness?.summary ?? ''), remedy,
          `${mode}: the blocked state carries the vendor corrective action (§4.1.1)`);
      }
      const probesBefore = probeInvocations(caseAdapter).length;
      const second = await gateOutcome(caseFixture.deployment, ROUTE_LOW, `rt4-${mode}-again`);
      assert.equal(second.refused?.code ?? null, code, `${mode}: the sticky failure keeps refusing with the same code`);
      assert.equal(probeInvocations(caseAdapter).length, probesBefore,
        `${mode}: failed is sticky within its bounded window — a dead provider is NOT re-probed per spawn (§4.1.3)`);
    } finally {
      await caseFixture.close();
    }
  }
});

test('RT-4p (pin): the static readiness substrate is unchanged — the tier is additive, never a replacement', async () => {
  const orphan = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
  const adapter = new ProbeAdapter({ route: ROUTE_LOW, mode: 'complete' });
  const absentAdapter = new ProbeAdapter({ route: orphan, credentialState: 'absent' });
  const fixture = await openFixture({ routes: [ROUTE_LOW, orphan], adapters: { grok: adapter, codex: absentAdapter } });
  try {
    assert.equal(fixture.wiringError, null, 'fixture must open');
    const doctor = await fixture.deployment.doctor();
    const ready = routeRow(doctor, ROUTE_LOW);
    assert.equal(ready?.state, 'ready');
    assert.equal(ready?.summary, STATIC_SUMMARY, 'the static gate keeps its exact verdict text (§1.2)');
    const blocked = routeRow(doctor, orphan);
    assert.equal(blocked?.state, 'blocked');
    assert.equal(blocked?.code, 'authentication_required', 'a credential-absent route is still static-blocked (§1.2)');
    const outcome = await gateOutcome(fixture.deployment, orphan, 'rt4p');
    assert.equal(outcome.refused?.code ?? null, 'authentication_required',
      'assertRouteReady still refuses a static-blocked spawn with the typed code (application-deployment.mjs:1155-1162)');
  } finally {
    await fixture.close();
  }
});

test('RT-5 (stage: #47 preflight consumption missing): the wave-driver preflight rides the cache — fresh costs zero probes, a cold wave costs ≤1 per stale route', async () => {
  const adapter = new ProbeAdapter({ route: ROUTE_LOW, mode: 'complete' });
  const fixture = await openFixture({ routes: [ROUTE_LOW], adapters: { grok: adapter } });
  try {
    assert.equal(fixture.wiringError, null, 'fixture must open');
    await spawnWorker(fixture.deployment, ROUTE_LOW, 'rt5-warm');
    assert.equal(probeInvocations(adapter).length, 1, 'stage #47: the warm-up consult probes exactly once — zero means the preflight cache discipline is not landed');
    const outcome = await runWavePreflight(fixture.deployment, ROUTE_LOW);
    assert.equal(outcome, 'fixture_preflight_passed', 'a cache-fresh 64-member preflight passes');
    assert.equal(probeInvocations(adapter).length, 1,
      'a 64-member wave whose routes are all cache-fresh performs NO probes at preflight (RT-5)');
  } finally {
    await fixture.close();
  }

  const coldAdapter = new ProbeAdapter({ route: ROUTE_LOW, mode: 'complete' });
  const cold = await openFixture({ routes: [ROUTE_LOW], adapters: { grok: coldAdapter } });
  try {
    assert.equal(cold.wiringError, null, 'fixture must open');
    const outcome = await runWavePreflight(cold.deployment, ROUTE_LOW);
    assert.equal(outcome, 'fixture_preflight_passed', 'the cold preflight passes after probing');
    assert.ok(probeInvocations(coldAdapter).length <= 1,
      'a cold wave performs ≤1 probe per stale route — never one per member (RT-5)');
    assert.equal(probeInvocations(coldAdapter).length, 1,
      'stage #47: the preflight never probed the stale route at all (the cache consult is not wired)');
  } finally {
    await cold.close();
  }

  const deadAdapter = new ProbeAdapter({ route: ROUTE_LOW, mode: 'invalid_grant' });
  const dead = await openFixture({ routes: [ROUTE_LOW], adapters: { grok: deadAdapter } });
  try {
    assert.equal(dead.wiringError, null, 'fixture must open');
    const outcome = await runWavePreflight(dead.deployment, ROUTE_LOW);
    assert.equal(outcome, 'wave_driver_route_unready',
      'stage #47: a provider-dead route must fail the wave at preflight, not eat 64 member spawns');
    assert.ok(probeInvocations(deadAdapter).length <= 1, 'the failing preflight probes at most once');
  } finally {
    await dead.close();
  }
});

test('RT-5p (pin): the existing preflight still refuses a static-blocked member with wave_driver_route_unready', async () => {
  const orphan = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
  const adapter = new ProbeAdapter({ route: ROUTE_LOW, mode: 'complete' });
  const absentAdapter = new ProbeAdapter({ route: orphan, credentialState: 'absent' });
  const fixture = await openFixture({ routes: [ROUTE_LOW, orphan], adapters: { grok: adapter, codex: absentAdapter } });
  try {
    assert.equal(fixture.wiringError, null, 'fixture must open');
    const outcome = await runWavePreflight(fixture.deployment, orphan, 2);
    assert.equal(outcome, 'wave_driver_route_unready',
      'wave-driver.mjs:274-282 keeps its typed refusal for a not-ready route (the seam the tier extends)');
  } finally {
    await fixture.close();
  }
});

test('RT-14a (stage: credentialKey join missing): a probe-sourced invalid_grant invalidates every liveness row sharing the credentialKey — including a sibling inside its own fresh window', async () => {
  const adapter = new ProbeAdapter({ route: ROUTE_LOW, mode: 'complete' });
  const fixture = await openFixture({ routes: [ROUTE_LOW, ROUTE_HIGH], adapters: { grok: adapter } });
  try {
    assert.equal(fixture.wiringError, null, 'fixture must open');
    await spawnWorker(fixture.deployment, ROUTE_HIGH, 'rt14a-warm');
    const warmRow = routeRow(await fixture.deployment.doctor(), ROUTE_HIGH);
    assert.equal(warmRow?.liveness?.state ?? null, 'verified', 'stage #47: route B must be live-verified inside its own fresh window before the sibling verdict arrives');
    const credentialKey = warmRow?.liveness?.credentialKey ?? null;
    assert.ok(typeof credentialKey === 'string' && credentialKey.length > 0,
      'the §4.1.3 liveness tuple carries credentialKey (fold F-1)');

    adapter.mode = 'invalid_grant';
    const refused = await gateOutcome(fixture.deployment, ROUTE_LOW, 'rt14a-probe');
    assert.equal(refused.refused?.code ?? null, 'authentication_refresh_required',
      'the probe on route A surfaces invalid_grant → authentication_refresh_required');

    const doctor = await fixture.deployment.doctor();
    const rowA = routeRow(doctor, ROUTE_LOW);
    const rowB = routeRow(doctor, ROUTE_HIGH);
    assert.equal(rowA?.liveness?.state ?? null, 'failed', 'route A is failed');
    assert.equal(rowA?.liveness?.credentialKey ?? null, credentialKey,
      'both routes share one credential identity (the static-path model of §1.2)');
    assert.equal(rowB?.liveness?.state ?? null, 'failed',
      'fold F-1: route B reads failed on its very next read — NOT its unexpired verified cache (RT-14)');
    assert.equal(rowB?.liveness?.code ?? null, 'authentication_refresh_required');

    const probesBefore = probeInvocations(adapter).length;
    const sibling = await gateOutcome(fixture.deployment, ROUTE_HIGH, 'rt14a-sibling');
    assert.equal(sibling.refused?.code ?? null, 'authentication_refresh_required',
      'route B\'s next spawn refuses on the credential-scoped verdict');
    assert.equal(probeInvocations(adapter).length, probesBefore,
      'the credential-scoped invalidation is a cache write, never a re-probe storm');
  } finally {
    await fixture.close();
  }
});

test('RT-14b (stage: credentialKey join missing): a worker-turn invalid_grant verdict invalidates the sibling rows the same way (§4.3.3)', async () => {
  const adapter = new ProbeAdapter({ route: ROUTE_LOW, mode: 'complete' });
  const fixture = await openFixture({ routes: [ROUTE_LOW, ROUTE_HIGH], adapters: { grok: adapter } });
  try {
    assert.equal(fixture.wiringError, null, 'fixture must open');
    await spawnWorker(fixture.deployment, ROUTE_LOW, 'rt14b-warm-a');
    await spawnWorker(fixture.deployment, ROUTE_HIGH, 'rt14b-warm-b');
    const before = await fixture.deployment.doctor();
    assert.equal(routeRow(before, ROUTE_LOW)?.liveness?.state ?? null, 'verified',
      'stage #47: route A must be live-verified before the worker verdict (the liveness tier is not landed)');
    assert.equal(routeRow(before, ROUTE_HIGH)?.liveness?.state ?? null, 'verified',
      'stage #47: route B must be live-verified before the worker verdict');

    // A real worker turn on route A surfaces refresh-token death (wire-shape assumption, header).
    objectiveSeq += 1;
    const run = await fixture.deployment.run(`rt14b (auth-refusal) objective ${objectiveSeq}`, { exact: ROUTE_LOW });
    await run.approve();
    await settle(25);

    const doctor = await fixture.deployment.doctor();
    assert.equal(routeRow(doctor, ROUTE_LOW)?.liveness?.state ?? null, 'failed',
      'stage #47/#84: the worker-sourced invalid_grant verdict never reached route A\'s liveness row (RT-13/RT-14)');
    assert.equal(routeRow(doctor, ROUTE_HIGH)?.liveness?.state ?? null, 'failed',
      'fold F-1: the verdict propagates to every liveness row sharing the credentialKey');
  } finally {
    await fixture.close();
  }
});

// ===========================================================================
// #83 — fleet.roster (stage: fleet_roster surface missing)
// ===========================================================================

test('RT-6 (stage: fleet_roster surface missing): the roster projects the closed document — static + liveness + occupancy + learning-or-null + bounded observations tail', async () => {
  const adapter = new ProbeAdapter({ route: ROUTE_LOW, mode: 'complete' });
  const fixture = await openFixture({ routes: [ROUTE_LOW, ROUTE_HIGH], adapters: { grok: adapter } });
  try {
    assert.equal(fixture.wiringError, null, 'fixture must open');
    await spawnWorker(fixture.deployment, ROUTE_LOW, 'rt6');
    assert.equal(typeof fixture.deployment.fleet?.roster, 'function',
      'stage #83: the deployment facade has no fleet.roster() projection surface (§4.2.2)');
    const doc = await fixture.deployment.fleet.roster();
    assert.ok(doc && typeof doc === 'object' && !Array.isArray(doc), 'fleet.roster() returns the projection document');
    assert.equal(doc?.schemaVersion, 1, 'the roster document is schemaVersion 1 (§4.2.1)');
    assert.ok(Number.isFinite(Date.parse(doc?.observedAt)), 'the document carries one snapshot timestamp');
    assert.deepEqual(
      new Set(Object.keys(doc)),
      new Set(['schemaVersion', 'observedAt', 'routes', 'observations']),
      'the roster is a CLOSED document (§4.2.1)',
    );
    assert.ok(Array.isArray(doc.routes) && doc.routes.length === 2, 'one row per configured route');
    const allowedRowKeys = new Set(['harness', 'model', 'effort', 'provider', 'static', 'liveness', 'occupancy', 'learning']);
    for (const row of doc.routes) {
      for (const key of Object.keys(row)) {
        assert.ok(allowedRowKeys.has(key), `the route row is closed — unexpected field ${key}`);
      }
      assert.equal(row.static?.state, 'ready', 'every row carries the static projection (§1.2)');
      assert.ok(typeof row.liveness?.credentialKey === 'string' && row.liveness.credentialKey.length > 0,
        'every row carries liveness including credentialKey (fold F-1)');
      assert.ok(['verified', 'unverified', 'failed'].includes(row.liveness?.state),
        'liveness.state is the §4.1.3 closed vocabulary');
      assert.ok(Number.isSafeInteger(row.occupancy?.inFlight), 'every row carries occupancy.inFlight');
      assert.ok(row.occupancy?.concurrencyCeiling >= 1, 'every row carries the adapter card ceiling');
      assert.equal(row.learning, null,
        'a route with no router bucket projects learning: null — honest-empty, never a fabricated prior (§4.2.1)');
    }
    assert.deepEqual(doc.observations, fixture.driver.coordination.routeObservations(),
      'observations are the bounded tail of routeObservations() (coordination-store.mjs:11114) — the same source');
    assert.ok(Buffer.byteLength(JSON.stringify(doc)) <= 16 * 1024 * 1024,
      'the document is byte-capped like the other projections (the cairn route-advice ceiling precedent)');
  } finally {
    await fixture.close();
  }
});

test('RT-7 (stage: roster occupancy missing): projected inFlight is the coordinator\'s real seat count, never caller-supplied', async () => {
  const adapter = new ProbeAdapter({ route: ROUTE_LOW, mode: 'complete' });
  const fixture = await openFixture({ routes: [ROUTE_LOW, ROUTE_HIGH], adapters: { grok: adapter } });
  try {
    assert.equal(fixture.wiringError, null, 'fixture must open');
    for (let index = 0; index < 3; index += 1) await spawnWorker(fixture.deployment, ROUTE_LOW, `rt7-${index}`);
    const observed = fixture.driver.coordinator._inFlightCount('grok');
    assert.equal(observed, 3, 'fixture: three seats are genuinely in-flight');
    assert.equal(typeof fixture.deployment.fleet?.roster, 'function',
      'stage #83: the deployment facade has no fleet.roster() projection surface (§4.2.2)');
    const doc = await fixture.deployment.fleet.roster();
    assert.ok(doc && typeof doc === 'object' && !Array.isArray(doc), 'fleet.roster() returns the projection document');
    const low = doc.routes.find((row) => row.effort === 'low');
    assert.equal(low?.occupancy?.inFlight ?? null, observed,
      'the projected inFlight EQUALS the coordinator\'s real count (coordinator.mjs:2800-2806)');
    assert.equal(low?.occupancy?.concurrencyCeiling ?? null, 64, 'the ceiling comes from the adapter card');

    let overridden = null;
    try { overridden = await fixture.deployment.fleet.roster({ occupancy: { inFlight: 99 }, inFlight: 99 }); } catch { /* refusing caller-supplied occupancy is equally honest */ }
    if (overridden) {
      assert.equal(overridden.routes.find((row) => row.effort === 'low')?.occupancy?.inFlight ?? null, observed,
        'a caller-supplied inFlight can NEVER alter the observed projection (RT-7)');
    }

    const rosterSources = readdirSync(srcDir).filter((name) => name.endsWith('.mjs')
      && /fleet_roster|fleetRoster/u.test(readFileSync(join(srcDir, name), 'utf8')));
    assert.ok(rosterSources.length >= 1, 'stage #83: no fleet_roster projection exists in impl/src');
    assert.ok(
      rosterSources.some((name) => readFileSync(join(srcDir, name), 'utf8').includes('_inFlightCount')),
      'the roster derives occupancy from the coordinator\'s _inFlightCount (source pin, RT-7)',
    );
  } finally {
    await fixture.close();
  }
});

test('RT-8 (stage: roster sanitizer missing): no credential value, executable path, private path, or provider token crosses the roster boundary', async () => {
  const canary = '/Users/rc-fixture/private/bin/grok RT-CANARY-9911-refresh-token';
  const adapter = new ProbeAdapter({ route: ROUTE_LOW, mode: 'complete', cardCanary: canary });
  const fixture = await openFixture({ routes: [ROUTE_LOW], adapters: { grok: adapter } });
  try {
    assert.equal(fixture.wiringError, null, 'fixture must open');
    await spawnWorker(fixture.deployment, ROUTE_LOW, 'rt8 SECRET-BRIEF-CANARY-7717');
    assert.equal(typeof fixture.deployment.fleet?.roster, 'function',
      'stage #83: the deployment facade has no fleet.roster() projection surface (§4.2.2)');
    const doc = await fixture.deployment.fleet.roster();
    assert.ok(doc && typeof doc === 'object' && !Array.isArray(doc), 'fleet.roster() returns the projection document');
    const wire = JSON.stringify(doc);
    for (const secret of ['RT-CANARY-9911', 'SECRET-BRIEF-CANARY-7717', '/Users/']) {
      assert.equal(wire.includes(secret), false,
        `the roster never projects ${secret} (the doctor sanitization discipline, docs/30:46-50)`);
    }

    const rosterSources = readdirSync(srcDir).filter((name) => name.endsWith('.mjs')
      && /fleet_roster|fleetRoster/u.test(readFileSync(join(srcDir, name), 'utf8')));
    assert.ok(rosterSources.length >= 1, 'stage #83: no fleet_roster projection exists in impl/src');
    assert.ok(
      rosterSources.some((name) => {
        const text = readFileSync(join(srcDir, name), 'utf8');
        return text.includes('publicRouteRuntime') || /publicRoster[A-Za-z]*/u.test(text);
      }),
      'fold F-5: the liveness/occupancy/learning fields extend publicRouteRuntime (application-deployment.mjs:940-969) or a stated public* sibling — a parallel sanitizer is a test failure',
    );
  } finally {
    await fixture.close();
  }
});

test('RT-9 (stage: fleet_roster registration missing): the roster registers in the ordinary plane\'s advanced fleet_* family with honest provenance, and doctor/roster rows never drift', async () => {
  const advanced = /advanced:\s*\{\s*defaultVisible:\s*false,\s*operations:\s*\[([\s\S]*?)\]/u.exec(semanticsSource)?.[1] ?? '';
  assert.match(advanced, /'fleet_roster'/u,
    'stage #83: fleet_roster is not registered in the ordinary capability plane\'s advanced fleet_* family (application-semantics.mjs:1099-1100, fold F-2)');

  const adapter = new ProbeAdapter({ route: ROUTE_LOW, mode: 'complete' });
  const fixture = await openFixture({ routes: [ROUTE_LOW], adapters: { grok: adapter } });
  try {
    assert.equal(fixture.wiringError, null, 'fixture must open');
    await spawnWorker(fixture.deployment, ROUTE_LOW, 'rt9');
    assert.equal(typeof fixture.deployment.fleet?.roster, 'function',
      'stage #83: the deployment facade has no fleet.roster() projection surface (§4.2.2)');
    const doc = await fixture.deployment.fleet.roster();
    assert.ok(doc && typeof doc === 'object' && !Array.isArray(doc), 'fleet.roster() returns the projection document');
    const serialized = JSON.stringify(doc);
    assert.match(serialized, /"routingMutationAuthority":false/u,
      'the roster claims routingMutationAuthority: false forever (§5 non-goal, RT-9)');
    assert.match(serialized, /"workerAuthority":false/u,
      'the roster claims workerAuthority: false — the ordinary plane\'s own provenance precedent (fold F-2)');

    const doctorRow = routeRow(await fixture.deployment.doctor(), ROUTE_LOW);
    const rosterRow = doc.routes.find((row) => row.effort === 'low');
    assert.deepEqual(
      {
        state: rosterRow?.static?.state ?? null,
        code: rosterRow?.static?.code ?? null,
        summary: rosterRow?.static?.summary ?? null,
      },
      {
        state: doctorRow?.state ?? null,
        code: doctorRow?.code ?? null,
        summary: doctorRow?.summary ?? null,
      },
      'doctor route rows and fleet_roster rows are byte-identical on shared static fields (one projection function)',
    );
    assert.deepEqual(rosterRow?.liveness ?? null, doctorRow?.liveness ?? null,
      'the liveness field never drifts between the two surfaces (RT-9)');
  } finally {
    await fixture.close();
  }
});

// ===========================================================================
// #84 — the credential controllers (stage: GrokCredentialCache missing)
// ===========================================================================

test('RT-10a (stage: GrokCredentialCache missing): the grok cache harvests a schema-valid fresher write-back from the vendor-native target', async () => {
  const GrokCredentialCache = await resolveGrokCredentialCache();
  assert.equal(typeof GrokCredentialCache, 'function',
    'stage #84: GrokCredentialCache is not landed (§4.3.1 — the grok OIDC refresh_token grant on the #11 pattern)');

  const root = tmpDir('grok-harvest');
  writeFileSync(join(root, 'auth.json'), `${JSON.stringify(grokWire('access-1000', '2026-01-01T00:00:00Z'))}\n`, { mode: 0o600 });
  const cache = await GrokCredentialCache.open(grokCacheOptions(root, {
    cmd: process.execPath,
    cmdArgs: [fakeGrokRefresh, '--baton-grok-refresh-fixture'],
  }));
  const adopted = await cache.refresh();
  assert.equal(JSON.stringify(adopted).includes('access-fresher-9000'), true,
    'the harvest adopts the strictly fresher schema-valid write-back (monotonicity + schema gate)');
  assert.equal(readFileSync(join(root, 'refresh', 'fixture-spawns'), 'utf8'), '1',
    'the vendor CLI executed exactly once (vendor-executed refresh, never fabricated)');

  const writeback = JSON.parse(readFileSync(join(root, 'refresh', 'fixture-writeback.json'), 'utf8'));
  assert.equal(writeback.projectedGrokTree, true,
    'fold F-3: the runtime projects the credential at HOME/.grok/auth.json (the grok-native sandbox shape, runtime-isolation.mjs:64-66)');
  assert.equal(writeback.flatClaudeSibling, false,
    'fold F-3: the runtime NEVER uses the claude flat sibling convention (HOME/.credentials.json)');
  assert.match(writeback.target, /\.grok\/auth\.json$/u,
    'fold F-3: the write-back read targets directory/.grok/auth.json');

  const grokModuleSource = readFileSync(new URL('../src/grok-credential-cache.mjs', import.meta.url), 'utf8');
  assert.ok(grokModuleSource.includes('.grok'), 'the grok controller source pins the .grok tree');
  assert.equal(grokModuleSource.includes('.credentials.json'), false,
    'the grok controller never references the claude flat-file convention (fold F-3)');
});

test('RT-10b (stage: GrokCredentialCache missing): invalid_grant latches without a second flight; the explicit command clears the latch and is the only persist-back path', async () => {
  const GrokCredentialCache = await resolveGrokCredentialCache();
  assert.equal(typeof GrokCredentialCache, 'function',
    'stage #84: GrokCredentialCache is not landed (§4.3.1)');

  const root = tmpDir('grok-latch');
  writeFileSync(join(root, 'auth.json'), `${JSON.stringify(grokWire('access-1000', '2026-01-01T00:00:00Z'))}\n`, { mode: 0o600 });
  let revoked = true;
  let spawns = 0;
  let persists = 0;
  const cache = await GrokCredentialCache.open(grokCacheOptions(root, {
    refreshRuntime: async () => {
      spawns += 1;
      return revoked
        ? { invalidGrant: true }
        : { candidate: grokWire('access-fresher-9000', '2099-01-01T00:00:00Z') };
    },
    persist: () => { persists += 1; },
  }));
  await assert.rejects(cache.refresh(), { code: 'authentication_refresh_required' },
    'a grok refresh returning invalid_grant rejects with the shared blocked taxonomy code (§4.3.3)');
  await assert.rejects(cache.refresh(), { code: 'authentication_refresh_required' });
  assert.equal(spawns, 1, 'the revocation latch fires — a revoked grok refresh never re-probes forever (§4.3.1)');
  assert.equal(cache.metadata().state, 'expired_needs_login',
    'the latched controller reports the dead state honestly (the #11 metadata vocabulary)');
  assert.equal(persists, 0, 'no automatic path persists a harvested credential to the operator store (the #11 consent ceremony stands)');
  revoked = false;
  await cache.explicitRefresh();
  assert.equal(spawns, 2, 'the explicit `baton credentials refresh grok` command clears the latch and re-runs the vendor refresh');
  assert.equal(persists, 1, 'the explicit consent command is the ONLY persist-back path (§4.3.1, claude-credential-cache.mjs:340)');
  assert.equal(cache.metadata().state, 'fresh');
});

test('RT-11 (stage: GrokCredentialCache missing): N concurrent refreshes coalesce single-flight; an auth.json change mid-flight aborts the adoption; the advisory lockfile blocks cross-deployment flights', async () => {
  const GrokCredentialCache = await resolveGrokCredentialCache();
  assert.equal(typeof GrokCredentialCache, 'function',
    'stage #84: GrokCredentialCache is not landed (§4.3.1)');

  const flightRoot = tmpDir('grok-flight');
  writeFileSync(join(flightRoot, 'auth.json'), `${JSON.stringify(grokWire('access-1000', '2026-01-01T00:00:00Z'))}\n`, { mode: 0o600 });
  const flightCache = await GrokCredentialCache.open(grokCacheOptions(flightRoot, {
    cmd: process.execPath,
    cmdArgs: [fakeGrokRefresh, '--baton-grok-refresh-fixture'],
  }));
  const adopted = await Promise.all(Array.from({ length: 32 }, () => flightCache.refresh()));
  assert.equal(readFileSync(join(flightRoot, 'refresh', 'fixture-spawns'), 'utf8'), '1',
    'N concurrent grok refresh triggers coalesce into ONE refresh runtime (per-credential single-flight)');
  assert.ok(adopted.every((item) => JSON.stringify(item).includes('access-fresher-9000')),
    'every waiter adopts the same fresher harvest');

  const casRoot = tmpDir('grok-cas');
  let operatorWire = grokWire('access-incumbent-1000', '2026-01-01T00:00:00Z');
  let operatorMtime = 1;
  writeFileSync(join(casRoot, 'auth.json'), `${JSON.stringify(operatorWire)}\n`, { mode: 0o600 });
  const casCache = await GrokCredentialCache.open(grokCacheOptions(casRoot, {
    fileRead: () => JSON.stringify(operatorWire),
    fileProbe: () => ({ exists: true, mtimeMs: operatorMtime }),
    refreshRuntime: async () => {
      // The operator store moves under the flight (another process refreshed it) — the CAS must
      // abort the runtime harvest and re-read the freshest operator value instead (§4.3.1).
      operatorWire = grokWire('access-midflight-7000', '2027-01-01T00:00:00Z');
      operatorMtime += 1;
      return { candidate: grokWire('access-runtime-9000', '2028-01-01T00:00:00Z') };
    },
  }));
  const casAdopted = await casCache.refresh();
  assert.equal(JSON.stringify(casAdopted).includes('access-midflight-7000'), true,
    'the auth.json mtime-CAS aborts the runtime adoption and re-reads the freshest operator credential');
  assert.equal(JSON.stringify(casCache.projectionEnv()).includes('access-runtime-9000'), false,
    'the changed-under-flight runtime candidate is NEVER adopted');

  const lockRoot = tmpDir('grok-lock');
  const lockPath = join(lockRoot, 'auth.json.baton-refresh.lock');
  writeFileSync(join(lockRoot, 'auth.json'), `${JSON.stringify(grokWire('access-1000', '2026-01-01T00:00:00Z'))}\n`, { mode: 0o600 });
  writeFileSync(lockPath, 'another-deployment\n', { mode: 0o600 });
  const locked = await GrokCredentialCache.open(grokCacheOptions(lockRoot, {
    lockPath, lockTimeoutMs: 40, lockPollMs: 5,
    refreshRuntime: async () => ({ candidate: grokWire('access-fresher-9000', '2099-01-01T00:00:00Z') }),
  }));
  await assert.rejects(locked.refresh(), { code: 'authentication_refresh_locked' },
    'a cross-deployment flight blocks on the advisory lockfile with the typed code (claude-credential-cache.mjs:98-119 pattern)');
  const grokModuleSource = readFileSync(new URL('../src/grok-credential-cache.mjs', import.meta.url), 'utf8');
  assert.equal(grokModuleSource.includes('O_EXCL'), true, 'the grok lockfile is the O_CREAT|O_EXCL advisory seam');
});

test('RT-12 (stage: GrokCredentialCache missing): access-token-only projection — no grok worker runtime ever receives the refresh token', async () => {
  const GrokCredentialCache = await resolveGrokCredentialCache();
  assert.equal(typeof GrokCredentialCache, 'function',
    'stage #84: GrokCredentialCache is not landed (§4.3.1)');

  const root = tmpDir('grok-boundary');
  writeFileSync(join(root, 'auth.json'), `${JSON.stringify(grokWire('access-20000', '2099-01-01T00:00:00Z'))}\n`, { mode: 0o600 });
  const cache = await GrokCredentialCache.open(grokCacheOptions(root));
  const projection = cache.projectionEnv();
  assert.equal(JSON.stringify(projection).includes('refresh-for-access-20000'), false,
    'the refresh token NEVER enters the worker projection env (§4.3.1, claude-credential-cache.mjs:229-232 pattern)');
  assert.equal(JSON.stringify(projection).includes('access-20000'), true,
    'the access token is projected');

  const credentialEnv = typeof cache.credentialEnv === 'function'
    ? cache.credentialEnv()
    : { grok: projection };
  const isolation = new RuntimeIsolation({
    repoRoot: process.cwd(), root: join(root, 'workers'),
    credentialFiles: {}, credentialEnv, baseEnv: { PATH: process.env.PATH },
  });
  const lease = isolation.create('rt12-worker', {
    harness: 'grok', authPosture: 'subscription',
    modelSelection: { family: 'grok' }, providerCompatibility: { credentialState: 'available' },
  });
  const tree = scanTree(lease.paths.root);
  assert.equal(tree.some((value) => value.includes('refresh-for-access-20000')), false,
    'the #11 CC-4 projection-tree scan: no projected grok worker file contains the cache\'s refresh-token bytes (RT-12)');
  assert.equal(JSON.stringify(lease.env).includes('refresh-for-access-20000'), false,
    'no projected grok worker env carries the refresh token');
  isolation.remove('rt12-worker');
});

test('RT-13a (stage: #84 deployment wiring missing): refresh-token death surfaces at the doctor with the grok corrective action', async () => {
  const adapter = new ProbeAdapter({ route: ROUTE_LOW, mode: 'complete' });
  const fixture = await openFixture({
    routes: [ROUTE_LOW],
    adapters: { grok: adapter },
    extraAdvanced: {
      grokCredentials: { refreshRuntime: async () => ({ invalidGrant: true }) },
    },
  });
  try {
    if (fixture.wiringError?.code === 'deployment_config_invalid') {
      assert.fail(`stage #84: the deployment has no grok credential controller wiring — advanced.grokCredentials is unsupported (${fixture.wiringError.message})`);
    }
    assert.equal(fixture.wiringError, null, 'fixture must open');

    const refused = await fixture.deployment.credentials.refresh('grok').then(
      () => null,
      (error) => error,
    );
    assert.equal(refused?.code ?? null, 'authentication_refresh_required',
      'the explicit grok refresh surfaces refresh-token death with the typed code, never a generic failure (§4.3.3)');

    const doctor = await fixture.deployment.doctor();
    const row = routeRow(doctor, ROUTE_LOW);
    const block = JSON.stringify(row ?? {});
    assert.equal(row?.code ?? row?.credential?.code ?? null, 'authentication_refresh_required',
      'the doctor credential block carries the typed refresh-token-death finding (§4.3.3)');
    assert.match(block, /grok login/iu,
      'the doctor surfaces the GROK corrective action (application-deployment.mjs:400-408), never another vendor\'s remedy');
  } finally {
    await fixture.close();
  }
});

test('RT-13b (pin): the kimi revoked-tombstone recognition stays exact — a partial/corrupt record is metadata-invalid, never promoted to revoked', () => {
  const kimi = deploymentSource.slice(
    deploymentSource.indexOf('function kimiAuthenticationState'),
    deploymentSource.indexOf('function grokAuthenticationSummary'),
  );
  assert.ok(kimi.includes('const revokedTombstone'), 'the tombstone recognition exists');
  assert.ok(kimi.includes("value.access_token === ''") && kimi.includes("value.refresh_token === ''")
    && kimi.includes('value.expires_at === 0') && kimi.includes('value.expires_in === 0'),
    'the recognition requires BOTH secrets and BOTH expiry counters cleared (application-deployment.mjs:360-375)');
  assert.ok(kimi.indexOf('const revokedTombstone') < kimi.indexOf('const accessTokenPresent'),
    'the tombstone is recognized BEFORE the generic schema gate — ordering is load-bearing');
  assert.ok(kimi.includes("credentialState: 'revoked'") && kimi.includes("'authentication_refresh_required'"),
    'an exact tombstone maps to revoked + authentication_refresh_required');
  assert.ok(kimi.includes("'authentication_metadata_invalid'"),
    'a partial/corrupt record stays authentication_metadata_invalid (RT-13)');
});

test('RT-13c (pin): every vendor\'s remedy text is its own and the shared terminal guidance stays vendor-agnostic', () => {
  assert.match(claudeAuthenticationSummary('authentication_refresh_required'), /Claude.*(?:auth login|\/login)/u,
    'the claude remedy owns the claude login flow');
  const grokSummary = deploymentSource.slice(
    deploymentSource.indexOf('function grokAuthenticationSummary'),
    deploymentSource.indexOf('function grokAuthenticationState'),
  );
  assert.match(grokSummary, /grok login/iu, 'the grok remedy owns the grok login flow');
  const kimiSummary = deploymentSource.slice(
    deploymentSource.indexOf('function kimiAuthenticationSummary'),
    deploymentSource.indexOf('function grokAuthenticationSummary'),
  );
  assert.match(kimiSummary, /`kimi` login flow/iu, 'the kimi remedy owns the kimi login flow');
  const guidance = semanticsSource.match(/authentication_refresh_required:\s*\{([\s\S]*?)\n\s*\},/u)?.[1] ?? '';
  assert.ok(guidance.length > 0, 'the shared terminal guidance block exists');
  assert.doesNotMatch(guidance, /Claude|Grok|Kimi|\/login/iu,
    'PROVIDER_TERMINAL_GUIDANCE (application-semantics.mjs:1888) stays vendor-agnostic (RT-13, #11 R11V-4)');
});
