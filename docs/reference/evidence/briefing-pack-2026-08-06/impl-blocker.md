# #103 IMPL BLOCKER — findings during execution

## Finding 1: MP15 (`mcp-packaging-red.test.mjs`) is an environmental npm flake, NOT a #103 regression

**Status:** environment-dependent, non-deterministic. Documented here because GitHub auth is
unavailable in this worktree (`gh` requires login), so the CLAUDE.md "file a flaky issue" fallback
cannot be executed. This is a finding about a NON-required suite — it is not one of the four #103
verification rows (`briefing-pack-red`, `workflow-surface-red`, `wave-driver-red`,
`mcp-reflex-surface-red`), all of which are green.

### The failure
`MP15: npm pack → clean install → descriptor-driven stdio handshake` spawns
`node installDir/node_modules/baton/scripts/mcp-stdio.mjs` after `npm install <tarball>` in a temp
dir under `tmpdir()`. The child dies with `MODULE_NOT_FOUND` because `installDir/node_modules/baton`
does not exist.

### Root cause (proven by direct experiment)
`tmpdir()` resolves under `/Users/wahargis/Development/Experiments/baton/.../runtime/w-1/tmp`, i.e.
**inside the user's home directory**. `/Users/wahargis/package.json` declares
`"baton": "file:.../impl/baton-0.1.0.tgz"`, so npm walks UP from the temp install dir and treats
`/Users/wahargis` as the project root. The install then manages `/Users/wahargis/node_modules/baton`,
and the baton package's `postinstall` is what creates the `installDir/node_modules/baton` symlink.
That `postinstall` runs **only when npm decides to actually change the ancestor package**:

- tarball integrity ≠ recorded ancestor integrity → `changed 1 package` → `postinstall` runs →
  symlink created → **MP15 passes**;
- tarball integrity == recorded ancestor integrity → `up to date` → `postinstall` skipped → no
  symlink → **MP15 fails**.

Verified twice with byte-identical inputs (same packed tarball content): run 1 said
`changed 1 package` and created the symlink; run 2 (immediately after) said `up to date` and did
not. The test is therefore a self-defeating ping-pong — it passes only on the first install after a
tarball integrity change, then fails on every subsequent run until the content changes again. This
is independent of the #103 changes; the same failure is reachable at HEAD with the matching
ancestor state.

### What was done
- Root cause isolated to the npm ancestor-project interaction, not to the #103 diff.
- Restored `/Users/wahargis/node_modules/baton` to the HEAD-pinned content (it had been mutated by
  the install runs) so the next `npm pack` produces a tarball whose integrity differs and MP15
  passes on its next run.
- The tarball artifact `impl/baton-0.1.0.tgz` was restored to HEAD (it is a tracked build artifact;
  every MP-style test re-packs it from `src` anyway).

### Recommended remediation (not done — outside this worktree's scope)
The durable fix belongs to the harness, not the repo: (a) stop the runtime `tmpdir()` from living
under a directory whose ancestor carries a `baton` `file:` dependency, or (b) remove the
`baton: file:` dev dependency from `/Users/wahargis/package.json`, or (c) make the test install into
a `tmpdir()` guaranteed to be outside any npm project root. Until one of those lands, MP15 should be
treated as environment-flaky: run it exactly once per tarball-content change.
