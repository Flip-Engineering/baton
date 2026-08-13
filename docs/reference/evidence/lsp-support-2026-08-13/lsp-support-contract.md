# Issue #144 — LSP support for diagnostic scoping + environmental understanding (contract v1.0 DRAFT)

The implementation contract for issue #144 (LSP support). It specifies behavior; it does not
amend implementation in this artifact. It is a Ring-2 contract (ground truths → decisions →
refusal vocabulary → red-first acceptance → open questions). It cross-references — it does not
re-specify — the #81 orientation lane (landed), the #118 failed-verification postmortem digest
(filed), the #123 atlas fleet discovery verbs (filed), DG-1 (the diagnostics epic's digests-only
gate-cause rung), the atlas index substrate (`impl/src/atlas-index.mjs`), and the cross-harness
survey (`docs/reference/evidence/harness-inspiration-2026-08-12/cross-harness-survey.md`).

Verification HEAD: `1f71199728663a78363427119cd5818fe272e40f` ("Baton private effective-tree
snapshot"), the tree this v1.0 draft was verified against. Date: 2026-08-13.

**v1.0 DRAFT note.** This is the first draft of #144; it has NOT been red-teamed and does NOT yet
carry a fold. Every acceptance pin below is RED in this tree — the behavior it names is absent —
and the implementation makes it GREEN. The pins that reuse an existing law (`orientation_base_stale`,
the digests-only projection) are pinned preemptively: the law exists, the LSP tier that must honor
it does not.

Every `file:line` citation below was verified in this worktree with NUL-safe `grep -an` searches
and targeted `sed -n` reads. `impl/src/application.mjs` and `impl/src/coordination-store.mjs` are
NUL-bearing files; their anchors are grep/sed-verified, never whole-file reads. Sorted-key
literals are quoted in their ACTUAL source order (none are sorted claims); no `localeCompare`
ordering is used anywhere in this contract.

Scope in one sentence: **a hub-managed, lazily-started, resource-bounded LSP server pool — one
server per (repo, language), supervised under the existing process-lifecycle machinery, never
per-worker — whose compiler-class evidence feeds symbol-accurate diagnostic scoping and the #123
environmental-understanding verbs over `context.read`, under the digests-only and containment
laws, with the deployment opting in per language.**

---

## Ground truths (code-verified)

### GT1 — #144's design context is a recorded reject-and-reverse, not a blank slate

The pool's topology decision is already settled in the module dossier: baton needs *"a
hub-shared cache, not a per-agent LSP session"* (`docs/capabilities/orientation-reuse.md:30`),
with LSP/Serena precision — symbol-path addressing, `find_referencing_symbols` — as the rung-2
backend (`orientation-reuse.md:212`). The cost is honestly recorded: cross-file semantic edges
"need a live language server per language — heavy, and LSP quality is uneven" (`orientation-reuse.md:250`),
and live LSP/native SCIP is an explicit non-goal of the landed atlas epic
(`docs/reference/evidence/atlas-2026-07-31/atlas-decisions.md:170`; the representation review
still lists `'live-lsp'` under `missingStillPlanned`,
`impl/src/atlas-representation-review.mjs:36`).

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
- **The staleness frame rides every answer.** The provenance carries `overlay_applied` and
  `staleness: 'base_plus_worktree_overlay' | 'base_snapshot_only'` (`atlas-index.mjs:469`).
- **Honest-empty availability.** `availability.status === 'empty'` projects `language_ceiling:
  'honest_empty'`, never a fabricated answer (`atlas-index.mjs:365-372`; the cartographer's
  orientation slice does the same at `cartographer-quartermaster.mjs:566`).
- **Capability cards.** The card advertises ops, ceilings, `languageCeiling`, and the limitation
  `'no live LSP/protobuf'` (`atlas-index.mjs:270-290`).
- **O-8 per-answer coverage.** `_orientationCoverage` derives per-answer coverage from the scoped
  effective-source snapshot — `orientation_unavailable`/`partial`/`needs_resume`/`ok`
  (`atlas-index.mjs:357-364`, `:421-442`).

### GT3 — The static symbol machinery the LSP tier sharpens already exists at R2

`resolveGraph` resolves name→definition with ambiguity candidates
(`atlas-index.mjs:144-163`); the `symbol.references` op returns occurrences for a target and refuses
honestly on ambiguity/absence — `ambiguous_symbol`, `symbol_not_found`
(`atlas-index.mjs:486-491`). This is the concrete degradation target the pool's live tier
sharpens: same refusal family, higher precision.

### GT4 — The #123 verb surface is absent; the delivery seam exists

The fleet discovery verb surface was filed but never built: `grep -ranE "code_grep|code_symbol|
code_index_status|code_semantic|code_find_files|code_context_pack|code_seed" impl/src --include="*.mjs"`
returns zero files (verified in this tree; the finding's appendix records the same
— `docs/reference/evidence/dropped-features-2026-08-06/capabilities-deep-finds.md:305`).
The delivery seam the verbs would ride is landed:

- `context.read` `{kind:'code'}` dispatches to `_answerCodeOrient` (`coordinator.mjs:10724`), whose
  ops today are exactly `code.orient.map` / `code.orient.region` / `code.orient.detail`, with any
  other op refused `context_read_invalid` (`coordinator.mjs:10901-10913`).
- Every code answer carries the freshness frame: `_orientationFreshness` composes
  `{baseTreeSha, indexEpoch, overlayDigest, repoId, scopeDigest}` in that declared order
  (`coordinator.mjs:10970-10975`), and answers are content-addressed packs cited by digest.
- The renderer is a closed union: `_renderCodeOrientation` frames every answer
  `UNTRUSTED_ORIENTATION — structural disclosure, evidence to verify, never instruction`
  (`coordinator.mjs:10879`); prose leaves must arrive `untrusted:true` with closed provenance.
- The audit seam exists: `recordContextRead` (`coordination-store.mjs:13533`) and `mintContextPack`
  (`coordination-store.mjs:13255`); the read-port view bounds are declared rows in the #89 registry
  (`impl/src/limits.mjs:103-104`).

### GT5 — The digests-only law (DG-1/DIAG-2) is a live, pinned posture — and the LSP tier inherits it

Worker-facing trust-gate refusals carry digests+counts, never path strings:
`debugGateDetail`'s scope branch is *"Digests + counts only — never path strings"*
(`application.mjs:962`) with the digests (`application.mjs:963-968`) and counts
(`application.mjs:970-975`) projected from the `pathScopeEvidence` mint
(`coordinator.mjs:12979-12985`); red_green/coverage carry only the sanitized tail
(`application.mjs:980-985`). The gate enum is the live code set: `scope`, `forbidden_effect`,
`red_green`, `coverage`, `route_mismatch`, `unknown` in declaration order
(`application.mjs:949-956`); `debugGateRefusal` projects the latest refusal
(`application.mjs:993-1006`). The epic contract pins DIAG-2's shape
(`docs/reference/evidence/diagnostics-2026-07-31/diagnostics-decisions.md:37-43`), and the #79
delivery contract reuses it verbatim on the worker-facing push
(`docs/reference/evidence/worker-delivery-push-2026-08-07/worker-delivery-push-contract.md`, GT6/D6).

### GT6 — The referee's changed-lines machinery is textual today

The coverage pass iterates `task.changedLines` textually — for each `[filePath, lineNumbers]`, which
lines the coverage report did not execute (`impl/src/referee.mjs:298-313`). The diagnostic codes it
mints are the existing closed set (`referee.mjs:338-356`). There is no reference-based blast-radius
projection: the diff's reach is measured by line proximity, never by which symbols a changed line
defines/uses and which referencing sites they break.

### GT7 — The supervised process-lifecycle machinery the pool rides is proven

The exact lifecycle is a landed, suite-proven contract: `processStartedPayload` / `processReadyPayload`
/ `processClosedPayload` are exact closed shapes (`impl/src/process-lifecycle.mjs:273-276`,
`:302-305`, `:278-289`); owned process groups are boundedly reaped (`reapOwnedProcessGroup`,
`:99-122`), close-reap latching keeps the immutable close observation separate from transport
terminal state (`ProcessCloseReapLatch`, `:133-252`), and replay-safe recovery reaps only a
generation whose kernel start identity still matches durable authority
(`reapRecoveredProcessGroup`, `:255-265`; `processAuthorityState`, `:73-81`). The phase-51 fold
records the gate: 63/63 passing on the lifecycle gate and 1103/1103 on the canonical suite
(`docs/handoff/evidence/phase51-process-lifecycle-2026-07-13.md:57-60`), with every real-child tier
emitting one exact `lifecycle.process_started` before provider I/O and one exact
`lifecycle.process_closed` before close-derived terminal events (`:16-18`). This is the discipline
the LSP pool inherits: a server is a supervised process generation like any adapter child, never an
ad-hoc `spawn` outside the lifecycle.

### GT8 — The sanitization hook is the existing one, reused verbatim

`sanitizeVerifierDiagnosticText` is the sanctioned sanitizer (NFKC, ANSI/control stripping,
sandbox-root substitution, secret patterns, 8 KiB bounded tail —
`impl/src/verifier-diagnostics.mjs:26-63`); the failure capsule's empty case is the honest
`"[verifier produced no diagnostic output]"` (`verifier-diagnostics.mjs:71`, `:106`).
`boundedAttentionText` is the whole-text attention bound with credential-shaped redaction
(`application.mjs:334-341`), capped by the #89 registry row `view.attention_text.bytes`
(`application.mjs:59`). The LSP tier rides these verbatim — no parallel redaction path.

---

## Decisions

### D1 — The managed LSP server pool (typescript-language-server first)

One server per **(repo, language)**, lazily started on first demand, resource-bounded, supervised
under the existing process-lifecycle machinery (GT7), **never per-worker** (GT1). Servers READ the
repo — the deployment base root at the pinned epoch — never a worker worktree.

- **Keying and dedupe.** The pool holds at most one server per `(repoId, language)`. `repoId` is the
  deployment's base identity, the same one `index.build` attests (`atlas-index.mjs:460`). First
  demand for a key starts the server; concurrent demands join the same start — the single-flight
  precedent is the atlas epoch cache (`coordinator.mjs:10935-10936`) and the CAS-dedupe rule for
  the shared map (`orientation-reuse.md:133`). A second server for a live key is a refusal, not a
  spawn.
- **Workspace root is the base, never worker scope.** The server is opened against the deployment
  base root (the effective tree at the pinned epoch). A request that names a worker worktree
  refuses `lsp_workspace_scope_violation` — the per-worker dirty delta stays the atlas overlay's
  job (`atlas-index.mjs:173-187`), never a second live index.
- **Lifecycle is the existing one.** The server spawns as a detached process-group leader and emits
  one exact `lifecycle.process_started` before provider I/O, `lifecycle.process_ready` once the
  LSP `initialize`/`initialized` handshake completes, and `lifecycle.process_closed` before
  close-derived terminal events; stop confirms only after bounded group reap
  (`process-lifecycle.mjs:99-122`, `:133-252`). A wedged server is boundedly killed+reaped and
  restarted as a **new generation**; an unreapable group publishes `lsp_reap_unconfirmed` (the
  process-lifecycle refusal family) and never fakes closure. No `kill -9` outside the latch's
  bounded probe discipline (`process-lifecycle.mjs:110-121`).
- **Resource bounds are constructive, never clocks.** Two named, deployment-configurable ceilings:
  (a) max concurrent servers — a per-deployment cap derived from the deployment's resource
  ceiling (the derivation is named on the deployment card); exceeding it refuses
  `lsp_pool_capacity_exceeded` with `{cap, actual, unit}`. (b) per-server output byte bound — a
  declared row in the #89 registry (no re-declaration elsewhere), enforced before any payload
  crosses a seam. There is no time-window/TTL control anywhere in the pool.
- **Capability cards + honest-empty availability.** Each started server advertises a card in the
  capability-plane shape (`capability-registry.mjs` envelope): ops, latency class, availability,
  language, limitations. A language with no server — not opted in, or not installed — answers
  **typed-empty** with the `empty` availability and `language_ceiling: 'honest_empty'`, mirroring
  the atlas posture (GT2) — never a fabricated answer. The card's availability is per-language:
  a repo may serve `typescript` live and answer `python` typed-empty in the same pool.
- **The trust posture is named honestly.** LSP servers RUN the language toolchain —
  `typescript-language-server` loads project config. The pool is **dev-machine tooling**: the
  server runs under the deployment's identity, reads the repo tree, and its analysis is evidence,
  never a verdict (D4). The deployment opts in per language; an un-opted language refuses
  `lsp_language_not_opted_in` before any spawn.

### D2 — LSP-backed diagnostic scoping

A verification failure's evidence resolves **symbol-accurately**, and the referee's changed-lines
machinery gains **type-aware scoping**. The digests-only law holds on every worker-facing surface.

- **Symbol-accurate evidence.** When a pinned verification fails, the evidence capsule links the
  failing diagnostics to definitions/references by symbol path — the Serena vocabulary adopted at
  rung 2 (`orientation-reuse.md:212`; the survey's borrowing #2,
  `cross-harness-survey.md:178`). This enriches the #118 postmortem digest
  (`SYNTHESIS.md:32-35`; `capabilities-deep-finds.md:70-103`): the failing test's diagnostics
  resolve to the symbols they touch, so the reject carries *which symbols*, not just *which
  lines*.
- **Type-aware changed-lines scoping.** The referee's coverage pass (GT6) gains a reference-based
  blast-radius projection: for each changed line, the symbols it defines and the symbols it uses,
  then the referencing sites of those symbols — "what does this diff break by references, not text
  proximity." The existing textual coverage (`referee.mjs:298-313`) is unchanged; the projection is
  an ADDITIVE evidence layer computed from the pool (live) or the static index (GT3), degrading
  per the ladder in D3.
- **Digests-only law holds for worker-facing surfaces.** Compiler-class evidence projected to a
  worker-facing surface keeps the DG-1/DIAG-2 shape: digests+counts for scope-class detail,
  sanitized bounded tail for red_green/coverage-class detail (GT5). The symbol-accurate evidence
  lives in the durable evidence capsule; the worker-facing receipt never carries raw symbol
  resolutions, path strings, or unsanitized diagnostics. The #118 message-lane delivery stays the
  sanitized capsule (`capabilities-deep-finds.md:94-98`), never the raw LSP projection.

### D3 — LSP-backed environmental understanding

The #123 discovery verbs gain the LSP tier, delivered through `context.read` with the
staleness-honesty frame (GT2/GT4), and the absence cache composes.

- **Verb surface.** The `code` read kind (`coordinator.mjs:10724`) gains the LSP ops alongside the
  landed `code.orient.map/region/detail` (`coordinator.mjs:10901-10913`): `code.symbol` (definition
  lookup), `code.references`, `code.hover`, and `code.index_status` (pool card + staleness). These
  project onto the #123 fleet verb names (`code_symbol` / `code_index_status`, plus the new
  `code_references`/`code_hover` family) over the same read port, in the same closed-union
  renderer, with the same `UNTRUSTED_ORIENTATION` framing (`coordinator.mjs:10879`). A `code_grep`
  verb stays lexical — the LSP tier does not rewrite grep.
- **The degradation ladder is pinned.** Each op answers `live-LSP → static atlas → honest-empty`,
  in that order: from the pool when a server for the language exists (D1); from the static index —
  `symbol.references` / `search.lexical` / `repo.map` (`atlas-index.mjs:471-495`) — when no server
  exists; typed-empty only when neither exists. This is the survey's graceful-degradation ladder
  made baton-shaped (`cross-harness-survey.md:177`).
- **Staleness honesty rides every answer.** Every LSP answer carries the same freshness frame as the
  landed orientations: `freshnessDigest = f(baseTreeSha, indexEpoch, overlayDigest, repoId,
  scopeDigest)` in the declared composition order (`coordinator.mjs:10970-10975`). When the base
  tree moved under the pinned epoch, the answer refuses `orientation_base_stale`
  (`atlas-index.mjs:404-415`) — stale live structure is never served as fresh; the pool re-points
  to the new base (new server generation) or the static index serves. The check is content/git
  derived (`atlas-index.mjs:237-245`), never a clock.
- **The absence cache composes.** A proven-zero query — no references/hits across BOTH the pool and
  the static index — is cached keyed `{base_epoch, normalized_query}` with a `proven_zero` verdict,
  so a worker never re-probes a query the fleet already proved empty (the finding's agent-native
  add-on, `capabilities-deep-finds.md:133-136`). The cache is content-keyed by base epoch — a base
  change invalidates it by construction, never by TTL. A conflicting concurrent write refuses
  `lsp_proven_zero_conflict`.

### D4 — The honesty + containment laws

LSP-derived evidence is compiler-class (stronger than text) but **never a verdict input by itself**;
the pool is supervised and bounded; no LSP content crosses worker surfaces unsanitized; the servers
never execute project code, and the deployment opts in per language.

- **Evidence, not gates.** LSP-derived evidence feeds the evidence capsule (D2) and the
  environmental-understanding answers (D3) — it never becomes a trust-gate verdict input. The gate
  enum stays the live code set (`application.mjs:949-956`); no gate gains an LSP-derived code. The
  verdict inputs remain the pinned verification/coverage/mutation authority plus the digests-only
  scope evidence (cross-ref DG-1; `worker-delivery-push-contract.md` D6). Compiler-class evidence
  may REORDER a worker's attention; it never decides a verdict.
- **Supervised and bounded.** The pool's lifecycle is the proven process-lifecycle discipline
  (GT7). A wedged server is boundedly reaped and restarted as a new generation; an unreapable group
  publishes `lsp_reap_unconfirmed` and never fakes closure. All bounds are constructive named caps
  (D1) — no clocks, no turn/window controls.
- **No unsanitized content crosses a worker surface.** Every LSP answer rides the closed frame
  (`UNTRUSTED_ORIENTATION` or the `UNTRUSTED_READ_CONTENT` family, `coordinator.mjs:10837-10842`,
  `:10879`) and passes `boundedAttentionText` / `sanitizeVerifierDiagnosticText` verbatim (GT8).
  Raw server output never reaches a worker. Project-code docstrings and hover prose are
  repository-prose leaves: `untrusted:true`, closed provenance
  (`coordinator.mjs:10889-10893`), never spliced as instruction. A violation refuses
  `lsp_evidence_unsanitized`.
- **Never executes project code; opt-in trust posture.** LSP servers RUN the language toolchain —
  `typescript-language-server` loads project config — so the pool is named honestly as dev-machine
  tooling under the deployment's authority, outside worker sandboxes. The deployment opts in per
  language; an un-opted language refuses `lsp_language_not_opted_in` before any spawn. The card
  names the trust posture (D1) so the opt-in is an informed one.

---

## Refusal vocabulary

Codes follow the registry's snake_case family (`context_read_invalid`, `orientation_base_stale`,
`ambiguous_symbol`). New codes, per decision:

- **`lsp_language_not_opted_in`** — a language the deployment has not opted in; the pool refuses
  before any spawn (D1/D4).
- **`lsp_pool_capacity_exceeded`** — the max-concurrent-servers cap is reached; the coaching shape
  names `{cap, actual, unit}` (D1).
- **`lsp_workspace_scope_violation`** — an LSP request named a worker worktree; servers READ the
  repo (the deployment base root), never worker scope (D1).
- **`lsp_server_unavailable`** — the server is not ready (still starting, wedged, or refused
  start); the honest answer is unavailable, never a fabricated one (D1).
- **`lsp_startup_failed`** — the server process failed to reach the `initialize`/`initialized`
  handshake; the group is boundedly reaped (D1).
- **`lsp_reap_unconfirmed`** — a wedged server group could not be boundedly reaped within the
  lifecycle latch's bound; closure is never faked (D4, inherits `processReapUnconfirmedPayload`'s
  `deadline`/`permission_denied`/`probe_error` reasons, `process-lifecycle.mjs:291-300`).
- **`lsp_evidence_unsanitized`** — raw LSP content reached a worker-facing seam without the closed
  frame + sanitizer (D4).
- **`lsp_proven_zero_conflict`** — a concurrent absence-cache write conflicted on the
  `{base_epoch, normalized_query}` key (D3).
- **`orientation_base_stale`** — reused verbatim: the base tree moved under the pinned epoch; stale
  structure is never served as fresh (`atlas-index.mjs:404-415`; D3).
- **`ambiguous_symbol` / `symbol_not_found`** — reused verbatim from the static atlas
  (`atlas-index.mjs:489-490`); the live tier inherits the same honest refusals when the pool's
  resolution is ambiguous or absent (GT3, D3).
- **`context_read_invalid`** — reused verbatim: an unknown op or malformed read query
  (`coordinator.mjs:10722`, `:10910`; D3).

---

## Red-first acceptance

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
  worktree refuses `lsp_workspace_scope_violation`. RED: no pool.
- **R3** — The server rides the exact lifecycle: `lifecycle.process_started` before provider I/O,
  `lifecycle.process_ready` after the `initialize` handshake, `lifecycle.process_closed` + bounded
  group reap on stop; a wedged server is reaped and restarted as a new generation; an unreapable
  group publishes `lsp_reap_unconfirmed`. RED: no LSP server lifecycle exists.
- **R4** — Resource bounds refuse before unbounded spawn: `lsp_pool_capacity_exceeded` names
  `{cap, actual, unit}`; the cap is a deployment-configurable named ceiling with its derivation on
  the deployment card, never a clock. RED: no bounds.

### Diagnostic scoping (D2)

- **R5** — A verification failure's evidence capsule resolves the failing test's diagnostics to
  definitions/references by symbol path (compiler-class evidence) — the #118 postmortem digest
  enriched. RED: today the reject carries only the DG-1 sanitized tail and digests-only scope
  evidence; no symbol-accurate projection exists.
- **R6** — The referee's changed-lines coverage gains a reference-based blast-radius projection
  (which symbols a changed line defines/uses, which referencing sites break); the existing textual
  coverage (`referee.mjs:298-313`) is byte-unchanged and the projection is additive. RED: no
  reference-based scoping in the referee.
- **R7** — The worker-facing reject receipt stays digests+counts: compiler-class evidence never
  surfaces raw symbol resolutions, path strings, or unsanitized diagnostics on a worker-facing
  surface (the DG-1 projection is untouched). RED preemptively: no LSP evidence exists to leak.

### Environmental understanding (D3)

- **R8** — `context.read {kind:'code', op:'code.symbol' | 'code.references' | 'code.hover'}` serves
  from the pool when a server exists, degrades to the static index (`symbol.references` /
  `search.lexical` / `repo.map`) when not, and answers typed-empty when neither exists; every
  answer rides the closed `UNTRUSTED_ORIENTATION` frame and the declared freshnessDigest
  composition. RED: only `code.orient.map/region/detail` exist.
- **R9** — A base tree moved under the pinned epoch answers `orientation_base_stale` (never
  stale-as-fresh), matching the atlas gate (`atlas-index.mjs:404-415`); the pool re-points to the
  new base or the static index serves. RED: the atlas base-fresh gate exists; nothing serves LSP
  stale.
- **R10** — The absence cache composes: a proven-zero query keyed `{base_epoch, normalized_query}`
  with a `proven_zero` verdict; a second identical query is served from the cache, never re-probing
  the pool/index; a base change invalidates by construction, and a concurrent conflicting write
  refuses `lsp_proven_zero_conflict`. RED: no absence cache.

### Honesty + containment (D4)

- **R11** — No LSP content crosses a worker surface unsanitized: every answer passes the closed
  frame + `boundedAttentionText`/`sanitizeVerifierDiagnosticText` verbatim; raw server output never
  reaches a worker; hover/docstring prose is a repository-prose leaf (`untrusted:true`, closed
  provenance); a violation refuses `lsp_evidence_unsanitized`. RED: no LSP content exists.
- **R12** — LSP-derived evidence is never a verdict input: the gate enum stays the live code set
  (`application.mjs:949-956`), no gate gains an LSP-derived code; verdict inputs remain the pinned
  verification/coverage/mutation + digests-only authority. RED preemptively: no LSP evidence exists
  to gate with.
- **R13** — The pool never starts a server for a language not opted in by the deployment
  (`lsp_language_not_opted_in` before any spawn); `typescript-language-server` is the first server
  and its card names the config-loading trust posture honestly. RED: no pool, no opt-in gate.

---

## Open questions (for the red team)

- **OQ1 — The LSP op naming.** The read-kind ops are proposed as `code.symbol` / `code.references`
  / `code.hover` / `code.index_status` alongside the landed `code.orient.*`
  (`coordinator.mjs:10901-10913`); the #123 fleet verb names (`code_symbol`/`code_index_status`)
  are the projected surface. Whether the ops keep the `code.orient.*` family or take a sibling
  family is a fold decision — the read-port dispatch and the closed-union renderer are shared
  either way.
- **OQ2 — Hover/docstring projection.** Whether hover text (project-code docstrings) is projected
  as repository-prose leaves (`untrusted:true`, framed) or stripped before delivery. D4 requires
  the frame; the exact projection depth (strip vs frame) is a fold decision.
- **OQ3 — Base-move recovery.** On `orientation_base_stale`, whether the pool restarts the server
  against the new base (new generation, lazy) or refuses until the deployment re-opts the language.
  The #81 gate (GT2) suggests refuse-then-restart; the fold pins the exact transition.
- **OQ4 — The read-port byte bound.** Whether the LSP tier shares the existing `view.context_read`
  rows (`limits.mjs:103-104`) or declares its own registry row. Per #89's no-re-declare law, it is
  its own row only if the bound genuinely differs — the fold decides with a named derivation.
