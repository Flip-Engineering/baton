// Issue #629 — replay tolerates a recorded kind whose fold left the tree with its mechanism.
//
// The #598 removals took the coordination board out of the tree first (and the context, package,
// publication, REPL and export families beside it). A resident opening a ledger that already
// holds such rows refused the whole startup with `unsupported_event_kind`, so master could not
// serve its own deployment's history. The row is retained history: replay keeps it in the ledger
// and the projection takes no state from it, because the mechanism that gave it state is gone.
//
// The fixture is the real `board.item_posted` rows of the operator's deployment ledger
// (impl/test/fixtures/issue629/board-item-posted.jsonl). Their recorded content — kind, actor,
// ts, payload and idempotencyKey — is verbatim; only `seq` is renumbered, because replay
// requires each row's seq to equal its position in the ledger. The live-append tripwire is
// pinned beside it: a kind the fold cannot represent must still never reach the projection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CoordinationStore } from '../src/coordination-store.mjs';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'issue629', 'board-item-posted.jsonl');
const RETIRED_KIND = 'board.item_posted';

function fixtureLedger(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-629-${label}-`));
  const directory = join(root, 'coordination');
  mkdirSync(directory, { recursive: true });
  const rows = readFileSync(FIXTURE, 'utf8').split('\n').filter((line) => line !== '');
  writeFileSync(join(directory, 'events.jsonl'), `${rows.join('\n')}\n`);
  return { root, directory, rows };
}

test('#629: a ledger of real rows whose kind left the tree replays instead of refusing startup', () => {
  const { root, directory, rows } = fixtureLedger('replay');
  try {
    assert.ok(rows.length > 0, 'the fixture carries the real removed-kind rows');
    assert.deepEqual([...new Set(rows.map((line) => JSON.parse(line).kind))], [RETIRED_KIND],
      'and every one of them is of the removed kind');
    const store = new CoordinationStore(directory);
    assert.equal(store._events.length, rows.length,
      'every recorded row stays in the ledger — the kind is skipped, the row is not dropped');
    assert.equal(store._tasks.size, 0, 'and the projection takes no state from a kind with no fold');
    assert.equal(store._swarms.size, 0, 'no swarm fold runs for it either');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('#629: the no-fold tripwire still refuses a LIVE append of a kind the fold cannot represent', () => {
  const { root, directory } = fixtureLedger('live');
  try {
    const store = new CoordinationStore(directory);
    assert.throws(() => store._apply({
      schemaVersion: 1, seq: 1, ts: '2026-09-28T00:00:00.000Z', kind: RETIRED_KIND,
      actor: 'orchestrator', idempotencyKey: 'issue629:live', payload: {},
    }), (error) => error?.code === 'unsupported_event_kind');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
