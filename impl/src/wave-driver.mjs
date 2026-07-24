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
// is the cursor-stripped status view, wave-level (L5): the store-global `cursor` is stripped
// exactly as `semanticViewDigest` strips it, so a deployment-wide cursor flap never reads as
// liveness; one live member resets the wave-level stall clock for all. The L6 termination law
// applies a per-member unproductivity budget across a full nudge cycle (park → nudge → re-park
// with an unchanged `changedPathsDigest`), and `claim_turn` resolves a parked `workerResult` into
// `work_completed` — opt-in (`finalization: 'claim-on-stall'`) because claim is terminal on a
// stale checkpoint.

import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import { applicationTerminal, canonicalRunPhase } from './application-semantics.mjs';

const SUCCESS_RESTING = 'result_ready';
const OBJECTIVE_MAX_BYTES = 4096;

// §2: closed field set, all optional, frozen. Every default mirrors the documented production
// cadence (a multi-hour wave); the red suite overrides these with short relative timeouts.
const DEFAULT_POLICY = Object.freeze({
  steering: 'nudge-on-checkpoint',
  completionMessage: 'Continue the current turn.',
  pollIntervalMs: 20_000,
  stallTimeoutMs: 20 * 60_000,
  hardCapMs: 3 * 3_600_000,
  settleTimeoutMs: 5_000,
  finalization: 'none',
  unproductiveNudgeBudget: 1,
  saltObjectives: true,
  preflight: true,
  evidencePath: null,
  onProgress: null,
  signal: null,
});

const POLICY_FIELDS = Object.freeze(new Set(Object.keys(DEFAULT_POLICY)));
const STEERING_MODES = Object.freeze(new Set(['nudge-on-checkpoint', 'none']));
const FINALIZATIONS = Object.freeze(new Set(['none', 'claim-on-stall']));

function driverError(message, code, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

function assertInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw driverError(`wave driver policy ${field} is invalid`, 'wave_driver_policy_invalid');
  }
}

// §2: freeze the closed policy field set, validating each field. Unknown fields reject so a typo
// (e.g. `hardCapMs` vs `hardcapMs`) fails loudly instead of silently falling back to the default.
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
  assertInteger(policy.stallTimeoutMs, 'stallTimeoutMs');
  assertInteger(policy.hardCapMs, 'hardCapMs');
  assertInteger(policy.settleTimeoutMs, 'settleTimeoutMs');
  if (!FINALIZATIONS.has(policy.finalization)) {
    throw driverError(`wave driver policy finalization is invalid: ${String(policy.finalization)}`, 'wave_driver_policy_invalid');
  }
  if (!Number.isSafeInteger(policy.unproductiveNudgeBudget) || policy.unproductiveNudgeBudget < 0) {
    throw driverError('wave driver policy unproductiveNudgeBudget is invalid', 'wave_driver_policy_invalid');
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

// L5: the stall marker is sha256 of the cursor-stripped status view, sliced to 16 hex chars. The
// store-global `cursor` is stripped exactly as `semanticViewDigest` strips it
// (application.mjs:191-194) — otherwise any transport/audit event anywhere in the deployment flaps
// every member's hash and "stall" silently means "deployment-wide silence".
function stallMarker(outline) {
  const view = { ...(outline ?? {}) };
  delete view.cursor;
  return createHash('sha256').update(JSON.stringify(view)).digest('hex').slice(0, 16);
}

function checkpointOf(outline) {
  const attention = Array.isArray(outline?.attention) ? outline.attention : [];
  return attention.find((entry) => entry?.kind === 'turn_checkpoint' && typeof entry?.requestId === 'string')
    ?? null;
}

export function createWaveDriver(baton, rawPolicy = null) {
  if (!baton || !baton.waves || typeof baton.waves.start !== 'function') {
    throw driverError('createWaveDriver requires a Baton client facade with waves.start', 'wave_driver_baton_invalid');
  }
  const policy = freezePolicy(rawPolicy);

  async function claimOnce(role, run, checkpoint, claims, state) {
    if (state.claimAttempted) return;
    state.claimAttempted = true;
    const at = new Date().toISOString();
    try {
      await run.act('claim_turn', {});
      state.claimed = true;
      claims.push({ role, requestId: checkpoint.requestId, at, code: 'claimed' });
    } catch (error) {
      // 31b5 :263-295 — claim re-runs the live trust gate and is terminal on a stale checkpoint;
      // a scope mismatch (the pause resolved concurrently) is tolerated and recorded, never fatal.
      claims.push({ role, requestId: checkpoint.requestId, at, code: error?.code ?? null });
    }
  }

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
        // The machinery's own oversize error (application_intent_invalid, application.mjs:1094-1096)
        // and the empty-objective client error (application-client.mjs:112) never name the cap — this
        // precheck does, carrying the byte count.
        throw driverError(
          `wave driver member ${member.role} objective is ${bytes} bytes after salting (limit ${OBJECTIVE_MAX_BYTES})`,
          'wave_driver_objective_oversize',
          { role: member.role, bytes, limit: OBJECTIVE_MAX_BYTES },
        );
      }
      return { ...member, objective };
    });

    const startOptions = { ...options, members: saltedMembers };
    const totalMembers = saltedMembers.length;

    const nudges = [];
    const claims = [];
    // L6 per-member state across polls: digest = changedPathsDigest at the last nudge; nudges =
    // unchanged-digest nudge cycles in the current streak (resets when the digest changes); done =
    // budget exhausted, stop nudging; claimAttempted/claimed separate "one claim" from "settled".
    const memberState = new Map();
    const freshState = () => ({ digest: null, nudges: 0, done: false, claimAttempted: false, claimed: false });
    const nudgedRequestIds = new Set(); // L4: dedup within a single pause (requestId-stable across polls)

    const startedAt = Date.now();
    let lastMarker = '';
    let lastMarkerAt = startedAt;
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

    let wave = null;
    let outcomes = [];
    let stop = null;
    try {
      wave = await baton.waves.start(startOptions);

      // L4-L6 poll/steer loop.
      for (;;) {
        if (aborted()) { basis = 'aborted'; break; }

        // L5: ONE status read per member per poll. The cursor-stripped digest doubles as the stall
        // marker AND the source of the turn_checkpoint (requestId + changedPathsDigest).
        const markerParts = [];
        const paused = [];
        const statusInfo = new Map();
        const runs = wave.runs;
        for (const [role, runHandle] of runs) {
          let phase = null;
          let terminal = false;
          let outline = {};
          let markerDigest = 'unavailable';
          try {
            const status = await runHandle.status();
            outline = status?.view ?? status ?? {};
            phase = canonicalRunPhase(outline.phase) ?? null;
            terminal = outline.terminal === true || applicationTerminal(phase) || phase === SUCCESS_RESTING;
            markerDigest = stallMarker(outline);
          } catch {
            // L5/D10: a transient status failure contributes 'unavailable' (a marker CHANGE from
            // the prior real digest → resets the wave-level clock); only CONSECUTIVE unavailable
            // polls leave the marker stable and count toward stall.
            markerDigest = 'unavailable';
          }
          markerParts.push([role, phase, markerDigest]);
          const claimed = memberState.get(role)?.claimed === true;
          statusInfo.set(role, { terminal: terminal || claimed });
          if (!terminal && !claimed) {
            const checkpoint = checkpointOf(outline);
            if (checkpoint) paused.push({ role, run: runHandle, checkpoint });
          }
        }

        // L5 wave-level marker: one live member (any per-member digest change) resets the clock for
        // all. A sibling-ONLY cursor movement is already stripped, so it never resets.
        const marker = JSON.stringify(markerParts);
        if (marker !== lastMarker) { lastMarker = marker; lastMarkerAt = Date.now(); }

        if (typeof policy.onProgress === 'function') {
          const line = markerParts.map(([role, phase, digest]) => `${role}=${phase ?? '?'}@${digest}`).join(' ');
          try { policy.onProgress(line, { members: markerParts }); } catch { /* caller renders */ }
        }

        // L4/L6 steering.
        if (policy.steering === 'nudge-on-checkpoint') {
          for (const { role, run: runHandle, checkpoint } of paused) {
            const state = memberState.get(role) ?? freshState();
            if (state.done) {
              // L6 done + claim-on-stall: the member's live-rechecked admission (claim) resolves the
              // parked workerResult into work_completed NOW — no waiting for the stall clock (D6).
              if (policy.finalization === 'claim-on-stall' && !state.claimAttempted) {
                await claimOnce(role, runHandle, checkpoint, claims, state);
              }
              memberState.set(role, state);
              continue;
            }
            if (nudgedRequestIds.has(checkpoint.requestId)) continue; // L4: one nudge per pause
            const unchanged = state.digest !== null && state.digest === checkpoint.changedPathsDigest;
            if (unchanged && state.nudges >= policy.unproductiveNudgeBudget) {
              // L6: a re-park with an unchanged changedPathsDigest after the budget is the treadmill
              // — the member is done; stop nudging it.
              state.done = true;
              if (policy.finalization === 'claim-on-stall' && !state.claimAttempted) {
                await claimOnce(role, runHandle, checkpoint, claims, state);
              }
              memberState.set(role, state);
              continue;
            }
            const at = new Date().toISOString();
            try {
              await runHandle.act('nudge_turn', { message: policy.completionMessage });
              nudges.push({ role, requestId: checkpoint.requestId, at });
              nudgedRequestIds.add(checkpoint.requestId);
              if (unchanged) state.nudges += 1;
              else { state.digest = checkpoint.changedPathsDigest ?? null; state.nudges = 1; }
            } catch (error) {
              // D8: a nudge rejection (delivery_exception / scope mismatch) is recorded and polling
              // continues. The requestId is NOT consumed so a one-shot scripted failure recovers on
              // the next poll; a persistently failing nudge is bounded by stall/cap.
              nudges.push({
                role, requestId: checkpoint.requestId, at,
                error: { code: error?.code ?? null, message: String(error?.message ?? error) },
              });
            }
            memberState.set(role, state);
          }
        }

        // Settled? Members without a run failed to start (settled); claimed members settled this poll.
        const failedToStart = totalMembers - runs.size;
        let settled = failedToStart;
        for (const [role, info] of statusInfo) {
          if (info.terminal || memberState.get(role)?.claimed === true) settled += 1;
        }
        if (settled === totalMembers) { basis = 'completed'; break; }

        const now = Date.now();
        // D4: stall is checked BEFORE cap when both cross in one poll.
        if (now - lastMarkerAt >= policy.stallTimeoutMs) {
          if (policy.finalization === 'claim-on-stall') {
            // D9: claim fan-out at wave stall — every pending-paused member, one claim each, scope
            // mismatch tolerated and recorded.
            for (const { role, run: runHandle, checkpoint } of paused) {
              const state = memberState.get(role) ?? freshState();
              if (!state.claimAttempted) await claimOnce(role, runHandle, checkpoint, claims, state);
              memberState.set(role, state);
            }
            let recovered = failedToStart;
            for (const [role, info] of statusInfo) {
              if (info.terminal || memberState.get(role)?.claimed === true) recovered += 1;
            }
            basis = recovered === totalMembers ? 'completed' : 'stall';
          } else {
            basis = 'stall';
          }
          break;
        }
        if (now - startedAt >= policy.hardCapMs) { basis = 'hard_cap'; break; }

        await sleep(policy.pollIntervalMs);
      }

      outcomes = await wave.settle({ timeoutMs: policy.settleTimeoutMs });
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
    const receipt = {
      ...evidence,
      remainingCount: stop?.remainingCount ?? evidence.stops.length,
      residueUnknown: stop?.residueUnknown ?? false,
      basis,
      nudges,
      claims,
      salt,
      pumpDrained: evidence.pumpDrained === true,
    };

    if (policy.evidencePath !== null) {
      // §2: write failure fails the run loudly (the wave is already closed by the guaranteed close).
      writeFileSync(policy.evidencePath, `${JSON.stringify(receipt, null, 2)}\n`);
    }

    return receipt;
  }

  return Object.freeze({ run });
}

export default createWaveDriver;
