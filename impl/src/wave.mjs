// Wave driver surface (docs/31): first-class orchestration waves over any Baton client facade.
// A wave is data — a member roster plus objectives — and every lifecycle semantic is Baton's
// own: explicit per-member approval, per-member isolation, cancellable observer-owned drive pumps
// (never a terminal signal, never lifecycle authority), the closed terminal-phase set, attention
// surfacing, result materialization with path-existence pin disambiguation, selective member stop,
// and zero-residue close.
// Program-IR aligned: members ↔ parallel branches, settle ↔ join, materialization ↔ collect,
// stopMember ↔ selective stop, evidence() ↔ the wave trace. It holds no durable state of its own.

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { FRAME_LIMITS } from './limits.mjs';

import { applicationTerminal, canonicalRunPhase } from './application-semantics.mjs';

// docs/36 §7.1/L4: terminality is the registry predicate — the wave no longer hand-maintains its
// own union (the F5 divergence where it omitted `denied`/`closed` is gone). `result_ready` is the
// canonical provider-settled resting state (legacy `work_completed`).
const SUCCESS_RESTING = 'result_ready';
const RESULT_SHA = /^[a-f0-9]{40,64}$/u;
const GLOB_MAGIC = /[*?[\]{}!+@]/u;
const POLL_MS = 50;
export const MAX_WAVE_PROGRESS_BYTES = FRAME_LIMITS['wave.progress_bytes'].value;

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

// Bound ONE facade read by the observer's own budget (settle's deadline) and, for a caller-owned
// observation, the caller's signal. A read that does not answer in time is an OBSERVATION failure:
// the member keeps its real lifecycle, the receipt records that the observer could not see it, and
// no phase is invented. The abandoned read stays handled on both contests — so a read that settles
// or rejects after its observation ended can neither escape as an unhandled rejection nor write
// into a newer observation (it resolves into nothing).
function observeRead(read, { deadline = Infinity, signal = null } = {}) {
  const observation = Promise.resolve(read);
  const bounded = Number.isFinite(deadline);
  if (!bounded && !signal) return observation;
  const contests = [observation];
  let timer = null;
  let onAbort = null;
  if (bounded) {
    const remaining = deadline - Date.now();
    contests.push(new Promise((_, reject) => {
      const expire = () => reject(waveError('wave observer budget elapsed', 'wave_observer_timeout'));
      if (remaining <= 0) { expire(); return; }
      timer = setTimeout(expire, remaining);
    }));
  }
  if (signal) {
    contests.push(new Promise((_, reject) => {
      const cancel = () => reject(waveError('wave observation was cancelled by its caller', 'wave_observer_cancelled'));
      if (signal.aborted) { cancel(); return; }
      onAbort = cancel;
      signal.addEventListener('abort', onAbort, { once: true });
    }));
  }
  return Promise.race(contests).finally(() => {
    if (timer !== null) clearTimeout(timer);
    if (onAbort !== null) signal.removeEventListener('abort', onAbort);
  });
}

// The poll delay, ended early by the observer's own cancellation: an observation its caller
// cancelled must not wait out a poll interval before it detaches.
function observeDelay(ms, signal) {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      reject(waveError('wave observation was cancelled by its caller', 'wave_observer_cancelled'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener('abort', cancel, { once: true });
  });
}

// One per-member failure record — the typed code plus the verbatim message, never synthesized.
// Every wave projection that reports a member failure (start, observation, stop) carries this
// shape so the same failure reads identically from progress(), settle(), and close().
function failureRecord(error) {
  return { code: error?.code ?? null, message: String(error?.message ?? error) };
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
  if ((typeof member.objective !== 'string' || member.objective.trim().length === 0)
    && (typeof member.objectiveRef !== 'string' || member.objectiveRef.trim().length === 0)) {
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

// #171 (deliverable pre-seeding) + #114: a spec-shaped member (objectiveRef, no objective) renders
// its objective from the referenced file and pre-seeds its declared report with the verbatim
// [attempt: <salt> <role>] header; a pre-rendered member (the interpreter path) passes through.
function renderWaveMember(member, index, repoRoot, salt) {
  const base = validateMember(member, index, repoRoot);
  if (typeof base.objective === 'string' && base.objective.trim().length > 0) return base;
  const ref = base.objectiveRef;
  let text = '';
  if (repoRoot && ref) {
    try { text = readFileSync(resolve(repoRoot, ref), 'utf8'); }
    catch { /* scaffold — a missing objectiveRef is the interpreter's render-time refusal */ }
  }
  const objective = `[attempt: ${salt} ${base.role}] ${text}`.trimEnd();
  const rendered = { role: base.role, objective, exact: { ...base.exact }, scope: [...base.scope] };
  if (base.report !== undefined) rendered.report = base.report;
  preseedReport(repoRoot, rendered, salt);
  return Object.freeze(rendered);
}

function preseedReport(repoRoot, member, salt) {
  if (!repoRoot || typeof member.report !== 'string' || member.report.length === 0) return;
  const root = resolve(repoRoot);
  const target = resolve(repoRoot, member.report);
  if (target !== root && !target.startsWith(`${root}${sep}`)) return;
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `[attempt: ${salt} ${member.role}]\n`);
  } catch { /* scaffold — a member writing its own report overrides */ }
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
//
// The git reads are asynchronous and abortable: pin resolution is part of an observer's invocation
// window, so a spent budget or a caller's cancellation ends an in-flight subprocess instead of
// being overrun by it (a synchronous read cannot honour either).
export async function resolveResultPin({ repoRoot, report, startedAtMs, excludeShas = [], signal = null }) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0 || typeof report !== 'string'
    || report.length === 0 || !Number.isSafeInteger(startedAtMs)) return null;
  if (signal?.aborted) return null;
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const git = promisify(execFile);
  // `signal: null` is rejected by the child-process API: pass the option only when there is one.
  const abortable = (options) => (signal ? { ...options, signal } : options);
  let pins;
  try {
    const { stdout } = await git(
      '/usr/bin/git',
      ['for-each-ref', 'refs/baton/results/', '--format=%(objectname) %(committerdate:unix)'],
      abortable({ cwd: repoRoot, encoding: 'utf8' }),
    );
    pins = stdout.trim().split('\n').filter(Boolean)
      .map((row) => ({ sha: row.split(' ')[0], at: Number(row.split(' ')[1]) }))
      .filter((pin) => pin.at * 1000 >= startedAtMs - 60_000)
      .sort((left, right) => right.at - left.at);
  } catch { return null; }
  const excluded = new Set(excludeShas);
  for (const pin of pins) {
    if (signal?.aborted) return null;
    if (excluded.has(pin.sha)) continue;
    try {
      await git('/usr/bin/git', ['cat-file', '-e', `${pin.sha}:${report}`], abortable({ cwd: repoRoot, stdio: 'ignore' }));
      return pin.sha;
    } catch { /* pin does not carry this report path (or the read was aborted) */ }
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
  // 93B rule 1: durable wave identity minted pre-loop. An explicit options.idempotencyKey
  // means "this is one logical wave" — a client retry derives the same waveId, and the
  // pre-loop `wave.started` record (minted inside the first member's run.start) dedups by
  // its key so only the first attempt actually mints it. A fresh uuid means a fresh wave.
  const idempotencyKey = options.idempotencyKey !== undefined
    ? validateWaveIdempotencyKey(options.idempotencyKey)
    : randomUUID();
  const waveId = `wave:${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32)}`;
  // #183 (wave_already_terminal): a terminal wave's key refuses typed BEFORE member validation —
  // never a silent replay. A fresh (unkeyed) start skips the lookup. The wave-driver's ritual
  // re-drive (allowTerminalReplay: true) is the idempotent resume path — its same-key re-drive
  // re-attaches via runId dedupe rather than replays, so it skips this refusal.
  if (options.idempotencyKey !== undefined && options.allowTerminalReplay !== true
    && typeof baton._assertWaveStartReplayable === 'function') {
    await baton._assertWaveStartReplayable(waveId);
  }
  const salt = randomUUID();
  const members = membersInput.map((member, index) => renderWaveMember(member, index, repoRoot, salt));
  if (new Set(members.map(({ role }) => role)).size !== members.length) {
    throw waveError('wave member roles contain duplicates');
  }
  const roster = members.map((member) => member.role);

  const state = {
    startedAt: Date.now(),
    members: new Map(),
    outcomes: [],
    progress: [],
    steering: [],
    stops: [],
  };

  // Admit members concurrently: every start is INITIATED in roster order (the map runs each
  // per-member admission synchronously up to its first await) but awaited together, so a slow
  // provider/admission on one member never head-of-line blocks an unrelated sibling. Each member
  // owns its try/catch — one member's start/approve failure must never abort the others, and no
  // admission rejection can escape into the shared Promise.all. Entries commit to `state.members`
  // in roster order AFTER all admissions settle, so the roster/result/progress projections stay
  // deterministic regardless of which member finishes first.
  const admitted = await Promise.all(members.map(async (member) => {
    const entry = { member, run: null, startError: null };
    try {
      const route = member.exact
        ? { exact: member.exact }
        : { harness: member.harness, model: member.model, effort: member.effort };
      // 93B: waveId/waveRole bind each run to this wave (into steering.registered, so a
      // driver dying mid-loop leaves members discoverable); every member's start carries the
      // same waveStart payload, and the waveId-keyed append dedup means whichever admission
      // lands first mints the pre-loop wave.started record.
      entry.run = await baton.runs.start(member.objective, {
        ...route, scope: [...member.scope], driverKind: 'wave',
        waveId, waveRole: member.role,
        waveStart: { roster, idempotencyKey },
      });
      if (approve) await entry.run.approve();
    } catch (error) {
      entry.startError = failureRecord(error);
    }
    return entry;
  }));
  for (const entry of admitted) state.members.set(entry.member.role, entry);

  return createWaveHandle({ repoRoot, members, state, waveId });
}

function validateWaveIdempotencyKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) {
    throw waveError('wave idempotencyKey is invalid', 'wave_idempotency_invalid');
  }
  return value;
}

// 93B rule 2: attach-and-harvest. Rediscover a prior wave's member runs from the run list
// (objective match — driver objectives are salted unique per wave, and identical intent
// digests resolve to the SAME run, so an objective fingerprints one logical member) and
// return the SAME live handle shape over the existing runs. Members that were
// recovery-terminalized in the gap read as their honest terminal phases; their outcomes
// harvest through the result section (or checkpoint pins when repoRoot is passed). The
// caller's mintDetached callback fires exactly once on the first successfully attached run
// (the application-side wave.driver_detached key dedups across repeated attaches).
// startedAt seeds from the earliest MATCHED member's start — the tight correct lower bound
// for pin disambiguation (a member result cannot be preserved before that member started).
export async function attachWave(baton, waveId, membersInput, mintDetached, repoRoot = null) {
  if (!baton || !baton.runs || typeof baton.runs.attach !== 'function' || typeof baton.runs.list !== 'function') {
    throw waveError('attachWave requires a Baton client facade with runs.attach and runs.list');
  }
  // S-1 v2 R-WG-4: the binding proof is a required step of attach — the mint callback is no
  // longer optional. Portable transports route through the waves.attach command (server-side
  // proof) instead of this live-handle path.
  if (typeof mintDetached !== 'function') {
    throw waveError('wave attach requires server-side binding proof', 'wave_attach_proof_required');
  }
  if (typeof waveId !== 'string' || !/^wave:[a-f0-9]{32}$/u.test(waveId)) throw waveError('wave id is invalid');
  if (!Array.isArray(membersInput) || membersInput.length === 0 || membersInput.length > 64) {
    throw waveError('wave attach members must be one bounded non-empty array');
  }
  const members = membersInput.map((member, index) => validateMember(member, index, repoRoot));
  if (new Set(members.map(({ role }) => role)).size !== members.length) {
    throw waveError('wave attach member roles contain duplicates');
  }
  const listed = await baton.runs.list();
  if (!Array.isArray(listed?.items)) throw waveError('wave attach run list is invalid', 'wave_attach_protocol_invalid');
  const wanted = new Map(members.map((member) => [member.objective, member]));
  const matched = new Map();
  for (const item of listed.items) {
    if (typeof item?.objective === 'string' && wanted.has(item.objective)
      && typeof item?.id === 'string' && !matched.has(item.objective)) {
      matched.set(item.objective, item);
    }
  }
  const earliest = [...matched.values()]
    .map((item) => Date.parse(item?.startedAt ?? ''))
    .filter((value) => Number.isFinite(value))
    .reduce((minimum, value) => Math.min(minimum, value), Date.now());
  const state = {
    startedAt: earliest,
    members: new Map(),
    outcomes: [],
    progress: [],
    steering: [],
    stops: [],
  };
  let attachedCount = 0;
  for (const member of members) {
    const entry = { member, run: null, startError: null };
    const record = matched.get(member.objective);
    if (record) {
      try {
        const run = await baton.runs.attach(record.id);
        // 93B rule 2 fold (W93-4) / S-1 v2 R-WG-4: every matched run must PROVE its binding —
        // the required mint callback asserts this attach's waveId against the run's
        // steering.registered record and throws application_wave_member_mismatch on any run
        // bound to another wave (or to none). A matched-but-mismatched run is excluded, never
        // silently adopted. The application-side wave.driver_detached key dedups the mint.
        await mintDetached(record.id);
        entry.run = run;
        attachedCount += 1;
      } catch (error) {
        entry.startError = failureRecord(error);
      }
    } else {
      entry.startError = { code: 'wave_member_not_found', message: 'no run matches this member objective' };
    }
    state.members.set(member.role, entry);
  }
  // An attach that binds ZERO members is a mistyped or foreign waveId — refuse with a typed
  // error rather than return a hollow handle (W93-4: never a silent new wave).
  if (attachedCount === 0) {
    throw waveError('wave attach bound no members of the asserted wave', 'wave_attach_unknown_wave');
  }
  return createWaveHandle({ repoRoot, members, state, waveId });
}

function createWaveHandle({ repoRoot, members, state, waveId = null }) {
  async function progress(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some((key) => key !== 'signal')) {
      throw waveError('wave progress options are invalid');
    }
    const { signal } = options;
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
      throw waveError('wave progress signal is invalid');
    }
    // A caller's cancellation ends THIS observation as a typed refusal (the run.followOnce
    // convention for a cancelled read), never a partial snapshot passed off as a roster
    // observation and never any lifecycle effect on a member. In-flight reads stay handled — the
    // bound and the abandoned-read discipline live in observeRead.
    if (signal?.aborted) throw waveError('wave progress was cancelled by its caller', 'wave_observer_cancelled');
    // Observe every member CONCURRENTLY: the historical serial for-of awaited each run.status()
    // before touching the next member, so one slow or failing participant withheld every later
    // peer's observation (wave head-of-line blocking). Promise.all keeps the DECLARED roster order
    // in the returned array regardless of which member finishes first, and each member owns its
    // catch: a status rejection is that member's observation failure — phase unknown, never
    // terminal, never a peer's problem.
    const members = await Promise.all([...state.members].map(async ([role, entry]) => {
      if (!entry.run || entry.startError) {
        // §7.2 + #230: a member whose start OR approve phase threw surfaces `failed` with the
        // typed cause — a live handle that can never dispatch must not read as a silent member.
        return { role, phase: 'failed', terminalCause: 'start', terminal: true, attention: null, error: entry.startError, knowledgeDigest: null };
      }
      try {
        const view = await observeRead(entry.run.status(), { signal });
        const outline = view?.view ?? view ?? {};
        return {
          role,
          phase: canonicalRunPhase(outline.phase) ?? null,
          terminal: terminalFrom(outline),
          attention: attentionFrom(outline),
          scratchpad: outline.scratchpad ?? null,
          // KG activation rule 4: the workflow horizon's knowledge digest rides the member's run view,
          // so an orchestrator sees knowledge state change across polls without re-reading the horizon.
          knowledgeDigest: outline.knowledgeDigest ?? null,
          elapsedMs: Date.now() - state.startedAt,
        };
      } catch (error) {
        // The caller's own cancellation is never a member observation failure: it ends the whole
        // observation as the typed refusal above.
        if (error?.code === 'wave_observer_cancelled') throw error;
        // An unreadable member is never given a phase it did not report and never reads terminal:
        // the row carries the typed observation failure and the normal row shape for every other
        // field. The failure is per-observation — the next progress() call re-reads from scratch.
        return {
          role,
          phase: null,
          terminal: false,
          attention: null,
          scratchpad: null,
          knowledgeDigest: null,
          error: failureRecord(error),
          elapsedMs: Date.now() - state.startedAt,
        };
      }
    }));
    const snapshot = { elapsedMs: Date.now() - state.startedAt, members };
    boundedJsonBytes(snapshot);
    state.progress.push({ at: new Date().toISOString(), members: members.map(({ role, phase }) => ({ role, phase })) });
    return snapshot;
  }

  // ── Observer-owned drive pumps ──────────────────────────────────────────────
  // A drive pump is an OBSERVER: `run.complete()` keeps a member's run moving while the wave
  // watches it. It is never lifecycle authority — cancelling one requests the end of the drive
  // loop, never the worker, and `stop`/`close` remain the only paths that end member work.
  //
  // At most ONE drive exists per member. Two concurrent `complete()` loops would interleave the
  // same run handle's client state, and a drive that was cancelled but has NOT settled (a facade
  // that ignored the abort) must not be forgotten and re-driven underneath: its record is kept
  // until it actually settles, so the outstanding observer stays visible.
  //
  // Every observation that wants a live drive holds an OWNER token on it. A pump is cancelled only
  // when no owner remains, so releasing one observation never cancels a pump a concurrent
  // observation still holds: overlapping settle calls cannot cancel each other.
  const pumps = new Map(); // role → { controller, owners:Set, promise, ended, cancelled }
  // Once close begins, no new drive may be armed: it would race the member stops close is issuing.
  let closing = false;
  // Observation invocations are ordered: the handle's ledger is published by invocation, so an
  // earlier settle finishing late never overwrites what a later settle already published.
  let invocationSeq = 0;
  let publishedSeq = 0;

  function armPump(entry, owner) {
    // An observation that has been abandoned (its caller cancelled it, or it failed) must not
    // leave a drive behind that nobody will ever release.
    if (closing || owner.abandoned) return null;
    const role = entry.member.role;
    const existing = pumps.get(role);
    if (existing) {
      // A live drive is shared, never duplicated; a cancelled drive awaiting its settlement is
      // neither inherited (its controller is already aborted) nor replaced (starting a second loop
      // over the same run handle is exactly what must not happen).
      if (!existing.cancelled) existing.owners.add(owner);
      return existing;
    }
    const controller = new AbortController();
    const record = { role, controller, owners: new Set([owner]), ended: false, cancelled: false };
    record.promise = Promise.resolve(entry.run.complete({ signal: controller.signal }))
      .then(() => {}, () => {}) // the drive outcome belongs to the run, never to the observer
      .then(() => {
        record.ended = true;
        // Identity-checked reaping: only the record that is still current removes itself, so a
        // late settlement can never delete a successor.
        if (pumps.get(role) === record) pumps.delete(role);
      });
    pumps.set(role, record);
    return record;
  }

  // Detach one observation's ownership. A pump is cancelled only when its last owner releases, so
  // concurrent observations never cancel each other; `releasePumps()` with no owner retires every
  // pump (close). Cancellation REQUESTS the end of a drive loop — it is not proof that the facade's
  // loop ended, which is why the record is kept until its promise settles and why callers report
  // `pumpQuiescent` rather than assuming closure.
  function releasePumps(owner = null) {
    const cancelled = [];
    for (const record of pumps.values()) {
      if (owner === null) record.owners.clear();
      else if (!record.owners.delete(owner)) continue;
      if (record.owners.size > 0 || record.cancelled) continue;
      record.cancelled = true;
      record.controller.abort();
      cancelled.push(record);
    }
    return cancelled;
  }

  // Confirm that cancelled pumps were OBSERVED ending, bounded by the invocation deadline. There is
  // no grace period here: a facade that ignores the abort simply never confirms, and the caller
  // reports the uncertainty (pumpQuiescent false, pumpDrained false) instead of claiming closure.
  async function observeRetired(records, deadline, signal) {
    const pending = records.filter((record) => !record.ended);
    if (pending.length === 0) return true;
    const settled = Promise.allSettled(pending.map((record) => record.promise)).then(() => true);
    try {
      return await observeRead(settled, { deadline, signal });
    } catch (error) {
      if (error?.code === 'wave_observer_timeout') return false;
      throw error;
    }
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

  // Read the member's preserved result section inside the invocation window (docs/31 #6: run.inspect
  // returns `section` at top level — a `.view.section` read silently disables this path). `answered`
  // is false only when the read did not answer at all (a timeout, a failure, or a window that was
  // already spent), so a result that could not be read is never reported as a result that was not
  // there. A handle with no result surface at all answers "no authoritative sha".
  async function materialize(entry, { deadline, signal, canRead }) {
    const { run } = entry;
    if (!canRead()) return { sha: null, answered: false };
    if (typeof run.inspect !== 'function') return { sha: null, answered: true };
    try {
      const results = await observeRead(run.inspect({ depth: 'section', section: 'result' }), { deadline, signal });
      const value = results?.section?.items?.[0]?.value;
      return { sha: RESULT_SHA.test(value?.sha ?? '') ? value.sha : null, answered: true };
    } catch (error) {
      // A caller's cancellation is never a member observation failure: it ends the observation.
      if (error?.code === 'wave_observer_cancelled') throw error;
      return { sha: null, answered: false, error: failureRecord(error) };
    }
  }

  async function settle({ timeoutMs = 60_000, signal } = {}) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw waveError('wave settle timeoutMs is invalid');
    if (signal !== undefined && !(signal instanceof AbortSignal)) throw waveError('wave settle signal is invalid');
    if (signal?.aborted) throw waveError('wave settle was cancelled by its caller', 'wave_observer_cancelled');
    // ONE invocation deadline governs everything this call does — status reads, result reads, the
    // poll cadence, pin resolution and the confirmation of the drive pumps it armed. Nothing is
    // started after it and nothing gets a second allowance; a member whose read does not answer
    // inside it settles as UNOBSERVED, never withheld and never invented.
    const owner = { abandoned: false };
    const invocation = (invocationSeq += 1);
    const deadline = Date.now() + timeoutMs;
    // One shared window for every per-member loop, and for the abortable pin subprocess reads below.
    const deadlineAbort = new AbortController();
    const deadlineTimer = setTimeout(() => deadlineAbort.abort(), timeoutMs);
    const pinSignal = signal ? AbortSignal.any([signal, deadlineAbort.signal]) : deadlineAbort.signal;
    // The latest observation taken for each member INSIDE the window. The receipt is built from
    // these retained observations; nothing is re-read after the deadline.
    const retained = new Map();
    // Nothing NEW may be started once the observation is abandoned (its caller cancelled it) or its
    // budget is spent: no facade read, no drive admission, no pin resolution.
    const canObserve = () => !owner.abandoned && !signal?.aborted && Date.now() < deadline;
    const cadence = () => Math.max(0, Math.min(POLL_MS, deadline - Date.now()));
    try {
      // Every member is observed by its OWN loop against the shared deadline. A whole-round barrier
      // would let one hung member withhold every sibling's next read (and so lose a sibling's later
      // progress entirely); here a hung member only ever delays the roster AGGREGATION below, while
      // a healthy member keeps being observed on its own cadence until it rests.
      await Promise.all([...state.members].map(async ([role, entry]) => {
        if (!entry.run || entry.startError) return; // a typed start failure settles without observation
        const record = {
          observed: false, phase: null, resting: false, terminal: false,
          narrative: null, attention: null, resultSha: null, observationError: null,
          // #396: the member's OWN named wait (its waitingOn projection, if any) — retained
          // per member alongside the last good observation, never withheld behind a sibling.
          waitingOn: null,
        };
        retained.set(role, record);
        while (canObserve() && !record.resting) {
          try {
            const view = await observeRead(entry.run.status(), { deadline, signal });
            const outline = view?.view ?? view ?? {};
            const phase = canonicalRunPhase(outline.phase) ?? null;
            record.observed = true;
            record.phase = phase;
            // `resting` is the loop's settle condition (terminal or the provider-settled resting
            // state, which is not application-terminal); `terminal` is the receipt's own claim,
            // exactly as before: a resting member still reports terminal:false.
            record.resting = terminalFrom(outline) || phase === SUCCESS_RESTING;
            record.terminal = terminalFrom(outline);
            record.narrative = outline.narrative ?? null;
            record.attention = attentionFrom(outline);
            record.waitingOn = outline.waitingOn ?? null;
            record.observationError = null;
            // A drive is admitted ONLY on a read that answered and still found the member running:
            // a read that timed out or failed is uncertainty, never a reason to drive — and never a
            // facade effect started after the budget.
            if (!record.resting && canObserve()) armPump(entry, owner);
          } catch (error) {
            // The caller's own cancellation ends the whole invocation as the typed refusal below.
            if (error?.code === 'wave_observer_cancelled') throw error;
            // A read that did not answer is retained as uncertainty ALONGSIDE the last good
            // observation; it never erases the phase this member was last seen in.
            record.observationError = failureRecord(error);
          }
          if (!record.resting && canObserve()) await observeDelay(cadence(), signal);
        }
        // The preserved result, read once inside the window as soon as the member rests: an answer
        // with no authoritative sha settles as no result, a read that did not answer leaves the
        // uncertainty visible instead of inventing a result.
        if (record.resting && record.resultSha === null) {
          const result = await materialize(entry, { deadline, signal, canRead: canObserve });
          if (result.sha !== null) record.resultSha = result.sha;
          else if (result.error) record.observationError = result.error;
        }
      }));
      // timeoutMs is an OBSERVATION BUDGET, never completion authority: nothing here stops, silences,
      // or terminally stamps a member — one still running settles with its last observed non-terminal
      // phase. And every settle call re-observes from scratch: outcomes are REFRESHED from this
      // call's own window, never replayed from an earlier call's observation.
      //
      // The observation is over: cancel the drive pumps THIS call owns (a request, confirmed below
      // within the same deadline). A pump a concurrent observation still owns is left running,
      // because releases are per-owner. This ends an observer, never a worker.
      const retired = releasePumps(owner);
      //
      // Pin-attribution baseline: shas already attributed to OTHER roles by prior observations,
      // computed once per call so fallback re-resolution below stays deterministic. A member's
      // OWN prior pin is never excluded, so a refresh restates it idempotently instead of losing it.
      const priorOutcomes = new Map(state.outcomes.map((outcome) => [outcome.role, outcome]));
      const attributed = new Map([...state.members.keys()].map((role) => [
        role,
        state.outcomes.filter((outcome) => outcome.role !== role && outcome.resultSha).map((outcome) => outcome.resultSha),
      ]));
      const observations = [...state.members].map(([role, entry]) => {
        if (!entry.run || entry.startError) {
          // #230: a member whose start OR approve phase threw is START-FAILED in wave terms —
          // createWave records startError for both (runs.start and the follow-on run.approve ride
          // the same catch). A run handle may exist (start succeeded) while the machinery can
          // never dispatch it; polling it to a quiescence-stop erases the typed refusal — the
          // fleet-wide silent-swallow that cost the 2026-08-15 wave-b packs. The typed error
          // settles verbatim, never silence.
          return { outcome: { role, phase: 'failed', terminalCause: 'start', terminal: true, narrative: null, resultSha: null, error: entry.startError }, evidence: null };
        }
        const record = retained.get(role);
        if (!record?.observed) {
          // Never observed inside this call's window: no phase, no terminality, nothing invented.
          // The typed observation failure (or the elapsed budget) is the whole record.
          return {
            outcome: {
              role,
              phase: 'outcome_error',
              terminal: false,
              resultSha: null,
              error: record?.observationError ?? { code: 'wave_observer_timeout', message: 'wave observer budget elapsed' },
            },
            evidence: null,
          };
        }
        const outcome = {
          role,
          phase: record.phase,
          terminal: record.terminal,
          narrative: record.narrative,
          resultSha: record.resultSha,
        };
        // #396: a member behind a real dependency settles with its wait named — its own
        // per-relationship truth, never a roster-wide stall read. Additive-only: a member
        // with no named wait carries no key, exactly like observationError/progressClass.
        if (record.waitingOn && typeof record.waitingOn.kind === 'string') {
          outcome.waitingOn = record.waitingOn;
        }
        // Uncertainty is reported WITH the last known phase, never instead of it.
        if (record.observationError) outcome.observationError = record.observationError;
        let evidence = null;
        // #235: the transport-liveness settle class — EVIDENCE ONLY (the #163 law holds: no
        // termination states change). A member whose latest observed view carries the
        // provider_silent attention entry (the coordinator's never-trafficked projection) settles
        // with the DISTINCT 'provider_silent' class so a wedged member never reads as plain
        // 'silent'/'quiesced' among healthy ones — and the steering evidence names it.
        const providerSilent = Array.isArray(record.attention)
          ? record.attention.find((item) => item?.kind === 'provider_silent') ?? null
          : null;
        if (providerSilent) {
          outcome.progressClass = 'provider_silent';
          // Steering evidence is one line per observation TRANSITION — a repeated settle that
          // re-observes the same silence never re-appends the line. Pushed in roster order below.
          if (priorOutcomes.get(role)?.progressClass !== 'provider_silent') {
            evidence = {
              role,
              evidence: 'provider_silent',
              summary: typeof providerSilent.summary === 'string'
                ? providerSilent.summary : 'no provider traffic observed this turn',
              note: typeof providerSilent.note === 'string' ? providerSilent.note : null,
            };
          }
        }
        return { outcome, evidence };
      });
      const outcomes = observations.map((item) => item.outcome);
      // Result reads are independent; fallback attribution contests a shared pin namespace.
      // Resolve only that attribution in roster order so two concurrent missing-result reads
      // cannot both claim the same heuristic pin. Authoritative per-run results may share a SHA.
      // The resolution rides the same invocation window, and its git subprocess calls are
      // abortable, so a spent budget or a caller's cancellation ends them instead of being
      // overrun by a synchronous call.
      const assigned = new Set(outcomes.map((outcome) => outcome.resultSha).filter(Boolean));
      for (const outcome of outcomes) {
        const entry = state.members.get(outcome.role);
        if (outcome.resultSha || outcome.error || !repoRoot || !entry.member.report) continue;
        if (!canObserve()) break;
        outcome.resultSha = await resolveResultPin({
          repoRoot, report: entry.member.report, startedAtMs: state.startedAt,
          excludeShas: [...assigned, ...(attributed.get(outcome.role) ?? [])],
          signal: pinSignal,
        });
        if (outcome.resultSha) assigned.add(outcome.resultSha);
      }
      await observeRetired(retired, deadline, signal);
      if (signal?.aborted) throw waveError('wave observation was cancelled by its caller', 'wave_observer_cancelled');
      // The handle's ledger is the LAST observation per role, not an append-only log of stale reads —
      // and it is published by INVOCATION ORDER: an earlier settle finishing late never overwrites
      // the evidence a later settle already published.
      if (invocation > publishedSeq) {
        publishedSeq = invocation;
        for (const item of observations) if (item.evidence) state.steering.push(item.evidence);
        state.outcomes = outcomes;
      }
      return [...outcomes];
    } catch (error) {
      // An unexpected failure (including the caller's own cancellation) still ends this
      // observation's own pumps — the drives it started do not outlive the call that armed them —
      // and marks the invocation abandoned so no late per-member loop can start a facade effect.
      owner.abandoned = true;
      releasePumps(owner);
      throw error;
    } finally {
      clearTimeout(deadlineTimer);
    }
  }

  async function close({ reason = 'Wave settled.' } = {}) {
    // The wave is closing: from here no new drive pump may be armed (a fresh drive would race the
    // stops below), and every drive this handle started is asked to end BEFORE any stop is issued,
    // so a member stop is not initiated underneath an observer that is still driving. This is a
    // REQUEST, not observed closure: aborting a drive loop proves nothing about a facade that
    // ignores the abort, so close reports the drive accounting (pumpQuiescent) instead of claiming
    // the stops raced nothing. The worker's lifetime is still ended solely by the stop pass.
    closing = true;
    const cancelled = releasePumps();
    // Every member's stop is INITIATED together: a slow or hung member stop must never delay an
    // unrelated member's stop from beginning (the historical serial for-of did exactly that). Each
    // member owns its catch, so one stop's rejection becomes that member's typed stop record —
    // never a hole in the roster and never a peer's problem. Promise.all keeps the DECLARED roster
    // order for the aggregation below.
    const observed = await Promise.all([...state.members.values()].map(async (entry) => {
      const role = entry.member.role;
      if (!entry.run) return null;
      try {
        const stopped = await entry.run.stop(reason);
        const outline = stopped?.outline ?? {};
        // Residue truth is the RunView's resources block (ownedCount/cleanupState); a stop view
        // without it is reported as unknown, never coalesced to zero (docs/31 #8).
        const resources = outline.resources ?? null;
        const ownedCount = Number.isSafeInteger(resources?.ownedCount) ? resources.ownedCount : null;
        return {
          record: {
            role,
            stop: stopped?.stop ?? null,
            resources: resources ? { state: resources.state ?? null, cleanupState: resources.cleanupState ?? null, ownedCount } : null,
            ownedCount,
          },
          knowledge: outline.knowledge ?? null,
        };
      } catch (error) {
        return { record: { role, ownedCount: null, error: failureRecord(error) }, knowledge: null };
      }
    }));
    const stops = observed.filter(Boolean).map((item) => item.record);
    // KG activation rule 3: aggregate the candidacy ritual counts from each member's stop outline.
    // `candidates` is repo-scoped (shared across members — the max is the honest queue size);
    // `admittedThisRun` sums each member run's admits. Zero is surfaced as 0, never a missing field.
    let knowledgeCandidates = 0;
    let knowledgeAdmitted = 0;
    for (const item of observed) {
      if (!item?.knowledge) continue;
      knowledgeCandidates = Math.max(knowledgeCandidates, item.knowledge.candidates ?? 0);
      knowledgeAdmitted += item.knowledge.admittedThisRun ?? 0;
    }
    state.stops.push(...stops);
    const remainingCount = stops.reduce((total, stop) => total + (stop.ownedCount ?? 1), 0);
    const residueUnknown = stops.some((stop) => stop.ownedCount === null);
    // Drive accounting: `pumpQuiescent: false` says an observer this close asked to end had not
    // confirmed its stop — the stop pass may have run beside a live drive (a facade that ignores
    // the abort). Reporting it is the honest alternative to claiming the stop raced nothing.
    return {
      reason,
      stops,
      remainingCount,
      residueUnknown,
      knowledge: { candidates: knowledgeCandidates, admittedThisRun: knowledgeAdmitted },
      drivesCancelled: cancelled.length,
      pumpQuiescent: pumpQuiescent(),
    };
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
      // Evidence is read now: a later drive or late settlement must not inherit an old receipt.
      pumpDrained: pumpQuiescent(),
    };
  }

  const wave = {
    waveId,
    get runs() {
      return new Map([...state.members.entries()].filter(([, entry]) => entry.run && !entry.startError).map(([role, entry]) => [role, entry.run]));
    },
    get pumpQuiescent() { return pumpQuiescent(); },
    progress, send, stopMember, settle, close, evidence,
  };
  return Object.freeze(wave);
}

export default createWave;
