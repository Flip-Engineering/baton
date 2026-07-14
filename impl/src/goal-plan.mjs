import { createHash } from 'node:crypto';
import { usdFromNanos, usdToNanos } from './usd.mjs';

export class GoalPlanValidationError extends Error {
  constructor(message, code = 'goal_plan_invalid') {
    super(message);
    this.name = 'GoalPlanValidationError';
    this.code = code;
  }
}

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
export function goalPlanCanonical(value) {
  if (Array.isArray(value)) return value.map(goalPlanCanonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, goalPlanCanonical(value[key])]));
}
export function goalPlanDigest(value) {
  return createHash('sha256').update(JSON.stringify(goalPlanCanonical(value))).digest('hex');
}
const PRIVATE_PROJECTION_FIELDS = new Set([
  'actor', 'idempotencyKey', 'principalId', 'proposerPrincipalId', 'sessionDigest',
]);
export function sanitizeGoalPlanProjection(value) {
  if (Array.isArray(value)) return value.map(sanitizeGoalPlanProjection);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !PRIVATE_PROJECTION_FIELDS.has(key))
    .map(([key, child]) => [key, sanitizeGoalPlanProjection(child)]));
}
function fail(message, code) { throw new GoalPlanValidationError(message, code); }
function exactObject(value, fields, code = 'goal_plan_invalid') {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) fail('goal/plan object has unknown or missing fields', code);
}
const SECRET_SHAPED_TEXT = Object.freeze([
  /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/u,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|credential|password|secret)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}/iu,
  /\b(?:sk|sk-proj)-[A-Za-z0-9_-]{16,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
  /\bAKIA[A-Z0-9]{16}\b/u,
  /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/u,
]);
function secretShapedText(value) { return SECRET_SHAPED_TEXT.some((pattern) => pattern.test(value)); }
function normalizedText(value, maxBytes, label) {
  if (typeof value !== 'string' || value.includes('\0')) fail(`${label} is invalid`, 'goal_plan_invalid');
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length === 0 || Buffer.byteLength(normalized) > maxBytes) fail(`${label} is invalid`, 'goal_plan_invalid');
  if (secretShapedText(normalized)) fail(`${label} contains credential-shaped content`, 'goal_plan_secret_rejected');
  return normalized;
}
function normalizedSet(values, limit, maxBytes, label, { empty = true } = {}) {
  if (!Array.isArray(values) || values.length > limit || (!empty && values.length === 0)) fail(`${label} is invalid`, 'goal_plan_invalid');
  const normalized = values.map((value) => normalizedText(value, maxBytes, label));
  if (new Set(normalized).size !== normalized.length) fail(`${label} contains duplicates`, 'goal_plan_invalid');
  return normalized.sort();
}
function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(value); }
function normalizeRef(value, kind) {
  exactObject(value, kind === 'goal' ? ['goalId', 'version', 'digest'] : ['planId', 'version', 'digest']);
  const id = value[`${kind}Id`];
  if (typeof id !== 'string' || !new RegExp(`^${kind}:[a-f0-9]{64}$`).test(id)
    || !Number.isSafeInteger(value.version) || value.version <= 0 || !/^[a-f0-9]{64}$/.test(value.digest ?? '')) fail(`${kind} reference is invalid`, `${kind}_reference_invalid`);
  return clone(value);
}
function normalizePredecessor(value, kind) {
  if (value === null) return null;
  return normalizeRef(value, kind);
}
function normalizeBudget(value, policy, label) {
  exactObject(value, ['tokens', 'usd', 'wallMin', 'providerTurns']);
  const usdNanos = usdToNanos(value.usd);
  const canonicalUsd = usdNanos === null ? null : usdFromNanos(usdNanos);
  if (!Number.isSafeInteger(value.tokens) || value.tokens <= 0 || value.tokens > policy.limits.maxTokens
    || canonicalUsd === null || usdNanos > usdToNanos(policy.limits.maxUsd)
    || !Number.isSafeInteger(value.wallMin) || value.wallMin <= 0 || value.wallMin > policy.limits.maxWallMin
    || !Number.isSafeInteger(value.providerTurns) || value.providerTurns <= 0 || value.providerTurns > policy.limits.maxProviderTurns) {
    fail(`${label} budget is invalid`, 'plan_budget_exceeded');
  }
  return { tokens: value.tokens, usd: canonicalUsd, wallMin: value.wallMin, providerTurns: value.providerTurns };
}
function budgetWithin(a, b) {
  const aUsd = usdToNanos(a.usd); const bUsd = usdToNanos(b.usd);
  return aUsd !== null && bUsd !== null && a.tokens <= b.tokens && aUsd <= bUsd && a.wallMin <= b.wallMin && a.providerTurns <= b.providerTurns;
}
function riskIndex(policy, risk) {
  const index = policy.riskClasses.indexOf(risk);
  if (index === -1) fail('risk class is invalid', 'goal_plan_invalid');
  return index;
}

export function normalizeGoalPlanPolicy(value) {
  const suppliedDigest = value?.policyDigest;
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : value;
  if (raw && typeof raw === 'object') delete raw.policyDigest;
  exactObject(raw, ['schemaVersion', 'repoId', 'mandatory', 'approvalTtlMs', 'riskClasses', 'effectClasses', 'capabilityClasses', 'limits']);
  exactObject(raw.limits, ['maxGoalVersions', 'maxPlanVersions', 'maxNodes', 'maxDepsPerNode', 'maxTextBytes', 'maxItems', 'maxScopePaths', 'maxRouteValues', 'maxGoalBytes', 'maxPlanBytes', 'maxStatusBytes', 'maxTokens', 'maxUsd', 'maxWallMin', 'maxProviderTurns']);
  if (raw.schemaVersion !== 1 || !validId(raw.repoId) || typeof raw.mandatory !== 'boolean'
    || !Number.isSafeInteger(raw.approvalTtlMs) || raw.approvalTtlMs <= 0 || raw.approvalTtlMs > 30 * 24 * 60 * 60 * 1000) fail('goal/plan policy is invalid', 'goal_plan_policy_invalid');
  // Risk order is semantic, so retain deployment order while still requiring unique values.
  const risks = raw.riskClasses.map((item) => normalizedText(item, 64, 'riskClasses'));
  if (new Set(risks).size !== risks.length) fail('riskClasses contains duplicates', 'goal_plan_policy_invalid');
  const effectClasses = normalizedSet(raw.effectClasses, 128, 128, 'effectClasses');
  const capabilityClasses = normalizedSet(raw.capabilityClasses, 128, 128, 'capabilityClasses');
  const integerLimits = ['maxGoalVersions', 'maxPlanVersions', 'maxNodes', 'maxDepsPerNode', 'maxTextBytes', 'maxItems', 'maxScopePaths', 'maxRouteValues', 'maxGoalBytes', 'maxPlanBytes', 'maxStatusBytes', 'maxTokens', 'maxWallMin', 'maxProviderTurns'];
  const maxUsdNanos = usdToNanos(raw.limits.maxUsd);
  const canonicalMaxUsd = maxUsdNanos === null ? null : usdFromNanos(maxUsdNanos);
  if (integerLimits.some((key) => !Number.isSafeInteger(raw.limits[key]) || raw.limits[key] <= 0)
    || canonicalMaxUsd === null
    || raw.limits.maxGoalVersions > 1_000_000 || raw.limits.maxPlanVersions > 1_000_000
    || raw.limits.maxNodes > 100_000 || raw.limits.maxDepsPerNode > 100_000
    || raw.limits.maxTextBytes > 1024 * 1024 || raw.limits.maxGoalBytes > 16 * 1024 * 1024
    || raw.limits.maxPlanBytes > 64 * 1024 * 1024 || raw.limits.maxStatusBytes > 64 * 1024 * 1024) fail('goal/plan policy limits are invalid', 'goal_plan_policy_invalid');
  raw.limits.maxUsd = canonicalMaxUsd;
  const normalizedPolicy = { ...clone(raw), riskClasses: risks, effectClasses, capabilityClasses, limits: clone(raw.limits) };
  const policyDigest = goalPlanDigest(normalizedPolicy);
  if (suppliedDigest !== undefined && suppliedDigest !== policyDigest) fail('goal/plan policy digest is invalid', 'goal_plan_policy_invalid');
  return Object.freeze({ ...normalizedPolicy, limits: Object.freeze(clone(raw.limits)), policyDigest });
}

export function normalizeGoalRequest(value, policy) {
  exactObject(value, ['objective', 'definitionOfDone', 'constraints', 'risk', 'budget', 'predecessor']);
  const result = {
    objective: normalizedText(value.objective, policy.limits.maxTextBytes, 'objective'),
    definitionOfDone: normalizedSet(value.definitionOfDone, policy.limits.maxItems, policy.limits.maxTextBytes, 'definitionOfDone', { empty: false }),
    constraints: normalizedSet(value.constraints, policy.limits.maxItems, policy.limits.maxTextBytes, 'constraints'),
    risk: value.risk,
    budget: normalizeBudget(value.budget, policy, 'goal'),
    predecessor: normalizePredecessor(value.predecessor, 'goal'),
  };
  riskIndex(policy, result.risk);
  if (Buffer.byteLength(JSON.stringify(goalPlanCanonical(result))) > policy.limits.maxGoalBytes) fail('goal exceeds deployment byte ceiling', 'goal_too_large');
  return result;
}

export function assertGoalSuccessor(prior, next, policy) {
  const includes = (values, required) => required.every((item) => values.includes(item));
  if (!includes(next.definitionOfDone, prior.definitionOfDone) || !includes(next.constraints, prior.constraints)
    || riskIndex(policy, next.risk) < riskIndex(policy, prior.risk) || !budgetWithin(next.budget, prior.budget)) {
    fail('goal amendment weakens an established constraint', 'goal_weakened');
  }
}

function normalizeVerification(value, policy, deps) {
  exactObject(value, ['command', 'arguments', 'cwd', 'envAllowlist', 'expectExit', 'expectResult', 'timeoutMs', 'maxOutputBytes', 'requiredPredecessorEvidence']);
  const command = normalizedText(value.command, policy.limits.maxTextBytes, 'verification.command');
  if (command.startsWith('/') || command.includes('\\') || command.split('/').includes('..')
    || /[\s|&;<>`$()]/u.test(command)) fail('verification executable must be direct and repository-safe', 'plan_verification_invalid');
  if (!Array.isArray(value.arguments) || value.arguments.length > policy.limits.maxItems
    || value.arguments.some((argument) => typeof argument !== 'string' || argument.includes('\0') || Buffer.byteLength(argument) > policy.limits.maxTextBytes)) fail('verification arguments are invalid', 'plan_verification_invalid');
  if (value.arguments.some((argument) => secretShapedText(argument.normalize('NFKC')))) fail('verification arguments contain credential-shaped content', 'goal_plan_secret_rejected');
  const cwd = normalizedText(value.cwd, policy.limits.maxTextBytes, 'verification.cwd');
  if (cwd.startsWith('/') || cwd.includes('\\') || cwd.split('/').includes('..')) fail('verification cwd is outside repository scope', 'plan_verification_invalid');
  const envAllowlist = normalizedSet(value.envAllowlist, policy.limits.maxItems, 128, 'verification.envAllowlist');
  if (envAllowlist.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
    || /(?:auth|cookie|credential|key|password|secret|token)/i.test(name))) fail('verification environment allowlist contains a credential-shaped name', 'plan_verification_invalid');
  const requiredPredecessorEvidence = normalizedSet(value.requiredPredecessorEvidence, policy.limits.maxDepsPerNode, 256, 'verification.requiredPredecessorEvidence');
  if (!Number.isSafeInteger(value.expectExit) || value.expectExit < 0 || value.expectExit > 255
    || value.expectResult !== 'exit_code'
    || !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs <= 0 || value.timeoutMs > 24 * 60 * 60 * 1000
    || !Number.isSafeInteger(value.maxOutputBytes) || value.maxOutputBytes <= 0 || value.maxOutputBytes > 16 * 1024 * 1024
    || goalPlanDigest(requiredPredecessorEvidence) !== goalPlanDigest(deps)) fail('verification contract is invalid', 'plan_verification_invalid');
  return {
    command, arguments: [...value.arguments], cwd, envAllowlist, expectExit: value.expectExit,
    expectResult: value.expectResult, timeoutMs: value.timeoutMs, maxOutputBytes: value.maxOutputBytes,
    requiredPredecessorEvidence,
  };
}
function normalizeScope(values, policy) {
  const scope = normalizedSet(values, policy.limits.maxScopePaths, policy.limits.maxTextBytes, 'pathScope', { empty: false });
  if (scope.some((item) => item.startsWith('/') || item.split('/').includes('..') || item.includes('\\'))) fail('plan scope is not repository relative', 'plan_scope_invalid');
  return scope;
}
function normalizeRoutes(value, policy) {
  exactObject(value, ['harnesses', 'models', 'efforts']);
  return {
    harnesses: normalizedSet(value.harnesses, policy.limits.maxRouteValues, 256, 'routes.harnesses', { empty: false }),
    models: normalizedSet(value.models, policy.limits.maxRouteValues, 256, 'routes.models', { empty: false }),
    efforts: normalizedSet(value.efforts, policy.limits.maxRouteValues, 64, 'routes.efforts', { empty: false }),
  };
}
function normalizeNode(value, policy, goal) {
  exactObject(value, ['key', 'objective', 'definitionOfDone', 'deps', 'pathScope', 'risk', 'budget', 'verification', 'routes', 'capabilities', 'effects']);
  const key = normalizedText(value.key, 256, 'node.key');
  if (!/^[A-Za-z0-9._:-]+$/.test(key)) fail('plan node key is invalid', 'plan_node_invalid');
  const deps = normalizedSet(value.deps, policy.limits.maxDepsPerNode, 256, 'node.deps');
  const result = {
    key,
    objective: normalizedText(value.objective, policy.limits.maxTextBytes, 'node.objective'),
    definitionOfDone: normalizedSet(value.definitionOfDone, policy.limits.maxItems, policy.limits.maxTextBytes, 'node.definitionOfDone'),
    deps,
    pathScope: normalizeScope(value.pathScope, policy),
    risk: value.risk,
    budget: normalizeBudget(value.budget, policy, 'plan node'),
    verification: normalizeVerification(value.verification, policy, deps),
    routes: normalizeRoutes(value.routes, policy),
    capabilities: normalizedSet(value.capabilities, policy.limits.maxItems, 128, 'node.capabilities'),
    effects: normalizedSet(value.effects, policy.limits.maxItems, 128, 'node.effects'),
  };
  if (riskIndex(policy, result.risk) < riskIndex(policy, goal.risk)) fail('plan node risk weakens the goal execution-control tier', 'plan_risk_mismatch');
  if (result.definitionOfDone.some((item) => !goal.definitionOfDone.includes(item))) fail('plan node assigns an unknown definition-of-done item', 'plan_goal_mismatch');
  if (result.capabilities.some((item) => !policy.capabilityClasses.includes(item)) || result.effects.some((item) => !policy.effectClasses.includes(item))) fail('plan node exceeds deployment capability/effect policy', 'plan_effect_invalid');
  return result;
}
function assertDag(nodes) {
  const keys = new Set(nodes.map((node) => node.key));
  if (keys.size !== nodes.length) fail('plan contains duplicate node keys', 'plan_duplicate_node');
  for (const node of nodes) {
    if (node.deps.includes(node.key)) fail('plan contains a self dependency', 'plan_cycle');
    if (node.deps.some((dep) => !keys.has(dep))) fail('plan contains a dangling dependency', 'plan_dangling_dependency');
  }
  const visiting = new Set(); const visited = new Set(); const byKey = new Map(nodes.map((node) => [node.key, node]));
  const visit = (key) => {
    if (visiting.has(key)) fail('plan contains a dependency cycle', 'plan_cycle');
    if (visited.has(key)) return;
    visiting.add(key); for (const dep of byKey.get(key).deps) visit(dep); visiting.delete(key); visited.add(key);
  };
  for (const key of [...keys].sort()) visit(key);
}

export function normalizePlanRequest(value, policy, goal) {
  exactObject(value, ['goal', 'predecessor', 'nodes']);
  const goalRef = normalizeRef(value.goal, 'goal');
  if (goalRef.goalId !== goal.goalId || goalRef.version !== goal.version || goalRef.digest !== goal.digest) fail('plan goal reference is stale', 'goal_stale');
  if (!Array.isArray(value.nodes) || value.nodes.length === 0 || value.nodes.length > policy.limits.maxNodes) fail('plan node count is invalid', 'plan_node_limit');
  const nodes = value.nodes.map((node) => normalizeNode(node, policy, goal)).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  assertDag(nodes);
  const covered = new Set(nodes.flatMap((node) => node.definitionOfDone));
  if (goal.definitionOfDone.some((item) => !covered.has(item))) fail('plan does not cover the goal definition of done', 'plan_goal_mismatch');
  const totals = { tokens: 0, usd: 0, wallMin: 0, providerTurns: 0 };
  let totalUsdNanos = 0;
  for (const node of nodes) {
    for (const key of ['tokens', 'wallMin', 'providerTurns']) {
      totals[key] += node.budget[key];
      if (!Number.isSafeInteger(totals[key])) fail('plan budget aggregation overflowed', 'plan_budget_exceeded');
    }
    totalUsdNanos += usdToNanos(node.budget.usd);
    if (!Number.isSafeInteger(totalUsdNanos)) fail('plan budget aggregation overflowed', 'plan_budget_exceeded');
  }
  totals.usd = usdFromNanos(totalUsdNanos);
  if (totals.usd === null || totalUsdNanos > usdToNanos(goal.budget.usd)) fail('plan allocations exceed goal budget', 'plan_budget_exceeded');
  if (!budgetWithin(totals, goal.budget)) fail('plan allocations exceed goal budget', 'plan_budget_exceeded');
  const result = { goal: goalRef, predecessor: normalizePredecessor(value.predecessor, 'plan'), nodes, totals };
  if (Buffer.byteLength(JSON.stringify(goalPlanCanonical(result))) > policy.limits.maxPlanBytes) fail('plan exceeds deployment byte ceiling', 'plan_too_large');
  return result;
}

export function buildAuthoritativeBrief(goal, plan, node, binding) {
  return {
    goal: node.objective,
    constraints: clone(goal.constraints),
    pathScope: clone(node.pathScope),
    tools: [],
    outputFormat: '',
    definitionOfDone: node.definitionOfDone.join('\n'),
    verification: clone(node.verification),
    budget: { tokens: node.budget.tokens, usd: node.budget.usd, wallMin: node.budget.wallMin },
    providerTurns: node.budget.providerTurns,
    capabilities: clone(node.capabilities),
    effects: clone(node.effects),
    goalPlan: clone(binding),
  };
}

export function semanticBriefCore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(['goal', 'constraints', 'pathScope', 'tools', 'outputFormat', 'definitionOfDone', 'verification', 'budget', 'providerTurns', 'capabilities', 'effects']
    .filter((key) => Object.hasOwn(value, key)).map((key) => [key, clone(value[key])]));
}

export function normalizeGoalPlanContext(ctx, policy, power) {
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) fail('goal/plan authority context is absent', 'goal_plan_unauthorized');
  if (Object.keys(ctx).sort().join(',') !== ['actor', 'idempotencyKey', 'powers', 'principalId', 'repoId', 'runId', 'sessionId'].sort().join(',')
    || !validId(ctx.principalId) || typeof ctx.actor !== 'string' || ctx.actor.length === 0 || Buffer.byteLength(ctx.actor) > 256 || ctx.actor.includes('\0') || !validId(ctx.sessionId)
    || ctx.repoId !== policy.repoId || (ctx.runId !== null && !validId(ctx.runId)) || !Array.isArray(ctx.powers)
    || ctx.powers.some((item) => !validId(item)) || new Set(ctx.powers).size !== ctx.powers.length
    || !ctx.powers.includes(power) || typeof ctx.idempotencyKey !== 'string' || ctx.idempotencyKey.length === 0 || ctx.idempotencyKey.includes('\0') || Buffer.byteLength(ctx.idempotencyKey) > 4096) {
    fail('goal/plan authority is insufficient', 'goal_plan_unauthorized');
  }
  return {
    actor: ctx.actor, principalId: ctx.principalId, sessionDigest: goalPlanDigest({ sessionId: ctx.sessionId }),
    repoId: ctx.repoId, runId: ctx.runId ?? null, powers: [...new Set(ctx.powers)].sort(), key: ctx.idempotencyKey,
  };
}
