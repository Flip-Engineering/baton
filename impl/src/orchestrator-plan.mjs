// [attempt: e77f2ee4-14e6-48af-9958-a1d4c744e48b row-plan-object]
// #161 implementation — the orchestrator's plan object as a first-class baton citizen.
//
// This module is the plan-object lane the #161 contract specifies (v2.0 FOLDED,
// docs/reference/evidence/orchestrator-plan-object-2026-08-13/orchestrator-plan-object-contract.md):
// the closed task shape (D1), the mutation family with (identity, version) idempotency keys and
// requestDigest adjudication, the deterministic event fold, the per-(ownedBy.wave, ownedBy.run)
// exactly-one-in-progress law with the kimi auto-demote batch (DR-3), immediate completion
// marking, the blockedBy completion gate, the review-authority re-open exception (H4.2), and the
// deployment planPolicy focus bound (never a hardcoded client ceiling).
//
// Two consumers compose it:
//   - coordination-store.mjs folds plan.* ledger events into the replay-derived _campaignPlans
//     projection (foldPlanObjectEvent / planObjectSnapshot), registers the plan_auto_demote batch
//     kind, and runs the wave-close elevation hook (appendWaveClosed);
//   - readPlanObject serves a projection back to a caller. Issue #161: the plan.write lane
//     (admitPlanWrite) had no caller and was removed, so nothing authors plan mutations outside
//     the store's own append path. Folds apply events; they never authorize — ownership
//     resolution lives in the fold's own input (H2.3).
//
// Laws carried here, verbatim from the contract: the closed three statuses ['todo','doing','done']
// (the scratchpad step states, never renamed); the canonical sorted key orders for the task object
// and ownedBy (exact-order literals, never a sort at validate time); the structurally disjoint
// plan:<hex32> / task:<hex32> id validators (the goal-plan plan:<hex64> namespace never validates
// here and vice versa); no clocks (event-seq anchored); no localeCompare (ids sort canonically).
// The plan-object projection naming here is _campaignPlans (the contract's _plans/_planTasks
// naming is already taken by the goal-plan fold in the store — naming only, the shape is D1).

import { createHash } from 'node:crypto';

export const PLAN_OBJECT_EVENT_KINDS = Object.freeze(new Set([
  'plan.minted', 'plan.task_upserted', 'plan.task_transitioned',
  'plan.focus_upserted', 'plan.task_evidence_linked',
]));
export const PLAN_OBJECT_BATCH_KINDS = Object.freeze(['plan_auto_demote']);
export const PLAN_TASK_STATUSES = Object.freeze(['todo', 'doing', 'done']);
// The canonical sorted key orders (D1/H1.3) — closed literals in ACTUAL sorted order.
export const TASK_KEY_ORDER = Object.freeze([
  'blockedBy', 'evidence', 'id', 'ownedBy', 'schemaVersion', 'status', 'taskVersion', 'title',
]);
export const OWNED_BY_KEY_ORDER = Object.freeze(['role', 'run', 'wave']);
// ID-namespace disjointness (H1.2/DR-2): the plan object's plan:<hex32> / task:<hex32> — never
// the goal-plan's plan:<hex64> planRef.
export const PLAN_OBJECT_ID_PATTERN = /^plan:[a-f0-9]{32}$/u;
export const PLAN_TASK_ID_PATTERN = /^task:[a-f0-9]{32}$/u;
// The deployment-owned focus bound default (DR-3): a policy bound, never a client-code ceiling.
export const DEFAULT_PLAN_POLICY = Object.freeze({ maxFocusTasks: 4 });

export class PlanObjectRefusal extends Error {
  constructor(message, code, detail = null) {
    super(message);
    this.name = 'PlanObjectRefusal';
    this.code = code;
    this.detail = detail === null ? null : Object.freeze({ ...detail });
  }
}

export class PlanObjectIntegrityError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'PlanObjectIntegrityError';
    this.code = code;
  }
}

function refuse(message, code, detail = null) {
  throw new PlanObjectRefusal(message, code, detail);
}

function integrity(message, code) {
  throw new PlanObjectIntegrityError(message, code);
}

// The content-derived identities (D1): the same digest basis the contract's fixtures compute —
// sha256 over the JSON literal, hex32-sliced, namespaced.
export function planObjectDigest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function planIdFor(idempotencyKey, campaignId) {
  return `plan:${planObjectDigest({ idempotencyKey, campaignId }).slice(0, 32)}`;
}

export function waveRoleRunKey(waveId, waveRole) {
  return JSON.stringify([waveId, waveRole]);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

// The closed evidenceRef shape (G7): exactly one of {coordinationSeq} | {artifactId}.
function validEvidenceRef(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const keys = Object.keys(entry);
  if (keys.length !== 1) return false;
  if (keys[0] === 'coordinationSeq') return Number.isSafeInteger(entry.coordinationSeq) && entry.coordinationSeq > 0;
  if (keys[0] === 'artifactId') return isNonEmptyString(entry.artifactId);
  return false;
}

// The closed ownedBy shape (D1/H1.3): the exact sorted key order ['role','run','wave']; run may be
// null (the pre-decomposed row task whose run resolves at claim time from the wave roster, H2.2).
function canonicalOwnedBy(raw, code) {
  const thrower = code === 'integrity' ? integrity : refuse;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    thrower('plan task ownedBy is not an object', 'plan_task_invalid');
  }
  const keys = Object.keys(raw);
  if (keys.length !== OWNED_BY_KEY_ORDER.length
    || OWNED_BY_KEY_ORDER.some((key, index) => keys[index] !== key)) {
    thrower('plan task ownedBy must be the closed sorted key order [role,run,wave]', 'plan_task_invalid');
  }
  if (!isNonEmptyString(raw.role) || !isNonEmptyString(raw.wave)
    || (raw.run !== null && !isNonEmptyString(raw.run))) {
    thrower('plan task ownedBy binding is invalid', 'plan_task_invalid');
  }
  return Object.freeze({ role: raw.role, run: raw.run, wave: raw.wave });
}

// The closed task shape (D1/P3): the exact sorted key order — a task object in ANY other key
// order is a non-closed shape and refuses plan_task_invalid (the blue-team S3 counterexample).
export function canonicalTask(raw, mode = 'refusal') {
  const thrower = mode === 'integrity' ? integrity : refuse;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    thrower('plan task is not an object', 'plan_task_invalid');
  }
  const keys = Object.keys(raw);
  if (keys.length !== TASK_KEY_ORDER.length
    || TASK_KEY_ORDER.some((key, index) => keys[index] !== key)) {
    thrower('plan task must carry the closed fields in the canonical sorted key order', 'plan_task_invalid');
  }
  if (raw.schemaVersion !== 1 || !PLAN_TASK_ID_PATTERN.test(raw.id ?? '')
    || !isNonEmptyString(raw.title) || !PLAN_TASK_STATUSES.includes(raw.status)
    || !Number.isSafeInteger(raw.taskVersion) || raw.taskVersion < 1
    || !Array.isArray(raw.blockedBy) || !Array.isArray(raw.evidence)) {
    thrower('plan task shape is invalid (closed fields, closed statuses, versioned)', 'plan_task_invalid');
  }
  if (new Set(raw.blockedBy).size !== raw.blockedBy.length
    || raw.blockedBy.some((id) => !PLAN_TASK_ID_PATTERN.test(id))) {
    thrower('plan task blockedBy is not a closed set of task ids', 'plan_task_invalid');
  }
  if (!raw.evidence.every(validEvidenceRef)) {
    thrower('plan task evidence must be closed evidenceRef rows', 'plan_task_invalid');
  }
  return Object.freeze({
    blockedBy: Object.freeze([...raw.blockedBy]),
    evidence: Object.freeze(raw.evidence.map((entry) => Object.freeze({ ...entry }))),
    id: raw.id,
    ownedBy: canonicalOwnedBy(raw.ownedBy, mode === 'integrity' ? 'integrity' : 'refusal'),
    schemaVersion: 1,
    status: raw.status,
    taskVersion: raw.taskVersion,
    title: raw.title,
  });
}

// The DAG admission (D1/P3, the goal-plan deps discipline): a self edge, a dangling edge, or a
// cycle refuses plan_topology_invalid. tasksByName: id -> task over the admission's full set.
export function validatePlanTopology(tasksByName) {
  const visit = (id, path) => {
    if (path.has(id)) refuse(`plan task ${id} participates in a blockedBy cycle`, 'plan_topology_invalid');
    const task = tasksByName.get(id);
    if (!task) refuse(`plan task ${id} names a blockedBy edge to an absent task`, 'plan_topology_invalid');
    path.add(id);
    for (const dep of task.blockedBy) {
      if (dep === id) refuse(`plan task ${id} carries a blockedBy self edge`, 'plan_topology_invalid');
      visit(dep, path);
    }
    path.delete(id);
  };
  for (const id of tasksByName.keys()) visit(id, new Set());
}

function tasksInCanonicalOrder(tasksByName) {
  const ordered = {};
  for (const id of [...tasksByName.keys()].sort()) ordered[id] = tasksByName.get(id);
  return Object.freeze(ordered);
}

function requirePlan(plans, planId) {
  const plan = plans.get(planId);
  if (!plan) integrity(`plan ${planId} is not minted`, 'plan_not_found');
  return plan;
}

function requireTask(plan, taskId) {
  const task = plan.tasks[taskId];
  if (!task) integrity(`plan task ${taskId} is not in plan ${plan.planId}`, 'plan_task_not_found');
  return task;
}

function replaceTask(plan, taskId, task) {
  const tasksByName = new Map(Object.entries(plan.tasks));
  tasksByName.set(taskId, task);
  return tasksByName;
}

function reFreezePlan(plan, tasksByName, { version = plan.version, focusTaskIds = plan.focusTaskIds } = {}) {
  return Object.freeze({
    planId: plan.planId, campaignId: plan.campaignId, version,
    focusTaskIds: Object.freeze([...focusTaskIds]),
    tasks: tasksInCanonicalOrder(tasksByName),
  });
}

// The transition version discipline (the suite's law, contract D1/H1.1): a transition admits when
// expectedTaskVersion === the task's current version; a claim (-> doing) or a re-open (-> todo)
// starts the next versioned round, while completion (-> done) marks the task done AT the observed
// version — immediate completion marking, never a hidden bump.
export function transitionOutcomeVersion(toStatus, expectedTaskVersion) {
  return toStatus === 'done' ? expectedTaskVersion : expectedTaskVersion + 1;
}

// ── the deterministic fold (P2) ───────────────────────────────────────────────────────────────
//
// Pure over (plans: Map<planId, plan>, event): the same ledger always folds the same projection,
// so close/reopen replays byte-identically. The fold validates the closed payload shapes and
// throws PlanObjectIntegrityError on an unfolderable event — the store poisons the projection,
// the TT4/board precedent. Folds apply events; they never authorize (H2.3). context.resolveRunId
// resolves a pre-decomposed ownedBy.run (null) from the wave-registry roster (H2.2); an explicit
// payload.resolvedRunId (the lane's durable resolution at claim time) takes precedence.

function requireExactKeys(payload, required, optional = []) {
  const keys = Object.keys(payload);
  const expected = [...required, ...keys.filter((key) => optional.includes(key))];
  if (keys.length !== expected.length || new Set(expected).size !== keys.length) {
    integrity(`${payload.planId ?? 'plan'} event payload is not the closed shape`, 'plan_payload_invalid');
  }
}

export function foldPlanObjectEvent(plans, event, context = null) {
  const p = event.payload;
  const resolve = context?.resolveRunId ?? null;
  if (event.kind === 'plan.minted') {
    requireExactKeys(p, ['schemaVersion', 'planId', 'campaignId', 'version', 'focusTaskIds', 'tasks', 'requestDigest']);
    if (p.schemaVersion !== 1 || !PLAN_OBJECT_ID_PATTERN.test(p.planId ?? '')
      || !isNonEmptyString(p.campaignId) || !Number.isSafeInteger(p.version) || p.version < 1
      || !Array.isArray(p.focusTaskIds) || !Array.isArray(p.tasks)) {
      integrity('plan.minted payload is invalid', 'plan_payload_invalid');
    }
    if (plans.has(p.planId)) integrity(`plan ${p.planId} is already minted`, 'plan_duplicate_mint');
    const tasksByName = new Map();
    for (const raw of p.tasks) {
      const task = canonicalTask(raw, 'integrity');
      if (tasksByName.has(task.id)) integrity(`plan task ${task.id} is duplicated`, 'plan_payload_invalid');
      tasksByName.set(task.id, task);
    }
    validatePlanTopology(tasksByName);
    if (new Set(p.focusTaskIds).size !== p.focusTaskIds.length
      || p.focusTaskIds.some((id) => !tasksByName.has(id))) {
      integrity('plan.minted focusTaskIds is not a closed set of the plan\'s task ids', 'plan_payload_invalid');
    }
    plans.set(p.planId, Object.freeze({
      planId: p.planId, campaignId: p.campaignId, version: p.version,
      focusTaskIds: Object.freeze([...p.focusTaskIds]),
      tasks: tasksInCanonicalOrder(tasksByName),
    }));
    return;
  }
  if (event.kind === 'plan.task_upserted') {
    requireExactKeys(p, ['schemaVersion', 'planId', 'taskId', 'title', 'status', 'blockedBy', 'ownedBy', 'evidence', 'expectedTaskVersion', 'requestDigest']);
    if (p.schemaVersion !== 1 || !PLAN_OBJECT_ID_PATTERN.test(p.planId ?? '')
      || !PLAN_TASK_ID_PATTERN.test(p.taskId ?? '') || !PLAN_TASK_STATUSES.includes(p.status)
      || !Number.isSafeInteger(p.expectedTaskVersion) || p.expectedTaskVersion < 1) {
      integrity('plan.task_upserted payload is invalid', 'plan_payload_invalid');
    }
    const plan = requirePlan(plans, p.planId);
    let ownedBy = canonicalOwnedBy(p.ownedBy, 'integrity');
    if (ownedBy.run === null && resolve) {
      const runId = resolve(ownedBy.wave, ownedBy.role);
      if (isNonEmptyString(runId)) ownedBy = Object.freeze({ ...ownedBy, run: runId });
    }
    const task = Object.freeze({
      blockedBy: Object.freeze([...p.blockedBy]),
      evidence: Object.freeze((p.evidence ?? []).map((entry) => Object.freeze({ ...entry }))),
      id: p.taskId,
      ownedBy,
      schemaVersion: 1,
      status: p.status,
      taskVersion: p.expectedTaskVersion,
      title: p.title,
    });
    const tasksByName = replaceTask(plan, p.taskId, task);
    validatePlanTopology(tasksByName);
    plans.set(plan.planId, reFreezePlan(plan, tasksByName));
    return;
  }
  if (event.kind === 'plan.task_transitioned') {
    requireExactKeys(p, ['schemaVersion', 'planId', 'taskId', 'toStatus', 'expectedTaskVersion', 'requestDigest'], ['resolvedRunId']);
    if (p.schemaVersion !== 1 || !PLAN_OBJECT_ID_PATTERN.test(p.planId ?? '')
      || !PLAN_TASK_ID_PATTERN.test(p.taskId ?? '') || !PLAN_TASK_STATUSES.includes(p.toStatus)
      || !Number.isSafeInteger(p.expectedTaskVersion) || p.expectedTaskVersion < 1) {
      integrity('plan.task_transitioned payload is invalid', 'plan_payload_invalid');
    }
    const plan = requirePlan(plans, p.planId);
    const task = requireTask(plan, p.taskId);
    let ownedBy = task.ownedBy;
    if (ownedBy.run === null) {
      const runId = isNonEmptyString(p.resolvedRunId)
        ? p.resolvedRunId
        : (resolve ? resolve(ownedBy.wave, ownedBy.role) : null);
      if (isNonEmptyString(runId)) ownedBy = Object.freeze({ ...ownedBy, run: runId });
    }
    const next = Object.freeze({
      ...task, status: p.toStatus,
      taskVersion: transitionOutcomeVersion(p.toStatus, p.expectedTaskVersion),
      ownedBy,
    });
    plans.set(plan.planId, reFreezePlan(plan, replaceTask(plan, p.taskId, next)));
    return;
  }
  if (event.kind === 'plan.focus_upserted') {
    requireExactKeys(p, ['schemaVersion', 'planId', 'focusTaskIds', 'expectedPlanVersion', 'requestDigest']);
    if (p.schemaVersion !== 1 || !PLAN_OBJECT_ID_PATTERN.test(p.planId ?? '')
      || !Number.isSafeInteger(p.expectedPlanVersion) || p.expectedPlanVersion < 1
      || !Array.isArray(p.focusTaskIds)) {
      integrity('plan.focus_upserted payload is invalid', 'plan_payload_invalid');
    }
    const plan = requirePlan(plans, p.planId);
    plans.set(plan.planId, reFreezePlan(plan, new Map(Object.entries(plan.tasks)), {
      version: p.expectedPlanVersion + 1,
      focusTaskIds: p.focusTaskIds,
    }));
    return;
  }
  if (event.kind === 'plan.task_evidence_linked') {
    requireExactKeys(p, ['schemaVersion', 'planId', 'taskId', 'evidence', 'expectedTaskVersion', 'requestDigest']);
    if (p.schemaVersion !== 1 || !PLAN_OBJECT_ID_PATTERN.test(p.planId ?? '')
      || !PLAN_TASK_ID_PATTERN.test(p.taskId ?? '') || !Array.isArray(p.evidence)
      || !p.evidence.every(validEvidenceRef)) {
      integrity('plan.task_evidence_linked payload is invalid', 'plan_payload_invalid');
    }
    const plan = requirePlan(plans, p.planId);
    const task = requireTask(plan, p.taskId);
    const next = Object.freeze({
      ...task,
      evidence: Object.freeze([...task.evidence, ...p.evidence.map((entry) => Object.freeze({ ...entry }))]),
    });
    plans.set(plan.planId, reFreezePlan(plan, replaceTask(plan, p.taskId, next)));
    return;
  }
  integrity(`unsupported plan-object event kind ${event.kind}`, 'unsupported_event_kind');
}

// The snapshot projection (P2/M1): plans sorted by planId, tasks keyed in canonical id order —
// deterministic from the durable facts alone, so live and replay snapshots deep-equal.
export function planObjectSnapshot(plans) {
  return {
    plans: [...plans.values()].map((plan) => ({
      planId: plan.planId, campaignId: plan.campaignId, version: plan.version,
      focusTaskIds: [...plan.focusTaskIds],
      tasks: Object.fromEntries(Object.keys(plan.tasks).sort().map((id) => [
        id,
        {
          blockedBy: [...plan.tasks[id].blockedBy],
          evidence: plan.tasks[id].evidence.map((entry) => ({ ...entry })),
          id: plan.tasks[id].id,
          ownedBy: { role: plan.tasks[id].ownedBy.role, run: plan.tasks[id].ownedBy.run, wave: plan.tasks[id].ownedBy.wave },
          schemaVersion: plan.tasks[id].schemaVersion,
          status: plan.tasks[id].status,
          taskVersion: plan.tasks[id].taskVersion,
          title: plan.tasks[id].title,
        },
      ])),
    })).sort((a, b) => (a.planId < b.planId ? -1 : a.planId > b.planId ? 1 : 0)),
  };
}

// plan.read (P3/P9): the plan projection at the orchestrator seat — the campaign todo as baton
// state. The task objects emit in the canonical sorted key order (S8).
export function readPlanObject(plans, planId) {
  const plan = plans.get(planId);
  if (!plan) refuse(`plan ${planId} is not minted`, 'plan_not_found', { planId });
  return planObjectSnapshot(new Map([[plan.planId, plan]])).plans[0];
}

// ── the write lane (D1/D4) ────────────────────────────────────────────────────────────────────
//
// admitPlanWrite adjudicates one plan.write body against the live projection and returns the
// entries to append (the caller lands them through the store's _append/_appendBatch seams and
// derives nothing further):
//   { ok: true, replay: false, batchKind, entries: [{kind, payload, auth:{actor, key}}], outcome }
//   { ok: true, replay: true, entries: [], outcome }   — the prior-key retry (M2)
// A refusal throws PlanObjectRefusal with the contract's typed code + detail. Check order
// (H4.3): shape -> same-digest replay -> plan/task lookup -> version-CAS -> authority ->
// reopen law -> blocked closure -> status law -> changed-content conflict. The CAS runs BEFORE
// the changed-content adjudication: a stale writer (L7) learns plan_stale_version even under a
// spent key, while a same-digest retry of a landed mutation returns the prior event (M2) and
// only an admissible changed payload under one key refuses plan_replay_conflict (M3).

