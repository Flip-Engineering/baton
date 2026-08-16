import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { OmpRpcCli } from '../src/omp-rpc.mjs';

// #230 red pin — the omp turnInFlight contract (the false-stall murder). Measured 2026-08-15
// (wave-d fleet): member w-636 spawned 14:56, turn started, actively WORKING (125 omp session
// events, mid-tool-call at 15:26) when the stall watchdog declared
// health.stall_suspected/no_progress_evidence at 15:20 and killed it at 15:35 — the omp log
// records 'Session exit recorded, reason: sigterm, pendingToolCalls: [bash]'. The D2
// control-law line in the watchdog (coordinator _armWatchdog):
//   if (handle.turnInFlight === true) { re-arm; return; }  // a working turn is NOT a stall
// protects exactly this — and the coordinator's handle.turnInFlight is fed by the ADAPTER's
// event KINDS (coordinator _observeWatchdogEvent: a worker-actor lifecycle.turn_started sets
// the marker at 9724; lifecycle.turn_completed clears it at the turn-terminal seam, 12918).
//
// The murder's root cause was upstream of both: RouteLiveness._wrapAdapters captured the
// coordinator's listener by private spelling and OmpRpcCli's didn't match — every omp event
// was dropped, so the marker could never be set (pinned end-to-end, coordinator and all, in
// omp-false-stall-red.test.mjs). THIS row pins the adapter-side truth the marker feeds on:
//
// RED   = the adapter's turn-lifecycle events do not tell the turn-in-flight story the
//         coordinator consumes (no turn_started on the first turn; no turn_completed on a
//         terminal agent_end; a mid-turn steer minting turn lifecycle it must not).
// GREEN = the adapter emits exactly the kinds the coordinator mirrors: the first turn rides
//         spawn (turn_started), a terminal agent_end completes (turn_completed), and a
//         mid-turn nudge steer-queues WITHOUT minting any turn lifecycle — the in-flight
//         turn is the truth, so the stall classifier's evidence is true.

test('OMP-TURN-IN-FLIGHT: the adapter reports turn-in-flight truth (a working turn is never stall-murdered)', async () => {
  const writes = [];
  const makeChild = () => ({
    pid: 4242,
    stdin: { write: (chunk) => { writes.push(chunk); } },
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => {},
    on: () => {},
    once: () => {},
  });
  const adapter = new OmpRpcCli({
    requestTimeoutMs: 5_000,
    model: 'deepseek/deepseek-v4-flash',
    modelCatalog: { 'deepseek/deepseek-v4-flash': ['high'] },
    ceiling: 1,
    versionProbe: () => 'omp test',
    spawnFn: () => {
      const child = makeChild();
      setImmediate(() => { child.stdout.write(`${JSON.stringify({ type: 'ready', protocolVersion: 1 })}\n`); });
      return child;
    },
  });
  const events = [];
  adapter.onEvent((e) => events.push(e));

  await adapter.spawn('w-pin', { goal: 'prove turn-in-flight' }, {
    worktree: '/tmp',
    model: 'deepseek/deepseek-v4-flash',
    reasoningEffort: 'high',
  });

  // spawn starts the first turn: the coordinator's liveness marker feeds on this KIND.
  const started = events.filter((e) => e.kind === 'lifecycle.turn_started');
  assert.equal(started.length, 1,
    'exactly one lifecycle.turn_started on spawn — the kind that sets handle.turnInFlight (the D2 re-arm evidence)');

  // A mid-turn nudge (the messageOnSpawn lane) MUST NOT mint turn lifecycle: the running turn
  // is still the truth. omp steer-queues it and emits nothing.
  const nudge = await adapter.prompt('w-pin', '[MESSAGE brief — UNTRUSTED] keep going', 'nudge');
  assert.equal(nudge.ok, true, 'the mid-turn nudge steer-queues');
  assert.equal(events.filter((e) => e.kind === 'lifecycle.turn_started').length, 1,
    'a queued steer never mints a second turn_started — the in-flight turn stays the liveness truth');
  assert.equal(events.filter((e) => e.kind === 'lifecycle.turn_completed').length, 0,
    'a queued steer never completes the running turn');

  // Simulate the provider's terminal agent_end on the frame lane: the turn settles.
  adapter._onFrame(adapter._sessions.get('w-pin'), { type: 'agent_end', isTerminal: true, messages: [] });
  const completed = events.filter((e) => e.kind === 'lifecycle.turn_completed');
  assert.equal(completed.length, 1,
    'a terminal agent_end emits exactly one lifecycle.turn_completed — the kind that clears handle.turnInFlight at the turn-terminal seam (C4: a zombie flag would hold liveness forever)');

  // And the turn boundary is real for the next turn: a fresh prompt starts one.
  const followUp = await adapter.prompt('w-pin', 'next turn', 'turn');
  assert.equal(followUp.ok, true, 'a prompt with no active turn starts a fresh turn');
  assert.equal(events.filter((e) => e.kind === 'lifecycle.turn_started').length, 2,
    'the fresh turn mints its own lifecycle.turn_started — the marker re-arms on true turn boundaries only');
});
