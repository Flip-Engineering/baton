import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { OmpRpcCli } from '../src/omp-rpc.mjs';

// #230 red pin — the omp first-turn contract. Measured 2026-08-15 (live resident dogfood):
// the member dispatched (task.created/claimed, adapter spawned a real `omp --mode rpc`
// process, coordinator minted lifecycle.turn_started) and then sat IDLE — all tokio workers
// parked, ZERO provider sockets, omp's own log showing no prompt/turn — until the stall
// watchdog flagged no_progress_evidence at 20 min. Ground truth via isolated-home replay:
// sending the SAME rendered brief through a hand-driven `omp --mode rpc` completed in 24s
// (1754 frames, multi-turn agent work). The member's brief was never SENT.
//
// Sibling contract (claude-session.mjs:806-862): a session adapter that receives the brief
// at spawn() OWNS the first turn — claude buffers `pendingBrief` and writes the user frame
// the moment the process is ready. OmpRpcCli.spawn ignores its `brief` argument entirely.
//
// RED   = spawn() resolves ok without ever issuing a prompt (no turn starts).
// GREEN = spawn() sends the rendered brief as the first turn once the process is ready
//         (the adapter's lifecycle.turn_started fires; the prompt rides the rpc lane).

test('OMP-FIRST-TURN: spawn() sends the rendered brief as the first turn when the process is ready', async () => {
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
  adapter.onEvent((e) => events.push(e.kind));
  const ack = await adapter.spawn('w-pin', { goal: 'prove the first turn' }, {
    worktree: '/tmp',
    model: 'deepseek/deepseek-v4-flash',
    reasoningEffort: 'high',
  });
  assert.equal(ack.ok, true, `spawn must succeed (got ${JSON.stringify(ack)})`);
  // THE PIN: the brief must reach the child's stdin as a prompt frame.
  const promptFrames = writes.map((w) => { try { return JSON.parse(w); } catch { return null; } })
    .filter((f) => f?.type === 'prompt');
  assert.equal(promptFrames.length, 1, `exactly one prompt frame must be written on spawn (got ${promptFrames.length}; writes=${JSON.stringify(writes.map((w) => w.slice(0, 60)))})`);
  assert.ok(String(promptFrames[0].message).includes('prove the first turn'),
    'the prompt frame carries the rendered brief');
  assert.ok(events.includes('lifecycle.turn_started'), 'the adapter emits turn_started for the first turn');
});
