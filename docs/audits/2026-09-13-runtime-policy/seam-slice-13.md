# Seam slice 13 — the coordinator's surface bucket moves to runtime-api.mjs

Issue #259, slice 13. The coordinator's surface bucket — 46 members, the last classified bucket
left on the class after slices 8–12 — moves to `impl/src/runtime-api.mjs`. The execution contract
is `docs/audits/2026-09-13-runtime-policy/seam-slice-13-design.md` (f62f20db); this file records
what landed, including three errata the execution found and the design absorbed.

The invariant is the program's standing one: no behavior change.

Revision under audit: `28ae1bda` (slice 12) plus this slice's working tree. Write scope: the new
module, `impl/src/coordinator.mjs`, `impl/scripts/seam-inventory.mjs` (the new TARGET) + its
regenerated artifact, `impl/test/seam-inventory.test.mjs` (the SI6 row),
`impl/test/runtime-api.test.mjs` (new), and this file.

## 1. What moved, and the three errata

All 46 `surface` members moved verbatim with the single reroute `this.` → `coordinator.` and a
bare receiver — no recorder parameter, because no member records (slice 3's briefing precedent).
The delegates are plain forwarders without the recorder argument:

```
_harnessOf(vendor) { return runtimeApi._harnessOf(this, vendor); }
```

- **Erratum 1 — two members are async.** `_claimLivenessPreflight` (awaits
  `handle.worktreeReady` and the liveness probes) and `_claimInteraction` (awaits the pending
  record's claim race) are async; the design's "all 46 are sync" did not hold. The module
  functions are async; the delegates are plain non-async forwarders returning the module promise
  directly — the slice-11 timing convention, no adopted-promise hop.
- **Erratum 2 — the closure reaches two runtime-* modules.** `_claimLivenessPreflight` reads
  `pathInScope` (runtime-observation.mjs); `_providerFaultOf` reads `typedTerminalCode` and
  `watchdogConfig` reads `REARM_KINDS` (runtime-recovery.mjs). AP1's "imports no other runtime-*
  module" was written before the closure was computed. The invariant that matters is the leaf
  law: runtime-api.mjs imports downward, and nothing imports it except the coordinator (pinned
  in AP1 by importer enumeration). Relocating the two helpers instead would have cascaded
  runtime-observation's and runtime-recovery's own heavy usage of them.
- **Erratum 3 — the corpus is 2 462, the api row 47.** `canonicalActionPath`
  (coordinator.mjs:192-202) is read only by the moving `_relativeActionPath`, and the one-way
  rule forbids importing it back from the coordinator, so it relocates as the module's 47th
  member (a non-exported function declaration; the collector counts it, as it counts the
  slice-12 lifted closures). `WorkerNotFoundError` relocates as a class — not a member — with
  the coordinator importing it back and keeping its `export` surface (`coordinator.test.mjs`
  imports it from the coordinator unchanged).

The relocation closure otherwise reads clean: the moved bodies' module-scope imports are the
node:path/node:fs builtins, `normalizeConcurrencyCeiling`, `canonicalDigest`,
`boundedAttentionText`, `normalizeProviderRoute`/`readProviderFaultDetail`, the
shared-workspace-custody five, and `sanitizeVerifierDiagnosticText` — each imported from its
existing home, and pruned from the coordinator's import block where the moving members were the
only readers (`boundedAttentionText`, `normalizeConcurrencyCeiling`,
`sanitizeVerifierDiagnosticText`, `normalizeProviderRoute`, `readProviderFaultDetail`,
`workspaceAttachmentOf`, `workspaceCustodyRecord`, `workspaceHolders`, and the node:path/fs names
`basename`, `dirname`, `isAbsolute`, `relative`, `realpathSync`).

Destructured-parameter forwarding (no landed convention existed): the delegate keeps the
member's exact parameter text and forwards the destructured fields as a rebuilt object
(`_captureTrustWorktree(handle, task, { snapshot = false } = {}) { return
runtimeApi._captureTrustWorktree(this, handle, task, { snapshot }); }`). The module destructures
again; defaults fire identically and the destructure never exposed the rest of the object, so the
rebuild is behaviorally exact.

## 2. The map

One new target, exactly as designed: `{ file: 'impl/src/runtime-api.mjs', className: null,
receiver: 'coordinator', surface: ['_publicHandle'] }`. `_publicHandle`'s `admission:policy_gate`
+ `surface:transport_dispatch` evidence follows it module-side (receiver normalization covers the
first; the `surface` re-declaration covers the second); the other 45 bodies keep
`surface:no_authority_touched`, and `canonicalActionPath` classifies surface on the same fallback.
The corpus reads 2 462 members; the coordinator keeps 424 (46 delegates); the SI6
`CORPUS_COUNTS` table gains `'impl/src/runtime-api.mjs': 47` in this commit.

One honesty note the classifier forces: `_captureTrustWorktree` drives the worktree
capture/snapshot primitive through the receiver (a `capture.call(coordinator._worktrees, ...)`
the catalogue's spellings do not match), and several helpers read the log, adapter cards, and
coordination projections read-only. `surface:no_authority_touched` is a textual classification;
AP1 pins the spelling level it actually checked (no recorder, no append/mapEvent/recordDriver, no
non-optional coordination mutator access, no adapter verb calls, no child_process) and names the
read-only contact in prose.

## 3. Evidence

- `AP1`–`AP4` green: receiver discipline and the acyclic leaf law by importer enumeration; the
  46-delegate census on name, exact parameter list, pre-move arity table, plain non-async
  forwarders, and module async-ness matching the member's own; the inverse-transform residue; the
  map target with 47 surface members and `_publicHandle`'s evidence pair.
- The generation-time inverse-transform audit reconstructed all 46 pre-move member texts from the
  landed module functions token-for-token (identical, 46/46) against the slice-12 tip.
- `node impl/scripts/seam-inventory.mjs` check mode: ok (2 462 members), regenerated after the
  last source edit. `node impl/scripts/surface-gate.mjs`: ok.
- Commands run (this checkout at `28ae1bda` plus the slice; `BATON_HOST_CAPACITY_DISABLED=1` per
  this host's documented operator bypass):

```
node impl/scripts/run-suite.mjs test/runtime-api.test.mjs test/seam-inventory.test.mjs \
  test/coordinator.test.mjs test/surface-truth.test.mjs test/create-driver-wiring.test.mjs \
  test/runtime-effects.test.mjs test/runtime-observation.test.mjs \
  test/phase11-acceptance-integration.test.mjs
#   GREEN — 124 passed, 0 unexpected
npm test --prefix impl   # the canonical suite; verdict recorded with the contribution
```

## 4. What this slice does not claim

- The delegates are delegates; inlining call sites is a later slice's move.
- The coordinator is now fully bucketed: 424 members, all delegates or the seam modules' own —
  the class holds no unextracted classified bucket. The `_handleEvent` family split (the map's
  last act) and the `application-*` buckets remain, the latter pending the root's scope decision.
- The slice-8/9/10 async-delegate hop retrofit remains a separate follow-up.
