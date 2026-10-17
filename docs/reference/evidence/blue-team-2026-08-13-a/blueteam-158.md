# BLUE-TEAM REPORT — row-bt158: scratchpad-write-red.test.mjs

[attempt: 08338cdd-d549-4375-98ee-af1a313938d5 row-bt158]

Target: `impl/test/scratchpad-write-red.test.mjs` (24 rows, 18 RED + 6 PIN).
Authority contract: `docs/reference/evidence/scratchpad-write-2026-08-13/contract-fold.md` v1.1
(plus `contract-redteam.md`, `scratchpad-write-contract.md` in the same dir).

Binding frame: `foundry-brief.md` (blue-team law, master b6eef44). Verdict scale: SOUND /
SHALLOW / DECORATIVE / BROKEN per row; ACCEPT / NEEDS-FOLD per suite. Every capability row gets
the cheapest wrong implementation that turns it green (or "none found" + one line); every PIN
row gets the plausible wrong impl it kills (or "decorative").

---

## 1. Split verification — run twice against a pristine copy of master's suite

The suite is red-first: `impl/test/scratchpad-write-red.test.mjs` is checked in on `master` (not
present in this worktree — the worktree constraint confines writes to
`docs/reference/evidence/blue-team-2026-08-13-a/**`, so the suite cannot be checked out here).
Runs were therefore executed against a pristine copy at `/tmp/bt158-verify/impl`: the suite from
`git show master:impl/test/scratchpad-write-red.test.mjs`, the sources byte-identical to this
worktree's `impl/src` (verified `diff -r` clean), `node_modules` symlinked for `@ast-grep/napi`.

Command (exact): `node --test-reporter=tap test/scratchpad-write-red.test.mjs` (cwd
`/tmp/bt158-verify/impl`; the spec reporter gives the same verdict — 24/6/18 — and identical
failing-test names).

| Run | tests | pass | fail | skipped |
|-----|-------|------|------|---------|
| 1 | 24 | 6 | 18 | 0 |
| 2 | 24 | 6 | 18 | 0 |

- **Identical across both runs** — pass/fail name sets match byte-for-byte (verified `diff` on the
  `ok`/`not ok` TAP lines; only timings differ); the counts match the suite's declared notes
  (24 rows, 6 GREEN / 18 RED, `suite-draft-notes.md`, HEAD e371f70) and the suite's own header.
- **Every red fails at its named stage** — the first failing assertion is the `stage[<name>]`
  assert in each red row (verified in run output; 18 distinct stage names, none shared by two
  reds). GREEN legs and fixture construction pass before the stage assert fires.
- **GREEN 6** — P-A1, P-A4, P-A5, P-A6, P-A7, P-A10. **RED 18** — A1-1, A1-2, A2-1, A2-2,
  A2-3, A3-1, A3-2, A4-1, A4-2, A5-1, A6-1, A7-1, A7-2, A7-3, A8-1, A9-1, A9-2, A10-1.
- **Hermetic** — per-test `mkdtempSync` git repos + `rmSync` cleanup, `MockAdapter` only (no
  network/provider), fixed `NOW`, event-seq projections only. No test is skipped.

All source anchors cited below were re-verified at HEAD e371f70 via NUL-discipline grep
(`execFileSync grep -an` for `application.mjs`/`coordination-store.mjs`) or whole-file reads of
the NUL-free sources.

---

## 2. Capability rows — the cheapest wrong implementation that turns each row green

### CLI surface

**A1-1 `cli-append-branch-missing` — SHALLOW (bite-tested green).** The row asserts
`parseBatonCli(['run','scratchpad','append','run:m1','--scope','shared','--kind','note',
'--body','handoff note'])` resolves to `{kind:'command', name:'run.scratchpad.append',
args:{runId:'run:m1', scope:'shared', kind:'note', body:'handoff note'}}`, then
`args.kind === 'note'`. Cheapest wrong impl: a `sub === 'append'` branch that special-cases THIS
argv shape and returns the closed object (hardcoded `--scope shared`, `--kind note`, body
passthrough) — **confirmed green**: an unvalidating branch (flags parsed, body passed as raw
string, no scope-pattern check) flips the row. It goes green; only A1-2's different argv (plan +
worker scope) and A10-1's coherence leg catch the special-casing, not A1-1 itself.

**A1-2 `cli-append-json-shape-missing` — SHALLOW (bite-tested green).** The row JSON-parses a
`--kind plan` body into the closed `{objective, steps}` shape and requires a malformed body to
refuse `cli_invalid` naming JSON. Cheapest wrong impl: `JSON.parse` every non-note body,
deep-equal on the specific inputs, and a `cliError('body must be JSON…')` on parse failure —
**confirmed green**: a passthrough `JSON.parse` of non-note bodies flips the row without any
shape validation against `normalizeScratchpadEntry` (coordination-store.mjs:607-696). The H2.3
closed shape is not pinned, only "JSON.parse happened".

### MCP surface

**A2-1 `mcp-append-tool-missing` — SHALLOW (bite-tested green).** The row asserts
`mcpApplicationToolNames()` includes the tool, `tools/list` advertises it with the closed
inputSchema, and a capability-map grep line exists. Cheapest wrong impl: advertise-only — add the
tool to the capability map and a static `tools/list` entry with no `_dispatch` branch.
Advertised-but-dead turns it green — **confirmed**: a capability-map row plus a tool-def in the
ordinary-definitions feed flips the row with zero dispatch wiring.

**A2-2 `mcp-append-dispatch-branch-missing` — SHALLOW (empirically weaker than named).** The row
drives `tools/call` and asserts `call?.result !== undefined` (dispatched, never the absent-tool
-32602). Cheapest wrong impl: a `_dispatch` branch that returns ANY canned tool result (a
fabricated `{ok:true, result:'written', …}`) without calling `application.command` or writing
anything. **Bite-tested stronger:** an advertise-only impl with NO dispatch branch at all also
turns the row green — the admitted tool routes through the generic application branch, whose
`application_command_unavailable` throw becomes a tool result with `isError:true`, so
`call.result !== undefined` holds. The row's "dispatch" is satisfiable by dead plumbing; it does
not even require the branch it names. No round-trip read exists anywhere in the suite (see §3,
finding F5), so the receipt is never verified against the store.

**A2-3 `mcp-append-admission-missing` — BROKEN-on-platform + law violation.** Static greps: a
`TOOL_DEFINITIONS` entry, an `ORDINARY_EXPLICIT_TOOLS` mention inside an absolute line window
(`row.line > 700 && row.line < 900`), and a `_dispatch` branch string. The dispatch leg is
`grep -anE "else if (name === 'baton_run_scratchpad_append')"` — **unescaped parens**. On BSD
grep (darwin's `/usr/bin/grep`, which the suite's `grepLines` calls), an ERE `(name === '…')`
is a GROUP, so the pattern can never match the literal `else if (name === '…')` text — verified
against the EXISTING read branch at mcp-northbound.mjs:1900 (`else if (name ===
'baton_run_scratchpad_read')`), which the unescaped pattern does NOT match while the escaped
`\(…\)` does. The append dispatch leg is therefore unreachable-green on this platform: even a
fully-correct `_dispatch` branch cannot satisfy the grep. The row is a law violation on top
(no-absolute-line-window-anchor, see §4), and its other two legs are pure string-presence greps
(advertise-only passes them).

### Web surface

**A3-1 `web-append-dispatch-missing` — SHALLOW.** The row drives `web.execute` with a
`run_scratchpad_append` envelope and asserts `status === 200` and `body.ok === true`. Cheapest
wrong impl: admit the transport in `COMMAND_CAPABILITY` (+ `ARG_FIELDS`) and return a canned
receipt `{ok:true, result:'written', …}` from the dispatcher. **Bite-tested:** admission alone
does NOT suffice — the envelope passes `validateEnvelope` but the unhandled transport reaches the
tail `json(undefined)` and the dispatch throws; the canned receipt branch is required. So the
row does pin *a* dispatch seam, but the seam is satisfiable by a fabricated receipt with zero
writes (again: no round-trip read).

**A3-2 `web-append-admission-missing` — SHALLOW (bite-tested green).** Static region checks for
the four tables (`COMMAND_CAPABILITY`, `ARG_FIELDS`/`ACCEPTED_ARG_FIELDS`, `APPLICATION_COMMAND`,
`WEB_DIRECT_PORT_COMMANDS`). Cheapest wrong impl: sprinkle the transport name in all four tables
without a dispatch — **confirmed green** with four real table literals and no dispatch wiring.
(The `WEB_DIRECT_PORT_COMMANDS` region check truncates at the first `// ` comment token, so the
literal must sit inside the set definition itself — a minor fixture fragility, not a blocker.)
The H2.1 four-table admission is pinned as string presence, not behavior.

### D1 write-law seam (deployment)

**A4-1 `append-restrictor-missing` — SHALLOW (fold-blocking).** The GREEN legs call
`fx.authorize(...)` where `fx.authorize` is the suite's OWN invented `appendRestrictor` installed
at the fixture seam (application.mjs:3214-3222 drives it only in the hermetic test path). The
GREEN legs are self-referential: they prove the suite's copy of the law, not the deployment's.
The RED leg is a single string-presence grep — `run\.scratchpad\.append` must appear anywhere in
`application-deployment.mjs`. Cheapest wrong impl: add a comment (`// run.scratchpad.append must
be restricted`) or any dead string to the deployment file. The D1 cross-partition refusal is
NEVER asserted against the deployed seam. The production write law is unpinned.

**A4-2 `own-run-predicate-missing` — SHALLOW (fold-blocking).** Same fixture-installed restrictor
GREEN legs (self-referential H1.1 predicate). RED leg: `_getWorker` must appear anywhere in
`application-deployment.mjs` — a bare mention (even a comment, or an unrelated `_getWorker`
symbol) turns it green. The seat-resolver wiring — that the deployed restrictor actually
RESOLVES a member's active run rather than trusting the caller's `runId` — is never asserted.

**A5-1 `review-authority-append-missing` — SHALLOW (fold-blocking).** Same fixture GREEN legs for
law 3 (local-owner/service-* shared-only). RED leg: identical `run\.scratchpad\.append`
string-presence grep as A4-1. A comment turns it green. The review-authority posture at the
deployment seam is undefined in the test.

**Combined finding (F1):** the D1 write law (laws 2, 3 and the H1.1 own-run predicate) is proven
only against the suite's invented restrictor and pinned at the deployment seam only by thin
string presence. `P-A5` bans only the exact literal `authorize: async () => true,` (trailing
comma) — a permissive append wired as `authorize: async () => true` (no comma) or
`authorize: () => true` escapes it. A deployment that installs any restrictor-less append path
with any of the strings present goes all-green on A4-1/A4-2/A5-1.

### Law 4 — ephemeral write, not candidacy mint

**A6-1 `append-candidacy-shortcut-missing` — SHALLOW (fold-blocking).** The GREEN leg confirms the
elevate branch exists (the pre-existing candidacy mint). The RED leg asserts (1) a
`name === 'run.scratchpad.append'` branch exists in `application.mjs`'s direct-port block, and
(2) that branch's line ≠ the elevate branch's line. **Bite-tested even cheaper than named:** a
bare COMMENT line (`// bite-A6-1: name === 'run.scratchpad.append' …` on a different line)
flips the row green — the RED leg is pure string presence + line-difference; it never checks the
branch routes anywhere. The ephemeral guarantee (law 4: an append never mints a
scratch-fact/KG candidate) is never behaviorally asserted; only same-line aliasing is killed,
and even that is killed only for the literal grep match, not for an aliased route.

### D3 bounds and replay

**A7-1 `append-body-limit-missing` — SHALLOW.** The row drives a >8192 B body through the surface
and asserts the single typed refusal `scratchpad_entry_exceeded`. Reachable under a correct
impl (empty partition, oversize body). Cheapest wrong impl: a blanket refusal of every append
with that code (passes; the "only at the bound" half is unpinned because no under-bound append
is asserted to succeed here). The blanket impl is caught elsewhere in the suite (A1-1/A2-2/A3-1
need a written receipt), so this is per-row SHALLOW, not suite-breaking.

**A7-2 `append-shared-cap-missing` — BROKEN (inert fixture).** The row opens a fresh `lawFixture`
(empty store) and asserts that a SINGLE append with a small body refuses
`scratchpad_partition_exhausted` as "the 513th shared append". Under a correct #158
implementation the shared partition starts at 0 entries, so the append writes entry #1 and
resolves `ok:true` — the `stageAssert(attempt.ok === false)` can never pass under a correct
impl. **Bite-tested:** the ONLY cheap wrong impl that turns it green is a blanket
`if (scope === 'shared') throw scratchpad_partition_exhausted` refusal of every shared append
(no counting, no 512th threshold) — i.e. the row's only green path is an impl that refuses
regardless of count, which would break every written-receipt row in the suite (A1-1/A2-2/A3-1).
The cap itself is never exercised: to test the real 513th-threshold the fixture must first fill
the shared partition to 512. Inert fixture: the row cannot distinguish cap-at-512 from
cap-at-0.

**A7-3 `append-worker-cap-missing` — BROKEN (inert fixture).** Same defect on the worker
partition: fresh fixture, one small-body append, asserts the "129th worker:&lt;ownId&gt;"
refusal. Correct impl writes entry #1 → `ok:true`. Bite-tested: a blanket
`if (scope.startsWith('worker:')) throw scratchpad_partition_exhausted` turns it green without
any 128-counting. The kernel's cap (128) is never reached because the fixture never seeds the
partition; the row is green only under a count-blind refusal.

**A8-1 `append-replay-scope-missing` — SHALLOW (bite-tested green).** The row's teeth are real: it
kills the "no scope namespacing" wrong impl (a same-key different-scope retry must land on a
DISTINCT entry — the H3.1 surface-namespaced key), and it pins exact-retry idempotency +
changed-binding `scratchpad_write_conflict`. But the cheapest wrong impl that satisfies it is a
surface-level stateful replay Map (namespaced key → receipt, session-scoped), which returns
`written` / `idempotent` / `conflict` / distinct-entry without ever touching the kernel's durable
`_byKey` — **confirmed green by bite test** (a module-scoped `Map` keyed by `` `${scope}:${key}` `` with
body-comparison replay satisfies all four legs). The D3 durability of the replay is never
asserted (no restart, no store re-open), so the kernel is bypassable while the row stays green.

### D4 teaching

**A9-1 `bare-scratchpad-teaching-missing` — SOUND.** The row pins the exact D4 message
`run scratchpad requires a subcommand: read|elevate|append` (never `unexpected argument
undefined`) directly through the parser. No cheaper wrong implementation that is also wrong:
the message is the contract's specified behavior; a wrong message fails the regex; a wrong
"unchanged" message fails the `bare.ok === false` leg. The sibling A1-1 pins the append branch
in the same rung, so the D4 "never advertises a subverb the parser cannot serve" closure holds
across the two rows.

**A9-2 `unknown-subverb-teaching-missing` — SOUND.** Names `bogus` AND restates the closed set.
Same reasoning as A9-1: the named-unknown + restated-closed-set contract behavior is pinned
verbatim; no cheaper wrong impl that is wrong exists.

### Admission coherence

**A10-1 `append-admission-incoherent` — SHALLOW + law violation.** The row asserts the verb is
present in the CLI parser, `CLI_WEB_COMMANDS`, the web four tables, MCP tool names, and the
semantic registry — plus an absolute line bound (`row.line < 40`) on the CLI_WEB_COMMANDS grep
(law violation). Cheapest wrong impl: list the verb everywhere (admitted-but-dead) with no
dispatch — **bite-tested green**: a union of string-presence admissions (a parser `append`
branch, a `CLI_WEB_COMMANDS` entry, a `COMMAND_CAPABILITY` web row, an MCP tool-def, a
semantic-registry row) with NO working write flips the row, and only the web row needed a real
table literal (A10c checks `COMMAND_CAPABILITY` presence; the other legs are any-line greps). The
dispatch teeth live in A2-2/A3-1; A10-1's own stage asserts are all admission presence, so a
ghost surface that advertises everywhere and serves nowhere passes A10-1.

---

## 3. PIN rows — the plausible wrong impl each pin kills

**P-A1 — SOUND (bite-tested).** Bites a read/elevate regression: parser + `CLI_WEB_COMMANDS` +
MCP tool names + semantic-registry rows must all still serve read/elevate while append lands. A
wrong impl that displaces read/elevate to add append fails. Green at HEAD and under the correct
impl. **Bite-tested:** disabling the read parser branch (`if (sub === 'read' && false)`) turns
it RED — the pin bites a real regression. P-A10 bites the SAME mutation (see below), proving the
redundancy empirically.

**P-A4 — SOUND (bite-tested, relative-window brittleness).** Bites a kernel-envelope amendment:
the `writeScratchpad` `_byKey` replay binding must gain NO scope term (H3.1 keeps namespacing on
the surface). A wrong impl that adds `prior.payload?.scope` to the kernel replay check is killed
— **bite-tested:** adding `|| prior.payload?.scope !== (fields.scope ?? null)` to `_byKey`
turns it RED. The region filter is a fixed +100-line offset (`writeStart.line + 100`) — a wrong
impl adding the scope term past the window would escape, but that is a churn nit, not a hole.

**P-A5 — SOUND but narrow (bite-tested).** Bites the permissive literal revert: the exact
byte-string `authorize: async () => true,` (trailing comma) must not reappear at the deployment
seam — **bite-tested:** wiring `authorize: async () => true,` into the deployment authorize
object turns it RED. Narrow because the grep is whole-file and exact-literal: `authorize: async
() => true` (no comma), `authorize: () => true`, or an arrow-with-braces variant all escape.
Combined with F1, the D1 seam remains effectively unpinned.

**P-A6 — SOUND-alarm / LAW VIOLATION (churn fragility demonstrated).** Bites seam drift: the
`_authorize` def, its typed throw, and the read verb's `{scope}` pass must stay at the cited
lines. The bite is real, but it is expressed as absolute line anchors (`seam.line > 3200 &&
seam.line < 3240`, `throwSite.line === 3222`, `readAuthorize.line === 13097`) — churn-fragile
per the no-absolute-line-window-anchor law. **Bite-tested:** inserting a single comment line
above `_authorize` turns it RED — the pin cannot distinguish "the seam moved" from "a harmless
line was added", which is exactly the absolute-anchor failure mode. Fold: keep the byte-string +
relative-order checks, drop the absolute lines.

**P-A7 — SOUND / LAW VIOLATION (bite-tested).** Bites constant drift: the 128/512 caps, the
8192 B body bound, and the typed refusal codes must stay at the declared constants — **bite-tested:**
`MAX_SCRATCHPAD_WORKER_ENTRIES = 128` → `129` turns it RED. The one absolute window
(`row.line >= 14100 && row.line <= 14120`) is the law violation; the value/refusal assertions
are the real teeth.

**P-A10 — SOUND-but-redundant-with-P-A1 / mislabeled (proven).** Bites a read/elevate coherence
regression, but this is exactly P-A1's job: both pins check parser + `CLI_WEB_COMMANDS` + MCP +
registry for the SERVED read/elevate verbs. Its A10 namesake (append ghost coherence) is NOT
what it tests — the append half of the coherence pin is only A10-1 (red). **Bite-tested:** the
read-branch-disable mutation (MUT-5) turns BOTH P-A1 and P-A10 RED simultaneously — the pin's
bite is identical to P-A1's, confirming zero marginal value empirically. Fold: merge into P-A1
and retitle, or convert it into an append-coherence pin that bites once the verb lands.

---

## 4. Law re-check

| Law item | Status |
|---|---|
| Named stage on every capability row | ✓ 18 distinct stages; each red fails at its named stage (verified §1) |
| Hermetic (mkdtemp + after-cleanup, no network/provider) | ✓ per-test temp repos + `rmSync`, `MockAdapter` only |
| No clocks as controls | ✓ fixed `NOW`, event-seq projections only |
| Namespace imports for invented surfaces | ✓ compliant — the invented `appendRestrictor` is defined in-suite and installed at the fixture seam; no unexported internal is imported |
| Sorted-key literals ACTUAL order | ✓ `SCRATCHPAD_KINDS = ['note','plan','doubt','link']` matches coordination-store.mjs:535 |
| `watchdog.stallMs` 60_000 + comment | ✖ **VIOLATION** — `createDriverFor` sets no watchdog (the swarm suite carries `watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' }`). The #158 suite never launches the interpreter loop (it drives `application.command`/Web/MCP directly), so the absence is not behaviorally hazardous here — but it is a checklist miss. |
| No absolute line-window anchors | ✖ **VIOLATION** — A2-3 (`700 < line < 900`), A10-1 (`line < 40`), P-A6 (`3200-3240`, `=== 3222`, `=== 13097`), P-A7 (`14100-14120`); P-A4 uses a fixed +100 relative offset. A2-3 is additionally BROKEN-on-platform (unescaped-paren dispatch grep, §8.2) |
| Verbatim `[attempt: …]` line in suite header | ✓ `[attempt: de03bfa2-a0ea-49a4-941b-dcf2d6312512]` at header line 6 |

---

## 5. Shared publish — the refusal record (evidence of the failed publish at HEAD)

Per the row brief, the report is published to the `shared` scratchpad as well as this file. The
`shared` scope has no write verb at HEAD — that is exactly the #158 premise — so the publish
attempt IS the append attempt. Every surface refuses; the refusals are recorded verbatim:

| Surface | Attempt | Refusal at HEAD e371f70 |
|---|---|---|
| CLI | `baton run scratchpad append run:158 --scope shared --kind note --body "<report>"` | `cli_invalid "unexpected argument append"` (parser throws at application-cli.mjs:1511; `run scratchpad` bare and `run scratchpad bogus` refuse `unexpected argument undefined` / `unexpected argument bogus`) |
| Web | `run_scratchpad_append` envelope to `web.execute` | `400 {"ok":false,"error":{"code":"invalid_command","message":"unsupported command"}}` (web-northbound.mjs:405) |
| MCP | `tools/call baton_run_scratchpad_append` | `{"code":-32602,"message":"Invalid params"}` (absent-tool protocolError) |
| Kernel | any shared write | `writeScratchpad(fields, auth)` accepts only `{runId, taskId, workerId, entry}` (coordination-store.mjs:14064); no `scope` term, `auth.actor === 'worker'` enforced, partition hardcoded to the worker's own — **no shared-write path exists** (G8 unlanded, G9 closed envelope) |

**Publish result: FAILED — the verb is absent on all four lanes, so no `shared` entry can be
written at HEAD.** This is recorded as evidence, not an error of the run: the #158 acceptance
suite is red precisely because the write half of the parity table is unwritten.

---

## 6. Bottom line

The suite is honest about its split, hermetic, stage-clean, and its two pins with real teeth
(P-A1, P-A4) plus the SOUND D4 rows give it a genuine backbone. It is **not fold-ready**:

1. **A7-2 and A7-3 are BROKEN (inert fixture)** — fresh fixture, empty partitions; a single
   append can never be the 513th/129th, so a *correct* implementation cannot turn them green
   (bite-tested: the only green path is a count-blind blanket `scratchpad_partition_exhausted`
   refusal, which breaks every written-receipt row). Pre-fill the partition to the cap (or seed
   the store) before the capped append so the row can distinguish cap-at-512 from cap-at-0.
2. **The D1 write law is unpinned at the deployment seam (A4-1/A4-2/A5-1)** — self-referential
   GREEN legs against the suite's invented restrictor plus string-presence RED greps; a comment
   turns them green and the deployed authorize is never exercised. Pin the deployed seam
   behaviorally (assert a cross-partition append refuses at the real seam), or make the grep
   structural (restrictor factory + install site + seat-resolver wiring).
3. **A6-1's ephemeral guarantee is unpinned** — same-line aliasing only; assert an append never
   routes to the elevation/candidacy lane.
4. **No round-trip read exists anywhere** — a surface that fabricates receipts (never writing)
   passes every surface row. Add a read-back assert after a surface append.
5. **A2-3 is BROKEN-on-platform** — its `_dispatch` grep uses unescaped parens (`else if (name
   === '…')`), which on darwin's BSD grep is an ERE GROUP and never matches the literal branch
   text; even a fully-correct `_dispatch` branch cannot turn the row green (verified against the
   existing read branch at mcp-northbound.mjs:1900). Escape the parens AND drop the absolute
   line window; the toolDef/explicit legs are then pure string-presence (advertise-only passes).
6. **Law re-check violations** — absolute line anchors at A2-3, A10-1, P-A6, P-A7 (and a fixed
   +100 offset in P-A4); no `watchdog.stallMs`. Fold them.
7. **P-A10 is redundant with P-A1 and mislabeled** — merge or retitle.

**Final verdict: NEEDS-FOLD** — named fold work-list: A7-2/A7-3 (BROKEN, inert fixture), A2-3
(BROKEN-on-platform), the D1 deployment-seam rows (A4-1/A4-2/A5-1 SHALLOW), A6-1 (SHALLOW,
comment-flip), the no-round-trip-read gap, and the §4/§6 law violations.

---

## 7. Judgment calls (recorded per the frame)

1. **A8-1 SHALLOW, not SOUND** — the row's teeth (two-scope key namespacing, conflict on changed
   binding) are real, but a session-scoped surface replay Map satisfies it without the kernel's
   durable `_byKey`; the D3 durability across restarts is never asserted.
2. **A9-1/A9-2 SOUND** — one could change the message without adding the append branch and turn
   these green, but the branch is pinned in the same rung by A1-1, so the D4 "never advertises an
   unserveable subverb" closure holds at the suite level. I count the cross-row closure as the
   row's protection.
3. **A7-1 SHALLOW, not BROKEN** — the blanket-`scratchpad_entry_exceeded` impl passes A7-1 in
   isolation but is caught by A1-1/A2-2/A3-1 (which demand a written receipt), so the row is
   reachable and the suite catches the cheap wrong impl elsewhere; only the "fires only at the
   bound" half is unpinned.
4. **P-A10 SOUND-but-redundant, not DECORATIVE** — it does bite a read/elevate regression, so it
   is not green under every mutation; but P-A1 already covers that bite, so its marginal value is
   ~zero and its A10 namesake (append ghost coherence) is not what it tests.
5. **watchdog absence recorded as a law-checklist violation but not behaviorally hazardous** —
   the suite never launches the interpreter loop (it drives `application.command`, WebNorthbound
   and McpFleetServer directly), so no stall can be orphaned; the fold should still add
   `watchdog.stallMs` for checklist compliance.
6. **A2-3 upgraded to BROKEN-on-platform on empirical evidence** — the unescaped-paren dispatch
   grep is not merely shallow (advertise-only passes), it is unreachable-green on this platform:
   no correct `_dispatch` branch can ever match the pattern (verified against the existing read
   branch at mcp-northbound.mjs:1900). A SHALLOW row can at least be satisfied by a cheap wrong
   impl; a row whose grep can never match even the correct text is a broken gate. Judgment: fold
   it (escape the parens, drop the absolute line window).
7. **A7-2/A7-3 stay BROKEN but the reasoning is corrected** — I originally wrote "can NEVER
   pass"; the bite test shows a count-blind blanket refusal DOES turn them green. The corrected
   claim is: no *correct* implementation can turn them green (fresh fixture, entry #1 succeeds),
   and the only green path is a refusal impl that would break the suite's own written-receipt
   rows. The fixture is inert either way — the row cannot test the real cap.

---

## 8. Empirical verification — every bite test run (mutation log)

The analysis above was not desk-checked: every named cheap-wrong-impl and every pin mutation was
actually applied to a throwaway copy of the sources (`/tmp/bt158-verify/impl/src` — pristine
snapshot + exact-string single-occurrence `apply-mut.mjs` replacer; `impl/node_modules` symlinked
so `@ast-grep/napi` resolves) and the suite was run against each. Baseline re-verified twice:
**24 tests, 6 pass / 18 fail, both runs identical** (matches §1).

### 8.1 Capability-row cheap-wrong-impls — all confirmed green

| # | Row | Mutation applied | Result |
|---|---|---|---|
| MUT-1 | A4-1, A5-1 | comment `// run.scratchpad.append restrictor must be installed here` in `application-deployment.mjs` | A4-1 ✔, A5-1 ✔, A4-2 ✖ |
| MUT-2 | A4-2 | comment `// _getWorker` in `application-deployment.mjs` | A4-2 ✔ |
| MUT-3 | A2-3 | three MCP string references (capability map row + tool def + no dispatch) | A2-3 ✖ (BROKEN-on-platform, see §8.2), A2-2 ✔ (advertise-only with no dispatch branch) |
| MUT-4 | A3-2 | four real web table literals (COMMAND_CAPABILITY, ARG_FIELDS, APPLICATION_COMMAND, WEB_DIRECT_PORT_COMMANDS), no dispatch | A3-2 ✔, A3-1 ✖ |
| MUT-10 | A1-1 | unvalidating CLI append parser branch (flags parsed, body raw, no scope-pattern check) | A1-1 ✔, A1-2 ✖ |
| MUT-11 | A1-2 | same + `JSON.parse` passthrough for non-note bodies | A1-1 ✔, A1-2 ✔ |
| MUT-12 | A2-1, A2-2 | MCP advertise-only (capability map + tool def in ordinary-definitions feed) | A2-1 ✔, A2-2 ✔ (no dispatch branch!), A2-3 ✖ |
| MUT-13 | A3-1 | web admission (COMMAND_CAPABILITY + ARG_FIELDS) + canned receipt dispatch branch | A3-1 ✔ |
| MUT-14 | A10-1 | union: CLI append branch + CLI_WEB_COMMANDS entry + web COMMAND_CAPABILITY row + semantic-registry row + MCP advertise-only | A10-1 ✔ |
| MUT-15 | A6-1 | bare COMMENT line (`// bite-A6-1: name === 'run.scratchpad.append' …`) on a different line | A6-1 ✔ (comment-only flip — even cheaper than the named impl) |
| MUT-16 | A7-1 | append branch: body-length check > 8192 throws `scratchpad_entry_exceeded`, else canned receipt | A7-1 ✔ |
| MUT-17 | A8-1 | surface-level replay `Map` (`` `${scope}:${idempotencyKey}` `` → receipt; body-compare replay; conflict on changed body) | A8-1 ✔ (kernel `_byKey` never touched) |

### 8.2 The BROKEN-on-platform discovery (A2-3) — verified at the grep level

The suite's `grepLines` runs `/usr/bin/grep -anE` (darwin BSD grep). The A2-3 dispatch leg is
`else if (name === 'baton_run_scratchpad_append')` — **unescaped parens**. In POSIX ERE the parens
are grouping operators, so the pattern reads as `else if <group>` and can never match the literal
`else if (name === '…')` text. Verified on the EXISTING read branch:

```
$ /usr/bin/grep -anE "else if (name === 'baton_run_scratchpad_read')" impl/src/mcp-northbound.mjs
(no output — exit 1)
$ /usr/bin/grep -anE "else if \(name === 'baton_run_scratchpad_read'\)" impl/src/mcp-northbound.mjs
1900:    else if (name === 'baton_run_scratchpad_read') {
```

So even a fully-correct append `_dispatch` branch cannot turn A2-3 green on this platform: the
row's dispatch leg is unreachable. The row is BROKEN-on-platform (and its `row.line > 700 &&
row.line < 900` window is a separate no-absolute-line-window-anchor law violation).

### 8.3 PIN rows — bite tests (mutation → does the pin stay RED?)

| # | Pin | Mutation | Pin bites? |
|---|---|---|---|
| MUT-5 | P-A1, P-A10 | `if (sub === 'read' && false)` (read parser branch disabled) | P-A1 ✖ (bites), P-A10 ✖ (bites) — **both bite the SAME mutation** |
| MUT-6 | P-A4 | add `\|\| prior.payload?.scope !== (fields.scope ?? null)` to kernel `_byKey` | P-A4 ✖ (bites) |
| MUT-7 | P-A5 | wire `authorize: async () => true,` at the deployment seam (inside the authorize object) | P-A5 ✖ (bites) |
| MUT-8 | P-A6 | insert one comment line above `_authorize` | P-A6 ✖ (bites) — and shows absolute-anchor churn fragility: a single inserted line above :13097 fails the pin |
| MUT-9 | P-A7 | `MAX_SCRATCHPAD_WORKER_ENTRIES = 128` → `129` | P-A7 ✖ (bites) |

### 8.4 A7-2/A7-3 — the inert-fixture BROKEN proof (both directions)

| Mutation | A7-2 | A7-3 |
|---|---|---|
| minimal always-succeeds append write (canned receipt, no counting) | ✖ stays RED | ✖ stays RED |
| count-blind blanket refusal (`if (scope === 'shared') throw scratchpad_partition_exhausted`) | ✔ GREEN | n/a |
| count-blind blanket refusal (`if (scope.startsWith('worker:')) throw …`) | n/a | ✔ GREEN |

A correct implementation can never green these rows (entry #1 succeeds on a fresh fixture); the
only green path is a blanket refusal that refuses regardless of count — which breaks every
written-receipt row in the suite. The cap (128/512) is never exercised.

### 8.5 What the bite tests changed in this report

- **A2-3: SHALLOW → BROKEN-on-platform** (§2, §6, §7). Not "add strings with no dispatch"; the
  dispatch grep cannot match even the correct implementation on darwin's BSD grep.
- **A2-2: strengthened** — advertise-only with NO dispatch branch passes (generic application
  branch error → `isError` tool result satisfies `call.result !== undefined`).
- **A7-2/A7-3: reasoning corrected** — "can NEVER pass" → "no *correct* impl can pass; the only
  green path is a count-blind blanket refusal" (still BROKEN, inert fixture).
- **A6-1: even cheaper than named** — a comment-only line flips it.
- All other SHALLOW verdicts confirmed by execution, not assumption.
