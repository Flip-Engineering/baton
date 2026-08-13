# Issue #144 — LSP support for diagnostic scoping + environmental understanding (contract v1.1 — folded)

The folded implementation contract for issue #144. v1.1 folds the #144 red-team
(`contract-redteam.md`, same dir — **NOT FOLD-READY**, §6) into the v1.0 DRAFT
(`lsp-support-contract.md`, same dir — this fold's edit source). The red-team verdict is
preserved: the architecture (hub-shared, lazily-started, never-per-worker pool; digests-only
worker surfaces; evidence-not-gates; honest trust posture) is SOUND, every citation it verified
still verifies at the current HEAD, and each blocker was a pin-level fix, not a redesign. v1.1 is
**self-contained**: it carries the full folded contract text, not a patch. It specifies behavior;
it does not amend implementation in this artifact.

**Verification HEAD.** `74da30639c02374313918b4376a3d86cae3342f3` ("Baton private effective-tree
snapshot"), the tree this v1.1 was verified against (2026-08-13). `git diff --name-only
1f71199728663a78363427119cd5818fe272e40f 74da30639c02374313918b4376a3d86cae3342f3 -- impl/src/`
is empty — the machinery tree every anchor points at is byte-identical to the v1.0 verification
tree, so every v1.0 anchor holds. The red-team's own verification HEAD
(`6a4dce4415a8f1444208f779b1f477938a2e2c09`) is likewise an ancestor with a byte-identical
`impl/src/`. §6 carries the v1.1 re-verification ledger and the ±1–2 line corrections found on the
way. The v1.0 `verification HEAD` line is updated to the current tree.

**Fold status: FOLD-READY.** All five blockers are pinned below (§2). Every acceptance pin
(R1–R13) is RED in this tree — the behavior it names is absent — and the implementation makes it
GREEN (unchanged from v1.0). The pins that reuse an existing law (`orientation_base_stale`, the
digests-only projection, `symbol.search`) are pinned preemptively: the law exists, the LSP tier
that must honor it does not.

Every `file:line` citation in this document was re-verified at the current HEAD with NUL-safe
`grep -an` searches and targeted `sed -n` reads. `impl/src/application.mjs` and
`impl/src/coordination-store.mjs` are NUL-bearing files; their anchors are grep/sed-verified,
never whole-file reads. Sorted-key literals are quoted in their ACTUAL source order (none are
sorted claims); no `localeCompare` ordering is used anywhere in this contract.

---

## 0. Fold-map — finding → resolution → where in v1.1

| Finding | Resolution (what v1.1 pins) | Where in v1.1 |
|---|---|---|
| **B1** — false trust posture: "the servers never execute project code" | Replaced with the accurate clause: the server process runs the language toolchain under deployment authority, MAY load/execute project-referenced toolchain plugin code (`tsconfig.json` `compilerOptions.plugins`) and project config (`extends`), never runs project application entrypoints, runs outside worker sandboxes with egress bounded per the deployment card. | D1.5, D4.4, R13 |
| **B2** — wedged-server transition undefined (no clock-free trigger) | Per-server **outstanding-request ceiling**, a new #89 registry row `lsp.pool.outstanding_requests` (unit `requests`); derivation from the deployment's latency class on the deployment card. On exceed → refuse `lsp_server_unavailable` (reason `wedged`) and reap+restart as a NEW GENERATION. The start single-flight slot clears BEFORE `lsp_startup_failed` so retry is reachable (extends the `ProcessCloseReapLatch` slot-clear to the pool start path). | D1.3, D1.4, D4.2, R3, R4, §3 |
| **B3** — dirty-base-root staleness gap | **CHOSEN: clean-checkout requirement for the pool** (option a) — a content-derived dirty-drift check at server-open; a dirty base root at open refuses `lsp_server_unavailable` (reason `base_root_dirty`), never serves base+dirty under a pinned-epoch freshness claim. Why: it keeps the "same freshness frame as the landed orientations" clause unamended, makes the LSP server's reads equal to the committed epoch tree (the only content the frame attests), and avoids introducing a base-root dirty-overlay concept that could conflate with the worker-scoped `overlayDigest` in `_orientationFreshness`. | D3.3, D3.5, R9, §3 |
| **B4** — absence-cache cross-worker isolation leak + delta-stale | Absence cache keys on the **effective-view frame** `{base_epoch, overlayDigest, normalized_query}` (content-derived, never TTL). A worker A overlay-proven zero is only shared with worker B when the effective views match (same `base_epoch` AND same `overlayDigest`); the pool rung's `overlayDigest` is the base-only frame (no overlay applied), which is worker-independent. | D3.4, R10, §3 |
| **B5 (a)** — worker-facing symbol projection self-contradictory | **CHOSEN: symbol names + file digests** (option b). The worker-facing #118 digest projects symbol NAMES + file digests; raw repo paths stay confined to the durable evidence capsule and the framed read-port answers (non-worker push surface). The "never path strings" clause stays **categorical** — unscoped — across every worker-facing surface; no amendment is needed because no path string crosses one. | D2.1, D2.3, R5, R7 |
| **B5 (b)** — blast-radius projection not pinned advisory-only | The blast-radius projection **annotates the verdict only** (an evidence leaf); it never feeds `coverageOfChange`. `coverageOfChange` stays derived solely from the textual changed-lines scan (`referee.mjs:313` — verified unchanged). The projection may reorder a worker's attention, never the gate. | D2.2, D4.1, R6, R12 |
| **M1** — per-server memory footprint unbounded | A fourth named cap: per-server memory bound (deployment-card derived, e.g. `tsserver.maxNodeMemory`), constructive, never a clock. | D1.4, R4 |
| **M2** — "no clocks" vs the inherited bounded kill-wait | The "no clocks" law bans state/scheduling TTLs (turn/window controls), NOT bounded kill-waits (`reapOwnedProcessGroup` `timeoutMs`/`pollMs`/`maxAttempts`) and NOT count-derived ceilings (`lsp.pool.outstanding_requests`). The reuse is unambiguous. | D1.4, D4.2 |
| **M3** — `lsp_workspace_scope_violation` needs a worker-worktree classifier | A worker-worktree classifier is pinned: a demand naming a path under any active worker worktree (the same worktree registry the atlas overlay reads) refuses `lsp_workspace_scope_violation`. The R2 fixture pins the classifier. | D1.2, R2, §3 |
| **M4** — `symbol.search` missing from the degradation ladder | `code.symbol` definition-lookup degrades to `symbol.search` (`atlas-index.mjs:479-484`) before `search.lexical`/`repo.map`. | D3.2, R8 |
| **M5** — pool answers lack explicit base-only provenance | Pool answers carry `overlay_applied: false` and `staleness: 'base_snapshot_only'` in the provenance, so a worker asking about a worktree-created symbol can tell it is getting a base-only answer and degrade to the overlay-aware index rung. | D3.3, R8 |
| **M6** — sanitizer selection is a `/` ambiguity | Closed sanitizer mapping: repository-prose leaves (hover/docstring) → `sanitizeVerifierDiagnosticText` + the `UNTRUSTED_ORIENTATION` frame; attention-class text → `boundedAttentionText`. OQ2 decides strip-vs-frame, not which sanitizer. | D4.3, R11, OQ2 |
| **OQ1** — op naming | `code.symbol` / `code.references` / `code.hover` / `code.index_status` take a sibling family alongside the landed `code.orient.*`; dot-op → underscore-verb mapping is `.`→`_` (`code.symbol`→`code_symbol`, …). The pre-existing `code.seed` atlas dot-op (`atlas-index.mjs:280`) is reconciled: it stays an atlas/cartographer op, NOT on the `context.read` code-kind op set, so the new family does not collide and `code_seed` remains absent from the read port. | D3.1, GT4 |
| **OQ2** — hover/docstring projection | Frame, not strip: hover/docstring prose projects as repository-prose leaves (`untrusted:true`, closed provenance, `UNTRUSTED_ORIENTATION` frame) through `sanitizeVerifierDiagnosticText`. | D4.3 |
| **OQ3** — base-move recovery | Refuse-then-restart: on `orientation_base_stale` (committed move) the answer refuses and the affected server generation is reaped; the pool re-points to the new base and lazily starts a new generation on next demand. Distinct from B3 dirty-drift (a pre-open check). | D3.3, D3.5, R9 |
| **OQ4** — read-port byte bound | The LSP tier shares the existing `view.context_read.*` rows (`limits.mjs:103-104` — re-verified correct at HEAD); no new row is declared because the bound does not differ. | GT4, D3.1 |
| Citation corrections | `application.mjs:963-968/970-975/980-985` → `:964-968`/`:969-973`/`:976-982`; `phase51…:57-60` → `:55-60`; `coordinator.mjs:10879` → frame at `:10880`; `context_read_invalid` throws at `coordinator.mjs:10721`/`:10909`. `limits.mjs:103-104` is CONFIRMED correct at HEAD (the red-team's proposed `:102-103` does not hold — line 102 is `view.knowledge_slice.bytes`). | §6 |
| Verification HEAD | Updated from `1f711997…` to `74da3063…` (current tree; `impl/src/` byte-identical). | header, §6 |

---

## 1. Scope (unchanged)

**A hub-managed, lazily-started, resource-bounded LSP server pool — one server per (repo,
language), supervised under the existing process-lifecycle machinery, never per-worker — whose
compiler-class evidence feeds symbol-accurate diagnostic scoping and the #123
environmental-understanding verbs over `context.read`, under the digests-only and containment
laws, with the deployment opting in per language.**

---

## 2. Ground truths (code-verified at the current HEAD)

### GT1 — #144's design context is a recorded reject-and-reverse, not a blank slate

The pool's topology decision is already settled in the module dossier: baton needs *"a
hub-shared cache, not a per-agent LSP session"* (`docs/capabilities/orientation-reuse.md:30`),
with LSP/Serena precision — symbol-path addressing, `find_referencing_symbols` — as the rung-2
backend (`orientation-reuse.md:212`). The cost is honestly recorded: cross-file semantic edges
"need a live language server per language — heavy, and LSP quality is uneven"
(`orientation-reuse.md:250`), and live LSP/native SCIP is an explicit non-goal of the landed
atlas epic (`docs/reference/evidence/atlas-2026-07-31/atlas-decisions.md:170`; the representation
review still lists `'live-lsp'` under `missingStillPlanned`, `impl/src/atlas-representation-review.mjs:36`).

The survey's LSP-for-agents section (§12) grounds the value and the seams
(`cross-harness-survey.md:161-181`), and its top-3 LSP-adjacent borrowings name the shape:
(1) the write-gate + graceful-degradation ladder (`live-LSP → SCIP index → grep`) sourced from a
hub-shared pool and exposed via the #123 verbs; (2) Serena's symbol-tool vocabulary as the API
shape of those verbs; (3) Aider's reference-centrality as the pool's output policy
(`cross-harness-survey.md:175-179`). This contract implements that shape against baton's own laws.

### GT2 — The atlas substrate already owns the base-authority + staleness discipline the pool must ride

The landed index is the pool's static sibling and its staleness frame:

- **Epoch + per-worker overlay.** `baseRecord` commits the epoch to derived symbols/occurrences/calls
  as well as source (`atlas-index.mjs:165-172`); `overlay` diffs a worker worktree against the base
  and returns `changed`/`added`/`deleted` (`atlas-index.mjs:173-187`).
- **Base authority is the immutable git object tree.** `gitTreeSha` anchors `HEAD^{tree}` so a dirty
  worktree never moves the base (`atlas-index.mjs:237-245`); `_assertBaseFresh` refuses
  `orientation_base_stale` when the base tree moved under the pinned epoch (`atlas-index.mjs:404-415`).
  The gate recomputes `HEAD^{tree}` — it detects **committed** moves only, which is why the pool
  needs its own base hygiene for dirty drift (D3.3, B3).
- **The staleness frame rides every answer.** The provenance carries `overlay_applied` and
  `staleness: 'base_plus_worktree_overlay' | 'base_snapshot_only'` (`atlas-index.mjs:469`).
- **Honest-empty availability.** `availability.status === 'empty'` projects `language_ceiling:
  'honest_empty'`, never a fabricated answer (`atlas-index.mjs:365-372`; the cartographer's
  orientation slice does the same at `cartographer-quartermaster.mjs:566`).
- **Capability cards.** The card advertises ops, ceilings, `languageCeiling`, and the limitation
  `'no live LSP/protobuf'` (`atlas-index.mjs:270-290`). The card also carries the pre-existing
  `code.seed` dot-op (`atlas-index.mjs:280`), reconciled in D3.1 (OQ1).
- **O-8 per-answer coverage.** `_orientationCoverage` derives per-answer coverage from the scoped
  effective-source snapshot — `orientation_unavailable`/`partial`/`needs_resume`/`ok`
  (`atlas-index.mjs:357-364`, `:421-442`).

### GT3 — The static symbol machinery the LSP tier sharpens already exists at R2

`resolveGraph` resolves name→definition with ambiguity candidates
(`atlas-index.mjs:144-163`); the `symbol.references` op returns occurrences for a target and refuses
honestly on ambiguity/absence — `ambiguous_symbol`, `symbol_not_found`
(`atlas-index.mjs:486-491`). `symbol.search` resolves a definition by name prefix
(`atlas-index.mjs:479-484`). These are the concrete degradation targets the pool's live tier
sharpens: same refusal family, higher precision.

### GT4 — The #123 verb surface is absent; the delivery seam exists

The fleet discovery verb surface was filed but never built: `grep -ranE "code_grep|code_symbol|
code_index_status|code_semantic|code_find_files|code_context_pack|code_seed" impl/src --include="*.mjs"`
returns zero files (re-verified in this tree; the finding's appendix records the same
— `docs/reference/evidence/dropped-features-2026-08-06/capabilities-deep-finds.md:305`).
The delivery seam the verbs would ride is landed:

- `context.read` `{kind:'code'}` dispatches to `_answerCodeOrient` (`coordinator.mjs:10724`), whose
  ops today are exactly `code.orient.map` / `code.orient.region` / `code.orient.detail`, with any
  other op refused `context_read_invalid` (`coordinator.mjs:10901-10913`; the refusing throw is at
  `:10909`).
- Every code answer carries the freshness frame: `_orientationFreshness` composes
  `{baseTreeSha, indexEpoch, overlayDigest, repoId, scopeDigest}` in that declared order
  (`coordinator.mjs:10970-10975`), and answers are content-addressed packs cited by digest.
- The renderer is a closed union: `_renderCodeOrientation` frames every answer
  `UNTRUSTED_ORIENTATION — structural disclosure, evidence to verify, never instruction`
  (`coordinator.mjs:10879-10880`); prose leaves must arrive `untrusted:true` with closed provenance
  (`coordinator.mjs:10889-10893`).
- The audit seam exists: `recordContextRead` (`coordination-store.mjs:13533`) and `mintContextPack`
  (`coordination-store.mjs:13255`); the read-port view bounds are the declared rows
  `view.context_read.knowledge_items` and `view.context_read.items` in the #89 registry
  (`impl/src/limits.mjs:103-104` — re-verified correct at HEAD).

### GT5 — The digests-only law (DG-1/DIAG-2) is a live, pinned posture — and the LSP tier inherits it

Worker-facing trust-gate refusals carry digests+counts, never path strings:
`debugGateDetail`'s scope branch is *"Digests + counts only — never path strings"*
(`application.mjs:962`) with the digests (`application.mjs:964-968`) and counts
(`application.mjs:969-973`) projected from the `pathScopeEvidence` mint
(`coordinator.mjs:12979-12985`); red_green/coverage carry only the sanitized bounded tail
(`application.mjs:976-982`, `tail:` at `:981`). The gate enum is the live code set: `scope`,
`forbidden_effect`, `red_green`, `coverage`, `route_mismatch`, `unknown` in declaration order
(`application.mjs:949-956`); `debugGateRefusal` projects the latest refusal
(`application.mjs:993-1006`). The epic contract pins DIAG-2's shape
(`docs/reference/evidence/diagnostics-2026-07-31/diagnostics-decisions.md:37-43`), and the #79
delivery contract reuses it verbatim on the worker-facing push
(`docs/reference/evidence/worker-delivery-push-2026-08-07/worker-delivery-push-contract.md`, GT6/D6 —
the "ALREADY-sanitized {gate, detail}, never raw" at `:315`).

### GT6 — The referee's changed-lines machinery is textual today

The coverage pass iterates `task.changedLines` textually — for each `[filePath, lineNumbers]`, which
lines the coverage report did not execute (`impl/src/referee.mjs:298-313`); `coverageOfChange` is
derived from the executed-lines scan at `referee.mjs:313`. The diagnostic codes it mints are the
existing closed set (`referee.mjs:341-356`, `verification_coverage_failed` at `:353`). There is no
reference-based blast-radius projection: the diff's reach is measured by line proximity, never by
which symbols a changed line defines/uses and which referencing sites they break. The blast-radius
projection v1.1 adds (D2.2) annotates the verdict; it does NOT change `referee.mjs:313` (B5b).

### GT7 — The supervised process-lifecycle machinery the pool rides is proven

The exact lifecycle is a landed, suite-proven contract: `processStartedPayload` / `processReadyPayload`
/ `processClosedPayload` are exact closed shapes (`impl/src/process-lifecycle.mjs:273-276`,
`:302-305`, `:278-289`); owned process groups are boundedly reaped (`reapOwnedProcessGroup`,
`:99-122`, with the bounded kill-wait `timeoutMs: 2000`, `pollMs: 5`, `maxAttempts: 500`),
close-reap latching keeps the immutable close observation separate from transport terminal state
(`ProcessCloseReapLatch`, `:133-252` — the latch "clears the singleflight slot before publishing
its refusal", `:128`; the slot clears in the attempt `finally`, `:245-252`), and replay-safe
recovery reaps only a generation whose kernel start identity still matches durable authority
(`reapRecoveredProcessGroup`, `:255-265`; `processAuthorityState`, `:73-81`). The phase-51 fold
records the gate: 63/63 passing on the lifecycle gate and 1103/1103 on the canonical suite
(`docs/handoff/evidence/phase51-process-lifecycle-2026-07-13.md:55-60` — the 63/63 is at `:55`,
the 1103/1103 at `:58`), with every real-child tier emitting one exact `lifecycle.process_started`
before provider I/O and one exact `lifecycle.process_closed` before close-derived terminal events
(`:16-18`). This is the discipline the LSP pool inherits: a server is a supervised process
generation like any adapter child, never an ad-hoc `spawn` outside the lifecycle.

### GT8 — The sanitization hook is the existing one, reused verbatim

`sanitizeVerifierDiagnosticText` is the sanctioned sanitizer (NFKC, ANSI/control stripping,
sandbox-root substitution, secret patterns, 8 KiB bounded tail —
`impl/src/verifier-diagnostics.mjs:26-63`); the failure capsule's empty case is the honest
`"[verifier produced no diagnostic output]"` (`verifier-diagnostics.mjs:71`, `:106`).
`sanitizeVerifierDiagnosticText` strips sandbox roots / home / temp paths and secret patterns — it
does NOT strip arbitrary repo-relative paths; the containment mapping in D4.3 (M6) says which
sanitizer runs for which output class. `boundedAttentionText` is the whole-text attention bound
with credential-shaped redaction (`application.mjs:334-341`), capped by the #89 registry row
`view.attention_text.bytes` (`application.mjs:59`). The LSP tier rides these verbatim — no
parallel redaction path.

---

## 3. Decisions (folded)

### D1 — The managed LSP server pool (typescript-language-server first)

One server per **(repo, language)**, lazily started on first demand, resource-bounded, supervised
under the existing process-lifecycle machinery (GT7), **never per-worker** (GT1). Servers READ the
repo — the deployment base root at the pinned epoch — never a worker worktree.

#### D1.1 — Keying and dedupe (unchanged)

The pool holds at most one server per `(repoId, language)`. `repoId` is the deployment's base
identity, the same one `index.build` attests (`atlas-index.mjs:460`). First demand for a key
starts the server; concurrent demands join the same start — the single-flight precedent is the
atlas epoch cache (`coordinator.mjs:10935-10936`) and the CAS-dedupe rule for the shared map
(`orientation-reuse.md:133`). A second server for a live key is a refusal, not a spawn.

#### D1.2 — Workspace root is the base, never worker scope; the worker-worktree classifier (M3)

The server is opened against the deployment base root (the effective tree at the pinned epoch). A
request that names a worker worktree refuses `lsp_workspace_scope_violation` — the per-worker dirty
delta stays the atlas overlay's job (`atlas-index.mjs:173-187`), never a second live index. The
worker-worktree classification is a pinned predicate (M3): a path is a worker-scope path when it
falls under any **active worker worktree root** in the pool's worktree registry — the same registry
the atlas overlay reads (`ctx.worktreeRoot`). A demand whose requested path matches a worker-scope
path — or that resolves, by symlink or relative traversal, into one — refuses
`lsp_workspace_scope_violation` before any provider I/O. The R2 fixture pins the classifier with a
worker worktree path and a base path that differ only by that classification.

#### D1.3 — Lifecycle is the existing one, plus the clock-free wedged trigger (B2)

The server spawns as a detached process-group leader and emits one exact `lifecycle.process_started`
before provider I/O, `lifecycle.process_ready` once the LSP `initialize`/`initialized` handshake
completes, and `lifecycle.process_closed` before close-derived terminal events; stop confirms only
after bounded group reap (`process-lifecycle.mjs:99-122`, `:133-252`). No `kill -9` outside the
latch's bounded probe discipline (`process-lifecycle.mjs:110-121`).

**A wedged server is a defined, clock-free state (B2).** A server is `wedged` when its
**outstanding-request count exceeds the per-server ceiling** — the pool's constructive trigger,
never a wall-clock timeout. The ceiling is a new #89 registry row, `lsp.pool.outstanding_requests`
(class `lsp`, unit `requests`), derived on the deployment card from the deployment's latency class
(the same latency-class concept the capability card carries, e.g. `latency_class: 'interactive'`):
the largest number of `textDocument/*` requests a single server generation may hold outstanding
while the deployment still meets its latency-class budget. On exceed, the next demand refuses
`lsp_server_unavailable` (reason `wedged`), the pool **reaps + restarts the server as a NEW
GENERATION** (the lifecycle's reap discipline), and the demand may retry against the new
generation. A hung-but-alive server (ready, then never answering a `textDocument/*` request) thus
has a bounded transition out of the pool: outstanding requests accumulate past the ceiling and the
pool reaps. An unreapable group publishes `lsp_reap_unconfirmed` (the process-lifecycle refusal
family) and never fakes closure.

**The start single-flight slot clears before `lsp_startup_failed` (B2).** When a server fails to
reach the `initialize`/`initialized` handshake, the pool publishes `lsp_startup_failed` ONLY after
clearing its start single-flight slot — the same discipline the `ProcessCloseReapLatch` already
implements for the close path (`process-lifecycle.mjs:128`, `:245-252`), extended to the pool's
start path. A subsequent demand for the same key therefore starts a fresh single-flight attempt;
retry is always reachable, never permanently parked on a failed start.

#### D1.4 — Resource bounds are constructive, never clocks (M1, M2)

Four named, deployment-configurable ceilings — all constructive (count/byte/memory), none a
turn/window/TTL control:

(a) **max concurrent servers** — a per-deployment cap derived from the deployment's resource
ceiling (the derivation is named on the deployment card); exceeding it refuses
`lsp_pool_capacity_exceeded` with `{cap, actual, unit}`.
(b) **per-server output byte bound** — a declared row in the #89 registry (no re-declaration
elsewhere), enforced before any payload crosses a seam.
(c) **per-server outstanding-request ceiling** — the B2 wedged trigger: #89 row
`lsp.pool.outstanding_requests`, derived on the deployment card from the deployment's latency
class (D1.3). It bounds *concurrency of demand*, not elapsed time.
(d) **per-server memory bound (M1)** — the server's own footprint is bounded: a deployment-card
derived memory cap (for `typescript-language-server`/tsserver, configured via
`tsserver.maxNodeMemory`), so a single server opened on a huge repo cannot grow unbounded in memory
or CPU. The derivation (from the deployment's resource ceiling) is named on the deployment card.

The "no clocks" law is scoped explicitly (M2): it bans **state/scheduling TTLs** — time-window,
turn, and recency controls. It does NOT ban (i) the inherited bounded **kill-wait** in
`reapOwnedProcessGroup` (`timeoutMs`/`pollMs`/`maxAttempts`, `process-lifecycle.mjs:99-122`) — a
bounded reap operation, not a scheduling control — nor (ii) the constructive **count-derived**
outstanding-request ceiling (D1.3), which increments on demand and is never a timer.

#### D1.5 — Capability cards + honest-empty availability; the trust posture is named honestly (B1)

Each started server advertises a card in the capability-plane shape (`capability-registry.mjs`
envelope): ops, latency class, availability, language, limitations. A language with no server — not
opted in, or not installed — answers **typed-empty** with the `empty` availability and
`language_ceiling: 'honest_empty'`, mirroring the atlas posture (GT2) — never a fabricated answer.
The card's availability is per-language: a repo may serve `typescript` live and answer `python`
typed-empty in the same pool.

**The trust posture is named honestly (B1).** The v1.0 clause "the servers never execute project
code" is REPLACED by the accurate clause, which this contract pins everywhere the posture appears:

> The server process runs the language toolchain under deployment authority; it MAY load and
> execute project-referenced toolchain plugin code (`tsconfig.json` `compilerOptions.plugins`
> entries are `require`d inside the tsserver process) and project config (`extends` chains); it
> NEVER runs project application entrypoints; it runs outside worker sandboxes, with network egress
> bounded per the deployment card.

The pool is **dev-machine tooling** running under the deployment's identity; its analysis is
evidence, never a verdict (D4.1). The deployment opts in per language; an un-opted language refuses
`lsp_language_not_opted_in` before any spawn. The containment consequence is pinned: the pool runs
**outside** worker sandboxes (already stated) precisely because it must be allowed to load
project-referenced toolchain plugins; the deployment card bounds egress. This is the honest
statement of what `typescript-language-server` does — a hostile project config in the base tree is
code execution inside the server process, so the base hygiene pin (D3.3) and the opt-in boundary
(D4.4) carry that consequence.

### D2 — LSP-backed diagnostic scoping

A verification failure's evidence resolves **symbol-accurately**, and the referee's changed-lines
machinery gains **type-aware scoping**. The digests-only law holds on every worker-facing surface.

#### D2.1 — Symbol-accurate evidence, with the worker-facing projection pinned (B5a)

When a pinned verification fails, the evidence capsule links the failing diagnostics to
definitions/references by symbol — the Serena vocabulary adopted at rung 2 (`orientation-reuse.md:212`;
the survey's borrowing #2, `cross-harness-survey.md:178`). This enriches the #118 postmortem digest
(`SYNTHESIS.md:32-35`; `capabilities-deep-finds.md:70-103`): the failing test's diagnostics resolve
to the symbols they touch, so the reject carries *which symbols*, not just *which lines*.

**The worker-facing symbol projection is pinned (B5a).** The #118 digest is delivered to the worker
via the BD3 message lane (`capabilities-deep-finds.md:94-98`) — that is its purpose — so the v1.0
pair of sentences ("carries *which symbols*" vs. "never carries … path strings") is reconciled by
CHOICE, not by leaving both standing. v1.1 pins **symbol names + file digests**:

- The worker-facing #118 digest projects symbol **names** (the Serena `Class/method` symbol path,
  which is a symbol path, not a filesystem path) plus the **file digests** of the files that define
  them. A worker correlates a symbol to its own worktree content by matching the digest; it never
  needs a repo-relative path on the push surface.
- Raw repo-relative paths (e.g. `src/components/Button.tsx`) are confined to the **durable evidence
  capsule** (the hub-side non-worker surface) and to **framed read-port answers** (the
  `UNTRUSTED_ORIENTATION` surface, `coordinator.mjs:10879-10880`, where every leaf is evidence,
  never instruction).
- The "never path strings" clause (`application.mjs:962`) is **categorical** — it governs every
  worker-facing surface, unchanged and unscoped. Under this choice no path string crosses a
  worker-facing surface, so no scoping amendment is needed. An implementation that leaks a
  repo-relative path onto the worker-facing push/receipt/digest surface is a B5a violation, even if
  it believes it satisfies the digests-only law.

#### D2.2 — Type-aware changed-lines scoping; the blast-radius projection annotates the verdict ONLY (B5b)

The referee's coverage pass (GT6) gains a reference-based blast-radius projection: for each changed
line, the symbols it defines and the symbols it uses, then the referencing sites of those symbols —
"what does this diff break by references, not text proximity." The existing textual coverage
(`referee.mjs:298-313`) is unchanged — `coverageOfChange` remains derived solely from the
executed-lines scan (`referee.mjs:313`, byte-unchanged) — and the projection is an ADDITIVE
evidence layer computed from the pool (live) or the static index (GT3), degrading per the ladder in
D3.2.

**The projection is advisory-only (B5b).** It **annotates the verdict** — an evidence leaf attached
to the verdict's failure capsule — and **never feeds `coverageOfChange`** and never mints
`verification_coverage_failed` (`referee.mjs:353`). Compiler-class evidence can reorder a worker's
attention; it never decides the coverage gate. R6 and R12 enforce this.

#### D2.3 — Digests-only law holds for worker-facing surfaces

Compiler-class evidence projected to a worker-facing surface keeps the DG-1/DIAG-2 shape:
digests+counts for scope-class detail, sanitized bounded tail for red_green/coverage-class detail
(GT5). The symbol-accurate evidence lives in the durable evidence capsule; the worker-facing
receipt carries symbol names + file digests (D2.1), never raw symbol resolutions, path strings, or
unsanitized diagnostics. The #118 message-lane delivery stays the sanitized capsule
(`capabilities-deep-finds.md:94-98`), never the raw LSP projection.

### D3 — LSP-backed environmental understanding

The #123 discovery verbs gain the LSP tier, delivered through `context.read` with the
staleness-honesty frame (GT2/GT4), and the absence cache composes.

#### D3.1 — Verb surface, op family, and the `code.seed` reconciliation (OQ1)

The `code` read kind (`coordinator.mjs:10724`) gains the LSP ops alongside the landed
`code.orient.map/region/detail` (`coordinator.mjs:10901-10913`): `code.symbol` (definition lookup),
`code.references`, `code.hover`, and `code.index_status` (pool card + staleness). **The ops take a
sibling family** — `code.symbol` / `code.references` / `code.hover` / `code.index_status` — NOT a
`code.orient.*` subgroup (OQ1 settled). They project onto the #123 fleet verb names by the
`.`→`_` mapping (`code.symbol` → `code_symbol`, `code.references` → `code_references`,
`code.hover` → `code_hover`, `code.index_status` → `code_index_status`) over the same read port, in
the same closed-union renderer, with the same `UNTRUSTED_ORIENTATION` framing
(`coordinator.mjs:10879-10880`). A `code_grep` verb stays lexical — the LSP tier does not rewrite
grep.

**The pre-existing `code.seed` dot-op is reconciled (OQ1).** `code.seed` already exists on the atlas
capability card (`atlas-index.mjs:280`) and is used by the cartographer
(`cartographer-quartermaster.mjs:536,572`); it is a lexical seed/term-ranking op, not an LSP op. It
is NOT added to the `context.read` code-kind op set, so the new family does not collide with it and
the underscore verb `code_seed` remains absent from the read port (GT4's zero-grep holds for the
read-port surface). The card's `code.seed` stays as-is on the atlas card.

**Read-port byte bound (OQ4).** The LSP tier shares the existing `view.context_read.knowledge_items`
and `view.context_read.items` rows (`limits.mjs:103-104`, re-verified at HEAD). No new #89 row is
declared: the bound does not differ for the LSP ops, so #89's no-re-declare law is satisfied.

#### D3.2 — The degradation ladder is pinned, with `symbol.search` added (M4)

Each op answers `live-LSP → static atlas → honest-empty`, in that order: from the pool when a server
for the language exists (D1); from the static index when no server exists — `symbol.references` /
`search.lexical` / `repo.map` (`atlas-index.mjs:471-495`), with **`code.symbol` definition-lookup
degrading to `symbol.search`** (`atlas-index.mjs:479-484`) before `search.lexical` — typed-empty
only when neither exists. This is the survey's graceful-degradation ladder made baton-shaped
(`cross-harness-survey.md:177`).

#### D3.3 — Staleness honesty rides every answer; base hygiene is a clean-checkout requirement (B3)

Every LSP answer carries the same freshness frame as the landed orientations: `freshnessDigest =
f(baseTreeSha, indexEpoch, overlayDigest, repoId, scopeDigest)` in the declared composition order
(`coordinator.mjs:10970-10975`). When the base tree moved under the pinned epoch, the answer refuses
`orientation_base_stale` (`atlas-index.mjs:404-415`) — stale live structure is never served as
fresh. The check is content/git derived (`atlas-index.mjs:237-245`), never a clock.

**Base hygiene is a clean-checkout requirement (B3, CHOSEN option a).** The base-fresh gate detects
**committed** moves only (it recomputes `HEAD^{tree}`, which a dirty worktree "never moves" —
`atlas-index.mjs:235,456`). The atlas substrate can afford that because its **overlay** captures the
dirty delta per worker; the LSP pool has no overlay (base-only reads by construction, D1), so a
dirty base root would make the server serve base+deployment-dirty content under a freshnessDigest
claiming the pinned epoch. v1.1 pins: **the pool requires the base root to be a clean checkout of
the pinned epoch**, enforced by a **content-derived dirty-drift check at server-open** — a worktree
digest of the base root vs. the base inputs digest at the pinned epoch. A dirty base root at
server-open refuses `lsp_server_unavailable` (reason `base_root_dirty`); the pool never opens a
server whose read view the freshness frame does not attest. The static-index rung is unaffected (its
own `_assertBaseFresh` handles committed moves; its per-worker overlay handles worker dirty).

*Why this choice over option b (answers carry the base root's own dirty overlay digest with
`staleness: 'base_plus_worktree_overlay'`):* (1) it keeps the "same freshness frame as the landed
orientations" clause **unamended** — the pool's answers ride the exact `_orientationFreshness`
composition, because `_orientationFreshness`'s `overlayDigest` is the worker-scoped overlay, not a
base-root dirty digest, and mixing the two would break the frame's meaning; (2) it makes the LSP
server's reads **equal to the committed epoch tree** — the only content the frame attests — so no
LSP answer can silently cover content the freshness claim excludes; (3) it avoids introducing a
base-root dirty-overlay concept that could be conflated with — or accidentally carry — a worker
overlay into a base-scoped answer. The deployment base root is a deployment-owned, read-only input
to the pool; requiring it clean is a deployment-hygiene constraint the deployment can and should
satisfy.

**Pool answers carry explicit base-only provenance (M5).** Every pool answer's provenance carries
`overlay_applied: false` and `staleness: 'base_snapshot_only'` — mirroring the atlas provenance
(`atlas-index.mjs:469`) — so a worker asking about a symbol it just created in its worktree can tell
it is getting a base-only answer and degrade to the overlay-aware index rung.

#### D3.4 — The absence cache keys on the effective-view frame (B4)

A proven-zero query — no references/hits across BOTH the pool and the static index — is cached with
a `proven_zero` verdict, so a worker never re-probes a query the fleet already proved empty (the
finding's agent-native add-on, `capabilities-deep-finds.md:133-136`). **The key is the
effective-view frame `{base_epoch, overlayDigest, normalized_query}`** (B4) — content-derived,
never TTL:

- `base_epoch` is the pinned base epoch.
- `overlayDigest` is the overlay digest of the effective view that produced the proven-zero: the
  querying worker's `overlay.digest` for the static-index rung (`atlas-index.mjs:469`), or the
  **base-only frame** (no overlay applied — the pool rung's `overlayDigest` is the absent-overlay
  value) for a pool-rung proven-zero.
- `normalized_query` is the normalized read query.

A proven-zero is therefore shared across workers **only when the effective views match** — same
`base_epoch` AND same `overlayDigest`. Worker A's overlay-proven zero (base + A's delta) can never
serve worker B (whose delta may differ), and any worktree-delta change invalidates by construction
(a different `overlayDigest` → a different key), with no TTL needed. A base change invalidates by
construction via `base_epoch`. A conflicting concurrent write on the same effective-view key refuses
`lsp_proven_zero_conflict`.

#### D3.5 — Base-move recovery is refuse-then-restart (OQ3)

On `orientation_base_stale` (a committed base move), the answer refuses, the affected server
generation is reaped, and the pool **re-points to the new base** — a new server generation is
started lazily on next demand (refuse-then-restart, per the #81 gate's leaning). Dirty-drift is a
distinct case (D3.3): it is refused at server-open, before any generation exists, and never produces
an `orientation_base_stale` claim because the server was never opened against the dirty root.

### D4 — The honesty + containment laws

LSP-derived evidence is compiler-class (stronger than text) but **never a verdict input by itself**;
the pool is supervised and bounded; no LSP content crosses worker surfaces unsanitized; the trust
posture is honest and the deployment opts in per language.

#### D4.1 — Evidence, not gates

LSP-derived evidence feeds the evidence capsule (D2) and the environmental-understanding answers
(D3) — it never becomes a trust-gate verdict input. The gate enum stays the live code set
(`application.mjs:949-956`); no gate gains an LSP-derived code. The verdict inputs remain the pinned
verification/coverage/mutation authority plus the digests-only scope evidence (cross-ref DG-1;
`worker-delivery-push-contract.md` D6). Compiler-class evidence may REORDER a worker's attention; it
never decides a verdict. **The blast-radius projection annotates the verdict only and never feeds
`coverageOfChange` (B5b)** — this is the enforcement gap R12 closes.

#### D4.2 — Supervised and bounded; the wedged transition is defined (B2)

The pool's lifecycle is the proven process-lifecycle discipline (GT7). A wedged server is a defined,
clock-free state — its outstanding requests exceed the per-server ceiling `lsp.pool.outstanding_requests`
(#89 row, D1.3) — at which point the next demand refuses `lsp_server_unavailable` and the pool
reaps+restarts the server as a NEW GENERATION; an unreapable group publishes `lsp_reap_unconfirmed`
and never fakes closure. All bounds are constructive named caps (D1.4) — count, byte, memory; no
clocks, no turn/window controls (M2 scopes the law: the inherited bounded kill-wait and the
count-derived ceiling are not clocks).

#### D4.3 — No unsanitized content crosses a worker surface; the sanitizer mapping is closed (M6)

Every LSP answer rides the closed frame (`UNTRUSTED_ORIENTATION` or the `UNTRUSTED_READ_CONTENT`
family, `coordinator.mjs:10826-10843`, `:10879-10880`) and passes the sanitizer for its output
class (M6 closes the mapping):

| Output class | Sanitizer | Frame |
|---|---|---|
| Repository-prose leaves (hover text, docstrings) | `sanitizeVerifierDiagnosticText` (`verifier-diagnostics.mjs:26-63`) | `UNTRUSTED_ORIENTATION` |
| Attention-class text (whole-text attention-bound strings) | `boundedAttentionText` (`application.mjs:334-341`) | the closed frame |
| Scope-class gate detail | digests+counts, never paths (DG-1/DIAG-2, GT5) | `{gate, detail}` |
| red_green/coverage-class detail | sanitized bounded tail (`application.mjs:976-982`) | `{gate, detail}` |

Raw server output never reaches a worker. Hover/docstring prose is a **repository-prose leaf**:
projected as `untrusted:true`, closed provenance (`coordinator.mjs:10889-10893`), framed
`UNTRUSTED_ORIENTATION`, sanitized with `sanitizeVerifierDiagnosticText` — never spliced as
instruction (OQ2 settled: **frame, not strip**). A violation refuses `lsp_evidence_unsanitized`.

#### D4.4 — Honest trust posture; opt-in trust boundary (B1)

The servers RUN the language toolchain — `typescript-language-server` loads project config, MAY
execute project-referenced plugin code and project config, and never runs project application
entrypoints (D1.5). The pool is named honestly as dev-machine tooling under the deployment's
authority, outside worker sandboxes, with egress bounded per the deployment card. The deployment
opts in per language; an un-opted language refuses `lsp_language_not_opted_in` before any spawn. The
card names the trust posture (D1.5) so the opt-in is an informed one.

The opt-in boundary is scoped precisely (M6 rider): **typed-empty** for an un-opted language applies
only when the static index also cannot serve; `lsp_language_not_opted_in` fires only when a demand
would require the pool. For an un-opted but index-supported language (e.g. TypeScript), the D3.2
ladder serves the static index — no refusal, no typed-empty — because opt-in governs the **live
tier**, not the static one.

---

## 4. Refusal vocabulary (folded)

Codes follow the registry's snake_case family (`context_read_invalid`, `orientation_base_stale`,
`ambiguous_symbol`). New codes, per decision:

- **`lsp_language_not_opted_in`** — a language the deployment has not opted in; the pool refuses
  before any spawn (D1.5/D4.4). Scoped: fires only when a demand would require the pool (an
  un-opted but index-supported language serves the static index instead, D4.4).
- **`lsp_pool_capacity_exceeded`** — the max-concurrent-servers cap is reached; the coaching shape
  names `{cap, actual, unit}` (D1.4a).
- **`lsp_workspace_scope_violation`** — an LSP request named a worker worktree, per the
  worker-worktree classifier (M3, D1.2); servers READ the repo (the deployment base root), never
  worker scope (D1).
- **`lsp_server_unavailable`** — the server is not ready, wedged, or refused start; the honest
  answer is unavailable, never a fabricated one (D1.3/D4.2). The reason set is **closed**:
  `starting` | `wedged` (outstanding-request ceiling exceeded, B2) | `base_root_dirty` (dirty-drift
  check at server-open, B3) | `start_refused` (pool-capacity or other refusal surfaced as
  unavailable) — each transition into the state pinned in D1.3/D3.3.
- **`lsp_startup_failed`** — the server process failed to reach the `initialize`/`initialized`
  handshake; the group is boundedly reaped, and the start single-flight slot clears BEFORE the
  refusal publishes, so retry is reachable (B2, D1.3).
- **`lsp_reap_unconfirmed`** — a wedged server group could not be boundedly reaped within the
  lifecycle latch's bound; closure is never faked (D4.2, inherits `processReapUnconfirmedPayload`'s
  `deadline`/`permission_denied`/`probe_error` reasons, `process-lifecycle.mjs:291-300`).
- **`lsp_evidence_unsanitized`** — raw LSP content reached a worker-facing seam without the closed
  frame + the mapping's sanitizer (D4.3).
- **`lsp_proven_zero_conflict`** — a concurrent absence-cache write conflicted on the
  `{base_epoch, overlayDigest, normalized_query}` effective-view key (D3.4).
- **`orientation_base_stale`** — reused verbatim: the base tree moved under the pinned epoch; stale
  structure is never served as fresh (`atlas-index.mjs:404-415`; D3.5). Covers **committed** moves;
  dirty drift is refused earlier, at server-open, via `lsp_server_unavailable` (reason
  `base_root_dirty`, B3).
- **`ambiguous_symbol` / `symbol_not_found`** — reused verbatim from the static atlas
  (`atlas-index.mjs:489-490`); the live tier inherits the same honest refusals when the pool's
  resolution is ambiguous or absent (GT3, D3.2).
- **`context_read_invalid`** — reused verbatim: an unknown op or malformed read query
  (`coordinator.mjs:10721`, `:10909`; D3.1).

---

## 5. Red-first acceptance (folded)

Each pin is RED in this tree and the implementation makes it GREEN. The new red suite is
`impl/test/issue144-lsp-pool-red.test.mjs`, deterministic, with a stubbed
`typescript-language-server` fixture (a script that answers the minimal `initialize`/
`textDocument/*` envelope) and no live providers.

### Pool (D1)

- **R1** — `code.index_status` on a language with no server (un-opted or not installed) returns the
  pool's typed-empty availability (`empty` + `honest_empty` ceiling), never a fabricated answer.
  RED: no pool; no LSP card.
- **R2** — Exactly one server per `(repo, language)`, lazily started on first demand; a concurrent
  demand joins the same start (single-flight), never a per-worker server; a request naming a worker
  worktree refuses `lsp_workspace_scope_violation` per the worker-worktree classifier (M3). RED: no
  pool.
- **R3** — The server rides the exact lifecycle: `lifecycle.process_started` before provider I/O,
  `lifecycle.process_ready` after the `initialize` handshake, `lifecycle.process_closed` + bounded
  group reap on stop; a server whose outstanding requests exceed the `lsp.pool.outstanding_requests`
  ceiling is wedged (B2): the next demand refuses `lsp_server_unavailable` (reason `wedged`) and the
  pool reaps + restarts as a NEW GENERATION; the start single-flight slot clears before
  `lsp_startup_failed`; an unreapable group publishes `lsp_reap_unconfirmed`. RED: no LSP server
  lifecycle exists.
- **R4** — Resource bounds refuse before unbounded spawn: `lsp_pool_capacity_exceeded` names
  `{cap, actual, unit}`; the caps are deployment-configurable named ceilings — max concurrent
  servers, per-server output bytes, per-server outstanding requests (#89 row, latency-class
  derivation on the deployment card), per-server memory (M1) — all constructive, never a clock
  (M2). RED: no bounds.

### Diagnostic scoping (D2)

- **R5** — A verification failure's evidence capsule resolves the failing test's diagnostics to
  definitions/references by symbol (compiler-class evidence) — the #118 postmortem digest enriched.
  The worker-facing projection is symbol NAMES + file digests; raw repo paths stay in the durable
  capsule / framed read-port surface (B5a). RED: today the reject carries only the DG-1 sanitized
  tail and digests-only scope evidence; no symbol-accurate projection exists.
- **R6** — The referee's changed-lines coverage gains a reference-based blast-radius projection
  (which symbols a changed line defines/uses, which referencing sites break); the existing textual
  coverage (`referee.mjs:298-313`) is byte-unchanged — `coverageOfChange` stays derived from the
  executed-lines scan (`referee.mjs:313`) — and the projection is additive and **annotates the
  verdict only**, never feeding `coverageOfChange` (B5b). RED: no reference-based scoping in the
  referee.
- **R7** — The worker-facing reject receipt stays digests+counts: compiler-class evidence never
  surfaces raw symbol resolutions, path strings, or unsanitized diagnostics on a worker-facing
  surface — the "never path strings" clause is categorical, and the enriched digest carries symbol
  names + file digests, never paths (B5a; the DG-1 projection is untouched). RED preemptively: no
  LSP evidence exists to leak.

### Environmental understanding (D3)

- **R8** — `context.read {kind:'code', op:'code.symbol' | 'code.references' | 'code.hover'}` serves
  from the pool when a server exists, degrades to the static index (`symbol.references` /
  `search.lexical` / `repo.map`, with `code.symbol` degrading to `symbol.search` — M4) when not, and
  answers typed-empty when neither exists; every answer rides the closed `UNTRUSTED_ORIENTATION`
  frame and the declared freshnessDigest composition, and pool answers carry `overlay_applied: false`
  + `staleness: 'base_snapshot_only'` (M5). RED: only `code.orient.map/region/detail` exist.
- **R9** — A base tree moved under the pinned epoch answers `orientation_base_stale` (never
  stale-as-fresh), matching the atlas gate (`atlas-index.mjs:404-415`); the pool re-points to the
  new base (refuse-then-restart, OQ3) or the static index serves. A dirty base root at server-open
  refuses `lsp_server_unavailable` (reason `base_root_dirty`) via the content-derived dirty-drift
  check (B3); the pool never serves base+dirty under a pinned-epoch freshness claim. RED: the atlas
  base-fresh gate exists; nothing serves LSP stale, and no dirty-drift check exists.
- **R10** — The absence cache composes: a proven-zero query keyed on the effective-view frame
  `{base_epoch, overlayDigest, normalized_query}` (B4) with a `proven_zero` verdict; a second
  identical effective-view query is served from the cache, never re-probing the pool/index; a base
  change OR a worktree-delta change invalidates by construction (never by TTL), and a concurrent
  conflicting write refuses `lsp_proven_zero_conflict`. Worker A's overlay-proven zero never serves
  worker B. RED: no absence cache.

### Honesty + containment (D4)

- **R11** — No LSP content crosses a worker surface unsanitized: every answer passes the closed
  frame + the M6-mapped sanitizer (repository-prose → `sanitizeVerifierDiagnosticText`;
  attention-class → `boundedAttentionText`); raw server output never reaches a worker; hover/docstring
  prose is a repository-prose leaf (`untrusted:true`, closed provenance); a violation refuses
  `lsp_evidence_unsanitized`. RED: no LSP content exists.
- **R12** — LSP-derived evidence is never a verdict input: the gate enum stays the live code set
  (`application.mjs:949-956`), no gate gains an LSP-derived code; verdict inputs remain the pinned
  verification/coverage/mutation + digests-only authority; the blast-radius projection annotates the
  verdict only and never feeds `coverageOfChange` (B5b). RED preemptively: no LSP evidence exists to
  gate with.
- **R13** — The pool never starts a server for a language not opted in by the deployment
  (`lsp_language_not_opted_in` before any spawn); `typescript-language-server` is the first server
  and its card names the trust posture honestly — the server process runs the toolchain under
  deployment authority, MAY load/execute project-referenced plugin code and project config, never
  runs project application entrypoints, runs outside worker sandboxes with egress bounded per the
  deployment card (B1, D1.5). RED: no pool, no opt-in gate.

---

## 6. Citation-verification ledger at the current HEAD

Re-verified at `74da30639c02374313918b4376a3d86cae3342f3` with `grep -an`/`sed -n` (NUL-safe on
`application.mjs` / `coordination-store.mjs`). `git diff --name-only 1f711997… 74da3063… --
impl/src/` is empty, so all v1.0 anchors hold; the entries below record the corrections found on
re-verification. `limits.mjs` and `phase51…` are outside `impl/src/` and were plain-grepped.

| Citation (v1.0) | Verdict at HEAD | Correction in v1.1 |
|---|---|---|
| `application.mjs:962` — "Digests + counts only — never path strings" | ✅ exact | — |
| `application.mjs:963-968` (digests) | ⚠️ ±1 | `:964-968` (digests object `{`, three entries, `}`) |
| `application.mjs:970-975` (counts) | ⚠️ ±1 | `:969-973` (counts object) |
| `application.mjs:980-985` (red_green/coverage tail) | ⚠️ ±2 | `:976-982`, `tail:` at `:981` |
| `application.mjs:949-956` — gate enum declaration order | ✅ exact (`scope`→`forbidden_effect`→`red_green`→`coverage`→`route_mismatch`→`unknown`) | — |
| `application.mjs:59` — `MAX_ATTENTION_TEXT_BYTES` | ✅ exact | — |
| `application.mjs:334-341` — `boundedAttentionText` | ✅ exact | — |
| `application.mjs:993-1006` — `debugGateRefusal` | ✅ exact | — |
| `coordinator.mjs:10724` — `_answerCodeOrient` dispatch | ✅ exact | — |
| `coordinator.mjs:10901-10913` — ops + refusal | ✅ exact; refusing throw at `:10909` | cite `:10909` for the `context_read_invalid` throw |
| `coordinator.mjs:10722` — `context_read_invalid` | ⚠️ throw at `:10721` | cite `:10721` |
| `coordinator.mjs:10970-10975` — `_orientationFreshness` | ✅ exact; literal order `{baseTreeSha, indexEpoch, overlayDigest, repoId, scopeDigest}` matches declared order | — |
| `coordinator.mjs:10879` — `UNTRUSTED_ORIENTATION` frame | ⚠️ frame string at `:10880` (function opens `:10879`) | cite `:10879-10880` |
| `coordinator.mjs:10837-10842` — `UNTRUSTED_READ_CONTENT` family | ✅ exact (family spans `:10826-10843`) | — |
| `coordinator.mjs:10889-10893` — prose leaves | ✅ exact | — |
| `coordinator.mjs:10935-10936` — atlas epoch single-flight | ✅ exact | — |
| `coordinator.mjs:12979-12985` — `pathScopeEvidence` mint | ✅ exact | — |
| `coordination-store.mjs:13533` / `:13255` — `recordContextRead` / `mintContextPack` | ✅ grep-verified (NUL file) | — |
| `referee.mjs:298-313` — textual coverage | ✅ exact; `coverageOfChange` at `:313` | — (B5b: `:313` stays byte-unchanged) |
| `referee.mjs:338-356` — diagnostic closed set | ⚠️ block opens at `:341`; `verification_coverage_failed` at `:353` | cite `:341-356` (the red-team's `:338-356` covers the mutation-block tail `:338-340`; substantively correct) |
| `limits.mjs:103-104` — `view.context_read.*` rows | ✅ **correct at HEAD** — line 102 is `view.knowledge_slice.bytes`; `view.context_read.knowledge_items` is `:103`, `view.context_read.items` is `:104` | **v1.1 keeps `:103-104`**; the red-team's proposed `:102-103` does not hold at HEAD |
| `atlas-index.mjs` GT2/GT3/GT5 anchors (`:144-163`, `:165-172`, `:173-187`, `:237-245`, `:270-290`, `:357-364`, `:365-372`, `:404-415`, `:421-442`, `:469`, `:471-495`, `:478-484`, `:486-491`, `:460`) | ✅ all exact | — |
| `atlas-index.mjs:280` — `code.seed` dot-op | ✅ exact (card op; cartographer `:536,572` use it) | OQ1 reconciliation (D3.1) |
| `cartographer-quartermaster.mjs:566` — honest-empty orientation slice | ✅ exact | — |
| `process-lifecycle.mjs` anchors (`:73-81`, `:99-122`, `:110-121`, `:128`, `:133-252`, `:255-265`, `:273-276`, `:278-289`, `:291-300`, `:302-305`) | ✅ all exact; `:128` "clears the singleflight slot before publishing its refusal"; slot clears in the attempt `finally` `:245-252` | — |
| `verifier-diagnostics.mjs:26-63`, `:71`, `:106` | ✅ exact | — |
| `phase51-process-lifecycle-2026-07-13.md:57-60` | ⚠️ 63/63 at `:55`, 1103/1103 at `:58` | cite `:55-60`; `:16-18` exact |
| `orientation-reuse.md:30,133,212,250`; `atlas-decisions.md:170`; `atlas-representation-review.mjs:36` | ✅ all exact | — |
| `cross-harness-survey.md:161-181,175-179,177,178` | ✅ all exact | — |
| `SYNTHESIS.md:32-35`; `capabilities-deep-finds.md:70-103,94-98,133-136,305` | ✅ all exact | — |
| `worker-delivery-push-contract.md:315` (D6) | ✅ exact | — |
| `diagnostics-decisions.md:37-43` (DIAG-2) | ✅ exact | — |

**Law checks.** No `localeCompare` anywhere in the cited `impl/` files. The sorted-key literal
`{baseTreeSha, indexEpoch, overlayDigest, repoId, scopeDigest}` matches `_orientationFreshness`'s
source order exactly. Gate-enum literal matches declaration order exactly. The new absence-cache key
`{base_epoch, overlayDigest, normalized_query}` is a DECLARED key order (the digest is computed over
the effective-view frame), not a sorted-key claim. No clock-based staleness machinery introduced — the
only time bound anywhere in the cited machinery is the inherited bounded kill-wait in
`reapOwnedProcessGroup` (`timeoutMs`/`pollMs`/`maxAttempts`), which M2 scopes as lawful.

---

## 7. Open questions — resolved in the fold

The v1.0 open questions are closed by this fold (each carries a short rationale):

- **OQ1 — op naming.** `code.symbol` / `code.references` / `code.hover` / `code.index_status` take a
  sibling family beside `code.orient.*` (D3.1), mapped to the #123 underscore verbs by `.`→`_`.
  The pre-existing `code.seed` atlas dot-op (`atlas-index.mjs:280`) is kept off the `context.read`
  code-kind op set, so the new family does not collide and `code_seed` stays absent from the read
  port. *Why:* the landed `code.orient.*` ops are the #81 orientation ladder; the LSP ops are a
  distinct family with a distinct (symbol-addressed) result shape, and the closed-union renderer is
  shared either way.
- **OQ2 — hover/docstring projection.** Settled as **frame, not strip** (D4.3): hover/docstring
  prose projects as repository-prose leaves through `sanitizeVerifierDiagnosticText` under the
  `UNTRUSTED_ORIENTATION` frame with closed provenance. *Why:* repository-prose leaves are the
  established discipline (`coordinator.mjs:10889-10893`), and hover text is content a worker may
  legitimately need; the frame keeps it evidence, never instruction. The sanitizer mapping is a
  containment-law decision and is closed in D4.3 (M6), not left open.
- **OQ3 — base-move recovery.** Refuse-then-restart (D3.5): on `orientation_base_stale` the answer
  refuses and the pool re-points to the new base with a lazily-started new generation. Dirty-drift is
  a distinct case (B3), refused at server-open.
- **OQ4 — read-port byte bound.** The LSP tier shares the existing `view.context_read.*` rows
  (`limits.mjs:103-104`, re-verified correct at HEAD); no new #89 row is declared because the bound
  does not differ (no-re-declare law satisfied).
