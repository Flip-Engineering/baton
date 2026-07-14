import { createHash } from 'node:crypto';
import { normalizeGoalRequest, normalizePlanRequest } from './goal-plan.mjs';

const MAX_PROFILES = 256;
const MAX_PROFILE_BYTES = 256 * 1024;
const MAX_RUN_RECORDS = 100_000;
const MAX_RUN_VIEW_BYTES = 512 * 1024;
const MAX_RUN_VIEW_WORKERS = 1_024;
const MAX_ATTENTION = 64;
const MAX_ATTENTION_TEXT_BYTES = 4_096;
const TERMINAL_PHASES = new Set(['work_completed', 'completed', 'failed', 'cancelled', 'denied', 'stopped', 'closed']);

export const APPLICATION_COMMAND_DEFINITIONS = Object.freeze({
  'run.start': Object.freeze({ args: Object.freeze(['intent']), capabilities: Object.freeze(['control', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: true }),
  'run.status': Object.freeze({ args: Object.freeze(['runId']), capabilities: Object.freeze(['observe']), web: true, mcp: true, mcpStateful: false, reconcilable: true }),
  'run.approve': Object.freeze({ args: Object.freeze(['runId', 'planDigest']), capabilities: Object.freeze(['approve', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: true }),
  'run.wait': Object.freeze({ args: Object.freeze(['runId', 'timeoutMs']), capabilities: Object.freeze(['observe']), web: true, mcp: true, mcpStateful: false, reconcilable: true }),
  'run.answer': Object.freeze({ args: Object.freeze(['runId', 'requestId', 'answer']), capabilities: Object.freeze(['approve', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: true }),
  'run.steer': Object.freeze({ args: Object.freeze(['runId', 'target', 'mode', 'message', 'reason']), capabilities: Object.freeze(['control', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: false }),
  'run.stop': Object.freeze({ args: Object.freeze(['runId', 'reason']), capabilities: Object.freeze(['emergency_stop', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: true }),
  'run.evidence': Object.freeze({ args: Object.freeze(['runId']), capabilities: Object.freeze(['observe']), web: true, mcp: true, mcpStateful: false, reconcilable: true }),
  'run.adopt': Object.freeze({ args: Object.freeze(['runId', 'nodeKey', 'resultSha', 'evidenceDigest', 'reason']), capabilities: Object.freeze(['adopt_result', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: true }),
  'application.shutdown': Object.freeze({ args: Object.freeze([]), capabilities: Object.freeze(['emergency_stop']), web: false, mcp: false, mcpStateful: false, reconcilable: false }),
});

function applicationError(message, code) {
  return Object.assign(new Error(message), { code });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function exactObject(value, fields, code, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== [...fields].sort().join('\0')) {
    throw applicationError(`${label} has unknown or missing fields`, code);
  }
}

function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/u.test(value); }
function validText(value, maxBytes = 4096) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0') && Buffer.byteLength(value) <= maxBytes;
}

const SECRET_SHAPED_TEXT = Object.freeze([
  /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/u,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|credential|password|secret)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}/iu,
  /\b(?:sk|sk-proj)-[A-Za-z0-9_-]{16,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
]);

function boundedAttentionText(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.normalize('NFKC').trim();
  if (SECRET_SHAPED_TEXT.some((pattern) => pattern.test(normalized))) return '[credential-shaped content redacted]';
  const bytes = Buffer.from(normalized);
  if (bytes.length <= MAX_ATTENTION_TEXT_BYTES) return normalized;
  return `${bytes.subarray(0, MAX_ATTENTION_TEXT_BYTES).toString('utf8')}…`;
}

function normalizeAnswer(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw applicationError('Run answer is invalid', 'application_answer_invalid');
  }
  if (Object.keys(value).sort().join(',') === 'text') {
    if (!validText(value.text, MAX_ATTENTION_TEXT_BYTES)
      || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(value.text))) {
      throw applicationError('Run answer is invalid', 'application_answer_invalid');
    }
    return { text: value.text.normalize('NFKC').trim() };
  }
  if (Object.keys(value).sort().join(',') === 'decision' && ['allow', 'deny', 'cancel'].includes(value.decision)) {
    return { decision: value.decision };
  }
  throw applicationError('Run answer is invalid', 'application_answer_invalid');
}

function normalizeSteer(value) {
  exactObject(value, ['runId', 'target', 'mode', 'message', 'reason'], 'application_steer_invalid', 'Run steer');
  if (!validId(value.runId) || !validId(value.target) || !['nudge', 'now', 'turn'].includes(value.mode)
    || !validText(value.message, MAX_ATTENTION_TEXT_BYTES) || !validText(value.reason, 1_024)
    || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(value.message) || pattern.test(value.reason))) {
    throw applicationError('Run steer request is invalid', 'application_steer_invalid');
  }
  return deepFreeze(clone(value));
}

function normalizeStop(value) {
  exactObject(value, ['runId', 'reason'], 'application_stop_invalid', 'Run stop');
  if (!validId(value.runId) || !validText(value.reason, 1_024)
    || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(value.reason))) {
    throw applicationError('Run stop request is invalid', 'application_stop_invalid');
  }
  return deepFreeze({ runId: value.runId, reason: value.reason.normalize('NFKC').trim() });
}

function normalizeAdopt(value) {
  exactObject(value, ['runId', 'nodeKey', 'resultSha', 'evidenceDigest', 'reason'], 'application_adopt_invalid', 'Run adoption');
  if (!validId(value.runId) || !validId(value.nodeKey)
    || !/^[a-f0-9]{40,64}$/u.test(value.resultSha ?? '')
    || !/^[a-f0-9]{64}$/u.test(value.evidenceDigest ?? '')
    || !validText(value.reason, 1_024)
    || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(value.reason))) {
    throw applicationError('Run adoption request is invalid', 'application_adopt_invalid');
  }
  return deepFreeze({ ...clone(value), reason: value.reason.normalize('NFKC').trim() });
}

function normalizePrincipal(value, label) {
  exactObject(value, ['actor', 'principalId', 'sessionId'], 'application_authority_invalid', label);
  if (!validText(value.actor, 256) || !validId(value.principalId) || !validId(value.sessionId)) {
    throw applicationError(`${label} is invalid`, 'application_authority_invalid');
  }
  return deepFreeze(clone(value));
}

function normalizeRoute(value, code = 'application_route_invalid') {
  exactObject(value, ['harness', 'model', 'effort'], code, 'route');
  if (![value.harness, value.model, value.effort].every((item) => validText(item, 256))) {
    throw applicationError('route is invalid', code);
  }
  return deepFreeze({ harness: value.harness, model: value.model, effort: value.effort });
}

function normalizeStringSet(value, label, { empty = false, max = 64, maxBytes = 4096 } = {}) {
  if (!Array.isArray(value) || value.length > max || (!empty && value.length === 0)
    || value.some((item) => !validText(item, maxBytes)) || new Set(value).size !== value.length) {
    throw applicationError(`${label} is invalid`, 'application_profile_invalid');
  }
  return [...value].sort();
}

function normalizeBudget(value, label) {
  exactObject(value, ['tokens', 'usd', 'wallMin', 'providerTurns'], 'application_profile_invalid', label);
  if (!Number.isSafeInteger(value.tokens) || value.tokens <= 0
    || typeof value.usd !== 'number' || !Number.isFinite(value.usd) || value.usd <= 0
    || !Number.isSafeInteger(value.wallMin) || value.wallMin <= 0
    || !Number.isSafeInteger(value.providerTurns) || value.providerTurns <= 0) {
    throw applicationError(`${label} is invalid`, 'application_profile_invalid');
  }
  return clone(value);
}

function normalizeVerification(value) {
  const fields = ['command', 'arguments', 'cwd', 'envAllowlist', 'expectExit', 'expectResult', 'timeoutMs', 'maxOutputBytes', 'requiredPredecessorEvidence'];
  exactObject(value, fields, 'application_profile_invalid', 'profile verification');
  if (!validText(value.command) || !Array.isArray(value.arguments) || value.arguments.length > 64
    || value.arguments.some((item) => typeof item !== 'string' || item.includes('\0') || Buffer.byteLength(item) > 4096)
    || !validText(value.cwd) || !Array.isArray(value.envAllowlist) || value.envAllowlist.length > 64
    || value.envAllowlist.some((item) => !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(item))
    || !Number.isSafeInteger(value.expectExit) || value.expectExit < 0 || value.expectExit > 255
    || value.expectResult !== 'exit_code' || !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs <= 0
    || !Number.isSafeInteger(value.maxOutputBytes) || value.maxOutputBytes <= 0
    || !Array.isArray(value.requiredPredecessorEvidence) || value.requiredPredecessorEvidence.length !== 0) {
    throw applicationError('profile verification is invalid', 'application_profile_invalid');
  }
  return clone(value);
}

function normalizeResultPolicy(value) {
  exactObject(value, ['mode', 'maxAdoptedResults', 'locator'], 'application_profile_invalid', 'profile resultPolicy');
  if (!['none', 'manual'].includes(value.mode) || value.locator !== 'git_ref'
    || !Number.isSafeInteger(value.maxAdoptedResults)
    || (value.mode === 'none' && value.maxAdoptedResults !== 0)
    || (value.mode === 'manual' && value.maxAdoptedResults !== 1)) {
    throw applicationError('profile resultPolicy is invalid', 'application_profile_invalid');
  }
  return clone(value);
}

function normalizeProfile(name, value, repoId) {
  const fields = [
    'schemaVersion', 'repoId', 'definitionOfDone', 'constraints', 'risk', 'goalBudget',
    'nodeBudget', 'pathScope', 'verification', 'routes', 'capabilities', 'effects', 'resultPolicy',
  ];
  exactObject(value, fields, 'application_profile_invalid', `profile ${name}`);
  if (!validId(name) || value.schemaVersion !== 1 || value.repoId !== repoId || !validText(value.risk, 64)) {
    throw applicationError(`profile ${name} is invalid`, 'application_profile_invalid');
  }
  if (!Array.isArray(value.routes) || value.routes.length === 0 || value.routes.length > 64) {
    throw applicationError(`profile ${name} routes are invalid`, 'application_profile_invalid');
  }
  const routes = value.routes.map((route) => normalizeRoute(route, 'application_profile_invalid'));
  if (new Set(routes.map(digest)).size !== routes.length) {
    throw applicationError(`profile ${name} routes contain duplicates`, 'application_profile_invalid');
  }
  const normalized = {
    schemaVersion: 1,
    repoId,
    definitionOfDone: normalizeStringSet(value.definitionOfDone, 'profile definitionOfDone'),
    constraints: normalizeStringSet(value.constraints, 'profile constraints', { empty: true }),
    risk: value.risk,
    goalBudget: normalizeBudget(value.goalBudget, 'profile goalBudget'),
    nodeBudget: normalizeBudget(value.nodeBudget, 'profile nodeBudget'),
    pathScope: normalizeStringSet(value.pathScope, 'profile pathScope'),
    verification: normalizeVerification(value.verification),
    routes: routes.map(clone).sort((a, b) => {
      const left = digest(a); const right = digest(b);
      return left < right ? -1 : left > right ? 1 : 0;
    }),
    capabilities: normalizeStringSet(value.capabilities, 'profile capabilities', { empty: true, maxBytes: 128 }),
    effects: normalizeStringSet(value.effects, 'profile effects', { empty: true, maxBytes: 128 }),
    resultPolicy: normalizeResultPolicy(value.resultPolicy),
  };
  if (normalized.pathScope.some((entry) => !safeScopePath(entry))) {
    throw applicationError(`profile ${name} path scope is invalid`, 'application_profile_invalid');
  }
  if (normalized.constraints.some((constraint) => constraint.startsWith('Baton deployment profile '))) {
    throw applicationError(`profile ${name} uses a reserved application constraint`, 'application_profile_invalid');
  }
  if (Buffer.byteLength(JSON.stringify(normalized)) > MAX_PROFILE_BYTES) {
    throw applicationError(`profile ${name} exceeds the byte ceiling`, 'application_profile_invalid');
  }
  return deepFreeze({ ...normalized, digest: digest(normalized) });
}

function normalizeIntent(value) {
  const allowed = new Set(['runId', 'objective', 'profile', 'route', 'scope']);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.has(key))
    || !Object.hasOwn(value, 'objective') || !Object.hasOwn(value, 'profile') || !Object.hasOwn(value, 'route')
    || (value.runId !== undefined && !validId(value.runId))
    || !validText(value.objective) || !validId(value.profile)
    || (value.scope !== undefined && (!Array.isArray(value.scope) || value.scope.length === 0 || value.scope.length > 64
      || value.scope.some((item) => !validText(item)) || new Set(value.scope).size !== value.scope.length))) {
    throw applicationError('run intent is invalid', 'application_intent_invalid');
  }
  return deepFreeze({
    runId: value.runId ?? null,
    objective: value.objective.normalize('NFKC').trim(),
    profile: value.profile,
    route: normalizeRoute(value.route),
    scope: value.scope === undefined ? null : [...value.scope].sort(),
  });
}

export function validateApplicationCommandArgs(name, args) {
  const definition = APPLICATION_COMMAND_DEFINITIONS[name];
  if (!definition) throw applicationError(`unsupported application command ${name}`, 'application_command_unavailable');
  exactObject(args, definition.args, 'application_command_invalid', name);
  if (name === 'run.start') normalizeIntent(args.intent);
  if (name === 'run.status' && !validId(args.runId)) {
    throw applicationError('run id is invalid', 'application_run_invalid');
  }
  if (name === 'run.approve' && (!validId(args.runId) || !/^[a-f0-9]{64}$/u.test(args.planDigest ?? ''))) {
    throw applicationError('plan approval target is invalid', 'application_approval_invalid');
  }
  if (name === 'run.wait' && (!validId(args.runId) || !Number.isSafeInteger(args.timeoutMs)
    || args.timeoutMs <= 0 || args.timeoutMs > 24 * 60 * 60 * 1000)) {
    throw applicationError('wait target or timeout is invalid', 'application_wait_invalid');
  }
  if (name === 'run.answer') {
    if (!validId(args.runId) || !validText(args.requestId, 4_096)) {
      throw applicationError('Run answer target is invalid', 'application_answer_invalid');
    }
    normalizeAnswer(args.answer);
  }
  if (name === 'run.steer') normalizeSteer(args);
  if (name === 'run.stop') normalizeStop(args);
  if (name === 'run.evidence' && !validId(args.runId)) {
    throw applicationError('Run evidence target is invalid', 'application_evidence_invalid');
  }
  if (name === 'run.adopt') normalizeAdopt(args);
  return true;
}

function authority(principal, repoId, runId, power, idempotencyKey) {
  return {
    actor: principal.actor,
    principalId: principal.principalId,
    sessionId: principal.sessionId,
    powers: [power],
    repoId,
    runId,
    idempotencyKey,
  };
}

function refs(goal, plan) {
  return {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    throughSeq: null,
  };
}

function routeEqual(a, b) {
  return a.harness === b.harness && a.model === b.model && a.effort === b.effort;
}

function safeScopePath(value) {
  return validText(value) && !value.startsWith('/') && !value.includes('\\')
    && !value.split('/').includes('..');
}

function scopeEntryWithin(requested, allowed) {
  if (!safeScopePath(requested) || !safeScopePath(allowed)) return false;
  if (requested === allowed) return true;
  if (!allowed.endsWith('/**')) return false;
  const prefix = allowed.slice(0, -2);
  return requested.startsWith(prefix) && requested.length > prefix.length;
}

function profileConstraint(name, profile) {
  return `Baton deployment profile ${name}@${profile.digest}`;
}

function parseProfileConstraint(constraints) {
  const marker = constraints.find((item) => item.startsWith('Baton deployment profile '));
  if (!marker) return null;
  const value = marker.slice('Baton deployment profile '.length);
  const split = value.lastIndexOf('@');
  if (split <= 0) return null;
  return { name: value.slice(0, split), digest: value.slice(split + 1) };
}

function runNarrative(storyWorkers, runWorkerIds) {
  const rows = Object.entries(storyWorkers).filter(([id]) => runWorkerIds.has(id));
  if (rows.length === 0) return 'No workers active for this Run.';
  const active = rows.filter(([, worker]) => ['working', 'stopping', 'blocked', 'input_required'].includes(worker.status)).length;
  const done = rows.filter(([, worker]) => worker.lastVerdict?.accept === true || (worker.status === 'exited' && worker.crashed !== true)).length;
  const header = `${active} worker(s) active${done > 0 ? `, ${done} done` : ''}`;
  return [header, ...rows.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([id, worker]) => `${id} (${worker.taskId ?? 'no task'}): ${worker.status}`)].join('\n');
}

function publicArtifact(artifact) {
  const active = artifact.supersededBy === null && !Object.hasOwn(artifact, 'acceptanceInvalidation');
  return {
    id: artifact.id,
    digest: artifact.digest,
    kind: artifact.kind,
    mediaType: artifact.mediaType,
    accepted: artifact.accepted === true && active,
    state: !active ? (artifact.supersededBy ? 'superseded' : 'invalidated') : 'active',
    provenance: (artifact.provenance ?? []).filter((ref) => Number.isSafeInteger(ref?.coordinationSeq))
      .map((ref) => ({ coordinationSeq: ref.coordinationSeq })).sort((a, b) => a.coordinationSeq - b.coordinationSeq),
  };
}

function adoptionState(adoption) {
  if (!adoption) return null;
  if (adoption.status === 'adopted' || adoption.state === 'adopted' || adoption.receipt?.state === 'adopted') return 'adopted';
  return 'adopting';
}

/**
 * One run-centric application facade over Baton's existing durable authorities.
 * It derives Goal/Plan coordinates and authoritative Briefs; it does not replace them.
 */
export class BatonApplication {
  constructor(options) {
    exactObject(options, ['driver', 'repoId', 'profiles', 'principals', 'authorize'], 'application_config_invalid', 'application configuration');
    if (!options.driver?.coordinator || !options.driver?.coordination || !options.driver?.story
      || typeof options.driver.drainAndClose !== 'function' || !validId(options.repoId)
      || typeof options.authorize !== 'function') {
      throw applicationError('application driver configuration is invalid', 'application_config_invalid');
    }
    exactObject(options.principals, ['planner', 'dispatcher', 'observer'], 'application_config_invalid', 'application principals');
    if (!options.profiles || typeof options.profiles !== 'object' || Array.isArray(options.profiles)
      || Object.keys(options.profiles).length === 0 || Object.keys(options.profiles).length > MAX_PROFILES) {
      throw applicationError('application profiles are invalid', 'application_config_invalid');
    }
    this.driver = options.driver;
    this.repoId = options.repoId;
    this.authorize = options.authorize;
    this.principals = deepFreeze({
      planner: normalizePrincipal(options.principals.planner, 'planner principal'),
      dispatcher: normalizePrincipal(options.principals.dispatcher, 'dispatcher principal'),
      observer: normalizePrincipal(options.principals.observer, 'observer principal'),
    });
    this.profiles = new Map(Object.entries(options.profiles).map(([name, profile]) => [name, normalizeProfile(name, profile, this.repoId)]));
    if (typeof this.driver.coordinator.routeCards !== 'function') {
      throw applicationError('application driver lacks route-card projection', 'application_config_invalid');
    }
    const routeCards = new Map(this.driver.coordinator.routeCards().map((row) => [row.name, row.card]));
    for (const [profileName, profile] of this.profiles) {
      for (const route of profile.routes) {
        const card = routeCards.get(route.harness);
        const selection = card?.modelSelection;
        const modelAvailable = selection?.mode === 'exact'
          && (!Array.isArray(selection.available) || selection.available.includes(route.model));
        const effortAvailable = Array.isArray(selection?.reasoningEffort)
          && selection.reasoningEffort.includes(route.effort);
        if (!card || !modelAvailable || !effortAvailable) {
          throw applicationError(`profile ${profileName} contains an unavailable exact route`, 'application_profile_route_unavailable');
        }
      }
    }
    this._closed = null;
    this._detached = false;
    this._runStopPromises = new Map();
    this._runAdoptionPromises = new Map();
    this.ready = Promise.resolve().then(() => this._reconcileResultAdoptions())
      .then(() => this._reconcileRunStops()).then(() => this._reconcileApprovedRuns());
  }

  _profile(name) {
    const profile = this.profiles.get(name);
    if (!profile) throw applicationError(`unknown deployment profile ${name}`, 'application_profile_not_found');
    return profile;
  }

  _assertOpen() {
    if (this._closed) throw applicationError('application is closed', 'application_closed');
    if (this._detached) throw applicationError('application deployment is detached', 'application_detached');
  }

  async _authorize(command, principal, runId, subject = {}) {
    const allowed = await this.authorize(deepFreeze({
      command,
      principal: clone(principal),
      repoId: this.repoId,
      runId,
      subject: clone(subject),
    }));
    if (allowed !== true) throw applicationError('application command is not authorized', 'application_unauthorized');
  }

  async authorizeReplay(name, args, rawPrincipal) {
    this._assertOpen();
    validateApplicationCommandArgs(name, args);
    const principal = normalizePrincipal(rawPrincipal, 'replay principal');
    if (name === 'run.start') {
      const intent = normalizeIntent(args.intent);
      const profile = this._profile(intent.profile);
      const scope = intent.scope ?? clone(profile.pathScope);
      const runId = intent.runId ?? `run-${digest({
        objective: intent.objective,
        profileDigest: profile.digest,
        route: intent.route,
        scope,
        ownerPrincipalId: principal.principalId,
      }).slice(0, 32)}`;
      await this._authorize(name, principal, runId, {
        objectiveDigest: digest(intent.objective), profile: intent.profile, route: intent.route, scope,
      });
      return true;
    }
    if (name === 'run.approve') {
      await this._authorize(name, principal, args.runId, { planDigest: args.planDigest });
      return true;
    }
    if (name === 'run.answer') {
      const answer = normalizeAnswer(args.answer);
      await this._authorize(name, principal, args.runId, { requestId: args.requestId, answerKind: Object.keys(answer)[0] });
      return true;
    }
    if (name === 'run.steer') {
      const request = normalizeSteer(args);
      await this._authorize(name, principal, request.runId, {
        target: request.target,
        mode: request.mode,
        messageDigest: digest(request.message),
        reasonDigest: digest(request.reason),
      });
      return true;
    }
    if (name === 'run.stop') {
      const request = normalizeStop(args);
      await this._authorize(name, principal, request.runId, { reasonDigest: digest(request.reason) });
      return true;
    }
    if (name === 'run.adopt') {
      const request = normalizeAdopt(args);
      await this._authorize(name, principal, request.runId, {
        nodeKey: request.nodeKey, resultSha: request.resultSha,
        evidenceDigest: request.evidenceDigest, reasonDigest: digest(request.reason),
      });
      return true;
    }
    await this._authorize(name === 'run.wait' ? 'run.status' : name, principal, args.runId, {});
    return true;
  }

  _findRun(runId) {
    const snapshot = this.driver.coordination.snapshot();
    const goalPlan = snapshot.goalPlan;
    if (!goalPlan || goalPlan.goals.length > MAX_RUN_RECORDS || goalPlan.plans.length > MAX_RUN_RECORDS
      || goalPlan.approvals.length > MAX_RUN_RECORDS || goalPlan.dispatches.length > MAX_RUN_RECORDS) {
      throw applicationError('application run projection exceeds its bounded lookup ceiling', 'application_run_lookup_oversize');
    }
    const goals = goalPlan.goals.filter((goal) => goal.repoId === this.repoId && goal.runId === runId)
      .sort((a, b) => b.version - a.version);
    const goal = goals[0];
    if (!goal) throw applicationError(`unknown run ${runId}`, 'application_run_not_found');
    const plans = goalPlan.plans.filter((plan) => plan.repoId === this.repoId && plan.runId === runId
      && plan.goal.goalId === goal.goalId && plan.goal.version === goal.version && plan.goal.digest === goal.digest)
      .sort((a, b) => b.version - a.version);
    const plan = plans[0] ?? null;
    const profileRef = parseProfileConstraint(goal.constraints);
    const profile = profileRef ? this.profiles.get(profileRef.name) : null;
    if (!profileRef || !profile || profile.digest !== profileRef.digest) {
      throw applicationError(`run ${runId} deployment profile is unavailable`, 'application_profile_stale');
    }
    const approval = plan ? goalPlan.approvals.find((row) => row.plan.planId === plan.planId
      && row.plan.version === plan.version && row.plan.digest === plan.digest) ?? null : null;
    const dispatch = plan ? goalPlan.dispatches.find((row) => row.binding?.planId === plan.planId
      && row.binding?.planVersion === plan.version && row.binding?.planDigest === plan.digest) ?? null : null;
    return { goal, plan, approval, dispatch, profile, profileName: profileRef.name };
  }

  async _reconcileRunStops() {
    this._assertOpen();
    if (typeof this.driver.coordination.pendingRunStops !== 'function'
      || typeof this.driver.coordination.runStop !== 'function'
      || typeof this.driver.coordination.completeRunStop !== 'function'
      || typeof this.driver.coordinator.stopRunTargets !== 'function') {
      throw applicationError('application driver lacks Run stop/reap authority', 'application_config_invalid');
    }
    const pending = this.driver.coordination.pendingRunStops(MAX_RUN_RECORDS);
    const failures = [];
    for (const stop of pending) {
      try { await this._performRunStop(stop); }
      catch (error) { failures.push({ runId: stop.runId, code: error?.code ?? 'application_run_stop_incomplete' }); }
    }
    return deepFreeze({ schemaVersion: 1, state: 'reconciled', examinedStops: pending.length, failures });
  }

  async _reconcileResultAdoptions() {
    this._assertOpen();
    if (typeof this.driver.coordination.pendingRunResultAdoptions !== 'function'
      || typeof this.driver.coordination.runResultAdoption !== 'function'
      || typeof this.driver.coordination.completeRunResultAdoption !== 'function'
      || typeof this.driver.coordinator.preserveResult !== 'function') {
      throw applicationError('application driver lacks accepted-result adoption authority', 'application_config_invalid');
    }
    const pending = this.driver.coordination.pendingRunResultAdoptions(MAX_RUN_RECORDS);
    const failures = [];
    for (const adoption of pending) {
      try { await this._performResultAdoption(adoption); }
      catch (error) { failures.push({ runId: adoption.runId, nodeKey: adoption.nodeKey, code: error?.code ?? 'application_adoption_incomplete' }); }
    }
    return deepFreeze({ schemaVersion: 1, state: 'reconciled', examinedAdoptions: pending.length, failures });
  }

  _performResultAdoption(adoption) {
    const key = `${adoption.runId}\0${adoption.nodeKey}`;
    const existing = this._runAdoptionPromises.get(key);
    if (existing) return existing;
    const operation = (async () => {
      const current = this.driver.coordination.runResultAdoption(adoption.runId, adoption.nodeKey);
      if (!current) throw applicationError('Run result adoption admission is unavailable', 'application_adoption_incomplete');
      if (current.status === 'adopted') return current.receipt;
      const task = this.driver.coordination.task(current.taskId);
      if (!task?.assignee) throw applicationError('Run result adoption worker authority is unavailable', 'application_adoption_incomplete');
      const pinned = await this.driver.coordinator.preserveResult(task.assignee, current.resultSha);
      if (pinned.state !== 'pinned' || pinned.sha !== current.resultSha || pinned.ref !== current.retainedResultRef) {
        throw applicationError('Run result adoption ref verification failed', 'application_adoption_incomplete');
      }
      const core = {
        schemaVersion: 1,
        state: 'adopted',
        scope: 'run-result',
        repoId: current.repoId,
        runId: current.runId,
        nodeKey: current.nodeKey,
        taskId: current.taskId,
        binding: {
          admissionDigest: current.adoptionDigest,
          evidenceDigest: current.evidenceDigest,
          goalDigest: current.binding.goal.digest,
          planDigest: current.binding.plan.digest,
          approvalDigest: current.binding.approvalDigest,
          commitArtifactId: current.binding.commitArtifact.id,
          commitArtifactDigest: current.binding.commitArtifact.digest,
          verificationArtifactId: current.binding.verificationArtifact.id,
          verificationArtifactDigest: current.binding.verificationArtifact.digest,
        },
        result: { sha: current.resultSha, ref: pinned.ref },
        checks: {
          taskAccepted: true, verificationAccepted: true, refPinned: true,
          mainUnchanged: true, worktreeIndependent: true,
        },
        effects: {
          mainHeadChanged: false, indexChanged: false, workingTreeChanged: false, published: false,
        },
      };
      const receipt = deepFreeze({ ...core, receiptDigest: digest(core) });
      return this.driver.coordination.completeRunResultAdoption({
        schemaVersion: 1, runId: current.runId, nodeKey: current.nodeKey, receipt,
      }, { actor: current.actor, key: `run.result_adoption.complete:${current.runId}:${current.nodeKey}` }).adoption.receipt;
    })();
    this._runAdoptionPromises.set(key, operation);
    operation.finally(() => {
      if (this._runAdoptionPromises.get(key) === operation) this._runAdoptionPromises.delete(key);
    }).catch(() => {});
    return operation;
  }

  _performRunStop(stop) {
    const existing = this._runStopPromises.get(stop.runId);
    if (existing) return existing;
    const operation = (async () => {
      const current = this.driver.coordination.runStop(stop.runId);
      if (!current) throw applicationError('Run stop admission is unavailable', 'application_run_stop_incomplete');
      if (current.status === 'stopped') return current.receipt;
      const outcome = await this.driver.coordinator.stopRunTargets(current.targetWorkerIds, current.actor);
      if (outcome.targetCount !== current.targetWorkerIds.length
        || outcome.counts.pendingCancelled + outcome.counts.killConfirmed + outcome.counts.alreadyTerminal !== outcome.targetCount
        || outcome.checks.interactionsResolved !== true || outcome.checks.runAuthorityReleased !== true) {
        throw applicationError('Run stop/reap result is incomplete', 'application_run_stop_incomplete');
      }
      const core = {
        schemaVersion: 1,
        state: 'stopped',
        scope: 'run',
        repoId: current.repoId,
        runId: current.runId,
        targetCount: outcome.targetCount,
        remainingCount: 0,
        targetDigest: current.targetDigest,
        counts: clone(outcome.counts),
        checks: { dispatchClosed: true, interactionsResolved: true, runAuthorityReleased: true },
        effects: { coordinatorClosed: false, writerReleased: false, transportsClosed: false },
      };
      const receipt = deepFreeze({ ...core, receiptDigest: digest(core) });
      const completed = this.driver.coordination.completeRunStop(current.runId, receipt, {
        actor: current.actor, key: `run.stop.complete:${current.runId}`,
      });
      return completed.stop.receipt;
    })();
    this._runStopPromises.set(stop.runId, operation);
    operation.catch(() => {
      if (this._runStopPromises.get(stop.runId) === operation) this._runStopPromises.delete(stop.runId);
    });
    return operation;
  }

  _assertRunMutable(runId) {
    if (this.driver.coordination.runStop?.(runId)) {
      throw applicationError(`run ${runId} is stopping`, 'application_run_stopping');
    }
  }

  async _reconcileApprovedRuns() {
    this._assertOpen();
    const snapshot = this.driver.coordination.snapshot();
    const runIds = [...new Set((snapshot.goalPlan?.goals ?? [])
      .filter((goal) => goal.repoId === this.repoId && goal.runId !== null)
      .map((goal) => goal.runId))].sort();
    if (runIds.length > MAX_RUN_RECORDS) {
      throw applicationError('application run scheduler exceeds its bounded lookup ceiling', 'application_run_lookup_oversize');
    }
    for (const runId of runIds) {
      if (this.driver.coordination.runStop?.(runId)) continue;
      const current = this._findRun(runId);
      if (current.plan && current.approval?.disposition === 'approved' && !current.dispatch) {
        await this._dispatchCurrent(current);
      }
    }
    return deepFreeze({ schemaVersion: 1, state: 'ready', examinedRuns: runIds.length });
  }

  async _dispatchCurrent(current) {
    const refreshed = this._findRun(current.goal.runId);
    if (this.driver.coordination.runStop?.(refreshed.goal.runId)) {
      throw applicationError(`run ${refreshed.goal.runId} is stopping`, 'application_run_stopping');
    }
    if (!refreshed.plan || refreshed.approval?.disposition !== 'approved' || refreshed.dispatch) return refreshed.dispatch;
    const node = refreshed.plan.nodes[0];
    const gate = {
      goalId: refreshed.goal.goalId,
      goalVersion: refreshed.goal.version,
      goalDigest: refreshed.goal.digest,
      planId: refreshed.plan.planId,
      planVersion: refreshed.plan.version,
      planDigest: refreshed.plan.digest,
      nodeKey: node.key,
      expectedDispatchVersion: 0,
      capabilities: clone(node.capabilities),
      effects: clone(node.effects),
    };
    const route = {
      vendor: node.routes.harnesses[0],
      model: node.routes.models[0],
      effort: node.routes.efforts[0],
    };
    const preview = this.driver.coordination.previewPlanDispatch(gate, route);
    const { goalPlan: ignored, ...brief } = preview.brief;
    void ignored;
    const taskId = `baton-${digest({
      repoId: this.repoId,
      runId: refreshed.goal.runId,
      planDigest: refreshed.plan.digest,
      nodeKey: node.key,
      dispatchVersion: 1,
    }).slice(0, 24)}-work`;
    await this.driver.coordinator.spawn(route.vendor, brief, {
      taskId,
      runId: refreshed.goal.runId,
      model: route.model,
      effort: route.effort,
      goalPlan: gate,
      actor: this.principals.dispatcher.actor,
      principalId: this.principals.dispatcher.principalId,
      sessionId: this.principals.dispatcher.sessionId,
      powers: ['plan:dispatch'],
      idempotencyKey: `application:${refreshed.goal.runId}:dispatch:${node.key}:v1`,
    });
    return this._findRun(refreshed.goal.runId).dispatch;
  }

  async start(rawIntent, rawOwner) {
    this._assertOpen();
    await this.ready;
    const requestedIntent = normalizeIntent(rawIntent);
    const owner = normalizePrincipal(rawOwner, 'goal owner');
    const profile = this._profile(requestedIntent.profile);
    const scope = requestedIntent.scope ?? clone(profile.pathScope);
    const runId = requestedIntent.runId ?? `run-${digest({
      objective: requestedIntent.objective,
      profileDigest: profile.digest,
      route: requestedIntent.route,
      scope,
      ownerPrincipalId: owner.principalId,
    }).slice(0, 32)}`;
    const intent = deepFreeze({ ...requestedIntent, runId, scope });
    await this._authorize('run.start', owner, intent.runId, {
      objectiveDigest: digest(intent.objective), profile: intent.profile, route: intent.route, scope: intent.scope,
    });
    if (owner.principalId === this.principals.planner.principalId) {
      throw applicationError('goal owner and application planner must be distinct', 'application_authority_invalid');
    }
    if (!intent.scope.every((item) => profile.pathScope.some((allowed) => scopeEntryWithin(item, allowed)))) {
      throw applicationError('requested scope is outside the deployment profile', 'application_scope_not_allowed');
    }
    if (!profile.routes.some((route) => routeEqual(route, intent.route))) {
      throw applicationError('requested route is outside the deployment profile', 'application_route_not_allowed');
    }
    const constraint = profileConstraint(intent.profile, profile);
    const goalFields = {
      objective: intent.objective,
      definitionOfDone: clone(profile.definitionOfDone),
      constraints: [...profile.constraints, constraint],
      risk: profile.risk,
      budget: clone(profile.goalBudget),
      predecessor: null,
    };
    const nodeFields = {
      key: 'work',
      objective: intent.objective,
      definitionOfDone: clone(profile.definitionOfDone),
      deps: [],
      pathScope: clone(intent.scope),
      risk: profile.risk,
      budget: clone(profile.nodeBudget),
      verification: clone(profile.verification),
      routes: { harnesses: [intent.route.harness], models: [intent.route.model], efforts: [intent.route.effort] },
      capabilities: clone(profile.capabilities),
      effects: clone(profile.effects),
    };
    const goalPlanPolicy = this.driver.coordination.goalPlanPolicy();
    const normalizedGoal = normalizeGoalRequest(goalFields, goalPlanPolicy);
    const hypotheticalGoal = {
      ...normalizedGoal,
      goalId: `goal:${'0'.repeat(64)}`,
      version: 1,
      digest: '0'.repeat(64),
    };
    normalizePlanRequest({
      goal: { goalId: hypotheticalGoal.goalId, version: hypotheticalGoal.version, digest: hypotheticalGoal.digest },
      predecessor: null,
      nodes: [nodeFields],
    }, goalPlanPolicy, hypotheticalGoal);
    const defined = await this.driver.coordinator.defineGoal(goalFields,
      authority(owner, this.repoId, intent.runId, 'goal:define', `application:${intent.runId}:goal:v1`));
    const goal = defined.goal;
    let proposed;
    try {
      proposed = await this.driver.coordinator.proposePlan({
        goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest },
        predecessor: null,
        nodes: [nodeFields],
      }, authority(this.principals.planner, this.repoId, intent.runId, 'plan:propose', `application:${intent.runId}:plan:v1`));
    } catch (error) {
      return this._planningView(this._findRun(intent.runId), error);
    }
    return this._buildView(this._findRun(intent.runId), this.principals.observer, { expected: { goal, plan: proposed.plan } });
  }

  async approve(runId, planDigest, rawApprover) {
    this._assertOpen();
    await this.ready;
    if (!validId(runId) || typeof planDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(planDigest)) {
      throw applicationError('plan approval target is invalid', 'application_approval_invalid');
    }
    const approver = normalizePrincipal(rawApprover, 'plan approver');
    await this._authorize('run.approve', approver, runId, { planDigest });
    const current = this._findRun(runId);
    this._assertRunMutable(runId);
    if (!current.plan) throw applicationError('run planning has not completed', 'application_run_incomplete');
    if (current.plan.digest !== planDigest) throw applicationError('displayed plan digest is stale', 'application_plan_stale');
    if (current.approval === null) {
      await this.driver.coordinator.approvePlan({
        goal: { goalId: current.goal.goalId, version: current.goal.version, digest: current.goal.digest },
        plan: { planId: current.plan.planId, version: current.plan.version, digest: current.plan.digest },
        expectedDisposition: null,
        disposition: 'approved',
      }, authority(approver, this.repoId, runId, 'plan:approve', `application:${runId}:approval:${planDigest}`));
    } else if (current.approval.disposition !== 'approved') {
      throw applicationError('plan was already denied', 'application_plan_denied');
    }
    await this._dispatchCurrent(this._findRun(runId));
    return this._buildView(this._findRun(runId), this.principals.observer);
  }

  async _goalPlanStatus(current, observer) {
    return this.driver.coordinator.goalPlanStatus(
      refs(current.goal, current.plan),
      authority(observer, this.repoId, current.goal.runId, 'goal:observe', `application:${current.goal.runId}:status:${current.plan.digest}`),
    );
  }

  async status(runId, rawObserver, options = {}) {
    this._assertOpen();
    await this.ready;
    if (!validId(runId)) throw applicationError('run id is invalid', 'application_run_invalid');
    const observer = normalizePrincipal(rawObserver, 'run observer');
    const current = this._findRun(runId);
    await this._authorize('run.status', observer, runId, {});
    return this._buildView(current, observer, options);
  }

  async evidence(runId, rawObserver) {
    this._assertOpen();
    await this.ready;
    if (!validId(runId)) throw applicationError('Run evidence target is invalid', 'application_evidence_invalid');
    const observer = normalizePrincipal(rawObserver, 'evidence observer');
    await this._authorize('run.evidence', observer, runId, {});
    const current = this._findRun(runId);
    return this._buildEvidence(current);
  }

  async _buildEvidence(current) {
    const runId = current.goal.runId;
    const view = await this._buildView(current, this.principals.observer);
    if (!TERMINAL_PHASES.has(view.phase)) {
      throw applicationError('Run evidence is available only after a terminal outcome', 'application_run_not_terminal');
    }
    const task = view.nodes[0]?.taskId ? this.driver.coordination.task(view.nodes[0].taskId) : null;
    const adoption = current.plan
      ? this.driver.coordination.runResultAdoption?.(runId, current.plan.nodes[0].key) ?? null
      : null;
    const relevantSeqs = [task?.createdEvent, task?.claimedEvent, task?.terminalEvent,
      ...(view.evidence ?? []).map((artifact) => this.driver.coordination.artifact(artifact.id)?.createdEvent),
      adoption?.admittedEvent, adoption?.completedEvent,
      this.driver.coordination.runStop?.(runId)?.admittedEvent,
      this.driver.coordination.runStop?.(runId)?.completedEvent].filter(Number.isSafeInteger);
    const core = {
      schemaVersion: 1,
      kind: 'baton.run.evidence',
      state: 'terminal',
      repoId: this.repoId,
      runId,
      observedThroughSeq: relevantSeqs.length > 0 ? Math.max(...relevantSeqs) : 0,
      bindings: {
        profileDigest: view.profile.digest,
        goal: clone(view.goal),
        plan: view.plan ? {
          id: view.plan.id, version: view.plan.version, digest: view.plan.digest,
          approvalDigest: view.plan.approval?.digest ?? null,
        } : null,
      },
      phase: view.phase,
      node: view.nodes[0] ? {
        key: current.plan.nodes[0].key,
        taskId: view.nodes[0].taskId,
        state: view.nodes[0].state,
        route: clone(view.route),
      } : null,
      result: clone(view.result),
      verification: clone(view.verification),
      semanticReview: clone(view.semanticReview),
      artifacts: clone(view.evidence),
      stop: view.stop ? {
        state: view.stop.state,
        targetDigest: view.stop.targetDigest,
        receiptDigest: view.stop.receipt?.receiptDigest ?? null,
      } : null,
      ownership: { runAuthorityReleased: view.stop?.receipt?.checks?.runAuthorityReleased === true },
      checks: {
        terminalPlanState: TERMINAL_PHASES.has(view.phase),
        acceptedArtifactsReverified: view.result === null
          || (view.result.commitArtifact !== null && view.result.verificationArtifact !== null),
        resultRefReverified: view.result === null || view.result.preservation.state === 'pinned',
      },
    };
    const manifest = deepFreeze({ ...core, manifestDigest: digest(core) });
    if (Buffer.byteLength(JSON.stringify(manifest)) > MAX_RUN_VIEW_BYTES) {
      throw applicationError('Run evidence exceeds its deployment byte ceiling', 'application_evidence_oversize');
    }
    return manifest;
  }

  async adopt(rawRequest, rawPrincipal) {
    this._assertOpen();
    await this.ready;
    const request = normalizeAdopt(rawRequest);
    const principal = normalizePrincipal(rawPrincipal, 'adoption principal');
    await this._authorize('run.adopt', principal, request.runId, {
      nodeKey: request.nodeKey, resultSha: request.resultSha,
      evidenceDigest: request.evidenceDigest, reasonDigest: digest(request.reason),
    });
    const current = this._findRun(request.runId);
    if (!current.plan || current.plan.nodes.length !== 1 || current.plan.nodes[0].key !== request.nodeKey) {
      throw applicationError('Run adoption node is unavailable', 'application_adopt_invalid');
    }
    if (current.profile.resultPolicy.mode !== 'manual' || current.profile.resultPolicy.maxAdoptedResults !== 1) {
      throw applicationError('Run profile does not permit result adoption', 'application_adopt_forbidden');
    }
    const existing = this.driver.coordination.runResultAdoption(request.runId, request.nodeKey);
    if (existing) {
      if (existing.resultSha !== request.resultSha || existing.evidenceDigest !== request.evidenceDigest
        || existing.reasonDigest !== digest(request.reason)) {
        throw applicationError('Run adoption request differs from its durable admission', 'application_adopt_conflict');
      }
      const receipt = await this._performResultAdoption(existing);
      return this._buildView(current, this.principals.observer, {
        action: { command: 'run.adopt', result: 'adopted', receiptDigest: receipt.receiptDigest },
      });
    }
    const manifest = await this._buildEvidence(current);
    if (manifest.manifestDigest !== request.evidenceDigest || manifest.result?.sha !== request.resultSha
      || manifest.result?.nodeKey !== request.nodeKey || manifest.result?.preservation?.state !== 'pinned') {
      throw applicationError('Run adoption target differs from the displayed evidence', 'application_evidence_stale');
    }
    const taskId = manifest.node?.taskId;
    if (!validText(taskId, 4_096)) throw applicationError('Run has no accepted task result', 'application_result_unavailable');
    const reasonDigest = digest(request.reason);
    const requestCore = {
      repoId: this.repoId, runId: request.runId, nodeKey: request.nodeKey, taskId,
      resultSha: request.resultSha, evidenceDigest: request.evidenceDigest, reasonDigest,
    };
    const admitted = this.driver.coordination.admitRunResultAdoption({
      schemaVersion: 1, ...requestCore, requestDigest: digest(requestCore),
    }, { actor: principal.actor, key: `run.result_adoption:${request.runId}:${request.nodeKey}` });
    const receipt = await this._performResultAdoption(admitted.adoption);
    return this._buildView(current, this.principals.observer, {
      action: { command: 'run.adopt', result: 'adopted', receiptDigest: receipt.receiptDigest },
    });
  }

  _planningView(current, cause = null) {
    const runStop = this.driver.coordination.runStop?.(current.goal.runId) ?? null;
    const stop = runStop ? {
      state: runStop.status, admittedAt: runStop.admittedAt, completedAt: runStop.completedAt,
      targetCount: runStop.targetWorkerIds.length, targetDigest: runStop.targetDigest, receipt: clone(runStop.receipt),
    } : null;
    const view = {
      schemaVersion: 1,
      runId: current.goal.runId,
      objective: current.goal.objective,
      profile: { name: current.profileName, digest: current.profile.digest },
      phase: runStop?.status === 'stopped' ? 'stopped' : runStop ? 'stopping' : (cause ? 'planning_failed' : 'planning'),
      cursor: this.driver.coordination.snapshot().lastSeq,
      nextActions: runStop?.status === 'stopped' ? [{ kind: 'evidence' }]
        : runStop ? [{ kind: 'wait' }, { kind: 'status' }] : [{ kind: 'retry_planning' }],
      goal: { id: current.goal.goalId, version: current.goal.version, digest: current.goal.digest },
      plan: null,
      planPreview: null,
      nodes: [],
      route: null,
      budget: { allocated: clone(current.goal.budget), node: null },
      attention: [],
      attentionTruncated: false,
      verification: { state: 'pending', verdict: null },
      semanticReview: { state: 'semantics_unverified', findings: [] },
      result: null,
      ownership: { workers: 0, workerIds: [], closed: false },
      evidence: [],
      narrative: runStop?.status === 'stopped' ? 'Run stopped; its dispatch authority is closed and its exact stop receipt is attached.'
        : runStop ? 'Run stop is durably admitted and physical ownership is converging.'
          : (cause ? 'Goal admitted; Plan proposal failed and is safe to retry.' : 'Goal admitted; planning is pending.'),
      lastError: cause ? { code: cause.code ?? cause.name ?? 'planning_failed' } : null,
      lastAction: null,
      stop,
      close: null,
    };
    if (Buffer.byteLength(JSON.stringify(view)) > MAX_RUN_VIEW_BYTES) {
      throw applicationError('Run view exceeds its deployment byte ceiling', 'application_run_view_oversize');
    }
    return deepFreeze(view);
  }

  async _buildView(current, observer, options = {}) {
    if (!current.plan) return this._planningView(current);
    const runId = current.goal.runId;
    if (options.expected && (options.expected.goal.digest !== current.goal.digest || options.expected.plan.digest !== current.plan.digest)) {
      throw applicationError('run projection differs from the compiled request', 'application_run_conflict');
    }
    const projection = await this._goalPlanStatus(current, observer);
    const node = projection.nodes[0];
    const task = node.taskId ? this.driver.coordination.task(node.taskId) : null;
    const workerId = task?.assignee ?? null;
    let result = null;
    if (workerId) {
      try { result = await this.driver.coordinator.result(workerId); }
      catch (error) { if (error?.code !== 'not_found') throw error; }
    }
    const artifacts = (task?.artifactIds ?? []).map((artifactId) => this.driver.coordination.artifact(artifactId))
      .filter(Boolean).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    const activeAccepted = (artifact) => artifact.accepted === true && artifact.supersededBy === null
      && !Object.hasOwn(artifact, 'acceptanceInvalidation');
    const acceptedCommit = artifacts.find((artifact) => activeAccepted(artifact) && artifact.kind === 'commit') ?? null;
    const acceptedVerification = artifacts.find((artifact) => activeAccepted(artifact) && artifact.kind === 'verification') ?? null;
    const resultSha = acceptedCommit?.refs?.sha ?? null;
    const adoption = this.driver.coordination.runResultAdoption?.(runId, node.key) ?? null;
    let preservation = null;
    if (workerId && resultSha && typeof this.driver.coordinator.inspectPreservedResult === 'function') {
      preservation = await this.driver.coordinator.inspectPreservedResult(workerId, resultSha);
    }
    let phase;
    if (!projection.approval) phase = 'awaiting_plan_approval';
    else if (projection.approval.disposition === 'rejected') phase = 'denied';
    else if (node.state === 'accepted') phase = 'work_completed';
    else if (node.state === 'failed') phase = 'failed';
    else if (node.state === 'cancelled') phase = 'cancelled';
    else if (node.taskId) phase = 'running';
    else phase = 'approved';
    if (phase === 'work_completed' && adoptionState(adoption) === 'adopted') phase = 'completed';
    const runStop = this.driver.coordination.runStop?.(runId) ?? null;
    if (runStop?.status === 'stopped') phase = 'stopped';
    else if (runStop) phase = 'stopping';

    const requested = {
      harness: current.plan.nodes[0].routes.harnesses[0],
      model: current.plan.nodes[0].routes.models[0],
      effort: current.plan.nodes[0].routes.efforts[0],
    };
    const resolved = result ? {
      harness: result.harnessResolved,
      model: result.modelResolved,
      effort: result.effortResolved,
    } : null;
    const observed = result && (result.modelObserved != null || result.effortObserved != null) ? {
      harness: result.harnessResolved,
      model: result.modelObserved,
      effort: result.effortObserved,
    } : null;
    const story = this.driver.story.snapshot();
    const workers = this.driver.coordinator.list()
      .filter((handle) => this.driver.coordination.task(handle.taskId)?.runId === runId);
    const handlesById = new Map(workers.map((handle) => [handle.id, handle]));
    const runWorkerIds = new Set(workers.map((handle) => handle.id));
    if (runWorkerIds.size > MAX_RUN_VIEW_WORKERS) {
      throw applicationError('Run worker projection exceeds its bounded view ceiling', 'application_run_view_oversize');
    }
    const allAttention = Object.entries(story.workers)
      .filter(([id]) => runWorkerIds.has(id))
      .flatMap(([id, worker]) => [
        ...worker.questionsPending.map((request) => ({
          kind: 'answer_question', workerId: id, requestId: request.msgId ?? handlesById.get(id)?.pendingQuestionId ?? null,
          question: boundedAttentionText(request.question),
        })),
        ...worker.approvalsPending.map((request) => ({
          kind: 'answer_approval', workerId: id, requestId: request.id ?? handlesById.get(id)?.pendingApprovalId ?? null,
          approvalKind: request.kind,
        })),
      ]);
    const attention = allAttention.slice(0, MAX_ATTENTION);
    const attentionTruncated = allAttention.length > attention.length;
    const canAdopt = resultSha && preservation?.state === 'pinned'
      && current.profile.resultPolicy.mode === 'manual' && adoptionState(adoption) !== 'adopted';
    const nextActions = phase === 'stopping' ? [{ kind: 'wait' }, { kind: 'status' }]
      : phase === 'awaiting_plan_approval'
      ? [{ kind: 'approve_plan', planDigest: current.plan.digest }]
      : phase === 'running' ? [{ kind: 'steer' }, { kind: 'stop' }, { kind: 'wait' }, ...attention]
        : phase === 'work_completed' ? [{ kind: 'semantic_review' }, { kind: 'evidence' },
          ...(canAdopt ? [{ kind: 'adopt_result', nodeKey: node.key, resultSha }] : [])]
          : TERMINAL_PHASES.has(phase) ? [{ kind: 'evidence' },
            ...(canAdopt ? [{ kind: 'adopt_result', nodeKey: node.key, resultSha }] : [])]
            : [{ kind: 'status' }];
    const verificationState = phase === 'work_completed' ? 'mechanically_verified'
      : phase === 'failed' ? 'failed' : 'pending';
    const planNode = current.plan.nodes[0];
    const planPreviewCore = {
      objective: current.goal.objective,
      definitionOfDone: clone(current.goal.definitionOfDone),
      constraints: clone(current.goal.constraints),
      risk: current.goal.risk,
      goalBudget: clone(current.goal.budget),
      node: {
        key: planNode.key,
        objective: planNode.objective,
        pathScope: clone(planNode.pathScope),
        risk: planNode.risk,
        budget: clone(planNode.budget),
        verification: clone(planNode.verification),
        route: requested,
        capabilities: clone(planNode.capabilities),
        effects: clone(planNode.effects),
      },
      profileDigest: current.profile.digest,
      planDigest: current.plan.digest,
    };
    const view = {
      schemaVersion: 1,
      runId,
      objective: current.goal.objective,
      profile: { name: current.profileName, digest: current.profile.digest },
      phase,
      cursor: projection.coordinationUpperBound,
      nextActions,
      goal: { id: current.goal.goalId, version: current.goal.version, digest: current.goal.digest },
      plan: {
        id: current.plan.planId,
        version: current.plan.version,
        digest: current.plan.digest,
        approval: projection.approval ? { disposition: projection.approval.disposition, digest: projection.approval.digest } : null,
      },
      planPreview: { ...planPreviewCore, displayDigest: digest(planPreviewCore) },
      nodes: clone(projection.nodes),
      route: { requested, resolved, observed, rationale: 'exact deployment-profile route' },
      budget: { allocated: clone(current.goal.budget), node: clone(node.budget) },
      attention,
      attentionTruncated,
      verification: {
        state: verificationState,
        verdict: result?.verdict ? { accepted: phase === 'work_completed', digest: digest(result.verdict) } : null,
      },
      semanticReview: { state: 'semantics_unverified', findings: [] },
      result: resultSha ? {
        state: adoptionState(adoption) === 'adopted' ? 'adopted' : 'accepted',
        nodeKey: node.key,
        sha: resultSha,
        commitArtifact: acceptedCommit ? { id: acceptedCommit.id, digest: acceptedCommit.digest } : null,
        verificationArtifact: acceptedVerification ? { id: acceptedVerification.id, digest: acceptedVerification.digest } : null,
        preservation: preservation ? { state: preservation.state } : { state: 'unavailable' },
        adoption: adoption ? {
          state: adoptionState(adoption),
          receiptDigest: adoption.receipt?.receiptDigest ?? adoption.receiptDigest ?? null,
        } : null,
      } : null,
      ownership: phase === 'stopped' ? { workers: 0, workerIds: [], closed: false }
        : { workers: workers.length, workerIds: workers.map((handle) => handle.id).sort(), closed: false },
      evidence: artifacts.map(publicArtifact),
      narrative: phase === 'stopped' ? 'Run stopped; its dispatch authority is closed and its exact stop receipt is attached.'
        : phase === 'stopping' ? 'Run stop is durably admitted and physical ownership is converging.'
          : runNarrative(story.workers, runWorkerIds),
      lastAction: options.action ? clone(options.action) : null,
      stop: runStop ? {
        state: runStop.status, admittedAt: runStop.admittedAt, completedAt: runStop.completedAt,
        targetCount: runStop.targetWorkerIds.length, targetDigest: runStop.targetDigest, receipt: clone(runStop.receipt),
      } : null,
      close: null,
    };
    if (Buffer.byteLength(JSON.stringify(view)) > MAX_RUN_VIEW_BYTES) {
      throw applicationError('Run view exceeds its deployment byte ceiling', 'application_run_view_oversize');
    }
    return deepFreeze(view);
  }

  async wait(runId, rawObserver, options = {}) {
    this._assertOpen();
    exactObject(options, ['timeoutMs'], 'application_wait_invalid', 'wait options');
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 24 * 60 * 60 * 1000) {
      throw applicationError('wait timeout is invalid', 'application_wait_invalid');
    }
    const observer = normalizePrincipal(rawObserver, 'run observer');
    const deadline = Date.now() + options.timeoutMs;
    let view = await this.status(runId, observer);
    while (!TERMINAL_PHASES.has(view.phase) && Date.now() < deadline) {
      await this.driver.coordinator.wait(Math.min(100, Math.max(1, deadline - Date.now())));
      view = await this.status(runId, observer);
    }
    return view;
  }

  card() {
    return deepFreeze({
      schemaVersion: 1,
      repoId: this.repoId,
      commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS),
      profiles: [...this.profiles.entries()].map(([name, profile]) => ({
        name,
        digest: profile.digest,
        routes: clone(profile.routes),
        pathScope: clone(profile.pathScope),
        resultPolicy: clone(profile.resultPolicy),
      })).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
    });
  }

  async command(name, args, rawPrincipal) {
    if (!validText(name, 64)) throw applicationError('application command is invalid', 'application_command_invalid');
    const principal = normalizePrincipal(rawPrincipal, 'command principal');
    validateApplicationCommandArgs(name, args);
    if (name === 'run.start') {
      return this.start(args.intent, principal);
    }
    if (name === 'run.status') {
      return this.status(args.runId, principal);
    }
    if (name === 'run.approve') {
      return this.approve(args.runId, args.planDigest, principal);
    }
    if (name === 'run.wait') {
      return this.wait(args.runId, principal, { timeoutMs: args.timeoutMs });
    }
    if (name === 'run.answer') {
      return this.answer(args.runId, args.requestId, args.answer, principal);
    }
    if (name === 'run.steer') {
      return this.steer(args, principal);
    }
    if (name === 'run.stop') {
      return this.stop(args.runId, args.reason, principal);
    }
    if (name === 'run.evidence') {
      return this.evidence(args.runId, principal);
    }
    if (name === 'run.adopt') {
      return this.adopt(args, principal);
    }
    if (name === 'application.shutdown') {
      return this.shutdown(principal);
    }
    throw applicationError(`unsupported application command ${name}`, 'application_command_unavailable');
  }

  async answer(runId, requestId, rawAnswer, rawPrincipal) {
    this._assertOpen();
    await this.ready;
    if (!validId(runId) || !validText(requestId, 4_096)) {
      throw applicationError('Run answer target is invalid', 'application_answer_invalid');
    }
    const principal = normalizePrincipal(rawPrincipal, 'answer principal');
    const answer = normalizeAnswer(rawAnswer);
    await this._authorize('run.answer', principal, runId, { requestId, answerKind: Object.keys(answer)[0] });
    this._assertRunMutable(runId);
    const interaction = this.driver.coordinator.interactionStatus(requestId);
    if (!interaction || interaction.runId !== runId) {
      throw applicationError('Run interaction is unavailable', 'application_interaction_not_found');
    }
    const outcome = await this.driver.coordinator.respond(requestId, answer, principal.actor);
    const current = this._findRun(runId);
    return this._buildView(current, this.principals.observer, {
      action: { command: 'run.answer', requestId, result: outcome.result },
    });
  }

  async steer(rawRequest, rawPrincipal) {
    this._assertOpen();
    await this.ready;
    const request = normalizeSteer(rawRequest);
    const principal = normalizePrincipal(rawPrincipal, 'steer principal');
    await this._authorize('run.steer', principal, request.runId, {
      target: request.target,
      mode: request.mode,
      messageDigest: digest(request.message),
      reasonDigest: digest(request.reason),
    });
    this._assertRunMutable(request.runId);
    const current = this._findRun(request.runId);
    const target = this.driver.coordinator.list().find((worker) => worker.id === request.target && worker.runId === request.runId);
    if (!target) throw applicationError('Run steering target is unavailable', 'application_worker_not_found');
    if (!Number.isSafeInteger(target.fence)) {
      throw applicationError('Run steering target has no current fence', 'application_worker_not_controllable');
    }
    const mode = request.mode === 'now' ? 'steer' : request.mode;
    const outcome = await this.driver.coordinator.send(target.id, request.message, mode, {
      expectedFence: target.fence,
      actor: principal.actor,
    });
    return this._buildView(current, this.principals.observer, {
      action: {
        command: 'run.steer', target: target.id, mode: request.mode, reason: request.reason,
        result: outcome.result, emulated: outcome.emulated === true,
      },
    });
  }

  async stop(runId, rawReason, rawPrincipal) {
    this._assertOpen();
    await this.ready;
    const request = normalizeStop({ runId, reason: rawReason });
    const principal = normalizePrincipal(rawPrincipal, 'stop principal');
    await this._authorize('run.stop', principal, request.runId, { reasonDigest: digest(request.reason) });
    const current = this._findRun(request.runId);
    let stop = this.driver.coordination.runStop(request.runId);
    if (!stop) {
      const reasonDigest = digest(request.reason);
      const admitted = this.driver.coordination.admitRunStop({
        schemaVersion: 1,
        repoId: this.repoId,
        runId: request.runId,
        reasonDigest,
        requestDigest: digest({ repoId: this.repoId, runId: request.runId, reasonDigest }),
      }, { actor: principal.actor, key: `run.stop:${request.runId}` });
      stop = admitted.stop;
    }
    await this._performRunStop(stop);
    return this._buildView(current, this.principals.observer, {
      action: { command: 'run.stop', reason: request.reason, result: 'stopped' },
    });
  }

  async detach() {
    if (this._closed) throw applicationError('closed application cannot detach', 'application_closed');
    if (this._detached) return deepFreeze({ schemaVersion: 1, state: 'detached' });
    await this.ready;
    if (this.driver.coordinator.list().length !== 0) {
      throw applicationError('application has admitted workers; use deployment shutdown for exact fleet drain', 'application_detach_active');
    }
    await this.driver.closeAsync();
    this._detached = true;
    return deepFreeze({ schemaVersion: 1, state: 'detached' });
  }

  async shutdown(rawPrincipal) {
    const principal = normalizePrincipal(rawPrincipal, 'shutdown principal');
    await this._authorize('application.shutdown', principal, null, {});
    if (this._closed) return this._closed;
    if (this._detached) throw applicationError('detached application cannot close deployment authority', 'application_detached');
    await this.ready;
    const receipt = await this.driver.drainAndClose(principal.actor);
    const closed = deepFreeze({
      schemaVersion: 1,
      state: 'closed',
      ownership: { workers: 0, workerIds: [], closed: true },
      receipt: clone(receipt),
    });
    this._closed = closed;
    return closed;
  }
}
