// Wave driver surface (docs/31): first-class orchestration waves over any Baton client facade.
// A wave is data — a member roster plus objectives — and every lifecycle semantic is Baton's
// own: explicit per-member approval, per-member isolation, re-armed drive pumps (never a
// terminal signal), the closed terminal-phase set, attention surfacing, result materialization
// with path-existence pin disambiguation, selective member stop, and zero-residue close.
// Program-IR aligned: members ↔ parallel branches, settle ↔ join, materialization ↔ collect,
// stopMember ↔ selective stop, evidence() ↔ the wave trace. It holds no durable state of its own.

import { statSync } from 'node:fs';

import { applicationTerminal, canonicalRunPhase } from './application-semantics.mjs';

// docs/36 §7.1/L4: terminality is the registry predicate — the wave no longer hand-maintains its
// own union (the F5 divergence where it omitted `denied`/`closed` is gone). `result_ready` is the
// canonical provider-settled resting state (legacy `work_completed`).
const SUCCESS_RESTING = 'result_ready';
const RESULT_SHA = /^[a-f0-9]{40,64}$/u;
const GLOB_MAGIC = /[*?[\]{}!+@]/u;
const POLL_MS = 50;
export const MAX_WAVE_PROGRESS_BYTES = 7 * 1024 * 1024;

function boundedJsonBytes(value, limit = MAX_WAVE_PROGRESS_BYTES) {
  let bytes = 0;
  const add = (amount) => {
    bytes += amount;
    if (bytes > limit) throw waveError('wave progress exceeds its serialization ceiling', 'wave_progress_oversize');
  };
  const visit = (node) => {
    if (node === null || typeof node !== 'object') { add(Buffer.byteLength(JSON.stringify(node))); return; }
    if (Array.isArray(node)) {
      add(2);
      node.forEach((item, index) => { if (index > 0) add(1); visit(item); });
      return;
    }
    add(2);
    Object.entries(node).forEach(([key, item], index) => {
      if (index > 0) add(1);
      add(Buffer.byteLength(JSON.stringify(key)) + 1); visit(item);
    });
  };
  visit(value);
  return bytes;
}

function waveError(message, code = 'wave_invalid') {
  return Object.assign(new TypeError(message), { code });
}

function validateMember(member, index, repoRoot = null) {
  if (!member || typeof member !== 'object' || Array.isArray(member)) {
    throw waveError(`wave member[${index}] must be an object`);
  }
  const role = member.role;
  if (typeof role !== 'string' || role.trim().length === 0) throw waveError(`wave member[${index}] role is invalid`);
  // docs/36 §3 M3 — `work` is the reserved run-level recipient sentinel for the current single
  // seat; a workflow role literally named `work` would collide with it, so it is a wave-admission
  // (registry) lint error, never a surface member role.
  if (role.trim() === 'work') throw waveError(`wave member ${role} role "work" is reserved`, 'wave_member_role_reserved');
  if (typeof member.objective !== 'string' || member.objective.trim().length === 0) {
    throw waveError(`wave member ${role} objective is invalid`);
  }
  if (!Array.isArray(member.scope) || member.scope.length === 0 || member.scope.length > 64
    || member.scope.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)
    || new Set(member.scope).size !== member.scope.length) {
    throw waveError(`wave member ${role} scope is invalid`, 'wave_scope_invalid');
  }
  for (const entry of member.scope) {
    if (!GLOB_MAGIC.test(entry)) {
      const trimmed = entry.replace(/\/+$/u, '');
      const basename = trimmed.split('/').pop() ?? '';
      // docs/31 #5: bare directories match only themselves under glob semantics. When repoRoot
      // is available the filesystem decides; otherwise the basename-dot heuristic decides, and a
      // non-existent dotless path is treated as an intended directory (corrective form shown).
      let isDirectory = !basename.includes('.');
      if (repoRoot) {
        try {
          isDirectory = statSync(`${repoRoot}/${trimmed}`).isDirectory() || isDirectory;
        } catch { /* path does not exist yet; the heuristic stands */ }
      }
      if (isDirectory) {
        throw waveError(
          `wave member ${role} scope entry "${entry}" names a bare directory, which matches only `
          + `itself under glob scope semantics; use "${trimmed}/**" instead`,
          'wave_scope_invalid',
        );
      }
    }
  }
  if (member.exact !== undefined) {
    const exact = member.exact;
    if (!exact || typeof exact !== 'object' || Array.isArray(exact)
      || ['harness', 'model', 'effort'].some((field) => typeof exact[field] !== 'string' || exact[field].length === 0)
      || Object.keys(exact).some((field) => !['harness', 'model', 'effort'].includes(field))) {
      throw waveError(`wave member ${role} exact route is invalid`);
    }
  }
  const selector = { harness: member.harness, model: member.model, effort: member.effort };
  if (member.exact === undefined
    && [selector.harness, selector.model, selector.effort].some((value) => value !== undefined)
    && (selector.model === undefined || selector.effort === undefined)) {
    throw waveError(`wave member ${role} manual routing requires model and effort together`);
  }
  return Object.freeze({ ...member, role: role.trim() });
}

function terminalFrom(outline) {
  return outline?.terminal === true || applicationTerminal(outline?.phase);
}

function attentionFrom(outline) {
  const attention = outline?.attention;
  if (Array.isArray(attention) && attention.length === 0) return null;
  if (attention === 'clear') return null;
  if (attention !== null && attention !== undefined) return attention;
  // The run still records the legacy blocking phase; the surfaced kind is canonical (§7.3):
  // `candidate_selection` serializes as `select_candidate`, `input_required` as an answer prompt.
  const phase = outline?.phase;
  if (phase === 'awaiting_plan_approval') return 'blocked_interaction:approve_plan';
  if (phase === 'selection_required') return 'blocked_interaction:select_candidate';
  if (phase === 'input_required') return 'blocked_interaction:answer_required';
  // Issue #31 §2.2(6), 31-b Part F rule 15: a `paused` member with no explicit attention override
  // still needs SOME signal that a turn checkpoint exists before a driver can nudge/wait/claim it.
  // `turn_checkpoint` is that classification — a default, not an escalation.
  if (phase === 'paused') return 'turn_checkpoint';
  return null;
}

// Resolve one preserved result pin for a member from refs/baton/results/* — the documented
// fallback when the result section has no authoritative sha (docs/31 #6). Disambiguation is by
// git path existence (the pin's tree must carry `report`), a start-time window, and an exclusion
// set for pins already attributed to other members — never by newest-pin guessing. Exported so
// the disambiguation is directly pinnable (W10).
export async function resolveResultPin({ repoRoot, report, startedAtMs, excludeShas = [] }) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0 || typeof report !== 'string'
    || report.length === 0 || !Number.isSafeInteger(startedAtMs)) return null;
  const { execFileSync } = await import('node:child_process');
  let pins;
  try {
    pins = execFileSync('/usr/bin/git', ['for-each-ref', 'refs/baton/results/', '--format=%(objectname) %(committerdate:unix)'], { cwd: repoRoot, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean)
      .map((row) => ({ sha: row.split(' ')[0], at: Number(row.split(' ')[1]) }))
      .filter((pin) => pin.at * 1000 >= startedAtMs - 60_000)
      .sort((left, right) => right.at - left.at);
  } catch { return null; }
  const excluded = new Set(excludeShas);
  for (const pin of pins) {
    if (excluded.has(pin.sha)) continue;
    try {
      execFileSync('/usr/bin/git', ['cat-file', '-e', `${pin.sha}:${report}`], { cwd: repoRoot, stdio: 'ignore' });
      return pin.sha;
    } catch { /* pin does not carry this report path */ }
  }
  return null;
}

export async function createWave(baton, options = {}) {
  if (!baton || !baton.runs || typeof baton.runs.start !== 'function') {
    throw waveError('createWave requires a Baton client facade with runs.start');
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw waveError('wave options are invalid');
  const membersInput = options.members;
  if (!Array.isArray(membersInput) || membersInput.length === 0 || membersInput.length > 64) {
    throw waveError('wave members must be one bounded non-empty array');
  }
  const approve = options.approve !== false;
  const repoRoot = typeof options.repoRoot === 'string' && options.repoRoot.length > 0 ? options.repoRoot : null;
  const members = membersInput.map((member, index) => validateMember(member, index, repoRoot));
  if (new Set(members.map(({ role }) => role)).size !== members.length) {
    throw waveError('wave member roles contain duplicates');
  }

  const state = {
    startedAt: Date.now(),
    members: new Map(),
    outcomes: [],
    progress: [],
    steering: [],
    stops: [],
  };

  // Start members individually and explicitly approve each — nothing parks on a silent
  // authority gate, and one member's start failure never aborts the others.
  for (const member of members) {
    const entry = { member, run: null, startError: null };
    try {
      const route = member.exact
        ? { exact: member.exact }
        : { harness: member.harness, model: member.model, effort: member.effort };
      entry.run = await baton.runs.start(member.objective, { ...route, scope: [...member.scope], driverKind: 'wave' });
      if (approve) await entry.run.approve();
    } catch (error) {
      entry.startError = { code: error?.code ?? null, message: String(error?.message ?? error) };
    }
    state.members.set(member.role, entry);
  }

  async function progress() {
    const members = [];
    for (const [role, entry] of state.members) {
      if (!entry.run) {
        // §7.2: a wave member that never started surfaces the canonical member state `failed`
        // with a typed cause (`start`), never the legacy run phase `start_failed`.
        members.push({ role, phase: 'failed', terminalCause: 'start', terminal: true, attention: null, error: entry.startError });
        continue;
      }
      const view = await entry.run.status();
      const outline = view?.view ?? view ?? {};
      members.push({
        role,
        phase: canonicalRunPhase(outline.phase) ?? null,
        terminal: terminalFrom(outline),
        attention: attentionFrom(outline),
        scratchpad: outline.scratchpad ?? null,
        elapsedMs: Date.now() - state.startedAt,
      });
    }
    const snapshot = { elapsedMs: Date.now() - state.startedAt, members };
    boundedJsonBytes(snapshot);
    state.progress.push({ at: new Date().toISOString(), members: members.map(({ role, phase }) => ({ role, phase })) });
    return snapshot;
  }

  const pumps = new Map();
  function armPump(entry) {
    if (!entry.run || pumps.get(entry.member.role)) return;
    const promise = entry.run.complete().then(
      () => { pumps.delete(entry.member.role); },
      () => { pumps.delete(entry.member.role); },
    );
    pumps.set(entry.member.role, promise);
  }

  // docs/31: pumps never outlive the call that armed them. Before settle returns (including its
  // own timeout), drain outstanding pumps with a bounded grace so nothing keeps driving in the
  // background and races close().
  async function drainPumps(graceMs = 2_000) {
    if (pumps.size === 0) return true;
    const pending = [...pumps.values()];
    const drained = await Promise.race([
      Promise.allSettled(pending).then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), graceMs)),
    ]);
    return drained;
  }

  function pumpQuiescent() { return pumps.size === 0; }

  async function send(role, message, options = {}) {
    const entry = state.members.get(role);
    if (!entry?.run) throw waveError(`wave member ${role} is not running`);
    const receipt = await entry.run.send(message, options);
    state.steering.push({ role, at: new Date().toISOString(), state: 'sent' });
    return receipt;
  }

  async function stopMember(role, { reason = 'Wave selective member stop.', timeoutMs = 5_000 } = {}) {
    const entry = state.members.get(role);
    if (!entry?.run) throw waveError(`wave member ${role} is not running`);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        await entry.run.act('stop_member', { role, reason });
        state.stops.push({ role, via: 'stop_member', at: new Date().toISOString() });
        return { admitted: true, role };
      } catch (error) {
        if (error?.code === 'application_action_unavailable') {
          const receipt = await entry.run.stop(reason);
          state.stops.push({ role, via: 'run.stop', receipt: receipt?.stop ?? null, ownership: receipt?.ownership ?? null });
          return { stopped: true, role, receipt };
        }
        if (!['application_action_scope_mismatch', 'application_workflow_member_stop_unavailable'].includes(error?.code)
          || Date.now() > deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    }
  }

  async function materialize(entry) {
    const { member, run } = entry;
    // Result section first (docs/31 #6): run.inspect returns `section` at top level — there is
    // no `.view` wrapper; a `.view.section` read silently disables this path.
    try {
      const results = await run.inspect({ depth: 'section', section: 'result' });
      const value = results?.section?.items?.[0]?.value;
      if (RESULT_SHA.test(value?.sha ?? '')) return value.sha;
    } catch { /* section projection can be empty post-stop */ }
    if (!repoRoot || !member.report) return null;
    return resolveResultPin({
      repoRoot,
      report: member.report,
      startedAtMs: state.startedAt,
      excludeShas: state.outcomes.map((outcome) => outcome.resultSha).filter(Boolean),
    });
  }

  async function settle({ timeoutMs = 60_000 } = {}) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw waveError('wave settle timeoutMs is invalid');
    const deadline = Date.now() + timeoutMs;
    const settled = new Set([...state.members.keys()].filter((role) => !state.members.get(role).run));
    while (settled.size < state.members.size && Date.now() < deadline) {
      for (const [role, entry] of state.members) {
        if (settled.has(role) || !entry.run) continue;
        const view = await entry.run.status();
        const outline = view?.view ?? view;
        if (terminalFrom(outline) || canonicalRunPhase(outline?.phase) === SUCCESS_RESTING) {
          settled.add(role);
        } else {
          armPump(entry);
        }
      }
      if (settled.size < state.members.size) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    }
    for (const [role, entry] of state.members) {
      if (state.outcomes.some((outcome) => outcome.role === role)) continue;
      const outcome = { role };
      if (!entry.run) {
        Object.assign(outcome, { phase: 'failed', terminalCause: 'start', terminal: true, narrative: null, resultSha: null, error: entry.startError });
      } else {
        try {
          const view = await entry.run.status();
          const outline = view?.view ?? view ?? {};
          outcome.phase = canonicalRunPhase(outline.phase) ?? null;
          outcome.terminal = terminalFrom(outline);
          outcome.narrative = outline.narrative ?? null;
          outcome.resultSha = await materialize(entry);
        } catch (error) {
          Object.assign(outcome, { phase: 'outcome_error', terminal: false, resultSha: null, error: { code: error?.code ?? null, message: String(error?.message ?? error) } });
        }
      }
      state.outcomes.push(outcome);
    }
    const pumpsDrained = await drainPumps();
    state.pumpDrained = pumpsDrained && pumpQuiescent();
    return [...state.outcomes];
  }

  async function close({ reason = 'Wave settled.' } = {}) {
    await drainPumps();
    const stops = [];
    for (const [role, entry] of state.members) {
      if (!entry.run) continue;
      try {
        const stopped = await entry.run.stop(reason);
        const outline = stopped?.outline ?? {};
        // Residue truth is the RunView's resources block (ownedCount/cleanupState); a stop view
        // without it is reported as unknown, never coalesced to zero (docs/31 #8).
        const resources = outline.resources ?? null;
        const ownedCount = Number.isSafeInteger(resources?.ownedCount) ? resources.ownedCount : null;
        stops.push({
          role,
          stop: stopped?.stop ?? null,
          resources: resources ? { state: resources.state ?? null, cleanupState: resources.cleanupState ?? null, ownedCount } : null,
          ownedCount,
        });
      } catch (error) {
        stops.push({ role, ownedCount: null, error: { code: error?.code ?? null, message: String(error?.message ?? error) } });
      }
    }
    state.stops.push(...stops);
    const remainingCount = stops.reduce((total, stop) => total + (stop.ownedCount ?? 1), 0);
    const residueUnknown = stops.some((stop) => stop.ownedCount === null);
    return { reason, stops, remainingCount, residueUnknown };
  }

  function evidence() {
    return {
      schemaVersion: 1,
      startedAt: new Date(state.startedAt).toISOString(),
      members: members.map(({ role }) => role),
      outcomes: [...state.outcomes],
      steering: [...state.steering],
      stops: [...state.stops],
      progress: [...state.progress],
      pumpDrained: state.pumpDrained === true,
    };
  }

  const wave = {
    get runs() {
      return new Map([...state.members.entries()].filter(([, entry]) => entry.run).map(([role, entry]) => [role, entry.run]));
    },
    get pumpQuiescent() { return pumpQuiescent(); },
    progress, send, stopMember, settle, close, evidence,
  };
  return Object.freeze(wave);
}

export default createWave;
