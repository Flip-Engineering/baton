/**
 * story.mjs — the story compiler.
 *
 * A deterministic, read-only fold over a BatonEvent stream into a compact
 * per-worker StoryState, plus a plain-language narrative renderer and a set
 * of warning-signal computations (stalled / looping / over-budget /
 * out-of-scope / path-scope-collision / log-gap / illegal-transition).
 *
 * No LLM. No mutation of inputs. Same events -> same story (determinism is
 * the whole point: this module never reads the wall clock itself — every
 * time-sensitive computation takes an injected `now`).
 *
 * See spec/RECONCILIATION.md D3 for the canonical EventKind vocabulary and
 * spec/IMPLEMENTATION.md Cluster 3 §2 for the full contract this implements.
 */

// ---------------------------------------------------------------------------
// Typedefs (JSDoc only — see spec for full definitions)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} LogEvent
 * @property {number} seq
 * @property {string} ts
 * @property {string} worker
 * @property {string} harness
 * @property {number} turnEpoch
 * @property {string} kind
 * @property {"worker"|"orchestrator"|"human"|"policy"} actor
 * @property {boolean} [emulated]
 * @property {Object} payload
 */

/**
 * @typedef {"idle"|"working"|"stopping"|"blocked"|"input_required"|"orphaned"|"exited"} WorkerStatus
 */

/**
 * @typedef {Object} WorkerStory
 * @property {string} workerId
 * @property {string} harness
 * @property {WorkerStatus} status
 * @property {string|null} taskId
 * @property {Object|null} brief
 * @property {number} turnEpoch
 * @property {number} turnCount
 * @property {number} lastEventSeq
 * @property {string} lastEventTs
 * @property {string|null} turnStartedAtTs
 * @property {boolean} sawGap
 * @property {{tokens:number, usd:number}} budgetUsed
 * @property {Set<number>} budgetThresholdsFired
 * @property {string[]} recentActionSignatures
 * @property {Set<string>} editedPaths
 * @property {Set<string>} outOfScopePaths
 * @property {{msgId:string, question:string}[]} questionsPending
 * @property {{id:string, kind:string}[]} approvalsPending
 * @property {Set<string>} warnings
 * @property {number} spawnedAtSeq
 * @property {boolean} crashed
 * @property {{accept:boolean}|null} lastVerdict
 */

/** @typedef {Object} StoryState
 *  @property {Map<string, WorkerStory>} workers */

/** @typedef {Object} Signal
 *  @property {"stalled"|"looping"|"over_budget"|"out_of_scope"|"log_gap"|"illegal_transition"|"path_scope_collision"} type
 *  @property {string} worker
 *  @property {Object} detail
 *  @property {string} since */

// ---------------------------------------------------------------------------
// Canonical event-kind vocabulary (D3, spec/RECONCILIATION.md)
// ---------------------------------------------------------------------------

export const KIND = Object.freeze({
  SPAWNED: 'lifecycle.spawned',
  TURN_STARTED: 'lifecycle.turn_started',
  TURN_COMPLETED: 'lifecycle.turn_completed',
  SESSION_COMPACTED: 'lifecycle.session_compacted',
  EXITED: 'lifecycle.exited',
  CRASHED: 'lifecycle.crashed',
  INTERRUPT_REQUESTED: 'control.interrupt_requested',
  INTERRUPT_CONFIRMED: 'control.interrupt_confirmed',
  DELIVERY_AMENDED: 'control.delivery_amended',
  STEER: 'control.steer',
  NUDGE: 'control.nudge',
  APPROVAL_REQUESTED: 'approval.requested',
  APPROVAL_RESOLVED: 'approval.resolved',
  QUESTION_ASKED: 'question.asked',
  QUESTION_ANSWERED: 'question.answered',
  TOKENS: 'resource.tokens',
  FILE_EDIT: 'content.file_edit',
  COMMAND_EXEC: 'content.tool_call',
  KILL_CONFIRMED: 'kill.confirmed', // SC5a (phase10)
  REVERIFIED: 'verify.reverified', // SC5c (phase10) — the one kind the coordinator itself emits
  ERROR: 'error',
});

export const DEFAULT_STALL_MS = 120_000;
export const DEFAULT_LOOP_REPEAT_THRESHOLD = 3;
export const BUDGET_THRESHOLDS = Object.freeze([0.5, 0.8, 1.0]);
export const MAX_ACTION_SIGNATURE_WINDOW = 10;

// States in which "stalled" must never fire — the worker is legitimately
// waiting on someone else, not silently stuck.
const NEVER_STALLED_STATUSES = new Set(['blocked', 'input_required', 'stopping', 'exited', 'orphaned']);

// ---------------------------------------------------------------------------
// State construction helpers
// ---------------------------------------------------------------------------

/** @returns {StoryState} a fresh, empty state */
export function initialState() {
  return { workers: new Map() };
}

function newWorkerStory(workerId, harness, spawnedAtSeq) {
  return {
    workerId,
    harness: harness ?? 'unknown',
    status: 'idle',
    taskId: null,
    brief: null,
    modelRequested: null,
    modelResolved: null,
    modelObserved: null,
    effortRequested: null,
    effortResolved: null,
    effortObserved: null,
    effortMismatch: null,
    modelMismatch: null,
    lastVerdict: null, // SC5c: {accept:boolean} once verify.reverified folds in
    crashed: false, // SC17: lifecycle fact, never inferred from unrelated warning signals
    turnEpoch: 0,
    turnCount: 0,
    lastEventSeq: 0,
    lastEventTs: '',
    turnStartedAtTs: null,
    sawGap: false,
    budgetUsed: { tokens: 0, usd: 0 },
    budgetThresholdsFired: new Set(),
    recentActionSignatures: [],
    editedPaths: new Set(),
    outOfScopePaths: new Set(),
    questionsPending: [],
    approvalsPending: [],
    warnings: new Set(),
    spawnedAtSeq,
  };
}

function cloneWorkerStory(w) {
  return {
    ...w,
    brief: w.brief, // Briefs are treated as immutable payload data; shallow share is fine.
    budgetUsed: { ...w.budgetUsed },
    budgetThresholdsFired: new Set(w.budgetThresholdsFired),
    recentActionSignatures: [...w.recentActionSignatures],
    editedPaths: new Set(w.editedPaths),
    outOfScopePaths: new Set(w.outOfScopePaths),
    questionsPending: w.questionsPending.map((q) => ({ ...q })),
    approvalsPending: w.approvalsPending.map((a) => ({ ...a })),
    warnings: new Set(w.warnings),
  };
}

function cloneState(state) {
  const workers = new Map();
  for (const [id, w] of state.workers) workers.set(id, cloneWorkerStory(w));
  return { workers };
}

// ---------------------------------------------------------------------------
// Path-scope glob matching — minimal, dependency-free `**`/`*` matcher over
// repo-relative POSIX paths, sufficient for pathScope globs like 'src/auth/**'.
// ---------------------------------------------------------------------------

function globToRegExp(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        // swallow an immediately-following slash so 'a/**' matches 'a' itself too
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  re += '$';
  return new RegExp(re);
}

function globMatches(glob, path) {
  return globToRegExp(glob).test(path);
}

function isInScope(pathScope, path) {
  if (!Array.isArray(pathScope) || pathScope.length === 0) return true; // unscoped
  return pathScope.some((glob) => globMatches(glob, path));
}

// Very small heuristic overlap check between two glob lists: two globs
// "overlap" if their literal prefix (up to the first wildcard) is a
// prefix of one another — good enough for pathScope collision detection
// over conventional directory-style globs like 'src/shared/**'.
function globsOverlap(globA, globB) {
  const prefix = (g) => {
    const idx = g.search(/[*?]/);
    return idx === -1 ? g : g.slice(0, idx);
  };
  const pa = prefix(globA);
  const pb = prefix(globB);
  return pa.startsWith(pb) || pb.startsWith(pa);
}

function pathScopesOverlap(scopeA, scopeB) {
  if (!Array.isArray(scopeA) || !Array.isArray(scopeB)) return false;
  for (const a of scopeA) {
    for (const b of scopeB) {
      if (globsOverlap(a, b)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Legal state-transition table (spec/supervisor-state-machine.md §2)
// ---------------------------------------------------------------------------

const LEGAL_TRANSITIONS = {
  [KIND.SPAWNED]: { from: null, to: 'idle' },
  [KIND.TURN_STARTED]: { from: ['idle', 'working'], to: 'working' },
  [KIND.TURN_COMPLETED]: { from: ['working'], to: 'idle' }, // SC5b; other statuses: no-op, never a warning
  [KIND.KILL_CONFIRMED]: { from: null, to: 'exited' }, // SC5a: terminal, mirrors coordinator replay
  [KIND.INTERRUPT_REQUESTED]: { from: ['working', 'blocked', 'idle'], to: 'stopping' },
  [KIND.INTERRUPT_CONFIRMED]: { from: ['stopping'], to: 'idle' },
  [KIND.APPROVAL_REQUESTED]: { from: ['working'], to: 'blocked' },
  [KIND.APPROVAL_RESOLVED]: { from: ['blocked'], to: 'working' },
  [KIND.QUESTION_ASKED]: { from: ['working'], to: 'input_required' },
  [KIND.QUESTION_ANSWERED]: { from: ['input_required'], to: 'working' },
  [KIND.EXITED]: { from: null, to: 'exited' },
  [KIND.CRASHED]: { from: null, to: 'exited' },
};

// ---------------------------------------------------------------------------
// Fold
// ---------------------------------------------------------------------------

/**
 * Pure fold: apply one LogEvent to a StoryState, returning a new/updated state.
 * Idempotent: applying the same (worker, seq) twice is a no-op the second time.
 * @param {StoryState} state
 * @param {LogEvent} event
 * @returns {StoryState}
 */
export function foldEvent(state, event) {
  const next = cloneState(state);
  applyEvent(next, event);
  return next;
}

function applyEvent(state, event) {
  const { worker, seq, kind, payload = {}, ts } = event;
  let w = state.workers.get(worker);

  if (!w) {
    if (kind !== KIND.SPAWNED) {
      // A non-spawn event for an unknown worker: bookkeep minimally so we
      // never crash, but there's no story to build on top of. This should
      // not normally happen given ordered ingestion, but keep it inert.
      w = newWorkerStory(worker, event.harness, seq);
      state.workers.set(worker, w);
    } else {
      w = newWorkerStory(worker, event.harness, seq);
      state.workers.set(worker, w);
    }
  }

  // Duplicate / stale-seq guard (invariant 4): drop silently, no side effects.
  if (seq !== undefined && seq !== null && seq <= w.lastEventSeq) {
    return;
  }

  // Gap detection (invariant 5): does not block ingestion.
  if (seq !== undefined && seq !== null && w.lastEventSeq > 0 && seq > w.lastEventSeq + 1) {
    w.sawGap = true;
  }

  // MS5 attribution is monotonic enrichment regardless of event kind. Coordinator events carry
  // these fields at the envelope; adapter lifecycle payloads may carry the wire observation.
  w.modelRequested = event.modelRequested ?? payload.modelRequested ?? w.modelRequested;
  w.modelResolved = event.modelResolved ?? payload.modelResolved ?? w.modelResolved;
  w.modelObserved = event.modelObserved ?? payload.modelObserved ?? payload.modelId ?? payload.model ?? w.modelObserved;
  w.effortRequested = event.effortRequested ?? payload.effortRequested ?? w.effortRequested;
  w.effortResolved = event.effortResolved ?? payload.effortResolved ?? w.effortResolved;
  const nativeEffort = event.actor === 'worker' && (kind === 'lifecycle.spawned' || kind === 'resource.tokens')
    ? payload.effortObserved
    : null;
  w.effortObserved = event.effortObserved ?? nativeEffort ?? w.effortObserved;
  if (kind === 'model.mismatch') w.modelMismatch = payload;
  if (kind === 'effort.mismatch') w.effortMismatch = payload;

  const isKnownKind = Object.values(KIND).includes(kind);

  if (isKnownKind) {
    handleKnownKind(w, kind, payload, event);
  }
  // Unknown kinds: never throw, only bookkeeping below runs (invariant 7).

  if (seq !== undefined && seq !== null) w.lastEventSeq = seq;
  if (ts !== undefined) w.lastEventTs = ts;
}

function transitionStatus(w, kind, target) {
  if (w.status === target) return; // already there — idempotent, not illegal
  const rule = LEGAL_TRANSITIONS[kind];
  if (rule && rule.from && !rule.from.includes(w.status)) {
    w.warnings.add('illegal_transition');
    return; // do not silently apply an illegal transition
  }
  w.status = target;
}

function handleKnownKind(w, kind, payload, event) {
  switch (kind) {
    case KIND.SPAWNED: {
      // CI5: coordinator spawn owns task identity; the adapter's later wire-spawn event enriches
      // it with session metadata and must never erase it with absent fields.
      if (payload.taskId != null) w.taskId = payload.taskId;
      if (payload.brief != null) w.brief = payload.brief;
      if (w.status !== 'working') w.status = 'idle';
      if (payload.taskId != null) w.crashed = false;
      break;
    }
    case KIND.TURN_STARTED: {
      // Dispatch intent and wire acceptance are two observations of one initial turn. When the
      // worker confirms a turn while the story is already working, enrich timing/epoch only.
      const duplicateWireConfirmation = w.status === 'working' && event.actor === 'worker';
      transitionStatus(w, kind, 'working');
      if (!duplicateWireConfirmation) {
        w.turnCount += 1;
        w.recentActionSignatures = [];
        // SC17: a verdict belongs to the turn that produced it, never its successor.
        w.lastVerdict = null;
      }
      w.turnEpoch = Math.max(w.turnEpoch ?? 0, event.turnEpoch ?? 0);
      if (!w.turnStartedAtTs || !duplicateWireConfirmation) w.turnStartedAtTs = event.ts;
      break;
    }
    case KIND.TURN_COMPLETED: {
      w.turnEpoch = event.turnEpoch;
      // SC5b: the finished turn parks the worker at idle. From any other status the transition
      // is skipped WITHOUT a warning — turn-completed-while-stopping is a legal race whose
      // terminal state is owned by the stop confirmation.
      if (w.status === 'working') transitionStatus(w, kind, 'idle');
      break;
    }
    case KIND.SESSION_COMPACTED: {
      break;
    }
    case KIND.EXITED: {
      w.status = 'exited';
      break;
    }
    case KIND.CRASHED: {
      w.status = 'exited';
      w.crashed = true;
      break;
    }
    case KIND.INTERRUPT_REQUESTED: {
      transitionStatus(w, kind, 'stopping');
      break;
    }
    case KIND.INTERRUPT_CONFIRMED: {
      transitionStatus(w, kind, 'idle');
      break;
    }
    case KIND.KILL_CONFIRMED: {
      // SC5a: a confirmed kill is terminal — the narrative of a killed worker must end.
      w.status = 'exited';
      break;
    }
    case KIND.REVERIFIED: {
      // SC5c: the trust gate's verdict becomes story-visible. No status change — the worker is
      // already idle and may be redispatched; the narrative reads it (SC5d).
      w.lastVerdict = { accept: payload.accept === true };
      break;
    }
    case KIND.STEER:
    case KIND.NUDGE: {
      break;
    }
    case KIND.APPROVAL_REQUESTED: {
      w.approvalsPending.push({ id: payload.id, kind: payload.kind });
      transitionStatus(w, kind, 'blocked');
      break;
    }
    case KIND.APPROVAL_RESOLVED: {
      w.approvalsPending = w.approvalsPending.filter((a) => a.id !== payload.id);
      if (w.approvalsPending.length === 0 && w.status === 'blocked') {
        w.status = 'working';
      }
      break;
    }
    case KIND.QUESTION_ASKED: {
      w.questionsPending.push({ msgId: payload.msgId, question: payload.question });
      transitionStatus(w, kind, 'input_required');
      break;
    }
    case KIND.QUESTION_ANSWERED: {
      w.questionsPending = w.questionsPending.filter((q) => q.msgId !== payload.msgId);
      if (w.questionsPending.length === 0 && w.status === 'input_required') {
        w.status = 'working';
      }
      break;
    }
    case KIND.TOKENS: {
      w.budgetUsed.tokens += payload.tokens ?? 0;
      w.budgetUsed.usd += payload.usd ?? 0;
      applyBudgetThresholds(w);
      break;
    }
    case KIND.FILE_EDIT: {
      const path = payload.path;
      if (path) {
        w.editedPaths.add(path);
        if (w.brief && Array.isArray(w.brief.pathScope) && w.brief.pathScope.length > 0 && !isInScope(w.brief.pathScope, path)) {
          w.outOfScopePaths.add(path);
        }
      }
      break;
    }
    case KIND.COMMAND_EXEC: {
      const sig = `${payload.cmd ?? ''}::${payload.exitCode ?? 0}`;
      const failed = (payload.exitCode ?? 0) !== 0;
      w.recentActionSignatures.push(sig);
      if (w.recentActionSignatures.length > MAX_ACTION_SIGNATURE_WINDOW) {
        w.recentActionSignatures = w.recentActionSignatures.slice(-MAX_ACTION_SIGNATURE_WINDOW);
      }
      void failed; // failure detection itself happens in computeSignals via the recorded window
      break;
    }
    case KIND.ERROR: {
      break;
    }
    default:
      break;
  }
}

function applyBudgetThresholds(w) {
  const totalBudget = w.brief && w.brief.budget ? w.brief.budget.tokens : null;
  if (!totalBudget || totalBudget <= 0) return;
  const pct = w.budgetUsed.tokens / totalBudget;
  for (const threshold of BUDGET_THRESHOLDS) {
    if (pct >= threshold && !w.budgetThresholdsFired.has(threshold)) {
      w.budgetThresholdsFired.add(threshold);
    }
  }
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

/**
 * @param {StoryState} state
 * @param {{now?: number, stallMs?: number, loopThreshold?: number}} [opts]
 * @returns {Signal[]}
 */
export function computeSignals(state, opts = {}) {
  const now = opts.now ?? Date.now();
  const stallMs = opts.stallMs ?? DEFAULT_STALL_MS;
  const loopThreshold = opts.loopThreshold ?? DEFAULT_LOOP_REPEAT_THRESHOLD;
  const signals = [];

  for (const w of state.workers.values()) {
    if (w.sawGap) {
      signals.push({ type: 'log_gap', worker: w.workerId, detail: { lastEventSeq: w.lastEventSeq }, since: w.lastEventTs });
    }
    if (w.warnings.has('illegal_transition')) {
      signals.push({ type: 'illegal_transition', worker: w.workerId, detail: {}, since: w.lastEventTs });
    }

    if (w.status === 'working' && !NEVER_STALLED_STATUSES.has(w.status)) {
      const lastTs = Date.parse(w.lastEventTs || w.turnStartedAtTs || '') || 0;
      if (lastTs > 0 && now - lastTs > stallMs) {
        signals.push({
          type: 'stalled',
          worker: w.workerId,
          detail: { elapsedMs: now - lastTs },
          since: w.lastEventTs,
        });
      }
    }

    const loop = detectLoop(w.recentActionSignatures, loopThreshold);
    if (loop) {
      signals.push({ type: 'looping', worker: w.workerId, detail: loop, since: w.lastEventTs });
    }

    for (const threshold of w.budgetThresholdsFired) {
      signals.push({
        type: 'over_budget',
        worker: w.workerId,
        detail: { threshold, pct: Math.round(threshold * 100) },
        since: w.lastEventTs,
      });
    }

    for (const path of w.outOfScopePaths) {
      signals.push({ type: 'out_of_scope', worker: w.workerId, detail: { path }, since: w.lastEventTs });
    }
  }

  return signals;
}

function detectLoop(signatures, threshold) {
  if (signatures.length < threshold) return null;
  const tail = signatures.slice(-threshold);
  const [first] = tail;
  const allSame = tail.every((s) => s === first);
  if (!allSame) return null;
  const [cmd, exitCode] = first.split('::');
  if (Number(exitCode) === 0) return null; // only failing loops count
  return { cmd, exitCode: Number(exitCode), count: tail.length };
}

/**
 * Cross-worker collision check: two currently-working workers whose brief.pathScope
 * globs overlap AND both have recorded a FILE_EDIT within the overlapping region.
 * @param {StoryState} state
 * @returns {Signal[]}
 */
export function pathScopeCollisions(state) {
  const signals = [];
  const workers = [...state.workers.values()].filter((w) => w.brief && Array.isArray(w.brief.pathScope) && w.brief.pathScope.length > 0);

  for (let i = 0; i < workers.length; i++) {
    for (let j = i + 1; j < workers.length; j++) {
      const a = workers[i];
      const b = workers[j];
      if (a.workerId === b.workerId) continue;
      if (!pathScopesOverlap(a.brief.pathScope, b.brief.pathScope)) continue;

      const overlappingEdits = [...a.editedPaths].filter(
        (p) => b.editedPaths.has(p) || pathInAnyScope(b.brief.pathScope, p)
      );
      const bothEditedSamePath = [...a.editedPaths].some((p) => b.editedPaths.has(p));

      if (bothEditedSamePath) {
        const sharedPaths = [...a.editedPaths].filter((p) => b.editedPaths.has(p));
        signals.push({
          type: 'path_scope_collision',
          worker: a.workerId,
          detail: { otherWorker: b.workerId, paths: sharedPaths },
          since: a.lastEventTs > b.lastEventTs ? a.lastEventTs : b.lastEventTs,
        });
      }
      void overlappingEdits;
    }
  }

  return signals;
}

function pathInAnyScope(scope, path) {
  return isInScope(scope, path);
}

// ---------------------------------------------------------------------------
// Narrative
// ---------------------------------------------------------------------------

const STATUS_PHRASE = {
  idle: () => 'idle',
  stopping: () => 'stopping (interrupt pending)',
  blocked: () => 'blocked — waiting on approval',
  orphaned: () => 'orphaned',
  exited: () => 'done',
};

function truncateQuestion(q) {
  if (!q) return '';
  return q.length > 60 ? `${q.slice(0, 60)}…` : q;
}

function budgetPct(w) {
  const totalBudget = w.brief && w.brief.budget ? w.brief.budget.tokens : 0;
  if (!totalBudget) return 0;
  return Math.round((w.budgetUsed.tokens / totalBudget) * 100);
}

function statusPhrase(w) {
  if (w.status === 'exited' && w.crashed) return 'crashed';
  if (w.status === 'working') {
    return `working (turn ${w.turnCount}, ${budgetPct(w)}% budget)`;
  }
  if (w.status === 'idle' && w.lastVerdict) {
    // SC5d: the gate's verdict is the difference between "done" and "your work was rejected".
    return w.lastVerdict.accept ? 'done (verified)' : 'idle (verification failed)';
  }
  if (w.status === 'input_required') {
    const q = w.questionsPending.length > 0 ? w.questionsPending[w.questionsPending.length - 1].question : '';
    return `blocked — waiting on: ${truncateQuestion(q)}`;
  }
  const fn = STATUS_PHRASE[w.status];
  return fn ? fn() : w.status;
}

function warningPhrase(signal) {
  switch (signal.type) {
    case 'stalled':
      return `STALLED ${Math.round((signal.detail.elapsedMs ?? 0) / 1000)}s`;
    case 'looping':
      return `LOOPING on \`${signal.detail.cmd}\` (${signal.detail.count}x)`;
    case 'over_budget':
      return `${signal.detail.pct}% budget`;
    case 'out_of_scope':
      return `OUT OF SCOPE: ${signal.detail.path}`;
    default:
      return signal.type;
  }
}

/**
 * Deterministic narrative string. Pure function of state (+ optional `now` for stall phrasing).
 * @param {StoryState} state
 * @param {{now?: number}} [opts]
 * @returns {string}
 */
export function renderNarrative(state, opts = {}) {
  const workers = [...state.workers.values()];
  if (workers.length === 0) return 'No workers active.';

  const signals = computeSignals(state, opts);
  const signalsByWorker = new Map();
  for (const s of signals) {
    if (!['stalled', 'looping', 'over_budget', 'out_of_scope'].includes(s.type)) continue;
    if (!signalsByWorker.has(s.worker)) signalsByWorker.set(s.worker, []);
    signalsByWorker.get(s.worker).push(s);
  }

  // SC5d: "active" means actually doing something — a finished (idle) worker is not active,
  // and verified-accepted work counts as done alongside clean exits.
  const ACTIVE_STATUSES = ['working', 'stopping', 'blocked', 'input_required'];
  const activeCount = workers.filter((w) => ACTIVE_STATUSES.includes(w.status)).length;
  const doneCount = workers.filter(
    (w) => !w.crashed && (w.status === 'exited' || (w.lastVerdict && w.lastVerdict.accept === true))
  ).length;

  let header = `${activeCount} worker(s) active`;
  if (doneCount > 0) header += `, ${doneCount} done`;

  const sorted = [...workers].sort((a, b) => {
    const aWarn = (signalsByWorker.get(a.workerId) ?? []).length > 0;
    const bWarn = (signalsByWorker.get(b.workerId) ?? []).length > 0;
    if (aWarn !== bWarn) return aWarn ? -1 : 1;
    return a.spawnedAtSeq - b.spawnedAtSeq;
  });

  const lines = sorted.map((w) => {
    const workerSignals = signalsByWorker.get(w.workerId) ?? [];
    const warningSuffix = workerSignals.length > 0 ? ` — ${workerSignals.map(warningPhrase).join('; ')}` : '';
    return `${w.workerId} (${w.taskId ?? 'no task'}): ${statusPhrase(w)}${warningSuffix}`;
  });

  return [header, ...lines].join('\n');
}

// ---------------------------------------------------------------------------
// StoryCompiler — stateful convenience wrapper
// ---------------------------------------------------------------------------

export class StoryCompiler {
  /** @param {{stallMs?:number, loopThreshold?:number, now?: () => number}} [opts] */
  constructor(opts = {}) {
    this.stallMs = opts.stallMs ?? DEFAULT_STALL_MS;
    this.loopThreshold = opts.loopThreshold ?? DEFAULT_LOOP_REPEAT_THRESHOLD;
    this._now = opts.now ?? (() => Date.now());
    this._state = initialState();
  }

  /** @param {LogEvent} event */
  ingest(event) {
    this._state = foldEvent(this._state, event);
  }

  /** @param {LogEvent[]} events */
  ingestBatch(events) {
    for (const e of events) this.ingest(e);
  }

  /** @param {{now?:number}} [opts] @returns {string} */
  narrative(opts = {}) {
    const now = opts.now ?? this._now();
    return renderNarrative(this._state, { now });
  }

  /** @param {{now?:number}} [opts] @returns {Signal[]} */
  signals(opts = {}) {
    const now = opts.now ?? this._now();
    return computeSignals(this._state, { now, stallMs: this.stallMs, loopThreshold: this.loopThreshold });
  }

  /** @param {string} workerId @returns {WorkerStory|null} */
  workerState(workerId) {
    const w = this._state.workers.get(workerId);
    return w ? cloneWorkerStory(w) : null;
  }

  /** @returns {Object} a plain deep-copy snapshot, not the live Map */
  snapshot() {
    const workers = {};
    for (const [id, w] of this._state.workers) {
      workers[id] = {
        ...w,
        budgetThresholdsFired: [...w.budgetThresholdsFired].sort(),
        recentActionSignatures: [...w.recentActionSignatures],
        editedPaths: [...w.editedPaths].sort(),
        outOfScopePaths: [...w.outOfScopePaths].sort(),
        questionsPending: w.questionsPending.map((q) => ({ ...q })),
        approvalsPending: w.approvalsPending.map((a) => ({ ...a })),
        warnings: [...w.warnings].sort(),
      };
    }
    return { workers };
  }

  reset() {
    this._state = initialState();
  }
}
