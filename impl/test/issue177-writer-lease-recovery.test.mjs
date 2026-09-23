// Issue #177 (kernel honesty finding, #169 audit instance 1): stale writer-lease recovery was
// silent. A dead holder's `writer.lease` was unlinked with no record of who was reaped or why, the
// lease object never said a stale holder had been reaped, and the `coordination_writer_busy`
// refusal dropped the holder identity the store had just read (the fleet report: "I read the lease
// file by hand") — plus the addition: that refusal must name the holder's pid/incarnation, the
// acquisition boundary and a next action.
//
// Three sites, one audit:
//   * coordination-ledger-writes.mjs (the writer-lease region the store split moved out of
//     coordination-store.mjs) — the unlink of a proved-stale lease;
//   * resident-authority.mjs — `acquireLease` computes `reclaimed` and the returned lease omitted it;
//   * the same claim path — the busy refusal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoordinationStore, loadCoordinationStoreAsync } from '../src/coordination-store.mjs';
import { ResidentAuthority } from '../src/resident-authority.mjs';

const ownerUid = typeof process.getuid === 'function' ? process.getuid() : null;
const DEAD_START = 'Thu Jan  1 00:00:00 1970';

function root(label) {
  return mkdtempSync(join(tmpdir(), `baton-issue177-${label}-`));
}

/** A holder record whose process is provably not the one that published it: the pid is alive but
 * its kernel-reported start identity is not the recorded one, which `writerOwnerState` reads as
 * `stale` exactly as it reads a PID that is gone. */
function staleLease(extra = {}) {
  return `${JSON.stringify({
    schemaVersion: 2, pid: process.pid, pidStart: DEAD_START,
    token: 'the-dead-holder', acquiredAt: '2026-09-22T00:00:00.000Z', ...extra,
  })}\n`;
}

// R1: the reaped holder is recorded, and the lease says it was reclaimed.
test('#177 R1: reclaiming a dead holder\'s writer lease leaves a writer.lease_recovered record naming it', (t) => {
  const directory = root('recovery-record');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  writeFileSync(join(directory, 'writer.lease'), staleLease(), { mode: 0o600 });

  const lease = store.claimWriterLease();
  assert.equal(lease.reclaimed, true,
    'stage[recovery-silent]: a lease that reaped a dead holder says so, exactly as publish() says recoveredStaleAuthority');
  assert.deepEqual(lease.recovered, { priorPid: process.pid, priorPidStart: DEAD_START },
    'stage[recovery-silent]: the reaped holder is named on the lease that replaced it');

  const recovered = store.events().filter((event) => event.payload?.kind === 'writer.lease_recovered');
  assert.equal(recovered.length, 1,
    'stage[recovery-unrecorded]: the recovery is a durable record, never a bare unlink');
  assert.equal(recovered[0].kind, 'driver.recorded', 'it rides the driver row family');
  assert.equal(recovered[0].payload.priorPid, process.pid, 'the prior holder pid is carried');
  assert.equal(recovered[0].payload.priorPidStart, DEAD_START, 'and the incarnation that identified it');
  assert.equal(recovered[0].payload.reason, 'stale_owner', 'and why it was reaped');

  // A clean acquire is not a recovery: the record is evidence, not a heartbeat.
  store.releaseWriterLease({ requireOwned: true });
  const clean = store.claimWriterLease();
  assert.equal(clean.reclaimed, false, 'a lease taken from nobody claims no recovery');
  assert.equal(clean.recovered, null);
  assert.equal(store.events().filter((event) => event.payload?.kind === 'writer.lease_recovered').length, 1,
    'no second recovery record for a clean acquire');
  store.releaseWriterLease({ requireOwned: true });
});

// R2: the busy refusal names the holder it already read, plus the acquisition boundary and a next
// action — the operator no longer opens the lease file by hand.
test('#177 R2: coordination_writer_busy names the holder pid/incarnation, the acquisition boundary and the next action', (t) => {
  const directory = root('busy-payload');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const first = new CoordinationStore(directory);
  const held = first.claimWriterLease();
  // The boundary the holder's window opened at: the ledger stood at 0 rows when it claimed, and a
  // row written afterwards must not move the number the refusal reports.
  first.recordDriver('issue177.boundary_probe', { at: 'now' }, { actor: 'policy', key: 'issue177:boundary-probe' });

  const second = new CoordinationStore(directory);
  assert.throws(
    () => second.claimWriterLease(),
    (error) => {
      assert.equal(error?.code, 'coordination_writer_busy', 'the refusal keeps its typed code');
      assert.equal(error.detail?.holderPid, process.pid,
        'stage[holder-dropped]: the holder pid the store already read rides the refusal');
      assert.equal(error.detail?.holderIncarnation, held.pidStart,
        'and the incarnation that identifies it — the same primitive the lease file binds');
      assert.equal(error.detail?.acquiredAtEventSeq, 0,
        'and the ledger boundary at acquisition, not whatever the head has since become');
      assert.equal(typeof error.detail?.next, 'string', 'and a next action');
      assert.ok(error.detail.next.length > 0, 'which is not empty');
      assert.match(error.detail.next, /release|stop/u, 'and names what the operator can do');
      return true;
    },
  );
  assert.equal(JSON.parse(readFileSync(join(directory, 'writer.lease'), 'utf8')).acquiredAtEventSeq, 0,
    'the boundary is durable on the lease itself, so a refused claimant reads it from the file too');

  // The next holder acquires at a moved boundary, and ITS successor's refusal names that one.
  first.releaseWriterLease({ requireOwned: true });
  const replacement = second.claimWriterLease();
  assert.equal(replacement.acquiredAtEventSeq, first.events().length,
    'the replacement records the boundary it actually acquired at');
  const third = new CoordinationStore(directory);
  assert.throws(
    () => third.claimWriterLease(),
    (error) => {
      assert.equal(error?.code, 'coordination_writer_busy');
      assert.equal(error.detail?.acquiredAtEventSeq, replacement.acquiredAtEventSeq,
        'the boundary moves with the holder, never with the ledger head');
      return true;
    },
  );
  second.releaseWriterLease({ requireOwned: true });
});

// R3: the resident authority exposes the flag it already computes, exactly as publish() exposes
// recoveredStaleAuthority.
test('#177 R3: a reclaimed host lease exposes `reclaimed`, and the outline carries it', (t) => {
  const world = mkdtempSync('/tmp/bt177-resident-');
  t.after(() => rmSync(world, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: world });
  const commonDir = join(world, '.git');
  const configRoot = join(world, 'config');
  const home = join(world, 'home');
  mkdirSync(join(commonDir, 'baton'), { recursive: true, mode: 0o700 });
  mkdirSync(join(configRoot, 'baton', 'connections'), { recursive: true, mode: 0o700 });
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const f = {
    commonDir, home, env: { XDG_CONFIG_HOME: configRoot, HOME: home },
    deploymentRoot: join(world, 'deployment'), repoId: 'repo-issue177-resident',
  };
  const authorityFor = () => new ResidentAuthority({
    deploymentRoot: f.deploymentRoot, commonDir: f.commonDir, repoId: f.repoId,
    env: f.env, home: f.home, ownerUid,
  });

  const first = authorityFor();
  assert.equal(first.lease.reclaimed, false, 'stage[clean-acquire]: a fresh host lease reclaims nothing');
  assert.equal(first.publicOutline().recoveredStaleLease, false, 'and the outline says so');

  // The published holder is provably not the process that published it any more, while its lease
  // directories stand: the release-then-SIGKILL state the recovery path exists for. Both leases the
  // authority acquires are rewritten — the host lease under the deployment root, the publication
  // lease under the repository's own baton directory — so the successor meets the same state the
  // predecessor left rather than one that only looks half dead.
  for (const holderPath of [
    join(f.deploymentRoot, 'resident', 'host.lease', 'owner.json'),
    join(f.commonDir, 'baton', 'publication.lease', 'owner.json'),
  ]) {
    assert.ok(existsSync(holderPath), `stage[fixture-shape]: the published lease lives at ${holderPath}`);
    const holder = JSON.parse(readFileSync(holderPath, 'utf8'));
    writeFileSync(holderPath, `${JSON.stringify({ ...holder, pidStart: DEAD_START })}\n`, { mode: 0o600 });
  }
  const second = authorityFor();
  assert.equal(second.lease.reclaimed, true,
    'stage[recovery-silent]: the successor knows it reaped a stale holder instead of acquiring cleanly');
  assert.equal(second.publicOutline().recoveredStaleLease, true,
    'and the public outline carries it, exactly as recoveredStaleAuthority rides the publication');
  assert.notEqual(second.incarnation, first.incarnation, 'the successor is its own incarnation');
});

// R4: the production open is deferred (createDriver's `coordinationAsyncOpen` claims the lease
// before the replay folds), so the two facts must survive that window: the recovery record lands
// once the projection exists, and the boundary the holder acquired at is stamped into the lease a
// later claimant reads.
test('#177 R4: a deferred open records the recovery and stamps the boundary it acquired at', async (t) => {
  const directory = root('deferred-recovery');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  // One row first, so the boundary a deferring holder acquires at is not the empty ledger's zero.
  const seed = new CoordinationStore(directory);
  seed.claimWriterLease();
  seed.recordDriver('issue177.deferred_seed', { at: 'now' }, { actor: 'policy', key: 'issue177:deferred-seed' });
  seed.releaseWriterLease({ requireOwned: true });
  writeFileSync(join(directory, 'writer.lease'), staleLease(), { mode: 0o600 });

  const deferred = new CoordinationStore(directory, { deferLoad: true });
  const lease = deferred.claimWriterLease();
  assert.equal(lease.reclaimed, true, 'the recovery is known at claim time, before the fold');
  assert.equal(lease.acquiredAtEventSeq, null,
    'stage[boundary-guessed]: a deferred claim does not guess the boundary its replay has not folded');
  assert.equal(deferred.events().filter((event) => event.payload?.kind === 'writer.lease_recovered').length, 0,
    'and it can host no row before the fold');

  await loadCoordinationStoreAsync(deferred);
  const recovered = deferred.events().filter((event) => event.payload?.kind === 'writer.lease_recovered');
  assert.equal(recovered.length, 1,
    'stage[deferred-recovery-unrecorded]: the record lands the moment the projection exists');
  assert.equal(recovered[0].payload.reason, 'stale_owner');
  assert.equal(recovered[0].payload.priorPid, process.pid);
  assert.equal(deferred._writerLease.acquiredAtEventSeq, 1,
    'stage[boundary-unstamped]: the boundary the holder acquired at is the ledger it folded, not the row about the recovery');
  assert.equal(JSON.parse(readFileSync(join(directory, 'writer.lease'), 'utf8')).acquiredAtEventSeq, 1,
    'and it is durable on the lease file a later claimant reads');

  const claimant = new CoordinationStore(directory);
  assert.throws(
    () => claimant.claimWriterLease(),
    (error) => {
      assert.equal(error?.code, 'coordination_writer_busy');
      assert.equal(error.detail?.acquiredAtEventSeq, 1,
        'a later refusal names the deferred holder\'s boundary too');
      return true;
    },
  );
  deferred.releaseWriterLease({ requireOwned: true });
});
