import { createHash } from 'node:crypto';

const MAX_WORKFLOW_ROUNDS = 16;
const POLICY_FIELDS = Object.freeze([
  'allocation', 'budgetMode', 'maxFeedbackPacketsPerRound', 'maxFeedbackPacketsTotal',
  'maxRevisionAttemptsPerRound', 'maxRounds', 'schemaVersion', 'stopConditions',
]);
const NORMALIZED_FIELDS = Object.freeze([...POLICY_FIELDS, 'policyDigest']);
const STOP_CONDITIONS = Object.freeze([
  'identical_candidate', 'identical_feedback', 'no_verified_progress',
  'unresolved_contradiction', 'verification_failure',
]);

function policyError(message) {
  return Object.assign(new TypeError(message), { code: 'workflow_policy_invalid' });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const DEFAULT_INPUT = Object.freeze({
  schemaVersion: 1,
  maxRounds: 8,
  maxRevisionAttemptsPerRound: 1,
  maxFeedbackPacketsPerRound: 64,
  maxFeedbackPacketsTotal: 256,
  budgetMode: 'authorized_plan_totals_within_goal',
  allocation: 'equal_round_share',
  stopConditions: STOP_CONDITIONS,
});

export function normalizeWorkflowPolicy(value = DEFAULT_INPUT) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw policyError('Workflow policy must be an object');
  }
  const keys = Object.keys(value).sort();
  const hasDigest = Object.hasOwn(value, 'policyDigest');
  const expected = hasDigest ? NORMALIZED_FIELDS : POLICY_FIELDS;
  if (keys.join(',') !== [...expected].sort().join(',')) {
    throw policyError('Workflow policy must be a closed deployment-owned contract');
  }
  if (value.schemaVersion !== 1
    || !Number.isSafeInteger(value.maxRounds) || value.maxRounds < 2
    || value.maxRounds > MAX_WORKFLOW_ROUNDS
    || value.maxRevisionAttemptsPerRound !== 1
    || !Number.isSafeInteger(value.maxFeedbackPacketsPerRound)
    || value.maxFeedbackPacketsPerRound <= 0 || value.maxFeedbackPacketsPerRound > 1_024
    || !Number.isSafeInteger(value.maxFeedbackPacketsTotal)
    || value.maxFeedbackPacketsTotal < value.maxFeedbackPacketsPerRound
    || value.maxFeedbackPacketsTotal > 16_384
    || value.budgetMode !== 'authorized_plan_totals_within_goal'
    || value.allocation !== 'equal_round_share'
    || !Array.isArray(value.stopConditions)
    || new Set(value.stopConditions).size !== STOP_CONDITIONS.length
    || [...value.stopConditions].sort().join(',') !== [...STOP_CONDITIONS].sort().join(',')) {
    throw policyError('Workflow policy values are invalid or unbounded');
  }
  const body = {
    schemaVersion: 1,
    maxRounds: value.maxRounds,
    maxRevisionAttemptsPerRound: 1,
    maxFeedbackPacketsPerRound: value.maxFeedbackPacketsPerRound,
    maxFeedbackPacketsTotal: value.maxFeedbackPacketsTotal,
    budgetMode: value.budgetMode,
    allocation: value.allocation,
    stopConditions: [...STOP_CONDITIONS],
  };
  const policyDigest = digest(body);
  if (hasDigest && value.policyDigest !== policyDigest) {
    throw policyError('Workflow policy digest is invalid');
  }
  return deepFreeze({ ...body, policyDigest });
}

export const DEFAULT_WORKFLOW_POLICY = normalizeWorkflowPolicy();
export const LEGACY_WORKFLOW_POLICY = normalizeWorkflowPolicy({
  ...DEFAULT_INPUT, maxRounds: 2,
});

export { MAX_WORKFLOW_ROUNDS, STOP_CONDITIONS as WORKFLOW_STOP_CONDITIONS };
