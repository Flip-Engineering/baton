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
//   - the application plan.read / plan.write direct ports (the surface leg of this wave) admit
//     mutations through admitPlanWrite and read through readPlanObject. Folds apply events; they
//     never authorize — ownership resolution lives in the lane (H2.3).
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

export function taskIdFor(planId, title, ownedBy) {
  return `task:${planObjectDigest({ planId, title, ownedBy }).slice(0, 32)}`;
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

function subtreeKeyOf(ownedBy, resolveRunId) {
  const run = ownedBy.run === null && resolveRunId
    ? (resolveRunId(ownedBy.wave, ownedBy.role) ?? ownedBy.run)
    : ownedBy.run;
  return JSON.stringify([ownedBy.wave, run]);
}

// The exactly-one-in-progress law (DR-3): the uniqueness key is the (ownedBy.wave, ownedBy.run)
// subtree — never the wave alone, never the plan.
function currentDoingInSubtree(plan, subtreeKey, excludeTaskId) {
  for (const task of Object.values(plan.tasks)) {
    if (task.id === excludeTaskId || task.status !== 'doing') continue;
    if (JSON.stringify([task.ownedBy.wave, task.ownedBy.run]) === subtreeKey) return task;
  }
  return null;
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

// ── the authority matrix (D2/H2.1) ────────────────────────────────────────────────────────────
//
// planPower is the deployment-authorize composition the calling surface computes (the restricting
// authorize the #74 fold landed): the plan:* power is held by the 'orchestrator' string seat, by
// any capability-carrying seat the deployment authorize explicitly admits (the review seat), and
// NEVER by a worker/coordinator seat (G8 — the class is excluded from every worker seat, a law,
// not an authorize outcome). The coordinator wave binding below is the string-seat fallback
// convention; the durable binding source is an open judgment call (notes-row-plan-object.md).
export function inferPlanAuthority(principal, options = null) {
  const id = typeof principal?.principalId === 'string' ? principal.principalId : null;
  if (id === 'orchestrator') return { class: 'plan_owner', principalId: id };
  if (id !== null && id.startsWith('worker:')) {
    if (id.startsWith('worker:member-')) {
      const role = id.slice('worker:member-'.length);
      return role.length > 0 ? { class: 'member', role, principalId: id } : { class: 'none', principalId: id };
    }
    if (id.startsWith('worker:coordinator-')) {
      const token = id.slice('worker:coordinator-'.length);
      const waveId = /^wave[0-9]+$/u.test(token) ? `wave:w${token.slice('wave'.length)}` : token;
      return waveId.length > 0 ? { class: 'coordinator', waveId, principalId: id } : { class: 'none', principalId: id };
    }
    return { class: 'none', principalId: id };
  }
  if (options?.planPower === true) return { class: 'plan_owner', principalId: id };
  return { class: 'none', principalId: id };
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

function mutationKindOf(mutation) {
  const keys = Object.keys(mutation);
  if (keys.includes('tasks') && keys.includes('campaignId')) return 'plan.minted';
  if (keys.includes('toStatus')) return 'plan.task_transitioned';
  if (keys.includes('focusTaskIds') && keys.includes('expectedPlanVersion')) return 'plan.focus_upserted';
  if (keys.includes('title') && keys.includes('expectedTaskVersion')) return 'plan.task_upserted';
  refuse('plan mutation is not one of the closed plan.* mutation shapes', 'plan_task_invalid');
}

export function planMutationKey(kind, mutation) {
  if (kind === 'plan.minted') return `plan.minted:${mutation.planId}`;
  if (kind === 'plan.task_upserted') return `plan.task_upserted:${mutation.planId}:${mutation.taskId}:v${mutation.expectedTaskVersion}`;
  if (kind === 'plan.task_transitioned') {
    return `plan.task_transitioned:${mutation.planId}:${mutation.taskId}:${mutation.toStatus}:v${mutation.expectedTaskVersion}`;
  }
  if (kind === 'plan.focus_upserted') return `plan.focus_upserted:${mutation.planId}:v${mutation.expectedPlanVersion}`;
  if (kind === 'plan.task_evidence_linked') {
    return `plan.task_evidence_linked:${mutation.planId}:${mutation.taskId}:${planObjectDigest(mutation.evidence)}:v${mutation.expectedTaskVersion}`;
  }
  refuse('plan mutation kind is not a plan.* event kind', 'plan_task_invalid');
}

function outcomeFor(kind, mutation) {
  if (kind === 'plan.minted') return { status: 'plan_minted', planId: mutation.planId };
  if (kind === 'plan.task_upserted') return { status: 'plan_updated', taskVersion: mutation.expectedTaskVersion };
  if (kind === 'plan.task_transitioned') {
    return { status: 'plan_updated', taskVersion: transitionOutcomeVersion(mutation.toStatus, mutation.expectedTaskVersion) };
  }
  if (kind === 'plan.focus_upserted') return { status: 'plan_updated', planVersion: mutation.expectedPlanVersion + 1 };
  return { status: 'plan_updated', taskVersion: mutation.expectedTaskVersion };
}

function normalizePlanPolicy(planPolicy) {
  const maxFocusTasks = planPolicy?.maxFocusTasks;
  if (!Number.isSafeInteger(maxFocusTasks) || maxFocusTasks < 1) return DEFAULT_PLAN_POLICY;
  return Object.freeze({ maxFocusTasks });
}

function assertFocusWindow(focusTaskIds, tasksByName, policy) {
  if (!Array.isArray(focusTaskIds)
    || new Set(focusTaskIds).size !== focusTaskIds.length
    || focusTaskIds.some((id) => !tasksByName.has(id))) {
    refuse('focusTaskIds must be a closed set of the plan\'s task ids', 'plan_focus_invalid');
  }
  if (focusTaskIds.length > policy.maxFocusTasks) {
    refuse(`focusTaskIds exceeds planPolicy.maxFocusTasks (${policy.maxFocusTasks})`, 'plan_focus_invalid',
      { focusCount: focusTaskIds.length, maxFocusTasks: policy.maxFocusTasks });
  }
}

function assertAuthorityToTask(authority, kind, mutation, task, ownedByForAuthority) {
  const attempted = { attempted: 'plan.write', planId: mutation.planId, ...(mutation.taskId ? { taskId: mutation.taskId } : {}) };
  if (authority.class === 'plan_owner') return;
  if (authority.class === 'none') {
    refuse('principal holds no plan authority for this mutation', 'plan_authority_forbidden', attempted);
  }
  if (kind === 'plan.minted') {
    if (authority.class === 'coordinator') {
      refuse('a coordinator never mints a plan (its subtree is the write scope)', 'coordinator_authority_forbidden',
        { ...attempted, gracefulPath: 'DECISION_REQUEST' });
    }
    refuse('a row member never mints a plan', 'plan_authority_forbidden', attempted);
  }
  if (authority.class === 'coordinator') {
    if ((ownedByForAuthority ?? task?.ownedBy)?.wave !== authority.waveId) {
      refuse('coordinator writes outside its wave subtree', 'coordinator_authority_forbidden',
        { ...attempted, gracefulPath: 'DECISION_REQUEST' });
    }
    return;
  }
  // member: the own-task law (D2.3) — role matches, and a resolved run must match the binding.
  if (!task) refuse('a row member never creates plan tasks (decomposition is the coordinator\'s)', 'plan_authority_forbidden', attempted);
  if (task.ownedBy.role !== authority.role) {
    refuse('a row member writes only its own task', 'plan_authority_forbidden', attempted);
  }
}

export function admitPlanWrite({
  body, principal, planPower = false, planPolicy = null, plans,
  priorEvent = () => null, resolveRunId = () => null, actor = null,
}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    refuse('plan.write body is not an object', 'plan_task_invalid');
  }
  if (!PLAN_OBJECT_ID_PATTERN.test(body.planId ?? '') || !body.mutation || typeof body.mutation !== 'object') {
    refuse('plan.write body must carry a plan:<hex32> planId and a closed mutation', 'plan_task_invalid');
  }
  const mutation = body.mutation;
  if (mutation.schemaVersion !== 1 || mutation.planId !== body.planId) {
    refuse('plan mutation must be schemaVersion 1 and name the addressed plan', 'plan_task_invalid');
  }
  const kind = mutationKindOf(mutation);
  const policy = normalizePlanPolicy(planPolicy);
  const authority = inferPlanAuthority(principal, { planPower });
  const key = typeof body.idempotencyKey === 'string' && body.idempotencyKey.length > 0
    ? body.idempotencyKey : planMutationKey(kind, mutation);
  const appendActor = typeof actor === 'string' && actor.length > 0
    ? actor : (isNonEmptyString(principal?.principalId) ? principal.principalId : 'plan-lane');

  // The idempotency discipline (G4/H1.1): a prior key with identical content returns the prior
  // event's outcome (exactly-once, M2). Changed content under a spent key does NOT refuse here —
  // the version-CAS below adjudicates the stale writer first (L7), and only an otherwise
  // admissible changed payload refuses plan_replay_conflict at the end (M3), appending nothing.
  const prior = priorEvent(key) ?? null;
  if (prior && prior.payload?.requestDigest === mutation.requestDigest) {
    return { ok: true, replay: true, batchKind: null, entries: [], outcome: outcomeFor(kind, mutation) };
  }
  const assertNoChangedContentUnderKey = () => {
    if (prior) refuse('plan mutation content changed under one idempotency key', 'plan_replay_conflict');
  };

  const entry = (payload, entryKey) => ({ kind, payload, auth: { actor: appendActor, key: entryKey } });

  if (kind === 'plan.minted') {
    if (!isNonEmptyString(mutation.campaignId) || !Number.isSafeInteger(mutation.version) || mutation.version < 1
      || !Array.isArray(mutation.tasks) || !Array.isArray(mutation.focusTaskIds)) {
      refuse('plan.minted mutation is not the closed shape', 'plan_task_invalid');
    }
    if (plans.has(mutation.planId)) {
      refuse(`plan ${mutation.planId} is already minted under another key`, 'plan_replay_conflict');
    }
    assertAuthorityToTask(authority, kind, mutation, null, null);
    const tasksByName = new Map();
    for (const raw of mutation.tasks) {
      const task = canonicalTask(raw);
      if (task.id !== taskIdFor(mutation.planId, task.title, task.ownedBy)) {
        refuse(`plan task ${task.id} does not match its content-derived identity`, 'plan_task_invalid');
      }
      if (tasksByName.has(task.id)) refuse(`plan task ${task.id} is duplicated`, 'plan_task_invalid');
      tasksByName.set(task.id, task);
    }
    validatePlanTopology(tasksByName);
    // The exactly-one-in-progress law at mint: the uniqueness key is the (wave, run) subtree.
    const doingSubtrees = new Set();
    for (const task of tasksByName.values()) {
      if (task.status !== 'doing') continue;
      const subtree = JSON.stringify([task.ownedBy.wave, task.ownedBy.run]);
      if (doingSubtrees.has(subtree)) {
        refuse('two tasks doing in one wave subtree at mint', 'plan_parallel_progress',
          { waveSubtree: subtree, currentDoingTaskId: null });
      }
      doingSubtrees.add(subtree);
    }
    assertFocusWindow(mutation.focusTaskIds, tasksByName, policy);
    assertNoChangedContentUnderKey();
    return {
      ok: true, replay: false, batchKind: null,
      entries: [entry(cloneMutation(mutation), key)],
      outcome: outcomeFor(kind, mutation),
    };
  }

  const plan = plans.get(mutation.planId);
  if (!plan) refuse(`plan ${mutation.planId} is not minted`, 'plan_not_found', { planId: mutation.planId });

  if (kind === 'plan.task_upserted') {
    const existing = plan.tasks[mutation.taskId] ?? null;
    assertAuthorityToTask(authority, kind, mutation, existing, mutation.ownedBy);
    const ownedBy = canonicalOwnedBy(mutation.ownedBy);
    if (mutation.taskId !== taskIdFor(mutation.planId, mutation.title, ownedBy)) {
      refuse(`plan task ${mutation.taskId} does not match its content-derived identity`, 'plan_task_invalid');
    }
    if (!Array.isArray(mutation.blockedBy) || !Array.isArray(mutation.evidence ?? [])
      || !PLAN_TASK_STATUSES.includes(mutation.status)) {
      refuse('plan.task_upserted mutation is not the closed shape', 'plan_task_invalid');
    }
    // The upsert version-CAS (M4/M5): the upsert WRITES expectedTaskVersion, admitted against the
    // observed version (absent task -> v1 create; existing -> current + 1).
    if (existing ? mutation.expectedTaskVersion !== existing.taskVersion + 1 : mutation.expectedTaskVersion !== 1) {
      refuse('plan task upsert expectedTaskVersion does not observe the current version', 'plan_stale_version');
    }
    const task = Object.freeze({
      blockedBy: Object.freeze([...mutation.blockedBy]),
      evidence: Object.freeze((mutation.evidence ?? []).map((row) => Object.freeze({ ...row }))),
      id: mutation.taskId, ownedBy, schemaVersion: 1,
      status: mutation.status, taskVersion: mutation.expectedTaskVersion, title: mutation.title,
    });
    const tasksByName = replaceTask(plan, mutation.taskId, task);
    validatePlanTopology(tasksByName);
    if (task.status === 'doing') {
      const current = currentDoingInSubtree(plan, JSON.stringify([ownedBy.wave, ownedBy.run]), mutation.taskId);
      if (current) {
        refuse('two tasks doing in one wave subtree', 'plan_parallel_progress',
          { waveSubtree: JSON.stringify([ownedBy.wave, ownedBy.run]), currentDoingTaskId: current.id });
      }
    }
    assertNoChangedContentUnderKey();
    return {
      ok: true, replay: false, batchKind: null,
      entries: [entry(cloneMutation(mutation), key)],
      outcome: outcomeFor(kind, mutation),
    };
  }

  if (kind === 'plan.task_transitioned') {
    const task = plan.tasks[mutation.taskId];
    if (!task) refuse(`plan task ${mutation.taskId} is not in plan ${mutation.planId}`, 'plan_task_not_found',
      { planId: mutation.planId, taskId: mutation.taskId });
    if (!PLAN_TASK_STATUSES.includes(mutation.toStatus)) {
      refuse('plan transition toStatus is not one of the closed three', 'plan_task_invalid');
    }
    if (mutation.expectedTaskVersion !== task.taskVersion) {
      refuse('plan transition expectedTaskVersion does not observe the current version', 'plan_stale_version');
    }
    assertAuthorityToTask(authority, kind, mutation, task, null);
    // The re-open law (H4.2): done -> todo/doing is the review authority's elevation right.
    if (task.status === 'done' && mutation.toStatus !== 'done' && authority.class !== 'plan_owner') {
      refuse('only the review authority re-opens a done plan task', 'plan_reopen_forbidden',
        { planId: mutation.planId, taskId: mutation.taskId });
    }
    // The blockedBy completion gate (Q2): no completion of a blocked task with unmet deps.
    if (mutation.toStatus === 'done') {
      const unmet = task.blockedBy.filter((id) => plan.tasks[id]?.status !== 'done');
      if (unmet.length > 0) {
        refuse('plan task is blocked on dependencies that are not done', 'plan_blocked', { blockedByUnmet: unmet });
      }
    }
    // The exactly-one-in-progress law (DR-3) with the kimi auto-demote batch (H4.1): a -> doing
    // transition in a subtree that already has a doing task demotes the current doing task to
    // todo in the SAME batch, through the registered plan_auto_demote batch kind.
    let entries = null;
    let batchKind = null;
    if (mutation.toStatus === 'doing') {
      const subtreeKey = subtreeKeyOf(task.ownedBy, resolveRunId);
      const current = currentDoingInSubtree(plan, subtreeKey, mutation.taskId);
      if (current) {
        const demoteMutation = {
          schemaVersion: 1, planId: mutation.planId, taskId: current.id, toStatus: 'todo',
          expectedTaskVersion: current.taskVersion,
          requestDigest: planObjectDigest({
            schemaVersion: 1, planId: mutation.planId, taskId: current.id, toStatus: 'todo',
            expectedTaskVersion: current.taskVersion,
          }),
        };
        batchKind = 'plan_auto_demote';
        entries = [
          { kind, payload: cloneMutation(mutation), auth: { actor: appendActor, key } },
          {
            kind,
            payload: demoteMutation,
            auth: { actor: appendActor, key: planMutationKey('plan.task_transitioned', demoteMutation) },
          },
        ];
      }
    }
    // The durable run resolution (H2.2): a pre-decomposed ownedBy.run (null) resolves at claim
    // time from the wave-registry roster and rides the event payload.
    let payload = cloneMutation(mutation);
    if (task.ownedBy.run === null) {
      const runId = resolveRunId(task.ownedBy.wave, task.ownedBy.role);
      if (isNonEmptyString(runId)) payload = { ...payload, resolvedRunId: runId };
    }
    if (entries === null) entries = [entry(payload, key)];
    else entries[0] = { kind, payload, auth: { actor: appendActor, key } };
    assertNoChangedContentUnderKey();
    return { ok: true, replay: false, batchKind, entries, outcome: outcomeFor(kind, mutation) };
  }

  if (kind === 'plan.focus_upserted') {
    if (authority.class !== 'plan_owner') {
      refuse('the focus window is the plan owner\'s mutation', 'plan_authority_forbidden',
        { attempted: 'plan.write', planId: mutation.planId });
    }
    const tasksByName = new Map(Object.entries(plan.tasks));
    assertFocusWindow(mutation.focusTaskIds, tasksByName, policy);
    // The plan-level version-CAS (L7): expectedPlanVersion observes the plan's current version.
    if (mutation.expectedPlanVersion !== plan.version) {
      refuse('plan focus upsert expectedPlanVersion does not observe the current plan version', 'plan_stale_version');
    }
    assertNoChangedContentUnderKey();
    return {
      ok: true, replay: false, batchKind: null,
      entries: [entry(cloneMutation(mutation), key)],
      outcome: outcomeFor(kind, mutation),
    };
  }

  refuse('plan mutation kind is not admitted by the write lane', 'plan_task_invalid');
}

function cloneMutation(mutation) {
  return JSON.parse(JSON.stringify(mutation));
}
