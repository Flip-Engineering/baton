# #160 RED-TEAM REPORT — adversarial attack on the error-actionability contract v1

Verdicts per decision, then a numbered blocker list. Verified against the working tree at HEAD
`05cb8f2` ("Baton private effective-tree snapshot") with `grep -an`/`sed -n`; NUL discipline
applied to `impl/src/application.mjs` and `impl/src/coordination-store.mjs`. No wall-clock
claims. The subject is `error-actionability-contract.md` (same dir, v1).

**Headline: NOT FOLD-READY.** The mapped destruction points are real and the repair sequence is
landable, but the contract's *closure claims* do not hold: the family inventory is not closed over
the actual refusal classes on the three surfaces, the scanner is presence-only (shallow-passable
for novel lanes and for the code-only sinks it does not name), and R2 as written leaves five MCP
code-only sinks untouched. Numbered blockers at the end.

---

## 0. CITATION RE-VERIFICATION (every anchor at current HEAD)

Every anchor in G1–G10, D1–D4, §3, §4, §5 was re-run. All anchors locate their claimed code.
Three anchor defects found (each minor, none misleads; listed here so the fold pass can correct
them):

| Anchor | Verdict | Note |
|--------|---------|------|
| `impl/src/workflow-interpreter.mjs:26` | ⚠ off-by-one | `:26` is `function workflowError(message, code) {`; the quoted `Object.assign(new TypeError(message), { code })` is `:27`. Constructors `:29-33` exact. Fix: cite `:27`. |
| `impl/src/mcp-northbound.mjs:1105-1126` (wave tool-validation) | ⚠ range end | The block spans `:1105-1127`; `return 'invalid_workflow_run'` is `:1127`, not `:1126`. Fix: `:1105-1127`. |
| `surface-audit-mcp.md:136b` (D4-R1) | ⚠ non-standard anchor | `:136` is the F3 fix line containing items `(a)`/`(b)`; `136b` = "line 136 item (b)". Content exists; the notation is non-standard. Fix: cite `surface-audit-mcp.md:136` (F3 fix). |
| Header HEAD hash `694029f` | ⚠ stale | Current HEAD is `05cb8f2` (same commit subject). The tree verified identical at every anchor; the hash in the contract header is from the contract session. Fix: re-stamp to the current HEAD. |
| `impl/src/application.mjs:249` for `frameLimitRefusalPath` | ✓ | Usage site (the `gracefulPath` assignment in `coachingApplicationError`) is `:249`; the definition is `impl/src/limits.mjs:45`. Usage anchor is legitimate. |

Every other anchor verified exact, including: `application.mjs:241-243`, `:247-252`, `:3214-3223`
(`application_unauthorized` at `:3222`), `:4522`, `:1957`, `:11684-11697` (throws at `:11687`,
`:11697`); `limits.mjs:54-71` (ADMISSION rows) and `:86` (`spill.body`); `messages.mjs:228-235`,
throw sites `:325`/`:364`; `web-northbound.mjs:185-284` (`dispatchFailure`), `:202-203` (the #41
statement), `:228-230` (TypeError-name arm), `:271` (`worktree_capacity_exceeded`), `:275-281`
(wave arms), `:283` (fallback), `:396-515` (`validateEnvelope`), `:400`/`:412`/`:416`/`:417`,
`:665-682` (`_authorize`), `:667`/`:672`/`:674`/`:680`; `mcp-northbound.mjs:201-279`
(`stateFailureCode`), `:203`, `:209-212` (comment), `:213` (workflow_*), `:218` (wave),
`:224` (`message_budget_invalid`), `:246` (`plan_budget_exceeded`), `:278` (fallthrough),
`:932-953` (`validateArguments`), `:953` (catch), `:1105-1126`, `:1423`, `:1519-1531` (observe
path), `:1641-1659` (stateful catch), `:1651-1652` (LANE_CRAFTED); `application-cli.mjs:1578`,
`:1319-1320`, `:1384`, `:1924`, `:1947-1953`, `:2126`; `impl/scripts/baton.mjs:133`;
`impl/scripts/surface-conformance.mjs:682-747` (executable main `:749-755`);
`impl/scripts/surface-divergence-ledger.json` (`{"schemaVersion":1,"entries":[]}`);
`wave-observability-red.test.mjs:63-130` (row inventory), `:910-972` (A6-1/2/3);
`frame-economics-red.test.mjs:243`/`:251`/`:257` (assertion helpers);
`surface-audit-web.md:140-146` (validator family rows), `:157` (the CLI/MCP-preserve statement),
`:276-282` (F4 400/413 proposal); `surface-audit-mcp.md:91` (E1), `:92` (E2), `:93` (E3), `:94`
(E4); `control-surface-audit.md` §2 #3 (silent reinterpretation).

**Sanity checks that the citations support (all re-run, all hold):** `dispatchFailure` has NO
coaching arm and NO `workflow_*` arm (the only `workflow` occurrence in the file is a comment at
`:45`), so both families degrade as G2 claims. `stateFailureCode` allowlists exactly one
`*_exceeded` code (`plan_budget_exceeded` at `:246`); `message_depth_exceeded` appears only in the
comment at `:222`, never in the allowlist — G5's "exactly ONE" holds. `worktree_capacity_exceeded`
is absent from `stateFailureCode` (the only `worktree` refs are the unrelated
`SESSION_CONTEXT_FIELDS` schema) — the precision note holds. `node impl/scripts/surface-conformance.mjs`
prints `surface-conformance: ok` and exits 0 — G10/S1 hold.

---

## 1. D1 — THE ACTIONABILITY TRIPLE, CLOSED → **HOLE**

**What is SOUND.** The triple shape per surface, the sanitization law, and the honest-absence rule
are well-formed and match the reference implementations (G1, D5.1, A6-1/2/3). The honest-absence
rule as written is NOT gameable into "always absent": it *requires* naming the class in `field`
(`application_unauthorized` → command class, `cli_transport_failed` → web-transport) and the only
code-only class (`command_outcome_unknown`) is required to be reachable only by untyped internal
throws, with R2 + the scanner backing that.

**The hole — the closure is over a subset, not over "every refusal on every surface".** The law
text is unqualified, but the inventory and the gate cover only the eight named families + the
cataloged rows. Three refusal classes escape:

1. **The CLI-local families (~20 distinct codes, ~150 throw sites) are not in the inventory and
   are never repaired.** `grep -oE` over `impl/src/application-cli.mjs` yields `cli_config_invalid`
   (43 sites), `cli_export_archive_invalid` (25), `cli_export_*` (the extract/delivery/digest
   family), `cli_setup_*`, `cli_protocol_failed` (8), `cli_action_inputs_invalid` (2). These carry
   `cliError(message, code)` — code + message prose, no structured `field`, no next action
   (e.g. `:651` `'archive text field has trailing bytes'`). The audit already flags the
   connection-profile member of this class ("connection-profile refusals name no next action",
   `control-surface-audit.md` §2 #8). D1/D2/§3 name only `cli_transport_failed` (F4) and
   `cli_command_unavailable` (F8) for the CLI. So ~20 CLI refusal classes ship code-only forever,
   and the gate passes — directly contradicting the law "every refusal on every surface carries the
   actionability triple".
2. **The web's non-command refusals are not in the vocabulary.** `execute()` emits
   `idempotency_conflict` (`web-northbound.mjs:724`), `application_unavailable` (`:772`),
   `rate_limited` (`:818`), plus the OIDC/lifecycle routes' `invalid_request`, `forbidden`,
   `unsupported_media_type` — all code-only, none in §3, none ledgered. If the law is literal,
   these violate it; if the law is scoped to command refusals, that scope is never stated.
3. **The MCP authority/replay/fence sinks surface codes code-only even after D4.** See D4 — these
   are additional "destruction points" that D1's closure claim does not account for.

**Fix.** Either (a) narrow the law's first sentence to the gate's actual scope ("every *command*
refusal on every surface …", with the CLI-local/web-lifecycle families explicitly ledgered or
scoped out), or (b) extend the inventory: add a CLI-local family row (config/export/setup/protocol
→ class + next action, the doctor/retry hint), and add the web lifecycle refusals to the honest-
absence class list. Option (a) is cheaper and honest; option (b) is the full law. The contract
cannot keep the unqualified law and the eight-family inventory together.

---

## 2. D2 — THE REFUSAL-FAMILY INVENTORY → **SOUND (mapped rows) with one HOLE (leak tension)**

**The mapped destruction points are all real and current** — verified row by row in §0. F1–F8 each
point at a live sink, and the two "COMPLIANT" rows are genuinely the reference/model (F5's MCP
`workflow_*` arm at `mcp-northbound.mjs:213` is before the TypeError fallthrough; F6's
`wave_member_invalid` wrap at `application.mjs:11684-11697` carries `{actual, cap, cause, role}`).
The precision note on `plan_budget_exceeded`/`worktree_capacity_exceeded` is accurate.

**The HOLE — the sanitization law and a declared-COMPLIANT family contradict each other.** D1's law
states "message is the ONE-helper-composed coaching text, never a quoted body value". The
`workflow_*` family's lane-authored messages — declared COMPLIANT ("the model", F5) and live on the
MCP wire today via LANE_CRAFTED (`toolError(stateCode, cause?.message ?? null, …)`) — quote body
values: `the workflow spec field "${key}" is unknown`, `the workflow member role "${duplicate}" is
duplicated`, `workflow member "${named}" … scope entry "${entry}" escapes the member scope class`
(`impl/src/workflow-interpreter.mjs:137`, `:151`, `:194`). These are the caller's own inputs, so
under the actual #41 posture (`web-northbound.mjs:202-203`, "naming it is not an enumeration
surface the way run/worker identifiers are") they are safe — but they violate the contract's own
"never a quoted body value" sentence. As written, either the workflow family is non-compliant
(contradicting F5/§3) or the law is over-broad. No family's target shape leaks a secret-shaped
detail: `actual`/`cap` are byte counts, `field` is a name/role/lane, `gracefulPath` is a bounded
phrase (`limits.mjs:32-34`), the wave `role` is a member role, and the authorize `field` is a
precondition class — none reveal content or third-party identifiers.

**Fix.** Narrow the sanitization law to the coaching family ("the coaching message is the
ONE-helper-composed text, never a quoted body value") and add a one-line carve-out: "lane-authored
families may quote the caller's own field values, never secret- or third-party-shaped values."
This removes the contradiction without loosening the #41 posture.

---

## 3. D3 — CONFORMANCE ENFORCEMENT → **HOLE**

**What is SOUND.** The two-sided gate (behavioral suite + executable conformance main) matches the
CS-1 pattern (G10). The scanner is genuinely shape-only (it computes the vocabulary from
`limits.mjs` refusalCodes ∪ workflow ∪ wave and checks membership against the transport maps /
ledger) — no content reads, so the scanners law holds (S3). The suite/scanner division is stated
honestly: "a refusal can pass the scanner's membership check and still ship without its field/next-
action (behavioral failure)".

**Hole 1 — the scanner cannot distinguish "reachable as a typed triple" from "reachable as a bare
code".** The check is presence-in-the-maps. A vocabulary code added to `dispatchFailure` /
`stateFailureCode` as a code-only arm (`{code, message}` with no `field`/`cap`/`actual`/
`gracefulPath`) passes the scanner. The contract leans on the suite for shape, but the suite's rows
are a static hand-maintained matrix. Add a NEW frame-limit lane to `limits.mjs` (a 15th coaching
row), add its `refusalCode` to the two maps as a code-only arm, and the scanner passes (membership
ok) while the suite has no row for the new lane — **the gate proves the code is mapped, not that
the triple ships**. "Closed by construction" is overstated; it is "closed over the pinned seams".

**Hole 2 — the "unreachable fallback" property is claimed for the scanner but the scanner does not
check the negative direction.** §3 says "the scanner checks that reachability property" (that
`command_outcome_unknown`/`temporarily_unavailable` are unreachable by typed vocabulary codes). The
forward membership check implies it *provided the arms precede the fallback*, which they do in both
maps — so this is actually fine as an implication, BUT only for vocabulary codes. Codes outside the
vocabulary (the D1 escapees) are never checked, so the fallback stays reachable by them by design.

**Hole 3 — the CLI "forwarding path" membership is downstream of the web, and the CLI-local codes
are never scanned.** The CLI rethrows `body?.error?.code` verbatim (`application-cli.mjs:1948-1950`)
so its vocabulary reach is web-bounded; the ~20 CLI-local codes are outside the scanner's
vocabulary and ship code-only without being flagged.

**Fix (concrete).** Add to `checkRefusalActionability()` a second, shape-only check that is
*static* but not merely present: for each vocabulary code's mapped arm, assert the arm object
carries the triple keys required for that family (e.g. coaching codes → `cap`, `actual`, `unit`,
`gracefulPath` present in the arm's body; authorize → `field` ∈ {origin, csrf, repoId, capability};
workflow → `detail` or `message` present). This is still shape-only (identifiers/keys, never
content) and stays within the scanners law. Optionally, enumerate the CLI-local codes into the
ledger so they are explicit rather than invisible. This closes Hole 1; Holes 2–3 close via the D1
scope fix.

---

## 4. D4 — THE REPAIR INVENTORY → **HOLE (R2 incomplete; sequence itself is landable)**

**What is SOUND.** Each repair is keyed to a verified destruction point; the sequencing is correct
(family-by-family green flips); the repairs are local to one edge and pairwise independent (R1+R2
both touch `mcp-northbound.mjs` but disjoint functions; R3+R4 both touch `web-northbound.mjs` but
disjoint functions; R5–R7 single-edge). **The byte-stable refusal pins survive all seven repairs:
**
- The A6-1/2/3 pins (`wave_member_invalid` byte-identical message + `{actual, cap, cause, role}`)
  hold because `wave_member_invalid` is a plain-`Error` code that matches the existing web arms
  `:275-281` and the MCP `:218`/LANE_CRAFTED arms; R3/R7 add *new* arms keyed off `cause.code`
  before the TypeError arm and never touch the wave arms.
- The B2/B3/B4/B5 application-layer pins (`frame-economics-red.test.mjs`, GOLDEN hard-class text)
  hold because R1–R7 operate at the transport edges, not the coaching helpers.
- The web `invalid_command` pins in `phase12-web-northbound.test.mjs` (`:196`, `:465`, `:510`,
  `:554`, `:590`) hold because R4's passthrough applies only "when the cause carries a vocabulary
  code" — a route-shape `ValidationError` (no code) keeps `invalid_command`. (This is worth one
  test in the new suite to pin the boundary: a non-vocabulary arg-shape failure stays
  `invalid_command`, a vocabulary-code failure passes through.)

**The hole — R2 only widens LANE_CRAFTED at ONE of the six MCP error sinks.** The stateful catch
(`:1641-1659`) is repaired, but five other sinks still produce `toolError(stateFailureCode(cause))`
— code-only, no detail, no message:
- the authority seam at `:1460-1463`,
- the observe-path catch at `:1518-1530` (R7 fixes this one, but only by attaching detail; it does
  not retrofit the others),
- the `fleet_drain` replay catch at `:1556-1560`,
- the RECONCILABLE replay catch at `:1587-1591` (**`baton_decision_answer` is in `RECONCILABLE`
  (`mcp-northbound.mjs:141`), so the M2 scenario — over-cap `decision.text` on MCP — can reach this
  path on a same-idempotencyKey retry and surface `decision_text_exceeded` with NO
  `{cap, actual, unit, gracefulPath}`**),
- the fence/authority re-check catch at `:1621`.

After R2, a coaching code reaching any of these surfaces *typed but code-only*: the M2 acceptance
pin ("+ `{cap, actual, unit, gracefulPath}` in `detail`") is satisfied on the stateful path and
violated on the replay path. The D3 scanner passes (the code is in `stateFailureCode`). This is a
live instance of the D1 closure hole inside the contract's own repair scope.

**Fix.** Centralize the LANE_CRAFTED decision into one helper, e.g. `laneCraftedToolError(cause)`
= `LANE_CRAFTED(cause) ? toolError(stateCode, cause?.message ?? null, cause?.detail ?? null) :
toolError(stateCode)`, and use it at ALL six MCP sinks (`:1460`, `:1519-1531`, `:1556`, `:1587`,
`:1621`, `:1641`). Then R2 = add the coaching codes to `stateFailureCode` + replace all six
`toolError(stateFailureCode(cause))` call sites. Add a red row to the matrix pinning the M2 shape
on a replayed `baton_decision_answer`.

---

## 5. REFUSAL VOCABULARY → **HOLE**

The three named families + cataloged rows are correctly enumerated (verified against
`limits.mjs:54-71`/`:86`, `workflow-interpreter.mjs:29-33`, `application.mjs:11684-11697`,
`mcp-northbound.mjs:1105-1126`). The coaching list is exactly the 14 distinct `refusalCode`s
(`spill_body_exceeded` collapsing the four `spill_body_exceeded` lanes; `workflow_spec_invalid`
correctly excluded from coaching because it is the `wave.run.spec_path` lane's code, in the
workflow family). **But the vocabulary is not the set of refusals the law governs**: it omits the
CLI-local families (config/export/setup/protocol/action-inputs, ~20 codes) and the web lifecycle
refusals (`idempotency_conflict`, `rate_limited`, `application_unavailable`, `invalid_request`,
`unsupported_media_type`). Those ship code-only and the gate is silent on them. See D1.

---

## 6. RED-FIRST ACCEPTANCE PINS → **SOUND for the named seams; three seams unpinned**

W1–W6, M1–M4, C1–C2, X1–X2 are each tied to a verified destruction seam and a repair. Three
gaps:
- **No general F2×web pin.** The 503-fallback-unreachability is asserted only per-family (W4
  coaching, W5 workflow). A typed non-vocabulary code reaching the fallback is never pinned; the
  scanner's forward membership check would catch vocabulary codes, but nothing pins "the fallback
  stays reachable only by untyped throws" as a behavior.
- **No replay-path pin (M2 shape on a replayed call).** See D4 — the MCP replay sink is the
  unpinned path where the triple is lost.
- **No CLI-local pin.** The ~20 CLI-local codes are unpinned and unledgered.

S1–S3 are sound; S1 verified executable at HEAD.

---

## 7. OPEN QUESTIONS → each verdict'd

- **OQ1 (web vs MCP audit tension)** — **confirmed real and correctly scoped.** The web audit's
  "the CLI/MCP surfaces preserve them" (`surface-audit-web.md:157`) refers to the
  `coachingApplicationError` lanes (`run.objective` / `run.legacy_send.body`, plain-`Error`
  throws), while the MCP audit E2 measures the `coachingValidationError` lanes (`decision.text` /
  `board.report.body`). Both statements are true of their own throw sites; the reconciliation in
  R2 must keep both lane groups allowlisted. The open question is correctly posed.
- **OQ2 (web 400 vs 413)** — **recommendation sound** (400 shape-class / 413 pure-size), but the
  contract leaves it open and W4 depends on it. Resolve before R3 (pick 400 for
  `spill_body_exceeded`-on-shape rows, 413 for pure size, and pin it).
- **OQ3 (narrowing the web TypeError arm)** — **well-posed and the answer is "no untyped TypeError
  would newly fall through".** Verified: no `application_*` / coaching arm in `dispatchFailure`
  matches by name before the fallback, so an untyped `TypeError` (no code) still hits the
  `:228-230` arm and stays `400 invalid_command`; it does not reach the 503. The MN1/MN8 class
  stays reachable. R3's "keyed off `cause.code`, never `cause.name`" is the correct rule.
- **OQ4 (suite home)** — **new file is right.** The matrix is cross-family by construction; the
  overlap warning (W4↔frame-economics B3, W5/M1↔wave rows) is real and argues for shared fixture
  helpers, not shared files.
- **OQ5 (`waves.run` web detail shape)** — **recommendation sound** (mirror the `wave_member_invalid`
  arms `:275-277`). One payload across all three wave transports is the A6-1/2/3 invariant; a
  slimmer web-only shape would re-open a divergence the pins exist to prevent.

---

## 8. FINAL VERDICT — **NOT FOLD-READY**

Numbered blockers (what + why + concrete fix):

1. **The law overclaims the inventory: ~20 CLI-local refusal codes and the web lifecycle refusals
   are not in the family inventory, the vocabulary, or the ledger, and ship code-only forever.**
   *Why:* D1/D2/§3 claim closure while the actual CLI surface emits `cli_config_invalid` (43),
   `cli_export_*`, `cli_setup_*`, `cli_protocol_failed`, `cli_action_inputs_invalid` (≈150 throw
   sites) with no structured field and no next action; the web emits `idempotency_conflict`,
   `rate_limited`, `application_unavailable`, etc. — none gated. *Fix:* narrow the law to command
   refusals (and ledger the rest), or add these families to the inventory with class + next action
   (the audit §2 #8 doctor hint already points the way).
2. **The D3 scanner is presence-only and can be shallow-passed.** *Why:* a vocabulary code mapped
   as a code-only arm in `dispatchFailure`/`stateFailureCode` passes membership; a novel
   frame-limit lane can be added with no suite row and no triple shape and the gate goes green.
   "Closed by construction" is really "closed over the pinned seams". *Fix:* add a shape-only
   static check that each vocabulary code's mapped arm carries the family's triple keys
   (`cap`/`actual`/`unit`/`gracefulPath` for coaching, `field` for authorize, `message`/`detail`
   for workflow/wave).
3. **R2 repairs only one of six MCP error sinks.** *Why:* the authority (`:1460`), replay
   (`:1556`, `:1587`), fence (`:1621`), and observe (`:1518-1530`) catches all produce
   `toolError(stateFailureCode(cause))` code-only; `baton_decision_answer` is RECONCILABLE, so the
   M2 scenario reaches the replay path and loses `{cap, actual, unit, gracefulPath}` on retry. The
   M2 pin holds only on the stateful path. *Fix:* one `laneCraftedToolError(cause)` helper used at
   all six sinks (R2 + R7 collapse into one edit), plus a replay-path red row.
4. **The sanitization law's "never a quoted body value" is contradicted by the declared-COMPLIANT
   workflow family.** *Why:* the lane-authored `workflow_*` messages quote the caller's own field
   values (`"${key}"`, `"${duplicate}"`, `"${entry}"`), which is #41-safe but violates D1's sentence
   as written. *Fix:* scope the sentence to the coaching family and add the caller-owned-value
   carve-out (§2).
5. **Three acceptance seams are unpinned: the general F2×web fallback-unreachability, the MCP
   replay-path triple, and the CLI-local family.** *Why:* without them the holes in 1–3 have no
   red row to flip. *Fix:* add the rows named in §6.
6. **Minor citation defects to correct on the fold pass:** `workflow-interpreter.mjs:26` → `:27`;
   `mcp-northbound.mjs:1105-1126` → `:1105-1127`; `surface-audit-mcp.md:136b` → `:136` (F3 fix);
   re-stamp the header HEAD hash from `694029f` to the current `05cb8f2`.

Once blockers 1–5 are resolved (blocker 6 is editorial), the contract's D4 sequence is landable
and the byte-stable pins (A6-1/2/3, B2–B5, the phase12 `invalid_command` boundary) survive the
repairs — that part of the fold is ready.
