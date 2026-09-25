// Issue #477: the liveness observer survives the coordinator's deferred startup registration.
//
// MEASURED (the served open path, this worktree): `impl/src/route-liveness.mjs` `_wrapAdapters`
// installs the liveness observer on every adapter while the deployment OPENS, and
// `impl/src/coordinator.mjs` registers its own adapter listener only when its deferred startup
// reconstruction completes (`coordinationAsyncOpen: true`, #351 lane 3 / #434) — AFTER the wrapper.
// Every real adapter keeps ONE callback slot (`_cb` / `_userCb` / `_onEvent` / `_callback`, the
// chain adapter.mjs now owns), so the coordinator's later registration used to REPLACE the
// wrapper: at probe time the adapter's listener was the coordinator's callback, the probe's
// `lifecycle.spawned` / `resource.provider_call` / `lifecycle.turn_completed` all fired, and the
// liveness controller observed none of them. `ensure()` then waited out its (unref'd) probe
// deadline and settled `unknown` on EVERY real deployment — the tier never verified and never
// blocked, silently: the doctor read `unverified`, the spawn gate let everything through.
//
// ROWS (red at the pre-fix base — (a) and (c) settle `unknown` with the fixture's probe deadline,
// (b) strands every observer installed before the coordinator's registration):
//   (a) on a real `openBatonDeployment` with the async open, a probe's turn events reach the
//       controller and `ensure()` settles `verified`, and the doctor reads the same row;
//   (b) the order pin: the coordinator's registration — the LAST one, the one the deferred open
//       lands after the wrap — forwards through the observer it replaced instead of stranding it;
//   (c) the #460 hand-back's shape exactly: a scriptable adapter with a SINGLE slot is not deaf on
//       the served path — a worker turn's invalid_grant still fans out to the credential's rows.
//
// This file is the served-path half of #460: that lane delivered every event to every registered
// observer INSIDE its fixture adapters so the readiness rows could assert anything at all; the
// seam is what makes that workaround unnecessary outside a fixture.
//
// Every await a row takes on a deployment chain is BOUNDED and NAMED (#460, docs/42 §8): the bound
// is the registry's own probe deadline, and a bound miss carries `fixture_wait_unsettled` and is
// rethrown — a wait that never settled is a broken fixture, never a deployment refusal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { openBatonDeployment } from '../src/application-deployment.mjs';
import { createDriver } from '../src/index.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';

const ROUTE = Object.freeze({ harness: 'grok', model: 'grok-4.5', effort: 'low' });
const ROUTE_SIBLING = Object.freeze({ harness: 'grok', model: 'grok-4.5', effort: 'high' });

// The bound every wait in this file takes: the registry row the deployment's probe deadline and
// this file's waits share (#460 law — no new magic number, and the longest legitimate wait here is
// the probe the gate performs).
const WAIT_BOUND_MS = FRAME_LIMITS['route.probe_deadline_ms'].value;
const WAIT_UNSETTLED = 'fixture_wait_unsettled';

// The probe deadline the deployment UNDER TEST runs with. The served default is the same registry
// row (two minutes), which would make a broken seam cost two minutes per row — the probe's timer is
// unref'd, so nothing else settles the wait. The fixture answers on the next macrotask; #375 makes
// an outlived deadline settle `unknown`, never block; so the row states the same fact in seconds.
const SEAM_PROBE_TIMEOUT_MS = 5_000;

function isWaitBoundFailure(error) { return error?.code === WAIT_UNSETTLED; }

async function bounded(label, work, boundMs = WAIT_BOUND_MS) {
  let timer = null;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new assert.AssertionError({
      message: `${label}: never settled within ${boundMs}ms`,
    }), { code: WAIT_UNSETTLED })), boundMs);
  });
  try {
    return await Promise.race([work, deadline]);
  } catch (error) {
    // The abandoned work stays pending (nothing can cancel it): swallow a late settlement so it is
    // never an unhandled rejection on top of the failure the row is already reporting.
    if (isWaitBoundFailure(error)) Promise.resolve(work).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const dirs = [];
function tmpDir(label = 'tmp') {
  const dir = mkdtempSync(join(tmpdir(), `baton-issue477-${label}-`));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function repository() {
  const root = tmpDir('repo');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'issue477@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Issue 477 fixture'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }));
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Bounded settling between a fixture wire and the read that asserts it (the readiness fixtures'
// shape): microtasks first, then one short macrotask — never a control, only the fixture's own
// deferred emissions.
async function settle(ms = 25) {
  for (let index = 0; index < 40; index += 1) await Promise.resolve();
  await sleep(ms);
}

// ── The scriptable fixture adapter — SINGLE SLOT, the shape the #460 hand-back named ─────────────
// `_cb` is the only listener the adapter ever delivers to, exactly like every real tier (adapter.mjs
// MockAdapter `_userCb`, the session tiers' `_cb` / `_callback`, the readiness fixtures' `_onEvent`):
// the last registration receives every event and whatever it replaced receives nothing further.
// `registrations` keeps every listener in registration order for the order pin.
class SingleSlotAdapter {
  constructor({ route = ROUTE, family = 'grok', credentialState = 'available' } = {}) {
    this._route = route;
    this._family = family;
    this._credentialState = credentialState;
    this._cb = null;
    this.registrations = [];
    this.events = [];
    this.calls = { spawn: [], prompt: [] };
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
        family: this._family, acceptedPrefixes: [], acceptedAliases: [],
        reasoningEffort: ['low', 'high'], serviceTier: null,
        provenance: 'issue477-fixture', refreshedAt: null,
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
    };
  }

  onEvent(cb) {
    if (typeof cb !== 'function') return;
    this._cb = cb;
    this.registrations.push(cb);
  }

  /** The listener the slot currently holds — the identity the order pin reads (the same field the
   * deployment's own `adapterListener` reads: one slot, no second place to look). */
  listener() { return this._cb; }

  emit(event) { this.events.push(event); if (this._cb) this._cb(event); }

  _emitFor(worker, kind, payload) {
    this.emit({
      worker, harness: `${this._route.harness}@1.0.0`, turnEpoch: 1, kind, actor: 'worker', payload,
    });
  }

  static isProbeText(text) { return /probe/i.test(String(text ?? '')); }

  static expectedLine(text) {
    const match = /exactly one line:?\s*[`'"]([^`'"\n]+?)[`'"]/i.exec(String(text ?? ''));
    return match?.[1] ?? `${ROUTE.model}-probe ok`;
  }

  _runProbeTurn(worker, text) {
    const line = SingleSlotAdapter.expectedLine(text);
    // Deferred so any listener the runtime installs after spawn/prompt still observes the wire.
    setTimeout(() => {
      this._emitFor(worker, 'lifecycle.spawned', {});
      this._emitFor(worker, 'resource.provider_call', { callId: `probe-${worker}`, phase: 'completed' });
      this._emitFor(worker, 'lifecycle.turn_completed', { status: 'completed', output: line });
    }, 0);
  }

  async spawn(worker, brief) {
    this.calls.spawn.push({ worker, brief });
    const text = JSON.stringify(brief ?? {});
    if (SingleSlotAdapter.isProbeText(text)) {
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

  async prompt(worker, content) {
    this.calls.prompt.push({ worker, content });
    if (SingleSlotAdapter.isProbeText(content)) this._runProbeTurn(worker, content);
    return { ok: true };
  }

  // The coordinator's two-phase stop settles on the adapter's typed confirmation — MockAdapter's
  // wire — so deployment.close() drains instead of waiting out its own stop deadline.
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
  return adapter.calls.spawn.filter(({ brief }) => SingleSlotAdapter.isProbeText(JSON.stringify(brief ?? {})));
}

// ── The deployment fixture: the REAL served open path (openBatonDeployment + the async open) ─────
async function openFixture({ routes = [ROUTE, ROUTE_SIBLING], adapters, extraAdvanced = {} } = {}) {
  const repo = repository();
  const deploymentRoot = tmpDir('deployment');
  let driver = null;
  let deployment = null;
  let wiringError = null;
  try {
    deployment = await bounded('openFixture: openBatonDeployment', openBatonDeployment({
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
    }, (driverOptions) => {
      driver = createDriver({ ...driverOptions, watchdog: { ...driverOptions.watchdog, stallMs: 60_000 } });
      return driver;
    }));
  } catch (error) {
    if (isWaitBoundFailure(error)) throw error;
    wiringError = error;
  }
  return {
    repo, deploymentRoot, driver, deployment, wiringError,
    async close() {
      try { await bounded('fixture.close: deployment.close', deployment?.close()); } catch { /* teardown is best-effort, and still bounded */ }
    },
  };
}

function routeRow(readiness, route) {
  return (readiness?.routes ?? []).find((row) => row.harness === route.harness
    && row.model === route.model && row.effort === route.effort) ?? null;
}

test('477-a: on a real openBatonDeployment with the async open, a probe reaches the controller and ensure() settles verified', async () => {
  const adapter = new SingleSlotAdapter({ route: ROUTE });
  const fixture = await openFixture({ adapters: { grok: adapter }, extraAdvanced: { liveness: { probeTimeoutMs: SEAM_PROBE_TIMEOUT_MS } } });
  try {
    assert.equal(fixture.wiringError, null, 'the fixture must open through the served path');
    assert.ok(fixture.driver.coordinationOpened,
      'the served open is the ASYNC one (coordinationAsyncOpen) — the deferred registration this issue is about');

    const before = routeRow(await bounded('477-a: deployment.doctor (before)', fixture.deployment.doctor()), ROUTE);
    assert.equal(before?.liveness?.state, 'unverified', 'a route that was never probed reads unverified');

    // The probe rides the deployment's own controller through the doctor row's non-enumerable
    // `probe` handle — the same `ensure()` the spawn gate performs.
    const settled = await bounded('477-a: liveness.probe', before.liveness.probe());
    assert.equal(settled.state, 'verified',
      'a probe on the served path settles verified: its turn events must reach the liveness observer');
    assert.equal(typeof settled.verifiedAt, 'number', 'the verified row carries the recorded measurement');
    assert.equal(settled.probeId, probeInvocations(adapter)[0]?.worker,
      'the row names the probe worker the adapter actually spawned');

    const emitted = adapter.events.map((event) => event.kind);
    assert.ok(emitted.includes('lifecycle.turn_completed'),
      'the fixture emitted the probe terminal — the verdict was read from a real wire, never a short circuit');

    const after = routeRow(await bounded('477-a: deployment.doctor (after)', fixture.deployment.doctor()), ROUTE);
    assert.equal(after?.liveness?.state, 'verified', 'the doctor row reads the same verified state');
    assert.equal(after?.liveness?.verifiedAt, settled.verifiedAt, 'the doctor row is the controller\'s own row');
  } finally {
    await fixture.close();
  }
});

test('477-b: the coordinator\'s deferred registration wraps the liveness observer instead of replacing it', async () => {
  const adapter = new SingleSlotAdapter({ route: ROUTE });
  // An observer installed BEFORE the deployment opens — the oldest registration there is. It is
  // reachable only if every later registration forwards through the one it replaced.
  const seenByOldest = [];
  const oldest = (event) => seenByOldest.push(event);
  adapter.onEvent(oldest);

  const fixture = await openFixture({ adapters: { grok: adapter }, extraAdvanced: { liveness: { probeTimeoutMs: SEAM_PROBE_TIMEOUT_MS } } });
  try {
    assert.equal(fixture.wiringError, null, 'the fixture must open through the served path');

    // The order the deployment builds, read from the adapter's own registry: the test's observer,
    // then the liveness controller's wrapper (installed while the deployment opened), then the
    // coordinator's listener (installed when the deferred reconstruction completed — the
    // registration that used to own the slot by replacing the wrapper).
    assert.equal(adapter.registrations.length, 3,
      'the deployment installs exactly two observers beside the test\'s: the liveness wrapper, then the coordinator\'s deferred registration');
    assert.equal(adapter.registrations[0], oldest, 'the observer installed before the open is first');
    assert.notEqual(adapter.listener(), oldest, 'a later registration holds the slot (the coordinator\'s landed last)');
    assert.equal(adapter.listener(), adapter.registrations[2],
      'the listener the slot holds is the LAST registration — the deferred one this row is about');

    // The forwarding identity pin: delivering through the listener the slot holds must still reach
    // the observer the coordinator replaced it with. A replacing registration strands it, and every
    // observer under it, forever.
    seenByOldest.length = 0;
    const synthetic = { worker: 'issue477-b-synthetic', harness: 'grok@1.0.0', turnEpoch: 1, kind: 'lifecycle.spawned', actor: 'worker', payload: {} };
    adapter.emit(synthetic);
    assert.equal(seenByOldest.length, 1,
      'the last registration forwards to the observer it replaced (wrap, never overwrite) — a replacement would deliver to nobody installed before it');
    assert.equal(seenByOldest[0], synthetic, 'the forwarded event is the event the adapter emitted');
  } finally {
    await fixture.close();
  }
});

test('477-c: a single-slot adapter on the served path is not deaf — a worker turn\'s invalid_grant still fans out', async () => {
  const adapter = new SingleSlotAdapter({ route: ROUTE });
  const fixture = await openFixture({ adapters: { grok: adapter }, extraAdvanced: { liveness: { probeTimeoutMs: SEAM_PROBE_TIMEOUT_MS } } });
  try {
    assert.equal(fixture.wiringError, null, 'the fixture must open through the served path');

    // Both rows verified first: the sibling must be IN the cache for the credential write to reach
    // it (§4.1.3 fold F-1 rewrites the rows a credential owns, never a row nobody measured).
    const beforeRoute = routeRow(await bounded('477-c: deployment.doctor (before)', fixture.deployment.doctor()), ROUTE);
    await bounded('477-c: liveness.probe (route)', beforeRoute.liveness.probe());
    const beforeSibling = routeRow(await bounded('477-c: deployment.doctor (sibling)', fixture.deployment.doctor()), ROUTE_SIBLING);
    const siblingProbed = await bounded('477-c: liveness.probe (sibling)', beforeSibling.liveness.probe());
    assert.equal(siblingProbed.state, 'verified', 'the sibling row is verified before the death it must not survive');

    // A REAL worker turn on the route carries the refresh-token death (§4.3.3): the deployment
    // spawns the worker through the SAME single-slot adapter whose listener the coordinator owns.
    const run = await bounded('477-c: deployment.run', fixture.deployment.run('477-c (auth-refusal) worker objective', { exact: ROUTE }));
    await bounded('477-c: run.approve', run.approve());
    // The fixture's turn wire lands on a macrotask after the spawn; settle before reading, or a
    // green sibling could equally mean the death was never emitted.
    await settle(50);
    assert.ok(adapter.events.some((event) => event.kind === 'lifecycle.turn_completed'
      && event.payload?.status === 'failed' && /invalid_grant/u.test(String(event.payload?.output ?? ''))),
      'the fixture emitted the refresh-token death on the served adapter');

    const after = routeRow(await bounded('477-c: deployment.doctor (after)', fixture.deployment.doctor()), ROUTE_SIBLING);
    assert.equal(after?.liveness?.state, 'failed',
      'a worker turn\'s invalid_grant invalidates every row sharing the credentialKey — the liveness observer saw a real turn on the served path');
    assert.equal(after?.liveness?.code, 'authentication_refresh_required', 'the fan-out names the death it observed');
  } finally {
    await fixture.close();
  }
});
