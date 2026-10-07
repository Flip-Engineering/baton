// Production-critic portable negative fixture: runtime terminality, startup
// event/ack ordering, ref/thread invalidation and worker-routing admission.
//
// Target source: exact snapshot pinned in SHA256SUMS.txt (worktree
// semantic-impl-cdp, untracked bend2/context/runtime + bend2/src/context/runtime).
// The fixture imports only the copied modules in ./modules and performs no
// network, process or filesystem effect beyond reading its own files. Run it on
// an admitted remote runner only (operator execution boundary 2026-10-05):
//   node fixture-runtime-negatives.mjs
// Exit 0 when every case shows the documented result; exit 1 lists surprises.
//
// Cases marked [DEFECT-EXPECTED] document current source behavior that this
// review reports as a defect; the fixture fails when source behavior differs,
// so a later author fix flips the case and the report can be re-checked.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOD = (name) => import(join(HERE, 'modules', name));

const { nextState, initialRecord, STATES } = await MOD('cdp-state.mjs');
const { createAdapterSession } = await MOD('cdp-session.mjs');
const { admitControlRequest, admitReadRequest, admitIntent } = await MOD('cdp-intents.mjs');
const { encodeRefId } = await MOD('cdp-refs.mjs');

const results = [];
function check(name, expected, actual) {
  const match = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ name, expected, actual, match });
}

// ---------------------------------------------------------------------------
// A. Startup event/ack ordering (paused-at-startup vs startReleaseSent)
// ---------------------------------------------------------------------------
// A1 [DEFECT-EXPECTED]: the --inspect-brk startup stop processed before the
// runIfWaitingForDebugger ack moves waitingForStart -> paused and consumes the
// only state startReleaseSent is admitted from.
const rec = nextState(initialRecord(), { type: 'endpointDiscovered' });
check('A1 endpointDiscovered from starting', [true, 'waitingForStart'], rec.ok ? [true, rec.record.state] : [false, rec.condition]);
const stopped = nextState(rec.record, { type: 'paused' });
check('A2 paused admitted from waitingForStart', [true, 'paused', '1'],
  stopped.ok ? [true, stopped.record.state, stopped.record.epoch] : [false, stopped.condition]);
const release = nextState(stopped.record, { type: 'startReleaseSent' });
check('A3 [DEFECT-EXPECTED] startReleaseSent refused after startup stop', [false, 'illegalTransition'],
  release.ok ? [true, 'running'] : [false, release.condition]);
// A4: the only recovery is resumeSent, which spends a control grant and leaves
// lastPause live with no matching record state.
const recover = nextState(stopped.record, { type: 'resumeSent' });
check('A4 recovery path exists via resumeSent', [true, 'running', '2'],
  recover.ok ? [true, recover.record.state, recover.record.epoch] : [false, recover.condition]);

// A5 [DEFECT-EXPECTED] pause-ack race: stop observed before the pause ack, then
// the ack path applies pauseRequested and the state machine refuses it.
const run = nextState(initialRecord(), { type: 'endpointDiscovered' });
const wait = nextState(run.record, { type: 'startReleaseSent' });
const stopFirst = nextState(wait.record, { type: 'paused' });
check('A5a paused from running', [true, 'paused', '1'],
  stopFirst.ok ? [true, stopFirst.record.state, stopFirst.record.epoch] : [false, stopFirst.condition]);
const latePauseAck = nextState(stopFirst.record, { type: 'pauseRequested' });
check('A5b [DEFECT-EXPECTED] late pauseRequested refused', [false, 'illegalTransition'],
  latePauseAck.ok ? [true, 'pausePending'] : [false, latePauseAck.condition]);

// ---------------------------------------------------------------------------
// B. Terminality: adapterFailed after exited (JS refuses; Bend advances)
// ---------------------------------------------------------------------------
const exited = nextState(wait.record, { type: 'childExit' });
check('B1 childExit from running', [true, 'exited'], exited.ok ? [true, exited.record.state] : [false, exited.condition]);
const jsFailed = nextState(exited.record, { type: 'adapterFailed' });
check('B2 JS refuses adapterFailed after exited', [false, 'illegalTransition'],
  jsFailed.ok ? [true, jsFailed.record.state] : [false, jsFailed.condition]);
// B3 is the Bend half: bend2/src/context/runtime/cdp-runtime.bend advance() maps
// EvAdapterFailed to Failed{} unconditionally, so Exited -> Failed succeeds.
// Prove it on the remote runner with cdp-terminality-witness.bend (commands in
// REMOTE-COMMANDS.txt). JS-side this case pins the divergence boundary only.

// ---------------------------------------------------------------------------
// C. Frame/ref invalidation and thread identity
// ---------------------------------------------------------------------------
const session = createAdapterSession({ runtime: 'rt:q1', adapter: 'ad1', incarnation: '0' });
const frameRef = encodeRefId({
  runtime: 'rt:q1', adapter: 'ad1', thread: 'main:0', epoch: '0',
  mutationGeneration: '0', kind: 'frame', handle: '0:1:0',
});
const runningSessionState = nextState(initialRecord(), { type: 'endpointDiscovered' });
// drive the session record to running without a transport via the state module
// is not reachable from the session facade; the facade refuses pause-scoped
// refs outside paused, which is the parent-reproduced fix under test:
const outside = session.admitRef(frameRef);
check('C1 [FIXED] pause-scoped ref refused outside pause', [false, 'refOutsidePause', 'starting'],
  outside.ok ? [true, 'admitted'] : [false, outside.condition, outside.detail]);
// C2 [DEFECT-EXPECTED]: thread identity is never validated. A ref naming a
// worker thread that was never attached (or a detached worker) admits whenever
// epoch/mutation match; admission never consults snapshot().threads.
const ghostThreadRef = encodeRefId({
  runtime: 'rt:q1', adapter: 'ad1', thread: 'worker:never-attached', epoch: '0',
  mutationGeneration: '0', kind: 'thread', handle: 'worker:never-attached',
});
const ghost = session.admitRef(ghostThreadRef);
check('C2 [DEFECT-EXPECTED] unknown-thread ref admitted', [true],
  ghost.ok ? [true] : [false, ghost.condition]);

// ---------------------------------------------------------------------------
// D. Worker routing: inner message read-only, sessionId membership unchecked
// ---------------------------------------------------------------------------
const nestedRead = admitControlRequest(initialRecord(), 'NodeWorker.sendMessageToWorker',
  { sessionId: 'unknown-session', message: JSON.stringify({ method: 'Runtime.getProperties' }) },
  ['controlRuntime']);
check('D1 nested read admitted', [true, 'Runtime.getProperties'],
  nestedRead.ok ? [true, nestedRead.inner] : [false, nestedRead.condition]);
const nestedControl = admitControlRequest(initialRecord(), 'NodeWorker.sendMessageToWorker',
  { sessionId: 'unknown-session', message: JSON.stringify({ method: 'Runtime.runIfWaitingForDebugger' }) },
  ['controlRuntime']);
check('D2 [FIXED] nested control refused', [false, 'nestedControlNotAdmitted'],
  nestedControl.ok ? [true, 'admitted'] : [false, nestedControl.condition]);
// D3 [DEFECT-EXPECTED]: unknown sessionId is forwarded without a membership
// check against the session's worker table.
check('D3 [DEFECT-EXPECTED] unknown sessionId not checked at admission', [true],
  nestedRead.ok ? [true] : [false]);

// ---------------------------------------------------------------------------
// E. Grant boundary on the request paths (parent repro set, current bytes)
// ---------------------------------------------------------------------------
const startup = admitReadRequest(initialRecord(), 'Runtime.runIfWaitingForDebugger');
check('E1 [FIXED] startup release refused on read path', [false, 'controlRequiresGrant'],
  startup.ok ? [true, 'admitted'] : [false, startup.condition]);
const grantedStartup = admitControlRequest(
  nextState(initialRecord(), { type: 'endpointDiscovered' }).record,
  'Runtime.runIfWaitingForDebugger', {}, ['controlRuntime']);
check('E2 startup release admitted with controlRuntime', [true],
  grantedStartup.ok ? [true] : [false, grantedStartup.condition]);
const ungrantedLaunch = admitIntent(initialRecord(), 'launch', { effects: [] });
check('E3 launch requires controlRuntime', [false, 'missingEffect'],
  ungrantedLaunch.ok ? [true, 'admitted'] : [false, ungrantedLaunch.condition]);
const condBp = admitControlRequest(initialRecord(), 'Debugger.setBreakpointByUrl',
  { url: 'file:///a.js', lineNumber: 1, condition: 'x > 0' }, ['controlRuntime']);
check('E4 [FIXED] breakpoint condition refused', [false, 'breakpointConditionUnsupported'],
  condBp.ok ? [true, 'admitted'] : [false, condBp.condition]);

// ---------------------------------------------------------------------------
// F. Closed event union: no reconciliation event restores paused after a
// failed resume send (model gap; see report section 3)
// ---------------------------------------------------------------------------
const resumedRecord = nextState(stopFirst.record, { type: 'resumeSent' });
check('F1 resumeSent advances epoch before send', [true, 'running', '2'],
  resumedRecord.ok ? [true, resumedRecord.record.state, resumedRecord.record.epoch] : [false, resumedRecord.condition]);
// No event type in the closed union moves running -> paused without a NEW
// Debugger.paused event; the failed send leaves the record desynced from the
// still-paused target with lastPause.live and a higher epoch. Demonstrated by
// the type list in cdp-state.mjs; no executable case needed.

// ---------------------------------------------------------------------------
const failures = results.filter((entry) => !entry.match);
const summary = {
  total: results.length,
  failed: failures.length,
  states: STATES,
  results,
};
console.log(JSON.stringify(summary, null, 2));
if (failures.length > 0) process.exit(1);
