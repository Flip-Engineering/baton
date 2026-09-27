// Issue #619: a request that leaves the host-capacity queue without a lease takes its own queue
// row with it. The lane admits by queue order — only the FIRST row can be admitted — so a row
// whose request is gone pins every request behind it. The observation behind the issue: the
// 2026-09-27T15:11Z integrate left four rows at the head of the verify lane, all carrying the
// resident's own live pid, so #506's dead-pid sweep can never reach them and the lane admitted
// nothing already queued until the root removed the rows by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HostCapacityAuthority } from '../src/host-capacity.mjs';

const G = 1024 ** 3;

function capacityRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-issue619-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Stage one record the way the authority writes it: a private regular file whose field set is
 * exactly the one the read validates, named so bytewise order is FIFO order. */
function stage(dir, name, record) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, name), `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

/** Plenty of memory (so a verify is never answered DEGRADED) and four cores, so one admitted
 * verify fills the derived budget and the next request has to wait for it. */
function authorityOver(root) {
  return new HostCapacityAuthority({
    root, residentId: 'issue619',
    observation: () => ({ cores: 4, totalBytes: 32 * G, freeBytes: 24 * G, load1m: 1 }),
    pollMs: 10,
  });
}

test('HC-619-a: a queued request that ends by throwing leaves no queue row behind', async (t) => {
  const root = capacityRoot(t);
  const authority = authorityOver(root);
  // One admitted verify holds the derived budget (every core but the hub's, one memory share),
  // and its holder's pid is live, so #506's sweep never reclaims it.
  stage(join(root, 'leases'), 'lease-verify-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json', {
    schemaVersion: 1, kind: 'verify', holder: 'participant:swarm-619:other',
    nonce: 'a'.repeat(32), pid: process.pid, residentId: 'resident-other',
    acquiredAt: '2026-09-27T15:00:00.000Z',
  });

  let announce;
  const announced = new Promise((resolve) => { announce = resolve; });
  const waiting = authority.acquire('verify', {
    holder: 'integrate:swarm-619:contribution-aaaa',
    onQueued: (row) => announce(row),
  });
  const row = await announced;
  assert.equal(row.position, 1, 'the request waits as the lane\'s only queue row');
  assert.equal(row.ahead, 0);
  assert.equal(row.running, 1, 'the admitted verify it waits on is a lease, not a row');

  const ownRows = readdirSync(join(root, 'queue'));
  assert.equal(ownRows.length, 1, 'the waiting request announced itself as one queue row');
  const ownRow = ownRows[0];

  // A record the authority cannot read makes the request's own next turn throw — an exit that
  // carries no lease token, which is the class of exit the 2026-09-27T15:11Z run died on.
  stage(join(root, 'leases'), 'lease-worker-garbage.json', { not: 'a host capacity record' });

  await assert.rejects(waiting, (error) => error?.code === 'host_capacity_unavailable');
  assert.deepEqual(readdirSync(join(root, 'queue')), [],
    `the row ${ownRow} left with the request that wrote it`);
});
