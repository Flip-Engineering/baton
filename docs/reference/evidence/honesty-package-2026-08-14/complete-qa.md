# COMPLETE-QA — honesty package completion wave (wave-c) acceptance

[attempt: ac47ee06-4629-4d26-8420-a50d94a94277 coordinator]

**FINAL VERDICT: LAND.** Every named acceptance stage of the package's immutable suites is
green; the two bisected landing blockers are adjudicated (surface legitimately moved) and
restaged with quoted proof; adjacents are green-unchanged or at their documented
red-by-design baselines; three suite stages were cross-checked against the code they pin.

## 0. Environment and method

- Worktree `baton/ws-358a93749e4c656b022fbb59ecad2d4e`, base `09200e9`
  (impl-gate-digest-2026-08-14-wave-a). node v25.8.0, darwin 24.5.0.
- Suites run via `node --test impl/test/<suite>.test.mjs`. Timing-heavy suites were run
  SERIALLY on a quiet machine — a 14-suite parallel batch produced load artifacts (phase72
  KC6/KC7/KC8 and phase11 timeout rows flip green when re-run quiet/isolated; evidence in §6).
- The four rows ran in sibling worktrees; per the previous wave's pattern (recovered/ patches
  applied into this tree), I harvested their diffs here and archived them verbatim at
  `harvest/row-cli2.patch`, `harvest/row-web2.patch`, `harvest/row-deploy2.patch`
  (row-docs2 produced no tree diff — its artifact leg is executed below, §2.4). File
  partitions were disjoint; all three patches applied cleanly (`git apply --check` first).
- `gh` is unauthenticated in this worktree (as warned at spawn); the CLAUDE.md flaky-issue
  file/check path is therefore unavailable. The flake candidates are recorded in §6 for
  filing when auth exists.

## 1. Acceptance evidence (brief §§1-5) — all final-tree runs

| # | Brief item | Result |
|---|---|---|
| 1 | `scratchpad-write-red` — GREEN at every named stage (A1-1…A9-1 set) | **22 pass / 1 fail** — every named stage GREEN: A1-1, A1-2, A2-2, A3-1, A4-1, A4-2, A5-1, A6-1, A7-1, A7-2, A7-3, A8-1, A9-1 (and A9-2) + all five pins. The only red is **A10-1** — outside the brief's named set, parked (§2.1). |
| 2 | `doc-truth-conformance-red` — green R1…R11 | **13 pass / 0 fail** (R1-R11 + P-CS1-b + P-CS4 all green). |
| 3 | `cli-wave-fidelity-red` / `error-actionability-red` / `mcp-reflex-surface-red` | **16/16 · 22/22 · 21/21**. |
| 4 | Adjacents green-unchanged | `cli-silent-start-red` **7 pass / 5 fail** — byte-identical to the HEAD split (7 PIN rows green incl. PT-7 `detection.size === 39`; the 5 red are #155's capability rows, red-by-design, another package). `phase16-mcp-northbound` **29/29** (one adjudicated pin restage, §5.3). `phase67-progressive-agent-experience` **12/12**. `phase72-kimi-orchestrator-mcp` **20/20**. `wave-observability-red` **30/30**. `event-log-read-scaling-red` **2/2**. `waves-list-scaling-red` **1/1 — WLS-1 is GREEN**: landed by its own wave (`2387699` wls-remediation-2026-08-14-wave-a-rd1, in this tree's base), NOT absorbed by this package. |
| 5 | `node impl/scripts/surface-conformance.mjs` | `surface-conformance: ok`, exit 0. |
| 6 | Landing blockers | Both adjudicated → restaged → green (§3). `phase11` **43/43**, `phase12` **33/33**. |
| 7 | Cross-checks | Three stages verified against pinned code (§4). The five acceptance suites are UNTOUCHED (git status: only phase11/phase12/phase16 test files modified). |

Additional adjacent verification (beyond the brief's list, all at documented baselines):
`scratchpad-33-red` 50/50 · `control-surface-truth-red` 7/7 · `workflow-dsl-red` 35/35 ·
`worker-delivery-push-red` (#79) 32/32 · `mcp-profile-parity-red` 8 pass / 13 fail (#156's
designed-red rows, unchanged) · `worker-orchestrated-swarm-red` 15 pass / 1 fail (the
designed-red steering-trail row row-deploy2 documented) · `phase68-unified-agent-entrypoint`
21/21.

## 2. Per-row verdicts and DECISION_REQUEST rulings

### 2.1 row-cli2 — **SOUND**

Landed `impl/src/application-cli.mjs` (+77/-1): the `run scratchpad append` branch (closed
closure {runId, scope, kind, body}, SCRATCHPAD_SCOPE grammar, closed kind set, noRemainder),
`scratchpadAppendBody` per-kind shaping, D4 bare/unknown-subverb teaching, `run watch RUN_ID`
→ `run.watch`, bare `run watch` value-required refusal, `application help`. Verified live:
`parseBatonCli(['run','scratchpad','append','run:m1','--scope','shared','--kind','note',
'--body','handoff note'])` → `{name:'run.scratchpad.append', args:{runId:'run:m1',
scope:'shared', kind:'note', body:'handoff note'}}`; `run watch run:r1` → `run.watch`;
`run shwo` → `cli_command_unavailable` + closed verb set; bare `run scratchpad` →
`run scratchpad requires a subcommand: read|elevate|append`.

**PT-7 39→40 handled EXPLICITLY — quoted from notes-row-cli2.md §Decisions:**
> "**Watch placement keeps PT-7 at 39** — the cross-seam constraint from `notes-row-cli.md`
> (adding watch as a *recognized first-token* inflates the #155 detection set 39→40). Serving
> watch AFTER the `lifecycleActions` literal satisfies both R1/R4 (watch parses) and PT-7
> (detection stays 39): no re-pin of the #155 suite is required, so no suite edit and no
> silently-broken pin."

Verified: `cli-silent-start-red` 7/5 byte-identical to HEAD; PT-7 green at 39; the #155
suite was not edited (git status confirms).

**A10-1 DECISION_REQUEST (row-cli2) — RULED: defer to the suite owner / next fold.** A10-1
is outside the brief's required A1-1…A9-1 set. Its leg (b) pin is
`/run\\.scratchpad\\.append/u` (scratchpad-write-red.test.mjs:953) — in a JS regex literal
`\\.` matches a literal BACKSLASH + any char, so the pin can never match a correct
plain-dot admission (`run.scratchpad.append` in CLI_WEB_COMMANDS). The pin is a suite defect
(double escape); the admission itself additionally requires a coordinated
surface-divergence-ledger row (row-docs2's file) plus web-card reconciliation. Disposition:
A10-1 stays red-by-design this wave — named, not absorbed; the leg-(b) regex fix and the
coordinated CLI_WEB_COMMANDS+ledger admission belong to the suite owner's next fold. (I did
NOT edit the immutable suite to "fix" the regex.)

### 2.2 row-web2 — **SOUND**

Landed `impl/src/application.mjs` (+72, the `_commandDispatch` append branch +
`_normalizeScratchpadAppend` + `scratchpadAppendEntry` + `scratchpadAppend` with
`_authorize` seam and surface-side scope-namespaced idempotency key), `mcp-northbound.mjs`
(±30: answer schema decision-free with `ACCEPTED_ANSWER_KEYS`, guard covering
`baton_decision_answer` AND `fleet_run_answer`, initialize briefing honesty). A2-2, A3-1,
A6-1, A7-1/2/3, A8-1, R3, R8, R9 all green on the combined tree (the kernel contract is
routed into, never re-implemented — verified against row-kernel's recovered notes).
One suite edit: the phase16 UA5/MN one-token restage — adjudicated in §5.3.

Their flaky-test register (phase72 KC6/KC7/KC8) was reproduced here as a LOAD artifact:
fails under parallel suite batches, passes quiet serially (20/20 final) — see §6.

### 2.3 row-deploy2 — **SOUND**

Landed `impl/src/application-deployment.mjs` (+59/-5): `restrictingAppendAuthorize`
(:1758-1779 — D1 laws 1/2/3, H1.1 own-run predicate via the seat resolver, review-authority
shared-only, unknown≡foreign, non-append commands delegating to the D1.2 read restrictor so
P-A5's substrate holds), `appendSeatResolver` (:2058), install `authorize: rw(
appendSeatResolver)` (:2099). The `rw` alias keeps the A4-1 structural grep green on BOTH
BSD and GNU grep (their notes document the `[\w$]` BSD divergence honestly — verified the
pin matches and the factory is real code, not a grep artifact).
A4-1, A4-2, A5-1 green; P-A5/P-A6 pins green.

### 2.4 row-docs2 — **SOUND (fold executed by coordinator per its DECISION_REQUEST)**

row-docs2 produced no tree diff: it correctly parked on the R11 gate conflict rather than
faking counts. Its DECISION_REQUEST (four options) is ANSWERED by this coordinator:

**RULING: `opt-move-typo-refusal`.** Grounding, quoted from notes-row-docs2.md:
- The immutable R11 leg-2 `parserLifecycleDispatchCount()` (doc-truth:184-202) hard-asserts
  the one-line gate `if (!lifecycleActions.has(action)) return parseStart` — the block-form
  gate (which #160 F8's typo refusal lives inside, error-actionability C2, green 22/22)
  cannot satisfy it; the one-line assertion predates the typo-refusal design (`98bdd1d` is
  an ancestor of `bcca97b`).
- `opt-suite-update-block-gate` and the suite half of `opt-cliParsedCommandNames-export`
  require editing the immutable suite — forbidden this wave. `opt-red-by-design` leaves a
  REQUIRED stage (R11) red. Only `opt-move-typo-refusal` greens R11 without a suite edit.

**Executed (coordinator fold into row-cli2's settled partition, behavior-identical):**
application-cli.mjs now reads
`if (!lifecycleActions.has(action)) return parseStart(args, action, idempotencyKey, 'change', lifecycleActions);`
and `parseStart` gained `recognizedActions = null` — the F8 hook fires ONLY on that exact
call site (direct parseStart callers at :1340/:1524 pass no set and are unaffected).
Verified preserved: `error-actionability-red` **22/22** (C2's `run shwo` refusal fires
verbatim — re-probed live), `phase68` 21/21 (multi-word objectives unaffected),
`cli-wave-fidelity` 16/16, `cli-silent-start` PT-7 at 39.

**Artifact (row-docs2's partition, regenerated by coordinator — never hand-edited):**
`node impl/scripts/surface-conformance.mjs --write-inventory` →
`parserLifecycleActions: 0 → 30` (29 lifecycle verbs + the `watch` branch special-case —
the honest dispatch count; the 0 was the B7 block-gate fallback row-docs2 warned about),
`webBusCommands: 31`, `cliWebCommands: 39` (append deliberately NOT whitelisted per §2.1),
`canonicalOperations: 75`, `mcpApplicationTools: 37`, `mcpCombinedTools: 88`. Conformance
main ok; P-CS4 byte-stability green (doc-truth 13/13).

## 3. Landing blockers (brief §6) — adjudicated, restaged, green

Both fail identically at recovery base `bcca97b` (brief's bisect; re-verified here by
running the suites in a complete `bcca97b` checkout — see §6). Both rulings: **the surface
legitimately moved; the stale pin was restaged with the move quoted.**

### 3.1 phase11 NR1/NR3 + NR3/NR5 — the adapter dialect hook

Failure (isolated): the prompt delegation carries `attention: []` the admitted Brief lacks
(deepEqual at the 'coordinator uses the immutable admitted Brief…' and 'custom adapters
fall back…' assertions). Root cause is commit `d8282d0` (feat(#79), ancestor of `bcca97b` —
verified): coordinator.mjs:3853-3865 attaches the per-worker `attention` projection to a
NEW provider-facing value "never a mutation of the admitted task.brief … the field is always
present once a worker is addressed", pinned by #79's own green suite.

**Restage** (the OR-S1 strip-and-assert precedent already in the same assertions for
`orientation`): both sites destructure `attention`, assert `Array.isArray(attention)`
positively, recompose `{ ...admittedBrief, orientation, attention }`. Move quoted in the
restage comments (phase11-persistent-sessions.test.mjs:561-572, 615-621).

### 3.2 phase12 UA5/WN + WN4/WN5/WN7 — pre-admission refusal shapes

Failure (isolated): typed codes `application_route_invalid`, `unknown_top_level_field`,
`unknown_argument_field`, `unknown_model_policy_field` where the pins said `invalid_command`.
Root cause: the #160 R4 typed-refusal contract landed at the recovery base
(`git log -S unknown_top_level_field -- impl/src/web-northbound.mjs` → bcca97b);
web-northbound.mjs:918-927 passes typed codes through at 400.

**The immutable #160 suite REQUIRES the typed codes** (this settles restage-vs-fix):
W1 (error-actionability-red:273-277) pins `code: 'unknown_top_level_field'` + `field`
GREEN; W8 (:384-402) — "a route-shape ValidationError with NO vocabulary code stays
invalid_command; a vocabulary-code validator failure passes through its named code (R4)".

**Restage** (per-case, quotes in comments at phase12:196-201, 505-524): :196 →
`application_route_invalid` (still 400, still pre-admission — `applicationCalls` empty and
no `web.command_admitted` both still asserted); :510 loop → `unknown_top_level_field`,
`invalid_command` (route-shape run-id case, per W8-1), `unknown_argument_field`,
`unknown_model_policy_field`.

**Both suites fully green on the final tree: phase11 43/43, phase12 33/33.**

## 4. Cross-checks (brief §7) — green earned by impl, never by suite edits

1. **A1-1 vs the parser**: the suite pins `run.scratchpad.append` with the closed
   {runId, scope, kind, body} closure. Code: application-cli.mjs:1669-1684 — real branch,
   SCRATCHPAD_SCOPE regex, `SCRATCHPAD_APPEND_KINDS` closed set, `noRemainder`, no
   caller-supplied workerId. Behavioral probe (this tree):
   `run scratchpad append run:m1 --scope shared --kind note --body "handoff note"` →
   exactly the pinned closure.
2. **A4-1 vs the deployment**: the suite pins (i) `run\.scratchpad\.append` in deployment
   CODE and (ii) a restrictor FACTORY call at the authorize install site, plus the hermetic
   law matrix. Code: application-deployment.mjs:1758-1779 (the law matrix incl. review
   shared-only and own-run predicate), install `authorize: rw(appendSeatResolver)` at :2099
   with the seat resolver at :2058. The `rw` alias is documented (BSD `[\w$]` grep
   divergence) and matches GNU grep too; the factory is real code — the green is earned.
3. **R8 vs the briefing**: the suite scans the `briefingSentence` source region for any
   non-MCP command name. Code: mcp-northbound.mjs:1487-1489 — "the pack is an
   embedded-only data note, resolved inside the orchestrator — no MCP tool reads it" (the
   old text named `context.briefing`, a non-MCP command). No dotted command names remain.

Suite-immutability check: `git status impl/test/` shows ONLY phase11/phase12 (the two
sanctioned restage candidates) and phase16 (§5.3). None of the five acceptance suites —
nor `cli-silent-start-red` — was edited.

## 5. Rulings on out-of-scope suite edits (full disclosure)

### 5.1 phase11 / phase12 — the brief's two sanctioned restage candidates. See §3.

### 5.2 The acceptance suites and cli-silent-start-red — untouched. See §4.

### 5.3 phase16-mcp-northbound (row-web2's one-token restage) — RULED: legitimate
surface-truth restage, same class as the prior wave's f4a64da precedent. The pin dispatched
`fleet_run_answer` with `answer:{decision:'allow'}`; R3/R9 (immutable, required-green) now
refuse that form with `invalid_arguments` and cover `fleet_run_answer` — the old pin is
mutually exclusive with the required R3/R9 green. Restaged to the valid
`answer:{optionId:'opt-a'}` (same `→ run.answer` mapping, same downstream projection).
phase16 is 29/29 on the final tree. Disclosed here because phase16 was not among the two
named restage candidates; the alternative (leaving it red) contradicts both the #159
contract and row-web2's own brief's adjacency requirement.

## 6. Environment-class residue — documented, not package collateral

- **phase11 full-suite `until()` timeouts under load**: a 14-suite parallel batch and even
  serial runs on a busy machine produced 8-16 "condition not met" failures; EVERY such row
  passes quiet/isolated, and the final quiet serial run is **43/43**. At the recovery base
  `bcca97b` (complete checkout) the same suite fails 16 rows on this runner — the residue
  predates wave-c entirely. The brief's bisect saw only the two deepEqual blockers because
  a faster reference runner reaches the assertion instead of timing out.
- **phase72 KC6/KC7/KC8** (row-web2's flaky register): fails under load (real authenticated
  Web listener + stdio child); passes quiet — final 20/20. Both this row and the phase11
  timing rows are flaky candidates for the CLAUDE.md `gh issue` filing; **gh is
  unauthenticated in this worktree so the issue could not be filed here** — recorded for
  the operator per the failing-tests rule's intent.
- `mcp-profile-parity-red` 8 pass / 13 fail — #156's designed-red rows (a later package),
  unchanged from the documented baseline. `worker-orchestrated-swarm-red` 15/16 — the one
  red is the suite's designed-red steering-trail row, unchanged by row-deploy2's diff.

## 7. Final verdict — LAND

- Every named acceptance stage green: scratchpad-write-red 22/23 (only the out-of-scope,
  suite-defect-parked A10-1 red), doc-truth 13/13, and the three §3 suites 16/16 · 22/22 ·
  21/21.
- Both landing blockers adjudicated with quoted proof and green: phase11 43/43, phase12
  33/33. Per the brief, #157-#160 may close.
- Adjacents green-unchanged (or at documented red-by-design baselines); WLS-1 green via its
  OWN wave, named.
- PT-7 re-pin handled explicitly per row-cli's notes (quoted in §2.1) — no #155 suite edit.
- Two DECISION_REQUESTs answered (A10-1 defer; R11 opt-move-typo-refusal, executed and
  verified); one out-of-scope suite edit disclosed and ruled legitimate (§5.3).
- Follow-ups for the next fold: A10-1's leg-(b) double-escape regex (suite owner) + the
  coordinated CLI_WEB_COMMANDS/ledger append admission; the two flaky-issue filings when gh
  auth is available.
