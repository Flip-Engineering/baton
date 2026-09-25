// Issue #46 — the shipped wave driver (docs/37 v2). Productizes the poll/steer/settle/close
// skeleton that every bespoke evidence driver re-implemented (L1: one loop, shipped once).
//
// Binding contract: docs/37-wave-driver.md v2 — laws L1-L7, surface §2, red rows §3.
//
// The multi-hour control loop is THIS module's blocking `run()` call — never parked inside
// `waves.start`, never detached (L2). `createWave`, `baton.waves.start`, and the frozen handle
// stay untouched; this module is purely additive (L3). The caller owns deployment + semantics +
// `baton.close()` (L7).
//
// Steering touches turn checkpoints only (L4): nudge dedup is keyed on `checkpoint.requestId`
// (de818e3), never on the classification string (the run-m1-wave.mjs:146-149 anti-pin). Liveness
// is the cursor-stripped status view, per member (#396): the store-global `cursor` is stripped
// exactly as `semanticViewDigest` strips it, so a deployment-wide cursor flap never reads as
// liveness. The wave ends on declared completion — every member terminal or claim-resolved — or
// the caller's explicit stop (`signal`); no clock, no nudge budget and no diff digest decides a
// member's work is finished (#598 F01). `claim_turn` resolves a parked `workerResult` into
// `work_completed` — opt-in (`finalization: 'claim-on-stall'`) because claim is terminal on a
// stale checkpoint; the claim's own live liveness gate at the runtime, never a digest
// comparison, decides whether the parked result resolves.

import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import { applicationTerminal, canonicalRunPhase } from './application-semantics.mjs';
import { FRAME_LIMITS } from './limits.mjs';

const SUCCESS_RESTING = 'result_ready';
// OQ5 (folded): the precheck's constant moves to the registry (wave.member.objective) and the
// precheck downgrades to a spill-aware advisory — it names the bytes and the coming spill, then
// PASSES the objective through (the machinery admits and spills exactly like run.objective).
const OBJECTIVE_MAX_BYTES = FRAME_LIMITS['wave.member.objective'].value;

// §2: closed field set, all optional, frozen. Every default mirrors the documented production
// cadence (a multi-hour wave); the red suite overrides these with short relative timeouts.
// #163 law (operator ruling 2026-08-14): there is NO hardCapMs — clock-based kill caps are
// retired; the key is unknown here and refuses loudly. #598 F01 retires the rest of the
// automatic finalization the same way: `stallTimeoutMs`, `unproductiveNudgeBudget` and
// `refusalNudgeBudget` are unknown keys and refuse loudly. The wave ends on declared
// completion or the caller's explicit stop; no clock, no count and no digest decides a
// member's work is finished.
const DEFAULT_POLICY = Object.freeze({
  steering: 'nudge-on-checkpoint',
  completionMessage: 'Continue the current turn.',
  pollIntervalMs: 20_000,
  settleTimeoutMs: 5_000,
  finalization: 'none',
  saltObjectives: true,
  preflight: true,
  evidencePath: null,
  onProgress: null,
  // Bidirectional v2 rule 3: the embedded decision-gating callback. Async, awaited, fired AT MOST
  // ONCE per (runId, requestId); its return is validated against `{optionId}|{text}|undefined`.
  onDecision: null,
  // Bidirectional v2 rule 6: optional per-wait-cycle instrumentation (wall-clock, active-follow
  // count, advancing cursors) so a caller/test can observe the wake laws without a live provider.
  onWait: null,
  // OQ5 (folded): the spill-aware early-ergonomics advisory. On an oversize member objective the
  // driver emits `{role, bytes, limit, spill: true, lane: 'wave.member.objective'}` and PASSES the
  // objective through — never the wave_driver_objective_oversize wall in front of a spill lane.
  onAdvisory: null,
  signal: null,
  // KG settlement D3: the settle-window ritual policy. 'kg-ritual' (default) runs the sweep +
  // note/plan elevation + candidacy + settlement lease between the members resting and wave close;
  // 'none' opts out entirely (zero ritual ledger writes).
  settlement: 'kg-ritual',
  // D9 (epic #103): the F12/A9-2 seam — makes the driver attempt a SECOND `wave.closed` append for
  // the same waveId (refused wave_already_closed, captured with step 'wave-closed') so the record's
  // non-gating is exercised. Off by default.
  injectDuplicateWaveClosed: false,
});

const POLICY_FIELDS = Object.freeze(new Set(Object.keys(DEFAULT_POLICY)));
const STEERING_MODES = Object.freeze(new Set(['nudge-on-checkpoint', 'none']));
const FINALIZATIONS = Object.freeze(new Set(['none', 'claim-on-stall']));
const SETTLEMENTS = Object.freeze(new Set(['kg-ritual', 'none']));

function driverError(message, code, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

// D9 (epic #103): the canonical digest discipline (the store's own canonicalDigest shape) for the
// record's receiptDigest — a ledger fact, never a working-tree read.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function canonicalDigest(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }

// #111-F3 (carried by the #79 fold): the corrective nudge COACHES instead of the bare
// completionMessage. A claim_premature_liveness refusal already carries TG4-sanitized fields —
// `liveness` is per-class COUNTS only (never path strings, never worker prose) and `reason` is
// the fixed-shape hub text ("no in-scope diff …"). Compose them; never raw gate internals.
function correctiveCoaching(liveness, reason, fallback) {
  const counts = liveness && typeof liveness === 'object'
    ? Object.entries(liveness)
      .filter(([, value]) => Number.isSafeInteger(value))
      .map(([key, value]) => `${key}=${value}`)
      .join(', ')
    : null;
  const why = typeof reason === 'string' && reason.length > 0 ? reason : 'no in-scope diff in this pause epoch';
  if (counts) return `${why}; liveness {${counts}}`;
  return why || fallback;
}

function assertInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw driverError(`wave driver policy ${field} is invalid`, 'wave_driver_policy_invalid');
  }
}

// §2: freeze the closed policy field set, validating each field. Unknown fields reject so a typo
// (e.g. `finalization` vs `finalisation`) fails loudly instead of silently falling back to the
// default — and the retired `hardCapMs` (#163) and stall/nudge-budget keys (#598 F01) reject by
// the same closed-set discipline.
function freezePolicy(raw) {
  if (raw === null || raw === undefined) return DEFAULT_POLICY;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw driverError('wave driver policy must be an object', 'wave_driver_policy_invalid');
  }
  const unknown = Object.keys(raw).find((field) => !POLICY_FIELDS.has(field));
  if (unknown) {
    throw driverError(`wave driver policy field "${unknown}" is unknown`, 'wave_driver_policy_invalid');
  }
  const policy = { ...DEFAULT_POLICY, ...raw };
  if (!STEERING_MODES.has(policy.steering)) {
    throw driverError(`wave driver policy steering is invalid: ${String(policy.steering)}`, 'wave_driver_policy_invalid');
  }
  if (typeof policy.completionMessage !== 'string' || policy.completionMessage.length === 0) {
    throw driverError('wave driver policy completionMessage is invalid', 'wave_driver_policy_invalid');
  }
  assertInteger(policy.pollIntervalMs, 'pollIntervalMs');
  assertInteger(policy.settleTimeoutMs, 'settleTimeoutMs');
  if (!FINALIZATIONS.has(policy.finalization)) {
    throw driverError(`wave driver policy finalization is invalid: ${String(policy.finalization)}`, 'wave_driver_policy_invalid');
  }
  if (!SETTLEMENTS.has(policy.settlement)) {
    throw driverError(`wave driver policy settlement is invalid: ${String(policy.settlement)}`, 'wave_driver_policy_invalid');
  }
  if (typeof policy.saltObjectives !== 'boolean') {
    throw driverError('wave driver policy saltObjectives is invalid', 'wave_driver_policy_invalid');
  }
  if (typeof policy.preflight !== 'boolean') {
    throw driverError('wave driver policy preflight is invalid', 'wave_driver_policy_invalid');
  }
  if (policy.evidencePath !== null && (typeof policy.evidencePath !== 'string' || policy.evidencePath.length === 0)) {
    throw driverError('wave driver policy evidencePath is invalid', 'wave_driver_policy_invalid');
  }
  if (policy.onProgress !== null && typeof policy.onProgress !== 'function') {
    throw driverError('wave driver policy onProgress is invalid', 'wave_driver_policy_invalid');
  }
  if (policy.onDecision !== null && typeof policy.onDecision !== 'function') {
    throw driverError('wave driver policy onDecision is invalid', 'wave_driver_policy_invalid');
  }
  if (policy.onWait !== null && typeof policy.onWait !== 'function') {
    throw driverError('wave driver policy onWait is invalid', 'wave_driver_policy_invalid');
  }
  if (policy.signal !== null && (!(policy.signal instanceof AbortSignal))) {
    throw driverError('wave driver policy signal is invalid', 'wave_driver_policy_invalid');
  }
  return Object.freeze(policy);
}

// Preflight route matching mirrors `requestedReadiness` subset semantics
// (application-deployment.mjs): select on harness/model/effort, unique-or-null. A route that is
// ambiguous (many) or absent (none) is NOT ready — fail loudly at admission instead of yielding a
// wave of `start_failed` members (wave.mjs:181-183).
function matchRoute(member, routes) {
  if (!Array.isArray(routes) || routes.length === 0) return null;
  const selector = (member.exact && typeof member.exact === 'object')
    ? member.exact
    : { harness: member.harness, model: member.model, effort: member.effort };
  const matches = routes.filter((route) => (
    (selector.harness === undefined || selector.harness === route.harness)
    && (selector.model === undefined || selector.model === route.model)
    && (selector.effort === undefined || selector.effort === route.effort)
  ));
  return matches.length === 1 ? matches[0] : null;
}

// L5: the liveness marker is sha256 of the cursor-stripped status view, sliced to 16 hex chars.
// The store-global `cursor` is stripped exactly as `semanticViewDigest` strips it
// (application.mjs:191-194) — otherwise any transport/audit event anywhere in the deployment
// flaps every member's hash. progressClass/requiredAction are DERIVED liveness fields
// (silenceMs grows with wall time) and waitingOn is a derived wait field (issue #10 D10) —
// stripped exactly as semanticViewDigest strips them, so a legitimately waiting member reads
// byte-static. The marker feeds the per-poll rendering line only; no clock consumes it
// (#598 F01).
function livenessMarker(outline) {
  const view = { ...(outline ?? {}) };
  delete view.cursor;
  delete view.progressClass;
  delete view.requiredAction;
  // Issue #10 D10: waitingOn is a DERIVED wait field, byte-static BY DESIGN for a legitimately
  // waiting member (the wait kind, not the stall basis, is its honest state). Stripped exactly
  // like the other derived liveness fields so a waitingOn transition never resets the clock.
  delete view.waitingOn;
  return createHash('sha256').update(JSON.stringify(view)).digest('hex').slice(0, 16);
}

function checkpointOf(outline) {
  const attention = Array.isArray(outline?.attention) ? outline.attention : [];
  return attention.find((entry) => entry?.kind === 'turn_checkpoint' && typeof entry?.requestId === 'string')
    ?? null;
}

// Bidirectional v2 rule 7: sibling extractor beside checkpointOf. Blocking upward interactions
// (decision/question/approval) from the SAME status view the driver already hashes, in stable
// requestId order (the first is the gated one). This is the reducer's steering input, not decor.
const BLOCKING_INTERACTION_KINDS = Object.freeze({
  answer_decision: 'decision', answer_question: 'question', answer_approval: 'approval',
});

function interactionsOf(outline) {
  const attention = Array.isArray(outline?.attention) ? outline.attention : [];
  return attention
    .filter((entry) => typeof entry?.requestId === 'string'
      && Object.hasOwn(BLOCKING_INTERACTION_KINDS, entry?.kind))
    .sort((a, b) => (a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0));
}

// Bidirectional v2 rule 7 × issue #10 D9: ONE ordered per-member reducer controlling BOTH
// rendering and steering. Precedence: pending blocking interaction > waitingOn > checkpoint+claim >
// checkpoint > working. A member with ANY pending blocking interaction is `blocked` — suppressed
// from nudge AND claim that poll. A member with a non-null waitingOn is `waiting` — suppressed the
// same way (`!reduced.waiting` at the :556 admission) and NEVER serialized as bare `working` to a
// driver (the #49 rendering lie). Every return shape carries BOTH flags explicitly so no consumer
// reads an undefined `blocked`/`waiting`.
export function reduceMember(interactions, checkpoint, waitingOn) {
  if (interactions.length > 0) {
    const gated = interactions[0];
    return {
      class: BLOCKING_INTERACTION_KINDS[gated.kind],
      gated,
      interactions,
      blocked: true,
      waiting: false,
    };
  }
  if (waitingOn && typeof waitingOn.kind === 'string') {
    return {
      class: waitingOn.kind,
      blocked: false,
      waiting: true,
      gated: null,
      interactions: [],
    };
  }
  if (checkpoint) {
    return { class: checkpoint.claim ? 'checkpoint+claim' : 'checkpoint', gated: null, interactions: [], blocked: false, waiting: false };
  }
  return { class: 'working', gated: null, interactions: [], blocked: false, waiting: false };
}

// Bidirectional v2 rule 3: validate the closed callback return union `{optionId}|{text}|undefined`.
function normalizeDecisionReturn(value) {
  if (value === undefined) return { kind: 'deferred' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'invalid' };
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === 'optionId'
    && typeof value.optionId === 'string' && value.optionId.length > 0) {
    return { kind: 'answer', answer: { optionId: value.optionId } };
  }
  if (keys.length === 1 && keys[0] === 'text'
    && typeof value.text === 'string' && value.text.length > 0) {
    return { kind: 'answer', answer: { text: value.text } };
  }
  return { kind: 'invalid' };
}

// Bidirectional v2 rule 6: a follow page ends the sleep early ONLY on a target change
// (checkpoint/decision park or resolve → the run's own `execution` category; a terminal transition
// → `page.terminal`). Unrelated backlog (sibling traffic filtered out of this run, non-execution
// categories) advances the cursor but does NOT wake.
function isTargetChange(page) {
  if (!page) return false;
  if (page.terminal === true) return true;
  const changes = Array.isArray(page.changes) ? page.changes : [];
  return changes.some((change) => change?.category === 'execution');
}

// Bidirectional v2 rule 3: answers ride the member's own `run.answer`. ONE normalized outcome union
// covering application exceptions (application_interaction_not_found), coordinator refusals
// (already_resolved/invalid_answer/stale_discarded/delivery_refused), and adapter throws — never a
// driver crash. Success surfaces the coordinator's own result code (`applied`).
async function deliverDecisionAnswer(run, requestId, answer) {
  try {
    const view = await run.answer(requestId, answer);
    // `application.answer` reports the coordinator's own result code on `view.lastAction.result`.
    return { result: view?.lastAction?.result ?? view?.action?.result ?? null };
  } catch (error) {
    return { result: error?.code ?? 'answer_exception', message: String(error?.message ?? error) };
  }
}

export function createWaveDriver(baton, rawPolicy = null) {
  if (!baton || !baton.waves || typeof baton.waves.start !== 'function') {
    throw driverError('createWaveDriver requires a Baton client facade with waves.start', 'wave_driver_baton_invalid');
  }
  const policy = freezePolicy(rawPolicy);

  async function run(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw driverError('wave driver run options are invalid', 'wave_driver_options_invalid');
    }
    if (!Array.isArray(options.members) || options.members.length === 0) {
      throw driverError('wave driver run requires a non-empty members array', 'wave_driver_options_invalid');
    }

    // §2: optional preflight — doctor() route-readiness per member.
    if (policy.preflight) {
      let readiness;
      try {
        readiness = await baton.doctor();
      } catch (error) {
        throw driverError(`wave driver preflight failed: ${String(error?.message ?? error)}`, 'wave_driver_route_unready');
      }
      const routes = Array.isArray(readiness?.routes) ? readiness.routes : [];
      for (const member of options.members) {
        const route = matchRoute(member, routes);
        if (!route || route.state !== 'ready') {
          throw driverError(
            `wave driver member ${member.role} route is not ready: ${route?.summary ?? 'no unique matching ready route'}`,
            'wave_driver_route_unready',
            { role: member.role },
          );
        }
        // §4.2.2: the preflight is a fleet_roster consumer — it reads the composed row (static +
        // liveness) and probes ONLY per §4.1.3's cache discipline (a stale/absent window probes
        // once per route, never per member). A failed liveness refuses the member like a static
        // block: the typed wave_driver_route_unready. The probe handle is the non-enumerable
        // surface the deployment attaches to doctor rows' liveness field.
        if (route.liveness && route.liveness.state !== 'verified'
          && typeof route.liveness.probe === 'function') {
          const refreshed = await route.liveness.probe();
          if (refreshed?.state === 'failed') {
            throw driverError(
              `wave driver member ${member.role} route is not ready: ${route?.summary ?? 'no unique matching ready route'}`,
              'wave_driver_route_unready',
              { role: member.role },
            );
          }
        }
      }
    }

    // §2 salt + admission-time byte-check. The attempt uuid is minted once per `run()` call and
    // reused across its internal retries (re-attach works, application.mjs:3895-3903 — runId is the
    // objective digest). `saltObjectives:false` OPTS INTO cross-wave run sharing for identical
    // members (the runId spans the full intent+owner digest, so sharing is silent).
    const salt = policy.saltObjectives === false ? null : randomUUID();
    const saltedMembers = options.members.map((member) => {
      const objective = salt === null
        ? member.objective
        : `[attempt: ${salt} ${member.role}] ${member.objective}`;
      const bytes = Buffer.byteLength(objective);
      if (bytes > OBJECTIVE_MAX_BYTES) {
        // OQ5 (folded): the precheck downgrades to a spill-aware ADVISORY. It keeps the
        // error-quality value (naming the byte count and the lane limit) but PASSES the objective
        // through — the machinery admits and spills it exactly like run.objective; a wall in front
        // of a spill lane would recreate the exact asymmetry this epic deletes elsewhere.
        if (typeof policy.onAdvisory === 'function') {
          policy.onAdvisory({ role: member.role, bytes, limit: OBJECTIVE_MAX_BYTES, spill: true, lane: 'wave.member.objective' });
        }
      }
      return { ...member, objective };
    });

    // #183 (allowTerminalReplay): the driver's same-key re-drive is the idempotent ritual resume —
    // it re-attaches to the prior wave's runs (runId dedupe via saltObjectives:false) rather than
    // replays, so createWave's terminal-replay refusal is skipped on this path.
    const startOptions = { ...options, members: saltedMembers, allowTerminalReplay: true };
    const totalMembers = saltedMembers.length;

    const nudges = [];
    const claims = [];
    // L4 per-member steering state across polls. #598 F01 removed the digest streak, the nudge
    // counters and the done flag: claimed stays per-member ("one claim" vs "settled") and every
    // delivery failure or claim refusal is an evidence row, never a budget.
    const memberState = new Map();
    const freshState = () => ({ claimed: false });
    const nudgedRequestIds = new Set(); // L4: dedup within a single pause (requestId-stable across polls)
    // Claim attempts key per pauseId — one claim attempt per pause record (a refused claim is
    // recorded once; the CP6 "claimable later" contract: the NEXT pause record claims again).
    const claimedPauseIds = new Set();
    // One corrective nudge per claim_premature_liveness refusal, exempt from the L4
    // one-nudge-per-pause dedup: the refusal means the worker is NOT done, so it is coached
    // with the sanitized liveness counts. No budget bounds it (#598 F01) — a refused delivery
    // is recorded like any delivery failure and the next pause record starts fresh.
    const correctiveNudge = async (role, runHandle, checkpoint, liveness = null, reason = null) => {
      const at = new Date().toISOString();
      try {
        // #111-F3: coach with the sanitized {liveness counts, reason: no in-scope diff} — never
        // the bare completionMessage (a worker refused for analysis-only output needs the WHY).
        const message = correctiveCoaching(liveness, reason, policy.completionMessage);
        const result = await runHandle.act('nudge_turn', { message });
        if (result && typeof result === 'object' && result.ok === false) {
          throw Object.assign(new Error(String(result.reason ?? result.result ?? 'nudge refused')), {
            code: result.result ?? 'nudge_refused',
          });
        }
        nudges.push({ role, requestId: checkpoint.requestId, at });
        nudgedRequestIds.add(checkpoint.requestId);
      } catch (error) {
        nudges.push({
          role, requestId: checkpoint.requestId, at,
          error: { code: error?.code ?? null, message: String(error?.message ?? error) },
        });
      }
    };
    async function claimOnce(role, runHandle, checkpoint, claims, state) {
      if (claimedPauseIds.has(checkpoint.requestId)) return;
      claimedPauseIds.add(checkpoint.requestId);
      const at = new Date().toISOString();
      let code;
      let liveness = null;
      let reason = null;
      try {
        const result = await runHandle.act('claim_turn', {});
        if (result && typeof result === 'object' && result.ok === false) {
          // #111-F3: carry the TG4-sanitized refusal fields into the corrective nudge so it can
          // coach with {liveness counts, reason: no in-scope diff} instead of the bare completionMessage.
          liveness = result.liveness ?? null;
          reason = typeof result.reason === 'string' ? result.reason : null;
          throw Object.assign(new Error(String(result.reason ?? result.result ?? 'claim refused')), {
            code: result.result ?? 'claim_refused', liveness, reason,
          });
        }
        state.claimed = true;
        claims.push({ role, requestId: checkpoint.requestId, at, code: 'claimed' });
        code = 'claimed';
      } catch (error) {
        // 31b5 :263-295 — claim re-runs the live trust gate and is terminal on a stale checkpoint;
        // a scope mismatch (the pause resolved concurrently) is tolerated and recorded, never fatal.
        code = error?.code ?? null;
        liveness = error?.liveness ?? liveness ?? null;
        reason = error?.reason ?? reason ?? null;
        claims.push({ role, requestId: checkpoint.requestId, at, code });
      }
      if (code === 'claim_premature_liveness') {
        await correctiveNudge(role, runHandle, checkpoint, liveness, reason);
      }
    }
    // Bidirectional v2 rule 3: at-most-once decision-callback dedup, keyed `${runId}:${requestId}`.
    const decisionFired = new Set();
    const decisionEvidence = []; // v2 rule 3: one driver-evidence line per fired decision.
    // Bidirectional v2 rule 6: per-member follow downgrade (application_follow_unavailable /
    // cancellation) — one evidence line, never retried in a loop; the member falls back to sleep.
    const followDowngraded = new Set();
    const follows = [];
    const waitCursors = new Map(); // last follow cursor per member (monotonic within/across cycles).
    // KG activation rule 3: latest per-member candidacy ritual counts, aggregated into the receipt.
    // Hoisted out of the poll loop so the receipt (built after the loop) reads the final per-member
    // values, not a per-iteration copy that falls out of scope.
    const memberKnowledge = new Map();

    let basis = null;

    const aborted = () => policy.signal?.aborted === true;
    const sleep = (ms) => {
      if (aborted()) return Promise.resolve();
      if (!policy.signal) return new Promise((resolve) => { setTimeout(resolve, ms); });
      return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        policy.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    };

    // Bidirectional v2 rule 6: the poll sleep rides ONE follow per live member. Wait-cycle law —
    // race the poll timer against one follow per member; advance each cursor through
    // `follow.throughCursor` even on empty pages; only a target change (checkpoint/decision/
    // terminal) ends the sleep early; unrelated backlog continues against the remaining interval;
    // abort and AWAIT all losers so the active-follow count returns to zero every cycle; an
    // unavailable/cancelled follow downgrades that member to the plain sleep ONCE.
    const waitForWake = async (members) => {
      const intervalMs = policy.pollIntervalMs;
      const startedAt = Date.now();
      const eligible = members.filter(
        (member) => !followDowngraded.has(member.role) && Number.isSafeInteger(member.cursor),
      );
      const emit = (info) => {
        if (typeof policy.onWait !== 'function') return;
        try { policy.onWait({ startedAt, cursors: Object.fromEntries(waitCursors), ...info }); }
        catch { /* caller renders */ }
      };
      if (eligible.length === 0 || aborted()) {
        await sleep(intervalMs);
        emit({ elapsedMs: Date.now() - startedAt, wokeEarly: false, activeFollows: 0, peakFollows: 0, followed: [] });
        return;
      }
      const controller = new AbortController();
      if (policy.signal) policy.signal.addEventListener('abort', () => controller.abort(), { once: true });
      const deadline = startedAt + intervalMs;
      let wokeEarly = false;
      let active = 0;
      let peak = 0;
      const followed = [];
      const track = (delta) => { active += delta; if (active > peak) peak = active; };
      const followMember = async (member) => {
        let cursor = member.cursor;
        waitCursors.set(member.role, cursor);
        followed.push(member.role);
        while (!controller.signal.aborted && Date.now() < deadline) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) break;
          const timeoutMs = Math.max(1, Math.min(remaining, intervalMs));
          track(1);
          let view;
          try {
            view = await member.run.followOnce({ afterCursor: cursor, timeoutMs, signal: controller.signal });
          } catch (error) {
            track(-1);
            if (error?.code === 'application_follow_cancelled') return; // an aborted loser
            if (!followDowngraded.has(member.role)) {
              followDowngraded.add(member.role);
              follows.push({
                role: member.role, runId: member.run.id,
                at: new Date().toISOString(), reason: error?.code ?? 'application_follow_unavailable',
              });
            }
            return;
          }
          track(-1);
          const page = view?.follow;
          if (page && Number.isSafeInteger(page.throughCursor) && page.throughCursor > cursor) {
            cursor = page.throughCursor; // advance through throughCursor even when changes are empty
            waitCursors.set(member.role, cursor);
          }
          if (isTargetChange(page)) {
            wokeEarly = true;
            controller.abort(); // wake: cancel the timer and every sibling follow
            return;
          }
          // Unrelated backlog / a plain timeout — continue against the remaining interval.
        }
      };
      const timer = new Promise((resolve) => {
        const handle = setTimeout(resolve, intervalMs);
        controller.signal.addEventListener('abort', () => { clearTimeout(handle); resolve(); }, { once: true });
      });
      const followers = eligible.map((member) => followMember(member));
      await timer;
      controller.abort();
      await Promise.allSettled(followers);
      emit({ elapsedMs: Date.now() - startedAt, wokeEarly, activeFollows: active, peakFollows: peak, followed: [...followed] });
    };

    let wave = null;
    let outcomes = [];
    let stop = null;
    let settlementResult = null;
    try {
      wave = await baton.waves.start(startOptions);

      // L4-L6 poll/steer loop.
      for (;;) {
        if (aborted()) { basis = 'aborted'; break; }

        // L5: ONE status read per member per poll. The cursor-stripped digest doubles as the
        // liveness marker AND the source of the turn_checkpoint (requestId + changedPathsDigest).
        const markerParts = [];
        const paused = [];
        const decisions = []; // v2 rule 3: members with a pending decision (onDecision candidates).
        const liveMembers = []; // v2 rule 6: non-terminal members + their status-read cursor.
        const classByRole = new Map(); // v2 rule 7: reducer output drives BOTH rendering and steering.
        const statusInfo = new Map();
        const runs = wave.runs;
        for (const [role, runHandle] of runs) {
          let phase = null;
          let terminal = false;
          let outline = {};
          let markerDigest = 'unavailable';
          let cursor = null;
          try {
            const status = await runHandle.status();
            outline = status?.view ?? status ?? {};
            phase = canonicalRunPhase(outline.phase) ?? null;
            terminal = outline.terminal === true || applicationTerminal(phase) || phase === SUCCESS_RESTING;
            markerDigest = livenessMarker(outline);
            if (Number.isSafeInteger(outline.cursor)) cursor = outline.cursor;
          } catch {
            // L5: a transient status failure contributes 'unavailable' so the rendering line
            // shows the read failed; the member keeps its roster place and the next poll reads
            // it again.
            markerDigest = 'unavailable';
          }
          if (outline.knowledge) memberKnowledge.set(role, outline.knowledge);
          markerParts.push([role, phase, markerDigest]);
          const claimed = memberState.get(role)?.claimed === true;
          statusInfo.set(role, { terminal: terminal || claimed });
          if (!terminal && !claimed) {
            // v2 rule 7: reduce this member from the same status view — ordered, precedence-fixed.
            const interactions = interactionsOf(outline);
            const checkpoint = checkpointOf(outline);
            const reduced = reduceMember(interactions, checkpoint, outline.waitingOn ?? null);
            classByRole.set(role, reduced.class);
            // v2 rule 7 × D9: a blocked member is suppressed from nudge AND claim — the checkpoint
            // (if any) is NOT admitted to the steerable `paused` set while an interaction is
            // pending. A WAITING member is suppressed the same way: the `!reduced.waiting` clause
            // keeps a named wait (capacity_ceiling/dispatch_pending/spawning/plan_approval/
            // provider_stalled) out of the claim cadence and the claim-on-stall fan-out.
            if (checkpoint && !reduced.blocked && !reduced.waiting) paused.push({ role, run: runHandle, checkpoint });
            // v2 rule 3 × rule 7: fire the decision callback ONLY for the GATED (first-by-requestId)
            // interaction — a decision behind an earlier question/approval waits its turn. Rule 4
            // already caps a worker at one pending decision, so this gates, never drops, a decision.
            if (reduced.blocked && reduced.gated.kind === 'answer_decision') {
              decisions.push({ role, run: runHandle, runId: runHandle.id, decision: reduced.gated });
            }
            // v2 rule 6: exclude terminal members from follows; retain the status-read cursor.
            if (cursor !== null) liveMembers.push({ role, run: runHandle, cursor });
          } else {
            classByRole.set(role, phase === SUCCESS_RESTING || terminal ? 'terminal' : 'settled');
          }
        }

        // The cursor-stripped digest is render-only (the onProgress line); a sibling-only
        // cursor movement is stripped from every digest, so sibling traffic never flaps a
        // member's rendered marker.

        if (typeof policy.onProgress === 'function') {
          // v2 rule 7: the reducer's class is the rendered label (a decision-parked member never
          // serializes as bare `working` again); the raw phase rides the structured second arg.
          const line = markerParts
            .map(([role, phase, digest]) => `${role}=${classByRole.get(role) ?? phase ?? '?'}@${digest}`)
            .join(' ');
          try { policy.onProgress(line, { members: markerParts, classes: [...classByRole] }); } catch { /* caller renders */ }
        }

        // v2 rule 3: fire the decision-gating callback per pending decision, serialized, at most
        // once per (runId, requestId). An invalid return or a throw is recorded as evidence and
        // NEVER answered — the interaction stays attention-required and the wave is never closed or
        // superseded because a callback failed.
        if (typeof policy.onDecision === 'function') {
          for (const { role, run: runHandle, runId, decision } of decisions) {
            const key = `${runId}:${decision.requestId}`;
            if (decisionFired.has(key)) continue;
            decisionFired.add(key);
            const at = new Date().toISOString();
            const expiresInMs = typeof decision.deadlineAt === 'number'
              ? Math.max(0, decision.deadlineAt - Date.now())
              : null;
            let returned;
            try {
              returned = await policy.onDecision({
                role,
                runId,
                requestId: decision.requestId,
                question: decision.question ?? null,
                options: Array.isArray(decision.options) ? decision.options : [],
                allowFreeResponse: decision.allowFreeResponse === true,
                recommended: decision.recommended ?? null,
                expiresInMs,
              });
            } catch (error) {
              decisionEvidence.push({
                role, runId, requestId: decision.requestId, at,
                evidence: 'callback_threw', message: String(error?.message ?? error),
              });
              continue;
            }
            const normalized = normalizeDecisionReturn(returned);
            if (normalized.kind === 'deferred') {
              decisionEvidence.push({ role, runId, requestId: decision.requestId, at, outcome: 'deferred' });
              continue;
            }
            if (normalized.kind === 'invalid') {
              decisionEvidence.push({ role, runId, requestId: decision.requestId, at, evidence: 'invalid_return' });
              continue;
            }
            const delivered = await deliverDecisionAnswer(runHandle, decision.requestId, normalized.answer);
            decisionEvidence.push({
              role, runId, requestId: decision.requestId, at, outcome: delivered.result,
              ...(delivered.message ? { message: delivered.message } : {}),
            });
          }
        }

        // L4 steering. A parked checkpoint is nudged once per pause. A checkpoint that carries
        // the member's own completed `workerResult` is resolved through `claim_turn` when the
        // wave author opted into claim finalization — the runtime's live liveness gate decides,
        // never a digest comparison (#598 F01). A delivery failure is recorded every time it
        // happens and steering continues; no count stops the nudges.
        if (policy.steering === 'nudge-on-checkpoint') {
          for (const { role, run: runHandle, checkpoint } of paused) {
            if (policy.finalization === 'claim-on-stall' && checkpoint.claim != null) {
              // The worker declared completion (parked workerResult): resolve it through the
              // claim's own live admission. A refusal (claim_premature_liveness — the worker is
              // NOT done) is recorded and coached, never budgeted.
              const state = memberState.get(role) ?? freshState();
              await claimOnce(role, runHandle, checkpoint, claims, state);
              memberState.set(role, state);
              continue;
            }
            if (nudgedRequestIds.has(checkpoint.requestId)) continue; // L4: one nudge per pause
            const at = new Date().toISOString();
            try {
              const result = await runHandle.act('nudge_turn', { message: policy.completionMessage });
              // D8: an expected refusal arrives as a VALUE ({ok:false, result:'delivery_exception'}),
              // not a thrown error — inspect the result or a failed delivery is misrecorded as a
              // successful nudge and the requestId is wrongly consumed.
              if (result && typeof result === 'object' && result.ok === false) {
                throw Object.assign(new Error(String(result.reason ?? result.result ?? 'nudge refused')), {
                  code: result.result ?? 'nudge_refused',
                });
              }
              nudges.push({ role, requestId: checkpoint.requestId, at });
              nudgedRequestIds.add(checkpoint.requestId);
            } catch (error) {
              // D8: a nudge rejection (delivery_exception / scope mismatch) is recorded and
              // polling continues. The requestId is NOT consumed so a failed delivery retries on
              // the next poll — the failure row is the report, not a budget.
              nudges.push({
                role, requestId: checkpoint.requestId, at,
                error: { code: error?.code ?? null, message: String(error?.message ?? error) },
              });
            }
          }
        }

        // Settled? Members without a run failed to start (settled); claimed members settled this poll.
        const failedToStart = totalMembers - runs.size;
        let settled = failedToStart;
        for (const [role, info] of statusInfo) {
          if (info.terminal || memberState.get(role)?.claimed === true) settled += 1;
        }
        if (settled === totalMembers) { basis = 'completed'; break; }

        // #163 law × #598 F01: no clock, no count and no digest bound the drive — the loop
        // settles on member terminality or ends on the caller's explicit stop (the abort
        // signal). A member that parks forever stays parked: the pause is attention the wave
        // author or orchestrator resolves, never a lifetime the driver decides.

        await waitForWake(liveMembers);
      }

      outcomes = await wave.settle({ timeoutMs: policy.settleTimeoutMs });
      // KG settlement D3: the settle-window ritual runs between the members resting and wave close
      // (the pre-stop window). It rides the embedded settlement command from this deployment's own
      // top-level principal; a typed refusal is captured, never allowed to abort the guaranteed
      // close. 'none' opts out entirely.
      if (policy.settlement === 'kg-ritual' && wave.waveId
        && typeof baton._runSettlementRitual === 'function') {
        const memberRunIds = [...wave.runs.values()].map((handle) => handle.id).filter(Boolean);
        try {
          settlementResult = await baton._runSettlementRitual(wave.waveId, memberRunIds);
        } catch (error) {
          settlementResult = {
            candidatesAwaitingAdmission: 0, settlementRunId: null,
            errors: [{ member: null, step: 'settlement', code: error?.code ?? 'wave_settlement_failed' }],
          };
        }
      }
    } finally {
      // L1: close is guaranteed — even on a thrown settle/loop, the wave's resources are reaped.
      if (wave) {
        try { stop = await wave.close({ reason: 'Wave driver settled.' }); }
        catch { /* close is best-effort in the abnormal path; the loop's own stop is primary */ }
      }
    }

    // §2 receipt: the committed envelope (wave.evidence) merged with close()'s residue truth,
    // plus the additive driver fields.
    const evidence = wave.evidence();
    // KG activation rule 3: the recipe receipts inherit the candidacy ritual block. `candidates` is
    // repo-scoped (the max across members is the honest queue size); `admittedThisRun` sums each
    // member run's admits. Zero surfaces as 0, never a missing field.
    let knowledgeCandidates = 0;
    let knowledgeAdmitted = 0;
    for (const knowledge of memberKnowledge.values()) {
      knowledgeCandidates = Math.max(knowledgeCandidates, knowledge.candidates ?? 0);
      knowledgeAdmitted += knowledge.admittedThisRun ?? 0;
    }
    const receipt = {
      ...evidence,
      remainingCount: stop?.remainingCount ?? evidence.stops.length,
      residueUnknown: stop?.residueUnknown ?? false,
      basis,
      nudges,
      claims,
      // Bidirectional v2 rule 3: one driver-evidence line per fired decision callback.
      decisions: decisionEvidence,
      // Bidirectional v2 rule 6: one downgrade line per member that lost the follow path.
      follows,
      salt,
      pumpDrained: evidence.pumpDrained === true,
      // KG settlement D3: the candidacy/settlement counts fold into the knowledge block (zero as 0,
      // never missing); the ritual's per-step refusals ride a bounded settlement.errors block.
      knowledge: {
        candidates: knowledgeCandidates, admittedThisRun: knowledgeAdmitted,
        candidatesAwaitingAdmission: settlementResult?.candidatesAwaitingAdmission ?? 0,
        settlementRunId: settlementResult?.settlementRunId ?? null,
      },
      settlement: { errors: (settlementResult?.errors ?? []).slice(0, 8) },
    };
    // D9 (epic #103): the campaign-state record + post-close briefing mint. Both run in the
    // driver's guaranteed post-close window — AFTER wave.close() (the finally above) and the
    // receipt build, BEFORE the receipt file write (D9 §mint-site). They are advisory, never
    // gating: a typed refusal is captured into the bounded settlement.errors (≤ 8) and the wave
    // stays closed (D5b). The record's own event seq is the landing's epoch anchor — no clocks.
    const campaignErrors = [...(receipt.settlement.errors ?? [])];
    const closedWaveId = typeof wave?.waveId === 'string' ? wave.waveId : null;
    if (closedWaveId && typeof baton._appendWaveClosed === 'function') {
      const record = {
        waveId: closedWaveId,
        receiptDigest: canonicalDigest(receipt),
        rings: [], lanes: [], parked: [], blockedOn: [],
        knowledge: {
          candidates: receipt.knowledge?.candidates ?? 0,
          admittedThisRun: receipt.knowledge?.admittedThisRun ?? 0,
          candidatesAwaitingAdmission: receipt.knowledge?.candidatesAwaitingAdmission ?? 0,
          settlementRunId: receipt.knowledge?.settlementRunId ?? null,
        },
        settlementErrors: (receipt.settlement?.errors ?? []).slice(0, 8),
      };
      try {
        await baton._appendWaveClosed(record);
      } catch (error) {
        campaignErrors.push({ member: null, step: 'wave-closed', code: error?.code ?? 'wave_closed_failed' });
      }
      if (policy.injectDuplicateWaveClosed === true) {
        // F12/A9-2 seam: force a SECOND append for the same waveId — refused wave_already_closed,
        // captured, non-gating (D9 honesty rule 3).
        try {
          await baton._appendWaveClosed(record);
        } catch (error) {
          campaignErrors.push({ member: null, step: 'wave-closed', code: error?.code ?? 'wave_closed_failed' });
        }
      }
    }
    if (typeof baton._mintCampaignBriefing === 'function') {
      try {
        await baton._mintCampaignBriefing();
      } catch (error) {
        campaignErrors.push({ member: null, step: 'briefing', code: error?.code ?? 'briefing_mint_failed' });
      }
    }
    receipt.settlement = { errors: campaignErrors.slice(0, 8) };

    if (policy.evidencePath !== null) {
      // §2: write failure fails the run loudly (the wave is already closed by the guaranteed close).
      writeFileSync(policy.evidencePath, `${JSON.stringify(receipt, null, 2)}\n`);
    }

    return receipt;
  }

  return Object.freeze({ run });
}

export default createWaveDriver;
