// Issue #449 — a stop on a real ledger writes its checkpoint, and a checkpoint written by another
// projection shape is stale, not corrupt.
//
// OBSERVED (2026-09-18, both residents restarted onto 1a830bfe): the clone's stop read
//   `host.stopped stopped at … (projection checkpoint skipped: release_checkpoint_unbounded)`
// and the next open read
//   `answering (open 8470ms; 36333 rows on the ledger; replayed 36333; checkpoint corrupt
//    (projection_shape {"field":"keys","actual":"_artifacts,_…"}); reconstructed 4637ms)`.
// The primary (161 931 rows) replayed every row too. The skip was a wake-replay FRAME bound
// (`view.wake_replay.items`) applied to the ledger ROW COUNT (`coordination-store.mjs`), so on any
// ledger that has done real work the stop never wrote a checkpoint; and the surviving checkpoint —
// written by an older commit whose projection had different keys — was refused as `corrupt`, which
// is a repair remedy for a rewrite problem. A `.projection.checkpoint.<uuid>` temp file from the
// crashed write beside it was never swept.
//
// What this file pins, on real CoordinationStore bytes:
//  (a) the release bounds a HOUSEWRITING checkpoint by the checkpoint's OWN cost — the serialized
//      projection measured at write time against the registry's ceiling for it — so a store whose
//      window is past the wake-replay FRAME ceiling still writes one, and the row names the
//      measured bytes, `coversSeq` and both declared bounds;
//  (b) a checkpoint written under a different projection-shape digest opens as a stale shape —
//      the state token is `stale_shape`, which the open narration reads where it has always read
//      the state (`checkpoint stale_shape (projection_shape_digest {...})`, against
//      `checkpoint corrupt (…)` for a failed invariant) — carrying the writer's shape digest AND
//      the served commit that wrote it, replays the ledger in full, and the OPEN writes a fresh
//      checkpoint, so the NEXT open is bounded (a used checkpoint still reads `valid`:
//      `checkpoint used` in the issue's words);
//  (c) an envelope invariant failure still opens as `corrupt` (#397 unchanged), and a legacy
//      envelope that predates the shape record is stale, never corrupt;
//  (d) a leftover `.projection.checkpoint.<uuid>` temp file is swept on open and named;
//  (e) the resident's own open row carries all of it — the state, the writer's commit, the rewrite
//      and the swept names — because the flip line renders exactly that row.
//
// Issue #465(4) changed what a "used" checkpoint means, and these rows are read that way: the
// checkpoint carries the projection and `coversSeq`, NOT the event log, so a valid open reads rows
// 1..coversSeq back from the ledger and folds only the tail. `replayedEvents` therefore counts the
// rows whose FOLD ran (the tail), while `checkpointEvents` counts the rows the carried projection
// covers; a fallback replays and folds every row. `throughSeq` became `coversSeq` (the absolute seq
// the projection covers, archived rows included) because the rows are no longer a window cache.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deserialize, serialize } from 'node:v8';
import test from 'node:test';

import { PROJECTION_CHECKPOINT_FIELDS } from '../src/coordination-internals.mjs';
import { CoordinationStore, MockAdapter, openBaton } from '../src/index.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';

const actor = 'test:issue449';
const CHECKPOINT = 'projection.checkpoint';
const TEMP_PREFIX = '.projection.checkpoint.';
const SERVED_COMMIT = 'a'.repeat(40);
// The envelope's shape claim, derived HERE from the ONE field list the durable payload is composed
// from — never read back off the writer, so the row proves the envelope really recorded this build.
const SHAPE = createHash('sha256').update([...PROJECTION_CHECKPOINT_FIELDS].sort().join(',')).digest('hex');
// The two declared rows this file derives from — the replay frame's row ceiling (the bound the row
// still names) and the checkpoint's OWN cost ceiling in bytes (the bound the decision uses).
const FRAME = FRAME_LIMITS['view.wake_replay.items'];
const COST = FRAME_LIMITS['checkpoint.projection_bytes'];

function root(t, label) {
  const directory = mkdtempSync(join(tmpdir(), `baton-issue449-${label}-`));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** The adapter card the resident self-check requires (the issue351 reconstruction fixture's shape):
 * one exact route, an available credential, and an unattended-full worker policy. */
function adapterInProcess() {
  const value = new MockAdapter({ harness: 'codex', scenario: { outcome: 'completed', delayMs: 1, summary: 'issue449 fixture' } });
  const rawCard = value.card.bind(value);
  value.card = () => ({ ...rawCard(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    workerPolicy: { schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', mechanisms: [], configuredPreferences: [] } },
    modelSelection: { mode: 'exact', configuredDefault: 'gpt-5.6-sol', available: ['gpt-5.6-sol'], family: 'codex',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['high'], serviceTier: null,
      provenance: 'issue449-checkpoint-on-stop', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' } });
  return value;
}

/** A store's own rows, one ledger event each — the fixture every row below is written through. */
function appendRows(store, count) {
  for (let index = 1; index <= count; index += 1) {
    store.recordDriver('issue449.fixture', { index }, { actor, key: `issue449:row:${index}` });
  }
}

/** Issue #465(4): the fixture that puts the checkpoint's OWN cost past the ceiling. The body no
 * longer carries the event log, so a big ledger row cannot inflate it: what inflates it is a family
 * the body keeps WHOLE — `evidence.mapped` folds its payload into `_evidence` verbatim (no
 * reference rendering), so these rows are carried bytes, exactly the way a real campaign's carried
 * families are. */
function appendEvidenceRows(store, count, bytes) {
  const body = 'x'.repeat(bytes);
  for (let index = 1; index <= count; index += 1) {
    store._append('evidence.mapped', {
      worker: 'w-449', workerSeq: index, digest: `issue449:${index}`, body: `${body}#${index}`,
    }, { actor, key: `issue449:evidence:${index}` });
  }
}

/** Append valid rows directly to the ledger beyond a checkpoint's prefix — the tail a USED
 * checkpoint must still replay (a full-replay fallback folds these too, so the startup counters
 * tell the two apart). Rows mirror the issue397 fixture template. */
function appendTailRows(directory, fromSeq, count) {
  const rows = [];
  for (let offset = 0; offset < count; offset += 1) {
    const seq = fromSeq + offset;
    rows.push(JSON.stringify({
      schemaVersion: 1, seq, ts: new Date().toISOString(), kind: 'driver.recorded',
      actor, idempotencyKey: `issue449:tail:${seq}`,
      payload: { kind: 'issue449.fixture', index: seq },
    }));
  }
  writeFileSync(join(directory, 'events.jsonl'), `${rows.join('\n')}\n`, { flag: 'a' });
}

/** Read the checkpoint envelope. v8's deserialize loses Buffer-ness, so the cached projection bytes
 * are re-copied into a Buffer the way the writer stored them. */
function readEnvelope(directory) {
  const envelope = deserialize(readFileSync(join(directory, CHECKPOINT)));
  envelope.projectionBytes = Buffer.from(envelope.projectionBytes);
  return envelope;
}

function writeEnvelope(directory, envelope) {
  writeFileSync(join(directory, CHECKPOINT), serialize(envelope), { mode: 0o600 });
}

const abbrev = (value) => `${String(value).slice(0, 12)}…`;

test('449-a: a window past the replay frame ceiling still checkpoints on release, naming bytes and bound', (t) => {
  const directory = root(t, 'release');
  const store = new CoordinationStore(directory, { checkpointInterval: 16 });
  const rows = FRAME.value + 4; // more rows than the wake-replay frame carries
  appendRows(store, rows);
  store.releaseWriterLease({ requireOwned: true });

  const release = store.checkpointReleaseState();
  assert.equal(release?.state, 'written',
    'the release bounds the write by the checkpoint\u2019s own cost, not by the row count since archival');
  assert.equal(release.rows, rows);
  assert.equal(release.coversSeq, rows, 'and the seq its carried projection covers');
  assert.ok(Number.isSafeInteger(release.bytes) && release.bytes > 0,
    'the outcome names the serialized projection the write measured');
  assert.equal(release.ledgerBytes, store._loadedLedgerIdentity.bytes,
    'and the window\u2019s own ledger bytes the decision proved it against');
  assert.equal(release.bound, FRAME.value, 'the replay frame\u2019s row ceiling is still named');
  assert.equal(release.costBound, COST.value, 'beside the checkpoint\u2019s own cost ceiling in bytes');
  assert.ok(release.bytes <= COST.value, 'the write is inside the declared cost ceiling');
  assert.equal(release.reason, null);

  const path = join(directory, CHECKPOINT);
  assert.ok(existsSync(path), 'the checkpoint is on disk');
  const envelope = readEnvelope(directory);
  assert.equal(envelope.coversSeq, rows);
  assert.equal(envelope.projectionShapeDigest, SHAPE,
    'the envelope records the projection shape of the build that wrote it');
  assert.equal(envelope.servedCommit, null, 'no deployment commit on a bare fixture');
  const reopened = new CoordinationStore(directory);
  assert.equal(reopened.startupStatus().checkpoint, 'valid');
  assert.equal(reopened.startupStatus().checkpointEvents, rows,
    'the state of every row is served from the cache (the rows themselves are read back from the ledger)');
  assert.equal(reopened.startupStatus().replayedEvents, 0, 'so no row has to be folded again');
  reopened.releaseWriterLease({ requireOwned: true });
});

test('449-a2: a projection past the cost ceiling is skipped, naming the bytes it measured', (t) => {
  const directory = root(t, 'oversize');
  const store = new CoordinationStore(directory, { checkpointInterval: 1_024 });
  // Carried rows that put the PROJECTION past the declared cost ceiling — the quantity the release
  // judges. #449's residual replaced the window's ledger bytes as the gate (they are evidence on the
  // row now), so the skip is reached by measuring, and the row says what it measured. Issue #465(4):
  // the body no longer carries the event log, so the fixture grows a CARRIED family instead.
  appendEvidenceRows(store, 10, 2 * 1024 * 1024);
  store.releaseWriterLease({ requireOwned: true });

  const release = store.checkpointReleaseState();
  assert.equal(release?.state, 'skipped');
  assert.equal(release.reason, 'release_checkpoint_unbounded');
  assert.ok(Number.isSafeInteger(release.bytes) && release.bytes > COST.value,
    'the row names the serialized projection the write measured and refused');
  assert.equal(release.ledgerBytes, store._loadedLedgerIdentity.bytes);
  assert.ok(release.ledgerBytes > COST.value, 'the window\u2019s own bytes ride the row as evidence, never as the gate');
  assert.equal(release.bound, FRAME.value);
  assert.equal(release.costBound, COST.value);
  assert.equal(existsSync(join(directory, CHECKPOINT)), false, 'and no checkpoint was written');
});

test('449-b: a checkpoint from another projection shape opens stale_shape, replays in full, and the open rewrites it', (t) => {
  const directory = root(t, 'stale-shape');
  const first = new CoordinationStore(directory, { checkpointInterval: 16, deploymentBaseSha: SERVED_COMMIT });
  appendRows(first, 32);
  first.releaseWriterLease({ requireOwned: true });
  const path = join(directory, CHECKPOINT);
  assert.ok(existsSync(path), 'the fixture wrote its checkpoint');

  // Another build wrote it: a different projection shape, under the same authority. The bytes are
  // proven (prefix/projection digests and the tail anchor all still hold) — only the shape differs.
  const envelope = readEnvelope(directory);
  envelope.projectionShapeDigest = 'e'.repeat(64);
  writeEnvelope(directory, envelope);
  appendTailRows(directory, 33, 3);

  const reopened = new CoordinationStore(directory, { checkpointInterval: 16, deploymentBaseSha: SERVED_COMMIT });
  const status = reopened.startupStatus();
  assert.equal(status.checkpoint, 'stale_shape',
    'a shape change between commits is stale, never corrupt: corrupt is a repair, this is a rewrite');
  assert.equal(status.source, 'ledger_fallback', 'the ledger is authoritative for the full replay');
  assert.equal(status.checkpointEvents, 0, 'nothing is reused from another shape\u2019s cache');
  assert.equal(status.replayedEvents, 35, 'every row replays');
  assert.equal(reopened.snapshot().lastSeq, 35);
  assert.equal(status.checkpointReason, 'projection_shape_digest');
  assert.deepEqual(status.checkpointDetail, {
    field: 'projectionShapeDigest',
    expected: abbrev(SHAPE),
    actual: abbrev('e'.repeat(64)),
    servedCommit: SERVED_COMMIT,
  }, 'the open row names which shape and which served commit wrote the checkpoint');

  // The open rewrites the cache after the replay it just paid, so the NEXT open is bounded.
  assert.equal(status.checkpointRewrite?.state, 'written',
    'the stale-shape open writes a fresh checkpoint when the replay completes');
  assert.ok(Number.isSafeInteger(status.checkpointRewrite.bytes) && status.checkpointRewrite.bytes > 0,
    'naming the bytes it wrote');
  const rewritten = readEnvelope(directory);
  assert.equal(rewritten.projectionShapeDigest, SHAPE,
    'the rewrite records this build\u2019s own shape');
  assert.equal(rewritten.servedCommit, SERVED_COMMIT, 'and the commit that served the open');
  assert.equal(rewritten.coversSeq, 35);
  reopened.releaseWriterLease({ requireOwned: true });

  // Restart again on the same commit: the checkpoint is USED and only the rows past it replay.
  appendTailRows(directory, 36, 2);
  const second = new CoordinationStore(directory, { checkpointInterval: 16, deploymentBaseSha: SERVED_COMMIT });
  const secondStatus = second.startupStatus();
  assert.equal(secondStatus.checkpoint, 'valid', 'the second open uses the checkpoint the first one wrote');
  assert.equal(secondStatus.source, 'checkpoint_tail');
  assert.equal(secondStatus.checkpointEvents, 35);
  assert.equal(secondStatus.replayedEvents, 2, 'rows replayed = the rows past the checkpoint');
  assert.equal(second.snapshot().lastSeq, 37);
  assert.equal(secondStatus.checkpointRewrite ?? null, null, 'a used checkpoint is not rewritten');
});

test('449-b2: a legacy envelope that predates the shape record is stale, never corrupt', (t) => {
  const directory = root(t, 'legacy');
  const first = new CoordinationStore(directory, { checkpointInterval: 16 });
  appendRows(first, 24);
  first.releaseWriterLease({ requireOwned: true });

  // Exactly the envelope a pre-#449 build wrote: the seven proven fields, no shape record, and none
  // of the #465(4) fields (`coversSeq`, `coversLineDigest`, `swarmDictionaryFields`) — the modern
  // reader must answer it as another build's shape, never as a corrupt envelope.
  const modern = readEnvelope(directory);
  const envelope = {
    schemaVersion: modern.schemaVersion,
    authorityDigest: modern.authorityDigest,
    throughSeq: modern.coversSeq,
    prefixBytes: modern.prefixBytes,
    prefixDigest: modern.prefixDigest,
    projectionBytes: modern.projectionBytes,
    projectionDigest: modern.projectionDigest,
  };
  writeEnvelope(directory, envelope);

  const reopened = new CoordinationStore(directory);
  const status = reopened.startupStatus();
  assert.equal(status.checkpoint, 'stale_shape',
    'the observed production case: an older commit\u2019s checkpoint is stale, not corrupt');
  assert.equal(status.checkpointReason, 'projection_shape_digest');
  assert.equal(status.checkpointDetail.actual, null, 'the legacy envelope recorded no shape');
  assert.equal(status.checkpointDetail.servedCommit, null);
  assert.equal(status.replayedEvents, 24);
  assert.equal(status.checkpointRewrite?.state, 'written', 'and the open rewrites it for the next one');
  assert.equal(readEnvelope(directory).projectionShapeDigest, SHAPE);
  reopened.releaseWriterLease({ requireOwned: true });
});

test('449-c: an envelope invariant failure still opens corrupt (#397 unchanged) and is never rewritten', (t) => {
  const directory = root(t, 'corrupt');
  const first = new CoordinationStore(directory, { checkpointInterval: 16 });
  appendRows(first, 16);
  first.releaseWriterLease({ requireOwned: true });
  appendTailRows(directory, 17, 2);

  const path = join(directory, CHECKPOINT);
  const before = readFileSync(path);
  const ledgerPath = join(directory, 'events.jsonl');
  const original = readFileSync(ledgerPath, 'utf8');
  const tampered = original.replace('"index":1}', '"index":9}');
  assert.notEqual(tampered, original);
  assert.equal(tampered.length, original.length, 'the prefix byte flips without reshaping the line');
  writeFileSync(ledgerPath, tampered);

  const reopened = new CoordinationStore(directory);
  const status = reopened.startupStatus();
  assert.equal(status.checkpoint, 'corrupt');
  assert.equal(status.source, 'ledger_fallback', 'a real corruption falls back to the full ledger');
  assert.equal(status.checkpointReason, 'prefix_digest');
  assert.equal(status.checkpointRewrite ?? null, null,
    'corruption\u2019s remedy is a repair, not a rewrite over the refused bytes');
  assert.deepEqual(readFileSync(path), before, 'the refused checkpoint is left exactly as it was');
  assert.equal(reopened.snapshot().lastSeq, 18);
  reopened.releaseWriterLease({ requireOwned: true });
});

test('449-d: a leftover checkpoint temp file is swept on open and named', (t) => {
  const directory = root(t, 'swept');
  const first = new CoordinationStore(directory, { checkpointInterval: 16 });
  appendRows(first, 24);
  first.releaseWriterLease({ requireOwned: true });

  const leftover = `${TEMP_PREFIX}11111111-2222-4333-8444-555555555555`;
  writeFileSync(join(directory, leftover), Buffer.from('half-written checkpoint'), { mode: 0o600 });

  const reopened = new CoordinationStore(directory);
  assert.equal(existsSync(join(directory, leftover)), false, 'the crashed write\u2019s temp file is swept');
  assert.deepEqual([...reopened.startupStatus().checkpointSwept], [leftover],
    'and the open names exactly what it swept');
  assert.deepEqual(readdirSync(directory).filter((name) => name.startsWith(TEMP_PREFIX)), []);
  assert.equal(reopened.startupStatus().checkpoint, 'valid', 'the sweep never touches the checkpoint itself');
});

test('449-e: the resident\u2019s own open row names the stale shape, the commit that wrote it, the rewrite and the sweep', async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'baton-issue449-open-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue449@example.invalid', GIT_COMMITTER_EMAIL: 'issue449@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'issue449', GIT_COMMITTER_NAME: 'issue449' });
  execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', 'seed']);
  const deploymentRoot = join(base, 'deployment');
  const coordination = join(deploymentRoot, 'state', 'coordination');
  mkdirSync(coordination, { recursive: true });

  // The checkpoint an older resident left behind: another projection shape, written by another
  // commit, beside the temp file its last write never finished.
  const planted = new CoordinationStore(coordination, { checkpointInterval: 16, deploymentBaseSha: SERVED_COMMIT });
  appendRows(planted, 24);
  planted.releaseWriterLease({ requireOwned: true });
  const envelope = readEnvelope(coordination);
  envelope.projectionShapeDigest = 'd'.repeat(64);
  writeEnvelope(coordination, envelope);
  const leftover = `${TEMP_PREFIX}99999999-8888-4777-8666-555555555555`;
  writeFileSync(join(coordination, leftover), Buffer.from('half-written checkpoint'), { mode: 0o600 });

  const deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot,
      adapters: { codex: adapterInProcess() },
      routes: [{ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }],
      verification: { command: 'node', arguments: ['--test'] },
      resident: {
        env: { XDG_CONFIG_HOME: join(base, 'config'), HOME: join(base, 'home') },
        home: join(base, 'home'), webDrainMs: 2_000, sessionTtlMs: 60_000,
      },
    },
  });
  try {
    const report = deployment.startupReport();
    assert.equal(report?.checkpoint, 'stale_shape',
      'the row the operator reads at the flip distinguishes a shape change from corruption');
    assert.equal(report.reason, 'projection_shape_digest');
    assert.equal(report.detail?.servedCommit, SERVED_COMMIT, 'and names the commit that wrote it');
    assert.equal(report.detail?.swept?.[0], leftover, 'the sweep is named on the same row');
    assert.equal(report.detail?.rewrite?.state, 'written', 'with the rewrite the open performed');
    assert.equal(report.replayedEvents, 24, 'the stale cache was not reused: every row replayed');
  } finally {
    await deployment.close();
  }
});
