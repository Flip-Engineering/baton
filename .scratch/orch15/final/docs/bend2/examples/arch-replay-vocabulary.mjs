// arch-replay-vocabulary.mjs — the reference half of the event-vocabulary corpus (issue #539,
// work-bend2-architecture, review track 1: "run the same admission/fold/projection cases through
// both implementations").
//
// The corpus freezes one thirty-row swarm trace that exercises the durable event vocabulary end
// to end — twelve of the thirteen caller-submittable kinds the contract admits at the fold and
// all twenty-five kinds the fold vocabulary holds, plus the runtime seeds and the runtime-composed
// rows — and then replays it under four mutations: as frozen, with row 7 replaced by a kind no
// vocabulary admits, with row 11 carrying one field its payload shape does not admit, and with
// row 13 replaced by a runtime-composed row the fold knows and the contract set does not. One
// case folds the frozen trace twice and compares the projections byte for byte. A refusal stops
// the replay at its row: every row before it stays retained, which is the preserved-history fact
// the phase-boundary rule needs.
import { SWARM_EVENT_KINDS as CALLER_KIND_LIST } from '../../../impl/src/swarm-contract.mjs';
const CALLER_KINDS = new Set(CALLER_KIND_LIST);
//   node docs/bend2/examples/arch-replay-vocabulary.mjs --emit-ledger  write the frozen trace
//   node docs/bend2/examples/arch-replay-vocabulary.mjs --run          print the RESULT lines
//   node docs/bend2/examples/arch-replay-vocabulary.mjs --compare      run both halves live and compare them against expect
//
// It imports impl/src read-only and writes nothing into it.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

import { foldSwarmEvent, SWARM_EVENT_KINDS as FOLD_KINDS, swarmSnapshot } from '../../../impl/src/swarm-state.mjs';

const HERE = dirname(new URL(import.meta.url).pathname);
const LEDGER = join(HERE, 'arch-replay-vocabulary.ledger.jsonl');
const CASES = join(HERE, 'arch-replay-vocabulary.cases');
const EXPECT = join(HERE, 'arch-replay-vocabulary.expect');
const BEND = join(HERE, '../../../node_modules/.bend/bin/bend');
const PROTOTYPE_SOURCE = join(HERE, 'arch-replay-vocabulary.bend');

const SWARM_ID = 'sw-vocab';
const CLOCK_ISO = '2026-09-23T00:00:00.000Z';
const WORKSPACE = 'ws-0f1e2d3c4b5a69788796a5b4c3d2e1f0';

/** The frozen trace. Thirty rows: the two runtime seeds; the caller-submittable kinds the
 * contract admits at the fold — claim_updated twice, its second row the handoff that rewrites
 * the holder in place, and policy_updated twice, the second setting the auto mode the re-route
 * rows answer under — and swarm.participant_left, the caller-submittable kind whose row settles
 * the departed seat; the runtime-composed kinds the contract set excludes — the binding, the
 * revision, the landing receipt, the writer bypass, the runtime loss, the provider fault, the
 * re-route proposal, the successor's join, the workspace carry, the performed re-route, the
 * resume question and its answer; then the close. Every kind the fold vocabulary holds appears
 * once the trace is whole. The contract's own holder_released operation is not among them: it is
 * an operation kind the runtime expands into assignment releases before anything is folded, so
 * the fold itself never sees it. */
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
  { kind: 'swarm.participant_bound', payload: { swarmId: SWARM_ID, participantId: 'p1', workerId: 'wk-p1', taskId: 'tk-p1', sessionId: 's-p1', workspaceId: WORKSPACE } },
  { kind: 'swarm.contribution_revision_attached', payload: { swarmId: SWARM_ID, contributionId: 'c1', participantId: 'p1', sha: '1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a', ref: 'refs/retain/sw-vocab/c1', workspaceId: WORKSPACE, observedHead: '2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b', mergeBase: '3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c' } },
  { kind: 'swarm.contribution_integrated', payload: { swarmId: SWARM_ID, contributionId: 'c1', participantId: 'p1', base: '4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d', targetHeadBefore: '5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e', targetHeadAfter: '6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f', squashSha: '7070707070707070707070707070707070707070', target: 'bend2-rewrite', changedPaths: ['docs/bend2/examples/arch-replay-vocabulary.mjs'], gates: { files: ['docs/bend2/examples/arch-replay-vocabulary.mjs'], verdictLine: 'cases compared: 5; disagreements: 0' }, issue: 539 } },
  { kind: 'swarm.coupling_writer_bypassed', payload: { swarmId: SWARM_ID, couplingId: 'c-writer', workspaceId: WORKSPACE, writer: 'p1', by: 'p2', sha: '8181818181818181818181818181818181818181', at: CLOCK_ISO } },
  { kind: 'swarm.participant_runtime_lost', payload: { swarmId: SWARM_ID, participantId: 'p2', workerId: 'wk-p2', incarnation: 0, at: CLOCK_ISO } },
  { kind: 'swarm.policy_updated', payload: { swarmId: SWARM_ID, rerouteOnProviderFault: 'auto' } },
  { kind: 'swarm.participant_faulted', payload: { swarmId: SWARM_ID, participantId: 'p1', workerId: 'wk-p1', code: 'provider_quota', route: { harness: 'omp', model: 'glm-5.3-flash', effort: 'high' }, resetAtText: 'quota resets 2026-09-23T01:00:00.000Z', snapshotSha: '9292929292929292929292929292929292929292' } },
  {
    kind: 'swarm.reroute_proposed', payload: {
      swarmId: SWARM_ID, participantId: 'p1', workerId: 'wk-p1',
      from: { harness: 'omp', model: 'glm-5.3-flash', effort: 'high' },
      code: 'provider_quota', policy: 'auto',
      candidates: [{ harness: 'omp', model: 'deepseek-v4-pro', effort: 'high', billing: 'api', reason: 'api_fallback' }],
      carry: { snapshotSha: '9292929292929292929292929292929292929292', checkpoint: { sha: '3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c', ref: 'refs/checkpoint/p1' } },
    },
  },
  { kind: 'swarm.participant_joined', payload: { swarmId: SWARM_ID, participantId: 'p3', role: 'worker', resumeFrom: 'p1' } },
  { kind: 'workspace.carried_from', payload: { swarmId: SWARM_ID, participantId: 'p3', workspaceId: WORKSPACE, predecessor: 'p1', paths: ['docs/bend2'], how: 'bound' } },
  { kind: 'swarm.rerouted', payload: { swarmId: SWARM_ID, successor: 'p3', carriedFrom: 'p1', from: { harness: 'omp', model: 'glm-5.3-flash', effort: 'high' }, to: { harness: 'omp', model: 'deepseek-v4-pro', effort: 'high' }, proposalSeq: 23 } },
  { kind: 'swarm.resume_decision_requested', payload: { swarmId: SWARM_ID, participantId: 'p3', predecessor: 'p1', carry: { how: 'bound', workspaceId: WORKSPACE, snapshotSha: null } } },
  { kind: 'swarm.resume_decision_answered', payload: { swarmId: SWARM_ID, participantId: 'p3', predecessor: 'p1', guidance: { seq: 28, messageId: 'g-resume-p3' } } },
  { kind: 'swarm.participant_left', payload: { swarmId: SWARM_ID, participantId: 'p1', reason: 'the provider fault settled by the performed re-route' } },
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

/** The prototype half, run live at the pinned toolchain: the corpus's own bend program answers
 * the same case file, and its stdout is the only prototype answer this comparison reads. */
function bendPrototypeLines() {
  if (!existsSync(BEND)) {
    process.stderr.write(`the pinned bend binary is missing: ${BEND}\n`);
    process.exit(1);
  }
  const out = spawnSync(BEND, [PROTOTYPE_SOURCE], { env: { ...process.env, BEND_NO_TELEMETRY: '1' }, encoding: 'utf8' });
  if (out.error || out.status !== 0) {
    process.stderr.write(`the bend run failed: ${out.error?.message ?? out.stderr ?? ''}\n`);
    process.exit(1);
  }
  return out.stdout.split('\n').filter((line) => line.startsWith('RESULT|'));
}

function compare() {
  const value = (line) => line.slice(line.indexOf('|') + 1);
  const expect = readFileSync(EXPECT, 'utf8').split('\n').filter((line) => line.startsWith('EXPECT|'));
  const reference = readCases().map(resultLine);
  const prototype = bendPrototypeLines();
  const byId = (lines) => new Map(lines.map((line) => [line.split('|')[1], value(line)]));
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
      console.log(`  required  : ${expected}`);
      if (ref !== expected) console.log(`  reference : ${ref}`);
      if (proto !== expected) console.log(`  prototype : ${proto}`);
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
  console.log(readCases().map(resultLine).join('\n'));
}
