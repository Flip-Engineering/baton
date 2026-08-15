import { test } from 'node:test';
import assert from 'node:assert/strict';

// #227 red-first enforcement suite (operator-ordered direct landing, 2026-08-15).
// Methodology: EVERY pin here was RED at the pre-implementation HEAD (verified by run)
// and GREEN after. The suite permanently enforces the facade/observability/continuation
// contracts — AI-written code is mutable; these pins are not.
//
// RED-state facts verified at HEAD (2026-08-15 run):
//   1. mcp-web-bridge ORDINARY_COMMANDS = 5 run.* verbs; waves.* refused
//      'application_unauthorized — Remote Baton MCP command authority is invalid'.
//   2. waves.progress had NO sinceSeq argument (application.mjs _normalizeWaveProgress).
//   3. BatonWebClient threw on runs.list continuation (application_run_list_continuation_required).
//   4. The store exposed no O(1) ledger cursor (eventsView() copies the world).

const WIRE_CARD = [
  'application.help', 'runs.list',
  'run.start', 'run.inspect', 'run.act', 'run.stop', 'run.status',
  'run.follow', 'run.wait', 'run.approve', 'run.answer', 'run.feedback',
  'run.evidence', 'run.adopt', 'run.retry_verification', 'run.resume_work',
  'run.review', 'run.integrate', 'run.export', 'run.recover',
  'run.episode', 'run.workstreams', 'run.workstream.notify', 'run.workstream.stop',
  'run.message.send', 'run.message.receipt', 'run.attention.watch',
  'run.scratchpad.read', 'run.scratchpad.append', 'run.scratchpad.elevate',
  'run.board.post', 'run.board.read', 'run.knowledge.seed',
  'waves.attach', 'waves.start', 'waves.list', 'waves.progress', 'waves.send',
  'waves.stop', 'waves.run', 'waves.compile',
];

const STABLE_SESSION = Object.freeze({
  ok: true,
  identity: Object.freeze({
    userId: 'local-owner', sessionId: 'sess-1',
    capabilities: Object.freeze(['observe', 'control', 'approve', 'emergency_stop']),
    repoIds: Object.freeze(['repo-test']),
  }),
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  revoked: false,
});

function makeFakeClient({ commands = WIRE_CARD, listPages = null } = {}) {
  const calls = [];
  return {
    calls,
    repoId: 'repo-test',
    baseUrl: 'https://baton.local/',
    origin: 'https://baton.local',
    async doctor() {
      return {
        ok: true, ready: true,
        application: { schemaVersion: 1, repoId: 'repo-test', commands: [...commands] },
      };
    },
    async session() { return STABLE_SESSION; },
    async command(name, args, idempotencyKey) {
      calls.push({ name, args, idempotencyKey });
      if (name === 'runs.list' && listPages) {
        if (args?.continuationCursor === undefined && listPages.length > 1) {
          throw Object.assign(
            new Error('Run list requires bounded continuation support'),
            { code: 'application_run_list_continuation_required', continuationCursor: listPages[1].cursor },
          );
        }
        const page = args?.continuationCursor === undefined
          ? listPages[0]
          : listPages.find((p) => p.cursor === args.continuationCursor);
        if (!page) throw Object.assign(new Error('stale continuation cursor'), { code: 'stale_cursor' });
        const nextIndex = listPages.indexOf(page) + 1;
        return {
          schemaVersion: 1,
          items: page.items,
          continuationCursor: nextIndex < listPages.length ? listPages[nextIndex].cursor : undefined,
        };
      }
      if (name === 'waves.progress' && args?.sinceSeq !== undefined) {
        return {
          schemaVersion: 1, waveId: args.waveId, delta: true, sinceSeq: args.sinceSeq,
          nextSinceSeq: 1042, events: [{ seq: 1001, kind: 'lifecycle.crashed' }],
        };
      }
      if (name === 'waves.run') return { accepted: true, waveId: 'wave:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
      return { ok: true };
    },
  };
}

const CONTEXT = Object.freeze({
  transport: 'mcp', idempotencyKey: 'mcp.call:r1', requestId: 'r1',
});

async function makeFacade(options = {}) {
  const { BatonWebApplicationFacade } = await import('../src/mcp-web-bridge.mjs');
  const fake = makeFakeClient(options);
  const doctor = await fake.doctor();
  const facade = new BatonWebApplicationFacade(fake, doctor.application, STABLE_SESSION);
  const principal = facade.principal();
  const passable = { ...principal, principalId: principal.userId };
  return { facade, fake, passable };
}

// ---------------------------------------------------------------------------
// Pins 1-3: the facade carries the wire's whole registry (#227 item 1)
// ---------------------------------------------------------------------------

test('FACADE: waves.run passes the facade to the wire — no proxy-class refusal', async () => {
  const { facade, fake, passable } = await makeFacade();
  const result = await facade.command('waves.run', { specDsl: 'wave x' }, passable, CONTEXT);
  assert.equal(result.accepted, true, 'the wave verb reached the wire');
  assert.equal(fake.calls.at(-1).name, 'waves.run');
});

test('FACADE: waves.progress / waves.list / runs.list all pass — the registry is whole', async () => {
  const { facade, fake, passable } = await makeFacade();
  for (const name of ['waves.progress', 'waves.list', 'runs.list']) {
    const before = fake.calls.length;
    await facade.command(name, {}, passable, CONTEXT);
    assert.equal(fake.calls.length, before + 1, `${name} passed the facade`);
  }
});

test('FACADE: application.shutdown NEVER passes — host lifecycle is not proxied', async () => {
  const { facade, passable } = await makeFacade();
  await assert.rejects(
    () => facade.command('application.shutdown', {}, passable, CONTEXT),
    /authority|shutdown|not/i,
    'shutdown refuses at the facade',
  );
});

// ---------------------------------------------------------------------------
// Pin 4: the wire-side sinceSeq delta (#227 item 3 — the dogfood-proven surface)
// ---------------------------------------------------------------------------

test('SINCESEQ: the facade forwards waves.progress with sinceSeq — the delta is first-class', async () => {
  const { facade, fake, passable } = await makeFacade();
  const result = await facade.command(
    'waves.progress',
    { waveId: 'wave:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', sinceSeq: 1000 },
    passable,
    CONTEXT,
  );
  assert.equal(result.delta, true, 'a delta response shape returns');
  assert.equal(result.nextSinceSeq, 1042, 'the next cursor rides the response');
  const call = fake.calls.at(-1);
  assert.equal(call.args.sinceSeq, 1000, 'sinceSeq reached the wire verbatim');
});

// ---------------------------------------------------------------------------
// Pin 5: the client-side continuation (#227 item 4 — list verbs usable at scale)
// ---------------------------------------------------------------------------

test('CONTINUATION: BatonWebClient drains list continuation pages in one call', async () => {
  const { BatonWebClient } = await import('../src/application-cli.mjs');
  // Faithful continuation model: the server refuses the cursorless request naming the
  // continuation cursor; each cursor request returns that page's items and the next
  // cursor; the last page omits it. The client drains all pages in ONE call.
  const pagesByCursor = new Map([
    ['c1', { items: [{ id: 'run-1' }, { id: 'run-2' }], next: 'c2' }],
    ['c2', { items: [{ id: 'run-3' }, { id: 'run-4' }], next: null }],
  ]);
  const client = new BatonWebClient({
    baseUrl: 'https://baton.local/', origin: 'https://baton.local/',
    repoId: 'repo-test', token: 't', commandTimeoutMs: 30_000, pollMs: 250,
    fetchImpl: async () => new Response('{}'),
    clock: () => Date.now(),
    sleep: () => Promise.resolve(),
  });
  client._json = async (path, options) => {
    const envelope = JSON.parse(options.body);
    if (envelope.command !== 'runs_list') return { status: 'completed', result: { ok: true } };
    const cursor = envelope.args?.continuationCursor;
    if (cursor === undefined) {
      throw Object.assign(new Error('Run list requires bounded continuation support'), {
        code: 'application_run_list_continuation_required', continuationCursor: 'c1',
      });
    }
    const page = pagesByCursor.get(cursor);
    if (!page) throw Object.assign(new Error('stale cursor'), { code: 'stale_cursor' });
    return {
      status: 'completed',
      result: {
        schemaVersion: 1, items: page.items,
        ...(page.next ? { continuationCursor: page.next } : {}),
      },
    };
  };
  const result = await client.command('runs.list', {});
  assert.equal((result.items ?? []).length, 4, `all pages drained (got ${(result.items ?? []).length})`);
  assert.deepEqual(result.items.map((item) => item.id), ['run-1', 'run-2', 'run-3', 'run-4'],
    'drain order is stable');
});
// ---------------------------------------------------------------------------
// Pin 6: the O(1) ledger cursor — no full-world copy on the delta path (#210 law)
// ---------------------------------------------------------------------------

test('CURSOR: the coordination store exposes an O(1) cursor without copying the ledger', async () => {
  const { CoordinationStore } = await import('../src/coordination-store.mjs');
  const os = await import('node:os');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(os.tmpdir(), 'baton-cursor-pin-'));
  try {
    const store = new CoordinationStore(join(dir, 'coordination'));
    store.claimWriterLease();
    const cursor = typeof store.eventCursor === 'function' ? store.eventCursor() : null;
    assert.ok(cursor !== null, 'an O(1) eventCursor() accessor exists (no full copy)');
    assert.ok(Number.isSafeInteger(cursor) && cursor >= 0, 'the cursor is a safe integer');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
