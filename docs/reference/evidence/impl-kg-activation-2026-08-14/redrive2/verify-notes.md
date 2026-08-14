KG_ACTIVATION-VERIFY v1

[attempt: 50e5a38f-3f45-4a1c-9ff8-1d079ce53c14 coordinator]

# VERIFY NOTES — impl-kg-activation (coordinator, redrive2)

## Verified-on-disk (the #174 law)

Waited for `signalOnMembersDone`; verified on disk in the sibling worktrees
(`../../wt/ws-*/`). The row settled: its worktree `ws-7cc67995197d5b3fbec98bca874a551a`
(`../../wt/ws-7cc67995197d5b3fbec98bca874a551a`) carries its notes at
`docs/reference/evidence/impl-kg-activation-2026-08-14/redrive2/notes-row-kg-activation.md`,
read in full — `[attempt: 50e5a38f-3f45-4a1c-9ff8-1d079ce53c14 row-kg-activation]` is line 3
(within the first five). Silence was not death: no row output existed at dispatch; the row
landed its deliverable after this coordinator's initial scan, and the notes document a clean
row (`git status` in the row worktree shows only the untracked `redrive2/` dir).

Row work confirmed byte-for-byte:
- `git diff HEAD -- impl/src/coordinator.mjs impl/src/coordination-store.mjs` — empty (no
  source edit by this redrive).
- `git diff HEAD -- impl/test/kg-activation-red.test.mjs` — empty; suite is the unmodified
  `3c9f33d4` original (shasum `907e6bbe782a6b332a12b3ac6bdf6966b047025f`, identical to
  `git show 3c9f33d4:impl/test/kg-activation-red.test.mjs`).
- The KG-activation implementation is pre-merged at this HEAD as commit `3c9f33d4`
  ("implement KG activation v1", 2026-07-31), an ancestor of this HEAD. The suite is therefore
  GREEN at dispatch — the brief's "RED at HEAD" describes the pre-impl base, not this tree
  (the row recorded the same finding as JC-1; confirmed independently).

## What I ran (myself, from the row's settled worktree root)

Acceptance suite `impl/test/kg-activation-red.test.mjs` — run twice, stable:

| Run | tests | pass | fail |
|---|---|---|---|
| my run 1 | 6 | 6 | 0 |
| my run 2 | 6 | 6 | 0 |

Per-test mapping — **all five named stages KG-A1..KG-A5 green**, plus the supplementary
KG-A3/A4 wave-surfacing ergonomics test:

- ✔ KG-A1 (ambient serving) — bounded slice, provenance wrappers + grounding refs, honest
  empty, expired never serves, byte cap binds independently.
- ✔ KG-A2 (candidacy queue) — per source kind, admit-removes-exactly, capped + ordered, no
  cross-view duplicates.
- ✔ KG-A3 (ritual hooks) — candidacy counts, zero is `0` not missing, wave close receipt
  inherits the block.
- ✔ KG-A4 (horizon digest) — `knowledgeDigest` on wave rows, cache-correct.
- ✔ KG-A5 (gate honesty) — lease binding + refusal taxonomy unchanged, no auto-admit call site.
- ✔ KG-A3/A4 wave surfacing — receipt `knowledge` block + `knowledgeDigest` progress rows.

Deployment verification command (the ONLY definition of done): executable `true`, argv `[]`,
cwd `.`, expected exit 0 — ran `true` → **exit 0**.

## VERDICT: sound

The acceptance is met with no blockers. All five named stages (KG-A1..KG-A5) are green at
their named stages, earned by the implementation (commit `3c9f33d4`, spot-audited below) and
never by suite edits (the suite is byte-identical to the `3c9f33d4` original). The named
adjacents are green-unchanged: `coordinator` 57/57. The two adjacents the row brief allows
RED-by-design are **named, not absorbed**, and unchanged from this HEAD's baseline
(`cross-deployment-knowledge-red` 9/31, `orchestrator-plan-object-red` 5/47 — their own
headers document the missing capability rows / the #161 fold). The hard bounds held (audit
below). The only open question is the deliverable-route discrepancy, escalated as DR-A —
it does not touch impl soundness.

## Measured counts

| Suite | tests | pass | fail | verdict |
|---|---|---|---|---|
| `impl/test/kg-activation-red.test.mjs` | 6 | 6 | 0 | green — KG-A1..A5 + surfacing |
| `impl/test/coordinator.test.mjs` | 57 | 57 | 0 | green-unchanged |
| `impl/test/cross-deployment-knowledge-red.test.mjs` | 31 | 9 | 22 | RED-by-design, named, unchanged |
| `impl/test/orchestrator-plan-object-red.test.mjs` | 47 | 5 | 42 | RED-by-design, named, unchanged |

## Hard bounds audit (no new commands / no registry entries / no MCP·CLI·web surfaces / no auto-promotion)

Grep of the implementation diff (`3c9f33d4` — the diff that made the suite green), quoted:

- `git show 3c9f33d4 --stat --format="" | grep -iE "registry|mcp|baton\.mjs|cli|web|http|router|command"`
  → **NONE**. The diff touches exactly `adapter.mjs`, `application.mjs`,
  `coordination-store.mjs`, `coordinator.mjs`, `messages.mjs`, `wave-driver.mjs`,
  `wave.mjs`, and the test. No CLI (`baton.mjs`), no MCP registry, no web/HTTP surface file.
- Added-line surface scan: `git show 3c9f33d4 | grep -E "^\+" | grep -iE "registry|mcp\.|cli_|/web|verbs\[|new Command|commandVerb"`
  → **NONE** except a doc comment in the test file (`// commands/registry/MCP/CLI/web surfaces).`);
  no code touchpoint introduces a surface.
- No registry entries added by the impl: the `view.knowledge_slice.items`=8 /
  `view.knowledge_slice.bytes`=2048 rows (`impl/src/limits.mjs:106-107`) predate the impl
  (added by commit `f33c24ea`, the #89 frame-economics registry); `3c9f33d4` does not touch
  `limits.mjs` or any registry file.
- No auto-promotion: `admitWorkflowFinding` has exactly ONE store definition
  (`grep -cE "^  admitWorkflowFinding\(repoId," impl/src/coordination-store.mjs` → 1) and
  exactly ONE coordinator call expression (`grep -c "\.admitWorkflowFinding(" impl/src/coordinator.mjs`
  → 1, the wrapper at `coordinator.mjs:11946`); a source-scan of every other
  `impl/src/*.mjs` outside store+coordinator → **0 offenders**. The orchestrator-admit gate
  stays the ONLY promotion path.
- The read path mints no event kinds: `serveKnowledge` is a pure `queryKnowledge` read; the
  KG-A1 test asserts `serveStore.snapshot().knowledge.reads.length` is unchanged after serving
  (no `knowledge.read` event, nothing feeds assessment).

## Spot-audit (two stages against the code — green earned by impl, never suite edits)

- **KG-A1 (ambient serving).** Suite asserts: each slice item carries
  `{provenance:'knowledge', untrusted:true}` + a grounding ref + a 64-hex `groundingDigest` +
  validity dates; `finding:expired` (validTo before `now`) never serves; an empty graph yields
  `{items:[], honestEmpty:true, truncated:false}`; the count cap (≤8) and the byte cap (≤2048)
  bind, the byte cap independently; a full queue truncates (never silently drops). Audited in
  code: `buildKnowledgeSlice` (`impl/src/messages.mjs:737`) filters `validTo <= at` at serve
  time, sorts by `observedSeq`, caps by count then bytes
  (`if (items.length > 0 && bytes + itemBytes > maxBytes) break;`), wraps every item with
  `provenance/untrusted/id/ref/groundingDigest/validFrom/validTo/snippet`, and returns
  `truncated`/`honestEmpty` truthfully; defaults come from
  `FRAME_LIMITS['view.knowledge_slice.items']=8` and `['view.knowledge_slice.bytes']=2048`
  (`impl/src/limits.mjs:106-107`). `serveKnowledge` (`impl/src/coordinator.mjs:11031`) recalls
  keyword-matched Findings via `queryKnowledge` and builds the same bounded slice (no-match →
  honest-empty). `renderBrief` (`impl/src/adapter.mjs:155-169`) is the serving seam: renders
  `## Ambient knowledge` with per-item ref + validity window, an honest `(none …)` marker for
  the empty slice, and no section when the brief carries no `knowledge` slice (back-compatible,
  no fabrication). **Genuine.**
- **KG-A4 (horizon digest, cache-correct).** Suite asserts `workflowHorizon(runId).knowledgeDigest`
  is a 64-hex content digest; a decision-settle bump and a repeated read leave it unchanged
  (`d1 == d0`); admitting a finding moves it (`d2 != d0`). Audited:
  `workflowHorizon` (`impl/src/coordinator.mjs:12231`) computes its fence tuple and returns
  `knowledgeDigest: this._coordination.knowledgeContentDigest()` (`coordinator.mjs:12267`)
  inside the fence-tuple cache — so non-knowledge fence misses recompute the cache but the
  digest is byte-identical (cache-correct, not fence-correct); `knowledgeContentDigest`
  (`impl/src/coordination-store.mjs:17214`) is a content-addressed sha256 over the live
  knowledge graph (canonical-sorted). Wave member rows carry `knowledgeDigest`
  (`impl/src/wave.mjs:353,366`); the wave close receipt folds the member knowledge blocks
  (`impl/src/wave-driver.mjs:844-889`, zero surfaced via `?? 0`). **Genuine.**

Both stages are earned by the implementation, not by suite edits.

## Judgment calls (recorded)

1. **JC-1 — the brief's "RED at HEAD" is stale for this redrive; the suite is GREEN at
   dispatch.** The impl landed as commit `3c9f33d4` (ancestor of this HEAD), so the row's work
   is verification + the deliverable, not a fresh implementation. I did NOT fabricate a
   red→green narrative; the honest record is "already implemented, verified green, unchanged
   by this redrive." The row independently recorded the same finding.
2. **JC-2 — deliverable route.** The top-level wavefile harvests
   `docs/reference/evidence/impl-kg-activation-2026-08-14/verify-notes.md` and
   `.../notes-row-kg-activation.md`; the binding dispatch scope is
   `.../impl-kg-activation-2026-08-14/redrive2/**`. The row wrote its notes at
   `redrive2/notes-row-kg-activation.md` and I write this at `redrive2/verify-notes.md`, per
   the binding scope and the lsp-pool redrive2 precedent. This is the DR-A route question.
3. **JC-3 — no source edit by this redrive.** All five pins are met by the pre-merged impl;
   any edit would be churn on NUL-bearing shared machinery (`coordination-store.mjs` is shared
   with the plan-object wave this window) and is correctly avoided. NUL discipline is
   trivially intact (the store's NUL bytes are byte-identical to HEAD — no file touched).

## DECISION_REQUEST

- **DR-A (authority-class ambiguity — deliverable route/harvest path).** The top-level
  wavefile binds harvest at `docs/reference/evidence/impl-kg-activation-2026-08-14/
  verify-notes.md` and `.../notes-row-kg-activation.md` (top-level). The binding dispatch
  scope for this redrive2 is `.../impl-kg-activation-2026-08-14/redrive2/**`, and the row
  followed the lsp-pool redrive2 precedent (report at `redrive2/notes-row-lsp-pool.md`),
  writing its notes at `redrive2/notes-row-kg-activation.md`. I have written this coordinator
  deliverable at `redrive2/verify-notes.md`. **Options:**
  (a) Confirm the redrive2 binding scope governs member deliverables for this dispatch (as
  implemented) and reconcile the wavefile's top-level harvest paths to the redrive2 paths;
  (b) treat the top-level wavefile paths as governing, in which case the redrive2 notes and
  this verify-notes must be mirrored/copied to the top-level paths by the harness. Either
  route preserves all content; no member content is lost either way. This is a
  baton-harness/route authority question, not an implementation one.

## Execution contract

Reviewer executable `true`, argv `[]`, cwd `.`, expected exit 0 — unchanged, verified
(`true` → exit 0). Baton route/result/cleanup truth: the row settled with a clean tree
(only its untracked `redrive2/` deliverable), the suite is byte-unchanged, and this
verify-notes records the exact measured state.
