// Issue #70 red suite — the folded cross-deployment-knowledge contract v1.1.
// Source of truth: docs/reference/evidence/cross-deployment-knowledge-2026-08-07/
//   cross-deployment-knowledge-contract.md (v1.1) + contract-fold.md + contract-redteam.md + suite-70-brief.md.
//
// The rung: every deployment root carries its own KG; the PKG-1 descriptor names a designated
// project-primary root (`knowledge.primaryRoot`), promotion into the project KG is primary-only
// (the single-writer lease law made visible, wired to EVERY promotion path), every other root
// PROJECTS the primary's project-persistent promotion events as a read-only, event-seq-anchored
// replica, and every project answer — including a self-declared primary's own — names its source
// root + epoch lag, UNTRUSTED-framed, never an authority input. Every capability row below is RED
// at HEAD (the behavior is absent from this tree) and fails at a NAMED stage; the PIN rows are
// green today by construction and must STAY green on the implementation (the fold's "must NOT
// change").
//
// Row inventory (28 rows — 19 RED / 9 PIN):
//   A1-R1 RED  D4 accepts the closed knowledge:{primaryRoot} field   (descriptor has no knowledge field)
//   A1-R2 RED  D4 unknown key under knowledge refuses at open        (descriptor has no knowledge field)
//   A1-R3 RED  D4 escaping path refuses at open                      (descriptor has no knowledge field)
//   A1-R4 RED  D4 symlink path refuses at open                       (descriptor has no knowledge field)
//   A1-R5 RED  D4 non-deployment-root path refuses at open           (descriptor has no knowledge field)
//   A1-P1 PIN  D4 absent = per-root local (byte-identical to HEAD)   (green today)
//   A2-R1 RED  D3 run.knowledge.seed (addKnowledgeNode) refuses      (no primary check)
//   A2-R2 RED  D3 verified_task_outcome (promoteKnowledgeNode) refuses (no primary check)
//   A2-R3 RED  D3 knowledge.promote (coordinator admitWorkflowFinding) refuses at the seam (no primary check)
//   A2-P1 PIN  D3 a self-primary deployment promotes normally        (green today)
//   A2-P2 PIN  D3 the #63 gate unchanged (raw store admission works) (green today)
//   A3-R1 RED  D1 a non-primary project read serves the primary node (no projection)
//   A3-R2 RED  D5 the read carries {epochLag, sourceRoot}            (no source/epoch vocabulary)
//   A3-P1 PIN  D1 foreign-seq _apply-replay refuses temporal_incoherence (green today)
//   A3-P2 PIN  GT2 per-root local — no cross-root read (green today)
//   S-R1  RED  B2 the discriminator is declared-path-vs-this-root    (no primary check)
//   S-R2  RED  OQ5 two self-declared primaries surfaced honestly     (no source/epoch vocabulary)
//   S-P1  PIN  GT1 repositoryId() shared across roots                (green today)
//   R-R1  RED  D1.2 primary-seq anchored + no merge into consumer    (no projection)
//   R-R2  RED  D1.2 dedup by primary idempotencyKey                  (no projection)
//   R-R3  RED  D1.2 strict-prefix gap law refuses unreachable        (no replay law)
//   R-P1  PIN  GT3 within-store replay-exact (reopen same dir)       (green today)
//   K-R1  RED  refusals 4-code federation family constant            (family absent)
//   K-R2  RED  refusals knowledge_cross_root_denied fires typed      (no cross-root denial)
//   K-R3  RED  refusals knowledge_projection_stale fires typed       (no staleness posture)
//   K-R4  RED  refusals knowledge_primary_unreachable fires typed    (no unreachable posture)
//   K-P1  PIN  refusals reused codes fire verbatim + read shapes     (green today)
//   G1    PIN  structural — no source/epoch vocabulary leaks into a plain store (green today)
//
// Invented surfaces (every one absent at HEAD — the first assertion on each is a behavior
// assertion so the row fails at the NAMED stage, never on a vacuous shape assertion):
//   descriptor field knowledge:{primaryRoot}           — the D4 closed field (repo-relative path)
//   store opts primaryRoot / deploymentRoot            — the deployment's declared primary root and
//     its own root (absolute paths at the store seam; the descriptor field is the repo-relative form)
//   store opt projectionReplayPosition                 — the replica's event-seq anchor in PRIMARY
//     seqs (D1.2 ii); a position the primary does not reach makes the primary unreachable
//   store opt projectionStaleCeiling                   — the deployment-owned epochLag ceiling (D5,
//     default absent = no ceiling)
//   coordinator opts primaryRoot / deploymentRoot      — the seam's own-root comparison (B2)
//   project read sourceRoot + epochLag                 — on coordinator.projectHorizon(repoId) and
//     the knowledge.recall read, INCLUDING a self-declared primary's own answers (OQ5)
//   recallKnowledge opts.strict                        — a strict project read (D5): refuses
//     knowledge_projection_stale / knowledge_primary_unreachable rather than serving a stale or
//     local-only slice as the project KG
//   coordinatorNs.KNOWLEDGE_FEDERATION_REFUSAL_CODES   — the frozen 4-code federation family
//
// Suite-law hygiene: hermetic (mkdtemp, test.after, no network, no provider spawns); fixed-clock
// stores; sorted-key literals in ACTUAL byte order; `localeCompare` banned; NUL discipline —
// coordination-store.mjs and coordinator.mjs are never read whole, only their exports are imported
// (application.mjs measures 0 NULs and is only read ranged for the run.knowledge.seed anchor);
// no clocks as controls (epochLag is ledgerHeadSeq − observedSeq, both primary seqs). Verified
// split is recorded below after two consecutive runs from the repo root.
//
// VERIFIED SPLIT — two consecutive runs from the repo root (`node --test impl/test/cross-deployment-knowledge-red.test.mjs`):
//   run 1: tests 28 · pass 9 · fail 19 · cancelled 0 · skipped 0 · todo 0
//   run 2: tests 28 · pass 9 · fail 19 · cancelled 0 · skipped 0 · todo 0
//   stable — the identical 19 rows fail at their NAMED stages on both runs; the 9 PIN rows
//   (A1-P1, A2-P1, A2-P2, A3-P1, A3-P2, S-P1, R-P1, K-P1, G1) stay green.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import test from 'node:test';

import { Coordinator } from '../src/coordinator.mjs';
import * as coordinatorNs from '../src/coordinator.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { FenceTable } from '../src/fence.mjs';
import { DEFAULT_RUN_LINEAGE_POLICY } from '../src/index.mjs';
import { Log } from '../src/log.mjs';
import { createMcpServerFromDescriptor, loadMcpDescriptor } from '../src/mcp-descriptor.mjs';

// Verified split (recorded after the fold — two consecutive runs from the repo root):
//   run 1: tests 28 · pass 9 · fail 19 · cancelled 0 · skipped 0 · todo 0
//   run 2: tests 28 · pass 9 · fail 19 · cancelled 0 · skipped 0 · todo 0
//   deterministic — the 9 passes are exactly the PIN rows (A1-P1, A2-P1, A2-P2, A3-P1, A3-P2,
//   S-P1, R-P1, K-P1, G1); the 19 failures are the RED rows, each confirmed to fail at its NAMED
//   stage.

const repoId = 'repo-cross-deployment-knowledge';
const FIXED_TS = '2026-08-12T08:00:00.000Z';
const dirs = [];
function dir(label) {
  const d = mkdtempSync(join(tmpdir(), `baton-70-${label}-`));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function digest(value) {
  const canonical = (v) => {
    if (Array.isArray(v)) return v.map(canonical);
    if (!v || typeof v !== 'object') return v;
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  };
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
const auth = (key, actor = 'orchestrator') => ({ actor, key });
const reader = (id) => Object.freeze({ actor: id, principalId: id, sessionId: `session-${id}` });

function refusalCode(fn) {
  try { fn(); return null; }
  catch (error) { return error?.code ?? error?.name ?? 'unknown_error'; }
}

// The contract's federation refusal vocabulary — ACTUAL sorted order (canonical byte order, never
// localeCompare). The exact frozen family the implementation must export.
const KNOWLEDGE_FEDERATION_REFUSAL_CODES_EXPECTED = Object.freeze([
  'knowledge_cross_root_denied',
  'knowledge_primary_conflict',
  'knowledge_primary_unreachable',
  'knowledge_projection_stale',
]);
// The reused codes the contract names verbatim — ACTUAL sorted order.
const REUSED_REFUSAL_CODES_EXPECTED = Object.freeze([
  'causal_recall_invalid',
  'causal_recall_oversize',
  'coordination_writer_busy',
  'knowledge_read_conflict',
  'knowledge_recall_conflict',
  'temporal_incoherence',
]);

// ---------------------------------------------------------------------------
// A1-rows — D4 the descriptor seam
// ---------------------------------------------------------------------------

test('A1-R1: the descriptor accepts the closed knowledge:{primaryRoot} field (RED — no knowledge field)', () => {
  const { repo, repoIdv, rootA } = a1Fixture();
  const valid = descriptorObj(repo, '.baton/taskwave-A', { primaryRoot: '.baton/taskwave-A' });
  const code = openDescriptor(valid);
  assert.equal(code, null, `the closed knowledge field opens (stage: no knowledge field in the descriptor — got ${code})`);
  const parsed = loadMcpDescriptor(writeDescriptor(valid));
  assert.equal(parsed.knowledge?.primaryRoot, '.baton/taskwave-A', 'primaryRoot survives the parse');
  assert.ok(Object.isFrozen(parsed), 'the parsed descriptor is immutable for the server\'s life (PKG-1)');
  // The pinned primaryRoot -> state/coordination derivation mirrors index.mjs:1238 /
  // application-deployment.mjs:1761; the referent is a deployment root of THIS repo.
  assert.equal(join(resolve(parsed.repo), parsed.knowledge.primaryRoot, 'state', 'coordination'),
    join(rootA, 'state', 'coordination'), 'the derivation is pinned');
  const resident = JSON.parse(readFileSync(join(resolve(parsed.repo), parsed.knowledge.primaryRoot, 'resident', 'deployment.json'), 'utf8'));
  assert.equal(resident.repoId, repoIdv, 'the referent carries the reader\'s repoId (deployment-root validation)');
});

test('A1-R2: an unknown key under knowledge refuses at open (RED — no knowledge field)', () => {
  const { repo } = a1Fixture();
  const unknownKey = descriptorObj(repo, '.baton/taskwave-A', { primaryRoot: '.baton/taskwave-A', bogus: 'x' });
  const code = openDescriptor(unknownKey);
  assert.equal(code, null, `a knowledge object with an unknown key reaches the closed-schema check (stage: no knowledge field in the descriptor — got ${code})`);
  const refusal = openDescriptor(unknownKey);
  assert.equal(refusal, 'descriptor_invalid', 'the unknown key under knowledge refuses at open (PKG-1 closed-schema discipline)');
});

test('A1-R3: a primaryRoot escaping the repo root refuses at open (RED — no knowledge field)', () => {
  const { repo } = a1Fixture();
  const escaping = descriptorObj(repo, '.baton/taskwave-A', { primaryRoot: '../escape' });
  const code = openDescriptor(escaping);
  assert.equal(code, null, `an escaping path reaches the containment check (stage: no knowledge field in the descriptor — got ${code})`);
  assert.equal(openDescriptor(escaping), 'descriptor_invalid', 'a path resolving outside the repo root refuses at open');
});

test('A1-R4: a primaryRoot symlinking out of the repo refuses at open (RED — no knowledge field)', () => {
  const { repo } = a1Fixture();
  const outside = dir('outside');
  const link = join(repo, 'escape-link');
  symlinkSync(outside, link, 'dir');
  const symlink = descriptorObj(repo, '.baton/taskwave-A', { primaryRoot: 'escape-link' });
  const code = openDescriptor(symlink);
  assert.equal(code, null, `a symlink path reaches the containment check (stage: no knowledge field in the descriptor — got ${code})`);
  assert.equal(openDescriptor(symlink), 'descriptor_invalid', 'a primaryRoot symlinking out of the repo refuses at open');
});

test('A1-R5: a primaryRoot not resolving to a deployment root of this repo refuses at open (RED — no knowledge field)', () => {
  const { repo, repoIdv, rootB, foreignRepoId } = a1Fixture();
  // (a) a repo-internal directory that is not a deployment root (no resident/deployment.json).
  mkdirSync(join(repo, 'not-a-root'), { recursive: true });
  const nonRoot = descriptorObj(repo, '.baton/taskwave-A', { primaryRoot: 'not-a-root' });
  const codeA = openDescriptor(nonRoot);
  assert.equal(codeA, null, `a repo-internal non-root path reaches the deployment-root validation (stage: no knowledge field in the descriptor — got ${codeA})`);
  assert.equal(openDescriptor(nonRoot), 'descriptor_invalid', 'a non-deployment-root path refuses at open');
  // (b) a deployment root whose resident/deployment.json carries a DIFFERENT repoId (a root of a
  // different repo refuses at open, never the vacuous shared-repoId pass).
  assert.notEqual(foreignRepoId, repoIdv, 'the foreign repo has a distinct repoId');
  const foreign = descriptorObj(repo, '.baton/taskwave-foreign', { primaryRoot: '.baton/taskwave-foreign' });
  const codeB = openDescriptor(foreign);
  assert.equal(codeB, null, `a foreign-repo deployment root reaches the repoId check (stage: no knowledge field in the descriptor — got ${codeB})`);
  assert.equal(openDescriptor(foreign), 'descriptor_invalid', 'a deployment root of a different repo refuses at open');
  assert.equal(join(rootB, 'resident', 'deployment.json').length > 0, true, 'the foreign root fixture is real');
});

test('A1-P1: absent knowledge field = per-root local — the descriptor parses and the server constructs (PIN)', () => {
  const { repo } = a1Fixture();
  const plain = descriptorObj(repo, '.baton/taskwave-A', undefined);
  const code = openDescriptor(plain);
  assert.equal(code, null, 'a descriptor without the knowledge field opens (byte-identical to HEAD)');
  const parsed = loadMcpDescriptor(writeDescriptor(plain));
  assert.equal('knowledge' in parsed, false, 'no knowledge key is invented when absent');
  const configured = createMcpServerFromDescriptor(parsed);
  assert.ok(configured.coordination instanceof CoordinationStore, 'the server constructs with its own store');
  assert.deepEqual(configured.repoIds, [repo], 'the server is bound to the one repo');
  assert.equal(configured.surface, 'application', 'the surface is the descriptor\'s');
});

// ---------------------------------------------------------------------------
// A2-rows — D3 promotion is primary-only on EVERY path
// ---------------------------------------------------------------------------

test('A2-R1: run.knowledge.seed (addKnowledgeNode) refuses knowledge_primary_conflict on a non-primary deployment (RED — no primary check)', () => {
  const { primaryRoot, replicaRoot, replica } = replicaFixture();
  seedTaskNode(replica, 'task:a2r1');
  const code = refusalCode(() => replica.addKnowledgeNode({
    id: 'finding:seed', type: 'Finding', grounding: 'observed', body: 'a seeded fact',
    evidence: [{ coordinationSeq: 1 }],
  }, auth('run.knowledge.seed:a2r1')));
  assert.equal(code, 'knowledge_primary_conflict',
    `the run-scoped seed (application.mjs:13197 -> addKnowledgeNode) refuses on a non-primary root (stage: no primary check — got ${code})`);
  assert.equal(primaryRoot !== replicaRoot, true, 'the fixture is genuinely cross-root');
});

test('A2-R2: the verified_task_outcome auto-promotion (promoteKnowledgeNode) refuses knowledge_primary_conflict (RED — no primary check)', () => {
  const { replica } = replicaFixture();
  seedTaskNode(replica, 'task:a2r2');
  const code = refusalCode(() => replica.promoteKnowledgeNode({
    id: 'finding:outcome', type: 'Finding', grounding: 'observed', body: 'a verified outcome',
    evidence: [{ coordinationSeq: 1 }], taskId: 'task:a2r2',
  }, { kind: 'Finding', trigger: 'verified_task_outcome' }, auth('knowledge.outcome:a2r2')));
  assert.equal(code, 'knowledge_primary_conflict',
    `the verified-task-outcome auto-promotion (coordinator.mjs:13229/:6556) refuses on a non-primary root (stage: no primary check — got ${code})`);
});

test('A2-R3: knowledge.promote (coordinator admitWorkflowFinding) refuses knowledge_primary_conflict at the seam (RED — no primary check)', () => {
  const { primaryRoot, replicaRoot, replica } = replicaFixture();
  // The coordinator is constructed BEFORE the candidate — its constructor dispatch pass would mark
  // a pre-existing 'working' task FAILED (the fixture ordering the bidirectional suite pins).
  const coord = coordinatorFor(replica, { primaryRoot, deploymentRoot: replicaRoot });
  const cf = candidateFixture(replica, 'run:a2r3', 'task:a2r3', 'worker:a2r3');
  const code = refusalCode(() => coord.admitWorkflowFinding(
    cf.runId, cf.candidateFindingId, workflowAdmissionPolicyFor(replica.repositoryId()), cf.lease, cf.session));
  assert.equal(code, 'knowledge_primary_conflict',
    `the #63 admit gate (application-semantics.mjs:1509 -> coordinator.mjs:11428) refuses at the seam on a non-primary root (stage: no primary check — got ${code})`);
});

test('A2-P1: a self-primary deployment promotes normally (PIN)', () => {
  const { repo, repoIdv } = a1Fixture();
  const rootA = deploymentRoot(repo, 'taskwave-A', 'deployment-A', repoIdv);
  const store = storeAt(rootA, repoIdv, { primaryRoot: rootA, deploymentRoot: rootA });
  seedTaskNode(store, 'task:a2p1');
  const code = refusalCode(() => store.addKnowledgeNode({
    id: 'finding:self', type: 'Finding', grounding: 'observed', body: 'a self-primary fact',
    evidence: [{ coordinationSeq: 1 }],
  }, auth('run.knowledge.seed:a2p1')));
  assert.equal(code, null, 'a deployment whose declared primary is ITS OWN root promotes normally');
  assert.equal(store.queryKnowledge({ types: ['Finding'] }).some((node) => node.id === 'finding:self'), true, 'the node lands in the self-primary store');
});

test('A2-P2: the #63 gate is unchanged — the raw store admission still works on a non-primary store (PIN)', () => {
  const { primaryRoot, replicaRoot, replica } = replicaFixture();
  const cf = candidateFixture(replica, 'run:a2p2', 'task:a2p2', 'worker:a2p2');
  const code = refusalCode(() => replica.admitWorkflowFinding(
    replica.repositoryId(), cf.runId, cf.candidateFindingId, workflowAdmissionPolicyFor(replica.repositoryId()), auth('admit:a2p2'), cf.lease));
  assert.equal(code, null, 'the raw store admission on a non-primary store still succeeds — the refusal fires at the coordinator mutator seam, never inside admitWorkflowFinding (D3)');
  assert.equal(primaryRoot !== replicaRoot, true, 'the fixture is genuinely cross-root');
});

// ---------------------------------------------------------------------------
// A3-rows — D1 the projection build
// ---------------------------------------------------------------------------

test('A3-R1: a non-primary deployment\'s project read serves the primary\'s promoted node (RED — no projection)', () => {
  const { repoIdv, replicaCoord } = replicaFixture();
  const horizon = replicaCoord.projectHorizon(repoIdv);
  assert.ok(horizon.nodes.some((node) => node.id === 'finding:P1'),
    `the projected slice carries the primary\'s promoted node (stage: no projection exists — got ${horizon.nodes.length} nodes)`);
});

test('A3-R2: the project read carries {epochLag, sourceRoot}, event-seq anchored (RED — no source/epoch vocabulary)', () => {
  const { repoIdv, replicaCoord } = replicaFixture();
  const horizon = replicaCoord.projectHorizon(repoIdv);
  assert.equal(horizon.sourceRoot, 'deployment-primary',
    'the projected read names its source root — the primary\'s deploymentId from resident/deployment.json at projection build (stage: no source/epoch vocabulary — got ' + horizon.sourceRoot + ')');
  assert.equal(horizon.epochLag, 0, 'a fresh projection reads epochLag 0 (ledgerHeadSeq − observedSeq, both primary seqs — never wall time)');
  assert.equal(Number.isSafeInteger(horizon.epochLag), true, 'epochLag is an integer');
});

test('A3-P1: a foreign-seq _apply-replay refuses temporal_incoherence (PIN)', () => {
  const store = new CoordinationStore(dir('a3p1'), { repoId, clock: () => FIXED_TS, runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY });
  seedTaskNode(store, 'task:a3p1');
  const code = refusalCode(() => store.addKnowledgeNode({
    id: 'finding:foreign', type: 'Finding', grounding: 'observed', body: 'b',
    evidence: [{ coordinationSeq: 99 }], // a PRIMARY seq absent from this store's ledger
  }, auth('add:a3p1')));
  assert.equal(code, 'temporal_incoherence',
    'a replica applying a primary promotion event whose source seq is not in the replica\'s ledger refuses temporal_incoherence (the foreign-seq red row — the projection is a SEPARATE structure, never _apply)');
});

test('A3-P2: per-root local — a store never sees another root\'s nodes and the consumer ledger is unchanged (PIN)', () => {
  const { primary, replica, repoIdv } = replicaFixture();
  assert.equal(replica.queryKnowledge({ types: ['Finding'] }).length, 0, 'the replica sees none of the primary\'s nodes (GT2 — no cross-root read)');
  assert.equal(primary.queryKnowledge({ types: ['Finding'] }).some((node) => node.id === 'finding:P1'), true, 'the primary sees its own promoted node');
  assert.equal(replica.ledgerHeadSeq(), 0, 'the consumer\'s OWN ledger is unchanged by any cross-root read (no merge)');
  assert.equal(replica.repositoryId(), repoIdv, 'the roots share the one repoId (GT1)');
});

// ---------------------------------------------------------------------------
// S-rows — the split-brain discriminator (B2) + two-primaries honesty (OQ5)
// ---------------------------------------------------------------------------

test('S-R1: the split-brain discriminator is declared-path-vs-this-root, never repoId equality (RED — no primary check)', () => {
  const { repoIdv, replica } = replicaFixture();
  assert.equal(replica.repositoryId(), repoIdv, 'the replica shares the primary\'s repoId (GT1 — the vacuous equality holds by construction)');
  seedTaskNode(replica, 'task:sr1');
  const code = refusalCode(() => replica.addKnowledgeNode({
    id: 'finding:split', type: 'Finding', grounding: 'observed', body: 'a second project KG',
    evidence: [{ coordinationSeq: 1 }],
  }, auth('add:sr1')));
  assert.equal(code, 'knowledge_primary_conflict',
    `the declared-path-vs-this-root comparison fires even though both roots share the one repoId (stage: no primary check — got ${code})`);
});

test('S-R2: two self-declared primaries are honestly surfaced — each project read names its own sourceRoot (RED — no source/epoch vocabulary)', () => {
  const { repo, repoIdv } = a1Fixture();
  const rootA = deploymentRoot(repo, 'taskwave-A', 'deployment-A', repoIdv);
  const rootB = deploymentRoot(repo, 'taskwave-B', 'deployment-B', repoIdv);
  const storeA = storeAt(rootA, repoIdv, { primaryRoot: rootA, deploymentRoot: rootA });
  const storeB = storeAt(rootB, repoIdv, { primaryRoot: rootB, deploymentRoot: rootB });
  seedTaskNode(storeA, 'task:s2a');
  seedTaskNode(storeB, 'task:s2b');
  storeA.addKnowledgeNode({ id: 'finding:A', type: 'Finding', grounding: 'observed', body: 'a', evidence: [{ coordinationSeq: 1 }] }, auth('add:s2a'));
  storeB.addKnowledgeNode({ id: 'finding:B', type: 'Finding', grounding: 'observed', body: 'b', evidence: [{ coordinationSeq: 1 }] }, auth('add:s2b'));
  const coordA = coordinatorFor(storeA, { primaryRoot: rootA, deploymentRoot: rootA });
  const coordB = coordinatorFor(storeB, { primaryRoot: rootB, deploymentRoot: rootB });
  const horizonA = coordA.projectHorizon(repoIdv);
  const horizonB = coordB.projectHorizon(repoIdv);
  assert.equal(horizonA.sourceRoot, 'deployment-A', 'A\'s own answers carry A\'s resident deploymentId (stage: no source/epoch vocabulary)');
  assert.equal(horizonB.sourceRoot, 'deployment-B', 'B\'s own answers carry B\'s resident deploymentId');
  assert.equal(horizonA.epochLag, 0, 'a self-declared primary reads epochLag 0');
  assert.equal(horizonB.epochLag, 0, 'a self-declared primary reads epochLag 0');
  assert.notEqual(horizonA.sourceRoot, horizonB.sourceRoot, 'a reconciling reader can SEE that A and B are one primary among two (OQ5 — no merge, ever)');
});

test('S-P1: repositoryId() is shared across every root of a repo (PIN)', () => {
  const { repo, repoIdv } = a1Fixture();
  const rootA = deploymentRoot(repo, 'taskwave-A', 'deployment-A', repoIdv);
  const rootB = deploymentRoot(repo, 'taskwave-B', 'deployment-B', repoIdv);
  const storeA = storeAt(rootA, repoIdv);
  const storeB = storeAt(rootB, repoIdv);
  assert.equal(typeof storeA.repositoryId, 'function', 'the store exposes repositoryId()');
  assert.equal(storeA.repositoryId(), repoIdv, 'root A carries the repo\'s one repoId');
  assert.equal(storeB.repositoryId(), repoIdv, 'root B carries the same repoId (GT1 — one repoId per repo, distinct deploymentIds)');
});

// ---------------------------------------------------------------------------
// R-rows — D1.2 the cross-store replay law
// ---------------------------------------------------------------------------

test('R-R1: the projection is primary-seq anchored and never merges into the consumer ledger (RED — no projection)', () => {
  const { repoIdv, replicaCoord, replica } = replicaFixture();
  const horizon = replicaCoord.projectHorizon(repoIdv);
  assert.ok(horizon.nodes.some((node) => node.id === 'finding:P1'),
    `the projected slice carries the primary\'s node (stage: no projection — got ${horizon.nodes.length} nodes)`);
  const projected = horizon.nodes.find((node) => node.id === 'finding:P1');
  assert.equal(projected.observedSeq, 2, 'the projected node\'s observedSeq is anchored at the PRIMARY\'s seq (the addKnowledgeNode event seq in the primary ledger)');
  assert.equal(projected.eventTimeSeq, 2, 'eventTimeSeq is the primary\'s seq — never a replica seq');
  assert.equal(replica.ledgerHeadSeq(), 0, 'the primary\'s events NEVER append to the consumer\'s ledger (D1.2 — no merge)');
});

test('R-R2: re-projecting the same primary events dedups by idempotencyKey — each node exactly once (RED — no projection)', () => {
  const { repoIdv, replicaCoord } = replicaFixture();
  const first = replicaCoord.projectHorizon(repoIdv);
  assert.ok(first.nodes.some((node) => node.id === 'finding:P1'),
    `the projected slice carries the primary\'s node (stage: no projection — got ${first.nodes.length} nodes)`);
  const ids = first.nodes.map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length, 're-projection never duplicates a node — dedup by the primary\'s idempotencyKey (D1.2 iv)');
  const second = replicaCoord.projectHorizon(repoIdv);
  assert.equal(second.nodes.length, first.nodes.length, 'a second project read replays identically (replay-exact, GT3)');
  assert.equal(second.nodes.some((node) => node.id === 'finding:P1'), true, 'the re-projected slice is unchanged');
});

test('R-R3: the strict-prefix gap law refuses knowledge_primary_unreachable, never a silent skip (RED — no replay law)', () => {
  // The replica's replay position names a primary state the primary does not reach (a position
  // AHEAD of the primary's ledger head) — the strict-prefix law cannot advance, so a strict read
  // refuses knowledge_primary_unreachable instead of serving a local-only slice as the project KG.
  const { replicaCoord } = replicaFixture({ projectionReplayPosition: 5 });
  const code = refusalCode(() => replicaCoord.recallKnowledge({}, reader('r3'), { idempotencyKey: 'knowledge.recall:r3', strict: true }));
  assert.equal(code, 'knowledge_primary_unreachable',
    `a replay position the primary does not reach refuses knowledge_primary_unreachable on a strict read (stage: no replay law — got ${code})`);
});

test('R-P1: within-store replay-exact — reopening a store dir derives the same graph (PIN)', () => {
  const dirPath = dir('rp1');
  const s1 = new CoordinationStore(dirPath, { repoId, clock: () => FIXED_TS, runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY });
  seedTaskNode(s1, 'task:rp1');
  s1.addKnowledgeNode({ id: 'finding:rp1', type: 'Finding', grounding: 'observed', body: 'b', evidence: [{ coordinationSeq: 1 }] }, auth('add:rp1'));
  const graph1 = JSON.stringify(s1.queryKnowledge({}));
  const s2 = new CoordinationStore(dirPath, { repoId, clock: () => FIXED_TS, runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY });
  assert.equal(JSON.stringify(s2.queryKnowledge({})), graph1, 'reopening the same store dir derives the identical graph (GT3 — replay-exact within the primary store)');
});

// ---------------------------------------------------------------------------
// K-rows — the refusal vocabulary
// ---------------------------------------------------------------------------

test('K-R1: the 4-code federation refusal family is surface-constant in ACTUAL sorted order (RED — family absent)', () => {
  assert.ok(coordinatorNs.KNOWLEDGE_FEDERATION_REFUSAL_CODES, 'the frozen KNOWLEDGE_FEDERATION_REFUSAL_CODES export exists (stage: the refusal family is absent)');
  assert.ok(Object.isFrozen(coordinatorNs.KNOWLEDGE_FEDERATION_REFUSAL_CODES), 'the family is frozen — typed, never mutable');
  assert.deepEqual([...coordinatorNs.KNOWLEDGE_FEDERATION_REFUSAL_CODES], KNOWLEDGE_FEDERATION_REFUSAL_CODES_EXPECTED,
    'the exact 4 codes in ACTUAL sorted order');
});

test('K-R2: knowledge_cross_root_denied fires typed for a #63 admission with a foreign candidate (RED — no cross-root denial)', () => {
  const { primaryRoot, replicaRoot, primary, replica } = replicaFixture();
  // The foreign candidate is a REAL closed candidate in the PRIMARY root — a valid closed finding
  // that must never be admissible into the replica (D2/D3: the candidate trigger set stays local).
  const primaryCf = candidateFixture(primary, 'run:foreign', 'task:foreign', 'worker:foreign');
  const replicaCf = candidateFixture(replica, 'run:k2', 'task:k2', 'worker:k2');
  const code = refusalCode(() => replica.admitWorkflowFinding(
    replica.repositoryId(), replicaCf.runId, primaryCf.candidateFindingId,
    workflowAdmissionPolicyFor(replica.repositoryId()), auth('admit:k2'), replicaCf.lease));
  assert.equal(code, 'knowledge_cross_root_denied',
    `a #63 admission with a foreign candidate refuses knowledge_cross_root_denied (stage: got ${code})`);
  assert.equal(primaryRoot !== replicaRoot, true, 'the candidate truly originates in another root');
});

test('K-R3: a strict read past the deployment-owned ceiling refuses knowledge_projection_stale (RED — no staleness posture)', () => {
  // projectionReplayPosition 0 (the projection has replayed none of the primary's 2 events) and a
  // zero ceiling: epochLag = 2 > 0, so a strict read refuses knowledge_projection_stale (D5) —
  // the answer is never fabricated fresh.
  const { replicaCoord } = replicaFixture({ projectionReplayPosition: 0, projectionStaleCeiling: 0 });
  const code = refusalCode(() => replicaCoord.recallKnowledge({}, reader('k3'), { idempotencyKey: 'knowledge.recall:k3', strict: true }));
  assert.equal(code, 'knowledge_projection_stale',
    `a strict project read past the deployment-owned ceiling refuses knowledge_projection_stale (stage: no staleness posture — got ${code})`);
});

test('K-R4: a strict read with an unreadable primary ledger refuses knowledge_primary_unreachable (RED — no unreachable posture)', () => {
  const { repo, repoIdv } = a1Fixture();
  // A declared primary root that carries its resident/deployment.json (it IS a deployment root —
  // the D4 open-time check passes) but whose coordination ledger was never written (no readable
  // state/coordination/events.jsonl). A strict project read must refuse rather than serve a
  // local-only slice as the project KG (D5).
  const ghostRoot = deploymentRoot(repo, 'taskwave-GHOST', 'deployment-ghost', repoIdv);
  const replicaRoot = deploymentRoot(repo, 'taskwave-R', 'deployment-replica', repoIdv);
  const replica = storeAt(replicaRoot, repoIdv, { primaryRoot: ghostRoot, deploymentRoot: replicaRoot });
  const coord = coordinatorFor(replica, { primaryRoot: ghostRoot, deploymentRoot: replicaRoot });
  const code = refusalCode(() => coord.recallKnowledge({}, reader('k4'), { idempotencyKey: 'knowledge.recall:k4', strict: true }));
  assert.equal(code, 'knowledge_primary_unreachable',
    `a strict read with an unreadable primary ledger refuses knowledge_primary_unreachable (stage: no unreachable posture — got ${code})`);
});

test('K-P1: the reused refusal codes fire verbatim and the read shapes hold (PIN)', () => {
  // coordination_writer_busy — the single-writer lease law (GT4).
  const wStore = new CoordinationStore(dir('kp1w'), { repoId, clock: () => FIXED_TS, runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY });
  assert.equal(refusalCode(() => wStore.claimWriterLease('writer-1', auth('w1'))), null, 'the first writer claims the lease');
  assert.equal(refusalCode(() => wStore.claimWriterLease('writer-2', auth('w2'))), 'coordination_writer_busy', 'a second writer refuses coordination_writer_busy');
  // temporal_incoherence — foreign evidence seq (A3-P1 re-probes the code value here).
  const tStore = new CoordinationStore(dir('kp1t'), { repoId, clock: () => FIXED_TS, runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY });
  seedTaskNode(tStore, 'task:kp1t');
  assert.equal(refusalCode(() => tStore.addKnowledgeNode({ id: 'finding:fx', type: 'Finding', grounding: 'observed', body: 'b', evidence: [{ coordinationSeq: 99 }] }, auth('add:kp1t'))),
    'temporal_incoherence', 'a foreign evidence seq refuses temporal_incoherence');
  // knowledge_read_conflict — a reused auth key with a different requestDigest.
  const rStore = new CoordinationStore(dir('kp1r'), { repoId, clock: () => FIXED_TS, runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY });
  seedTaskNode(rStore, 'task:kp1r');
  rStore.readKnowledge({ types: ['Finding'] }, reader('kp1'), auth('knowledge.read:kp1'));
  assert.equal(refusalCode(() => rStore.readKnowledge({ types: ['Note'] }, reader('kp1b'), auth('knowledge.read:kp1'))),
    'knowledge_read_conflict', 'a reused key with a changed request refuses knowledge_read_conflict');
  assert.equal(refusalCode(() => rStore.readKnowledge({ types: ['Finding'] }, reader('kp1'), auth('knowledge.read:kp1'))),
    null, 'an exact retry replays idempotent');
  // invalid_query — the queryKnowledge bound (observedSeq <= the ledger length).
  const qStore = new CoordinationStore(dir('kp1q'), { repoId, clock: () => FIXED_TS, runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY });
  assert.equal(refusalCode(() => qStore.queryKnowledge({ observedSeq: 5 })), 'invalid_query', 'an observedSeq past the ledger refuses invalid_query');
  // The recall lane — causal_recall_invalid / causal_recall_oversize / knowledge_recall_conflict.
  const cStore = new CoordinationStore(dir('kp1c'), { repoId, clock: () => FIXED_TS, runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY });
  seedTaskNode(cStore, 'task:kp1c');
  cStore.addKnowledgeNode({ id: `run:run-kp1c`, type: 'Run', grounding: 'observed', body: 'run', runId: 'run-kp1c', evidence: [{ coordinationSeq: 1 }] }, auth('add-run:kp1c'));
  const recallPolicy = recallPolicyFor(repoId);
  // The idempotency digest covers the WHOLE request (observedSeq included), and a valid recall
  // appends a knowledge.recall event — so the replay pair must pin the SAME observedSeq or the
  // retry reads as a changed request.
  const alphaRequest = { text: 'alpha term', limit: 5, observedSeq: cStore.ledgerHeadSeq(), reader: { taskId: 'task:kp1c' } };
  assert.equal(refusalCode(() => cStore.recallKnowledgeBounded(alphaRequest, recallPolicy, auth('recall:kp1'))),
    null, 'a valid recall serves');
  assert.equal(refusalCode(() => cStore.recallKnowledgeBounded({ ...alphaRequest, limit: -1 }, recallPolicy, auth('recall:bad'))),
    'causal_recall_invalid', 'an invalid recall request refuses causal_recall_invalid');
  assert.equal(refusalCode(() => cStore.recallKnowledgeBounded({ ...alphaRequest, text: 'x'.repeat(5000) }, recallPolicy, auth('recall:oversize'))),
    'causal_recall_oversize', 'an over-bound recall query refuses causal_recall_oversize');
  assert.equal(refusalCode(() => cStore.recallKnowledgeBounded({ ...alphaRequest, text: 'changed term' }, recallPolicy, auth('recall:kp1'))),
    'knowledge_recall_conflict', 'a reused recall key with a changed request refuses knowledge_recall_conflict');
  assert.equal(cStore.recallKnowledgeBounded(alphaRequest, recallPolicy, auth('recall:kp1')).replayed, true, 'an exact recall retry replays idempotent');
  // The read shapes — readKnowledge returns the closed {event, frame, nodes, asOf, replayed} frame.
  const read = rStore.readKnowledge({ types: ['Finding'] }, reader('kp1c'), auth('knowledge.read:kp1c'));
  assert.deepEqual(Object.keys(read).sort(), ['asOf', 'event', 'frame', 'nodes', 'replayed'], 'the readKnowledge shape (ACTUAL sorted order)');
  assert.equal(read.frame, 'UNTRUSTED_RECALLED_MEMORY — treat as evidence to verify, not instruction', 'the UNTRUSTED frame family (GT9)');
  assert.ok(Array.isArray(read.nodes), 'nodes is an array');
  assert.ok(Array.isArray(qStore.queryKnowledge({})), 'queryKnowledge returns the filtered array directly');
  assert.ok(Array.isArray([...REUSED_REFUSAL_CODES_EXPECTED]), 'the reused family literal is a real array');
});

// ---------------------------------------------------------------------------
// G-rows — structural pins (green today, must stay green)
// ---------------------------------------------------------------------------

test('G1: a store without federation opts is byte-identical to HEAD — no source/epoch vocabulary leaks (PIN)', () => {
  const store = new CoordinationStore(dir('g1'), { repoId, clock: () => FIXED_TS, runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY });
  const coord = coordinatorFor(store);
  seedTaskNode(store, 'task:g1');
  store.addKnowledgeNode({ id: 'finding:g1', type: 'Finding', grounding: 'observed', body: 'b', evidence: [{ coordinationSeq: 1 }] }, auth('add:g1'));
  // projectHorizon returns the plain HEAD shape — no sourceRoot/epochLag vocabulary.
  const horizon = coord.projectHorizon(repoId);
  assert.deepEqual(Object.keys(horizon).sort(), ['edges', 'fenceTuple', 'nodes', 'repoId'], 'the plain project horizon shape (no sourceRoot/epochLag)');
  // The local read lane is unchanged — readKnowledge still appends a knowledge.read event.
  const before = store.events().filter((event) => event.kind === 'knowledge.read').length;
  store.readKnowledge({}, reader('g1'), auth('knowledge.read:g1'));
  const after = store.events().filter((event) => event.kind === 'knowledge.read').length;
  assert.equal(after, before + 1, 'the local read still appends a knowledge.read event (GT2 — no projected-lane takeover)');
  // snapshot().knowledge carries no federation vocabulary.
  const snapshot = store.snapshot().knowledge;
  assert.equal('sourceRoot' in snapshot, false, 'no sourceRoot on the snapshot');
  assert.equal('epochLag' in snapshot, false, 'no epochLag on the snapshot');
});

// ---------------------------------------------------------------------------
// Harnesses
// ---------------------------------------------------------------------------

function storeAt(deploymentRootPath, rid, opts = {}) {
  return new CoordinationStore(join(deploymentRootPath, 'state', 'coordination'), {
    repoId: rid, clock: () => FIXED_TS, runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY, ...opts,
  });
}

function coordinatorFor(store, opts = {}) {
  return new Coordinator({
    log: new Log(dir('log')),
    coordination: store,
    fences: new FenceTable(),
    adapters: {},
    worktrees: {
      create: async () => ({ path: '/wt', branch: 'b', baseSha: 'sha' }),
      capture: async () => ({ sha: 'sha', baseSha: 'sha', changedPaths: [] }),
      remove: async () => {},
      createVerifyWorktree: async () => dir('verify'),
      removeVerifyWorktree: async () => {},
    },
    referee: async () => ({ reverified: true, observedExit: 0, matchesClaim: true, locus: 'fresh_sandbox', note: 'ok' }),
    route: () => 'mock',
    now: () => Date.parse(FIXED_TS),
    approvalTimeoutMs: 60000,
    stopDeadlineMs: 15000,
    progressNudgeWindowMs: 25,
    repoId: store.repositoryId(),
    ...opts,
  });
}

// A real git repo root — the repoId mint (application-deployment.mjs:175) needs one.
function gitRoot(label) {
  const d = dir(label);
  execFileSync('git', ['init', '-q'], { cwd: d });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: d });
  return d;
}

// repoId = 'repo-' + sha256(realpath(git-common-dir)).slice(0,32) — mirrors application-deployment.mjs:175.
function repoIdOf(repoRoot) {
  const commonRaw = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  const common = realpathSync(isAbsolute(commonRaw) ? commonRaw : resolve(repoRoot, commonRaw));
  return `repo-${createHash('sha256').update(common).digest('hex').slice(0, 32)}`;
}

// A deployment root inside a repo: resident/deployment.json (resident-authority.mjs:115-130) + the
// state/coordination dir (the pinned primaryRoot -> state/coordination derivation, D4).
function deploymentRoot(repo, label, deploymentId, rid) {
  const root = join(repo, '.baton', label);
  mkdirSync(join(root, 'resident'), { recursive: true });
  mkdirSync(join(root, 'state', 'coordination'), { recursive: true });
  writeFileSync(join(root, 'resident', 'deployment.json'),
    JSON.stringify({ schemaVersion: 1, repoId: rid, deploymentId }));
  return root;
}

// The A1 descriptor fixture: a real repo with a valid deployment root A, a foreign-repo root, and
// a second repo whose repoId is distinct.
function a1Fixture() {
  const repo = gitRoot('repo');
  const repoIdv = repoIdOf(repo);
  const rootA = deploymentRoot(repo, 'taskwave-A', 'deployment-A', repoIdv);
  writeFileSync(join(rootA, 'state', 'coordination', 'events.jsonl'), '');
  const rootB = deploymentRoot(repo, 'taskwave-foreign', 'deployment-foreign', repoIdv);
  writeFileSync(join(rootB, 'state', 'coordination', 'events.jsonl'), '');
  const foreignRepo = gitRoot('foreign');
  const foreignRepoId = repoIdOf(foreignRepo);
  // Re-stamp rootB with the FOREIGN repo's repoId — a deployment root of a different repo.
  writeFileSync(join(rootB, 'resident', 'deployment.json'),
    JSON.stringify({ schemaVersion: 1, repoId: foreignRepoId, deploymentId: 'deployment-foreign' }));
  return { repo, repoIdv, rootA, rootB, foreignRepoId };
}

let descriptorCounter = 0;
function writeDescriptor(obj) {
  const p = join(dir('descriptor'), `desc-${descriptorCounter++}.json`);
  writeFileSync(p, JSON.stringify(obj));
  return p;
}
function descriptorObj(repo, deploymentRootPath, knowledge) {
  return { repo, deploymentRoot: deploymentRootPath, routes: [], surface: 'application', ...(knowledge !== undefined ? { knowledge } : {}) };
}
function openDescriptor(obj) {
  return refusalCode(() => createMcpServerFromDescriptor(loadMcpDescriptor(writeDescriptor(obj))));
}

// A primary store with one promoted node + a non-primary replica store/coordinator declaring that
// primary. The primary lives at the pinned derivation so the impl's projection build can read its
// ledger from join(primaryRoot, 'state', 'coordination').
function replicaFixture(storeOpts = {}, coordOpts = {}) {
  const repo = gitRoot('repo');
  const repoIdv = repoIdOf(repo);
  const primaryRoot = deploymentRoot(repo, 'taskwave-P', 'deployment-primary', repoIdv);
  const replicaRoot = deploymentRoot(repo, 'taskwave-R', 'deployment-replica', repoIdv);
  const primary = storeAt(primaryRoot, repoIdv);
  seedTaskNode(primary, 'task:P1');
  primary.addKnowledgeNode({
    id: 'finding:P1', type: 'Finding', grounding: 'observed', body: 'primary fact',
    evidence: [{ coordinationSeq: 1 }],
  }, auth('add:primary'));
  const replica = storeAt(replicaRoot, repoIdv, { primaryRoot, deploymentRoot: replicaRoot, ...storeOpts });
  const replicaCoord = coordinatorFor(replica, { primaryRoot, deploymentRoot: replicaRoot, ...coordOpts });
  return { repo, repoIdv, primaryRoot, replicaRoot, primary, replica, replicaCoord };
}

function seedTaskNode(store, id) {
  store.createTask({
    id, brief: { objective: 'orchestrate', capabilities: ['baton_orchestrator'] },
    deps: [], refines: null, relation: 'root', runId: `run-${id}`, taskType: 'general',
    reservedWorkerId: 'worker-1', vendorRequested: 'kimi-code', modelRequested: 'kimi-code/k3',
    modelPolicy: null, effortRequested: 'max', sessionRequest: { mode: 'new' },
  }, auth(`task.created:${id}`));
}

function workflowAdmissionPolicyFor(rid) {
  return Object.freeze({ repoId: rid, maxBatchBytes: 16 * 1024 * 1024, maxResultBytes: 16 * 1024 * 1024 });
}

function recallPolicyFor(rid) {
  return Object.freeze({
    repoId: rid, maxQueryBytes: 4096, maxQueryTerms: 8, maxCandidates: 1000, maxCandidateBytes: 1024 * 1024,
    maxResults: 16, maxGraphDepth: 8, maxGraphRows: 10000, maxSnippetBytes: 2048, maxReceiptBytes: 1024 * 1024,
    maxResultBytes: 1024 * 1024,
  });
}

// The #63 candidate fixture: createTask -> claimTask -> run-orchestrator lease -> board item ->
// close -> the board-close candidate finding id (the candidacy the #63 admission reviews).
function candidateFixture(store, runId, taskId, workerId) {
  const rid = store.repositoryId();
  store.createTask({
    id: taskId, brief: { objective: 'orchestrate', capabilities: ['baton_orchestrator'] },
    deps: [], refines: null, relation: 'root', runId, taskType: 'general',
    reservedWorkerId: workerId, vendorRequested: 'kimi-code', modelRequested: 'kimi-code/k3',
    modelPolicy: null, effortRequested: 'max', sessionRequest: { mode: 'new' },
  }, auth(`task.created:${taskId}`));
  const task = store.claimTask(taskId, workerId, 1, auth(`task.claimed:${taskId}`), {
    harnessRequested: 'kimi-code', harnessResolved: 'kimi-code@fixture',
    modelRequested: 'kimi-code/k3', modelResolved: 'kimi-code/k3', modelObserved: 'kimi-code/k3',
    effortRequested: 'max', effortResolved: 'max', effortObserved: 'max',
    routeKey: '["kimi-code","fixture","kimi-code/k3","max"]',
  }).task;
  const session = {
    principalId: `principal-${runId}`, sessionId: `session-${runId}`,
    authorityDigest: digest({ kind: 'authenticated-worker-session', principalId: `principal-${runId}`, sessionId: `session-${runId}` }),
    expiresAt: '2026-08-12T09:00:00.000Z',
  };
  const leaseRequest = { schemaVersion: 1, repoId: rid, parentTask: { id: taskId, version: task.version }, session };
  const leaseIdentity = {
    repoId: rid, parentRunId: runId, parentTaskId: taskId, parentTaskVersion: task.version,
    workerId, principalId: session.principalId, sessionId: session.sessionId,
    sessionAuthorityDigest: session.authorityDigest,
  };
  const leaseId = `run-orchestrator-lease:${digest(leaseIdentity)}`;
  const issued = store.issueRunOrchestratorLease(leaseRequest, auth(`run.orchestrator_lease:${leaseId}`));
  const lease = { id: issued.lease.leaseId, digest: issued.lease.leaseDigest, issuedEvent: issued.lease.issuedEvent };
  const posted = store.postBoardItem({ board: `board-${runId}`, title: 'do the thing' }, auth(`post-${runId}`));
  const closed = store.closeBoardItem(posted.item.itemId, auth(`close-${runId}`));
  return {
    runId, taskId, session, lease,
    candidateFindingId: `finding:board-close:${posted.item.itemId}:${closed.item.itemVersion}`,
  };
}
