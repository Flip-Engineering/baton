# Phase 55 GLM Review

## Verdict

REVISE - Phase 55 implementation has a P0 hardlink rejection defect that violates TP2 contract. The test suite confirms this: `TP1/TP2/TP11: invalid configuration, unsafe mappings, links, hardlinks, privileged files, and special files fail closed` fails with "Missing expected exception" when a hardlink is created in the source tree.

## P0-P1 findings

**P0: Hardlink detection broken in `toolchain-projection.mjs:118`**

The contract TP2 states: "Only ordinary directories and regular files are supported. Symlinks at any depth, hardlinked files, sockets, FIFOs, devices, setuid/setgid files, path escape, control-character names, and canonical path collisions refuse. Traversal never follows a link and never silently omits an entry."

**Defect:** impl/src/toolchain-projection.mjs:118 contains `if (before.nlink !== 1 || (before.mode & 0o6000) !== 0) invalid();` which correctly checks for hardlinks (nlink > 1 indicates multiple hard links). However, the test failure proves this check does not reject hardlinks as specified.

**Root cause:** The hardlink check at line 118 only applies to files during the initial scan in `scanProjection()`. When `inspectToolchainProjection()` is called, it validates configuration and scans source with `sourceSide=true`, but the hardlink check fails to trigger rejection. This violates the TP2 requirement that hardlinked files refuse during inspection.

**Impact:** An attacker could place a hardlinked file in the source tree that bypasses inspection, potentially allowing file content to be shared across the source boundary in ways that violate the closed configuration promise. This is a direct violation of TP2's "hardlinked files refuse" requirement.

**P1: Incomplete stat signature comparison for TOCTOU protection**

The `statSignature()` function at line 92-94 includes `stat.nlink` in the signature, but the post-operation verification at lines 125-127 compares stat signatures. If an attacker can modify the hardlink count between the initial `lstatSync` and post-operation verification (racing against the scan), the signature check would catch it via `statSignature(opened) !== statSignature(after)`. However, this is a reactive protection rather than proactive rejection at entry.

The code correctly checks for symlinks at line 111 and rejects them immediately with `invalid()`, but hardlinks at line 118 are not being rejected despite the check being present.

## Required corrections

1. **Fix hardlink rejection at toolchain-projection.mjs:118** - The check `if (before.nlink !== 1 ...)` must reliably throw `ToolchainProjectionError` with code `toolchain_projection_invalid` when `sourceSide=true`. The current check is present but not effective. Verify that `invalid()` is correctly propagating when `sourceSide=true`.

2. **Add explicit hardlink test case** - The test at line 128 (`linkSync(...)`) expects rejection but the test currently fails. After fixing line 118, verify the test passes to confirm hardlinks are rejected during inspection.

3. **Verify stat signature TOCTOU protection** - Confirm that the `statSignature` comparison at lines 125-127 correctly detects hardlink count changes during the scan window, and document why this is defense-in-depth rather than primary protection.

4. **Run full test suite** - After hardlink fix, ensure all 11 tests pass including `TP1/TP2/TP11` which currently fails.