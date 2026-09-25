// Issue #304 — the replay corpus. The #292 regression class: a fold-time admissibility rule
// that tightens what may be admitted also replays the ledger at startup, so it bricks every
// resident whose history predates the rule — and the suite never saw it, because every fixture
// was written under the new rule. The corpus closes that: real coordination ledgers (this
// session's main and master deployments, reduced by impl/scripts/ledger-extract.mjs to the
// rows the swarm fold consumes) are committed as fixtures and replayed here through
// foldSwarmEvent from an empty state, with the folded projection pinned to the sidecar digest
// the extractor recorded. A fold rule that refuses recorded history now fails THIS row, named,
// on the author's machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { SWARM_EVENT_KINDS, foldSwarmEvent, swarmSnapshot } from '../src/swarm-state.mjs';
import { extractLedger, findTokenShaped, fixtureCeilingBytes, main as extractMain } from '../scripts/ledger-extract.mjs';

const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ledgers');
const isSwarmRow = (event) => SWARM_EVENT_KINDS.has(event.kind);
const isSwarmOperationRow = (event) => event.kind === 'driver.recorded'
  && typeof event.payload?.kind === 'string' && event.payload.kind.startsWith('swarm.');
const corpusFiles = () => readdirSync(CORPUS_DIR).filter((name) => name.endsWith('.jsonl')).sort();
const readFixture = (name) => readFileSync(join(CORPUS_DIR, name), 'utf8').split('\n').filter((line) => line !== '');

test('every committed ledger fixture replays through foldSwarmEvent from an empty state to its sidecar digest', () => {
  assert.ok(corpusFiles().length >= 2, 'the corpus holds the real deployment ledgers it exists for');
  for (const name of corpusFiles()) {
    const rows = readFixture(name).map((line) => JSON.parse(line));
    assert.ok(rows.length > 0, `${name} is not an empty fixture`);
    const swarms = new Map();
    for (const event of rows) {
      if (!isSwarmRow(event)) continue; // the store's replay folds only SWARM_EVENT_KINDS rows
      foldSwarmEvent(swarms, event); // replay semantics: no admission flag — recorded history folds as admitted
    }
    const digest = createHash('sha256').update(JSON.stringify(swarmSnapshot(swarms))).digest('hex');
    const sidecar = JSON.parse(readFileSync(join(CORPUS_DIR, `${name}.digest`), 'utf8'));
    assert.equal(sidecar.schemaVersion, 1, `${name}.digest is the extractor's sidecar`);
    assert.ok(sidecar.source?.path, `${name}.digest names the real ledger it was extracted from`);
    assert.equal(digest, sidecar.digest,
      `${name} no longer replays to its recorded projection — a fold rule refused or reshaped recorded history`);
  }
});

test('the corpus is a reduction the fold consumes: swarm rows plus swarm-operation records, in ledger order', () => {
  for (const name of corpusFiles()) {
    const lines = readFixture(name);
    let previousSeq = 0;
    for (const [index, line] of lines.entries()) {
      const event = JSON.parse(line);
      assert.ok(isSwarmRow(event) || isSwarmOperationRow(event),
        `${name} line ${index + 1}: ${event.kind} is neither a swarm event nor a swarm operation record`);
      assert.ok(Number.isSafeInteger(event.seq) && event.seq > previousSeq,
        `${name} line ${index + 1}: rows keep their original ledger order`);
      previousSeq = event.seq;
    }
  }
});

test('the corpus covers the fold rule families a tightening rule would break', () => {
  const seen = new Set();
  for (const name of corpusFiles()) {
    for (const line of readFixture(name)) seen.add(JSON.parse(line).kind);
  }
  for (const kind of [
    'swarm.created', 'swarm.participant_joined', 'swarm.participant_bound', 'swarm.group_updated',
    'swarm.work_updated', 'swarm.coupling_updated', 'swarm.contribution_recorded',
    'swarm.contribution_reviewed', 'swarm.contribution_revision_attached', 'swarm.closed',
  ]) {
    assert.ok(seen.has(kind), `the corpus exercises no ${kind} row — extract a ledger that does`);
  }
});

test('every fixture stays bounded whole-swarms against the repository fixture ceiling, and carries no token-shaped value', () => {
  const ceiling = fixtureCeilingBytes();
  assert.ok(ceiling > 0, 'the repository fixture ceiling is derivable from impl/test/fixtures');
  for (const name of corpusFiles()) {
    const sidecar = JSON.parse(readFileSync(join(CORPUS_DIR, `${name}.digest`), 'utf8'));
    const bytes = Buffer.byteLength(readFileSync(join(CORPUS_DIR, name), 'utf8'));
    const wholeOverage = sidecar.fixture.swarmsKept === 1 && sidecar.fixture.swarmsDropped > 0;
    assert.ok(bytes <= ceiling || wholeOverage,
      `${name} exceeds the fixture ceiling without the documented single-whole-swarm overage`);
    for (const [index, line] of readFixture(name).entries()) {
      assert.deepEqual(findTokenShaped(line), [], `${name} line ${index + 1} carries a token-shaped value`);
    }
  }
});

test('the extractor reduces a synthetic ledger, bounds earliest swarms whole, and digests deterministically', () => {
  const swarm = (swarmId, close) => [
    { schemaVersion: 1, seq: 0, ts: '2026-09-14T10:00:00.000Z', kind: 'swarm.created', actor: 'owner', idempotencyKey: `${swarmId}-create`, payload: { swarmId, purpose: 'synthetic' } },
    { schemaVersion: 1, seq: 0, ts: '2026-09-14T10:00:01.000Z', kind: 'swarm.participant_joined', actor: 'owner', idempotencyKey: `${swarmId}-join`, payload: { swarmId, participantId: 'builder' } },
    ...(close ? [{ schemaVersion: 1, seq: 0, ts: '2026-09-14T10:00:02.000Z', kind: 'swarm.closed', actor: 'owner', idempotencyKey: `${swarmId}-close`, payload: { swarmId, reason: 'done' } }] : []),
  ];
  const directory = mkdtempSync(join(tmpdir(), 'baton-ledger-extract-'));
  try {
    const rows = [...swarm('sw-early', true), ...swarm('sw-late', false)];
    const ledger = join(directory, 'events.jsonl');
    writeFileSync(ledger, `${rows.map((row, index) => JSON.stringify({ ...row, seq: index + 1 })).join('\n')}\n`);
    const out = join(directory, 'extract.jsonl');
    const extraction = extractLedger(ledger, { ceilingBytes: Buffer.byteLength(readFileSync(ledger)) / 2 });
    assert.deepEqual(extraction.swarmIdsKept, ['sw-early'], 'the earliest swarm is kept whole');
    assert.deepEqual(extraction.swarmIdsDropped, ['sw-late'], 'the later swarm is dropped whole, never truncated');
    assert.equal(extraction.digest, createHash('sha256').update(JSON.stringify(swarmSnapshot((() => {
      const swarms = new Map();
      for (const line of extraction.fixture) foldSwarmEvent(swarms, JSON.parse(line));
      return swarms;
    })()))).digest('hex'), 'the recorded digest is the folded projection of the written fixture');
    // The CLI writes the fixture and a sidecar that names the digest.
    const code = extractMain([ledger, out]);
    assert.equal(code, 0, 'the extractor CLI succeeds on a well-formed ledger');
    assert.equal(JSON.parse(readFileSync(`${out}.digest`, 'utf8')).digest, extractLedger(ledger).digest, 'the CLI sidecar records the same digest');
    // A token-shaped value refuses instead of surviving into a fixture.
    const poisoned = join(directory, 'poisoned.jsonl');
    writeFileSync(poisoned, `${JSON.stringify(rows[0])}\n`.replace('synthetic', 'sk-abcdef0123456789-secret'));
    assert.throws(() => extractLedger(poisoned), (error) => error.code === 'ledger_extract_token_shaped',
      'a token-shaped value refuses extraction instead of surviving into a fixture');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
