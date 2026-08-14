// campaign-interpreter.mjs — the phase-level campaign drive loop (the phasefile runner).
//
// Authority: docs/reference/evidence/phase-grammar-2026-08-14/phase-grammar-contract.md v1 D4–D7.
// The runner drives a compiled campaign's phases IN ORDER, composing the existing wave interpreter
// (runWorkflow) per phase — the phase level sequences; within a phase the flat parallel wave is
// unchanged. Phase outcomes are extracted as first-class values from each phase's harvest (never a
// prose read); a `fold` phase's closed predicate gate decides run-vs-folded; a `checkpoint` phase
// parks the campaign and delivers the decision packet upward, resumable on a later drive; the
// settled-vs-pending diff gives mid-flight amendment. Importing this module runs NOTHING.
//
// Coupling preconditions are named honestly: a `shared` coupling refuses until #158 (the shared
// scratchpad write verb) lands, and a `tight` coupling refuses until #102 (the tight cell) lands —
// never a silent degrade to `loose` (D5). The refusal codes `workflow_coupling_unavailable` and
// `workflow_campaign_amendment_refused` are the runner's two closed runtime codes.

import { createHash } from 'node:crypto';
import runWorkflow from './workflow-interpreter.mjs';

const CODE_COUPLING = 'workflow_coupling_unavailable';
const CODE_AMEND = 'workflow_campaign_amendment_refused';
const CODE_CHECKPOINT = 'workflow_checkpoint_invalid';

// D5 — the honest precondition map (DRAFT/RED at HEAD; the flip removes the refusal).
const COUPLING_PRECONDITION = Object.freeze({
  shared: '#158 shared-scratchpad write (not landed)',
  tight: '#102 tight cell (not landed)',
});

function workflowError(message, code, field, expected) {
  return Object.assign(new TypeError(message), { code, field, expected, detail: { line: null, field, expected } });
}

// canonicalJson — the interpreter's key-sorting canonical form (workflow-interpreter.mjs:58-63).
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

// ---------------------------------------------------------------------------
// Pure helpers (D2/D3) — exported for the suite's isolated rows.
// ---------------------------------------------------------------------------

// D3 — the closed predicate vocabulary, evaluated over the campaign's outcome state. `outcomes`
// is a Map (or object) of name → string value. Absent outcomes are falsy; the ONLY operators are
// truthy / falsy / eq / ne over named outcomes — no eval, no arithmetic, no boolean composition
// (multiple predicates are ANDed by the caller).
export function evaluateWhen(predicates, outcomes) {
  const get = (name) => (outcomes instanceof Map ? outcomes.get(name) : outcomes[name]);
  return predicates.every((predicate) => {
    const value = get(predicate.outcome);
    const present = typeof value === 'string' && value.length > 0;
    switch (predicate.op) {
      case 'truthy': return present;
      case 'falsy': return !present;
      case 'eq': return present && value === predicate.literal;
      case 'ne': return !present || value !== predicate.literal;
      default: return false;
    }
  });
}

// D2 — the mechanical outcome extraction from a phase's harvest (the receipt's harvest[] entries).
// `outcome <name> from <path>` → the whole recovered content; `… line <pattern>` → the first LINE
// containing the pattern (the full line, verbatim, case-sensitive — NO regex). No match / missing
// harvest → null (absent = falsy). Never a prose read.
export function extractOutcome(declaration, harvest) {
  const entry = (harvest ?? []).find((row) => row?.path === declaration.from);
  if (!entry || entry.ok !== true || typeof entry.bytes !== 'string') return null;
  if (!declaration.line) return entry.bytes;
  const matched = entry.bytes.split('\n').find((line) => line.includes(declaration.line));
  return matched === undefined ? null : matched;
}

// The settled-phase identity digest (D6): the incoming phase's whole identity-relevant shape, so a
// mid-flight amendment that touches a settled phase is detected as a structural diff, never a
// silent skip.
export function phaseDigest(phase) {
  return createHash('sha256')
    .update(canonicalJson({
      kind: phase.kind,
      when: phase.when,
      outcomes: phase.outcomes,
      spec: phase.spec,
      checkpoint: phase.checkpoint,
    }))
    .digest('hex');
}

// D6 — the amendment guard: an incoming phase whose identity digest differs from its settled
// snapshot refuses (a settled phase is immutable; re-key to re-drive it).
function assertSettledUnchanged(phase, snapshot) {
  if (phaseDigest(phase) !== snapshot.digest) {
    throw workflowError(
      `campaign phase "${phase.name}" is settled and immutable — re-key to re-drive it`,
      CODE_AMEND, `phase ${phase.name}`, 're-key to re-drive');
  }
}

// D5 — the coupling guard: a `shared`/`tight` coupling compiles, but its phase RUN refuses until
// the named precondition lands. Never a silent degrade to `loose`.
function assertCouplingsAvailable(phase) {
  const couplings = phase.couplings ?? {};
  const effective = couplings['*'] ?? 'loose';
  const declared = [effective, ...Object.values(couplings).filter((kind) => kind !== effective)];
  for (const kind of new Set(declared)) {
    if (kind !== 'loose') {
      throw workflowError(
        `campaign phase "${phase.name}" declares a "${kind}" coupling, which requires ${COUPLING_PRECONDITION[kind]}`,
        CODE_COUPLING, 'coupling', COUPLING_PRECONDITION[kind]);
    }
  }
}

function assertValidResume(campaign, resume, state) {
  if (!resume || typeof resume !== 'object') return;
  if (!state || !state.parkedAt) {
    throw workflowError('a campaign resume requires a prior parked state', CODE_CHECKPOINT, 'resume', 'prior parked state');
  }
  if (resume.phase !== state.parkedAt) {
    throw workflowError(
      `resume names phase "${resume.phase}" but the campaign is parked at "${state.parkedAt}"`,
      CODE_CHECKPOINT, 'resume.phase', state.parkedAt);
  }
  const checkpointPhase = campaign.phases.find((phase) => phase.name === resume.phase);
  if (!checkpointPhase || checkpointPhase.kind !== 'checkpoint') {
    throw workflowError(`resume names a non-checkpoint phase "${resume.phase}"`, CODE_CHECKPOINT, 'resume.phase', 'checkpoint phase');
  }
  const ids = (checkpointPhase.checkpoint?.options ?? []).map((option) => option.id);
  if (!ids.includes(resume.optionId)) {
    throw workflowError(`resume optionId "${resume.optionId}" is not a declared option`, CODE_CHECKPOINT, 'resume.optionId', 'declared option id');
  }
}

// ---------------------------------------------------------------------------
// The drive loop (D7) — run phases in order, composing runWorkflow per wave phase.
// ---------------------------------------------------------------------------

export async function runCampaign(baton, campaign, options = {}) {
  if (!baton || typeof baton !== 'object') {
    throw workflowError('runCampaign requires a Baton client facade', 'workflow_facade_invalid', 'baton', 'facade');
  }
  if (!campaign || typeof campaign !== 'object' || !Array.isArray(campaign.phases)) {
    throw workflowError('runCampaign requires a compiled campaign IR', 'workflow_campaign_invalid', 'campaign', 'compiled campaign');
  }
  const repoRoot = (typeof options.repoRoot === 'string' && options.repoRoot.length > 0)
    ? options.repoRoot
    : (typeof baton.repoRoot === 'string' && baton.repoRoot.length > 0 ? baton.repoRoot : null);
  const driver = options.driver;
  const resume = options.resume ?? null;
  const prior = options.state ?? null;
  assertValidResume(campaign, resume, prior);

  const outcomes = new Map(prior?.outcomes ? Object.entries(prior.outcomes) : []);
  const settledByName = new Map((prior?.settled ?? []).map((snapshot) => [snapshot.name, snapshot]));
  const phases = [];
  let parked = false;
  let parkedAt = null;

  for (const phase of campaign.phases) {
    // 1. Settled-phase replay / amendment guard (D6).
    const snapshot = settledByName.get(phase.name);
    if (snapshot) {
      assertSettledUnchanged(phase, snapshot);
      for (const [name, value] of Object.entries(snapshot.outcomes ?? {})) {
        if (typeof value === 'string') outcomes.set(name, value);
      }
      // The parked checkpoint, resumed on this drive: record the decision and continue.
      if (phase.kind === 'checkpoint' && resume && phase.name === resume.phase) {
        phases.push({ name: phase.name, kind: 'checkpoint', verdict: 'resumed', replayed: true, checkpoint: phase.checkpoint, decision: { optionId: resume.optionId } });
        continue;
      }
      phases.push({ name: phase.name, kind: phase.kind, verdict: snapshot.verdict, replayed: true, outcomes: snapshot.outcomes ?? {}, checkpoint: phase.checkpoint ?? null });
      continue;
    }

    // 2. A prior checkpoint parked and this phase is beyond it (pending — not driven).
    if (parked) {
      phases.push({ name: phase.name, kind: phase.kind, verdict: 'pending' });
      continue;
    }

    // 3. Checkpoint park (D4).
    if (phase.kind === 'checkpoint') {
      parked = true;
      parkedAt = phase.name;
      phases.push({ name: phase.name, kind: 'checkpoint', verdict: 'parked', checkpoint: phase.checkpoint });
      settledByName.set(phase.name, { name: phase.name, kind: phase.kind, digest: phaseDigest(phase), verdict: 'parked', outcomes: {} });
      continue;
    }

    // 4. Fold gate (D3).
    if (phase.kind === 'fold' && !evaluateWhen(phase.when, outcomes)) {
      phases.push({ name: phase.name, kind: 'fold', verdict: 'folded', outcomes: {} });
      settledByName.set(phase.name, { name: phase.name, kind: phase.kind, digest: phaseDigest(phase), verdict: 'folded', outcomes: {} });
      continue;
    }

    // 5. Coupling guard (D5).
    assertCouplingsAvailable(phase);

    // 6. Run the phase's wave and extract outcomes (D2).
    const receipt = await runWorkflow(baton, phase.spec, { repoRoot, driver });
    const phaseOutcomes = {};
    for (const declaration of phase.outcomes) {
      const value = extractOutcome(declaration, receipt.harvest);
      if (typeof value === 'string') { outcomes.set(declaration.name, value); phaseOutcomes[declaration.name] = value; }
      else phaseOutcomes[declaration.name] = null;
    }
    phases.push({ name: phase.name, kind: phase.kind, verdict: 'run', outcomes: phaseOutcomes, waveReceipt: receipt });
    settledByName.set(phase.name, { name: phase.name, kind: phase.kind, digest: phaseDigest(phase), verdict: 'run', outcomes: phaseOutcomes });
  }

  const settledVerdicts = new Set(['run', 'folded', 'replayed', 'resumed']);
  const verdict = parked
    ? 'CAMPAIGN-PARKED'
    : (phases.every((phase) => settledVerdicts.has(phase.verdict)) ? 'CAMPAIGN-OK' : 'CAMPAIGN-INCOMPLETE');

  return {
    schemaVersion: 1,
    campaignKey: campaign.campaignKey,
    verdict,
    phases,
    state: {
      settled: [...settledByName.values()],
      outcomes: Object.fromEntries(outcomes),
      parkedAt,
    },
  };
}

export default runCampaign;
