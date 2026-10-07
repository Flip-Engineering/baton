# Phase 40 GLM review adjudication

The GLM report is independent review evidence, not decision authority. Baton accepted these
contract improvements before implementation:

- scripts-disabled posture comes from a trusted sandbox-supervisor execution receipt binding exact
  executable/version/argv, base digest, isolated root, owned cache, registry policy, exit, and
  cleanup; package-manager self-attestation is insufficient;
- the resolver receives immutable bytes and the supervisor receipt repeats their digest;
- proposed non-link registry components require exact versions, integrity, and deployment-allowed
  origins, while Git/file/workspace/link/arbitrary URL entries fail closed;
- root identity and exact root request are reasserted before delta classification; and
- the disposable root, cache, subprocess tree, and temporary credentials are lifecycle-owned on
  every terminal path.

Two recommendations were rejected:

- A concurrent source edit that is detected and discards the proposal is conservative denial of
  service, not stale acceptance. Immutable input bytes plus a receipt-bound base digest keep the
  resolver input stable; post-resolution source mismatch still rejects.
- npm install path/hoist movement is a real proposed graph change. Phase 40 preserves normalized
  lockfile paths, so moving an equal name/version is represented as removal plus addition rather
  than collapsed into a false unchanged result.

The phase still does not claim independent registry consensus, transitive vulnerability safety,
install permission, reachability proof, or independent Sigstore/SLSA verification.
