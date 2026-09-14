// OMP × route liveness — the audit A-G2 second consequence (issue #281, lane `process-truth`).
//
// `routeMatches` (route-liveness.mjs:35-47) admits a route to the probe tier only when its
// adapter card declares `turnCompletion: 'pausable'`. OMP's card omitted the field, so EVERY OMP
// route was excluded from probing (`adapterFor` → null → `_runProbe` short-circuits to
// `route_unavailable`, non-blocking) — the exclusion the root's correction says "holds always".
// Completing the card (A-G1/A-G2/A-I6) ends the exclusion: the tier's own gate now matches OMP.
//
// WHAT THIS FILE PINS. (1) The gate: an exact OMP route resolves to the OMP adapter. (2) The
// tier's next step: the probe ASKS the adapter for a probe turn on a `liveness-probe-*` worker,
// carrying the content pin. Both are red at the pre-fix head — the route never matched, so no
// probe turn was ever attempted.
//
// WHAT THIS FILE DELIBERATELY DOES NOT PIN. The probe's spawn call passes `{goal}` alone
// (route-liveness.mjs:201) — no worktree, no model, no effort — so no real adapter can execute
// it: claude/codex/grok survive on their UNTYPED worktree refusal (classified 'unsupported',
// non-blocking) while typed refusers (kimi today; OMP's `effort_required` after this change) are
// classified 'failed' and BLOCK the route — a tier defect inside route-liveness.mjs, outside this
// lane's path scope, reported to the root rather than papered over here by weakening OMP's
// refusal taxonomy. The rows below therefore assert the ATTEMPT (this change's effect on the
// tier), never the tier's ability to complete a probe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { OmpRpcCli } from '../src/omp-rpc.mjs';
import { RouteLiveness } from '../src/route-liveness.mjs';

const MODEL = 'deepseek/deepseek-v4-flash';
const ROUTE = { harness: 'omp', model: MODEL, effort: 'high' };
const line = (frame) => `${JSON.stringify(frame)}\n`;

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.pid = 616161;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = { destroyed: false, write: () => true, end: () => {} };
    setImmediate(() => this.stdout.write(line({ type: 'ready', protocolVersion: 1 })));
  }
  kill(signal) { setImmediate(() => this.emit('exit', 0, signal ?? null)); return true; }
}

function fixture() {
  const children = [];
  const adapter = new OmpRpcCli({
    requestTimeoutMs: 1_000, model: MODEL, modelCatalog: { [MODEL]: ['high'] },
    versionProbe: () => 'omp test',
    spawnFn: () => { const child = new FakeChild(); children.push(child); return child; },
  });
  const events = [];
  adapter.onEvent((event) => events.push(event));
  // The probe tier reaches adapters through the single `spawn` seam; recording the CALL is how an
  // attempt is observed independently of its outcome (the omp-model-projection fixture shape).
  const spawnCalls = [];
  const rawSpawn = adapter.spawn.bind(adapter);
  adapter.spawn = (worker, brief, options) => {
    spawnCalls.push({ worker, brief, options });
    return rawSpawn(worker, brief, options);
  };
  const liveness = new RouteLiveness({ adapters: { omp: adapter }, now: Date.now, probeTimeoutMs: 1_000 });
  return { adapter, children, events, liveness, spawnCalls };
}

test('A-G2: an exact OMP route is probe-capable — the card admits it to the liveness tier', () => {
  const { liveness } = fixture();
  const match = liveness.adapterFor(ROUTE);
  assert.ok(match, 'the OMP route resolves to an adapter (pre-fix: no card match, so no adapter)');
  assert.equal(match.vendor, 'omp', 'the resolved vendor is the deployment key the coordinator uses');
  // A route the card does NOT admit still refuses: the gate is a gate, not a rubber stamp.
  assert.equal(liveness.adapterFor({ ...ROUTE, effort: 'ultra' }), null,
    'an effort outside the card inventory is still not probe-capable');
});

test('A-G2: the probe asks the OMP adapter for a probe turn on a liveness-probe worker', async () => {
  const { liveness, spawnCalls, children } = fixture();
  // The tier's outcome is the tier's business (see the header): this row pins the ATTEMPT — the
  // adapter is reached at all, which the pre-fix exclusion made impossible.
  await liveness.ensure(ROUTE).catch(() => {});

  assert.equal(spawnCalls.length, 1, 'the probe tier reached the OMP adapter exactly once');
  const [call] = spawnCalls;
  assert.match(call.worker, /^liveness-probe-[0-9a-f]{20}$/u, 'the probe rides its own isolated worker id');
  assert.equal(typeof call.brief?.goal, 'string', 'the probe hands the adapter the bounded probe prompt');
  assert.match(call.brief.goal, new RegExp(`'${MODEL}-probe ok'`, 'u'),
    'the prompt is the content pin the tier later verifies (D1)');
  // The probe child is created only if the adapter can honor the spawn; the tier decides what a
  // refusal means (see the header). Either way the ATTEMPT is what this row asserts.
  assert.ok(children.length <= 1, 'never a probe per call');
});
