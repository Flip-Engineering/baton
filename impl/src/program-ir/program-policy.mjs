// Phase 93a.2 ProgramPolicy shape (§93.20). One baton.program_policy schema v1 binds the admitted
// lower authorities by digest and carries the deployment-owned numeric ceilings. The 93a.2 slice
// validates the exact field set, the digest formats, the numeric domains, and recomputes
// policyDigest; the like-for-like lower-authority binding proofs (including the route-card
// concurrencyCeiling minimum for maxParallelBranches) are Phase 93E scope and are not rederived
// here. Authority and numeric-domain violations fail program_policy_invalid; every other
// violation fails program_invalid, always before any effect.

import {
  canonicalProgramDigest, deepFreezeProgramValue, isProgramValueAuthority,
  normalizeCanonicalProgramValue,
} from './canonical-value.mjs';
import { digestValue, exactFields, fail } from './control-nodes.mjs';

const DIGEST_FIELDS = Object.freeze([
  'canonicalOrderPolicyDigest', 'contextPolicyDigest', 'workflowPolicyDigest', 'goalPolicyDigest',
  'capacityPolicyDigest', 'routeCardSetDigest', 'artifactPolicyDigest', 'lifecyclePolicyDigest',
]);
const NUMERIC_FIELDS = Object.freeze([
  'maxProgramBytes', 'maxProgramNodes', 'maxProgramDepth', 'maxSchemaDefinitions', 'maxValueBytes',
  'maxResultBytes', 'maxEvidenceRefs', 'maxRepeatRounds', 'maxChildDepth', 'maxEffectInstances',
  'maxJoinMembers', 'maxJoinComparisons', 'maxStateRevisions', 'maxTraceBytes',
]);
const POLICY_FIELDS = Object.freeze([
  'schemaVersion', 'kind', ...DIGEST_FIELDS, ...NUMERIC_FIELDS, 'maxParallelBranches', 'policyDigest',
]);
const policies = new WeakSet();

function authority(value) {
  if (!isProgramValueAuthority(value)) {
    fail('ProgramPolicy validation requires deployment-injected authority', 'program_policy_invalid');
  }
  return value;
}

function numeric(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(`ProgramPolicy ${label} must be a positive safe integer`, 'program_policy_invalid');
  }
  return value;
}

export function isProgramPolicy(value) {
  return Boolean(value && typeof value === 'object' && policies.has(value));
}

export function normalizeProgramPolicy(value, valueAuthority) {
  const deployed = authority(valueAuthority);
  const normalized = normalizeCanonicalProgramValue(value, deployed);
  exactFields(normalized, POLICY_FIELDS, 'ProgramPolicy');
  if (normalized.schemaVersion !== 1) fail('ProgramPolicy schemaVersion is invalid');
  if (normalized.kind !== 'baton.program_policy') fail('ProgramPolicy kind is invalid');
  const policy = { schemaVersion: 1, kind: 'baton.program_policy' };
  for (const field of DIGEST_FIELDS) {
    policy[field] = digestValue(normalized[field], `ProgramPolicy ${field}`);
  }
  for (const field of NUMERIC_FIELDS) policy[field] = numeric(normalized[field], field);
  if (normalized.maxParallelBranches !== null) {
    policy.maxParallelBranches = numeric(normalized.maxParallelBranches, 'maxParallelBranches');
  } else {
    policy.maxParallelBranches = null;
  }
  policy.policyDigest = digestValue(normalized.policyDigest, 'ProgramPolicy policyDigest');
  const { policyDigest: _omitted, ...sansDigest } = policy;
  if (policy.policyDigest !== canonicalProgramDigest(sansDigest, deployed)) {
    fail('ProgramPolicy policyDigest does not match its canonical bytes');
  }
  const frozen = deepFreezeProgramValue(policy);
  policies.add(frozen);
  return frozen;
}

// Test/builder convenience: computes policyDigest over the supplied 24-field body, then runs the
// full normalizer so a convenience-built policy is byte-identical to a normalized one.
export function createProgramPolicy(value, valueAuthority) {
  const deployed = authority(valueAuthority);
  const normalized = normalizeCanonicalProgramValue(value, deployed);
  exactFields(normalized, POLICY_FIELDS.filter((field) => field !== 'policyDigest'),
    'ProgramPolicy source');
  const policyDigest = canonicalProgramDigest(normalized, deployed);
  return normalizeProgramPolicy({ ...normalized, policyDigest }, deployed);
}
