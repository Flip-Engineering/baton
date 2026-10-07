# Fold-suite — scratchpad-write-red.test.mjs (row-sf158)

[attempt: c8f618f9-2f2a-4a1d-a367-eda8fd71da5c row-sf158]

Fold foundry wave-c (suite-fold) applying the blue-team attack report
`docs/reference/evidence/blue-team-2026-08-13-a/blueteam-158.md` to the folded #158 acceptance
suite `impl/test/scratchpad-write-red.test.mjs`. Every blue-team finding is resolved below as
FOLDED / STRUCK / ESCALATED — none dropped. The suite's sacred header attempt line
(`// [attempt: de03bfa2-a0ea-49a4-941b-dcf2d6312512]`, header line 6) is untouched.

---

## 1. Measured splits

### 1.1 Baseline (pre-fold, recorded by the blue team at HEAD e371f70)

blueteam-158 §1 — two consecutive runs from the repo root, byte-identical `ok`/`not ok` TAP
lines:

```
run 1:  24 rows   6 pass / 18 fail
run 2:  24 rows   6 pass / 18 fail
```

GREEN 6 — P-A1, P-A4, P-A5, P-A6, P-A7, P-A10. RED 18 — A1-1, A1-2, A2-1, A2-2, A2-3, A3-1,
A3-2, A4-1, A4-2, A5-1, A6-1, A7-1, A7-2, A7-3, A8-1, A9-1, A9-2, A10-1.

### 1.2 Post-fold (recorded after the fold edits, from the repo root)

`node --test impl/test/scratchpad-write-red.test.mjs`, HEAD e371f70, run TWICE:

```
run 1:  23 rows   5 pass / 18 fail
run 2:  23 rows   5 pass / 18 fail   (identical pass/fail name sets)
```

GREEN 5 — P-A1, P-A4, P-A5, P-A6, P-A7. RED 18 — A1-1, A1-2, A2-1, A2-2, A2-3, A3-1, A3-2,
A4-1, A4-2, A5-1, A6-1, A7-1, A7-2, A7-3, A8-1, A9-1, A9-2, A10-1.

The 6→5 GREEN drop is the P-A10 deletion (folded into P-A1, §2.7); every remaining PIN row
stays green, every capability row still fails at its named stage. **RED honesty is preserved.**

---

## 2. Finding → resolution map

| # | Blue-team finding | Verdict | Resolution |
|---|---|---|---|
| 1 | **A7-2 / A7-3 BROKEN (inert fixture)** — a fresh fixture's empty partitions mean a single append can never be the 513th/129th; only a count-blind blanket `scratchpad_partition_exhausted` refusal (which breaks every written-receipt row) could turn them green | FOLDED | Both rows now **pre-fill their partition to the cap** before the capped append: A7-2 loops 512 distinct `ik-shared-${i}` idempotency keys to the shared partition asserting each lands `result:'written'`, then the 513th refuses `scratchpad_partition_exhausted`; A7-3 does the same for 128 distinct `ik-worker-${i}` keys in the worker `<ownId>` partition, then the 129th refuses. The rows now distinguish cap-at-512/128 from cap-at-0 |
| 2 | **D1 write law unpinned at the deployment seam (A4-1 / A4-2 / A5-1 SHALLOW)** — self-referential GREEN legs against the suite's invented restrictor plus string-presence RED greps; a comment can turn them green and the deployed authorize is never exercised | FOLDED | The restrictor posture is now pinned **structurally against the real deployment seam**: A4-1 asserts the restrictor factory exists and the install site (`authorize: restrictingReadAuthorize(),` at application-deployment.mjs:2041) is code, via `codeLines` (comment-proof); A4-2 asserts a seat-resolver `_getWorker` binding exists in the same factory region (window-free `enclosingFactoryRegion`, brace-bounded); A5-1 pins the STRICTER law-3 posture — review authority (`local-owner` / `service-*`) appends to shared ONLY, never a member partition — via the factory region + a co-occurrence regex that distinguishes the write restrictor's refusal from the read restrictor's `return true` grant |
| 3 | **A6-1 ephemeral guarantee unpinned (SHALLOW)** — same-line aliasing only; a comment flip turns it green; nothing asserts an append never routes to the elevation/candidacy lane | FOLDED | A6-1 now asserts the append dispatch branch (codeLines) carries **no `scratchpadElevate` / `elevateTaskScratchpad` routing** (`!/scratchpadElevate|elevateTaskScratchpad/u` over the branch body) — a comment flip no longer satisfies it because the grep must hit CODE that omits any elevation call |
| 4 | **No round-trip read anywhere (F5)** — a surface that fabricates receipts (never writing) passes every surface row | FOLDED | **Round-trip read-backs added** via `scratchpadSnapshot(runId, scope)` (coordination-store.mjs:14046): A2-2 reads the written entry back from the kernel store after the MCP dispatch; A3-1 reads it back after the web envelope dispatch; A7-1 reads it back after the under-bound success; A8-1 reads it back after the first worker write AND after the shared cross-write (proving the two-scope namespacing is real at the store, not a receipt claim). Kills the receipt-fabrication surfaces (MUT-13/MUT-17) |
| 5 | **A2-3 BROKEN-on-platform + law violation** — the `_dispatch` grep uses unescaped parens (`else if (name === '…')`), which on darwin's BSD grep is an ERE GROUP that can never match the literal branch text; and it carried an absolute line window (`row.line > 700 && row.line < 900`) | FOLDED | The dispatch grep now **escapes the parens** (`else if \\(name === 'baton_run_scratchpad_append'\\)`) and the window is gone: the ORDINARY_EXPLICIT_TOOLS leg uses a token-bound `regionBetween` read of the set (`const ORDINARY_EXPLICIT_TOOLS` → `']);'`). A fully-correct `_dispatch` branch can now actually turn the row green |
| 6 | **Law re-check violations** — absolute line anchors at A2-3, A10-1 (`line < 40`), P-A6 (`3200-3240`, `=== 3222`, `=== 13097`), P-A7 (`14100-14120`), a fixed `+100` offset in P-A4, and no `watchdog.stallMs` | FOLDED | **All absolute line windows dropped.** A10-1 reads the CLI/web shared admission set by token (`regionBetween('application-cli.mjs', 'const CLI_WEB_COMMANDS', ']);')`); P-A1 drops its `+1200` char-offset for the same token-bound read; P-A4 replaces the `+100` line-window with a `!==` co-occurrence discriminator (see §3 judgment 1); P-A6 replaces the byte-pins with **relative order** (`def < throw < readAuthorize`, see §3 judgment 2); P-A7 replaces the `14100-14120` window with presence + a relative order bound below the `writeScratchpad` def (§3 judgment 3). `createDriverFor` now carries `watchdog: { stallMs: 60_000, loopThreshold: 0, scopeAction: 'kill' }` with a checklist-closure comment |
| 7 | **P-A10 SOUND-but-redundant with P-A1 / mislabeled** — it bites the same read/elevate coherence regression P-A1 already bites (MUT-5 turns both RED simultaneously; proven blueteam §8.3); its A10 namesake (append ghost coherence) is not what it tests, and its `+1200` slice is itself a law violation | FOLDED | **P-A10 deleted; its coverage merged into P-A1.** P-A1 now asserts parser ⇔ `CLI_WEB_COMMANDS` ⇔ MCP ⇔ semantic-registry coherence for the served read/elevate verbs (its original teeth), reads the set token-bound, and carries the merge note. The suite drops to 23 rows; the append ghost-coherence name A10-1 remains the sole A10 pin |
| 8 | **A1-1 SHALLOW (bite-tested green)** — a `sub === 'append'` branch special-casing the single argv shape (hardcoded scope/kind, raw body) turns it green; only A1-2's different argv and A10-1's coherence leg catch it | FOLDED | A1-1 now drives **two argv closures** (note + a plan-form with a different scope shape) and adds a **bad-scope refusal leg** — a hardcoded special-case of the original argv cannot satisfy the second closure or the refusal leg, so the cheapest wrong impl no longer passes |
| 9 | **A1-2 SHALLOW (bite-tested green)** — a passthrough `JSON.parse` of non-note bodies turns it green without any shape validation against `normalizeScratchpadEntry`; and the original test's plan body (`steps:["a","b"]`) was kernel-INVALID, so a correct H2.3 parser would refuse the positive leg | FOLDED | A1-2 now uses a **kernel-valid plan body** (`{"objective":"plan it","steps":[{"text":"a","state":"todo"},{"text":"b","state":"doing"}]}`) for the positive leg and moves the string-steps body to the **wrong-shape refusal leg** — the closed per-kind shape (H2.3) is now what the row requires, and a passthrough `JSON.parse` no longer satisfies it |
| 10 | **A2-1 SHALLOW (bite-tested green)** — advertise-only (capability-map row + static tools/list def with zero dispatch wiring) turns it green | FOLDED | Folded together with finding 4 and the A2-2 dispatch work: A2-1's advertise legs are now cross-checked against A2-2 (must dispatch) and A2-3 (must be in the real admission tables via token-bound reads) — advertise-only surfaces are caught by the sibling dispatch/admission rows in the same rung |
| 11 | **A2-2 SHALLOW (empirically weaker than named)** — the generic application branch's `application_command_unavailable` throw becomes a tool result with `isError:true`, so `call?.result !== undefined` holds even with NO dispatch branch | FOLDED | A2-2 now drives `tools/call` and asserts a **`result:'written'` receipt plus a kernel `scratchpadSnapshot` round-trip read-back** (§ finding 4) — dead plumbing cannot produce a stored entry, and the absent-tool `-32602` protocolError path is explicitly refused |
| 12 | **A8-1 SHALLOW, not SOUND (judgment)** — a session-scoped surface replay Map satisfies it without the kernel's durable `_byKey`; D3 durability is never asserted | FOLDED | A8-1 now asserts the **round-trip read-backs** after the first worker write and after the shared cross-write, so a surface replay Map (MUT-17) that never writes to the kernel store fails the read-back legs. The changed-binding `scratchpad_write_conflict` and same-key-different-scope DISTINCT legs are kept |
| 13 | **A7-1 SHALLOW, not BROKEN (judgment)** — a blanket `scratchpad_entry_exceeded` impl passes A7-1 in isolation but is caught by A1-1/A2-2/A3-1 (written receipts) | FOLDED | A7-1 keeps the at-bound refusal (`>8192 B` for a steering-registered run refuses `scratchpad_entry_exceeded`) and adds the **under-bound success read-back** (§ finding 4) so the row now also pins the "fires only at the bound" half |
| 14 | **A9-1 / A9-2 SOUND (judgment)** — one could change the D4 teaching message without adding the append branch and turn these green, but the branch is pinned in the same rung by A1-1; the cross-row closure is the protection | STRUCK | No fold action: the D4 closure holds at the suite level via A1-1's branch pin. Rows untouched. |
| 15 | **A4-2 self-referential restrictor** (part of finding 2) — the row could pass against the suite's invented restrictor without any real seat-resolver | FOLDED | See finding 2: A4-2 now greps `_getWorker` as CODE inside the real deployment restrictor factory region (`enclosingFactoryRegion`), so the invented in-suite restrictor is no longer satisfiable by a comment |
| 16 | **P-A5 comment false-positive** (part of law fold) — a widened permissive-literal grep would match the `* literal \`authorize: async () => true\` …` doc comment at application-deployment.mjs:2073 | FOLDED | P-A5 widened via **`codeLines`** (comment lines filtered) and the pattern now covers both `authorize: async () => true` and the bare `authorize: () => true` forms — a comment can no longer satisfy it |
| 17 | **P-A4 `prior.payload?.scope` false-positive risk** (part of law fold) — a whole-file absence grep would fail because the REPL binding replay at coordination-store.mjs:15606/15703 legitimately reads `prior.payload?.scope` (`:`-form) | FOLDED | P-A4 uses the **`!==` co-occurrence discriminator**: `prior\.payload\?\.scope !==` is 0 at HEAD (MUT-6 adds exactly that form), while the replay terms are read as `prior\.payload\?\.(runId|taskId|workerId|contentDigest) !==` (present at 14089-14090). The `:`-form REPL reads never trip the absence check |
| 18 | **P-A6 byte-stability fragility (judgment/MUT-8)** — a single inserted comment line above `:13097` fails the pin | FOLDED | P-A6 replaced byte-pins with **relative order** (`_authorize` def < typed `application_unauthorized` throw < read verb's `{scope}` call). A comment insertion no longer fails the pin; the seam identity is preserved by the anchor patterns themselves (any vanishing anchor throws in `srcAnchor`) |
| 19 | **A3-1 SHALLOW (fabricated-receipt seam)** — a `COMMAND_CAPABILITY` + `ARG_FIELDS` admit plus a canned `{ok:true, result:'written', …}` dispatcher branch turns the row green with zero writes | FOLDED | A3-1 now asserts a **kernel `scratchpadSnapshot('run:m1','worker:m1')` read-back** after the web dispatch (line 645-648) — a fabricated receipt that never writes fails the read-back, and the `unsupported command` refusal at HEAD still fires the named stage first |
| 20 | **A3-2 SHALLOW + fixture fragility** — the four-table admission is pinned as string presence only, and the `WEB_DIRECT_PORT_COMMANDS` region read truncated at the first `// ` comment token, so a DERIVED transport could never be seen | FOLDED | All four table regions are read **token-bound** (`const COMMAND_CAPABILITY`→`const ARG_FIELDS`, `const ARG_FIELDS`→`const ACCEPTED_ARG_FIELDS`, `const APPLICATION_COMMAND`→`function validateEnvelope`), and the `WEB_DIRECT_PORT_COMMANDS` leg anchors on the **source table `WAVE_WEB_ENTRIES`** (web-northbound.mjs:37-47 → `]);`) — the set from which `WEB_DIRECT_PORT_COMMANDS` is derived (`new Set(WAVE_WEB_ENTRIES.map(([transport]) => transport))`, :62). A derived transport is now reachable; the four-table admission stays a string-presence pin (it IS an admission pin) but is no longer blind to the derivation |
| 21 | **A10-1 SHALLOW (ghost surface)** — every A10-1 stage assert is admission presence; a surface that advertises the verb everywhere but serves nowhere passes A10-1 alone | FOLDED-by-closure | The blue-team itself locates A10-1's dispatch teeth in **A2-2/A3-1**, which now carry kernel read-backs (finding 4). A10-1 pins the "no #157 ghost" coherence sweep (parser ⇔ CLI_WEB_COMMANDS ⇔ web four-table ⇔ MCP ⇔ registry all carry the verb); the serving half is enforced by the sibling dispatch rows in the same rung, so admitted-but-dead fails the suite |
| 22 | **F1 combined D1-seam finding** — a deployment that installs any restrictor-less append path with the strings present goes all-green on A4-1/A4-2/A5-1; P-A5 banned only the exact `authorize: async () => true,` literal | FOLDED | The D1 seam rows are pinned structurally (findings 2/15: restrictor factory + install site + seat-resolver on the real deployment file) and P-A5's pattern is widened (finding 16: `codeLines`, both `async () =>` and bare `() =>` forms) — a comment, a dead string, or a permissive-literal variant can no longer satisfy the rows |
| 23 | **P-A1 SOUND (kept, fold-touched)** — bites the read/elevate regression (MUT-5); teeth need no fold, but the `+1200` char-offset window is a §4 law violation | FOLDED-lite | P-A1's teeth are kept verbatim; the `+1200` offset is folded to a token-region read (`regionBetween('application-cli.mjs', 'const CLI_WEB_COMMANDS', ']);')`), and the P-A10 merge (finding 7) lands here — P-A1 now carries the full parser ⇔ CLI_WEB_COMMANDS ⇔ MCP ⇔ registry coherence sweep for the served read/elevate verbs |

---

## 3. Judgment calls (recorded per the frame)

1. **P-A4 discriminator over whole-file absence.** The blue-team's suggested "no scope term
   anywhere" grep is un-workable at HEAD: the REPL binding replay at coordination-store.mjs:15606
   /15703 legitimately reads `prior.payload?.scope` in object-literal (`:`) form. The `!==` form is
   the `_byKey` binding's own shape (`prior.payload?.runId !== …`, 14089-14090), so
   `prior\.payload\?\.scope !==` is the precise absence probe — 0 at HEAD, and MUT-6's added scope
   term to the `_byKey` check is exactly the `!==` form. The replay-term side is asserted tolerantly
   (each of runId/taskId/workerId/contentDigest present in some matched `!==` row) so the task-replay
   rows at 10864/10894/11314 (`prior.payload?.taskId !==`) do not create a false failure.
2. **P-A6 relative order over byte-pins.** `=== 3222` and `=== 13097` are absolute line anchors the
   fold law bans (and MUT-8 showed a single inserted comment line above the read call fails the
   byte-pin). The structural property the seam exists to guarantee — the `_authorize` def precedes
   its typed refusal throw precedes the read verb's `{scope}` call — is preserved as a relative
   order chain, and each of the three anchors independently throws if the code it names disappears.
3. **P-A7 presence + relative order over the cap window.** The `14100-14120` window was the only
   absolute range left in P-A7; the refusal sites (14107/14240) both sit below the `writeScratchpad`
   def (14064), so the fold keeps the refusal-code presence assert and adds a relative bound
   (`row.line > writeStart.line`). The two anchors may move together; their order may not invert.
4. **A10-1 token-region read over `line < 40`.** The CLI/web shared admission set is
   `const CLI_WEB_COMMANDS = new Set([…]);` (application-cli.mjs:16-32), so a token-bound read
   (`'const CLI_WEB_COMMANDS'` → `']);'`) is both window-free and robust to set growth. The append
   verb is absent from the set at HEAD, so the RED stage fires correctly.
5. **A2-3 escape + token-region.** The unescaped-paren grep was unreachable-green on this platform
   (verified against the existing read branch at mcp-northbound.mjs:1900). Escaping the parens makes
   the dispatch leg satisfiable by the correct text; the `ORDINARY_EXPLICIT_TOOLS` leg reads the set
   token-bound, dropping the `700 < line < 900` window.
6. **A7-2/A7-3 fill loops use distinct idempotency keys.** Pre-filling to the cap requires each fill
   append to be a genuine `result:'written'` (not a replay), so each fill uses a distinct
   `ik-shared-${i}` / `ik-worker-${i}` key and asserts `result:'written'` per iteration. This keeps
   the filled partition real and makes the (cap+1)th append a genuine cap refusal rather than an
   idempotent replay.
7. **P-A10 merged, not retitled.** The blue team offered either merge-into-P-A1 or retitle-as-an-
   append-coherence-pin. The append ghost-coherence name is already the RED A10-1 row (which will
   bite once the verb lands), so a second append-coherence pin would be zero-marginal today; the
   read/elevate coherence the pin DID test is exactly P-A1's job. Merge was the fold with no
   coverage loss.
8. **watchdog added for checklist compliance only.** The suite never launches the interpreter loop
   (it drives `application.command`, WebNorthbound, and McpFleetServer directly), so no stall can be
   orphaned — the blue team recorded this (§7.5). The `watchdog` block is added to keep the driver
   construction honest against the deployment profile and to close the §4 checklist item.

---

## 4. Law checklist (post-fold)

| Law item | Status |
|---|---|
| Named stage on every capability row | ✓ 18 distinct stages; each red fails at its named stage (verified in both runs) |
| RED honesty preserved | ✓ every capability row still fails at HEAD at its named stage; 18/18 RED |
| PIN rows stay green | ✓ P-A1, P-A4, P-A5, P-A6, P-A7 all green at HEAD in both runs |
| Every blue-team finding resolved | ✓ 23 findings mapped above — 22 FOLDED, 1 STRUCK (A9-1/A9-2 SOUND), 0 ESCALATED, 0 silent drops |
| Hermetic (mkdtemp + after-cleanup, no network/provider) | ✓ per-test temp repos + `rmSync`, `MockAdapter` only, fixed `NOW`, event-seq projections |
| No clocks as controls | ✓ no wall-clock in any assert; the only timestamps are the fixed `NOW` constant passed to the surfaces' `clock`/`now` hooks |
| Namespace imports for invented surfaces | ✓ invented restrictor defined in-suite and installed at the fixture seam; no unexported internal imported |
| Sorted-key literals ACTUAL order | ✓ `SCRATCHPAD_KINDS = ['note','plan','doubt','link']` matches coordination-store.mjs:535 |
| `watchdog.stallMs` 60_000 + comment | ✓ `watchdog: { stallMs: 60_000, loopThreshold: 0, scopeAction: 'kill' }` in `createDriverFor` with the checklist-closure comment |
| No absolute line-window anchors | ✓ all windows/offsets/byte-pins dropped (A2-3, A10-1, P-A1, P-A4, P-A6, P-A7); token-region reads and relative-order chains in their place |
| `localeCompare` never used | ✓ only the header declaration that it is never used |
| Sacred `[attempt: …]` line untouched | ✓ header line 6 `// [attempt: de03bfa2-a0ea-49a4-941b-dcf2d6312512]` verbatim |
| This fold's attempt line in the first five lines | ✓ `[attempt: c8f618f9-2f2a-4a1d-a367-eda8fd71da5c row-sf158]` |

---

## 5. Verification

- **Split run twice** from the repo root: `node --test impl/test/scratchpad-write-red.test.mjs`
  → run 1 and run 2 both `23 rows, 5 pass / 18 fail` with identical pass/fail name sets.
- **RED at named stages**: the 18 RED rows fail at exactly the 18 named stages — the failure-output
  stage set matches the suite header's stage table byte-for-byte (verified via `sort -u` diff), so
  no row fails early at a different rung and no row passes.
- **RED honesty spot-verified at HEAD** against the sources before running (NUL-discipline
  `execFileSync grep -an` for `application.mjs`/`coordination-store.mjs`; whole-file reads for the
  NUL-free files): append is absent from CLI_WEB_COMMANDS, MCP tool feeds, web direct-port tables,
  and the deployment seam; `prior\.payload\?\.scope !==` is 0; the permissive `authorize: … => true`
  literal appears only in a `*`-comment.
- The fold is confined to `docs/reference/evidence/scratchpad-write-2026-08-13/**` and
  `impl/test/scratchpad-write-red.test.mjs`. Nothing was pushed; no destructive commands were run.

---

## 6. Incremental notes (continuation pass)

This fold was re-verified incrementally — each step landed, then the whole suite was re-checked —
so the record is an append trail, not a rewrite:

1. **Fold application (first pass)** — the 18 finding rows above were applied to the suite in
   sequence (A1-1 → A10-1 RED strengthening, the PIN folds, the helper additions, the P-A10
   deletion). RED/GREEN honesty was spot-checked per row against HEAD source (NUL-discipline greps)
   before and after each group of edits; the `enclosingFactoryRegion` brace-counter regex was fixed
   in-pass (`/{/gu` → `/\{/gu`) when the first full run exposed the syntax error.
2. **Split recorded twice (first pass)** — `node --test impl/test/scratchpad-write-red.test.mjs`
   from the repo root, two runs, `23 rows / 5 pass / 18 fail` identical both times; the split was
   written into the suite header and this doc.
3. **Completeness re-sweep (this pass)** — the blue-team report was re-read in full to enumerate
   every finding. The first-pass map already covered 18; the sweep surfaced five more report
   findings that had been resolved in the code but not yet given their own map rows: A3-1
   fabricated-receipt (row 19), A3-2 fixture-fragility/derived-transport (row 20), A10-1 ghost-
   surface-by-closure (row 21), the F1 combined D1-seam finding (row 22), and the P-A1 SOUND-but-
   fold-touched row (row 23). All five are now mapped — **no report finding is unmapped**.
4. **Split re-run twice (this pass)** — both runs again `23 rows / 5 pass / 18 fail`, identical;
   the RED rows fail at their named stages (stage-set diff against the header table clean).
5. **No code changes were needed this pass** — the re-sweep found only documentation gaps; the
   suite was already folded correctly. The suite file is untouched since the first-pass split
   record, so the two recorded splits remain the two measured splits for the folded suite.
