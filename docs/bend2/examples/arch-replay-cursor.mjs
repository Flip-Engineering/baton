// arch-replay-cursor.mjs — the reference half of the cursor and restart corpus (issue #539,
// work-bend2-architecture, review track 1: "run the same admission/fold/projection cases through
// both implementations").
//
// This corpus asks what a restart does to the projection a consumer resumes from, and what a
// checkpoint written under one basis does when the next open supplies another. It reports the
// startup source the store chose, the checkpoint's verdict, the cursor the projection reaches, and
// the rows a consumer that read through seq 1 is still owed.
//
//   node docs/bend2/examples/arch-replay-cursor.mjs --emit-ledger   write the frozen trace
//   node docs/bend2/examples/arch-replay-cursor.mjs --run           print and record the RESULT lines
//   node docs/bend2/examples/arch-replay-cursor.mjs --compare       compare expect/reference/prototype
//
// Working state is written under the system temp directory and removed on exit. It imports impl/src
// read-only and writes nothing into it.

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CoordinationStore } from '../../../impl/src/coordination-store.mjs';
import { DEFAULT_RUN_LINEAGE_POLICY } from '../../../impl/src/run-lineage.mjs';

const HERE = dirname(new URL(import.meta.url).pathname);
const LEDGER = join(HERE, 'arch-replay-cursor.ledger.jsonl');
const CASES = join(HERE, 'arch-replay-cursor.cases');
const EXPECT = join(HERE, 'arch-replay-cursor.expect');
const REFERENCE = join(HERE, 'arch-replay-cursor.reference.txt');
const PROTOTYPE = join(HERE, 'arch-replay-cursor.prototype.txt');

const REPO = 'repo-arch-replay-cursor';
const CLOCK_ISO = '2026-09-23T00:00:00.000Z';

const CHANGED_POLICY = Object.freeze({
  ...DEFAULT_RUN_LINEAGE_POLICY,
  leaseTtlMs: DEFAULT_RUN_LINEAGE_POLICY.leaseTtlMs + 1_000,
});

const scratchRoots = [];
function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-arch-cursor-${label}-`));
  scratchRoots.push(root);
  return root;
}
function cleanScratch() {
  for (const root of scratchRoots) rmSync(root, { recursive: true, force: true });
  scratchRoots.length = 0;
}

function taskPayload(index) {
  return {
    id: `task-cursor-${index}`,
    brief: { objective: `Unit ${index}`, capabilities: ['baton_orchestrator'] },
    deps: [], refines: null, relation: 'root', runId: `run-cursor-${index}`, taskType: 'general',
    reservedWorkerId: `worker-cursor-${index}`, vendorRequested: 'mock', modelRequested: 'model-a',
    modelPolicy: null, effortRequested: 'low', sessionRequest: { mode: 'new' },
  };
}

/** Write the trace with the implementation's own verb, then freeze its bytes. */
function emitLedger() {
  const root = scratch('emit');
  const store = new CoordinationStore(root, {
    repoId: REPO, clock: () => CLOCK_ISO, runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY,
  });
  for (let index = 0; index < 4; index += 1) {
    store.createTask(taskPayload(index), { actor: 'orchestrator', key: `task.created:task-cursor-${index}` });
  }
  const bytes = readFileSync(join(root, 'events.jsonl'), 'utf8');
  writeFileSync(LEDGER, bytes);
  process.stdout.write(`arch-replay-cursor.ledger.jsonl written: ${Buffer.byteLength(bytes)} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}\n`);
  cleanScratch();
}

/** CASE|id|restart|basis|rows|readerCursor */
function readCases() {
  return readFileSync(CASES, 'utf8').split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('CASE|'))
    .map((line) => {
      const [, id, restart, basis, rows, readerCursor] = line.split('|');
      return { id, restart, basis, rows: Number(rows), readerCursor: Number(readerCursor) };
    });
}

/** Copy the first `rows` ledger rows into a fresh root. */
function seedRoot(caseRow) {
  const root = scratch(caseRow.id);
  const rows = readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).slice(0, caseRow.rows);
  writeFileSync(join(root, 'events.jsonl'), `${rows.join('\n')}\n`);
  return root;
}

function open(root, basis) {
  const options = { repoId: REPO, clock: () => CLOCK_ISO };
  if (basis !== 'missing') {
    options.runLineagePolicy = basis === 'changed' ? CHANGED_POLICY : DEFAULT_RUN_LINEAGE_POLICY;
  }
  return new CoordinationStore(root, options);
}

/** Replay one case: open, optionally write a checkpoint, optionally restart under a basis. */
async function replay(caseRow) {
  const root = seedRoot(caseRow);
  let source = 'live';
  let checkpoint = 'none';
  let cursor;
  let checkpointBytes = null;

  if (caseRow.restart === 'none') {
    const store = open(root, caseRow.basis);
    cursor = store.snapshot().lastSeq;
  } else {
    const first = open(root, 'same');
    cursor = first.snapshot().lastSeq;
    const wrote = await first._writeProjectionCheckpoint({});
    checkpointBytes = wrote.bytes ?? null;
    first.close?.();
    const restarted = open(root, caseRow.basis);
    const status = restarted.startupStatus();
    source = status.source;
    checkpoint = status.checkpoint;
    cursor = restarted.snapshot().lastSeq;
  }

  return {
    source,
    checkpoint,
    cursor,
    owed: cursor - caseRow.readerCursor,
    checkpointBytes,
  };
}

const resultLine = (id, r) => [
  'RESULT', id,
  `source=${r.source}`,
  `checkpoint=${r.checkpoint}`,
  `cursor=${r.cursor}`,
  `owed=${r.owed}`,
].join('|');

async function run() {
  const lines = [];
  for (const caseRow of readCases()) {
    const outcome = await replay(caseRow);
    lines.push(resultLine(caseRow.id, outcome));
    process.stderr.write(`${caseRow.id}: ${JSON.stringify(outcome)}\n`);
  }
  writeFileSync(REFERENCE, `${lines.join('\n')}\n`);
  process.stdout.write(`${lines.join('\n')}\n`);
  cleanScratch();
}

/** EXPECT|id|source|checkpoint|cursor|owed */
function readExpect() {
  const out = new Map();
  for (const line of readFileSync(EXPECT, 'utf8').split('\n')) {
    if (!line.startsWith('EXPECT|')) continue;
    const [, id, source, checkpoint, cursor, owed] = line.trim().split('|');
    out.set(id, { id, source, checkpoint, cursor, owed });
  }
  return out;
}

function readResults(file) {
  const out = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.startsWith('RESULT|')) continue;
    const [, id, ...fields] = line.trim().split('|');
    out.set(id, Object.fromEntries(fields.map((field) => field.split('='))));
  }
  return out;
}

const REQUIRED = ['source', 'checkpoint', 'cursor', 'owed'];

function compare() {
  const expect = readExpect();
  const reference = readResults(REFERENCE);
  const prototype = readResults(PROTOTYPE);
  let disagreements = 0;
  for (const [id, want] of expect) {
    const differs = (row) => REQUIRED.filter((field) => String(row?.[field]) !== String(want[field]));
    const referenceDiffers = differs(reference.get(id));
    const prototypeDiffers = differs(prototype.get(id));
    const verdict = referenceDiffers.length === 0 && prototypeDiffers.length === 0 ? 'AGREEMENT' : 'DISAGREEMENT';
    if (verdict === 'DISAGREEMENT') disagreements += 1;
    const ref = reference.get(id);
    const proto = prototype.get(id);
    process.stdout.write(`CASE ${id}: ${verdict}\n`);
    process.stdout.write(`  required   : source=${want.source} checkpoint=${want.checkpoint} cursor=${want.cursor} owed=${want.owed}\n`);
    process.stdout.write(`  reference  : source=${ref?.source} checkpoint=${ref?.checkpoint} cursor=${ref?.cursor} owed=${ref?.owed}\n`);
    if (referenceDiffers.length > 0) process.stdout.write(`  reference differs on: ${referenceDiffers.join(', ')}\n`);
    process.stdout.write(`  prototype  : source=${proto?.source} checkpoint=${proto?.checkpoint} cursor=${proto?.cursor} owed=${proto?.owed}\n`);
    if (prototypeDiffers.length > 0) process.stdout.write(`  prototype differs on: ${prototypeDiffers.join(', ')}\n`);
  }
  process.stdout.write(`cases compared: ${expect.size}; disagreements: ${disagreements}\n`);
}

const mode = process.argv[2] ?? '--run';
if (mode === '--emit-ledger') emitLedger();
else if (mode === '--run') await run();
else if (mode === '--compare') compare();
else {
  process.stderr.write('usage: node docs/bend2/examples/arch-replay-cursor.mjs [--emit-ledger|--run|--compare]\n');
  process.exit(2);
}
