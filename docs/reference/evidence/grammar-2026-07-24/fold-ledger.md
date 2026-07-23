# Fold ledger — docs/35 v1 → v2 (issue #43)

**Provenance, stated plainly.** The fold itself landed at `0c5c970` ("doc 35 v2 FINAL"), authored
by the controller that ran ahead of this seat; `FOLD-STATUS.md` records it and explicitly asks
that no second competing v2 be landed. This seat therefore did **not** re-fold the document. What
was missing was this file: the brief requires a standalone per-finding ledger, and Appendix B of
docs/35 carries the dispositions only as prose. This ledger is that record, with every landing
verified against the committed v2 rather than copied from Appendix B's summary.

**Verification method.** Each finding id was mapped to its landing section mechanically (scan of
`docs/35-unified-control-grammar.md` associating every `R-*` citation with its enclosing heading),
then the section was read to confirm the citation is a substantive repair and not a passing
mention. Coverage: all 49 findings (R-CX-1..15, R-KM-1..17, R-OP-1..17) are cited in the doc body.
**Declined: none.** One kind (`capacity`) is deferred with tracking to issue #39.

**Deployment verification:** `node --test impl/test/surface-audit-smoke.test.mjs` → exit 0 (SA1,
SA2, SA3 pass). Doc-only change; no `impl/` or test file touched by this seat.

## Codex seat (`gpt-5.6-sol@high`, verdict UNSOUND)

| Finding | Sev | Verdict |
|---|---|---|
| R-CX-1 | P0 | FOLDED — §6 canonical set (now 45 ops: `deployment.shutdown`, `context.map/reduce/retry`, checkpoint settle path, eval `runId` XOR `manifestDigest` union, `search/chunk/coverage` as recorded aliases) + §4.1 object row |
| R-CX-2 | P1 | FOLDED — §4.1 read row + §6 `run.view`/`run.watch` (cursor/settlement/selector contracts restored; double-mapped `run.result` row deleted) |
| R-CX-3 | P0 | FOLDED — §4.1‡ (episode fold carries `--role`/`--generation`/`--section`; four cross-argument admission rules ported verbatim from `application.mjs:1226-1247`; isolation pinned by `phase92-episode-attribution-red.test.mjs:103-104,133-144`) |
| R-CX-4 | P0 | FOLDED — §7.1 + §5 L4 (`work_completed → result_ready`, **not** `completed`; registry owns `providerSettled`/`applicationTerminal` predicates). Seat conflict resolved **for codex** — see Conflicts below |
| R-CX-5 | P1 | FOLDED — §7.1 mapping (`approved → queued` restored as a real state; `closed` declared a dead string with named deletion sites; `start_failed` demoted to §7.2 member state) |
| R-CX-6 | P0 | FOLDED — §3 ontology + §5 L9 + §7.3 (attention is one *shape*, not one verb; three-variant checkpoint response). **Second half completed by this seat:** the repair also demanded "name the issue-31 tests in C5", which `0c5c970` had not done — now pinned in §10 C5 (`turn-checkpoints-31b5-surface-red.test.mjs:150-224`). See A-4 |
| R-CX-7 | P0 | FOLDED — §5 L2 (do-block scoped to kind-portable / id-local; `actionId` a freshness token per `application.mjs:7310-7323`) + §10 C2 phased M1→M2→M4 |
| R-CX-8 | P1 | FOLDED — §3 + §4.2 H4/H9 (structured `{role, generation?}` address; two clocks distinguished; `work` sentinel reserved to run-level send; `role:gN` spelling banned) |
| R-CX-9 | P1 | FOLDED — §9 M1 (dispatch-layer aliases only; D3 keys/flags frozen until M4) + §10 C9 |
| R-CX-10 | P1 | FOLDED — §5 L3 (success carve-out: `completed` MAY carry `terminalCause: null`, pinned by `phase92-read-only-result-red.test.mjs:90-103`) + §10 C5 |
| R-CX-11 | P2 | FOLDED — §4.2 H10 scoped to a serialization-layer pin; digest/replay identity stays on `application.mjs:171-187`; C8 cut at M4 |
| R-CX-12 | P1 | FOLDED — §5 L10 (closed `outlineTruthKinds` enum replaces the untestable "never a new kind of truth" prose); C5 tests a finite matrix |
| R-CX-13 | P1 | FOLDED — §8.4 + §4.1 banned list (ledger made bidirectional, append-forbidden; ban set generated with token normalization) + §10 C4 |
| R-CX-14 | P0 | FOLDED — §5 L1 profile-scoped + §4.1 †² + §6 board rows (orchestrator-lease, `expectedBoardFence`, idempotency-binding authority fields; worker profile) + §10 C1 |
| R-CX-15 | P1 | FOLDED — §4.1 † (`run.steer` kept as a deprecated compatibility command, not an alias; five-field schema and unique `reconcilable: false` class at `application.mjs:142` preserved verbatim through M5) |

## Kimi seat (`k3@high`, verdict SOUND-WITH-FOLDS)

| Finding | Sev | Verdict |
|---|---|---|
| R-KM-1 | P1 | FOLDED — §6 `deployment.shutdown` row (`application.mjs:152`), profile `host`, never web/MCP |
| R-KM-2 | P1 | FOLDED — §4.1 read row (`view --until settled\|terminal` absorbs `run.wait`'s settle-blocking read; channels stay on `watch`) |
| R-KM-3 | P1 | FOLDED — §4.1‡ (role×generation axes + admission matrix; registry-owned `--section` values exempt from H7 name depth) |
| R-KM-4 | P1 | FOLDED — §7.3, via **kimi's own minimal-fix option (a)**: `continue{text?} \| wait \| settle` dispatching exactly `nudge_turn`/`wait_turn`/`claim_turn` (`application-semantics.mjs:355-380`), `settle` defined as re-running the preserved trust gate. The requested rename/mapping half is rebutted — see Conflicts |
| R-KM-5 | P1 | FOLDED — §4.1 † (steer is a compatibility command; `reconcilable` becomes a per-operation registry field so no alias can flip a durability class silently) |
| R-KM-6 | P1 | FOLDED — §5 L2 (byte-identical-everywhere claim scoped down to kind-portable/id-local, which is what the digest checks survive) |
| R-KM-7 | P1 | FOLDED — §7.1 (`closed` dead-string deletion incl. the self-contradicting `application-client.mjs:251` completed-bucket; `approved → queued`) |
| R-KM-8 | P1 | FOLDED — §9 M1 (registry merge must not touch D3 keys/flags before M4; D3 projection frozen) |
| R-KM-9 | P2 | FOLDED — §4.1 object row + §6 (`context.map/reduce/retry` first-class verbs, not do-only; `effect: plan_proposal`, `application-semantics.mjs:226-279`) |
| R-KM-10 | P2 | FOLDED — §3 + §6 `run.member.send` (structured `{role, generation?}`; `--to` stays run-level, live-recipient-resolving) |
| R-KM-11 | P2 | FOLDED — §7.1 ("axes, not a chain"; **paused masks interrupted** per `application.mjs:6423-6432`, precedence stated so a conformance test must encode it) |
| R-KM-12 | P2 | FOLDED IN PART / REBUTTED IN PART — §7.3 keeps the nine live kinds **verbatim** and drops invented `capacity` (reserved for issue #39); the requested renames + mapping table are rebutted, see Conflicts |
| R-KM-13 | P2 | FOLDED — §4.2 H10 scoped as a contract; C8 sequenced at M4 |
| R-KM-14 | P2 | FOLDED — §8.4 (allowed-divergence ledger made bidirectional and append-forbidden) |
| R-KM-15 | P2 | FOLDED — §5 L2 + §11 (M2 invalidation restated as the *designed* recovery: `application_action_scope_mismatch` → re-read; `actionId` never durable) |
| R-KM-16 | P2 | FOLDED — §6 `deployment.view` row (CLI's credential-free local doctor is a host-side rendering detail, not projected to web/MCP) |
| R-KM-17 | P2 | FOLDED — §5 L5 + §10 C7 (re-grounded on `driverKind: 'wave'` facts at `wave.mjs:131,147-156`; the real gap is explore/review provenance, not approval mechanics) |

## Opus seat (`claude-opus-4-8@high`, verdict SOUND-WITH-FOLDS)

| Finding | Sev | Verdict |
|---|---|---|
| R-OP-1 | P0 | FOLDED — §5 L2 restated as kind-portable/id-local with `do: {action: {kind, actionId}, inputs}`, freshness bound to view digest + calling principal (`application.mjs:7310-7323`), bridge envelope minted per session (`mcp-web-bridge.mjs:111-135`); §10 C2 phased |
| R-OP-2 | P0 | FOLDED — §1.1 D4/D8 recount (~19 kernel/goal-plan web literals surfaced, `web-northbound.mjs:17-31`) + §6 `deployment.shutdown` + explicit `authoring` profile for the goal/plan family |
| R-OP-3 | P0 | FOLDED — §4.1‡ + §2 + §11 (three-axis addressed read preserved on `run.view`; `--role none` kept as a distinct projection per `phase92-episode-attribution-red.test.mjs:105-106`; fold must land atomically) |
| R-OP-4 | P0 | FOLDED — §4.1 meta row + §2 ("named verbs are peers, not sugar"; they carry their own schemas/admission and never inherit `do`'s machinery; L2 constrains the advertised set, not the verb set) |
| R-OP-5 | P1 | FOLDED — §7.1 (mapping generated by the audit tool; an unmapped phase literal in `impl/src` is a red test; four missing strings added) + §10 C3 |
| R-OP-6 | P1 | FOLDED — §7.2 (`interrupted` and `idle` restored; `idle` ≠ `completed`; interrupt eligibility and preservation receipts key on `interrupted`, `application.mjs:1949-1952,1988-1990`) |
| R-OP-7 | P1 | FOLDED — §7.3 (nine live kinds verbatim; "one verb answers all" retired in favour of one *shape*) + §10 C5 |
| R-OP-8 | P1 | FOLDED — §4.1 † (steer ≠ `member.send --now`; durability class preserved) |
| R-OP-9 | P1 | FOLDED — §4.1 read row + §6 (`view` takes `--until`; `watch` owns channels; the double-mapped `run.result` row deleted) |
| R-OP-10 | P1 | FOLDED — §6.1 C9 (derived web names asserted disjoint from kernel/authoring literals, not assumed) |
| R-OP-11 | P1 | FOLDED — §8.1 + §9 + §11 (registry-digest churn split and budgeted; quiesce points named as scheduling constraints) |
| R-OP-12 | P2 | FOLDED — §4.2 H4 (flag name = kebab-case of the JSON schema property; value-flags must be declared `flagAliases` or lint fails) |
| R-OP-13 | P2 | FOLDED — §4.2 H5 (emergency carve-out: `stop`/`member.stop`/`interrupt` keep `reason` optional; `application-semantics.mjs:170,179,612,621`) |
| R-OP-14 | P2 | FOLDED — §4.2 H9 (instance-valued enums are registry-*shaped*, not registry-*valued*, minted per view at `application.mjs:8880-8906`; `work` sentinel given a spelling) |
| R-OP-15 | P2 | FOLDED (five parts) — a: §10 C2 phasing; b: §1.1 D8 + `remote_bridge` profile; c: §9 C8 phase; d: §8.4 ledger direction; e: §1.3 dimensioned ledger + seeded behavior rows |
| R-OP-16 | P2 | FOLDED — §3 + §4.1 trust row + §4.2 H4 (`select`/`feedback` address a **candidate**, not a member) |
| R-OP-17 | P2 | FOLDED — §1.2 F8 corrected + §5 L5 + §10 C7 (the "waves auto-approve" receipt was factually wrong; C7 re-grounded on recorded expansion) |

## Conflicts between seats (brief rule 2 — prefer the position grounded in executable contracts)

1. **`work_completed` — R-CX-4 (P0) vs kimi's "clean".** Resolved **for codex**. Grounding that
   defeats the kimi read: `impl/src/application.mjs:117-124` models provider-settled and
   application-terminal as two deliberately separate lifecycles, and
   `impl/test/phase67-run-terminality.test.mjs` pins it. Folding `work_completed → completed`
   would have collapsed the trust chain that adoption/selection/review/integration act after.
   Landed in §7.1 + §5 L4 as two registry predicates rather than one terminal union.

2. **Attention-kind naming — R-KM-4/R-KM-12 (rename + mapping table) vs R-OP-7 (keep verbatim).**
   Resolved **for opus**; kimi's *substantive* half was folded, its *cosmetic* half rebutted. The
   nine kinds are live emitter strings (`application.mjs:6822`, `wave.mjs:90`); renaming them to
   `checkpoint`/`preservation`/`question` would mint exactly the hand-maintained mapping table
   that R-OP-5 identifies as this document's reason for existing, for zero executable gain. Kimi's
   mapping-table request is therefore moot — with no rename there is nothing to map. Kimi's real
   finding (the unification is false for checkpoints) is fully folded via its own option (a).

3. **Checkpoint response shape — R-KM-4 option (a) vs option (b).** Option (a) taken: the three
   acts map exactly onto `nudge_turn`/`wait_turn`/`claim_turn` schemas at
   `application-semantics.mjs:355-380`, advertised together at `application.mjs:8785-8798`, so a
   three-variant response is expressible without inventing a verb. Note the residual asymmetry
   kimi flagged is preserved honestly in the doc: `settle` is documented as *re-running the
   preserved trust gate*, not as an ordinary answer payload, and the acts remain `run.do` targets
   regardless — nothing is unreachable under either reading.

## Acceptance review of v2 (this seat)

Per `FOLD-STATUS.md`'s suggested repurposing — attack the *folds* rather than re-fold the
document. Whole doc read end to end; every finding's landing section confirmed to be a
substantive repair. One defect found and fixed; two claims verified.

- **A-1 — FIXED — §6 operation count was stale.** The prose claimed "Forty-five operations"; the
  table carries **44**. Derivation: v1's table (`a2e5eca`) expands to exactly 41 ops; v2 adds
  `deployment.shutdown` (R-KM-1, R-OP-2) and `context.map`/`reduce`/`retry` (R-CX-1, R-KM-9) =
  **+4**, and deletes the double-mapped `run.result` row (R-OP-9) = **−1** → 44. The count had
  absorbed the additions without subtracting the deletion. Corrected in §6, with the arithmetic
  written inline so the completeness claim is auditable rather than asserted.
- **A-2 — VERIFIED, no change — brief rule (3) completeness holds.** Diffed v2's canonical table
  against v1's at `a2e5eca`: no operation the 41-op set carried is dropped. `run.result` is the
  only removed row, and it is explicitly preserved as `run.view --section episode.result` (§6) —
  which is precisely the fold R-OP-9 demanded, not a loss.
- **A-3 — VERIFIED, no change — no fold contradicts a contract it cites.** §3's "one shape, not
  one verb" is consistent with §7.3's settler table; §7.1's two predicates are consistent with L4
  and C3; §9's M-phase ordering is consistent with §10's C2/C8/C9 phasing; §4.1‡'s four
  cross-argument admission rules match the `application.mjs:1226-1247` set they claim to port;
  §8.1's digest split is consistent with L2's freshness binding.
- **A-4 — FIXED — R-CX-6 (P0) was folded only in half.** The finding's minimal repair had two
  clauses: *"Replace L9's `continue|settle` wording **and name the issue-31 tests in C5**."*
  `0c5c970` did the first (L9 rewritten, §7.3 three-variant response) but not the second — no
  checkpoint test was named anywhere in the doc, as a cross-check of cited `*.test.mjs` names
  against the reports' demanded contracts showed. This is load-bearing, not bookkeeping:
  `turn-checkpoints-31b5-surface-red.test.mjs:150-224` is what pins `wait_turn` as
  **non-consuming** (all three acts still advertised after a wait receipt), `nudge_turn` as
  consuming + watchdog-arming, and `claim_turn` as a live trust-gate re-run. Without it, C5 could
  go green while a response union quietly collapsed `wait` into a consuming settle — exactly the
  durability/turn-accounting break R-CX-6 predicted. Now pinned in §10 C5, with the server-derived
  coordinates and sorted capabilities named as part of the contract.
- **A-5 — FIXED (six residual clauses) — findings were folded at the *finding* level but not at
  the *clause* level.** A-4 showed that "the ID is cited and the section is substantive" is too
  shallow a test, because a minimal repair often carries 3–5 atomic demands and `0c5c970` folded
  the prose demands while skipping several pins. Re-auditing all 49 findings clause-by-clause
  surfaced six more, each verified against source before folding:
  - **R-CX-1** — the demanded *generated, bidirectional* crosswalk had no contract. C1 runs
    canonical→surface and C3 is total over phase literals only; nothing ran source→canonical over
    D1/D2/D3 rows **or arguments**. §6's closure was an assertion. Now **§10 C10**.
  - **R-CX-4** — the two lifecycle predicates were *defined* (L4, §7.1) but no contract *tested*
    them; the finding demanded both. A build folding `result_ready` into `applicationTerminal`
    passed every C-contract. Now asserted in **C3**.
  - **R-OP-4** — of its four L2 sub-clauses, "every advertised action has a named verb accepting
    the same `inputs`" was the one that did not land, leaving F3 (advertised-but-`do`-only)
    unpinned and §6's coverage of D2's 27 kinds unobligated. Now in **§5 L2**.
  - **R-CX-3** — the "eleven-topic vocabulary" half was never enumerated; only the phase92
    attribution half landed. Verified closed at eleven incl. `help`/`cleanup`
    (`application.mjs:113-116`, gated `:1232`). Now in **§4.1‡**.
  - **R-CX-2** — `run.view` was pinned to the role/generation/section subset; `item`, `offset`,
    `recipient` are live args (`application.mjs:130`) and were dropped. `run.watch` lacked
    `timeoutMs`, the bounded page, and post-wait reauthorization (`run.follow` args at `:137`).
    Both now in **§4.1** (read row and ‡).
  - **R-OP-8** — the demanded ledger row (`run.steer reconcilable:false, retiresIn: M5`) was
    absent, so the doc's own enforcement mechanism never covered the class it protects in prose.
    Now a seeded `schema` row in **§8.4**, together with R-CX-13's demanded row key
    (`operation × surface × arguments × effect × capabilities × output × continuation × aliases`),
    without which the novel-divergence guard sees only names.
- **A-6 — FIXED — a fold's *grounding* was factually wrong, and it dropped a durability class.**
  Third audit level: not "does the citation resolve" (A-1..A-3 checked that) nor "did every clause
  land" (A-4/A-5), but **does the cited line actually say what the doc claims**. Re-verified the
  doc's substantive code claims against file contents — possible only with `grep -a`, see the
  method note below. Nine of ten verified exactly (`:117-124` two lifecycle sets, `:152` shutdown,
  `:6423-6432` paused-before-interrupted, `:1943` work sentinel, `application-semantics.mjs:581-584`
  sorted caps, `mcp-web-bridge.mjs:156` raw-order compare via `join('\0')`,
  `application-client.mjs:251` `['completed','closed'] → completed`, `:113-116` topics, `:130/:137`
  selectors). **One was false**: §4.1† called `run.steer`'s `reconcilable: false` class
  "the only one". It is not — the class is carried by **exactly two** commands, `run.steer`
  (`:142`) and `application.shutdown` (`:152`).
  The consequence was not cosmetic. §6 folded `application.shutdown` into `deployment.shutdown`
  (satisfying R-KM-1/R-OP-2) **without carrying its `reconcilable: false` class** — a silent
  durability-class flip on a canonical row, which is exactly what R-OP-8 was raised to prevent and
  what §4.1†'s own closing sentence promises cannot happen. Fixed in three places: the uniqueness
  claim corrected in §4.1† with an explicit correction note, the class added to §6's
  `deployment.shutdown` row, and the §8.4 seeded `schema` rows widened from steer alone to both
  non-reconcilable commands.
- **Method note — the NUL-byte trap is real and it bit this audit.** §8.4 already warns that
  `impl/src/application.mjs` contains a NUL byte requiring `grep -a`. Plain `grep` against it
  returns *silently empty* — not an error. An early verification pass here read that empty result
  as "citation not found" and nearly dismissed two correct findings. Any M0 extraction or
  reviewer tooling that greps this file without `-a` will under-report divergences and look
  green. Worth treating as a harness contract, not a footnote.
- **Status header** bumped to `v2 (post-red-team) — FINAL`, satisfying the brief's rule (4)
  wording while preserving the prior controller's FINAL designation rather than overwriting it.
