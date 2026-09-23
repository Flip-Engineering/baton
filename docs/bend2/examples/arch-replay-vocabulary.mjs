// arch-replay-vocabulary.mjs — the reference half of the event-vocabulary corpus (issue #539,
// work-bend2-architecture, review track 1: "run the same admission/fold/projection cases through
// both implementations").
//
// The corpus freezes one sixteen-row swarm trace that exercises the durable event vocabulary end
// to end — every caller-submittable kind the contract admits at the fold at least once, plus the
// runtime seeds — and then replays it under four mutations: as frozen, with row 7 replaced by a
// kind no vocabulary admits, with row 11 carrying one field its payload shape does not admit, and
// with row 13 replaced by a runtime-composed row the fold knows and the contract set does not. One
// case folds the frozen trace twice and compares the projections byte for byte. A refusal stops the
// replay at its row: every row before it stays retained, which is the preserved-history fact the
// phase-boundary rule needs.
import { SWARM_EVENT_KINDS as CALLER_KIND_LIST } from '../../../impl/src/swarm-contract.mjs';
const CALLER_KINDS = new Set(CALLER_KIND_LIST);
//   node docs/bend2/examples/arch-replay-vocabulary.mjs --emit-ledger  write the frozen trace
//   node docs/bend2/examples/arch-replay-vocabulary.mjs --run          print and record the RESULT lines
//   node docs/bend2/examples/arch-replay-vocabulary.mjs --compare      compare expect/reference/prototype
//
// It imports impl/src read-only and writes nothing into it.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { foldSwarmEvent, SWARM_EVENT_KINDS as FOLD_KINDS, swarmSnapshot } from '../../../impl/src/swarm-state.mjs';

const HERE = dirname(new URL(import.meta.url).pathname);
const LEDGER = join(HERE, 'arch-replay-vocabulary.ledger.jsonl');
const CASES = join(HERE, 'arch-replay-vocabulary.cases');
const EXPECT = join(HERE, 'arch-replay-vocabulary.expect');
const REFERENCE = join(HERE, 'arch-replay-vocabulary.reference.txt');
const PROTOTYPE = join(HERE, 'arch-replay-vocabulary.prototype.txt');

const SWARM_ID = 'sw-vocab';
const CLOCK_ISO = '2026-09-23T00:00:00.000Z';
const WORKSPACE = 'ws-0f1e2d3c4b5a69788796a5b4c3d2e1f0';

/** The frozen trace. Sixteen rows: the two runtime seeds, then every caller-submittable kind the
 * contract admits at the fold exactly once (claim_updated twice — its second row is the handoff
 * that rewrites the holder in place), then the close. The contract's own holder_released operation
 * is not among them: it is an operation kind the runtime expands into assignment releases before
 * anything is folded, so the fold itself never sees it. */
const FROZEN = [
  { kind: 'swarm.created', payload: { swarmId: SWARM_ID, purpose: 'the event-vocabulary corpus', baseCommit: '31f356b2b1cd5a32a241116c52aa96ea7133fc4a' } },
  { kind: 'swarm.participant_joined', payload: { swarmId: SWARM_ID, participantId: 'p1', role: 'lead', workspaceId: WORKSPACE } },
  { kind: 'swarm.participant_joined', payload: { swarmId: SWARM_ID, participantId: 'p2', role: 'worker' } },
  { kind: 'swarm.group_updated', payload: { swarmId: SWARM_ID, groupId: 'g-review', members: ['p1', 'p2'], purpose: 'review' } },
  { kind: 'swarm.work_updated', payload: { swarmId: SWARM_ID, workId: 'w-vocab', objective: 'the corpus work item' } },
  { kind: 'swarm.coupling_updated', payload: { swarmId: SWARM_ID, couplingId: 'c-writer', coupling: 'writer', action: 'declare', participantId: 'p1', workspaceId: WORKSPACE, name: 'the corpus checkout' } },
  { kind: 'swarm.claim_updated', payload: { swarmId: SWARM_ID, claimId: 'claim-vocab', participantId: 'p1', workId: 'w-vocab' } },
  { kind: 'swarm.assignment_updated', payload: { swarmId: SWARM_ID, assignmentId: 'as-vocab', participantId: 'p1', workId: 'w-vocab', status: 'active' } },
  {
    kind: 'swarm.proposal_updated', payload: {
      swarmId: SWARM_ID, proposalId: 'prop-vocab', participantId: 'p2', action: 'propose',
      members: ['p2'],
      plan: {
        work: [{ workId: 'w-vocab-2', objective: 'the proposed split' }],
        claims: [{ participantId: 'p2', workId: 'w-vocab-2' }],
      },
    },
  },
  { kind: 'swarm.context_updated', payload: { swarmId: SWARM_ID, key: 'corpus', body: 'the frozen vocabulary trace' } },
  { kind: 'swarm.contribution_recorded', payload: { swarmId: SWARM_ID, contributionId: 'c1', participantId: 'p1', body: 'the corpus contribution, recorded as text' } },
  { kind: 'swarm.contribution_reviewed', payload: { swarmId: SWARM_ID, contributionId: 'c1', reviewerId: 'p2', decision: 'accept' } },
  { kind: 'swarm.policy_updated', payload: { swarmId: SWARM_ID, rerouteOnProviderFault: 'manual' } },
  { kind: 'swarm.claim_updated', payload: { swarmId: SWARM_ID, claimId: 'claim-vocab', participantId: 'p1', handoffTo: 'p2' } },
  { kind: 'swarm.assignment_updated', payload: { swarmId: SWARM_ID, assignmentId: 'as-vocab', participantId: 'p1', workId: 'w-vocab', status: 'released' } },
  { kind: 'swarm.closed', payload: { swarmId: SWARM_ID, reason: 'the frozen vocabulary trace is complete' } },
];

/** The runtime-composed row the driver case swaps in: the fold knows it (it appends the bypass as
 * history on the writer record it names) and the contract's caller set does not. */
const BYPASS_ROW = {
  kind: 'swarm.coupling_writer_bypassed',
  payload: { swarmId: SWARM_ID, couplingId: 'c-writer', workspaceId: WORKSPACE, writer: 'p1', by: 'p2', sha: null, at: CLOCK_ISO },
};

/** CASE|id|mutation|replays */
function readCases() {
  return readFileSync(CASES, 'utf8').split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('CASE|'))
    .map((line) => {
      const [, id, mutation, replays] = line.split('|');
      return { id, mutation, replays };
    });
}

/** The mutated trace one case replays. A mutation names its row by the frozen sequence number,
 * counted from one, so the case file and the ledger stay in step. */
function traceFor(mutation) {
  const rows = FROZEN.map((row, index) => ({ ...row, seq: index + 1, ts: CLOCK_ISO, actor: 'corpus' }));
  if (mutation === 'forged_kind') rows[6] = { ...rows[6], kind: 'swarm.vocabulary_forged' };
  if (mutation === 'missing_field') rows[10] = { ...rows[10], payload: { swarmId: SWARM_ID, contributionId: 'c1', body: 'the corpus contribution, recorded as text' } };
  if (mutation === 'driver_row') rows[12] = { ...BYPASS_ROW, seq: rows[12].seq, ts: CLOCK_ISO, actor: 'corpus' };
  return rows;
}

const COLLECTIONS = ['participants', 'groups', 'work', 'claims', 'assignments', 'proposals', 'context', 'contributions', 'couplings'];

/** One replay of the trace into a fresh map. Answers where the decode stopped, where the fold
 * stopped, and the retained projection after the last row that folded. */
function replay(rows) {
  const swarms = new Map();
  let admitted = 0;
  let decodeStop = 0;
  let decodeCode = 'none';
  let foldStop = 0;
  let foldCode = 'none';
  for (const row of rows) {
    try {
      foldSwarmEvent(swarms, row);
    } catch (err) {
      const code = err?.code ?? err?.detail?.code ?? 'unknown';
      // A shape refusal names the vocabulary; an integrity refusal names the state. The shape
      // validation runs inside the fold, so a decode failure and a fold failure are separated by
      // re-running the shape validator alone.
      try {
        const { validateSwarmEvent } = require__state();
        validateSwarmEvent(row.kind, row.payload);
        foldStop = row.seq;
        foldCode = code;
      } catch (shapeErr) {
        decodeStop = row.seq;
        decodeCode = shapeErr?.code ?? 'unknown';
      }
      break;
    }
    admitted += 1;
  }
  const snap = swarms.has(SWARM_ID) ? swarmSnapshot(swarms).swarms.find((s) => s.swarmId === SWARM_ID) : null;
  const counts = {};
  for (const field of COLLECTIONS) counts[field] = snap ? Object.keys(snap[field] ?? {}).length : 0;
  const reviews = snap ? Object.values(snap.reviews ?? {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0) : 0;
  const policy = snap && snap.policy && typeof snap.policy === 'object' ? 1 : 0;
  const fp = `pa${counts.participants},gr${counts.groups},wo${counts.work},cl${counts.claims},as${counts.assignments},pr${counts.proposals},cx${counts.context},co${counts.contributions},rv${reviews},cp${counts.couplings},po${policy}`;
  return { admitted, decodeStop, decodeCode, foldStop, foldCode, fp, snapJson: snap ? JSON.stringify(snap) : 'null' };
}

// The state module is imported once at the top; the re-require here exists only so the decode/fold
// split reads as the two questions it is. Keep one import path.
import { validateSwarmEvent } from '../../../impl/src/swarm-state.mjs';
function require__state() {
  return { validateSwarmEvent };
}

function resultLine(caseRow) {
  const rows = traceFor(caseRow.mutation);
  const first = replay(rows);
  let rerunIdentical = 'na';
  if (caseRow.replays === 'twice') {
    rerunIdentical = replay(rows).snapJson === first.snapJson ? 'true' : 'false';
  }
  const callerRows = rows
    .slice(0, first.admitted)
    .filter((row) => CALLER_KINDS.has(row.kind))
    .length;
  return `RESULT|${caseRow.id}|rows=${rows.length}|admitted=${first.admitted}`
    + `|decode_stop=${first.decodeStop}|decode_code=${first.decodeCode}`
    + `|fold_stop=${first.foldStop}|fold_code=${first.foldCode}`
    + `|caller_rows=${callerRows}|fp=${first.fp}|rerun_identical=${rerunIdentical}`;
}

function compare() {
  const expect = readFileSync(EXPECT, 'utf8').split('\n').filter((line) => line.startsWith('EXPECT|'));
  const reference = readFileSync(REFERENCE, 'utf8').split('\n').filter((line) => line.startsWith('RESULT|'));
  const prototype = readFileSync(PROTOTYPE, 'utf8').split('\n').filter((line) => line.startsWith('RESULT|'));
  const byId = (lines) => new Map(lines.map((line) => [line.split('|')[1], line]));
  const e = byId(expect);
  const r = byId(reference);
  const p = byId(prototype);
  let disagreements = 0;
  for (const [id, expected] of e) {
    const ref = r.get(id);
    const proto = p.get(id);
    if (ref === expected && proto === expected) {
      console.log(`CASE ${id}: agreement`);
    } else {
      disagreements += 1;
      console.log(`CASE ${id}: DISAGREEMENT`);
      if (ref !== expected) console.log(`  reference: ${ref}`);
      if (proto !== expected) console.log(`  prototype: ${proto}`);
    }
  }
  console.log(`cases compared: ${e.size}; disagreements: ${disagreements}`);
  return disagreements;
}

const mode = process.argv[2] ?? '--run';
if (mode === '--emit-ledger') {
  writeFileSync(LEDGER, FROZEN.map((row, index) => JSON.stringify({ ...row, seq: index + 1, ts: CLOCK_ISO, actor: 'corpus' })).join('\n') + '\n');
  console.log(`wrote ${LEDGER} (${FROZEN.length} rows)`);
} else if (mode === '--compare') {
  process.exitCode = compare() === 0 ? 0 : 1;
} else {
  const lines = readCases().map(resultLine);
  console.log(lines.join('\n'));
  writeFileSync(REFERENCE, lines.join('\n') + '\n');
}
