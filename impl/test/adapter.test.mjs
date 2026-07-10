// Cluster 2 (Workers & Trust) — adapter.mjs test suite.
// Covers MockAdapter determinism/scriptability and SubprocessAdapter-family guard
// behavior (structural only — no live CLI is ever invoked; BATON_ALLOW_LIVE_ADAPTERS
// is never set to "1" anywhere in this file).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MockAdapter,
  CodexAdapter,
  ClaudeAdapter,
  GlmAdapter,
  assertIsAdapter,
  AdapterCrashError,
  renderBrief,
} from '../src/adapter.mjs';

// ---------- helpers ----------

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8' });
}

/** A real, initialized git repo with one base commit. Used directly as a worker's worktree. */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'baton-test-'));
  sh('git', ['init', '-q'], dir);
  sh('git', ['config', 'user.email', 'test@example.com'], dir);
  sh('git', ['config', 'user.name', 'Baton Test'], dir);
  sh('git', ['commit', '--allow-empty', '-q', '-m', 'base'], dir);
  return dir;
}

function commitCount(dir) {
  return sh('git', ['log', '--oneline'], dir).trim().split('\n').filter(Boolean).length;
}

function lastCommitMessage(dir) {
  return sh('git', ['log', '-1', '--pretty=%B'], dir);
}

function makeBrief(overrides = {}) {
  return {
    goal: 'make done.txt exist',
    constraints: [],
    pathScope: [],
    definitionOfDone: 'done.txt exists and contains "ok"',
    verification: { command: 'test -f done.txt', expectExit: 0 },
    budget: { tokens: 1000, usd: 1, wallMin: 10 },
    ...overrides,
  };
}

function makeOpts(worktree, overrides = {}) {
  return {
    worktree,
    timeoutMs: 20000,
    workerId: 'w1',
    turnEpoch: 1,
    ...overrides,
  };
}

function stubLog() {
  const events = [];
  return { events, log: { append: (e) => { events.push(e); return e; } } };
}

// ============================================================
// card() / assertIsAdapter — behaviors 1-2
// ============================================================

test('card() returns a well-formed HarnessCard for all four adapters', () => {
  const mock = new MockAdapter({ scenario: { outcome: 'completed' } });
  for (const [name, adapter] of [
    ['mock', mock],
    ['codex', new CodexAdapter()],
    ['claude', new ClaudeAdapter()],
    ['glm', new GlmAdapter()],
  ]) {
    const card = adapter.card();
    assert.equal(typeof card.harness, 'string', `${name}.harness`);
    assert.equal(typeof card.version, 'string', `${name}.version`);
    assert.ok(['subscription', 'api_key'].includes(card.authPosture), `${name}.authPosture`);
    assert.ok(Number.isInteger(card.concurrencyCeiling) && card.concurrencyCeiling > 0, `${name}.concurrencyCeiling`);
    assert.ok(Number.isInteger(card.maxContext) && card.maxContext > 0, `${name}.maxContext`);
    assert.equal(typeof card.verbs, 'object', `${name}.verbs`);
    assert.ok('spawn' in card.verbs, `${name}.verbs.spawn required`);
    assert.ok('interrupt' in card.verbs, `${name}.verbs.interrupt required`);
  }
  assert.equal(new GlmAdapter().card().concurrencyCeiling, 1, 'GLM Pro concurrency ceiling is hard-pinned to 1');
});

test('assertIsAdapter accepts real adapters and rejects malformed duck-types', () => {
  assert.doesNotThrow(() => assertIsAdapter(new MockAdapter({ scenario: { outcome: 'completed' } })));
  assert.doesNotThrow(() => assertIsAdapter(new CodexAdapter()));
  assert.doesNotThrow(() => assertIsAdapter(new ClaudeAdapter()));
  assert.doesNotThrow(() => assertIsAdapter(new GlmAdapter()));

  assert.throws(() => assertIsAdapter({}), TypeError);
  assert.throws(() => assertIsAdapter({ card() {} }), TypeError, 'missing run()');
  assert.throws(() => assertIsAdapter(null), TypeError);
});

// ============================================================
// MockAdapter.run — basic outcomes — behaviors 3-4
// ============================================================

test('MockAdapter.run outcome:"completed" writes scripted edits as real files and creates a real git commit', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'done.txt', content: 'ok' }],
    authorName: 'Mock Worker',
    authorEmail: 'mock@baton.local',
  };
  const adapter = new MockAdapter({ scenario });
  const result = await adapter.run(makeBrief(), makeOpts(dir));

  assert.equal(result.status, 'completed');
  assert.ok(existsSync(join(dir, 'done.txt')));
  assert.equal(readFileSync(join(dir, 'done.txt'), 'utf8'), 'ok');
  assert.ok(commitCount(dir) >= 2, 'a new commit beyond the base commit exists');
  const author = sh('git', ['log', '-1', '--pretty=%an <%ae>'], dir).trim();
  assert.equal(author, 'Mock Worker <mock@baton.local>');
});

test('MockAdapter.run outcome:"failed" still applies and commits real (if wrong) work', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = { outcome: 'failed', edits: [{ path: 'wrong.txt', content: 'oops' }] };
  const adapter = new MockAdapter({ scenario });
  const result = await adapter.run(makeBrief(), makeOpts(dir));

  assert.equal(result.status, 'failed');
  assert.ok(existsSync(join(dir, 'wrong.txt')), 'edits are committed even on a failed outcome');
  assert.ok(commitCount(dir) >= 2);
});

// ============================================================
// blocked without blocker — behavior 5
// ============================================================

test('MockAdapter.run outcome:"blocked" with no blocker set rejects with a TypeError (validated at run() entry)', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = { outcome: 'blocked' /* no blocker */ };
  const adapter = new MockAdapter({ scenario });
  await assert.rejects(() => adapter.run(makeBrief(), makeOpts(dir)), TypeError);
});

// ============================================================
// forgeSuccess — behavior 6 (the trust-gate's raw material)
// ============================================================

test('scenario.forgeSuccess forces status:"completed" and claimedExit===expectExit regardless of the real outcome', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // outcome is "failed" and the edits never create done.txt — the pinned check
  // (`test -f done.txt`) would genuinely fail if run. forgeSuccess makes the WORKER
  // claim victory anyway; catching this divergence is referee.mjs's job.
  const brief = makeBrief();
  const scenario = {
    outcome: 'failed',
    forgeSuccess: true,
    edits: [{ path: 'unrelated.txt', content: 'not done.txt' }],
  };
  const adapter = new MockAdapter({ scenario });
  const result = await adapter.run(brief, makeOpts(dir));

  assert.equal(result.status, 'completed', 'the mock lies about status');
  assert.equal(result.verification.claimedExit, brief.verification.expectExit, 'the mock lies about the claimed exit code');
  assert.ok(existsSync(join(dir, 'unrelated.txt')), 'the scripted edits are still the real, honest disk content');
  assert.ok(!existsSync(join(dir, 'done.txt')), 'done.txt was never actually created — the check would really fail');
});

// ============================================================
// determinism — behavior 7
// ============================================================

test('MockAdapter is deterministic: same scenario replayed in two fresh worktrees yields matching results and identical file content', async (t) => {
  const dir1 = makeRepo();
  const dir2 = makeRepo();
  t.after(() => { rmSync(dir1, { recursive: true, force: true }); rmSync(dir2, { recursive: true, force: true }); });

  const scenario = {
    outcome: 'completed',
    edits: [
      { path: 'a.txt', content: 'alpha' },
      { path: 'b.txt', content: 'beta' },
    ],
    summary: 'did the thing',
    budgetUsed: { tokens: 42, usd: 0.01 },
  };
  const adapter1 = new MockAdapter({ scenario });
  const adapter2 = new MockAdapter({ scenario });

  const r1 = await adapter1.run(makeBrief(), makeOpts(dir1));
  const r2 = await adapter2.run(makeBrief(), makeOpts(dir2));

  // Commit SHAs are inherently worktree/repo-specific (different base commit identity per
  // temp repo) so they are excluded from the structural comparison; everything else —
  // including file content — must match byte-for-byte.
  const strip = (r) => {
    const clone = structuredClone(r);
    delete clone.artifacts.commits;
    delete clone.artifacts.diffRef;
    return clone;
  };
  assert.deepEqual(strip(r1), strip(r2));
  assert.equal(readFileSync(join(dir1, 'a.txt'), 'utf8'), readFileSync(join(dir2, 'a.txt'), 'utf8'));
  assert.equal(readFileSync(join(dir1, 'b.txt'), 'utf8'), readFileSync(join(dir2, 'b.txt'), 'utf8'));
});

// ============================================================
// mid-run interrupt — behavior 8
// ============================================================

test('mid-run interrupt: aborting after the first edit lands but before the second commits exactly 1/3 and cancels', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const ac = new AbortController();
  const scenario = {
    outcome: 'completed',
    edits: [
      { path: 'a.txt', content: 'a', delayMs: 5 },
      { path: 'b.txt', content: 'b', delayMs: 5000 },
      { path: 'c.txt', content: 'c', delayMs: 5000 },
    ],
  };
  const adapter = new MockAdapter({ scenario });
  let editCount = 0;
  const log = {
    append(e) {
      if (e.kind === 'action.file_edit') {
        editCount += 1;
        if (editCount === 1) ac.abort();
      }
      return e;
    },
  };

  const result = await adapter.run(makeBrief(), makeOpts(dir, { signal: ac.signal, log }));

  assert.equal(result.status, 'cancelled');
  assert.equal(result.progress, 1 / 3);
  assert.ok(existsSync(join(dir, 'a.txt')));
  assert.ok(!existsSync(join(dir, 'b.txt')));
  assert.ok(!existsSync(join(dir, 'c.txt')));
});

// ============================================================
// interrupt races completion — behavior 9
// ============================================================

test('interrupt racing natural completion (delayMs:0, immediate abort) always yields a well-formed result, never a hang or malformed object', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const ac = new AbortController();
  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'a.txt', content: 'a', delayMs: 0 }],
  };
  const adapter = new MockAdapter({ scenario });
  const runPromise = adapter.run(makeBrief(), makeOpts(dir, { signal: ac.signal }));
  ac.abort();

  const result = await runPromise;
  assert.ok(['cancelled', 'completed'].includes(result.status), 'one of the two well-defined outcomes');
  assert.equal(typeof result.progress, 'number');
  assert.equal(typeof result.summary, 'string');
  assert.ok(result.artifacts && Array.isArray(result.artifacts.files));
  assert.ok(result.verification && typeof result.verification.command === 'string');
});

// ============================================================
// blocking ask — behaviors 10-12
// ============================================================

test('blocking ask, answered: run() does not settle before onAsk resolves; post-answer edits apply after', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'before.txt', content: 'before' }],
    ask: {
      question: 'proceed?',
      blocking: true,
      afterEditIndex: 1,
      onAnswerEdits: [{ path: 'after.txt', content: 'after' }],
    },
  };
  const adapter = new MockAdapter({ scenario });

  let onAskResolvedAt = null;
  const onAsk = async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    onAskResolvedAt = Date.now();
    return { decision: 'yes' };
  };

  const result = await adapter.run(makeBrief(), makeOpts(dir, { onAsk }));
  assert.ok(onAskResolvedAt !== null, 'run() must have awaited onAsk before settling');
  assert.equal(result.status, 'completed');
  assert.ok(existsSync(join(dir, 'before.txt')));
  assert.ok(existsSync(join(dir, 'after.txt')), 'onAnswerEdits applied after the answer arrived');
});

test('blocking ask, never answered: run() never settles until interrupted, then cancels promptly', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const ac = new AbortController();
  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'before.txt', content: 'before' }],
    ask: { question: 'proceed?', blocking: true, afterEditIndex: 1 },
  };
  const adapter = new MockAdapter({ scenario });

  const runPromise = adapter.run(makeBrief(), makeOpts(dir, { signal: ac.signal }));
  let settled = false;
  runPromise.then(() => { settled = true; }, () => { settled = true; });

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(settled, false, 'an unanswered blocking ask with no onAsk must not let run() settle on its own');

  ac.abort();
  const result = await runPromise;
  assert.equal(result.status, 'cancelled');
});

test('non-blocking ask: run() proceeds to completion without waiting, but still emits the ask event', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'done.txt', content: 'ok' }],
    ask: { question: 'fyi', blocking: false, afterEditIndex: 0 },
  };
  const adapter = new MockAdapter({ scenario });
  const { events, log } = stubLog();

  const result = await adapter.run(makeBrief(), makeOpts(dir, { log }));
  assert.equal(result.status, 'completed');
  const askEvent = events.find((e) => e.kind === 'approval.requested' || (e.payload && e.payload.question === 'fyi'));
  assert.ok(askEvent, 'the ask event is still emitted even though nothing waited on it');
});

// ============================================================
// crash — behaviors 13-14
// ============================================================

test('crash: rejects with AdapterCrashError carrying workerId, and commits nothing past the crash point', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'a.txt', content: 'a', delayMs: 5000 }],
    crashAfterMs: 5,
  };
  const adapter = new MockAdapter({ scenario });

  await assert.rejects(
    () => adapter.run(makeBrief(), makeOpts(dir, { workerId: 'w-crash' })),
    (err) => {
      assert.ok(err instanceof AdapterCrashError);
      assert.equal(err.workerId, 'w-crash');
      return true;
    },
  );
  assert.ok(!existsSync(join(dir, 'a.txt')), 'the edit scheduled after the crash point never landed');
  assert.equal(commitCount(dir), 1, 'only the base commit exists — no fake completion commit');
});

test('crash and a "failed" WorkerResult are distinguishable failure channels', async (t) => {
  const crashDir = makeRepo();
  const failDir = makeRepo();
  t.after(() => { rmSync(crashDir, { recursive: true, force: true }); rmSync(failDir, { recursive: true, force: true }); });

  const crashAdapter = new MockAdapter({ scenario: { outcome: 'completed', crashAfterMs: 1, edits: [{ path: 'x', content: 'x', delayMs: 5000 }] } });
  const failAdapter = new MockAdapter({ scenario: { outcome: 'failed' } });

  let crashPathHit = false;
  try {
    await crashAdapter.run(makeBrief(), makeOpts(crashDir));
    assert.fail('expected a rejection');
  } catch (err) {
    assert.ok(err instanceof AdapterCrashError);
    crashPathHit = true;
  }
  assert.ok(crashPathHit);

  const result = await failAdapter.run(makeBrief(), makeOpts(failDir));
  assert.equal(result.status, 'failed', 'a low-quality-but-resolved result is a separate channel from a rejection');
});

// ============================================================
// timeout enforcement — behavior 15
// ============================================================

test('MockAdapter self-enforces opts.timeoutMs even with no externally-supplied signal', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'a.txt', content: 'a', delayMs: 5000 }],
  };
  const adapter = new MockAdapter({ scenario });
  const result = await adapter.run(makeBrief(), makeOpts(dir, { timeoutMs: 20, signal: undefined }));

  assert.equal(result.status, 'cancelled');
  assert.match(result.summary + JSON.stringify(result), /timeout/i);
});

// ============================================================
// log emission — behaviors 16-17
// ============================================================

test('log emission: documented event-kind order for a full completed run', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'a.txt', content: 'a' }, { path: 'b.txt', content: 'b' }],
  };
  const adapter = new MockAdapter({ scenario });
  const { events, log } = stubLog();
  await adapter.run(makeBrief(), makeOpts(dir, { log }));

  const kinds = events.map((e) => e.kind);
  assert.equal(kinds[0], 'lifecycle.turn_started');
  assert.equal(kinds.at(-1), 'lifecycle.turn_completed');
  const editKinds = kinds.filter((k) => k === 'action.file_edit');
  assert.equal(editKinds.length, 2, 'one action.file_edit per applied edit');

  const firstEditEvent = events.find((e) => e.kind === 'action.file_edit');
  assert.ok(firstEditEvent.payload && typeof firstEditEvent.payload.path === 'string');
});

test('opts.log presence/absence never changes the resolved WorkerResult', async (t) => {
  const dirWithLog = makeRepo();
  const dirNoLog = makeRepo();
  t.after(() => { rmSync(dirWithLog, { recursive: true, force: true }); rmSync(dirNoLog, { recursive: true, force: true }); });

  const scenario = { outcome: 'completed', edits: [{ path: 'a.txt', content: 'a' }] };
  const { log } = stubLog();
  const r1 = await new MockAdapter({ scenario }).run(makeBrief(), makeOpts(dirWithLog, { log }));
  const r2 = await new MockAdapter({ scenario }).run(makeBrief(), makeOpts(dirNoLog));

  const strip = (r) => { const c = structuredClone(r); delete c.artifacts.commits; delete c.artifacts.diffRef; return c; };
  assert.deepEqual(strip(r1), strip(r2));
});

// ============================================================
// renderBrief — behavior 18
// ============================================================

test('renderBrief includes definitionOfDone and the pinned verification.command verbatim, for every dialect', () => {
  const brief = makeBrief({
    definitionOfDone: 'THE EXACT DONE STRING #12345',
    verification: { command: 'THE EXACT PINNED COMMAND --flag=xyz', expectExit: 0 },
  });
  for (const dialect of ['codex-v2', 'claude']) {
    const rendered = renderBrief(brief, dialect);
    assert.equal(typeof rendered, 'string');
    assert.ok(rendered.includes('THE EXACT DONE STRING #12345'), `${dialect} must contain definitionOfDone verbatim`);
    assert.ok(rendered.includes('THE EXACT PINNED COMMAND --flag=xyz'), `${dialect} must contain the pinned command verbatim — the worker can never redefine done`);
  }
});

// ============================================================
// SubprocessAdapter family — behaviors 19-22 (guard-off only; never live)
// ============================================================

test('SubprocessAdapter.run() with the live guard OFF (default) resolves blocked, never spawns, for all three vendors', async () => {
  const originalEnv = process.env.BATON_ALLOW_LIVE_ADAPTERS;
  delete process.env.BATON_ALLOW_LIVE_ADAPTERS;
  try {
    for (const Adapter of [CodexAdapter, ClaudeAdapter, GlmAdapter]) {
      const adapter = new Adapter();
      const result = await adapter.run(makeBrief(), { worktree: '/nonexistent', timeoutMs: 1000, live: false });
      assert.equal(result.status, 'blocked');
      assert.match(result.blocker, /BATON_ALLOW_LIVE_ADAPTERS|live/i);
      assert.equal(result.verification.claimedExit, -1, 'un-matchable to any real expectExit');
      assert.equal(result.progress, 0);
    }
  } finally {
    if (originalEnv === undefined) delete process.env.BATON_ALLOW_LIVE_ADAPTERS;
    else process.env.BATON_ALLOW_LIVE_ADAPTERS = originalEnv;
  }
});

test('the two-key live guard is a real AND: only one key set still takes the disabled path', async () => {
  const originalEnv = process.env.BATON_ALLOW_LIVE_ADAPTERS;
  try {
    // Key 1 only: opts.live true, env var unset.
    delete process.env.BATON_ALLOW_LIVE_ADAPTERS;
    const r1 = await new ClaudeAdapter().run(makeBrief(), { worktree: '/nonexistent', timeoutMs: 1000, live: true });
    assert.equal(r1.status, 'blocked');
    assert.equal(r1.verification.claimedExit, -1);

    // Key 2 only: env var set, opts.live false/omitted.
    process.env.BATON_ALLOW_LIVE_ADAPTERS = '1';
    const r2 = await new ClaudeAdapter().run(makeBrief(), { worktree: '/nonexistent', timeoutMs: 1000, live: false });
    assert.equal(r2.status, 'blocked');
    assert.equal(r2.verification.claimedExit, -1);
  } finally {
    if (originalEnv === undefined) delete process.env.BATON_ALLOW_LIVE_ADAPTERS;
    else process.env.BATON_ALLOW_LIVE_ADAPTERS = originalEnv;
  }
});

test('argv() produces the documented cmd/args for each SubprocessAdapter subclass (pure, no process spawned)', () => {
  const brief = makeBrief();
  const opts = { worktree: '/tmp/whatever', timeoutMs: 1000 };

  const codex = new CodexAdapter().argv(brief, opts);
  assert.equal(codex.cmd, 'codex');
  assert.deepEqual(codex.args.slice(0, 3), ['exec', '--json', '--skip-git-repo-check']);
  assert.ok(codex.args.some((a) => a.includes(brief.verification.command)) || codex.args.length === 4, 'the rendered brief is the final positional arg');

  const claude = new ClaudeAdapter().argv(brief, opts);
  assert.equal(claude.cmd, 'claude');
  assert.equal(claude.args[0], '-p');
  assert.ok(claude.args.includes('--permission-mode'));
  assert.ok(claude.args.includes('acceptEdits'));

  const glm = new GlmAdapter().argv(brief, opts);
  assert.equal(glm.cmd, 'claude');
  assert.equal(glm.args[0], '-p');
  assert.ok(glm.args.includes('--permission-mode'));
  assert.ok(glm.args.includes('acceptEdits'));
});

test('GlmAdapter.card() reports harness "glm-via-claude" and concurrencyCeiling 1 despite extending ClaudeAdapter', () => {
  const card = new GlmAdapter().card();
  assert.equal(card.harness, 'glm-via-claude');
  assert.equal(card.concurrencyCeiling, 1);
});
