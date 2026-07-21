// Wave driver surface (docs/31): first-class orchestration waves over any Baton client facade.
// A wave is data — a member roster plus objectives — and every lifecycle semantic is Baton's
// own: explicit per-member approval, per-member isolation, re-armed drive pumps (never a
// terminal signal), the closed terminal-phase set, attention surfacing, result materialization
// with path-existence pin disambiguation, selective member stop, and zero-residue close.
// Program-IR aligned: members ↔ parallel branches, settle ↔ join, materialization ↔ collect,
// stopMember ↔ selective stop, evidence() ↔ the wave trace. It holds no durable state of its own.

const TERMINAL_PHASES = new Set(['stopped', 'failed', 'cancelled', 'completed']);
const SUCCESS_RESTING = 'work_completed';
const RESULT_SHA = /^[a-f0-9]{40,64}$/u;
const GLOB_MAGIC = /[*?[\]{}!+@]/u;
const POLL_MS = 50;

function waveError(message, code = 'wave_invalid') {
  return Object.assign(new TypeError(message), { code });
}

function validateMember(member, index) {
  if (!member || typeof member !== 'object' || Array.isArray(member)) {
    throw waveError(`wave member[${index}] must be an object`);
  }
  const role = member.role;
  if (typeof role !== 'string' || role.trim().length === 0) throw waveError(`wave member[${index}] role is invalid`);
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
      const basename = entry.replace(/\/+$/u, '').split('/').pop() ?? '';
      if (!basename.includes('.')) {
        throw waveError(
          `wave member ${role} scope entry "${entry}" names a bare directory, which matches only `
          + `itself under glob scope semantics; use "${entry.replace(/\/+$/u, '')}/**" instead`,
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
  return outline?.terminal === true || TERMINAL_PHASES.has(outline?.phase);
}

function attentionFrom(outline) {
  const attention = outline?.attention;
  if (Array.isArray(attention) && attention.length === 0) return null;
  if (attention === 'clear') return null;
  if (attention !== null && attention !== undefined) return attention;
  const phase = outline?.phase;
  if (phase === 'awaiting_plan_approval') return 'blocked_interaction:approve_plan';
  if (phase === 'selection_required') return 'blocked_interaction:select_candidate';
  if (phase === 'input_required') return 'blocked_interaction:answer_required';
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
  const members = membersInput.map(validateMember);
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
      entry.run = await baton.runs.start(member.objective, { ...route, scope: [...member.scope] });
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
        members.push({ role, phase: 'start_failed', terminal: true, attention: null, error: entry.startError });
        continue;
      }
      const view = await entry.run.status();
      const outline = view?.view ?? view ?? {};
      members.push({
        role,
        phase: outline.phase ?? null,
        terminal: terminalFrom(outline),
        attention: attentionFrom(outline),
        elapsedMs: Date.now() - state.startedAt,
      });
    }
    const snapshot = { elapsedMs: Date.now() - state.startedAt, members };
    state.progress.push({ at: new Date().toISOString(), members: members.map(({ role, phase }) => ({ role, phase })) });
    return snapshot;
  }

  const pumps = new Map();
  function armPump(entry) {
    if (!entry.run || pumps.get(entry.member.role) === true) return;
    pumps.set(entry.member.role, true);
    entry.run.complete().then(
      () => { pumps.set(entry.member.role, false); },
      () => { pumps.set(entry.member.role, false); },
    );
  }

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
    try {
      const results = await run.inspect({ depth: 'section', section: 'result' });
      const value = results?.view?.section?.items?.[0]?.value;
      if (RESULT_SHA.test(value?.sha ?? '')) return value.sha;
    } catch { /* section projection can be empty post-stop */ }
    if (!repoRoot || !member.report) return null;
    let pins;
    try {
      pins = (await import('node:child_process')).execFileSync('/usr/bin/git', ['for-each-ref', 'refs/baton/results/', '--format=%(objectname) %(committerdate:unix)'], { cwd: repoRoot, encoding: 'utf8' })
        .trim().split('\n').filter(Boolean)
        .map((row) => ({ sha: row.split(' ')[0], at: Number(row.split(' ')[1]) }))
        .filter((pin) => pin.at * 1000 >= state.startedAt - 60_000)
        .sort((left, right) => right.at - left.at);
    } catch { return null; }
    const used = state.outcomes.map((outcome) => outcome.resultSha).filter(Boolean);
    const { execFileSync } = await import('node:child_process');
    for (const pin of pins) {
      if (used.includes(pin.sha)) continue;
      try {
        execFileSync('/usr/bin/git', ['cat-file', '-e', `${pin.sha}:${member.report}`], { cwd: repoRoot, stdio: 'ignore' });
        return pin.sha;
      } catch { /* pin does not carry this report path */ }
    }
    return null;
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
        if (terminalFrom(outline) || outline?.phase === SUCCESS_RESTING) {
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
        Object.assign(outcome, { phase: 'start_failed', terminal: true, narrative: null, resultSha: null, error: entry.startError });
      } else {
        try {
          const view = await entry.run.status();
          const outline = view?.view ?? view ?? {};
          outcome.phase = outline.phase ?? null;
          outcome.terminal = terminalFrom(outline);
          outcome.narrative = outline.narrative ?? null;
          outcome.resultSha = await materialize(entry);
        } catch (error) {
          Object.assign(outcome, { phase: 'outcome_error', terminal: false, resultSha: null, error: { code: error?.code ?? null, message: String(error?.message ?? error) } });
        }
      }
      state.outcomes.push(outcome);
    }
    return [...state.outcomes];
  }

  async function close({ reason = 'Wave settled.' } = {}) {
    const stops = [];
    for (const [role, entry] of state.members) {
      if (!entry.run) continue;
      try {
        const stopped = await entry.run.stop(reason);
        stops.push({ role, stop: stopped?.stop ?? null, ownership: stopped?.ownership ?? null });
      } catch (error) {
        stops.push({ role, error: { code: error?.code ?? null, message: String(error?.message ?? error) } });
      }
    }
    state.stops.push(...stops);
    const remainingCount = stops.reduce((total, stop) => total + (stop.error ? 1 : (stop.ownership?.remainingCount ?? 0)), 0);
    return { reason, stops, remainingCount };
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
    };
  }

  const wave = {
    get runs() {
      return new Map([...state.members.entries()].filter(([, entry]) => entry.run).map(([role, entry]) => [role, entry.run]));
    },
    progress, send, stopMember, settle, close, evidence,
  };
  return Object.freeze(wave);
}

export default createWave;
