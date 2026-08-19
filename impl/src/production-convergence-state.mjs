import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import {
  BatonControlError,
  EventJournal,
  NotificationBus,
  crashSafeWriteJson,
  digestValue,
  readJsonIfPresent,
} from './holistic-runtime.mjs';

const clone = (value) => value == null ? value : structuredClone(value);
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};
const id = (value, label) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new BatonControlError('convergence_state_invalid', `${label} must be a bounded id`);
  }
  return value;
};
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function resolveConvergenceStateRoot({ repoRoot, deploymentRoot = null } = {}) {
  const repo = resolve(repoRoot ?? process.cwd());
  if (deploymentRoot !== null) {
    const deployment = isAbsolute(deploymentRoot)
      ? resolve(deploymentRoot) : resolve(repo, deploymentRoot);
    return join(deployment, 'convergence-v1');
  }
  let common;
  try {
    const output = execFileSync('git', ['-C', repo, 'rev-parse', '--git-common-dir'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    common = isAbsolute(output) ? resolve(output) : resolve(repo, output);
  } catch {
    common = resolve(repo, '.git');
  }
  return join(common, 'baton', 'application-v3', 'convergence-v1');
}

export function convergenceStatePath(stateRoot) {
  return join(resolve(stateRoot), 'state.json');
}

export function readConvergenceState(stateRoot) {
  const value = readJsonIfPresent(convergenceStatePath(stateRoot), null);
  if (value === null) return null;
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.events)
    || !record(value.projection) || !Array.isArray(value.subscriptions)
    || !Array.isArray(value.members) || !record(value.recovery)
    || !Array.isArray(value.terminalPins) || !record(value.evaluation)) {
    throw new BatonControlError(
      'convergence_state_invalid',
      'persisted convergence state has an unsupported or malformed schema',
    );
  }
  return value;
}

export class DurableEventJournal extends EventJournal {
  #onMutation = null;
  constructor(events = []) {
    super();
    if (events.length > 0) super.restore(events);
  }
  setMutationHook(callback) {
    if (callback !== null && typeof callback !== 'function') {
      throw new TypeError('journal mutation hook must be a function or null');
    }
    this.#onMutation = callback;
    return this;
  }
  append(type, data = {}, metadata = {}) {
    const event = super.append(type, data, metadata);
    this.#onMutation?.(event);
    return event;
  }
  restore(events) {
    const result = super.restore(events);
    this.#onMutation?.(null);
    return result;
  }
}

export class DurableNotificationBus extends NotificationBus {
  #records = new Map();
  constructor(journal, records = []) {
    super(journal);
    for (const item of records) this.restoreSubscription(item);
  }
  subscribe(input) {
    const created = super.subscribe(input);
    const recordValue = super.subscription(created.subscriptionId);
    this.#records.set(created.subscriptionId, recordValue);
    return created;
  }
  restoreSubscription(recordValue) {
    const restored = super.restoreSubscription(recordValue);
    this.#records.set(restored.subscriptionId, restored);
    return restored;
  }
  acknowledgeCursor(subscriptionId, cursor) {
    const restored = super.acknowledgeCursor(subscriptionId, cursor);
    this.#records.set(subscriptionId, restored);
    return restored;
  }
  subscription(subscriptionId) {
    const current = super.subscription(subscriptionId);
    this.#records.set(subscriptionId, current);
    return current;
  }
  snapshotSubscriptions() {
    return freeze([...this.#records.keys()].sort().map((key) => clone(super.subscription(key))));
  }
}

export class DurableMemberSupervisor {
  #journal;
  #members = new Map();
  #retryBudget;
  constructor(journal, { retryBudget = 2, members = [] } = {}) {
    this.#journal = journal;
    this.#retryBudget = retryBudget;
    for (const member of members) this.#restoreMember(member);
  }
  #restoreMember(snapshot) {
    if (!record(snapshot)) throw new BatonControlError('member_snapshot_invalid', 'member snapshot must be an object');
    const memberId = id(snapshot.memberId, 'memberId');
    const attempts = Array.isArray(snapshot.attempts)
      ? snapshot.attempts.map((attempt) => freeze(clone(attempt))) : [];
    const currentAttempt = snapshot.currentAttempt == null ? null
      : attempts.find((attempt) => attempt.attempt === snapshot.currentAttempt.attempt)
        ?? freeze(clone(snapshot.currentAttempt));
    this.#members.set(memberId, {
      memberId,
      objective: snapshot.objective ?? null,
      role: snapshot.role ?? null,
      scope: Array.isArray(snapshot.scope) ? [...snapshot.scope] : [],
      currentAttempt,
      attempts,
      finalResult: clone(snapshot.finalResult ?? null),
    });
  }
  addMember({ memberId, objective, role, scope = [] }) {
    id(memberId, 'memberId');
    if (this.#members.has(memberId)) throw new BatonControlError('member_duplicate', `duplicate member ${memberId}`);
    this.#members.set(memberId, {
      memberId, objective, role, scope: [...scope], currentAttempt: null, attempts: [], finalResult: null,
    });
    this.#journal.append('member.created', { memberId, objective, role, scope: [...scope] });
  }
  startAttempt(memberId, allocation) {
    const member = this.#members.get(memberId);
    if (!member) throw new BatonControlError('member_unknown', `unknown member ${memberId}`);
    if (member.currentAttempt?.live) throw new BatonControlError('duplicate_live_attempt', `member ${memberId} already has a live attempt`);
    const attempt = freeze({
      memberId,
      attempt: member.attempts.length + 1,
      ...clone(allocation),
      live: true,
      state: 'working',
    });
    member.attempts.push(attempt);
    member.currentAttempt = attempt;
    this.#journal.append('member.attempt.started', attempt);
    return attempt;
  }
  classifyDeath(memberId, classification) {
    const member = this.#members.get(memberId);
    if (!member?.currentAttempt) throw new BatonControlError('attempt_unknown', `no current attempt for ${memberId}`);
    const current = member.currentAttempt;
    const cert = freeze({
      memberId,
      attempt: current.attempt,
      classification: classification.kind,
      retriable: classification.retriable === true,
      reattachEligible: classification.reattachEligible === true,
      lastActivitySeq: classification.lastActivitySeq ?? this.#journal.events().at(-1)?.seq ?? 0,
      providerEvidenceRef: classification.providerEvidenceRef ?? null,
      worktree: {
        id: current.worktreeId,
        baseSha: current.baseSha,
        resultSha: classification.resultSha ?? null,
      },
    });
    member.currentAttempt = freeze({ ...current, live: false, state: 'failed', deathCertificate: cert });
    member.attempts[member.attempts.length - 1] = member.currentAttempt;
    this.#journal.append('member.attempt.died', cert);
    return cert;
  }
  recover(memberId, { exactSessionAlive = false } = {}) {
    const member = this.#members.get(memberId);
    const current = member?.currentAttempt;
    const cert = current?.deathCertificate;
    if (!cert) throw new BatonControlError('death_certificate_required', `member ${memberId} has no classified death`);
    if (cert.reattachEligible && exactSessionAlive) {
      member.currentAttempt = freeze({ ...current, live: true, state: 'working', reattached: true });
      member.attempts[member.attempts.length - 1] = member.currentAttempt;
      this.#journal.append('member.attempt.reattached', { memberId, attempt: current.attempt });
      return freeze({ action: 'reattached', attempt: member.currentAttempt });
    }
    if (!cert.retriable) return freeze({ action: 'attention_required', reason: cert.classification });
    if (member.attempts.length > this.#retryBudget) {
      return freeze({ action: 'attention_required', reason: 'retry_budget_exhausted' });
    }
    const next = this.startAttempt(memberId, {
      baseSha: current.baseSha,
      worktreeId: current.worktreeId,
      route: current.route,
      providerSession: null,
      fence: (current.fence ?? 0) + 1,
      recoveredFrom: current.attempt,
    });
    return freeze({ action: 'retried', attempt: next });
  }
  member(memberId) {
    const member = this.#members.get(memberId);
    return member ? freeze(clone(member)) : null;
  }
  snapshot() {
    return freeze([...this.#members.keys()].sort().map((key) => clone(this.#members.get(key))));
  }
}

const RETRYABLE_KINDS = new Set([
  'capacity_reap',
  'credential_death',
  'dispatch_refused',
  'provider_refusal',
  'provider_unavailable',
  'watchdog_stall',
  'wave_close_teardown',
  'worktree_capacity_exceeded',
  'worktree_capacity_unavailable',
]);
const NON_RETRYABLE_KINDS = new Set([
  'explicit_stop',
  'operator_stop',
  'plan_denied',
  'policy_refusal',
  'scope_violation',
]);

function terminalCause(value) {
  if (!record(value)) return null;
  return value.terminalCause ?? value.outline?.terminalCause
    ?? value.cancelCause ?? value.outline?.cancelCause ?? null;
}

function collectRunViews(value, fallbackRunId = null, output = [], depth = 0) {
  if (depth > 8 || output.length >= 128 || value == null) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectRunViews(item, fallbackRunId, output, depth + 1);
    return output;
  }
  if (!record(value)) return output;
  const runId = typeof value.runId === 'string' ? value.runId : fallbackRunId;
  const cause = terminalCause(value);
  if (runId && record(cause)) {
    const kind = cause.kind ?? cause.code ?? cause.classification ?? null;
    const retryable = cause.retryable === true || RETRYABLE_KINDS.has(kind);
    if (retryable && !NON_RETRYABLE_KINDS.has(kind)) {
      output.push({ runId, cause: clone(cause), kind });
    }
  }
  for (const child of Object.values(value)) {
    if (child !== cause) collectRunViews(child, runId, output, depth + 1);
  }
  return output;
}

export class AutomaticRecoveryController {
  #records = new Map();
  #retryBudget;
  constructor({ records = {}, retryBudget = 2 } = {}) {
    this.#retryBudget = retryBudget;
    for (const [runId, value] of Object.entries(records)) {
      this.#records.set(runId, clone(value));
    }
  }
  snapshot() {
    return freeze(Object.fromEntries([...this.#records.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([runId, value]) => [runId, clone(value)])));
  }
  consider({ name, args, result, application, principal, context, runtime }) {
    if (name === 'run.recover' || !application || typeof application.command !== 'function') return 0;
    const views = collectRunViews(result, args?.runId ?? null);
    let scheduled = 0;
    for (const view of views) {
      const causeDigest = digestValue({ runId: view.runId, cause: view.cause });
      const prior = this.#records.get(view.runId) ?? null;
      if (prior?.causeDigest === causeDigest
        && ['scheduled', 'recovering', 'recovered', 'attention'].includes(prior.state)) continue;
      const attempts = prior?.causeDigest === causeDigest ? prior.attempts ?? 0 : 0;
      if (attempts >= this.#retryBudget) {
        const exhausted = {
          causeDigest, attempts, state: 'attention', kind: view.kind,
          result: 'retry_budget_exhausted',
        };
        this.#records.set(view.runId, exhausted);
        runtime.notifications.publishAttention({
          runId: view.runId,
          kind: 'automatic_recovery_exhausted',
          detail: { cause: view.cause, attempts },
        });
        runtime.persist();
        continue;
      }
      this.#records.set(view.runId, {
        causeDigest,
        attempts: attempts + 1,
        state: 'scheduled',
        kind: view.kind,
        result: null,
      });
      runtime.persist();
      scheduled += 1;
      void runtime.scheduler.enqueue('lifecycle_effects', async () => {
        const current = this.#records.get(view.runId);
        this.#records.set(view.runId, { ...current, state: 'recovering' });
        runtime.journal.append('member.recovery.requested', {
          recoveryId: `recovery:${randomUUID()}`,
          runId: view.runId,
          cause: view.cause,
          causeDigest,
          attempt: current.attempts,
        });
        try {
          const recoveryView = await application.command(
            'run.recover', { runId: view.runId }, principal, context,
          );
          const recovery = recoveryView?.recovery ?? null;
          const actionResult = recoveryView?.action?.result ?? recovery?.state ?? 'unknown';
          const recovered = ['attached', 'reattached', 'resumed', 'recovered', 'retried', 'working']
            .some((token) => String(actionResult).includes(token));
          const next = {
            ...this.#records.get(view.runId),
            state: recovered ? 'recovered' : 'attention',
            result: actionResult,
            recovery: clone(recovery),
          };
          this.#records.set(view.runId, next);
          runtime.journal.append(recovered ? 'member.recovery.succeeded' : 'member.recovery.attention', {
            runId: view.runId,
            causeDigest,
            result: actionResult,
            recovery: clone(recovery),
          });
          if (!recovered) {
            runtime.notifications.publishAttention({
              runId: view.runId,
              kind: 'automatic_recovery_attention',
              detail: { cause: view.cause, recovery: clone(recovery), result: actionResult },
            });
          }
        } catch (error) {
          const typed = BatonControlError.from(error).envelope().error;
          this.#records.set(view.runId, {
            ...this.#records.get(view.runId),
            state: 'attention',
            result: typed.code,
            error: typed,
          });
          runtime.journal.append('member.recovery.failed', {
            runId: view.runId, causeDigest, error: typed,
          });
          runtime.notifications.publishAttention({
            runId: view.runId,
            kind: 'automatic_recovery_failed',
            detail: { cause: view.cause, error: typed },
          });
        } finally {
          runtime.persist();
        }
      }, { runId: view.runId, causeDigest, kind: view.kind });
    }
    return scheduled;
  }
}

export function writeConvergenceState(stateRoot, state) {
  const path = convergenceStatePath(stateRoot);
  crashSafeWriteJson(path, state);
  return path;
}

export function convergenceStateDirectory(stateRoot) {
  return dirname(convergenceStatePath(stateRoot));
}
