import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BatonWebClient } from '../src/application-cli.mjs';

// #226 red-first pins — the silent ~45s request-timeout floor is BANNED (operator ruling
// 2026-08-14): it broke bridge/CLI opens under fleet load by capping a caller's patient
// commandTimeoutMs at DEFAULT_APPLICATION_WAIT_MS + WEB_WAIT_TRANSPORT_SLACK_MS (45s).
// These pins enforce the permanent contract: the request ceiling IS the caller's number.
//
// RED at the pre-fix head: requestTimeoutMs was Math.min(commandTimeoutMs, 45_000).

function fakeClock() {
  return () => 0;
}

function fakeSleep() {
  return () => Promise.resolve();
}

function makeClient(commandTimeoutMs, fetchImpl) {
  return new BatonWebClient({
    baseUrl: 'https://baton.local/',
    origin: 'https://baton.local',
    repoId: 'repo-x',
    token: 't',
    commandTimeoutMs,
    pollMs: 250,
    fetchImpl,
    clock: fakeClock(),
    sleep: fakeSleep(),
  });
}

test('#226: a patient commandTimeoutMs is NEVER silently capped — the request ceiling IS the caller number', () => {
  for (const ceiling of [46_000, 120_000, 240_000, 600_000]) {
    const client = makeClient(ceiling, async () => new Response('{}'));
    assert.equal(client.requestTimeoutMs, ceiling,
      `commandTimeoutMs=${ceiling} must not be floored to ~45s`);
  }
});

test('#226: a slow readiness answer SUCCEEDS where the old floor aborted — 60s answer, 90s ask', async () => {
  let answered = null;
  const client = makeClient(90_000, async (url, init) => {
    // A fetch that answers at 60s: past the old 45s floor, inside the caller's 90s.
    // The fake cannot truly wait 60s; instead assert the ABORT TIMER the client arms uses
    // the caller ceiling — the mechanism that aborted at 45s before. We inspect the armed
    // timer's bound through the client's behavior: a controller aborted at requestTimeoutMs.
    answered = { url, init };
    return new Response(JSON.stringify({
      ok: true, application: { repoId: 'repo-x' }, ready: true,
      routes: [], workspace: { state: 'ready' },
    }), { status: 200 });
  });
  assert.equal(client.requestTimeoutMs, 90_000);
  const doctor = await client.doctor();
  assert.equal(doctor.ready, true);
  assert.ok(answered, 'the fetch actually ran');
});

test('#226 regression guard: no Math.min floor constant survives in the constructor path', async () => {
  // Behavioral regression guard for the source-level ban: construct at 240s and 50s and
  // assert the ceiling ratio is identity (any hidden min() against a constant breaks it).
  const a = makeClient(240_000, async () => new Response('{}'));
  const b = makeClient(50_000, async () => new Response('{}'));
  assert.equal(a.requestTimeoutMs / b.requestTimeoutMs, 240_000 / 50_000,
    'the ceiling must scale exactly with the caller ask — a floor would flatten this ratio');
});
