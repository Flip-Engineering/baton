# #144 RED-TEAM — adversarial attack on the LSP-support contract v1.0 DRAFT

Red-team of `lsp-support-contract.md` (v1.0 DRAFT, same dir). Every citation re-verified at the
**current HEAD** (`6a4dce4415a8f1444208f779b1f477938a2e2c09`, "Baton private effective-tree
snapshot"). The contract's stated verification HEAD (`1f71199728663a78363427119cd5818fe272e40f`)
is an ancestor; `git diff --name-only 1f71199 6a4dce4` shows **zero changes under `impl/src/`** —
the machinery tree the anchors point at is byte-identical between the two commits, so every anchor
holds at the current HEAD. The two NUL-bearing files (`application.mjs`, `coordination-store.mjs`)
were read only via `grep -an` / `sed -n`, never whole-file.

Verdict: **NOT FOLD-READY** — 5 numbered blockers (§6). The contract's architecture (hub-shared,
lazily-started, never-per-worker pool; digests-only worker surfaces; evidence-not-gates; honest
trust posture) is right and matches the shipped substrate, but as drafted it contains one false
trust claim, one undefined unbounded-transition, one staleness-frame gap, one isolation leak in the
absence cache, and one internal contradiction on the worker-facing symbol projection. All are
pin-level fixes, not redesigns.

---

## 1. Citation re-verification

All cited anchors verified. Table groups by the contract's own ground truths / decisions.

### GT1 — design context (recorded reject-and-reverse)

| Citation | Verdict |
|---|---|
| `orientation-reuse.md:30` — "hub-shared cache, not a per-agent LSP session" | ✅ exact |
| `orientation-reuse.md:212` — LSP/Serena precision, symbol-path addressing, `find_referencing_symbols` as rung-2 | ✅ exact |
| `orientation-reuse.md:250` — live server "heavy, and LSP quality is uneven" | ✅ exact |
| `atlas-decisions.md:170` — live LSP/native SCIP listed among non-goals | ✅ exact |
| `atlas-representation-review.mjs:36` — `missingStillPlanned: ['live-lsp', …]` | ✅ exact |
| `cross-harness-survey.md:161-181` — §12 LSP-for-agents section | ✅ exact |
| `cross-harness-survey.md:175-179` — top-3 borrowings (write-gate+ladder, Serena vocab, Aider centrality) | ✅ exact |

### GT2 — atlas substrate (epoch + overlay + staleness + honest-empty)

| Citation | Verdict |
|---|---|
| `atlas-index.mjs:165-172` — `baseRecord` commits epoch to derived symbols/occurrences/calls | ✅ exact |
| `atlas-index.mjs:173-187` — `overlay` returns `changed`/`added`/`deleted` | ✅ exact |
| `atlas-index.mjs:237-245` — `gitTreeSha` anchors `HEAD^{tree}`, content/git-based, "never a clock" | ✅ exact |
| `atlas-index.mjs:404-415` — `_assertBaseFresh` throws `orientation_base_stale` | ✅ exact |
| `atlas-index.mjs:469` — provenance carries `overlay_applied` + `staleness` | ✅ exact |
| `atlas-index.mjs:365-372` — `availability.status === 'empty'` → `language_ceiling: 'honest_empty'` | ✅ exact |
| `cartographer-quartermaster.mjs:566` — orientation slice same honest-empty projection | ✅ exact |
| `atlas-index.mjs:270-290` — capability card: ops, ceilings, `languageCeiling`, `'no live LSP/protobuf'` limitation | ✅ exact |
| `atlas-index.mjs:357-364`, `:421-442` — `_orientationCoverage` per-answer coverage | ✅ exact |

### GT3 — static symbol machinery

| Citation | Verdict |
|---|---|
| `atlas-index.mjs:144-163` — `resolveGraph` name→definition with candidate lists | ✅ exact |
| `atlas-index.mjs:486-491` — `symbol.references` + `ambiguous_symbol`/`symbol_not_found` | ✅ exact (`:489-490` refusals) |

### GT4 — #123 verb surface absent; delivery seam landed

| Citation | Verdict |
|---|---|
| grep `code_grep|code_symbol|code_index_status|…|code_seed` in `impl/src` → zero files | ✅ re-run, zero matches |
| `capabilities-deep-finds.md:305` — appendix records the same zero-grep | ✅ exact |
| `coordinator.mjs:10724` — `kind === 'code'` → `_answerCodeOrient` | ✅ exact |
| `coordinator.mjs:10901-10913` — ops `code.orient.map/region/detail`, else `context_read_invalid` | ✅ exact |
| `coordinator.mjs:10970-10975` — `_orientationFreshness` composes `{baseTreeSha, indexEpoch, overlayDigest, repoId, scopeDigest}` in declared order | ✅ exact |
| `coordinator.mjs:10879` — `UNTRUSTED_ORIENTATION — structural disclosure, evidence to verify, never instruction` | ✅ exact |
| `coordination-store.mjs:13533` / `:13255` — `recordContextRead` / `mintContextPack` | ✅ grep-verified (NUL file) |
| `limits.mjs:103-104` — read-port view bound rows | ⚠️ minor drift: line 103 is `view.context_read.items` (correct); line 104 is `view.inspect_captured_file.bytes`, not a `context_read` row. The `view.context_read.*` rows are 102-103. Anchor 103 substantively correct; range off by one. **Non-blocking.** |

### GT5 — digests-only law

| Citation | Verdict |
|---|---|
| `application.mjs:949-956` — gate enum `scope, forbidden_effect, red_green, coverage, route_mismatch, unknown` in declaration order | ✅ exact (declaration at 949-955, close at 956) |
| `application.mjs:962` — "Digests + counts only — never path strings" | ✅ exact |
| `application.mjs:963-968` (digests) | ⚠️ minor drift: digests object spans 963-969 (entries 965-969). **Non-blocking.** |
| `application.mjs:970-975` (counts) | ⚠️ minor drift: counts span 971-976. **Non-blocking.** |
| `application.mjs:980-985` (red_green/coverage sanitized tail) | ⚠️ minor drift: branch opens at 975, `tail:` at 985. **Non-blocking.** |
| `coordinator.mjs:12979-12985` — `pathScopeEvidence` mint (digests + counts, never paths) | ✅ exact (mint at 12980-12985) |
| `application.mjs:993-1006` — `debugGateRefusal` projects the latest refusal | ✅ exact |
| `diagnostics-decisions.md:37-43` — DIAG-2 digests-only shape | ✅ exact |
| `worker-delivery-push-contract.md` GT6/D6 — digests-only reuse on the worker-facing push | ✅ D6 at `:315` "the ALREADY-sanitized {gate, detail}, never raw" |

### GT6 — referee changed-lines machinery textual

| Citation | Verdict |
|---|---|
| `referee.mjs:298-313` — textual per-`[filePath, lineNumbers]` coverage, `coverageOfChange` derived from executed lines | ✅ exact |
| `referee.mjs:338-356` — diagnostic-code closed set | ✅ exact |

### GT7 — process-lifecycle machinery

| Citation | Verdict |
|---|---|
| `process-lifecycle.mjs:273-276` / `:302-305` / `:278-289` — `processStartedPayload` / `processReadyPayload` / `processClosedPayload` closed shapes | ✅ exact |
| `process-lifecycle.mjs:99-122` — `reapOwnedProcessGroup` bounded group reap | ✅ exact |
| `process-lifecycle.mjs:133-252` — `ProcessCloseReapLatch` | ✅ exact (class opens at 133) |
| `process-lifecycle.mjs:255-265` — `reapRecoveredProcessGroup` identity-checked replay | ✅ exact |
| `process-lifecycle.mjs:73-81` — `processAuthorityState` | ✅ exact |
| `process-lifecycle.mjs:110-121` — bounded SIGKILL + probe discipline | ✅ exact |
| `phase51-process-lifecycle-2026-07-13.md:16-18` — one exact `process_started` before provider I/O, one exact `process_closed` before close-derived terminal events | ✅ exact |
| `phase51-process-lifecycle-2026-07-13.md:57-60` — 63/63 lifecycle gate, 1103/1103 canonical suite | ✅ exact |

### GT8 — sanitization hooks

| Citation | Verdict |
|---|---|
| `verifier-diagnostics.mjs:26-63` — `sanitizeVerifierDiagnosticText` (NFKC, ANSI/control strip, sandbox-root substitution, secret patterns, 8 KiB bounded tail) | ✅ exact |
| `verifier-diagnostics.mjs:71`, `:106` — `"[verifier produced no diagnostic output]"` honest-empty | ✅ exact |
| `application.mjs:334-341` — `boundedAttentionText` (credential-shaped redaction, byte bound) | ✅ exact |
| `application.mjs:59` — `MAX_ATTENTION_TEXT_BYTES` from `view.attention_text.bytes` registry row | ✅ exact |

### D1/D2/D3/D4 cross-references

| Citation | Verdict |
|---|---|
| `atlas-index.mjs:460` — `index.build` attests `repoId` | ✅ exact |
| `coordinator.mjs:10935-10936` — atlas epoch single-flight precedent (`_orientationEpochs` WeakMap) | ✅ exact |
| `orientation-reuse.md:133` — CAS-dedupe for the shared map | ✅ exact |
| `SYNTHESIS.md:32-35` — failed-verification postmortem digest | ✅ exact |
| `capabilities-deep-finds.md:70-103` — postmortem digest section | ✅ exact |
| `capabilities-deep-finds.md:94-98` — BD3 message-lane delivery | ✅ exact |
| `capabilities-deep-finds.md:133-136` — absence cache (`{base_epoch, query}` CAS row, proven-zero) | ✅ exact |
| `atlas-index.mjs:471-495` — `search.lexical`/`symbol.search`/`symbol.references`/`graph.calls`/`repo.map` | ✅ exact |
| `cross-harness-survey.md:177` — `live-LSP → SCIP index → grep` ladder | ✅ exact |
| `cross-harness-survey.md:178` — Serena borrowing #2 | ✅ exact |
| `coordinator.mjs:10837-10842` — `UNTRUSTED_READ_CONTENT` family | ✅ exact |
| `coordinator.mjs:10889-10893` — prose leaves require `untrusted:true` + closed provenance | ✅ exact |
| `coordinator.mjs:10722` / `:10910` — `context_read_invalid` | ✅ exact |
| `process-lifecycle.mjs:291-300` — `processReapUnconfirmedPayload` with `deadline`/`permission_denied`/`probe_error` | ✅ exact |

**Law checks.** No `localeCompare` anywhere in the cited `impl/` files. The sorted-key literal
`{baseTreeSha, indexEpoch, overlayDigest, repoId, scopeDigest}` matches `_orientationFreshness`'s
source order exactly. Gate-enum literal matches declaration order exactly. No clock-based staleness
machinery introduced — the only time bound anywhere in the cited machinery is the inherited
bounded kill-wait in `reapOwnedProcessGroup` (`timeoutMs`/`pollMs`/`maxAttempts`, §2 D1).

**One naming nuance (non-blocking, for OQ1).** The GT4 grep for the underscore `#123` verb surface
returns zero — correct. But the **dot** op `code.seed` already exists on the atlas card
(`atlas-index.mjs:280`) and is used by the cartographer (`cartographer-quartermaster.mjs:536,572`);
it is just **not exposed on the read port** (`_answerCodeOrient` accepts only `code.orient.*`). So
the "#123 verb surface is absent" claim is accurate for `context.read`, but the fold's op-naming
decision (OQ1) should reconcile the pre-existing `code.seed` dot-op so the new `code.symbol` /
`code.references` / `code.hover` family does not collide with it.

---

## 2. Decision verdicts

### D1 — The managed LSP server pool → **HOLE** (B1, B2; minors M1-M3)

The shape is right: one server per `(repoId, language)`, lazily started, single-flight keyed like
the atlas epoch cache, supervised under the proven lifecycle (GT7), never per-worker, base-root
reads with `lsp_workspace_scope_violation`, constructive caps, honest-empty availability, capability
cards. The lifecycle reuse is the correct inheritance — `ProcessCloseReapLatch` already latches
exact close observation, boundedly reaps, and "clears the singleflight slot before publishing its
refusal." Three holes:

- **Hole (B1) — trust posture is not honestly stated.** D4 asserts "the servers never execute
  project code," and D1's posture paragraph says the server "runs under the deployment's identity,
  reads the repo tree." But `typescript-language-server` / tsserver **does execute project-referenced
  code**: `tsconfig.json` `compilerOptions.plugins` entries are `require()`d and their factories run
  **inside the tsserver process** (the standard language-service-plugin mechanism), and `extends`
  chains pull in arbitrary tsconfig files. So a hostile project config in the base tree is code
  execution in a process running under the deployment's identity. The contract's own honesty law
  (D4: "The trust posture is named honestly") is violated **by the sentence that claims to satisfy
  it**. The "dev-machine tooling under the deployment's authority" framing is the honest one; the
  categorical "never execute project code" is false. (The survey's own cost note, cited at
  `orientation-reuse.md:250`, is about quality, not trust — the trust seam is unaddressed.)
  *Fix:* amend the posture to state that the server process may load and execute project-referenced
  toolchain plugin code (`compilerOptions.plugins`) and project config (`extends`), and pin the
  containment consequence: the pool runs under deployment authority **outside** worker sandboxes
  (already stated), with network egress bounded by the deployment card — or refuse plugin-bearing
  configs / sandbox the server. Replace "never execute project code" with an accurate clause.
- **Hole (B2) — "wedged" has no clock-free transition.** D1/R3/R4 assert "a wedged server is
  boundedly killed+reaped and restarted as a new generation," and `lsp_server_unavailable` names
  "wedged" as a state — but nothing in the contract defines how a **hung-but-alive** server (ready,
  then never answering a `textDocument/*` request) becomes "wedged." The lifecycle latch is
  close-driven: it only engages when the leader's `close` fires. A silent server never closes, so
  the pool waits forever, and the "no clocks / no TTL anywhere in the pool" law bans the obvious
  answer (a response timeout). The inherited `reapOwnedProcessGroup` time bound
  (`timeoutMs: 2000`, `pollMs: 5`, `maxAttempts: 500`) is a bounded **kill-wait**, not a
  request-wait — it cannot detect a hung server either. *Fix:* pin a **constructive** wedged
  trigger that is not a clock: a per-server outstanding-request ceiling (a named #89 registry row,
  derived from the deployment's latency class). When outstanding requests exceed the ceiling, the
  next demand refuses `lsp_server_unavailable`, and the pool reaps+restarts as a new generation —
  or the fold must explicitly amend "no clocks" to allow one named bounded request-wait with the
  derivation on the deployment card. Also pin that the **start** single-flight slot clears before
  publishing `lsp_startup_failed`, so a retry is reachable (the latch's own singleflight behavior,
  extended to the pool's start path).
- **Minors.** **(M1)** A single server opened on a huge repo is unbounded in memory/CPU — the
  max-concurrent-servers cap bounds *count*, and the per-server output byte bound bounds *egress*,
  but nothing bounds a server's own footprint. tsserver's memory is configurable
  (`tsserver.maxNodeMemory`); pin a per-server memory cap derived from the deployment ceiling, or
  name why the deployment ceiling derivation covers it. **(M2)** "Resource bounds are constructive,
  never clocks" sits awkwardly against the inherited bounded kill-wait; the fold should state that
  the "no clocks" law bans *state/scheduling* TTLs, not bounded kill-waits, so the reuse is
  unambiguously lawful. **(M3)** `lsp_workspace_scope_violation` needs a defined "worker worktree"
  classification (the pool must recognize a worker-scope path to refuse it); the red suite's R2
  fixture should pin the classifier.

### D2 — LSP-backed diagnostic scoping → **HOLE** (B5; minor M4)

Symbol-accurate evidence and additive blast-radius are the right direction and the degradation to
the static index (GT3) is real. Two problems:

- **Hole (B5, part 1) — the worker-facing symbol projection is self-contradictory.** D2 says the
  enriched #118 digest means "the reject carries *which symbols*, not just *which lines*," then says
  "the worker-facing receipt never carries raw symbol resolutions, path strings, or unsanitized
  diagnostics." The #118 postmortem digest **is** delivered to the worker via the BD3 message lane
  (`capabilities-deep-finds.md:94-98`) — that is its entire purpose. A symbol path in the Serena
  vocabulary (`Class/method`, or a path-qualified `src/components/Button.tsx::Button`) **is a path
  string**, and the sanctioned sanitizer (`sanitizeVerifierDiagnosticText`) does **not** strip
  repo-relative paths (it strips sandbox roots, home/temp paths, secrets). So the two sentences
  cannot both be true. The fold must pin which: either (a) the digest projects path-qualified symbol
  leaves through the sanitizer and the "never path strings" clause is explicitly scoped to
  **scope-class** gate detail only (which is what DG-1/DIAG-2 actually governs — `debugGateDetail`'s
  scope branch), or (b) the digest projects symbol **names + file digests** and raw paths stay in a
  non-worker durable surface. As drafted, an implementation can leak repo paths across the worker
  surface while believing it satisfies the digests-only law.
- **Hole (B5, part 2) — the blast-radius projection is not pinned as advisory-only.** R6 says the
  referee "gains a reference-based blast-radius projection" and D2 describes it as "what does this
  diff break by references, not text proximity," while also saying the textual coverage
  (`referee.mjs:298-313`) is "byte-unchanged" and the projection is "ADDITIVE." But `coverageOfChange`
  is derived **in the same function** from the changed-lines scan (`referee.mjs:313`), and the
  coverage gate mints `verification_coverage_failed` (`referee.mjs:345`). Nothing in the contract
  pins that the blast-radius projection **cannot** feed `coverageOfChange` — and if it does,
  compiler-class evidence becomes a verdict input, directly violating R12/D4 ("never a verdict
  input"). *Fix:* pin in D2/R6 that the projection is an annotation attached to the verdict
  (evidence leaf), and that `coverageOfChange` remains purely textual — the projection can reorder a
  worker's attention, never the gate.
- **Minor (M4).** The D3 degradation mapping for `code.symbol` lists `symbol.references` /
  `search.lexical` / `repo.map`, but a definition-lookup degrades naturally to `symbol.search`
  (`atlas-index.mjs:478-484`), which is absent from the ladder text. Add it.

### D3 — LSP-backed environmental understanding → **HOLE** (B3, B4; minor M5)

The verb surface, the closed-union renderer, the shared `UNTRUSTED_ORIENTATION` frame, the reuse of
`orientation_base_stale`, and the degradation ladder are all correctly anchored. The staleness
composition is where it breaks:

- **Hole (B3) — an LSP answer over a dirty base root wears a freshness frame that does not attest
  the tree the server actually read.** The server reads the **live** base-root filesystem. The
  base-fresh gate it rides (`_assertBaseFresh`, `atlas-index.mjs:404-415`) detects **committed**
  moves only — it recomputes `HEAD^{tree}`, which a dirty worktree "never moves" (that is the atlas
  design, `atlas-index.mjs:235,456`). The atlas substrate can afford that because the **overlay**
  captures the dirty delta per worker. The LSP pool has **no overlay** (base-only reads by
  construction, D1), so a dirty base root means the server serves base+deployment-dirty content
  while the freshnessDigest claims the pinned `baseTreeSha` epoch. And D1's "Servers READ the repo
  — the deployment base root at the pinned epoch — never a worker worktree" silently assumes that
  root is clean. *Fix:* pin the pool's base hygiene — either (a) the pool requires the base root to
  be a clean checkout of the pinned epoch (a dirty-drift check at server-open time, content-derived:
  e.g., a worktree digest vs the base inputs digest), or (b) LSP answers carry the base root's own
  dirty overlay digest in the freshness frame and label `staleness: 'base_plus_worktree_overlay'`
  (honest, but then the "same freshness frame as the landed orientations" claim must be amended,
  because `_orientationFreshness`'s `overlayDigest` is the worker-scoped overlay, not a base-root
  dirty digest). Option (b) still must never leak **worker** overlays into a base-scoped answer.
- **Hole (B4) — the absence cache is a cross-worker isolation leak and can go stale without a base
  change.** R10 keys proven-zero on `{base_epoch, normalized_query}` "so a worker never re-probes a
  query the fleet already proved empty." But "proven zero across BOTH the pool and the static index"
  mixes scopes: the pool is base-only, while the static-index rung applies the **querying worker's**
  overlay. Worker A's proven-zero (base + A's overlay) is then served to worker B, whose overlay may
  differ — a cross-worker overlay leak — and a base-epoch-only key is stale the moment any worktree
  delta changes without a new commit. *Fix:* key the absence cache on the **effective-view frame** —
  `{base_epoch, overlayDigest, normalized_query}` — so a delta change invalidates by construction
  (still content-derived, never TTL), and a proven-zero is only shared across workers when the
  effective views match.
- **Minor (M5).** Worker isolation in the pool itself is sound (one base-scoped server, worker
  worktrees refused), but the pool rung should carry explicit provenance that the worker overlay was
  **not** applied (e.g., `overlay_applied: false`, `staleness: 'base_snapshot_only'`), so a worker
  asking about a symbol it just created in its worktree can tell it is getting a base-only answer and
  degrade to the overlay-aware index rung. Pin this in D3's provenance clause.

### D4 — Honesty + containment → **HOLE** (B1, B2; minor M6)

Evidence-not-gates (R12), supervised-and-bounded (B2's hole), no-unsanitized-crossing (R11), and
opt-in-per-language (R13) are the right laws and match the live gate enum (`application.mjs:949-956`)
— no gate gains an LSP code. The honesty law itself is where D4 fails:

- **B1** (trust posture, above) is D4's own first violation: "the servers never execute project
  code" is false for the exact server the contract ships first.
- **B2** (wedged transition, above) makes the "supervised and bounded" clause under-defined.
- **Minor (M6) — sanitizer selection is a `/` ambiguity, not a closed choice.** "Every LSP answer …
  passes `boundedAttentionText` / `sanitizeVerifierDiagnosticText` verbatim" — which sanitizer for
  which output class? Hover prose is repository prose; a hover string containing a repo path is
  redacted by `sanitizeVerifierDiagnosticText` (path sanitizers) but **not** by `boundedAttentionText`
  (credential-shaped patterns only). The containment law (R11) must be a closed mapping: prose leaves
  → `sanitizeVerifierDiagnosticText` (+ the `UNTRUSTED_ORIENTATION` frame), attention-class text →
  `boundedAttentionText`. Pin the mapping; OQ2 should decide strip-vs-frame, not which sanitizer runs.
- The opt-in boundary is mostly sound (un-opted language refuses `lsp_language_not_opted_in` before
  any spawn; `code.index_status` answers typed-empty). One ambiguity worth pinning (minor): for an
  un-opted **but index-supported** language (e.g., TS), the D3 ladder serves the static index — no
  refusal, no typed-empty. That is coherent (opt-in governs the **live tier**), but R1/R13 both
  mention "un-opted" next to typed-empty; the fold should state explicitly that typed-empty for an
  un-opted language applies only when the static index also cannot serve, and `lsp_language_not_opted_in`
  only when a demand would require the pool.

---

## 3. Refusal-vocabulary verdicts

| Code | Verdict |
|---|---|
| `lsp_language_not_opted_in` | SOUND (fires before spawn; scope per M6) |
| `lsp_pool_capacity_exceeded` | SOUND (`{cap, actual, unit}`, cap derivation named on deployment card) |
| `lsp_workspace_scope_violation` | SOUND (needs the M3 worker-worktree classifier pinned) |
| `lsp_server_unavailable` | HOLE — "wedged" has no clock-free transition (B2); reason set not closed (unlike `lsp_reap_unconfirmed`'s inherited `deadline`/`permission_denied`/`probe_error`) |
| `lsp_startup_failed` | SOUND, but needs the start single-flight slot to clear so retry is reachable (B2 fix) |
| `lsp_reap_unconfirmed` | SOUND (inherits the closed reason set, `process-lifecycle.mjs:291-300`) |
| `lsp_evidence_unsanitized` | SOUND (needs the M6 sanitizer mapping pinned to be enforceable) |
| `lsp_proven_zero_conflict` | SOUND |
| `orientation_base_stale` (reused) | SOUND for committed moves; **insufficient** for dirty-base-root drift (B3) |
| `ambiguous_symbol` / `symbol_not_found` (reused) | SOUND |
| `context_read_invalid` (reused) | SOUND |

---

## 4. Acceptance-pin verdicts (R1–R13)

| Pin | Verdict |
|---|---|
| R1 — typed-empty for no-server language | SOUND as framed |
| R2 — one server per key, single-flight, worker-worktree refusal | SOUND; needs M3 classifier + start-slot-clear (B2 fix) |
| R3 — exact lifecycle, wedged reap+restart, `lsp_reap_unconfirmed` | HOLE — wedged detection undefined (B2) |
| R4 — constructive caps, `{cap, actual, unit}`, never a clock | SOUND as framed; note M2 (kill-wait vs no-clocks scope) and M1 (per-server memory) |
| R5 — evidence capsule resolves diagnostics to symbols | HOLE — worker-surface projection self-contradictory (B5 part 1) |
| R6 — additive reference-based blast-radius, textual coverage byte-unchanged | HOLE — not pinned as advisory-only; could feed `coverageOfChange` (B5 part 2) |
| R7 — worker-facing reject stays digests+counts | HOLE — inherits B5 part 1 |
| R8 — pool→index→typed-empty ladder, closed frame + freshnessDigest | SOUND as framed; M4 (`symbol.search`) + M5 (explicit base-only provenance) |
| R9 — `orientation_base_stale` on base move | HOLE — committed-move-only; dirty drift undetected (B3) |
| R10 — absence cache keyed `{base_epoch, normalized_query}` | HOLE — cross-worker overlay leak + delta-stale without base change (B4) |
| R11 — no unsanitized crossing | SOUND intent; M6 sanitizer mapping must be closed to be testable |
| R12 — never a verdict input, gate enum untouched | SOUND as framed; B5 part 2 is the enforcement gap |
| R13 — no spawn for un-opted language, honest card | HOLE — trust-posture card states "never execute project code," which is false (B1) |

---

## 5. Open-question verdicts

- **OQ1 — op naming.** SOUND as an open question; fold must also reconcile the pre-existing `code.seed`
  dot-op (note in §1) so the new family does not collide, and settle the dot-op → underscore-verb
  mapping (`code.symbol`→`code_symbol`, etc.).
- **OQ2 — hover/docstring projection.** SOUND as strip-vs-frame; but the **sanitizer mapping** is a
  containment-law decision (M6), not an open question — decide it in D4.
- **OQ3 — base-move recovery.** SOUND; refuse-then-restart is the right leaning. Note it interacts
  with B3 (dirty-drift is a distinct case from committed moves and needs its own transition).
- **OQ4 — read-port byte bound.** SOUND; per #89's no-re-declare law, a new row is allowed only with
  a named derivation. The `limits.mjs:103-104` range-drift note (§1) should be corrected to
  `:102-103` when this is written.

---

## 6. Final verdict — **NOT FOLD-READY**

The architecture is right and every citation verifies, but five blockers must be pinned before the
fold. Each is a pin-level fix (one sentence or one registry row), not a redesign.

1. **B1 — False trust claim (D1/D4, R13).** *What:* D4 states "the servers never execute project
   code," but the first server the contract ships, `typescript-language-server`/tsserver, executes
   project-referenced **plugin** code (`tsconfig.json` `compilerOptions.plugins` are `require`d inside
   the server process) and follows `extends` chains. *Why:* the honesty law (D4) demands the posture
   be named honestly; as drafted it encodes a false containment guarantee under the deployment's
   identity. *Fix:* replace the clause with an accurate one — the server process runs the language
   toolchain under deployment authority, may load/execute project-referenced toolchain plugin code
   and project config, never runs project application entrypoints, and is outside worker sandboxes
   with egress bounded per the deployment card (or refuse plugin configs / sandbox the server).
2. **B2 — Wedged-server transition undefined (D1/D4, R3).** *What:* "A wedged server is boundedly
   killed+reaped" has no trigger for a hung-but-alive server; the lifecycle latch is close-driven and
   the no-clocks law bans the natural timeout. *Why:* an undetected hung server is an unbounded leak
   in an otherwise-bounded pool, and `lsp_server_unavailable`/`lsp_startup_failed` name states with no
   transition into them. *Fix:* pin a constructive, clock-free wedged trigger — a per-server
   outstanding-request ceiling (named #89 row, derivation on the deployment card); on exceed, refuse
   `lsp_server_unavailable` and reap+restart as a new generation — and pin that the start single-flight
   slot clears before `lsp_startup_failed` so retry is reachable. (Alternatively, explicitly amend
   "no clocks" to allow one named bounded request-wait with a documented derivation.)
3. **B3 — Dirty-base-root staleness gap (D3, R9).** *What:* the base-fresh gate detects only
   **committed** moves (`HEAD^{tree}`), so an LSP server reading a dirty base root serves
   base+dirty content under a freshnessDigest claiming the pinned epoch. *Why:* the epoch+overlay
   staleness law (GT2) requires every answer's frame to attest the tree actually read; the pool has
   no overlay to capture the dirty delta. *Fix:* pin base hygiene — either a clean-checkout
   requirement for the pool (dirty-drift check at server-open, content-derived) or LSP answers carry
   the base root's own dirty overlay digest with `staleness: 'base_plus_worktree_overlay'` (amending
   the "same freshness frame" clause, which today implies the worker-scoped overlay).
4. **B4 — Absence cache isolation + staleness (D3, R10).** *What:* proven-zero is computed across the
   pool (base-only) **and** the static index (worker-overlay-scoped), then cached keyed on
   `{base_epoch, normalized_query}` and served to all workers. *Why:* worker A's overlay can leak into
   worker B's answer, and a base-epoch-only key is stale the moment any worktree delta changes without
   a new commit. *Fix:* key on the effective-view frame `{base_epoch, overlayDigest, normalized_query}`
   (content-derived, never TTL).
5. **B5 — D2 worker-surface contradiction + gate-input ambiguity (D2, R5/R6/R7).** *What:* "the reject
   carries *which symbols*" vs "the worker-facing receipt never carries raw symbol resolutions, path
   strings" cannot both hold for the #118 digest (which is delivered to the worker); and R6's
   blast-radius projection is not pinned as advisory-only, so it could feed `coverageOfChange` and
   become a coverage-gate input. *Why:* an implementation can leak repo paths across the worker
   surface, or let compiler-class evidence decide a verdict — both violate the contract's own laws.
   *Fix:* pin (a) the exact worker-facing symbol projection — sanitized path-qualified symbol leaves
   with the "never path strings" clause explicitly scoped to scope-class gate detail, **or** symbol
   names + file digests with raw paths confined to a non-worker surface; and (b) that the blast-radius
   projection annotates the verdict only and never sets `coverageOfChange` (which stays textual,
   `referee.mjs:313` unchanged).

**Non-blocking but should ride the fold:** citation range drift on `limits.mjs:103-104` (→ `:102-103`)
and `application.mjs:963-968/970-975/980-985` (±1-2 lines, anchors substantively correct); M1
per-server memory cap; M2 "no clocks" scoping vs the inherited kill-wait; M3 worker-worktree
classifier; M4 add `symbol.search` to the ladder; M5 explicit base-only provenance on pool answers;
M6 closed sanitizer mapping; and updating the contract's stated verification HEAD line to the current
tree (content-identical for `impl/src`, so no anchors move).
