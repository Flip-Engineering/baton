# #160 implementation contract — error actionability as a gate law (the #41 pattern, enforced) — v1.1 (red-team folded)

Date: 2026-08-13. Status: contract for implementation, **v1.1** — the v1 contract
(`error-actionability-contract.md`, same dir) with the #160 red-team report
(`contract-redteam.md`, same dir) folded in. Every citation was re-verified this fold against the
working tree at HEAD `b0195f2` ("Baton private effective-tree snapshot") with `grep -an`/`sed -n`;
NUL discipline applied to `application.mjs` and `coordination-store.mjs`. No wall-clock claims; no
redesign of what the audit found SOUND or what the red-team verdict'd SOUND. The fold resolves all
six numbered blockers and all five open questions; verdict'd-SOUND substance (G1–G10, the mapped
D2 rows, the byte-stable pins A6-1/2/3, B2–B5, the phase12 `invalid_command` boundary, S1–S3) is
carried forward byte-stable in substance.

**The law this contract enforces.** Every **command** refusal on every surface carries the
actionability triple — (a) the typed code, (b) the offending field/class where one exists, (c) a
next action or graceful path — and a gate PROVES it: a command refusal shipped without the triple
fails the suite and fails the conformance main. The gate's scope is the command surface; the
CLI-local tooling families and the web lifecycle/route refusals are outside it and are ledgered
explicitly (D1 scope, D2 F9, §3 scope note). *This scope sentence is the fold's resolution of
blocker B1 — the v1 unqualified "every refusal on every surface" overclaimed the gate's actual
reach (see fold map, §0).*

**The pattern source.** Issue #41's posture is already stated in-tree at
`impl/src/web-northbound.mjs:202-203`: *"A missing profile is deployment configuration the
authenticated caller can read and fix; naming it is not an enumeration surface the way run/worker
identifiers are."* #41 names the CLASS (a profile) where the VALUE (an identifier) would be an
enumeration surface. #139 ("name the field, never the value"), #129 (silent oversize refusal),
and #105 (typed-error lane codes) are the sibling laws this contract folds under one gate.

---

## 0. FOLD MAP (finding → resolution → where in v1.1)

| Finding (red-team) | Verdict | Resolution | Where in v1.1 |
|---|---|---|---|
| **B1** — the law overclaims the inventory: the CLI-local tooling codes (~22 distinct `cli_*`, ~200 `cliError(` throw sites) and the web lifecycle refusals (`idempotency_conflict`, `rate_limited`, `application_unavailable`, the OIDC/lifecycle `invalid_request`/`forbidden`/`unsupported_media_type`) are in no family, no vocabulary, no ledger, and ship code-only forever | HOLE | **Chosen: option (a) — narrow the law to *command* refusals.** It is the cheaper and honest fix: the gate proves exactly what it can prove, and the audit's §2 #8 doctor hint (`control-surface-audit.md` §2 #8) is the accepted forward path for the CLI family. Option (b) (extending the inventory with class + next action for every tooling code) is the full law and is deferred. The out-of-scope families are enumerated and ledgered as deliberately code-only. | §2 D1 Scope; §2 D2 F9; §3 scope note |
| **B2** — the D3 scanner is presence-only: a vocabulary code added as a code-only arm passes membership, so a novel frame-limit lane with no suite row and no triple shape goes green; "closed by construction" is really "closed over the pinned seams" | HOLE | `checkRefusalActionability()` gains a second, shape-only static check: each vocabulary code's mapped arm must carry the family's triple keys (coaching → `cap`/`actual`/`unit`/`gracefulPath`; authorize → `field` ∈ {origin, csrf, repoId, capability}; workflow/wave → `message` or `detail`). Still shape-only — identifiers/keys, never content. | §2 D3 "Shape check" |
| **B3** — R2 repairs only one of six MCP error sinks; the other five still surface code-only (the observe path carries code+message but no detail), so the M2 shape is lost on the RECONCILABLE replay path | HOLE | Centralize the LANE_CRAFTED decision into one `laneCraftedToolError(cause)` helper used at ALL six MCP sinks (authority `:1460-1463`, observe `:1518-1531`, `fleet_drain` replay `:1556-1560`, RECONCILABLE replay `:1587-1591`, fence `:1621`, stateful `:1641-1659`); R2 = coaching allowlist + all six call sites; **R7 collapses into R2**. | §2 D4 R2/R7; §4 M5 |
| **B4** — the sanitization law's "message is never a quoted body value" is contradicted by the declared-COMPLIANT `workflow_*` family, whose lane-authored messages quote the caller's own field values (`"${key}"`, `"${duplicate}"`, `"${entry}"`, `workflow-interpreter.mjs:137/:151/:194`) | HOLE | Sanitization law scoped to the coaching family; one-line carve-out: lane-authored families may quote the caller's own field values, never secret- or third-party-shaped values. | §2 D1 "Sanitization law"; §4 X3 |
| **B5** — three acceptance seams are unpinned: the general F2×web fallback-unreachability, the MCP replay-path triple, and the CLI-local family | HOLE | Three new pins: W7 (fallback reachable only by untyped throws), M5 (replay triple on a replayed `baton_decision_answer`), C3 (CLI-local codes ledgered code-only). | §4 W7/M5/C3 |
| **B6** — citation defects: `workflow-interpreter.mjs:26`→`:27`; `mcp-northbound.mjs:1105-1126`→`:1105-1127`; `surface-audit-mcp.md:136b`→`:136`; stale header hash `694029f` | editorial | All four corrected; header re-stamped to current HEAD `b0195f2`. | header; §1 G2/G6; §2 D4 R1 |
| **B7** — found on this fold's own re-verify: the wave tool-validation bare surface is at `mcp-northbound.mjs:1421`, not `:1423` as v1 G6 cited | editorial | Citation corrected. | §1 G6; §3 wave family |
| **OQ1** — web vs MCP audit tension on the MCP coaching path | confirmed real, correctly scoped | Resolved: R2 keeps BOTH lane groups allowlisted — the web audit's `coachingApplicationError` lanes (`run.objective`/`run.legacy_send.body`) and the MCP audit's `coachingValidationError` lanes (`decision.text`/`board.report.body`); every `refusalCode` in `limits.mjs:54-71` is added to `stateFailureCode`. | §5 OQ1; §2 D4 R2 |
| **OQ2** — web 400 vs 413 for coaching refusals | recommendation sound | Resolved: 400 for shape-class refusals, 413 for pure size refusals. | §5 OQ2; §4 W4 |
| **OQ3** — narrowing the web TypeError-name arm | well-posed; the answer is "no untyped TypeError would newly fall through" | Resolved: R3 keys off `cause.code`, never `cause.name`; an untyped TypeError still hits the `:228-230` arm and stays `400 invalid_command`. | §5 OQ3; §2 D4 R3 |
| **OQ4** — suite home | new file is right | Resolved: new `error-actionability-red.test.mjs`; shared fixture helpers (imported from the existing suites), not shared files. | §5 OQ4; §2 D3 suite side |
| **OQ5** — `waves.run` web detail shape | recommendation sound | Resolved: mirror the `wave_member_invalid` arms `:275-277`; one payload across all three wave transports — the A6-1/2/3 invariant. | §5 OQ5; §2 D4 R3 |
| **SOUND** — G1–G10 ground truths (after citation fixes), the mapped D2 rows F1–F8, the two COMPLIANT rows, the precision note, the A6-1/2/3 + B2–B5 + phase12 `invalid_command` byte-stable pins, S1–S3 | SOUND | Carried forward byte-stable in substance. | §1; §2 D2; §4 |
| **Minor** — the red-team's "worth one test" boundary: a route-shape `ValidationError` (no code) keeps `invalid_command`; a vocabulary-code failure passes through | SOUND (advice) | Folded in as a new pin. | §4 W8 |

---

## 1. GROUND TRUTHS (re-verified this fold at HEAD `b0195f2`)

**G1 — The triple already EXISTS at the application layer; the edges drop it.** The coaching
helper throws the full triple: `coachingApplicationError` (`impl/src/application.mjs:247-252`)
returns a plain `Error` with `{code, cap, actual, unit: 'bytes', gracefulPath}`; the byte rows it
reads are the cataloged FRAME_LIMITS admission lanes (`impl/src/limits.mjs:54-71`, plus
`spill.body` at `:86`). `coachingValidationError` (`impl/src/messages.mjs:228-235`) does the same
on the messages lane (`code = row.refusalCode ?? 'size_exceeded'`; throw sites `:325`, `:364`).
The D5.1 wrap is the reference implementation of the triple at a transport: a member admission
refusal converts to `wave_member_invalid` carrying `{actual?, cap?, cause, role}`
(`impl/src/application.mjs:11684-11697`, throws at `:11687`, `:11697`), and the web + MCP surfaces
mirror that detail byte-identically (pinned at `impl/test/wave-observability-red.test.mjs:910-972`).

**G2 — The web edge destroys both the coaching payload and the bare `workflow_*` code.**
`dispatchFailure` (`impl/src/web-northbound.mjs:185-284`) is an allowlist of mapped codes ending
in an unconditional fallback at `:283` → `503 temporarily_unavailable` "command dispatch
failed". A coaching refusal (`name === 'ValidationError'`, `code === 'spill_body_exceeded'`,
carrying `{cap, actual, unit, gracefulPath}`) matches NO arm — `dispatchFailure` has no
coaching arm — and degrades to the `503`, code and payload all dropped. A bare `workflow_*`
refusal is thrown as `Object.assign(new TypeError(message), { code })`
(`impl/src/workflow-interpreter.mjs:27`, code constructors `:29-33`), so it matches the
TypeError-name arm at `impl/src/web-northbound.mjs:228-230` → `400 invalid_command` "command
precondition failed", the typed code dropped. The only detail-carrying web arms are
`wave_member_invalid` (`:275-277`) and `wave_not_found` (`:279-281`) — they survive only because
`applicationError` (`impl/src/application.mjs:241-243`) builds a plain `Error`, not a TypeError.

**G3 — The web validator refusals discard the offending field.** `validateEnvelope`
(`impl/src/web-northbound.mjs:396-515`): `unknown_top_level_field` at `:400` — the validator
KNOWS the key (`Object.keys(envelope).find(...)`) and discards it; `unknown_argument_field` at
`:412` — same discard; `application_command_arguments_invalid` at `:416` — swallows the NAMED
validator refusal from `validateApplicationCommandArgs`; `application_wait_timeout_exceeds_web_ceiling`
at `:417` — names a ceiling but not its value (`30_000`). The web audit measures this family at
`surface-audit-web.md:140-146`.

**G4 — Both authorize seams collapse distinct preconditions to one untyped denial.** The web
`_authorize` (`impl/src/web-northbound.mjs:665-682`) returns `error(403, 'forbidden')` for four
independent preconditions — origin mismatch `:667`, CSRF `:672`, repoId `:674`, capability
`:680` — indistinguishable on the wire. The application `_authorize`
(`impl/src/application.mjs:3214-3223`) throws a single `application_unauthorized` at `:3222`,
carrying the command/principal/runId in its inputs but none of them in the throw.

**G5 — The MCP validator swallows every application-command refusal; the dispatch allowlist
skips the coaching family.** `validateArguments` (`impl/src/mcp-northbound.mjs:932-953`) ends
`catch { return 'invalid_run_command'; }` at `:953` — ANY `validateApplicationCommandArgs` throw
degrades. `stateFailureCode` (`:201-279`) allowlists ~250 codes — `workflow_*` at `:213`,
`wave_member_invalid`/`wave_not_found` at `:218`, `message_budget_invalid` at `:224` — then
falls through to `command_outcome_unknown` at `:278`. Among every `*_exceeded` code in the code
base, exactly ONE is allowlisted: `plan_budget_exceeded` (`:246`, the goal/plan budget refusal —
NOT a frame-limit coaching code). The coaching family (`spill_body_exceeded`, `decision_*`,
`board_*`, `scratchpad_*`, … from `limits.mjs:54-71`) is entirely absent → bare
`command_outcome_unknown`. Measured at `surface-audit-mcp.md` E1 (`:91`) and E2 (`:92`).

**G6 — The MCP LANE_CRAFTED mechanism is the compliant message+detail path — but narrow.** The
stateful catch (`impl/src/mcp-northbound.mjs:1641-1659`) attaches message + detail ONLY for
`wave_member_invalid`/`wave_not_found`/`workflow_*` (`LANE_CRAFTED` at `:1651-1652`); every other
typed error stays code-only (`toolError(stateCode)`), the MN1/MN8 sanitization law. The
observe-path catch (`:1518-1531`) carries code + message but NO detail at all — same lane,
different payload (MCP audit E4, `surface-audit-mcp.md:94`). The wave tool-validation refusals
(`invalid_wave_start`/`invalid_wave_progress`/`invalid_wave_send`/`invalid_workflow_run`, produced
at `:1105-1127`, surfaced bare at `:1421`) name no member index, no field (MCP audit E3,
`surface-audit-mcp.md:93`).

**G7 — The CLI forwards the web's code, so its destruction is downstream of the web's — plus one
own swallow and one silent reinterpretation.** The CLI reads `body?.error?.code` and re-throws it
verbatim when it matches the identifier pattern (`impl/src/application-cli.mjs:1948-1950`), so the
CLI cannot exceed the web's actionability. The CLI's own swallow: the fetch catch at
`impl/src/application-cli.mjs:1924` collapses any network failure to `cli_transport_failed`
("Baton Web connection failed") — no class, no next action; same at `:2126` (export download).
The silent reinterpretation: an unknown `run` verb is routed into `parseStart` at
`impl/src/application-cli.mjs:1578` (`if (!lifecycleActions.has(action)) return parseStart(...)`),
turning a typo into a real Run objective (cli F-1, measured at `control-surface-audit.md` §2 #3).
The `waves` branch is the counter-model: it refuses unknown verbs with `cli_command_unavailable`
and the corrective naming (`impl/src/application-cli.mjs:1319-1320`, closed set at `:1384`).
Exit-code taxonomy: `cli_invalid`/`cli_config_invalid`/`cli_command_unavailable` → 2, everything
else (incl. `cli_transport_failed`) → 1 (`impl/scripts/baton.mjs:133`).

**G8 — The MCP `workflow_*` allowlist is the ordering law the web must copy.** The allowlist
entry at `impl/src/mcp-northbound.mjs:213` sits BEFORE the TypeError-name fallthrough, and the
comment at `:209-212` states the rule: *"checked BEFORE the TypeError-name fallthrough so a
workflow_* throw never degrades to invalid_command / command_outcome_unknown."* The web has no
such pre-TypeError check — bare `workflow_*` TypeErrors hit the web's TypeError-name arm at
`:228-230`. This one ordering difference is the whole web-side workflow destruction.

**G9 — The coaching family is closed and helper-composed; its messages are safe by construction.**
The rows are the cataloged FRAME_LIMITS admission lanes (`impl/src/limits.mjs:54-71`), each
with a `refusalCode`; the composed message is built by ONE helper per lane
(`coachingApplicationError` `application.mjs:247-252`; `coachingValidationError`
`messages.mjs:228-235`; `coachingRefusal` `coordination-store.mjs:709-712`). Composed text names
byte counts and field names — never content — so it is #41-safe by construction. Live throw sites
verified: over-spill `run.objective` (`application.mjs:4522`), over-cap `run.legacy_send.body`
(`:1957`), over-cap decision answer (`messages.mjs:357-364`), over-cap board report
(`coordination-store.mjs:14857`).

**G10 — The conformance machinery is shape-only, ledger-gated, and already executable.**
`impl/scripts/surface-conformance.mjs`: `runSurfaceConformanceMain` `:682-747` returns a findings
list; `classifySurfaces` `:163-188`, `checkEnumStrings` `:231`, `checkBannedTokens` `:209`,
`validateLedger` `:275`; the executable main `:749-755` exits 1 on findings and prints
`surface-conformance: ok` otherwise. The divergence ledger
(`impl/scripts/surface-divergence-ledger.json`) is `{"schemaVersion": 1, "entries": []}`. The
scanners law: validate SHAPE (numbers, identifiers, membership), never content — the frame-limit
suite already pins the assertion helpers `assertCoachingPayload` / `assertNamesBothNumbers` /
`assertNoBodyContent` (`impl/test/frame-economics-red.test.mjs:243`, `:251`, `:257`).

**Sanity checks re-run this fold (all hold at HEAD `b0195f2`):** `dispatchFailure` has NO coaching
arm and NO `workflow_*` arm (the only `workflow` occurrence in the file is a comment at `:45`), so
both families degrade as G2 claims. `stateFailureCode` allowlists exactly one `*_exceeded` code
(`plan_budget_exceeded` at `:246`); `message_depth_exceeded` appears only in the comment at `:222`,
never in the allowlist — G5's "exactly ONE" holds. `worktree_capacity_exceeded` is absent from
`stateFailureCode` (the only `worktree` refs are the unrelated `SESSION_CONTEXT_FIELDS` schema at
`mcp-northbound.mjs:154`) — the precision note holds. `node impl/scripts/surface-conformance.mjs`
prints `surface-conformance: ok` and exits 0 — G10/S1 hold. The CLI-local family is large and
code-only: 22 distinct `cli_*` codes across ~200 `cliError(` throw sites in `application-cli.mjs`
(config/export/setup/protocol/action-inputs/connection), none carrying a structured `field` or a
next action — B1's measure.

---

## 2. DECISIONS

### D1 — The actionability triple, closed (scoped to command refusals)

**Scope (fold B1).** The law governs **command refusals** — a refusal whose cause is the command
itself: its arguments, its validation, its authority, or its execution outcome, including the
transport that delivers it (so `cli_transport_failed`, F4, and `cli_command_unavailable`, F8, are
in scope). Two families are explicitly OUT of command scope and are ledgered as deliberately
code-only in `surface-divergence-ledger.json` (the S2 escape hatch), so the gate is silent on them
by declaration, not by omission:
- the CLI-local tooling families (`cli_invalid`, `cli_config_invalid`, `cli_setup_*`,
  `cli_export_*`, `cli_protocol_failed`, `cli_action_inputs_invalid`, `cli_connection_incompatible`,
  `cli_command_failed`, `cli_command_host_local`, `cli_command_pending` — enumerated in §3), and
- the web lifecycle/route refusals (`idempotency_conflict` `web-northbound.mjs:724`,
  `application_unavailable` `:772`, `rate_limited` `:818`, and the OIDC/lifecycle routes'
  `invalid_request`, `forbidden`, `unsupported_media_type`).
The audit's §2 #8 doctor hint (connection-profile refusals name no next action) is the accepted
forward path for the CLI family; option (b) (extending the inventory with class + next action for
these codes) is the full law and is deferred.

**Compliant refusal shape, per surface.**

Web body (`error` object):
```json
{
  "ok": false,
  "error": {
    "code": "<typed lane code>",
    "field": "<field name | member role | class>",
    "actual": "<number, shape-only>",
    "cap": "<number, shape-only>",
    "unit": "bytes",
    "cause": { "code": "<inner typed code>" },
    "gracefulPath": "<next action | null>",
    "message": "<ONE-helper-composed text>"
  }
}
```

MCP tool error: `toolError(code, message, detail)` where `detail` is the same triple
(`{field?, actual?, cap?, unit?, gracefulPath?, cause?}`), attached via the centralized
LANE_CRAFTED gate (D4-R2).

CLI error: `cliError(message, code)` with the web code forwarded (already true at
`application-cli.mjs:1948-1950`); the message names the transport class and a next action for the
`cli_transport_failed` family (D4-R6).

**The triple is three mandatory legs, defined independently.**

- **(a) Typed code.** The lane's refusal code is preserved at the wire. It is a member of the
  closed refusal vocabulary (§3). No command refusal ships as `invalid_command`,
  `command_outcome_unknown`, or `temporarily_unavailable` when its cause carries a typed code.
- **(b) Offending field/class, where one exists.** The field NAME (an envelope key, an arg key,
  a frame-limit lane like `objective`/`decision.text`), a member role (the wave D5.1 `role`), or
  a class. `field` is optional ONLY when the refusal genuinely has no field — then the CLASS is
  named in `field` instead (honest absence, below).
- **(c) Next action or graceful path.** For the coaching family, `gracefulPath`
  (`frameLimitRefusalPath`, `application.mjs:249`). For authorization, the actionable class
  ("origin", "csrf", "repoId", "capability") plus the command class. For transport, a concrete
  next step ("verify connection configuration and retry"). Absent only when the refusal is
  terminal and a human/agent cannot act — then the message says so honestly.

**Sanitization law (the #41 posture).** NEVER the value, NEVER a secret. `field` is a name, never
the offending content; `actual`/`cap` are byte counts (numbers), never the body; the **coaching**
message is the ONE-helper-composed text, never a quoted body value. **Carve-out (fold B4):**
lane-authored families (`workflow_*`; the wave arms) may quote the caller's own field values —
`the workflow spec field "${key}" is unknown` (`workflow-interpreter.mjs:137`), `"${duplicate}"`
(`:151`), `"${entry}"` (`:194`) — but never secret- or third-party-shaped values. These are the
caller's own inputs, so under the actual #41 posture (`web-northbound.mjs:202-203`) they are safe;
they violate no enumeration-surface rule. The in-tree statement of the law is
`impl/src/web-northbound.mjs:202-203`. The negative pin is `assertNoBodyContent`
(`frame-economics-red.test.mjs:257`): a coaching refusal that quotes a value fails the suite; a
lane-authored refusal that quotes the caller's own field value passes (X3). This is
shape-permitting, not content-permitting — the whole #41 point.

**Honest-absence case.** Some refusals HAVE no field. The rule: name the class honestly, never
invent a field, never stay silent.
- `application_unauthorized` — the denial is about the caller's authority over a command, not a
  single argument. `field: "<command class>"`; the web 403 additionally names WHICH precondition
  (origin | csrf | repoId | capability) failed (D4-R5).
- `cli_transport_failed` — the class is the web transport; next action "verify connection
  configuration and retry" (D4-R6).
- `command_outcome_unknown` — by law this class stays code-only (MN1/MN8), but it must only ever
  be reached by an UNTYPED internal throw, never by a typed refusal whose code the allowlist
  knows (D4-R2 is what guarantees that).

### D2 — The refusal-family inventory (closed over the command families; out-of-scope ledgered)

Eight command families plus one ledgered out-of-scope row. Each row: the family, where it is
destroyed today (file:line), and the compliant target shape. The family set is closed over the
command families the gate governs — the suite and the scanner enumerate exactly these rows, and
the scanner's membership + shape checks (D3) flag any command-family lane code that is NOT
reachable as a triple (the fold of B2). The closure claim is "closed over the pinned seams", not
"closed by construction" over refusals the gate does not govern.

| # | Family | Current destruction point(s) | Compliant target shape |
|---|--------|------------------------------|------------------------|
| F1 | **Validator refusals** | web `validateEnvelope`: `unknown_top_level_field` `web-northbound.mjs:400`, `unknown_argument_field` `:412`, `application_command_arguments_invalid` `:416`; MCP `validateArguments` catch → `invalid_run_command` `mcp-northbound.mjs:953` | code preserved + `field` = the offending key / the named validator refusal's code + `field` |
| F2 | **Dispatch swallows** | web `dispatchFailure` fallback `web-northbound.mjs:283`; MCP `stateFailureCode` fallthrough → `command_outcome_unknown` `mcp-northbound.mjs:278` | every allowlisted lane code reachable as a triple; the fallbacks become reachable ONLY by genuinely unmapped internal throws |
| F3 | **Authorize collapse** | web `_authorize` → `403 forbidden` `web-northbound.mjs:667/:672/:674/:680`; application `_authorize` → `application_unauthorized` `application.mjs:3222` | `403` + `field` naming the failed precondition class; `application_unauthorized` + the command class |
| F4 | **Transport failures** | CLI fetch catch → `cli_transport_failed` `application-cli.mjs:1924`, `:2126` | `cli_transport_failed` + class (`web-transport`) + next action |
| F5 | **`workflow_*` family** | web: bare codes destroyed by the TypeError-name arm `web-northbound.mjs:228-230`; MCP: allowlisted `:213` + LANE_CRAFTED `:1651-1652` (**COMPLIANT — the model**) | web mirrors MCP: a pre-TypeError `workflow_*` arm carrying `cause.message` + `cause.detail` |
| F6 | **Coaching size family** | web: `dispatchFailure` fallback `:283`; MCP: `command_outcome_unknown` `:278`; wrapped form `wave_member_invalid` `application.mjs:11684-11697` (**COMPLIANT — the reference**) | code + `{field (lane), actual, cap, unit, gracefulPath}`; web 400/413 (OQ2), MCP LANE_CRAFTED detail |
| F7 | **Wave tool-validation family** | MCP bare codes `invalid_wave_start`/`invalid_wave_progress`/`invalid_wave_send`/`invalid_workflow_run` `mcp-northbound.mjs:1105-1127`, surfaced bare at `:1421` | code + `field` naming the offending member (index/role) + `message` |
| F8 | **Silent reinterpretation** | CLI unknown `run` verb → `parseStart` `application-cli.mjs:1578` | refuse with `cli_command_unavailable` + the closed verb set (mirror the waves branch `:1319-1320`, `:1384`) |
| F9 | **CLI-local tooling + web lifecycle (OUT of command scope)** | CLI config/export/setup/protocol/action-inputs: ~20 distinct `cli_*` codes code-only across `application-cli.mjs`; web lifecycle: `idempotency_conflict` `:724`, `application_unavailable` `:772`, `rate_limited` `:818`, OIDC/lifecycle `invalid_request`/`forbidden`/`unsupported_media_type` | **ledgered deliberately code-only** (fold B1): enumerated in `surface-divergence-ledger.json` via the S2 escape hatch; the audit §2 #8 doctor hint is the accepted forward path. No triple repair in this contract. |

Precision note: `plan_budget_exceeded` is the one `*_exceeded` code in the MCP allowlist
(`mcp-northbound.mjs:246`) and the web `400` goal/plan list — it is the goal/plan BUDGET refusal
(tokens), not a frame-limit coaching code, and is out of scope for the coaching family. It stays
as-is; it is not part of F6. A second non-coaching `*_exceeded` code, `worktree_capacity_exceeded`,
is web-mapped at `web-northbound.mjs:271` to `503` with a next-action message ("free repository
volume space or raise the deployment capacity floors, then retry") — a small in-tree example of
the (c) leg — but it is also absent from `stateFailureCode` and degrades to
`command_outcome_unknown` on MCP; it is outside F6's byte-lane family and its MCP gap should be
closed in the same pass as R2.

### D3 — Conformance enforcement (how the gate proves it)

The gate has two sides, both required, matching how CS-1 works today (behavioral suite +
executable conformance main).

**Suite side (red-first, behavioral).** A new `impl/test/error-actionability-red.test.mjs` with
the row-inventory idiom from `wave-observability-red.test.mjs` (`:63-130` row inventory; A6-1/2/3
at `:910-972`) and the assertion helpers from `frame-economics-red.test.mjs` (`assertCoachingPayload`
`:243`, `assertNamesBothNumbers` `:251`, `assertNoBodyContent` `:257`). One RED row per
(family × transport), each with a `stage:` comment naming the HEAD failure seam and the 
positive + negative fixture pair. The suites drive INVENTED seams — the fixtures construct the
refusal at the edge (over-cap objective, over-cap decision text, unknown field, malformed spec,
authorize denial per precondition, network refusal) and assert the triple on the wire.

**Static side (shape-only, in the conformance main).** A new
`checkRefusalActionability()` in `impl/scripts/surface-conformance.mjs`, appended to
`runSurfaceConformanceMain` (`:682-747`), so `node impl/scripts/surface-conformance.mjs` fails on
novel un-actionable refusals and prints `surface-conformance: ok` when the vocabulary is closed.
Per the scanners law, it is shape-only: it computes the closed refusal vocabulary from the
cataloged rows (`limits.mjs:54-71` refusalCodes) ∪ the `workflow_*` family ∪ the wave family, then
checks **membership** — that every vocabulary code is reachable as a typed triple at each
transport edge (present in `dispatchFailure` / `stateFailureCode` / the CLI forwarding path or
explicitly ledgered in `surface-divergence-ledger.json`). It never reads or quotes message
content.

**Shape check (fold B2).** `checkRefusalActionability()` adds a second, static-but-not-merely-
present test: for each vocabulary code's mapped arm, assert the arm object carries the triple keys
required for that family —
- coaching codes → `cap`, `actual`, `unit`, `gracefulPath` present in the arm's body (F6);
- authorize → `field` ∈ {origin, csrf, repoId, capability} (F3);
- workflow/wave → `detail` or `message` present (F5/F7).
This is still shape-only (identifiers/keys, never content) and stays within the scanners law. It
closes the shallow-pass: a vocabulary code added to `dispatchFailure`/`stateFailureCode` as a
code-only arm (no triple keys) is now a red finding even though membership is satisfied.

The ledger is the escape hatch for a deliberate code-only refusal, exactly as it is for name
divergence today. Under D1's scoping, the CLI-local tooling and web lifecycle families are the
deliberate code-only entries (F9); the fallbacks (`command_outcome_unknown`, `temporarily_unavailable`)
stay reachable by untyped throws, which is now also pinned behaviorally (W7).

**Where each check lives.** Behavior → the red-first suite (it can assert message bytes and
detail shapes). Membership/shape → the conformance main (it is ledger-gated and runs in CI as the
executable gate). Neither subsumes the other: a refusal can pass the scanner's membership check
and still ship without its field/next-action (behavioral failure), and a novel code can be
absent from the scanner's vocabulary while every existing row passes.

### D4 — The repair inventory (named destruction points → fixes, sequenced family-by-family)

Each fix is keyed to a destruction point named in D2. The sequence is chosen so the suite flips
green family-by-family; every step is local to one edge.

| # | Repair | Destruction point | Exact change |
|---|--------|-------------------|--------------|
| R1 | **MCP validator passthrough** | F1 — `mcp-northbound.mjs:953` | In `validateArguments`, when `validateApplicationCommandArgs` throws a code from the closed vocabulary, return that code (with `field`/detail) instead of collapsing to `invalid_run_command`. Mirror the MCP audit's own fix (`surface-audit-mcp.md:136`). |
| R2 | **MCP coaching allowlist + centralized LANE_CRAFTED at all six sinks** | F2/F6 — `mcp-northbound.mjs:278`, `:1460-1463`, `:1518-1531`, `:1556-1560`, `:1587-1591`, `:1621`, `:1641-1659` | Add the coaching family rows to `stateFailureCode` (each `refusalCode` from `limits.mjs:54-71` → its own code, like `workflow_*` at `:213`, BEFORE the fallthrough). Centralize the LANE_CRAFTED decision into one helper — `laneCraftedToolError(cause)` = `LANE_CRAFTED(cause) ? toolError(stateCode, cause?.message ?? null, cause?.detail ?? null) : toolError(stateCode)` — and use it at ALL six MCP error sinks: the authority seam (`:1460-1463`), the observe-path catch (`:1518-1531`), the `fleet_drain` replay catch (`:1556-1560`), the RECONCILABLE replay catch (`:1587-1591`), the fence/authority re-check (`:1621`), and the stateful catch (`:1641-1659`). This replaces every `toolError(stateFailureCode(cause))` call site and folds R7 into R2. Safe because the composed message is #41-safe by construction (G9); the replay path — where a replayed `baton_decision_answer` (RECONCILABLE, `:141`) can reach on a same-idempotencyKey retry — now carries the same `{cap, actual, unit, gracefulPath}` detail as the stateful path. |
| R3 | **Web coaching + workflow arms** | F2/F5/F6 — `web-northbound.mjs:228-230`, `:283` | Add a `workflow_*` prefix arm BEFORE the TypeError-name arm (copy the MCP ordering law, G8) carrying `cause.message` + `cause.detail`; add a coaching arm mapping each `refusalCode` + `{field: lane, actual, cap, unit, gracefulPath}` to 400/413 (OQ2) — both keyed off `cause.code`, never `cause.name`. |
| R4 | **Web validator field naming** | F1 — `web-northbound.mjs:400/:412/:416` | `unknown_top_level_field` → include the key the validator already found; `unknown_argument_field` → include the arg key; `application_command_arguments_invalid` → pass through the named validator refusal when the cause carries a vocabulary code. |
| R5 | **Authorize precondition naming** | F3 — `web-northbound.mjs:667-682`, `application.mjs:3222` | Web 403 body gains `field` naming which precondition failed (origin\|csrf\|repoId\|capability) and `message` naming the command class; application `_authorize` includes the command in the thrown detail. |
| R6 | **CLI transport class + verb refusal** | F4/F8 — `application-cli.mjs:1924`, `:1578` | `cli_transport_failed` message names the transport class + next action; unknown `run` verb → `cli_command_unavailable` + the closed verb set (copy the waves branch `:1319-1320`). |
| R7 | **(merged into R2)** | F7/E4 — `mcp-northbound.mjs:1518-1531` | The observe-path detail is one of the six sinks covered by R2's `laneCraftedToolError`; the wave family carries the same payload regardless of which tool raises it. No separate edit. |

Sequencing for green flips: R1+R2 (MCP validator + coaching + all six sinks) → R3+R4 (web
coaching + workflow + validator) → R5 (authorize) → R6 (CLI). R7 is folded into R2. Each row's red
test flips when its repair lands.

**Byte-stable pins that survive all repairs (red-team §4, re-confirmed this fold):**
- The A6-1/2/3 pins (`wave_member_invalid` byte-identical message + `{actual, cap, cause, role}`)
  hold because `wave_member_invalid` is a plain-`Error` code that matches the existing web arms
  `:275-281` and the MCP `:218`/LANE_CRAFTED arms; R3/R7 add *new* arms keyed off `cause.code`
  before the TypeError arm and never touch the wave arms.
- The B2/B3/B4/B5 application-layer pins (`frame-economics-red.test.mjs`, GOLDEN hard-class text)
  hold because R1–R6 operate at the transport edges, not the coaching helpers.
- The web `invalid_command` pins in `phase12-web-northbound.test.mjs` (`:196`, `:465`, `:510`,
  `:554`, `:590`) hold because R4's passthrough applies only "when the cause carries a vocabulary
  code" — a route-shape `ValidationError` (no code) keeps `invalid_command`. Pinned at W8.

---

## 3. REFUSAL VOCABULARY (closed, per surface; command-scoped)

The vocabulary the gate recognizes. It is closed over the command families by the cataloged rows
plus the three named families; the scanner (D3) enforces closure. The out-of-scope families are
enumerated below so the gate is silent on them by declaration.

**Coaching size family** — one row per cataloged lane, code = `row.refusalCode`:
`spill_body_exceeded`, `decision_question_exceeded`, `decision_need_exceeded`,
`decision_rationale_exceeded`, `orientation_note_exceeded`, `steering_focus_exceeded`,
`board_title_exceeded`, `board_detail_exceeded`, `board_report_exceeded`,
`run_legacy_send_exceeded`, `decision_option_label_exceeded`, `decision_option_summary_exceeded`,
`decision_text_exceeded`, `scratchpad_entry_exceeded` (`impl/src/limits.mjs:54-71`, `:86`).
Triple: `{code, field: <lane>, actual, cap, unit: 'bytes', gracefulPath}`.

**`workflow_*` family** — `workflow_spec_invalid`, `workflow_member_invalid`,
`workflow_steering_unknown`, `workflow_harvest_invalid`, `workflow_objective_ref_invalid`
(`impl/src/workflow-interpreter.mjs:29-33`). Triple: `{code, field: <spec field | member role>,
message: <lane-authored>, detail}`. COMPLIANT on MCP today (D2-F5); the web mirrors MCP after R3.

**Wave family** — `wave_member_invalid` (`{actual?, cap?, cause, role}`, `application.mjs:11684-11697`),
`wave_not_found`, plus the tool-validation codes `invalid_wave_start`, `invalid_wave_progress`,
`invalid_wave_send`, `invalid_workflow_run` (`mcp-northbound.mjs:1105-1127`). The first two are
COMPLIANT on web + MCP today (D2-F6); the tool-validation codes need the member pointer (R2's
observe-path sink).

**Authorize family** — `application_unauthorized` (application.mjs:3222), `forbidden` (web
`_authorize`, `stateFailureCode` `:203`). Triple gains the failed precondition class (R5).

**Transport family** — `cli_transport_failed` (`application-cli.mjs:1924`, `:2126`), plus the
forwarded web codes. Triple gains class + next action (R6).

**Sanitized fallback** — `command_outcome_unknown` (MCP `:278`) and `temporarily_unavailable`
(web `:283`) remain as the MN1/MN8 code-only class for UNTYPED internal throws. After D4 they are
unreachable by any typed vocabulary code; the scanner checks that reachability property and W7
pins it behaviorally.

**Ledgered OUT-of-command-scope (fold B1; F9).** Deliberately code-only, present in
`surface-divergence-ledger.json` via the S2 escape hatch, no triple repair in this contract:
- **CLI-local tooling** (`application-cli.mjs`, first-appearance order): `cli_invalid`,
  `cli_config_invalid`, `cli_setup_remote_unavailable`, `cli_setup_remote_invalid`,
  `cli_setup_remote_refused`, `cli_setup_conflict`, `cli_setup_failed`,
  `cli_export_archive_invalid`, `cli_export_archive_digest_mismatch`,
  `cli_export_destination_exists`, `cli_export_destination_invalid`, `cli_export_extract_failed`,
  `cli_export_delivery_invalid`, `cli_export_download_failed`, `cli_command_host_local`,
  `cli_command_pending`, `cli_command_failed`, `cli_protocol_failed`,
  `cli_action_inputs_invalid`, `cli_connection_incompatible` (20 codes). `cli_command_unavailable`
  (F8) and `cli_transport_failed` (F4) are in scope and are NOT ledgered.
- **Web lifecycle/route** (`web-northbound.mjs`): `idempotency_conflict` `:724`,
  `application_unavailable` `:772`, `rate_limited` `:818`; the OIDC/lifecycle routes'
  `invalid_request`, `forbidden`, `unsupported_media_type`.

---

## 4. RED-FIRST ACCEPTANCE PINS

The suite rows that must flip red at HEAD (each with its `stage:` seam) and green after D4. Rows
are enumerated family × transport; the acceptance gate is the full matrix green. Rows W7, W8, M5,
C3, X3 are the fold's new pins (B5 + the W8 boundary the red-team called "worth one test").

| Row | Family × transport | Assertion (the triple on the wire) |
|-----|--------------------|-------------------------------------|
| W1 | F1 × web | `unknown_top_level_field` body names the offending key in `field` |
| W2 | F1 × web | `unknown_argument_field` body names the offending arg key |
| W3 | F1 × web | a `run.act` exactObject refusal surfaces the named validator refusal, not `application_command_arguments_invalid` |
| W4 | F6 × web | over-spill `run.objective` → 400/413 (not 503), `field: objective`, `{actual, cap, unit, gracefulPath}` present, `assertNoBodyContent` passes |
| W5 | F5 × web | `waves.run` malformed spec → `workflow_spec_invalid` (not `invalid_command`) with the spec field named |
| W6 | F3 × web | `_authorize` denial per precondition → 403 + `field` ∈ {origin, csrf, repoId, capability} |
| W7 | F2 × web (general, fold B5) | **the 503 fallback stays reachable ONLY by untyped internal throws** — an untyped internal throw maps to `temporarily_unavailable`; every typed vocabulary code maps to its triple arm, none degrades to the fallback (the general form of W4/W5, no family-specific arm) |
| W8 | F1 × web (boundary, fold Minor) | a route-shape `ValidationError` with NO vocabulary code stays `invalid_command` (the phase12 pins `:196/:465/:510/:554/:590` hold); a vocabulary-code validator failure passes through its named code (R4) |
| M1 | F1 × MCP | over-cap objective → the coaching code (not `invalid_run_command`) + `{cap, actual}` |
| M2 | F6 × MCP | over-cap `decision.text` → `decision_text_exceeded` (not `command_outcome_unknown`) + `{cap, actual, unit, gracefulPath}` in `detail` |
| M3 | F7 × MCP | `invalid_wave_start` carries the offending member (index/role) in `field` |
| M4 | F7/E4 × MCP | observe-path `waves.progress` refusal carries the same detail as the stateful path |
| M5 | F6 × MCP replay (fold B3/B5) | over-cap `decision.text` **replayed on a same-idempotencyKey retry** of `baton_decision_answer` (RECONCILABLE, `mcp-northbound.mjs:141`) → `decision_text_exceeded` with `{cap, actual, unit, gracefulPath}` in `detail` on the replay path, not `command_outcome_unknown` |
| C1 | F4 × CLI | `cli_transport_failed` message names the transport class + a next action |
| C2 | F8 × CLI | `baton run shwo` → `cli_command_unavailable` + closed verb set (no silent `run.start`) |
| C3 | F9 × CLI (fold B1/B5) | the CLI-local tooling codes (§3) are explicitly present in `surface-divergence-ledger.json` as deliberately code-only; a novel unledgered `cli_*` tooling code is a red conformance finding (S2 applies) |
| X1 | sanitization negative | a triple-absent refusal (code-only, no field, no next action) fails the assertion helper |
| X2 | sanitization negative | a coaching refusal quoting a value/secret fails `assertNoBodyContent` |
| X3 | sanitization carve-out (fold B4) | a lane-authored `workflow_*` refusal quoting the caller's own field value (`the workflow spec field "${key}" is unknown`, `workflow-interpreter.mjs:137`) passes the sanitization negative; a lane-authored refusal quoting a secret- or third-party-shaped value still fails |

Static pins: **S1** — `node impl/scripts/surface-conformance.mjs` prints `surface-conformance:
ok` (exit 0) once the vocabulary is closed; **S2** — a novel refusal code not reachable as a
triple at an edge is a red conformance finding (ledgerable); **S3** — the scanner itself passes
`assertNoBodyContent` (it never quotes content — shape-only), including the D3 shape-key check.

---

## 5. OPEN QUESTIONS → RESOLVED

**OQ1 — Audit tension on the MCP coaching path.**
`surface-audit-web.md:157` states *"The CLI/MCP surfaces preserve them [the coaching payload]"*,
while `surface-audit-mcp.md` E2 (`:92`) and the direct read of `stateFailureCode`
(`mcp-northbound.mjs:278`) show coaching codes degrade to `command_outcome_unknown`. **Resolved
(fold):** the tension is real and both statements are true of their own throw sites — the web
audit measures the `coachingApplicationError` lanes (`run.objective`/`run.legacy_send.body`,
plain-`Error` throws); the MCP audit E2 measures the `coachingValidationError` lanes
(`decision.text`/`board.report.body`). R2's `stateFailureCode` additions cover **every**
`refusalCode` in `limits.mjs:54-71`, keeping BOTH lane groups allowlisted; no lane group is
dropped.

**OQ2 — Compliant web HTTP status for coaching refusals.** **Resolved:** 400 for shape-class
refusals, 413 for pure size refusals (the web audit F4 proposal, `surface-audit-web.md:276-282`);
W4 pins the status per refusal. Resolved before R3.

**OQ3 — Narrowing the web TypeError-name arm.** **Resolved:** no untyped `TypeError` would newly
fall through — no `application_*`/coaching arm in `dispatchFailure` matches by name before the
fallback, so an untyped `TypeError` (no code) still hits the `:228-230` arm and stays `400
invalid_command`; it does not reach the 503. R3 keys off `cause.code`, never `cause.name`. The
MN1/MN8 class stays reachable.

**OQ4 — Suite home.** **Resolved:** a new `impl/test/error-actionability-red.test.mjs` — the
matrix is cross-family by design and the row inventory is cleanest standalone. The overlap warning
(W4↔frame-economics B3; W5/M1↔wave rows) argues for shared fixture helpers (imported), not shared
files.

**OQ5 — `waves.run` web detail shape.** **Resolved:** mirror the `wave_member_invalid` arms
`web-northbound.mjs:275-277` — one payload across all three wave transports, which is the A6-1/2/3
invariant. A slimmer web-only shape would re-open a divergence the pins exist to prevent.
