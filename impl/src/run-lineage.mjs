const POLICY_FIELDS = Object.freeze([
  'leaseTtlMs', 'maxChildrenPerRun', 'maxDepth', 'maxDescendantsPerRoot', 'schemaVersion',
]);

// REPL-1 (docs/33 §3.1, issue #21): the per-run ceiling on admitted ReplManifests. It is a
// configurable, OPTIONAL field on the run-lineage policy (never on the context-program policy,
// whose field set feeds every manifest/session policyDigest). Leaving it out keeps the 5-field
// policy digest byte-identical to pre-REPL deployments; a policy may opt in by including it.
// Derivation of the default (No-Arbitrary-Numeric-Limits): a run admits at most one `shared`
// REPL layer plus one `worker:<id>` layer per worker it may fan out to (maxChildrenPerRun), so
// the default is that sum with modest headroom rather than an invented magic constant.
const REPL_POLICY_FIELDS = Object.freeze([...POLICY_FIELDS, 'maxReplManifestsPerRun']);

export const RUN_ORCHESTRATOR_CAPABILITIES = Object.freeze([
  'run.context', 'run.start', 'run.status', 'run.stop',
]);

export const RUN_ORCHESTRATOR_REVOCATION_REASONS = Object.freeze([
  'operator', 'parent_terminal', 'parent_run_stopping', 'review_window_expired',
  'session_revoked', 'superseded',
]);

export const DEFAULT_RUN_LINEAGE_POLICY = Object.freeze({
  schemaVersion: 1,
  maxDepth: 4,
  maxChildrenPerRun: 8,
  maxDescendantsPerRoot: 32,
  leaseTtlMs: 30 * 60 * 1_000,
});

// One `shared` layer + one `worker:<id>` layer per potential worker fan-out (maxChildrenPerRun).
export const DEFAULT_MAX_REPL_MANIFESTS_PER_RUN = DEFAULT_RUN_LINEAGE_POLICY.maxChildrenPerRun + 1;

function fail(message) {
  const error = new TypeError(message);
  error.code = 'run_lineage_policy_invalid';
  throw error;
}

export function normalizeRunLineagePolicy(value = DEFAULT_RUN_LINEAGE_POLICY) {
  const keys = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).sort().join(',') : null;
  // Accept the base 5-field policy (digest byte-identical to pre-REPL deployments) or the
  // extended 6-field policy that opts into a per-run ReplManifest ceiling.
  if (keys === null
    || (keys !== [...POLICY_FIELDS].sort().join(',') && keys !== [...REPL_POLICY_FIELDS].sort().join(','))
    || value.schemaVersion !== 1) {
    fail('run lineage policy is invalid');
  }
  for (const field of ['maxDepth', 'maxChildrenPerRun', 'maxDescendantsPerRoot', 'leaseTtlMs']) {
    if (!Number.isSafeInteger(value[field]) || value[field] <= 0) fail('run lineage policy is invalid');
  }
  if (Object.hasOwn(value, 'maxReplManifestsPerRun')
    && (!Number.isSafeInteger(value.maxReplManifestsPerRun) || value.maxReplManifestsPerRun <= 0
      || value.maxReplManifestsPerRun > 100_000)) {
    fail('run lineage policy is invalid');
  }
  if (value.maxDepth > 1_024 || value.maxChildrenPerRun > 100_000
    || value.maxDescendantsPerRoot > 1_000_000 || value.leaseTtlMs > 24 * 60 * 60 * 1_000) {
    fail('run lineage policy exceeds deployment ceilings');
  }
  return Object.freeze({ ...value });
}
