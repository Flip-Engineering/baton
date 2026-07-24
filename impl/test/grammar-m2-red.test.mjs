// docs/36 §9 M2 — the vocabulary flip. The registry owns one vocabulary per axis (§7); its
// generated legacy mapping and the two lifecycle predicates are the single source of truth, every
// terminal-union consumer resolves through them, `closed` is a dead string, and the eleven
// retiresIn:M2 ledger rows are resolved. These contracts (M2-1..M2-7 + H5) are the M2 acceptance
// gate; behavior beyond the vocabulary is unchanged (§2), so the core state machine still records
// legacy literals and the mapping is what surfaces resolve outward.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  APPLICATION_RUN_TERMINAL_PHASES,
  PROVIDER_EXECUTION_SETTLED_PHASES,
} from '../src/application.mjs';
import {
  APPLICATION_SEMANTIC_REGISTRY as REGISTRY,
  CANONICAL_ATTENTION_KINDS,
  CANONICAL_MEMBER_STATES,
  CANONICAL_RUN_PHASES,
  LEGACY_RUN_PHASE_MAP,
  applicationTerminal,
  canonicalRunPhase,
  projectTypedTerminalCause,
  providerSettled,
  serializeAttentionKind,
} from '../src/application-semantics.mjs';
import { parseBatonCli } from '../src/index.mjs';
import { StoryCompiler, canonicalMemberStatus } from '../src/story.mjs';
import { collectSurfaceInventory } from '../scripts/surface-audit.mjs';
import { checkEnumStrings, checkLedgerMonotone, validateLedger } from '../scripts/surface-conformance.mjs';

const ledgerUrl = new URL('../scripts/surface-divergence-ledger.json', import.meta.url);
const ledger = JSON.parse(readFileSync(ledgerUrl, 'utf8'));

const src = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'latin1');

// The eleven §7.1 legacy run-phase rows M2 resolves (removal-only). `closed` maps to null (dead).
const M2_ENUM_ROWS = [
  ['approved', 'queued'], ['awaiting_plan_approval', 'awaiting_approval'],
  ['candidate_selected', 'result_selected'], ['closed', null], ['input_required', 'working'],
  ['interruption_uncertain', 'uncertain'], ['planning_failed', 'failed'], ['running', 'working'],
  ['selection_required', 'awaiting_selection'], ['start_failed', 'failed'],
  ['work_completed', 'result_ready'],
].map(([name, canonical]) => ({
  surface: 'enum.runPhase', name, canonical, dimension: 'enum', retiresIn: 'M2',
}));

test('M2-1: no surface serializes a legacy phase string — C3 is total over the extraction', () => {
  const inventory = collectSurfaceInventory();
  const result = checkEnumStrings(inventory.phaseLiterals, ledger);
  // Every extracted literal resolves to a canonical phase (or is dropped as the dead `closed`);
  // none remains novel, and none survives as a ledgered legacy string — the map is total now.
  assert.deepEqual(result.novel, []);
  assert.deepEqual(result.ledgered, []);
  assert.ok(result.conformant.length > 0);
  for (const observation of result.conformant) {
    assert.ok(CANONICAL_RUN_PHASES.includes(observation.canonical),
      `${observation.name} resolves to canonical ${observation.canonical}`);
  }
  // The extractor still records the raw legacy literals (the audit is the table of record); the
  // canonicalization is the registry-generated mapping, applied at resolution.
  for (const legacy of ['work_completed', 'running', 'selection_required']) {
    assert.ok(inventory.phaseLiterals.includes(legacy), `${legacy} still extracted raw`);
  }
});

test('M2-2: every terminal-union consumer resolves through the registry predicates', () => {
  // The registry owns the two predicates and they canonicalize their input (legacy or canonical).
  assert.equal(typeof providerSettled, 'function');
  assert.equal(typeof applicationTerminal, 'function');
  assert.equal(providerSettled('work_completed'), providerSettled('result_ready'));
  assert.equal(applicationTerminal('completed'), true);
  assert.equal(applicationTerminal('result_ready'), false);
  // The application's legacy-keyed sets never disagree with the predicates over what they carry.
  for (const phase of PROVIDER_EXECUTION_SETTLED_PHASES) assert.equal(providerSettled(phase), true, phase);
  for (const phase of APPLICATION_RUN_TERMINAL_PHASES) assert.equal(applicationTerminal(phase), true, phase);
  // The wave driver no longer hand-maintains its own terminal union — it consumes the predicate.
  const wave = src('wave.mjs');
  assert.match(wave, /import \{[^}]*applicationTerminal[^}]*\} from '\.\/application-semantics\.mjs'/u);
  assert.doesNotMatch(wave, /const TERMINAL_PHASES = new Set/u);
  assert.match(wave, /applicationTerminal\(outline\?\.phase\)/u);
});

test('M2-3: closed is grep-clean in the four named sites', () => {
  assert.equal(PROVIDER_EXECUTION_SETTLED_PHASES.has('closed'), false);
  assert.equal(APPLICATION_RUN_TERMINAL_PHASES.has('closed'), false);
  const cliTerminal = /const TERMINAL_RUN_PHASES = new Set\(\[([^\]]*)\]/u.exec(src('application-cli.mjs'));
  assert.ok(cliTerminal, 'application-cli.mjs TERMINAL_RUN_PHASES is present');
  assert.doesNotMatch(cliTerminal[1], /closed/u);
  // application-client.mjs completed bucket no longer buckets `closed` as completed.
  assert.doesNotMatch(src('application-client.mjs'), /\['completed', 'closed'\]\.includes\(phase\)/u);
});

test('M2-4: the wave re-reports the canonical run-phase vocabulary', () => {
  // The registry mapping is exactly what the wave applies to each member's raw run phase.
  assert.equal(canonicalRunPhase('work_completed'), 'result_ready');
  assert.equal(canonicalRunPhase('running'), 'working');
  assert.equal(canonicalRunPhase('awaiting_plan_approval'), 'awaiting_approval');
  assert.equal(canonicalRunPhase('selection_required'), 'awaiting_selection');
  assert.equal(canonicalRunPhase('candidate_selected'), 'result_selected');
  assert.equal(canonicalRunPhase('interruption_uncertain'), 'uncertain');
  assert.equal(canonicalRunPhase('approved'), 'queued');
  assert.equal(canonicalRunPhase('input_required'), 'working');
  assert.equal(canonicalRunPhase('planning_failed'), 'failed');
  assert.equal(canonicalRunPhase('start_failed'), 'failed');
  assert.equal(canonicalRunPhase('closed'), null);
  assert.equal(canonicalRunPhase('working'), 'working'); // idempotent on canonical input
  const wave = src('wave.mjs');
  // Members' re-reported phase is canonicalized; a start failure surfaces the member state
  // `failed` with cause `start`, never the legacy run phase `start_failed` (§7.2).
  assert.match(wave, /phase: canonicalRunPhase\(outline\.phase\)/u);
  assert.match(wave, /phase: 'failed', terminalCause: 'start'/u);
  assert.doesNotMatch(wave, /phase: 'start_failed'/u);
  assert.match(wave, /const SUCCESS_RESTING = 'result_ready'/u);
});

test('M2-5: L3 — non-success terminals carry a typed cause; completed keeps terminalCause null', () => {
  // completed with an accepted result/outcome authority: null terminalCause is legal (§7.1/L3).
  assert.equal(projectTypedTerminalCause({}), null);
  // Every non-success terminal carries a typed cause.
  const operatorStop = projectTypedTerminalCause({ runStop: { status: 'stopped' } });
  assert.equal(operatorStop.kind, 'operator_stop');
  const budget = projectTypedTerminalCause({
    terminalResult: { terminalCause: { kind: 'budget_exceeded', code: 'tokens', dimension: 'tokens', used: 2, limit: 1, ratio: 2 } },
  });
  assert.equal(budget.kind, 'budget_exceeded');
  assert.ok(typeof budget.code === 'string' && budget.code.length > 0);
  const rejected = projectTypedTerminalCause({ terminalOutcome: { accepted: false, code: 'provider_crashed' } });
  assert.equal(rejected.kind, 'provider_failure');
});

test('M2-6: candidate_selection serializes as select_candidate wherever the kind string surfaces', () => {
  assert.equal(serializeAttentionKind('candidate_selection'), 'select_candidate');
  // Other live kinds serialize verbatim.
  for (const kind of ['answer_question', 'answer_approval', 'answer_decision', 'turn_checkpoint',
    'session_preservation', 'workflow_revision', 'workflow_recovery']) {
    assert.equal(serializeAttentionKind(kind), kind);
  }
  // The registry owns exactly the eight live attention-array kinds; the gate targets
  // approve_plan/select_candidate are settlement verbs, not emitted kinds.
  assert.deepEqual([...CANONICAL_ATTENTION_KINDS].sort(), [
    'answer_approval', 'answer_decision', 'answer_question', 'candidate_selection',
    'session_preservation', 'turn_checkpoint', 'workflow_recovery', 'workflow_revision',
  ]);
  assert.equal(CANONICAL_ATTENTION_KINDS.includes('approve_plan'), false);
  assert.equal(CANONICAL_ATTENTION_KINDS.includes('select_candidate'), false);
  // The live emitter still uses candidate_selection; the outline/action string serializes it.
  assert.match(src('application.mjs'), /kind: 'candidate_selection'/u);
  assert.match(src('application.mjs'), /return \{ kind: 'select_candidate' \}/u);
});

test('M2-7: the eleven M2 ledger rows are resolved and monotonicity holds', () => {
  // No enum.runPhase divergence survives — all eleven are resolved (removed).
  assert.deepEqual(ledger.entries.filter((entry) => entry.surface === 'enum.runPhase'), []);
  assert.deepEqual(validateLedger(ledger), []);
  // Removing exactly those eleven rows from the pre-M2 ledger is a legal (removal-only) edit.
  const previous = { schemaVersion: 1, entries: [...ledger.entries, ...M2_ENUM_ROWS] };
  assert.deepEqual(checkLedgerMonotone(previous, ledger), []);
  // Re-adding any of them (an append) is refused.
  assert.throws(() => checkLedgerMonotone(ledger, previous), /ledger append forbidden/u);
});

test('H5: the do-path requires reason while the named-verb/CLI path keeps it optional (§4.2)', () => {
  // The D2 do-path actions schema-require `reason` (a live F12 instance, preserved per §2).
  assert.ok(REGISTRY.actions.stop.inputSchema.required.includes('reason'));
  assert.ok(REGISTRY.actions.stop_member.inputSchema.required.includes('reason'));
  assert.ok(REGISTRY.actions.stop_member.inputSchema.required.includes('role'));
  // The named-verb/D3/CLI path keeps `reason` optional — no precondition is added or removed (§2);
  // the divergence is documented and resolved as M2 cross-surface identity work, not a schema flip.
  assert.doesNotThrow(() => parseBatonCli(['run', 'stop', 'run-x']));
  assert.doesNotThrow(() => parseBatonCli(['run', 'member', 'stop', 'run-x', 'role-a']));
});

test('story member-state surfaces re-report the canonical §7.2 vocabulary', () => {
  assert.equal(canonicalMemberStatus('input_required'), 'blocked');
  assert.equal(canonicalMemberStatus('working'), 'working');
  assert.equal(canonicalMemberStatus('idle'), 'idle');
  assert.equal(canonicalMemberStatus('blocked'), 'blocked');
  assert.equal(canonicalMemberStatus('interrupted'), 'interrupted');
  assert.equal(canonicalMemberStatus('paused'), 'paused');
  assert.equal(canonicalMemberStatus('stopping'), 'stopping');
  assert.equal(canonicalMemberStatus('orphaned'), 'stopped');
  assert.equal(canonicalMemberStatus({ status: 'exited' }), 'completed');
  assert.equal(canonicalMemberStatus({ status: 'exited', crashed: true }), 'failed');
  assert.equal(canonicalMemberStatus({ status: 'exited', lastVerdict: { accept: false } }), 'failed');
  for (const status of ['pending', 'idle', 'working', 'blocked', 'input_required', 'paused',
    'interrupted', 'stopping', 'orphaned', 'exited']) {
    assert.ok(CANONICAL_MEMBER_STATES.includes(canonicalMemberStatus(status)), status);
  }
  // The StoryCompiler exposes the canonical member-state roster without disturbing raw reads.
  assert.deepEqual(new StoryCompiler().memberStates(), []);
});

test('the registry owns one closed vocabulary per axis (§7)', () => {
  assert.equal(REGISTRY.enums.runPhases, CANONICAL_RUN_PHASES);
  assert.equal(REGISTRY.enums.memberStates, CANONICAL_MEMBER_STATES);
  assert.equal(REGISTRY.enums.attentionKinds, CANONICAL_ATTENTION_KINDS);
  assert.equal(new Set(CANONICAL_RUN_PHASES).size, CANONICAL_RUN_PHASES.length);
  assert.equal(new Set(CANONICAL_MEMBER_STATES).size, CANONICAL_MEMBER_STATES.length);
  // Every legacy run-phase key maps into the canonical enum or to null (the dead string).
  for (const [legacy, target] of Object.entries(LEGACY_RUN_PHASE_MAP)) {
    assert.ok(target === null || CANONICAL_RUN_PHASES.includes(target), `${legacy} → ${target}`);
  }
});
