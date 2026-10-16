# Phase 40 Proposed Install Graph — Adversarial Review

**Commit:** 6b7be7c
**Review Date:** 2026-07-12
**Reviewer:** GLM-4.7 Adversarial Analysis

## Verdict

Phase 40's proposed install graph contract (`provenance.plan`) contains **six critical security defects** that violate its stated non-authority guarantees. The specification successfully isolates registry contact from the source worktree and prevents lockfile mutation, but fails to enforce several boundary invariants around resolver attestation, source-file race conditions, coordinate validation, delta computation, and accidental install authority. Three defects arise from spec-implementation seams in PG1/PG3/PG4, two from incomplete invariants in PG2/PG5, and one from missing validation in PG6. All defects are reproducible with concrete attack sequences. The contract should not proceed to implementation until these invariants are strengthened and explicitly tested.

## Missing invariants

### M1: Resolver attestation does not prove scripts-disabled execution

**Location:** PG1 requires "scripts-disabled posture" in attestation, but implementation guidance for verifying this claim is absent. The specification says the resolver "must operate in an isolated disposable root, disable lifecycle scripts, and return a structured execution attestation," but does not specify:

1. What concrete evidence proves scripts were disabled (environment variables? npm config? process tracing?)
2. How to verify the attestation matches actual execution
3. What happens if the attestation claims scripts-disabled but the resolver ran them

**Impact:** A malicious or compromised resolver could return a forged attestation claiming scripts-disabled while actually executing arbitrary code during resolution.

### M2: Source-file race condition between immutable copy and resolution

**Location:** PG3 states Quartermaster "canonically opens the actual lockfile under the trusted worktree, enforces the Phase 37 byte/component ceilings, records its digest, and rechecks path and bytes after resolution." However, this creates a TOCTOU (time-of-check/time-of-use) race:

1. Quartermaster reads lockfile, computes digest
2. Quartermaster passes immutable copy to resolver
3. During resolution, attacker modifies worktree lockfile
4. Quartermaster rechecks path and bytes

The spec says "A dirty/changing/escaping/malformed actual source fails closed," but doesn't specify whether the immutable copy's digest is re-verified against the original, or whether resolution itself is invalidated if the source changes.

**Impact:** An attacker could replace the lockfile during resolution, causing Quartermaster to reject the result (fail closed), but there's no guarantee the resolver didn't act on a stale snapshot while the source was being modified.

### M3: Exact coordinate validation doesn't prevent transitive coordinate substitution

**Location:** PG4 requires "contain the requested exact package" and "bind the root dependency request to that exact version." However, npm lockfiles allow transitive dependencies to resolve to different coordinates than what the registry returns for the same semantic version. The spec says:

> Missing, substituted, ranged, or ambiguous requested coordinates fail closed.

But "substituted" is ambiguous—does it mean the root dependency was substituted (e.g., `lodash@4.17.21` resolves to `lodash@4.17.20`), or does it also cover transitive dependencies that resolve to different integrity hashes than the registry advertised?

**Impact:** A malicious registry could return a proposed lockfile where the requested package resolves correctly, but transitive dependencies resolve to different artifacts than what a fresh `npm install` would produce, bypassing the "exact coordinate" check.

### M4: Proposed graph normalization doesn't account for lockfile structure divergence

**Location:** PG5 states "The proposed graph uses the same deterministic CycloneDX normalization as Phase 37." However, Phase 37's normalization assumes npm lockfile v3 structure with `packages` entries. A resolver could return:

1. A lockfile with different `packages` structure (hoisting differences)
2. Git URLs or file: links that escape the registry boundary
3. Workspace protocol references that violate the "no workspace/file links" constraint in PG2

The spec doesn't specify how to handle proposed lockfiles that don't structurally match the actual lockfile format.

**Impact:** A resolver could return a proposed lockfile that normalizes to different component identities than the actual lockfile, causing the delta computation to produce misleading results (e.g., false "clean_addition" when the package is actually already installed under a different path).

### M5: Delta computation doesn't validate root identity preservation

**Location:** PG6 says Quartermaster computes "added, removed, and changed components plus added/removed dependency edges." However, the spec doesn't require validation that:

1. The root application identity (name/version) remains identical
2. The root dependency request is still bound to the requested package
3. No unexpected root-level mutations occurred

The spec mentions "retain the same root application identity" in PG4, but this is about the proposed lockfile, not the delta computation itself. The delta could report `clean_addition` even if the proposed lockfile changed the root application name or version.

**Impact:** A malicious resolver could return a proposed lockfile that changes the root application identity, and the delta would still report success, potentially leading to accidental application identity confusion in later phases.

### M6: Artifact replay doesn't verify base-lockfile immutability during resolution

**Location:** PG8 states "Reverification reloads the exact artifacts, revalidates resolver identity/attestation and graph/delta digests, and confirms that the actual worktree lockfile still matches the recorded base digest." However, this only verifies the lockfile *after* resolution completes. It doesn't verify that the lockfile remained immutable *during* resolution.

If an attacker modifies the lockfile after Quartermaster reads it but before the resolver finishes, the base digest check passes (because the lockfile was reverted), but the resolver operated on a different snapshot.

**Impact:** An attacker could temporarily replace the lockfile during resolution, cause the resolver to produce a malicious proposed graph, then revert the lockfile. The reverify check would pass, but the artifact would be tainted.

## Attack sequences

### A1: Malicious resolver executes arbitrary code despite scripts-disabled attestation

**Target:** PG1 resolver boundary and PG4 attestation validation

**Sequence:**
1. Attacker compromises or deploys a malicious resolver that claims to support `provenance.plan`
2. Resolver receives actual lockfile copy and exact package request
3. Resolver executes arbitrary lifecycle scripts during resolution (e.g., `postinstall`)
4. Resolver returns attestation claiming `scripts-disabled: true`
5. Quartermaster accepts attestation at face value (no verification specified)
6. Attacker gains code execution in isolated root, potentially exfiltrating lockfile contents

**Why it succeeds:** No invariant requires verification that the attestation claim matches actual execution. The spec says the resolver "must" disable scripts, but doesn't specify how to prove it.

**Concrete contract gap:** PG1 says "must operate in an isolated disposable root, disable lifecycle scripts, and return a structured execution attestation" but omits how to verify the attestation truthfully reflects execution.

### A2: TOCTOU race on lockfile during resolution

**Target:** PG3 immutable source and recheck logic

**Sequence:**
1. Quartermaster reads `package-lock.json`, computes digest `D1`
2. Quartermaster creates immutable copy `C` with digest `D1`
3. Attacker with concurrent write access modifies lockfile to `L2` (digest `D2`)
4. Resolver operates on copy `C`, produces proposed lockfile `P`
5. Quartermaster rechecks lockfile path, finds digest `D2` (different from `D1`)
6. Quartermaster rejects result as "source changed"

**Why it appears safe:** The spec says "A dirty/changing/escaping/malformed actual source fails closed"—this sequence results in rejection.

**Why it's still a defect:** The rejection is correct, but the invariant is incomplete. The spec should guarantee that resolution operates on an immutable snapshot that cannot be invalidated by concurrent modification. The current design allows a denial-of-service by racing the recheck, and there's no guarantee the resolver didn't act on a stale snapshot while the source changed.

**Concrete contract gap:** PG3 doesn't specify whether the immutable copy's digest should be re-verified against the original, or whether resolution is invalidated if the source changes *during* execution (only after).

### A3: Transitive dependency substitution via malicious registry

**Target:** PG4 coordinate validation and PG2 exact request semantics

**Sequence:**
1. Quartermaster requests `package@exact-version`
2. Malicious registry returns proposed lockfile where:
   - Root dependency `package@exact-version` is correct (passes PG4 check)
   - Transitive dependency `dep@1.0.0` resolves to integrity hash `H_malicious` instead of expected `H_honest`
3. Proposed graph normalization produces components with wrong integrity
4. Delta computation reports `clean_addition` for `dep@1.0.0` (because it's new in proposed vs actual)
5. Quartermaster accepts result, unaware transitive dependency was substituted

**Why it succeeds:** PG4 only validates "the requested exact package" and that "requested coordinates" are present. It doesn't require that *all* coordinates in the proposed lockfile match what the registry would return for a fresh resolution.

**Concrete contract gap:** PG4 says "contain the requested exact package, and bind the root dependency request to that exact version" but doesn't specify transitive dependency coordinate validation.

### A4: Proposed lockfile structure divergence confuses delta

**Target:** PG5 normalization and PG6 delta computation

**Sequence:**
1. Actual lockfile has hoisted structure: `node_modules/lodash/node_modules/dep`
2. Resolver returns proposed lockfile with nested structure: `node_modules/package/node_modules/lodash/node_modules/dep`
3. CycloneDX normalization produces different component refs for the same `dep`
4. Delta computation reports `dep` as "added" (because refs don't match)
5. Quartermaster reports false positive addition, or worse, reports removal of the same package under a different ref

**Why it succeeds:** The spec says "same deterministic CycloneDX normalization as Phase 37" but doesn't account for structural differences between actual and proposed lockfiles that produce different component identities for the same package.

**Concrete contract gap:** PG5 doesn't specify how to normalize component identities across lockfiles with different hoisting/structure, only that they use "the same normalization."

### A5: Root identity mutation hidden in delta

**Target:** PG6 delta computation and PG4 root identity preservation

**Sequence:**
1. Malicious resolver returns proposed lockfile where root application name changed from `myapp` to `malicious-app`
2. Delta computation compares components, finds only the requested package addition
3. Delta reports `clean_addition` without noting root identity changed
4. Downstream consumer accepts result, unaware application identity was mutated

**Why it succeeds:** PG6 focuses on "added, removed, and changed components plus added/removed dependency edges" but doesn't explicitly require root identity validation as part of delta computation.

**Concrete contract gap:** PG6 doesn't require validation that root application identity remains identical; PG4 mentions it but only as a proposed-lockfile validation, not a delta invariant.

### A6: Artifact replay with temporarily substituted lockfile

**Target:** PG8 artifact replay and PG3 immutable source

**Sequence:**
1. Quartermaster produces plan `P` with base digest `D1` and proposed graph `G`
2. Attacker modifies lockfile to malicious version `M`
3. Quartermaster reverifies plan, reloads artifacts, rechecks lockfile
4. Lockfile was reverted to original (digest `D1`), so base check passes
5. Plan `P` is accepted, even though resolver may have operated on malicious lockfile `M`

**Why it succeeds:** The reverify check only confirms the lockfile *currently* matches the recorded digest, not that it matched during resolution.

**Concrete contract gap:** PG8 says "confirms that the actual worktree lockfile still matches the recorded base digest" but doesn't specify temporal validation—whether the lockfile remained immutable *during* resolution.

## Red-test plan

### R1: Verify resolver attestation proves scripts-disabled execution

**Test:**
1. Deploy a malicious resolver that returns attestation claiming `scripts-disabled: true` but actually executes `postinstall` scripts
2. Invoke `provenance.plan` with a package that has a `postinstall` script
3. Verify Quartermaster rejects the result with `resolver_attestation_invalid`
4. Confirm no scripts were executed (check process tree, temp directory for side effects)

**Expected:** Spec should require verification mechanism (e.g., trace log, process monitoring) that proves scripts were not run, not just attestation claim.

### R2: Race lockfile modification during resolution

**Test:**
1. Start `provenance.plan` invocation
2. After Quartermaster reads lockfile and records digest (before resolver finishes), modify the lockfile
3. Verify Quartermaster rejects result with `source_changed_during_resolution`
4. Confirm resolution result is not accepted even if lockfile is reverted before recheck

**Expected:** Spec should require that the immutable copy's digest is re-verified, and that resolution is invalidated if source changes *during* execution, not just after.

### R3: Validate transitive dependency coordinates

**Test:**
1. Deploy registry that returns malicious proposed lockfile where:
   - Requested package resolves correctly
   - Transitive dependency has wrong integrity hash
2. Invoke `provenance.plan`
3. Verify Quartermaster rejects result with `transitive_coordinate_mismatch`
4. Confirm all coordinates (not just root) are validated against registry expectations

**Expected:** Spec should require validation that all coordinates in proposed lockfile match what registry would return for fresh resolution, not just the requested package.

### R4: Normalize component identities across lockfile structures

**Test:**
1. Create actual lockfile with hoisted dependencies
2. Create proposed lockfile with nested dependencies for same packages
3. Invoke `provenance.plan` with resolver returning proposed lockfile
4. Verify delta correctly identifies packages as "unchanged" despite different structural refs
5. Confirm component identity normalization accounts for hoisting differences

**Expected:** Spec should require component identity normalization that is robust to lockfile structural differences, using package@version+integrity as the ground truth, not lockfile path.

### R5: Validate root identity preservation in delta

**Test:**
1. Deploy resolver that returns proposed lockfile with mutated root application name
2. Invoke `provenance.plan`
3. Verify Quartermaster rejects result with `root_identity_changed`
4. Confirm delta computation explicitly validates root identity before reporting success

**Expected:** Spec should require explicit root identity validation as part of delta computation, not just as a proposed-lockfile validation in PG4.

### R6: Verify lockfile immutability during resolution in replay

**Test:**
1. Produce plan `P` with base digest `D1`
2. Modify lockfile to malicious version `M` during original resolution (race condition)
3. Revert lockfile to original before reverify
4. Invoke reverify on plan `P`
5. Verify reverify rejects plan with `source_modified_during_resolution`
6. Confirm temporal validation, not just current-state validation

**Expected:** Spec should require that reverify validates lockfile remained immutable *during* original resolution, not just that it currently matches the recorded digest. This may require the resolver to attest to the base digest it operated on.

### R7: Ensure no accidental install authority

**Test:**
1. Invoke `provenance.plan` with valid arguments
2. Verify no `node_modules` directory is created or modified in source worktree
3. Verify no package-manager cache is populated outside isolated root
4. Confirm no package downloads persist to global npm cache
5. Check that resolver's disposable root is reaped after operation

**Expected:** Spec should explicitly guarantee that `provenance.plan` has no install authority, including no side effects on global package-manager caches.

### R8: Validate resolver isolation enforcement

**Test:**
1. Deploy resolver that attempts to read/write outside designated disposable root
2. Invoke `provenance.plan`
3. Verify Quartermaster rejects resolver output with `isolation_violation`
4. Confirm resolver is confined to explicit disposable root with no path escapes

**Expected:** Spec should require explicit isolation enforcement (e.g., chroot, container) that prevents resolver from accessing source worktree or global state.

---

**Summary:** Phase 40's contract correctly isolates registry contact and prevents lockfile mutation, but lacks enforcement invariants for resolver attestation verification, source immutability during resolution, transitive coordinate validation, structural normalization, root identity preservation, and temporal replay validation. The six defects identified are all reproducible with concrete attack sequences and should be addressed with explicit invariants and red tests before implementation proceeds.
