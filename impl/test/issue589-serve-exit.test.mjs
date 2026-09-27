// Issue #589 — a terminal host state ends the `baton serve` process by itself.
//
// THE FACT (observed 2026-09-25, carried in contribution-678cdedc by visual-lead7t): the resident
// answered its own terminal host state, its stop was over — the outcome row minted, the leases
// released — and the process stayed alive until a SECOND SIGTERM took Node's default action. The
// stop's own finally had already removed the signal handlers, and `serveDeployment` only set
// `process.exitCode` and returned, so it ended only when its event loop drained on its own. A
// handle the stop does not own (an unclosed transport, a timer) keeps that loop alive forever.
//
// The fixtures below are the two ends of that state: each answers a terminal host state from its
// own `close()` and keeps ONE handle of its own alive, so the loop the serve arm stands on never
// drains. Before the fix the child outlives its stop (the row times out); after it the child exits
// with the code the state names. `signalCode` stays null either way: the SIGTERM the row sends is
// the stop's trigger, never what ends the process.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { spawnFixtureResident } from './fixtures/fixture-resident.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/baton.mjs', import.meta.url));
// A stop of a deployment that opens no repository: seconds. Generous, so host load is not the row.
const EXIT_BOUND_MS = 30_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(probe, label, timeoutMs = EXIT_BOUND_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(25);
  }
}
// The fixture below is that state: it answers a terminal `closed_degraded` from its own close()
// and holds ONE handle of its own from creation, so the loop the serve arm stands on cannot drain
// by itself. Before the fix the child outlives its stop (the row times out); after it the child
// exits with the code the state names. `signalCode` stays null: the SIGTERM the row sends is the
// stop's trigger, never what ends the process.

/** One fixture deployment module: an ALREADY-WRAPPED deployment (`convergence: true`) that answers
 * the two ends the serve arm reads, reaches `state` from its own close, and keeps one handle of its
 * own alive so the loop cannot drain by itself. */
function fixtureModule(root, label, state) {
  const path = join(root, `deployment-${label}.mjs`);
  writeFileSync(path, `
export const createBatonDeployment = () => {
  // The handle the stop does not own: a live timer, installed BEFORE the stop runs, so the loop
  // the serve arm stands on cannot drain by itself. Without an explicit exit this process is a
  // resident only a second signal ends.
  setInterval(() => {}, 1_000);
  return {
    convergence: true,
    serveLog: () => null,
    withdrawn: () => false,
    whenStopped: () => new Promise(() => {}),
    ownedParticipantCount: () => 0,
    recordStopRequested: () => null,
    host: async () => ({ schemaVersion: 1, state: 'published' }),
    close: async () => ({ closed: { state: ${JSON.stringify(state)}, code: 'stop_fixture' } }),
  };
};
`);
  return path;
}
/** Spawn one fixture resident, wait for its published line, SIGTERM it, and return how it ended. */
async function serveAndStop(t, { label, state }) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue589-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const configPath = fixtureModule(root, label, state);
  const stderr = [];
  const child = spawnFixtureResident(t, {
    args: [SCRIPT, 'serve', configPath], cwd: root, stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (chunk) => { stderr.push(String(chunk)); });
  const text = () => stderr.join('');
  await until(() => text().includes('"state":"published"'), 'the hosted flip line');
  child.kill('SIGTERM');
  await until(() => child.exitCode !== null || child.signalCode !== null, 'the serve process to end');
  return { child, stderr: text() };
}

test('589-a: a degraded terminal state ends the serve process by itself, with exit 1', { timeout: 180_000 }, async (t) => {
  const { child, stderr } = await serveAndStop(t, { label: 'degraded', state: 'closed_degraded' });
  assert.equal(child.signalCode, null, `the stop's SIGTERM never ends the process: ${stderr.slice(-600)}`);
  assert.equal(child.exitCode, 1, `a degraded stop exits 1: ${stderr.slice(-600)}`);
  assert.match(stderr, /"state":"closed_degraded"/u, 'the closing line names the terminal state it exited with');
});
