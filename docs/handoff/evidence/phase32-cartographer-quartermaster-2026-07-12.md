# Phase 32 Cartographer/Quartermaster local Rung 0 handoff — 2026-07-12

## Outcome

Cartographer/Quartermaster now ships its smallest safe local vertical as one deployment-injected
ACI capability. It reuses `AtlasCodeIndex`; it does not build a second map, scan source itself,
contact a package service, or gain verification/merge authority. There is no homelab or
project-manager runtime integration.

The public operations are:

- `orientation.slice`: bounded `brief` (`code.seed`) or `map` (`repo.map`) records focused over an
  explicit immutable Atlas epoch and optional worktree overlay;
- `reuse.internal`: an internal recommendation only when Atlas evidence projects at least one
  matching symbol, call, or lexical line; otherwise exactly `external_vet_required`; and
- shared ACI resume/reverify through direct Coordinator, authenticated web, and MCP commands.

Every transformed result commits operation, normalized query, epoch, overlay digest/staleness,
source Atlas artifact digest, typed items, and false authority into a canonical content-addressed
artifact. Source references must be exact Atlas result-root paths with matching kind, media type,
handle, digest, bytes, epoch, overlay, and staleness. Output resume/reverify similarly require the
canonical local path/schema/bytes/digest and exact operation.

## Adversarial findings closed

1. Atlas intentionally gives imported files a `0.1 × imports` ranking prior. A provisional
   Quartermaster threshold could therefore misclassify a ten-import unrelated file as internal
   reuse. The implementation now reconstructs and validates Atlas's score projection and treats
   only symbols, matching calls, or lexical lines as match evidence.
2. A path focus such as `impl/src/cartographer` was initially broadened by generic token segments
   (`impl`, `src`). Recursive self-use exposed this. Path-like focus now matches the normalized
   path exactly; free-text focus retains typed token matching.
3. Existing content-address paths were initially trusted by digest name. Writes now verify the
   occupied bytes, and resume/reverify validate the claim artifact before rerunning. Tampered or
   substituted Atlas/output artifacts refuse typed.
4. The full suite exposed an unrelated 500 ms fake-provider timing coupling in persistent-session
   identity tests. Semantic wire-mapping tests now use a 2 s test-only ceiling; dedicated timeout
   contracts remain unchanged.

## Verification

- Phase 32 focused: 7/7.
- Web/MCP/ACI/Cairn/Phase 32 focused: 57/57.
- Persistent-session focused after timing isolation: 20/20.
- Canonical owner-managed zero-quota suite: 812/812.
- `git diff --check`: clean.

The reds cover one-map epoch reuse, typed focused brief/map output, path non-broadening, internal
hit and import-prior false miss, external-vet miss with no invented package, overlay identity,
bounded resume, wrong-operation and tampered-claim reverify, source-artifact substitution,
cancellation, invalid focus/shape, ACI factory assembly, action cards, durable audit, and false
authority.

## Recursive Baton evidence

`docs/reference/evidence/phase32-cartographer-quartermaster-local-2026-07-12/` builds a real Atlas
snapshot of Baton's current worktree, injects Cartographer/Quartermaster through `createDriver()`,
and uses only the Coordinator-owned ACI boundary for query/resume/reverify. Its summary has every
check true: exact epoch, self-orientation, grounded internal reuse, runtime-nonce honest miss,
bounded resume, exact reverify, sole capability plane, 12 durable audit events, and zero workers.
The initial failed pass exposed path-focus broadening and a self-referential miss string; the
corrected rerun is the committed evidence.

No fresh Grok spend was attempted because a bounded current `grok models` check still reported
`You are not authenticated` and exposed only `grok-build`. The earlier concurrent exact
`grok-4.5`/`grok-composer-2.5-fast` kill/reap machinery remains proven, while a new semantic review
for this phase is honestly pending login. No provider identity is claimed here.

## Honest boundary and next contracts

This rung does not push addressed orientation into an active worker, detect scope drift, contact or
cache deps.dev/OSV/Socket, evaluate licenses/provenance/advisories, gate vulnerabilities by call-
graph reachability, create immutable build-vs-borrow decisions/SBOMs, or promote orientation/reuse
knowledge. Those remain explicit Phase 32+ contracts. Cairn RouteStats/Rungs 1–4, Vantage,
Evidence Ladder, Scratch Bench/REPL, Skill Forge/computer use, and the production northbound/runtime
depth also remain active; this handoff does not imply full-system completion.
