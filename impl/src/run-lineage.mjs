const POLICY_FIELDS = Object.freeze([
  'leaseTtlMs', 'maxChildrenPerRun', 'maxDepth', 'maxDescendantsPerRoot', 'schemaVersion',
]);

export const RUN_ORCHESTRATOR_CAPABILITIES = Object.freeze([
  'run.context', 'run.start', 'run.status', 'run.stop',
]);

export const RUN_ORCHESTRATOR_REVOCATION_REASONS = Object.freeze([
  'operator', 'parent_terminal', 'parent_run_stopping', 'session_revoked', 'superseded',
]);

export const DEFAULT_RUN_LINEAGE_POLICY = Object.freeze({
  schemaVersion: 1,
  maxDepth: 4,
  maxChildrenPerRun: 8,
  maxDescendantsPerRoot: 32,
  leaseTtlMs: 30 * 60 * 1_000,
});

function fail(message) {
  const error = new TypeError(message);
  error.code = 'run_lineage_policy_invalid';
  throw error;
}

export function normalizeRunLineagePolicy(value = DEFAULT_RUN_LINEAGE_POLICY) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...POLICY_FIELDS].sort().join(',')
    || value.schemaVersion !== 1) {
    fail('run lineage policy is invalid');
  }
  for (const field of ['maxDepth', 'maxChildrenPerRun', 'maxDescendantsPerRoot', 'leaseTtlMs']) {
    if (!Number.isSafeInteger(value[field]) || value[field] <= 0) fail('run lineage policy is invalid');
  }
  if (value.maxDepth > 1_024 || value.maxChildrenPerRun > 100_000
    || value.maxDescendantsPerRoot > 1_000_000 || value.leaseTtlMs > 24 * 60 * 60 * 1_000) {
    fail('run lineage policy exceeds deployment ceilings');
  }
  return Object.freeze({ ...value });
}

// REPL-1 (docs/33 §4, rule 9): the per-run ceiling on admitted ReplManifests. Its home is the
// run-lineage policy FAMILY — NOT the context-program policy, whose field set feeds `policyDigest`
// and would perturb every manifest/session digest. It is kept OFF the digested `_runLineagePolicy`
// body so it never perturbs the lease payload digest; the store derives it separately.
// Derivation (No-Arbitrary-Numeric-Limits rule): one admitted manifest per REPL layer per run —
// the single `shared` layer plus one `worker:<id>` layer per worker child (maxChildrenPerRun).
export function deriveMaxReplManifestsPerRun(policy) {
  return policy ? policy.maxChildrenPerRun + 1 : null;
}
