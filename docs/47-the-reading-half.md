# The reading half: a recruited seat reads its issue, its docs, its peers, and the landed work (issue #441)

A design in the house style of [39-swarm-runtime.md](39-swarm-runtime.md) — rules, not prose.
Every mechanism below ACTIVATES a primitive Baton already landed; nothing here invents a
parallel channel. The primitives and their landed state:

| primitive | where it lives | state |
|---|---|---|
| ContextPackage (REFLEX-3) | docs/32 §3.3; `coordination-store.mjs` `admitContextPackage` (:9252), `attachContextPackage` (:9337), `resolveContextPackageBranch` (:9171); `application.mjs` direct ports (:10674–10720) | landed |
| text-artifact admit into the CAS | `context-program.mjs` `StatelessContextBench.admitSource` (:686) → `_writeArtifact` (:739) (`<artifactRoot>/<digest>.json`, mode 0600, wx) | landed |
| branch read projection | `application.mjs` `projectContextPackageBranch` (:547); MCP `baton_package_read` (`mcp-northbound.mjs` :2760–2766) | landed (MCP only) |
| KG-3 activation | docs/34 §KG-3 rules 8–9: `recallPreview` (`coordination-store.mjs`), rendered at the `_providerBrief`/spawn seam (`coordinator.mjs` :4512, :4784) | landed |
| contributions fold + review state | `swarm-state.mjs` `contributions`/`reviews` collections; docs/46 §2 (`reviewState` derivation) | landed (#433, 2223154b: `contributions` projection with `reviewState`, `run.contributions.read` shares its derivation) |
| peers-now | docs/45 §6 (brief section); docs/46 §6–7 (coverage, cost rule) | peers block landed in `_composeRecruitBrief`; claims pending (#423) |
| participant bridge verbs | `swarm-contract.mjs` `SWARM_KNOWLEDGE_COMMANDS` (:158); `swarm-runtime.mjs` knowledge dispatch (:243–350); `swarm-native-access.mjs` guidance | landed for the #318 set |

## 1. The objects a recruited seat can read, and how each arrives

1. **The issue and the docs it cites — ONE ContextPackage, admitted by the root.** The root's
   CLI (the only place a `gh` credential exists, #347) reads the issue at recruit time and
   admits ONE `baton.context_package` named `issue-<n>` with branches `issue:<n>` and one doc
   branch per cited or requested doc. The doc branch's spelling derives from ONE exported
   function, `contextDocBranchName(path, sha)` (application-cli.mjs) — `doc:<path with "/" → "."
   and unsafe chars → "-">:<sha256 of the exact bytes read>` — because the store's branch-name
   grammar (`[A-Za-z0-9._:-]`, `_normalizeContextPackageBranch`) admits no `/` and no `@`; the
   issue's literal `doc:<path>@<sha>` sketch is inadmissible, and the derivation keeps the same
   information in a legal name. Branch content is a `context_source` ref
   minted by `bench.admitSource` over the JSON value `{number, title, body, labels, url}` (the
   issue branch) or `{path, sha, text}` (a doc branch) — the store's content-addressed artifact
   CAS is the only byte store, and `admitContextPackage` resolves every branch exactly once at
   admission. Provenance derives from the admission ledger event (docs/32 §3.3), never from a
   self-cited field.
2. **The package reaches the seat by attachment, not by copy.** The recruit effect attaches the
   package to the seat's run with scope `worker:<seat>` (`attachContextPackage` — a fenced O(1)
   pointer binding; it never re-reads branch bytes). The `package.attached` row IS the durable
   record; the runtime records nothing new.
3. **Landed work — the contributions projection.** Accepted contributions since the seat's base
   derive from the durable `swarm.contribution_recorded` + `swarm.contribution_reviewed` rows
   through the swarm-state fold (docs/46 §2.1: `reviewState ∈ unreviewed | accepted | rejected`,
   derived, never stored). The derivation is ONE exported function so the #433 view projection
   and the seat verb read the same rows.
4. **Peers — peers-now.** Each other seat that can act: participantId, status, route, scope
   paths, last checkpoint summary and its age, current holder rows — derived from the
   participants fold the view already composes (docs/45 §6, docs/46 §1). NEVER a workspace live
   read: docs/46 §7 binds every read path — no process spawn, no per-seat ledger scan.
5. **Project knowledge — KG-3 activation.** The issue text is the recall query: the existing
   `recallPreview` briefing projection (docs/34 §KG-3 rule 8 — non-evented, cached to the
   project-horizon fence, degrade-to-`briefingUnavailable` on any refusal ceiling) runs over the
   admitted issue text at the brief seam. The reading half names the query source; it does not
   touch the preview machinery.

## 2. The recruit brief's derived sections, in order

`_composeRecruitBrief` (swarm-runtime.mjs :2281) renders, top to bottom; each section names the
ONE row or projection it renders from and the registry row that bounds it (never a literal):

| order | section | the ONE source | byte bound |
|---|---|---|---|
| 1 | the objective | the recruiter's own words | `run.objective` |
| 2 | the held work item | the ACTIVE assignment row (#345) | — |
| 3 | `## Swarm situation` | peers, settled count, contracts, commits-since-base, route usage, parked guidance — the durable folds, as today | the existing rows |
| 4 | `## Context package` (NEW) | the recruit's `options.contextPackage.digest` resolved against the store's package record: package digest, then per branch its name, digest, byte size and the first `context_package.brief_bytes` of its text (the `issue:<n>` branch first) | `context_package.brief_bytes` per rendered branch slice; `context_package.source_bytes` per admitted branch source |
| 5 | the read-only mode block | the recruit mode (#373) | — |
| 6 | the contribution contract example | the validator's own schema (#310/#371/#373) | — |
| 7 | `## Inheritance from <seat>` | the predecessor's durable rows (#318) | — |

1. Section 4 is absent — not empty — for a recruit without `--issue`: today's hand-typed briefs
   compose byte-identically.
2. The section renders digests and a bounded head of each branch; the full text is one
   `run.package.read` away (§3). The brief never inlines a whole issue body.
3. Branch content is untrusted input to every reader: it renders through the
   `boundedAttentionText`/`SECRET_SHAPED_TEXT` discipline with untrusted-prose provenance
   marking (docs/32 §3.3 Part D / F14).

## 3. The bridge verbs a seat reads with

Three read verbs join the closed seat verb set (`SWARM_SEAT_VERB_NAMES`, swarm-native-access.mjs)
— one table row each beside the #318 knowledge verbs, so the view's `updates`, the bridge's
`--help`, and the brief's Swarm section cannot disagree. They are spelled in the `run.*`
participant namespace, NOT `swarm.*`: the brief-surface pins (swarm-brief-surface.test.mjs,
issue292-coupling-truth.test.mjs) admit only registered swarm-contract commands or event kinds
after `swarm.` in a rendered brief, so a `swarm.*` spelling could not be taught to a seat at all.
All are read-only, all bounded by the `view.seat_read.items` registry row, all refuse typed, all
admit through contract validation BEFORE any runtime effect (the #318 pattern).

| verb | answers | refuses |
|---|---|---|
| `run.package.read {packageDigest, branchName?}` | the package's branch list (name, digest, bytes), or ONE branch's text — resolved at the store through the SAME projection MCP's `baton_package_read` serves (`projectContextPackageBranch`), with the canonical `package.read` schema's field spelling; never a fork | `context_package_not_found`; `context_package_branch_not_found`; `package_not_attached_to_run` when the digest is attached to neither the caller's run nor its swarm (the attach rows are the scope check) |
| `run.contributions.read {since?}` | the caller's swarm's contribution rows with `seq > since`: `{participantId, contributionId, seq, summary, files, decision}`, in ledger order, with the review state from ONE derivation (`contributionLedgerRows` + `SWARM_REVIEW_STATES`, swarm-runtime.mjs — exported so the #433 view projection reuses it; docs/46 §2.1); no ledger scan beyond the fold (docs/46 §7) | the closed-set argument refusals — contract admission first: an OMITTED `since` reads as `0`, a supplied `since` that is not a non-negative integer refuses `swarm_command_invalid` (rule field-predicate) |
| `run.peers.read` | peers-now for the caller (§1.4), one row per other seat that can act; the caller never appears in its own answer; fold-only — zero process spawns (docs/46 §7, measured against a control) | the closed-set argument refusals |

1. The seat's token binds its identity server-side; a caller-supplied `runId`,
   `participantId`, or `swarmId` beyond the token's scope refuses as identity-shaped (the #318
   `identityFields` rule).
2. An unknown argument key refuses typed before admission — contract admission first, always.
3. These verbs READ; they wake nobody, write nothing, and appear on no wake class.
4. The peers-now derivation is ONE function (landed, #441 lane C): `_peersRead` (swarm-runtime.mjs)
   answers `run.peers.read` AND the brief's `## Swarm situation` `Peers now:` block, which renders
   each of its rows through the exported `renderPeerNowLine` — so the brief a seat is recruited
   with and the read it makes can never spell a peer line twice. The contribution counts the same
   section renders derive from the same ONE derivation §3's `run.contributions.read` row names.

## 4. `swarm recruit <swarm> <seat> <objective> --issue N [--doc PATH …]`

1. **Composition rule.** The CLI parses `--issue N` and repeated `--doc PATH` into the recruit
   spelling (the closed argv of #431 — both flags join the recruit row's admitted vocabulary and
   its usage/help row). Before the recruit is admitted, the ROOT process: reads the issue with
   `gh issue view N --json number,title,body,labels,url` through an INJECTED reader
   (`issueReader`, so tests never shell); extracts every `docs/NN-…md` citation in the issue
   body through ONE exported citation function; reads each cited and each requested doc from the
   repo at the served commit; admits ONE ContextPackage (§1.1); and recruits with
   `options.contextPackage = {digest}`. The runtime attaches (§1.2) and the brief renders (§2).
   The attach is a fenced O(1) bind through the coordination store that answers its attach
   receipt — it never reads the Run view, so the recruit's reading leg is unaffected by the
   deployment's projection ceiling (issue #489: the participant's start composes its view
   narrowed and never refuses on it).
2. **What the root still types.** The judgment paragraph — the objective. Composition derives
   the world; it never authors the decision. (`--files <globs>` — scope derivation from the
   issue's file mentions plus the #296 landing-table gates — is NOT in this wave; §9.1.)
3. **Refusals are typed pre-effect** — nothing is admitted, no seat joins:
   - `gh` missing or unauthenticated → `issue_reader_unavailable {issue, reason}`;
   - the issue not found → `issue_not_found {issue}`;
   - a `--doc` path outside the repo or unreadable → `context_doc_unreadable {path}`;
   - oversize → the registry row's own refusal (`context_package.source_bytes`,
     `context_package.brief_bytes` — derived, never literal).
4. The web transport has NO context-package route today (grep: web-northbound.mjs names none);
   the CLI reaches `application.admitContextPackage`/`attachContextPackage` through a minimal
   typed route pair that mirrors the MCP handlers (docs/32 §3.5) — the same payload shapes, the
   same refusal codes, no second semantics.

## 5. Claims instead of handovers

1. A seat that needs a file outside its path scope files a `swarm.claim_updated` path claim
   (docs/45 §2) naming the paths on its recorded checkout — one durable row, visible on every
   view and in the holder's next brief — instead of finishing with a `needsFromOthers` handover.
2. The claim refuses `swarm_claim_conflict` when another seat's ACTIVE claim overlaps on the
   same checkout, naming the holder, the holding `claimId`, and the overlapping paths; the
   holder releases or hands off in one row (docs/45 §2.2). The root accepts or refuses the
   claim; nothing is relayed by prose.
3. Finishing with a handover remains legal for work the seat cannot start; the claim is the
   spelling for work it CAN start the moment the hold lands.
4. ACTIVATED (2026-09-18, lane D) now that #422/#423's claims are landed. The mechanism, ONE
   derivation per fact: the declared recruit scope IS the seat's first claim —
   `scopeClaimId(participantId)` (`scope:<participantId>`, swarm-state.mjs), written by the
   recruit effect at bind over exactly the declared paths and bound to the seat's recorded
   checkout — so two scopes that meet are claims from the first minute; the `## Claims` block
   `_composeRecruitBrief` renders (after `## Context package`, absent for a seat with no scope
   and no claims) teaches the path-claim spelling with the example the validator's own schema
   admits (`swarm-event-schemas.mjs`, never hand-typed) and lists the seat's own claims and every
   PEER's ACTIVE path claim whose paths fall in that scope — peers being the seats that can act
   (the ONE #350 predicate the peers block already reads: a settled seat's hold rides no later
   brief, while its claim row stays durable) — naming the holder and the checkout;
   the fold's ONE `claimConflictFor` refuses `swarm_claim_conflict` (holder, holding `claimId`,
   overlapping paths) for a hold that overlaps another seat's ACTIVE claim on the same recorded
   checkout. A SCOPE claim is visibility, never a fence: scopes overlap legally (docs/45 §2), so
   a scope claim is neither judged by the conflict rule nor a conflict source for a peer's hold —
   a recruit whose scope meets an active claim is admitted and its brief names the overlap; the
   `scope:` namespace is reserved to that row (a claim id wearing another seat's scope refuses
   `invalid_payload`), and a hand-written claim cannot exempt itself. The exemption is the
   conflict rule's ONLY one: a scope claim is a claim row everywhere else — it rides `view.claims`,
   the peers-now lines and `shared_checkout_overlap` like any other hold. The one further
   consequence, because a scope claim excludes nothing: a gone holder's scope claim raises NO
   `claim_holder_gone` row (docs/45 §2.1's row is for a hold a seat TOOK, whose release frees
   something; the participant row already carries the declared scope and says the seat is gone, so
   the row would page the root per settled seat for a bookkeeping write) — the claim row stays
  active and durable on the view. The red skeleton's row (e) is green, and the whole skeleton is a
  conformance pin now (§7); the landed lanes' rows are pinned by
  `impl/test/issue441d-claims-instead-of-handovers.test.mjs`.

## 6. What stays OUT

- **No worker-side `gh`.** The worker runtime holds no credential (#347); the root reads at
  recruit time and the package is the only channel. A seat that needs a NEWER issue reading says
  so (`swarm.guide` to the root), never shells.
- **No free scripting.** The Bench's closed op set stays the ceiling (docs/32 §5); the reading
  half adds reads, not evaluation.
- **No per-view scans or spawns.** docs/46 §7 binds every read path in this doc: the
  contributions derivation reads the fold, peers-now reads the participants fold, package reads
  resolve content-addressed bytes. No `git` spawn, no ledger walk per read.
- **No new event kinds, wake classes, or ledger rows for reading.** The `package.attached` row
  already exists; a read mints nothing.
- **No mutable refs in a package.** Branch content is immutable and content-addressed; a doc
  that changes is a NEW branch name (`doc:<path>@<new-sha>`), never a rewritten branch
  (docs/32 §3.3 replay rule).
- **No credentials in packages, briefs, or branch content** (docs/32 §5).
- **No second contributions derivation.** The #433 view projection and `run.contributions.read`
  share ONE exported function; a second spelling is a bug.

## 7. Migration: today's hand-typed briefs keep working

- A recruit without `--issue` admits no package, attaches nothing, and renders no
  `## Context package` section — the composed brief is byte-identical to today's.
- Existing packages and attachments replay unchanged; the replay rule (docs/32 §3.3) is
  untouched.
- The three bridge verbs (`run.package.read`, `run.contributions.read`, `run.peers.read`) are
  additive rows in the closed seat verb set; the #318 verb set and the contract example the
  brief renders (#371) are untouched.
- The contributions read derives review state at read time through the ONE exported derivation
  (`contributionLedgerRows` + `SWARM_REVIEW_STATES`, docs/46 §2.1); no durable row is rewritten.
- The wave-13 red-before skeleton (`impl/test/issue441-reading-half-red.test.mjs`) is a
  conformance pin now and carries no expected-red row: `impl/scripts/expected-red-tests.json`
  lists the file under `converged` with reason `#441`, and nothing in its row set pins an
  unlanded promise — no row remains red. Its six rows assert the LANDED spellings, re-derived
  after the four lanes landed: (a) `--issue N` parses onto the recruit's context leg and the
  runtime attaches the ONE admitted package to the seat's run; (b) the brief's `## Context
  package` section names each branch, its digest and the issue title; (c) `run.package.read`
  answers the attached package's branch list by digest and one branch's text by name, and
  refuses a digest the seat's run never carried; (d) `run.contributions.read` answers `rows` —
  the fold's rows with their files and their derived review state, with zero ledger scans on the
  read path; (e) a claim is one `swarm.claim_updated` row, never a handover; (f)
  `issue_reader_unavailable` is the APPLICATION layer's refusal, raised by the root's CLI
  (`runBatonCli` → `admitRecruitContextPackage`, application-cli.mjs) before any recruit crosses
  the wire — never a runtime refusal.
- The design's pre-landing guesses that did NOT survive contact are recorded here so no reader
  re-derives them from the skeleton's history: the recruit's `--issue` parse lands on
  `parsed.contextPackage`, never `parsed.args.issue`; the runtime is handed a package digest and
  never an issue number (the reader is the root's, §4.1); the contributions read answers `rows`,
  not `contributions`; and `run.package.read`'s unattached-digest refusal is the runtime family's
  `package_not_attached_to_run` (the store's own `context_package_not_found` is a store spelling,
  below the runtime — the branch-miss refusal the verb raises is
  `swarm_context_package_branch_not_found`).

## 8. Closed-set owners and the seam map

| closed set / seam | owner (file · function) |
|---|---|
| package shape, branch mold, admission + attach refusals | `coordination-store.mjs` · `_normalizeContextPackage`, `admitContextPackage`, `attachContextPackage`, `resolveContextPackageBranch` |
| text-artifact admit into the CAS | `context-program.mjs` · `StatelessContextBench.admitSource` |
| branch read projection (the ONE shape) | `application.mjs` · `projectContextPackageBranch` |
| CLI argv vocabulary, usage rows | `application-cli.mjs` · `parseSwarmCli`, `SWARM_PARSER_LEG_FLAGS`; `swarm-surface.mjs` |
| CLI refusal codes (`issue_reader_unavailable`, `issue_not_found`, `context_doc_unreadable`) | `application-cli.mjs`, the #430/#431 closed refusal shape |
| registry byte rows (`context_package.brief_bytes`, `context_package.source_bytes`, the read-verb bounds) | `limits.mjs` · `FRAME_LIMITS` |
| recruit args→attach seam, the `## Context package` brief section | `swarm-runtime.mjs` · `swarm.recruit` effect, `_composeRecruitBrief` |
| the three read verbs: dispatch table rows | `swarm-runtime.mjs` · the knowledge-dispatch region (:236–350) |
| the closed seat verb set, brief/help rows | `swarm-native-access.mjs` · `SWARM_SEAT_VERB_NAMES` + the guidance derivation |
| the verbs' refusal codes | raised as typed bridge refusals today; the `swarm-refusals.mjs` closed-set rows (`package_not_attached_to_run`, `context_package_not_found`, `context_package_branch_not_found`) are the root's hunk (§9.2) |
| contributions derivation (exported, shared with #433) | `swarm-runtime.mjs` · `contributionLedgerRows` + `SWARM_REVIEW_STATES` over the swarm fold |
| reviewState closed set | docs/46 §2.1 (`unreviewed \| accepted \| rejected`) — this doc adds nothing |
| claim refusals | docs/45 §2 (`swarm_claim_conflict`, …) — this doc adds nothing |
| web admit/attach route pair | `web-northbound.mjs` — mirrors the MCP handlers, no second semantics |

## 9. Open questions

1. **`--files <globs>` scope derivation.** The issue's owed item 4 composes path scope from the
   issue's file mentions plus the #296 landing-table gates. This wave's implementation lane
   (lane A) carries only `--issue`/`--doc`; `--files` is deferred because the gate-set
   derivation has no landed reader today. The lane brief wins for this wave; the gap is
   recorded here so the root can re-brief.
2. **Where the three read verbs' admission rows live — RESOLVED this wave.** The #318 verbs ride
   `SWARM_KNOWLEDGE_COMMANDS` in `swarm-contract.mjs`, but the brief-surface pins admit only
   registered contract commands after `swarm.` in a rendered brief, so the verbs landed in the
   `run.*` participant namespace with their own closed seat verb set (`SWARM_SEAT_VERB_NAMES`,
   swarm-native-access.mjs). Their three refusal codes are raised as typed bridge refusals; the
   `swarm-refusals.mjs` closed set does not hold them yet — the hunk (three rows:
   `package_not_attached_to_run` 403, `context_package_not_found` / `context_package_branch_not_found`
   404) is the root's to land.
3. **`package_not_attached_to_run` swarm-scope reading — RESOLVED this wave.** The read is
   attach-scope only: the digest must be attached to the caller's run OR to a run of its swarm
   (the attach rows are the scope check). A swarm-visible package scope beyond that has no
   spelling today and needs none.
4. **KG-3 over the issue text.** `recallPreview` runs at the `_providerBrief`/spawn seam over
   the objective; whether the admitted issue branch's text should EXTEND that query (two
   sources, one preview) or stay the objective alone is a coordinator-seam decision outside the
   reading half's lanes.
5. **The citation regex surface — RESOLVED this wave.** ONE exported derivation lives in
   `application-cli.mjs` (the only caller today): every `docs/NN-…md` mention in the issue body
   is auto-admitted as a doc branch. A docs-linter reuse would move it, not fork it.
6. **The resident's CAS-writer wiring.** Lane A's web admit port mints branch documents through
   a deployment-owned `contextSourceAdmit` hook (`StatelessContextBench.admitSource`); wiring it
   into the `new WebNorthbound({…})` literal in `application-deployment.mjs` is one line outside
   every #441 lane's scope. Until it lands, `package.admit` on a real resident refuses typed
   `context_source_unavailable` — the feature is complete and its suites wire the hook by hand.

7. **The attach never reads the Run view — RESOLVED (#489).** `attachContextPackage` binds the
   package to the run through the coordination store (`package.admitted`/`package.attached` rows,
   `context_package_not_found` for a digest the store does not hold) and answers the attach
   receipt; the participant's own start and `approve` compose the Run view NARROWED
   (`{view: 'narrow'}`), so a brief whose full view exceeds the deployment ceiling admits and
   attaches instead of refusing `application_run_view_oversize`.
