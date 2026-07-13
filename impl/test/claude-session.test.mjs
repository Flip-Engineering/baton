// claude-session.test.mjs — TDD-RED tests for ClaudeSessionCli (spec/phase8/claude-session-adapter.md).
//
// `../src/claude-session.mjs` does not exist yet. This import is expected to fail today with a
// module-resolution error (ERR_MODULE_NOT_FOUND) — that is the correct RED reason for this phase:
// missing export, not a syntax error in this file. Run `node --test test/claude-session.test.mjs`
// from `impl/` (node 25) to confirm.
//
// Every test below drives the REAL ClaudeSessionCli against the REAL fake `claude` binary
// (test/fixtures/fake-claude.mjs, spawned as `node <fixture>`) — zero model quota, no vendor CLI is
// ever invoked. Assertions target EFFECTS (same pid across turns, actual process death, wire content
// echoed back, argv shape) rather than bare Ack return values, per house rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ClaudeSessionCli, buildClaudeSessionArgs } from '../src/claude-session.mjs';
import { assertIsAdapter } from '../src/adapter.mjs';

const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));

function makeCli(opts = {}) {
  return new ClaudeSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE], ...opts });
}

function brief(goal) {
  return {
    goal,
    constraints: [],
    pathScope: ['src/**'],
    definitionOfDone: 'tests pass',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 1, wallMin: 10 },
  };
}

/** Event bus harness: buffers every event and lets tests await the first matching one. */
function harness(cliOpts = {}) {
  const cli = makeCli(cliOpts);
  const events = [];
  const waiters = [];
  cli.onEvent((e) => {
    events.push(e);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].pred(e)) { const w = waiters[i]; waiters.splice(i, 1); w.resolve(e); }
    }
  });
  function waitFor(pred, timeoutMs = 4000) {
    const already = events.find(pred);
    if (already) return Promise.resolve(already);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`waitFor timeout after ${timeoutMs}ms; seen kinds: ${events.map((e) => e.kind).join(',')}`)), timeoutMs);
      waiters.push({ pred, resolve: (e) => { clearTimeout(t); resolve(e); } });
    });
  }
  function waitForKind(kind, timeoutMs) { return waitFor((e) => e.kind === kind, timeoutMs); }
  return { cli, events, waitFor, waitForKind };
}

// ---------------------------------------------------------------------------
// CS1 — pure argv builder (no process spawned)
// ---------------------------------------------------------------------------

test('CS1: buildClaudeSessionArgs always includes the stream-json trio; adds permission-prompt-tool stdio only when approvals; adds --resume only when sessionId given', () => {
  const base = buildClaudeSessionArgs({});
  assert.ok(base.includes('--input-format') && base.includes('--output-format') && base.includes('--verbose'));
  assert.ok(base[base.indexOf('--input-format') + 1] === 'stream-json');
  assert.ok(base[base.indexOf('--output-format') + 1] === 'stream-json');
  assert.ok(!base.includes('--permission-prompt-tool'), 'no approvals => no permission-prompt-tool flag');
  assert.ok(!base.includes('--resume'));

  const withApprovals = buildClaudeSessionArgs({ approvals: true });
  const idx = withApprovals.indexOf('--permission-prompt-tool');
  assert.ok(idx !== -1);
  assert.equal(withApprovals[idx + 1], 'stdio', 'the magic value confirmed from the Agent SDK source, not an arbitrary tool name');

  const withResume = buildClaudeSessionArgs({ sessionId: 'sess-123' });
  const ridx = withResume.indexOf('--resume');
  assert.ok(ridx !== -1);
  assert.equal(withResume[ridx + 1], 'sess-123');
});

test('CS1 erratum E1: a permission mode is ALWAYS rendered by default (acceptEdits, one-shot parity) — without one a live worker cannot edit files at all (proven live 2026-07-10: Write denied, probe.txt never created)', () => {
  const base = buildClaudeSessionArgs({});
  const pidx = base.indexOf('--permission-mode');
  assert.ok(pidx !== -1, 'default argv must carry --permission-mode; its absence was a live-breaking gap');
  assert.equal(base[pidx + 1], 'acceptEdits', 'parity with the proven one-shot ClaudeCli argv');

  const custom = buildClaudeSessionArgs({ permissionMode: 'bypassPermissions' });
  assert.equal(custom[custom.indexOf('--permission-mode') + 1], 'bypassPermissions');

  const none = buildClaudeSessionArgs({ permissionMode: null });
  assert.ok(!none.includes('--permission-mode'), 'explicit null opts out (caller supplies its own policy flags)');

  const both = buildClaudeSessionArgs({ approvals: true });
  assert.ok(both.includes('--permission-mode') && both.includes('--permission-prompt-tool'),
    'approvals and permission mode compose: acceptEdits auto-allows worktree edits, everything else routes to approve()');
});

test('conforms to the D1 8-verb session-shaped Adapter contract', () => {
  assert.doesNotThrow(() => assertIsAdapter(makeCli()));
});

test('constructor is testability-injectable: cmd/args/env override the real "claude" defaults', () => {
  const real = new ClaudeSessionCli({});
  assert.equal(real._cfg.cmd, 'claude', 'default cmd targets the real vendor binary');
  const fake = makeCli();
  assert.equal(fake._cfg.cmd, process.execPath);
  assert.deepEqual(fake._cfg.args, [FAKE_CLAUDE]);
});

// ---------------------------------------------------------------------------
// CS18/CS19 — card() capability negotiation, no silent emulation
// ---------------------------------------------------------------------------

test('CS18: card().verbs.approve/answer are unsupported by default and native only with approvals:true', () => {
  const noApprovals = makeCli().card();
  assert.equal(noApprovals.verbs.approve, 'unsupported');
  assert.equal(noApprovals.verbs.answer, 'unsupported');
  const withApprovals = makeCli({ approvals: true }).card();
  assert.equal(withApprovals.verbs.approve, 'native');
  assert.equal(withApprovals.verbs.answer, 'native');
});

test('card declares steer as NATIVE (erratum E2: mid-turn stream-json injection is real) and everything else native too', () => {
  const card = makeCli().card();
  assert.equal(card.verbs.steer, 'native',
    'live-disproven premise: CS8 assumed no way to splice content into an in-flight completion; the real CLI absorbs a mid-turn user frame at the next tool boundary');
  assert.equal(card.verbs.spawn, 'native');
  assert.equal(card.verbs.prompt, 'native');
  assert.equal(card.verbs.interrupt, 'native');
  assert.equal(card.verbs.kill, 'native');
  assert.deepEqual(card.governance, {
    usage: { tokens: 'native', usd: 'native', tokenMetric: 'anthropic_input_plus_output_tokens_excluding_cache', terminalSeal: 'native' },
    providerCalls: { observation: 'native', enforcement: 'unavailable' },
    toolCalls: { observation: 'native', enforcement: 'unavailable' },
    maxWireFrameBytes: 1024 * 1024,
  });
});

// ---------------------------------------------------------------------------
// CS2/CS3/CS4/CS5 — spawn: Brief as first turn, real session_id, honest turn-boundary lifecycle
// ---------------------------------------------------------------------------

test('CS2/CS3: spawn delivers the Brief as the first turn; lifecycle.spawned carries the WIRE session_id, not a client-generated one', async () => {
  const { cli, events, waitForKind } = harness();
  const w = 'w1';
  const ack = await cli.spawn(w, brief('add rate limiting to the login route'), { worktree: process.cwd() });
  assert.equal(ack.ok, true);

  const spawned = await waitForKind('lifecycle.spawned');
  assert.equal(spawned.worker, w);
  assert.ok(spawned.payload.sessionId, 'session_id came from the wire system/init frame');
  assert.ok(spawned.payload.pid > 0);

  const started = await waitForKind('lifecycle.turn_started');
  assert.equal(started.worker, w);

  const message = await waitForKind('content.message');
  assert.match(message.payload.text, /add rate limiting to the login route/, 'the Brief text was actually delivered on the wire, not just claimed');

  const completed = await waitForKind('lifecycle.turn_completed');
  assert.equal(completed.worker, w);
  assert.equal(completed.payload.pid, spawned.payload.pid, 'same process for spawn as for the session lifecycle event');
  assert.deepEqual(completed.payload.usageSeal.tokens, 'reported');
  assert.deepEqual(completed.payload.usageSeal.usd, 'reported');
  const usage = events.find((event) => event.kind === 'resource.tokens');
  assert.ok(usage && events.indexOf(usage) < events.indexOf(completed));
  assert.equal(usage.payload.counterId, completed.payload.usageSeal.counterId);

  await cli.kill(w);
  await waitForKind('kill.confirmed');
});

test('Phase 60: resume attachOnly performs the native handshake but emits no turn or provider work before prompt()', async () => {
  const { cli, events, waitForKind } = harness();
  const w = 'phase60-claude-attach';
  try {
    const ack = await cli.spawn(w, brief('HOLD_UNTIL_INTERRUPT must not be delivered during attach'), {
      worktree: process.cwd(),
      session: { mode: 'resume', id: 'phase60-claude-native' },
      attachOnly: true,
    });
    assert.equal(ack.ok, true);
    const spawned = await waitForKind('lifecycle.spawned');
    assert.equal(spawned.payload.sessionId, 'phase60-claude-native');

    await new Promise((resolve) => setTimeout(resolve, 150));
    const forbidden = new Set([
      'lifecycle.turn_started', 'resource.provider_call', 'content.tool_call',
      'content.file_edit', 'content.message', 'lifecycle.turn_completed',
    ]);
    assert.deepEqual(events.filter((event) => forbidden.has(event.kind)).map((event) => event.kind), [],
      'attach-only recovery must not deliver the Brief or begin provider work');

    const prompt = await cli.prompt(w, 'phase60 continuation after durable attach', 'turn');
    assert.equal(prompt.ok, true);
    await waitForKind('lifecycle.turn_started');
    const completed = await waitForKind('lifecycle.turn_completed');
    assert.match(completed.payload.result.summary, /phase60 continuation after durable attach/u);
  } finally {
    try { await cli.kill(w); } catch { /* RED cleanup */ }
  }
});

test('Phase 60: attachOnly refuses a non-resume session before creating a provider process', async () => {
  const { cli, events } = harness();
  for (const mode of ['new', 'fork']) {
    const w = `phase60-claude-invalid-attach-${mode}`;
    try {
      const ack = await cli.spawn(w, brief('must not run'), {
        worktree: process.cwd(), session: { mode, ...(mode === 'fork' ? { id: 'parent' } : {}) }, attachOnly: true,
      });
      assert.equal(ack.ok, false);
      assert.equal(ack.code, 'attach_only_requires_resume');
      assert.equal(events.some((event) => event.worker === w && event.kind === 'lifecycle.process_started'), false);
    } finally {
      try { await cli.kill(w); } catch { /* RED cleanup */ }
    }
  }
});

// ---------------------------------------------------------------------------
// CS6/CS7 — multi-turn on ONE process; prompt(turn/nudge) is native (no emulated flag)
// ---------------------------------------------------------------------------

test('CS6: two prompt() calls produce two turn_completed events on the SAME child pid (multi-turn, no respawn)', async () => {
  const { cli, waitFor, waitForKind } = harness();
  const w = 'w1';
  await cli.spawn(w, brief('turn one'), { worktree: process.cwd() });
  const first = await waitForKind('lifecycle.turn_completed');

  const ack = await cli.prompt(w, 'turn two content', 'turn');
  assert.equal(ack.ok, true);
  assert.ok(!ack.emulated, 'CS7/CS19: a plain turn-mode prompt is native, never silently emulated');

  const second = await waitFor((e) => e.kind === 'lifecycle.turn_completed' && e !== first, 4000);
  assert.notEqual(second, first);
  assert.equal(second.payload.pid, first.payload.pid, 'the effect that proves ONE persistent process handled both turns');

  await cli.kill(w);
  await waitForKind('kill.confirmed');
});

test('CS7: prompt mode "nudge" also writes natively; sent while idle it begins the next turn (sent mid-turn it would be absorbed — see the CS8/E2 steer tests)', async () => {
  const { cli, waitFor, waitForKind } = harness();
  const w = 'w1';
  await cli.spawn(w, brief('t1'), { worktree: process.cwd() });
  const firstCompleted = await waitForKind('lifecycle.turn_completed');

  const ack = await cli.prompt(w, 'nudge content here', 'nudge');
  assert.equal(ack.ok, true);
  assert.ok(!ack.emulated);
  // Match the NUDGED content specifically — turn 1 already produced an (unrelated) content.message.
  const message = await waitFor((e) => e.kind === 'content.message' && /nudge content here/.test(e.payload.text ?? ''), 4000);
  assert.ok(message);
  const completed = await waitFor((e) => e.kind === 'lifecycle.turn_completed' && e !== firstCompleted, 4000);
  assert.ok(completed);

  await cli.kill(w);
  await waitForKind('kill.confirmed');
});

// ---------------------------------------------------------------------------
// CS8 (erratum E2) — steer: NATIVE mid-turn injection. The running turn absorbs the frame at
// its next boundary; no interrupt round-trip, no aborted tool call, one terminal per turn.
// ---------------------------------------------------------------------------

test('CS8/E2: prompt(mode:"steer") injects into the IN-FLIGHT turn natively — the running turn absorbs it and completes redirected, with NO interrupt round-trip', async () => {
  const { cli, events, waitForKind } = harness();
  const w = 'w1';
  await cli.spawn(w, brief('HOLD_UNTIL_INTERRUPT'), { worktree: process.cwd() });
  const spawned = await waitForKind('lifecycle.spawned');
  await waitForKind('content.message'); // "holding..." — proves the first turn is genuinely in flight

  const ack = await cli.prompt(w, 'steer: do the other thing instead', 'steer');
  assert.equal(ack.ok, true);
  assert.ok(!ack.emulated, 'steer is native on this wire now — no emulation flag');

  const completed = await waitForKind('lifecycle.turn_completed', 4000);
  assert.equal(completed.payload.pid, spawned.payload.pid, 'steer redirected the SAME session, no respawn');
  assert.match(completed.payload.result?.summary ?? '', /steered-to:.*do the other thing instead/,
    'the RUNNING turn absorbed the steer content (live-observed semantics), not a fresh turn after an interrupt');

  const kinds = events.map((e) => e.kind);
  assert.ok(!kinds.includes('control.interrupt_requested'), 'no phantom interrupt in the log for a steer');
  assert.ok(!kinds.includes('control.interrupt_confirmed'), 'a steer must not satisfy a racing stop-waiter');
  assert.ok(kinds.includes('control.steer'), 'the steer itself is an explicit orchestrator-actor event');
  assert.equal(kinds.filter((k) => k === 'lifecycle.turn_started').length, 1,
    'the absorbed frame does NOT fake a second turn_started — one turn, one start, one terminal');

  await cli.kill(w);
  await waitForKind('kill.confirmed');
});

test('CS8/E2: steer when NO turn is in flight simply begins the next turn (wire truth: same user frame either way)', async () => {
  const { cli, waitFor, waitForKind } = harness();
  const w = 'w1';
  await cli.spawn(w, brief('t1'), { worktree: process.cwd() });
  const first = await waitForKind('lifecycle.turn_completed');

  const ack = await cli.prompt(w, 'steer while idle', 'steer');
  assert.equal(ack.ok, true);
  const completed = await waitFor((e) => e.kind === 'lifecycle.turn_completed' && e !== first, 4000);
  assert.match(completed.payload.result?.summary ?? '', /steer while idle/);

  await cli.kill(w);
  await waitForKind('kill.confirmed');
});

// ---------------------------------------------------------------------------
// CS9/CS10/CS11 — interrupt: exact frame, session survives, interrupted turn's result is discarded
// ---------------------------------------------------------------------------

test('CS9/CS10: interrupt() Acks immediately (native, not a signal); confirmed stop is a LATER event; the session survives for a follow-up prompt', async () => {
  const { cli, events, waitForKind } = harness();
  const w = 'w1';
  await cli.spawn(w, brief('HOLD_UNTIL_INTERRUPT'), { worktree: process.cwd() });
  const spawned = await waitForKind('lifecycle.spawned');
  await waitForKind('content.message');

  const ack = await cli.interrupt(w);
  assert.equal(ack.ok, true);
  assert.ok(!ack.emulated, 'a real control_request, not a signal — native');

  const confirmed = await waitForKind('control.interrupt_confirmed');
  assert.equal(confirmed.worker, w);
  assert.equal(confirmed.payload.usageSeal.tokens, 'reported', 'the interrupted result is accounted before confirmation');
  assert.equal(confirmed.payload.usageSeal.usd, 'reported');
  const usage = events.find((event) => event.kind === 'resource.tokens');
  assert.ok(usage && events.indexOf(usage) < events.indexOf(confirmed));
  assert.equal(usage.payload.counterId, confirmed.payload.usageSeal.counterId);

  // Session survives: a normal follow-up prompt completes successfully on the SAME pid.
  await cli.prompt(w, 'still alive?', 'turn');
  const completed = await waitForKind('lifecycle.turn_completed', 4000);
  assert.equal(completed.payload.pid, spawned.payload.pid);

  await cli.kill(w);
  await waitForKind('kill.confirmed');
});

test('CS11: the interrupted turn never produces a lifecycle.turn_completed of its own (single-terminal-per-turn: interrupt_confirmed IS the terminal)', async () => {
  const { cli, events, waitForKind } = harness();
  const w = 'w1';
  await cli.spawn(w, brief('HOLD_UNTIL_INTERRUPT'), { worktree: process.cwd() });
  await waitForKind('content.message');
  await cli.interrupt(w);
  await waitForKind('control.interrupt_confirmed');

  // Give the (discarded) trailing result frame time to have arrived and been processed.
  await new Promise((r) => setTimeout(r, 150));
  const completedBeforeNextTurn = events.filter((e) => e.kind === 'lifecycle.turn_completed');
  assert.equal(completedBeforeNextTurn.length, 0, 'the fake binary emits a result for the interrupted turn; the adapter MUST discard it, not surface it as completed');

  await cli.kill(w);
  await waitForKind('kill.confirmed');
});

// ---------------------------------------------------------------------------
// CS12 — approve(): approval.requested -> approve() -> control_response; denial does not crash the turn
// ---------------------------------------------------------------------------

test('CS12: approve("allow") round-trips a real can_use_tool control_request/control_response and the turn completes reflecting the allow', async () => {
  const { cli, waitForKind } = harness({ approvals: true });
  const w = 'w1';
  await cli.spawn(w, brief('REQUEST_APPROVAL:Bash'), { worktree: process.cwd() });

  const requested = await waitForKind('approval.requested');
  assert.equal(requested.worker, w);
  assert.ok(requested.payload.requestId);
  assert.equal(requested.payload.toolName, 'Bash');

  const ack = await cli.approve(w, requested.payload.requestId, 'allow', { updatedInput: { command: 'echo hi' } });
  assert.equal(ack.ok, true);

  const resolved = await waitForKind('approval.resolved');
  assert.equal(resolved.payload.decision, 'allow');

  const completed = await waitForKind('lifecycle.turn_completed', 4000);
  assert.match(completed.payload.result?.summary ?? JSON.stringify(completed.payload), /approved:Bash/,
    'the fake validates updatedInput+toolUseID (erratum E3) — reaching approved: proves the full live-honored shape went out');

  await cli.kill(w);
  await waitForKind('kill.confirmed');
});

test('CS12 erratum E3 regression: approve("allow") with NO payload falls back to the ORIGINAL request input and echoes toolUseID — a bare {behavior:"allow"} is silently re-asked by the real CLI (live-caught wedge, 2026-07-10)', async () => {
  const { cli, events, waitForKind } = harness({ approvals: true });
  const w = 'w1';
  await cli.spawn(w, brief('REQUEST_APPROVAL:Bash'), { worktree: process.cwd() });
  const requested = await waitForKind('approval.requested');
  assert.ok(requested.payload.toolUseID, 'the wire tool_use_id is surfaced so callers can correlate');

  const ack = await cli.approve(w, requested.payload.requestId, 'allow'); // no payload at all
  assert.equal(ack.ok, true);

  const completed = await waitForKind('lifecycle.turn_completed', 4000);
  assert.match(completed.payload.result?.summary ?? '', /approved:Bash/,
    'an allow without updatedInput/toolUseID would have been re-asked and then failed approval-invalid');
  const echo = events.find((e) => e.kind === 'content.message' && /ran Bash with/.test(e.payload.text ?? ''));
  assert.match(echo.payload.text, /"command":"echo hi"/, 'the ORIGINAL request input was echoed back as updatedInput');
  assert.equal(events.filter((e) => e.kind === 'approval.requested').length, 1, 'exactly one ask — no silent re-ask loop');

  await cli.kill(w);
  await waitForKind('kill.confirmed');
});

test('CS12: approve("deny") does NOT crash the turn — it completes normally, reflecting the denial', async () => {
  const { cli, events, waitForKind } = harness({ approvals: true });
  const w = 'w1';
  await cli.spawn(w, brief('REQUEST_APPROVAL:Write'), { worktree: process.cwd() });
  const requested = await waitForKind('approval.requested');

  await cli.approve(w, requested.payload.requestId, 'deny', { message: 'not allowed here' });

  const completed = await waitForKind('lifecycle.turn_completed', 4000);
  assert.match(completed.payload.result?.summary ?? JSON.stringify(completed.payload), /denied:Write/);
  assert.equal(events.filter((e) => e.kind === 'lifecycle.crashed').length, 0, 'a tool denial is not a process crash');

  await cli.kill(w);
  await waitForKind('kill.confirmed');
});

test('approve() without approvals enabled rejects without touching the wire', async () => {
  const cli = makeCli({ approvals: false });
  const ack = await cli.approve('w1', 'req_1', 'allow');
  assert.equal(ack.ok, false);
});

// ---------------------------------------------------------------------------
// CS13 — answer(): question.asked -> answer() -> the turn reflects the answer
// ---------------------------------------------------------------------------

test('CS13: answer() round-trips an elicitation control_request and the turn reflects the free-form answer', async () => {
  const { cli, waitForKind } = harness({ approvals: true });
  const w = 'w1';
  await cli.spawn(w, brief('REQUEST_QUESTION please pick a color'), { worktree: process.cwd() });

  const asked = await waitForKind('question.asked');
  assert.equal(asked.worker, w);
  assert.ok(asked.payload.requestId);

  const ack = await cli.answer(w, asked.payload.requestId, { text: 'blue' });
  assert.equal(ack.ok, true);

  const answered = await waitForKind('question.answered');
  assert.equal(answered.payload.text, 'blue');

  const completed = await waitForKind('lifecycle.turn_completed', 4000);
  assert.match(completed.payload.result?.summary ?? JSON.stringify(completed.payload), /blue/);

  await cli.kill(w);
  await waitForKind('kill.confirmed');
});

// ---------------------------------------------------------------------------
// CS14 — kill(): process-group SIGTERM->SIGKILL escalation, always resolves
// ---------------------------------------------------------------------------

test('CS14: kill() ends an unresponsive process by escalating SIGTERM to SIGKILL within killGraceMs (never hangs)', async () => {
  const { cli, waitForKind } = harness({ killGraceMs: 60, env: { FAKE_CLAUDE_IGNORE_SIGTERM: '1' } });
  const w = 'w1';
  await cli.spawn(w, brief('HOLD_UNTIL_INTERRUPT'), { worktree: process.cwd() });
  await waitForKind('content.message');

  const started = Date.now();
  const ack = await cli.kill(w);
  assert.equal(ack.ok, true, 'D9: kill() always resolves');

  const confirmed = await waitForKind('kill.confirmed', 3000);
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 60, 'the SIGKILL escalation genuinely waited out the grace window, not an instant kill');
  assert.equal(confirmed.worker, w);
  assert.deepEqual(confirmed.payload.usageSeal, { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null });
});

test('CS14: kill() on a cooperative process confirms promptly via plain SIGTERM (no escalation needed)', async () => {
  const { cli, waitForKind } = harness({ killGraceMs: 5000 });
  const w = 'w1';
  await cli.spawn(w, brief('HOLD_UNTIL_INTERRUPT'), { worktree: process.cwd() });
  await waitForKind('content.message');
  const started = Date.now();
  await cli.kill(w);
  await waitForKind('kill.confirmed', 2000);
  assert.ok(Date.now() - started < 4000, 'a cooperative process should not need to wait out the full escalation window');
});

// ---------------------------------------------------------------------------
// CS15 — resume: constructor sessionId -> --resume, echoed back on the wire
// ---------------------------------------------------------------------------

test('CS15: constructor sessionId round-trips through --resume to the SAME session_id on the wire', async () => {
  const { cli, waitForKind } = harness({ sessionId: 'resume-me-0001' });
  const w = 'w1';
  await cli.spawn(w, brief('anything'), { worktree: process.cwd() });
  const spawned = await waitForKind('lifecycle.spawned');
  assert.equal(spawned.payload.sessionId, 'resume-me-0001');

  await cli.kill(w);
  await waitForKind('kill.confirmed');
});

// ---------------------------------------------------------------------------
// CS16/CS17 — lifecycle: session death mapping, no events after death
// ---------------------------------------------------------------------------

test('CS17: a genuine vendor process failure maps to lifecycle.crashed (distinct from a graceful kill)', async () => {
  const { cli, waitForKind } = harness();
  const w = 'w1';
  await cli.spawn(w, brief('TRIGGER_CRASH'), { worktree: process.cwd() });
  const crashed = await waitForKind('lifecycle.crashed', 3000);
  assert.equal(crashed.worker, w);
  assert.deepEqual(crashed.payload.usageSeal, { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null });
});

test('CS16: no event is ever emitted for a worker after its session-terminal event fires', async () => {
  const { cli, events, waitForKind } = harness();
  const w = 'w1';
  await cli.spawn(w, brief('t1'), { worktree: process.cwd() });
  await waitForKind('lifecycle.turn_completed');
  await cli.kill(w);
  await waitForKind('kill.confirmed');

  const countAtDeath = events.length;
  // Nothing left alive to emit anything, but assert the invariant explicitly: a late, deliberately
  // sent stray frame the adapter might still be holding a reference to must not surface.
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(events.length, countAtDeath, 'no event arrived after the session-terminal event');
});
