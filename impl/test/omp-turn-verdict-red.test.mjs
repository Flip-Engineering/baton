import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { OmpRpcCli } from '../src/omp-rpc.mjs';

// #236 red pin — the omp turn VERDICT contract. Measured 2026-08-19 (wave-f, three waves):
// members completed real work (w-658: clean agent_end, process exit 0, worktree checkpointed
// at a pinned sha) yet every task transitioned working→failed AT the turn_completed instant
// and every wave settled WAVE-INCOMPLETE. Cause: omp's lifecycle.turn_completed carries only
// {phase, turnId, turnEpoch, usageSeal} — no status, no summary, no artifacts. The
// coordinator's trust gate reads the turn verdict (status/artifacts); a verdict-less
// completion is not a success it can trust.
//
// Sibling contract (claude-session.mjs): turn_completed carries
//   { status: 'completed', summary, artifacts: { files: [...] }, ... } — the reducer's shape.
//
// RED   = omp turn_completed lacks status/summary/artifacts (the trust gate cannot accept it).
// GREEN = a terminal agent_end with a final assistant message emits the verdict fields:
//         status:'completed', summary (the final message's text), artifacts.files (the turn's
//         changed files when omp reports them, else []).

test('OMP-TURN-VERDICT: a terminal agent_end carries the turn verdict — status, summary, artifacts', async () => {
  const adapter = new OmpRpcCli({
    requestTimeoutMs: 5_000, model: 'm', modelCatalog: { m: ['high'] }, ceiling: 1,
    versionProbe: () => 'omp test',
    spawnFn: () => {
      const child = { pid: 4242, stdin: { write: () => {} }, stdout: new PassThrough(), stderr: new PassThrough(), kill: () => {}, on: () => {}, once: () => {} };
      const w = (o) => child.stdout.write(JSON.stringify(o) + '\n');
      setImmediate(() => {
        w({ type: 'ready', protocolVersion: 1 });
        setTimeout(() => w({ type: 'agent_start' }), 20);
        setTimeout(() => w({ type: 'turn_start' }), 25);
        // the final assistant message — the verdict's summary source
        setTimeout(() => w({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Implemented and verified the row deliverable.' } }), 40);
        setTimeout(() => w({ type: 'turn_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Implemented and verified the row deliverable.' }] } }), 60);
        setTimeout(() => w({ type: 'agent_end', isTerminal: true, messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Implemented and verified the row deliverable.' }] }] }), 80);
      });
      return child;
    },
  });
  const events = [];
  adapter.onEvent((e) => events.push(e));
  const ack = await adapter.spawn('w-pin', { goal: 'produce a verdict' }, { worktree: '/tmp', model: 'm', reasoningEffort: 'high' });
  assert.equal(ack.ok, true, `spawn ok (${JSON.stringify(ack).slice(0, 80)})`);
  await new Promise((r) => setTimeout(r, 400));
  const completed = events.filter((e) => e.kind === 'lifecycle.turn_completed').at(-1);
  assert.ok(completed, 'a terminal agent_end completes the turn');
  assert.equal(completed.payload?.status, 'completed',
    `turn_completed carries status:'completed' (got ${JSON.stringify(completed.payload?.status)}) — the trust gate reads this`);
  assert.ok(String(completed.payload?.summary ?? '').includes('verified the row deliverable'),
    `turn_completed carries the final message as summary (got ${JSON.stringify(completed.payload?.summary)?.slice(0, 80)})`);
  assert.ok(Array.isArray(completed.payload?.artifacts?.files),
    'turn_completed carries artifacts.files (empty array when omp reports none — an ARRAY, never undefined)');
});
