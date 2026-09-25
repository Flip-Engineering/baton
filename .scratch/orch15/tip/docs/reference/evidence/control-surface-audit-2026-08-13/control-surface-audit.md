CONTROL-SURFACE-AUDIT v1
# Control-surface audit — coordinator synthesis (issue #147)

Synthesis of the three row audits of the agent-facing control surfaces: `row-web`
(`surface-audit-web.md`, resident bus / web northbound), `row-cli` (`surface-audit-cli.md`, the
CLI thin client), `row-mcp` (`surface-audit-mcp.md`, the MCP northbound). Frame and laws per
`audit-brief.md`. Evidence is the three row reports, cited by section; the row reports cite
`file:line` read this session.

---

## 0. Harvest note — the shared-layer handoff is partial (and its asymmetry is itself a finding)

The shared-layer law says rows publish to the `shared` scratchpad partition. The live store shows a
**surface-asymmetric** handoff: the **web** row's report reached `shared` (its `worker:w-196`
entries were elevated via a `scratchpad.partition_reaped` settlement), the **mcp** row's report is
written to `worker:w-198` scope but **not** yet elevated, and the **cli** row published **nothing**
(zero `worker:w-197` entries). `row-cli` reported the cause in advance (`cli §8`, `cli §7 R-2`): the
ordinary CLI has `run.scratchpad read`/`elevate` but **no write/append verb** (`cli §1.2`, `§6 F-9`),
so its report never reached the store. I read all three reports from their **durable files** (in
wave scope), which the brief names the harvest artifact; the coordinator has no scratchpad-write
lane either (the web bus refuses the scratchpad facade ports — web §1; the CLI has no write verb;
the collaboration MCP did not connect in this session), so this synthesis is likewise
durable-file-only. The handoff is therefore partial and uneven — web elevated, mcp worker-scoped,
cli absent — the audit audited itself, and that asymmetry is a top-tier finding (`cli F-9`/`S-3`,
folded into §2 #10).

---

## 1. Cross-surface parity matrix

Status per surface: **full** = present and complete · **partial** = present but gated/degraded
(note says how) · **absent** = missing. Columns cite the owning row's parity table (web §1, cli
§1.2/§1.3, mcp §1.1), reconciled where rows disagreed (§1.2).

### 1.1 Run control & lifecycle

| Capability | Web | CLI | MCP (default `application` profile) |
|---|---|---|---|
| `run.start` | full `run_start` | full `baton run` / `run start` | full `baton_run_start` |
| `run.act` / `run.do` | full `run_act` (digest-keyed, preflight) | full `run do` | full `baton_run_act` |
| `run.stop` | full `run_stop` | full `run stop` | full `baton_run_stop` |
| `run.approve` | full `run_approve` | full `run approve` | **partial** — only via `baton_run_act` `approve_plan` actionId; direct `fleet_run_approve` is `combined`-only (mcp §1.1, §1.2.5) |
| `run.answer` | full `run_answer` | full `run answer` | **partial** — `fleet_run_answer` `combined`-only; `baton_decision_answer` is the decision channel, not `run.answer` (mcp §1.1) |
| `run.adopt` | full `run_adopt` | full `run adopt` | **partial** — `fleet_run_adopt` `combined`-only (mcp §1.1) |
| `run.integrate` | full `run_integrate` | full `run integrate` | **partial** — `fleet_run_integrate` `combined`-only (mcp §1.1) |
| `run.export` | full `run_export` | full `run export` | **partial** — `fleet_run_export` `combined`-only (mcp §1.1) |
| `run.feedback` | full `run_feedback` | full `run feedback` | **partial** — `fleet_run_feedback` `combined`-only (mcp §1.1) |
| `run.recover` | full `run_recover` | full `run recover` | **partial** — `fleet_run_recover` `combined`-only (mcp §1.1) |
| `run.review` | full `run_review` | **absent** — not in the CLI surface (cli §1.2, §5 S-1) | **partial** — `fleet_run_review` `combined`-only (mcp §1.1) |
| `run.evidence` | full `run_evidence` | full `run evidence` | **partial** — `fleet_run_evidence` `combined`-only (mcp §1.1) |
| `run.resume_work` | full `run_resume_work` | full `run resume` | **absent** — no `fleet_run_*` spelling in any profile (mcp §1.1, §6 F2) |
| `run.retry_verification` | full `run_retry_verification` | full `run retry` | **absent** — hard gap, all profiles (mcp §1.1, §6 F2) |

**Headline:** 12 run-lifecycle operations an orchestrator needs most (approve/answer/adopt/
integrate/export/feedback/recover/review/evidence/status/follow/wait) are `combined`-profile-only
on MCP, and 2 (`resume_work`, `retry_verification`) are absent from MCP entirely while the web bus
and CLI both serve them (mcp §1.2.1–1.2.3). `run.review` is web+MCP-only.

### 1.2 Run observe

| Capability | Web | CLI | MCP (default) |
|---|---|---|---|
| `runs.list` | full `run_list` | full `runs list` — **no `--cursor`** (cli §1.2, §6 F-4, #136) | full `baton_runs` |
| `run.view` / `run.inspect` | full | full `run view`/`show` (progressive cascade) | full `baton_run_inspect` |
| `run.status` | full `run_status` | **partial** — folded into `run view`, no standalone verb (cli §1.2) | **partial** — `fleet_run_status` `combined`-only (mcp §1.1) |
| `run.episode` / `result` / `workstreams` | full | full | full |
| `run.follow` | full (SSE; poll-underneath, web §2 D4) | full `run progress --follow` | **partial** — `fleet_run_follow` `combined`-only (mcp §1.1) |
| `run.wait` | full (30 000 ms ceiling, web §1) | full `run view --until` | **partial** — `fleet_run_wait` `combined`-only (mcp §1.1) |
| `run.workstream.notify` / `stop` | full | full | full |

### 1.3 Steer, waves, facade

| Capability | Web | CLI | MCP (default) |
|---|---|---|---|
| `run.send` / `run.interrupt` | full | full | full (member/wave send; mcp §1.1) |
| `waves.attach` | full `waves_attach` | full | full |
| `waves.start` | full (direct port) | full | full |
| `waves.progress` | full | full | full |
| `waves.send` | full (direct port) | **absent** — parser refuses, registry claims `cli` (cli §1.2, §6 F-3) | full `baton_waves_send` |
| `waves.stop` | full (direct port) | **absent** — same ghost (cli §1.2, §6 F-3) | full `baton_waves_stop` |
| `waves.list` | full | full — **no `--cursor`** (cli §6 F-5) | full |
| `waves.run` | full (direct port) | full | full (#114, mcp §1.1) |
| scratchpad read / elevate | full `run.scratchpad.read`/`elevate` | full `run scratchpad read/elevate` | full |
| scratchpad **write/append** | **absent** | **absent** | **absent** — no verb on any surface (cli §1.2, §6 F-9) |
| `run.board.post` / `read` | **absent** — refused (`unsupported command`, web §1, §5 F7) | full | **absent** (no `baton_board_*`, cli §1.2) |
| `run.message.send` / `receipt` | **absent** — refused (web §1, §5 F7) | full | full (mcp §1.1) |
| `run.attention.watch` | **absent** — refused (web §1) | full | full |
| `run.attention.list` | **absent** | **absent** — ghost, parser has only `watch` (cli §1.2) | **absent** |
| `run.knowledge.seed` | **absent** — refused (web §1) | full | full |
| decision answer | full `run_answer` (attention) | full `run answer` | full `baton_decision_answer` |
| `decision.list` | **absent** (not claimed) | **absent** — ghost (cli §1.2) | **absent** (no `baton_decision_list`, mcp §1.1) |
| `context.eval` | **absent** | **absent** — refused host-local, deliberate (cli §1.2, §3 E-6) | full `baton_context_eval` |
| `context.map` / `reduce` / `retry` | **absent** | **absent** — silent ghost → becomes `run.start` objective (cli §1.2, §3 F-1) | **absent** |

### 1.4 Reconciliation notes (rows disagreed; resolved against source)

1. **Waves on the web bus.** `row-web` marks `waves_start/progress/send/stop/list/run` **full** on
   web (`web §1`); `row-mcp` marks them **absent** from the web bus because `webBusNames()`
   (`surface-conformance.mjs:378-384`) lists only 25 commands (mcp §1.1). Both are internally
   consistent; the discrepancy is real and is itself a finding: the web bus **does** admit the six
   wave verbs as direct ports (`WAVE_WEB_ENTRIES`, `web-northbound.mjs:31-44`, admitted "WITHOUT
   touching APPLICATION_COMMAND_DEFINITIONS"), but the conformance inventory `webBusNames()`
   derives the web surface from `APPLICATION_COMMAND_DEFINITIONS` only, so it **undercounts the
   web bus**. `row-mcp`'s parity comparison therefore under-reported web capability for waves.
   Corrected status above: waves are full on web and MCP, partial on CLI (send/stop ghost). The
   inventory-vs-admission divergence is a conformance gap in the same family as `cli §3 D-1` and is
   folded into §2 #7.

2. **`run.review` on CLI.** `row-web` cross-marks CLI ✅ for the lifecycle tail "only where the
   code makes it obvious" (web §1 caveat). `row-cli`'s exhaustive table and its S-1 steer list omit
   `run review`. The CLI column above takes `row-cli` as authoritative for its own surface: `run
   review` is absent from the CLI.

3. **CLI `run.status`.** No standalone `run status` verb appears in `row-cli`'s table; status is
   reachable via `run view` (phase/progressClass). Marked partial rather than absent.

---

## 2. Unified friction ranking

Merged and deduped from the three ranked lists (web §6 F1–F9, cli §6 F-1–F-10, mcp §6 F1–F9),
re-ranked by orchestrator cost. Each carries the concrete fix and its issue cross-ref.

1. **Command-spelling divergence — every surface teaches a different spelling, and two teach
   spellings they refuse.** Merge of web F1+F9, cli G1+G2+F2, mcp G1+G2. The web card/help/
   continuation advertise dot names the wire refuses as underscore-only; the CLI teaches
   legacy-first with canonical aliases side by side; MCP splits one op into `baton_*` and
   `fleet_run_*` spellings with divergent arg shapes. **Cost:** highest — every first integration
   and every cross-surface port burns a refusal plus a source dive. **Fix:** one canonical dot name
   per op; each surface advertises its admitted transport verbatim and carries the
   `{canonical → transport}` map; the web continuation descriptor emits the admitted transport.
   **Cross-ref:** #139; grammar verdict (§3) + NEW.
2. **Typed refusals are destroyed at every edge.** Merge of web F2+F3+F4+F8, mcp F3+F5+F9, cli
   E-10. Unknown-field refusals discard the offending key; the named validator refusal collapses
   to `application_command_arguments_invalid` / `invalid_run_command`; the coaching
   `size_exceeded` family (`{cap, actual, unit, gracefulPath}`) falls through to a generic 503
   (web) or bare `command_outcome_unknown` (MCP — `stateFailureCode` allowlists zero `*_exceeded`
   codes); `_authorize` collapses four distinct preconditions to one `403 forbidden`. **Cost:**
   high, daily — agents retry blind and cannot learn caps, shapes, or which field is wrong. **Fix:**
   preserve the typed code plus `{field, cap, actual, unit, gracefulPath}` detail at the web
   `dispatchFailure`, the MCP `validateArguments` catch, and the `stateFailureCode` allowlist.
   **Cross-ref:** #139, #129, #105, #41-pattern.
3. **Silent reinterpretation — an unknown CLI `run` verb becomes a new Run objective.** cli F-1.
   `application-cli.mjs:1578` routes any unrecognised action into `parseStart`; `baton run shwo`
   compiles to a `run.start` with `"shwo"` as the objective (cli §3 E-1). **Cost:** the
   highest-mistake-induction site on any surface — a connected typo launches a real Run. **Fix:**
   refuse unknown `run <verb>` with `cli_command_unavailable` and the closed verb set (mirror the
   `waves` branch's refusal). **Cross-ref:** #139, #136, silent-start variant NEW.
4. **The MCP default profile is not a superset of the bus.** mcp F1+F2. 14 run-lifecycle ops are
   `combined`-profile-only and `run.resume_work`/`run.retry_verification` are absent from every
   profile, though the web bus and CLI serve them all. **Cost:** high — an orchestrator at the
   documented default cannot approve a plan, wait/follow, adopt/review/integrate, resume, or retry
   verification; this wave's own steering (`approveOnAdvertisedPlan`, `nudgeOnCheckpoint`) would be
   impossible at the default profile. **Fix:** render `baton_*` legacy siblings for the lifecycle
   tail into the `application` profile (or change the documented default to `combined`), and add
   `fleet_run_resume_work` + `fleet_run_retry_verification`. **Cross-ref:** #147; profile-gating NEW.
5. **The CLI cannot steer or emergency-stop a wave.** cli F-3. `waves.send`/`waves.stop` are
   ghost rows — registry claims `cli`, parser refuses, while web and MCP carry both. **Cost:** high
   for incidents — the operator surface is the only one missing the destructive `waves.stop`.
   **Fix:** add `baton waves send …` / `baton waves stop …` parse branches (input schemas already
   exist). **Cross-ref:** NEW; #132 adjacency.
6. **Cursor/pagination gaps and silent ceilings.** Merge of cli F-4+F5, mcp F8, web F6.
   `runs list` and `waves list` accept no `--cursor` though the server schema does (#136); MCP has
   three cursor idioms (`afterCursor` / `cursor`/`nextCursor` / `pageCursor`); `run_wait`'s refusal
   names a ceiling but not its 30 000 value. **Cost:** medium — catalogs are dead past page one and
   paging requires learning three conventions. **Fix:** add `--cursor` to the two list verbs, unify
   on `cursor`/`nextCursor`, state the ceiling in the refusal. **Cross-ref:** #136; NEW.
7. **Surfaces teach what they refuse — doc/conformance truth diverges from parser and admission.**
   Merge of cli F-2+F-10, web F7, mcp F4+F5+F7, plus reconciliation note 1.4.1. `run watch` is
   advertised but dead (`render-surface-docs.mjs` vs `parseBatonCli`); `run steer` doc row is
   stale; `CLI_WEB_COMMANDS` whitelists 8 facade ports the web refuses; MCP `initialize` points at
   the non-MCP `context.briefing`; `{decision}` is advertised by `applicationAnswerSchema` but
   refused by the validator; `MCP.md` wave examples omit the required `repoId`; `webBusNames()`
   undercounts the web bus (1.4.1). **Cost:** medium — the generated docs' central promise
   ("generated from the executable inventory") is false for these rows, and agents following them
   hit refusals. **Fix:** make the conformance check compare against parser+admission, not just the
   renderer; fix each doc/schema/admission mismatch. **Cross-ref:** NEW; #140/#146 adjacency.
8. **Discovery/help gaps — the surface doesn't teach its own shape.** Merge of cli F-6+F-7, web
   D2/D3/D4+F5, mcp D1/D4/D5. No help topics for the facade/waves lanes and `--help` mis-resolves
   to `run.start`; connection-profile refusals name no next action (doctor knows it); the envelope
   grammar, the 3-file connection dance, the `actionId` provenance, and the SSE ticket/resume
   routes are unadvertised. **Cost:** medium — every fresh orchestrator reads source for what the
   surface could state in one card. **Fix:** one help topic per lane; append the doctor hint to
   config refusals; advertise envelope fields, the origin/repoId preconditions, `actionId`
   provenance, and the SSE routes on the card/help. **Cross-ref:** #137, #136, #132, #139; NEW.
9. **Scriptability — exit-code taxonomy splits refusal classes across two buckets.** cli F-8.
   `cli_command_host_local` and `cli_action_inputs_invalid` exit 1 while `cli_invalid`/
   `cli_command_unavailable` exit 2; drivers scrape stderr text instead. **Cost:** low-medium.
   **Fix:** document the contract and move all `cli_*` refusals into one bucket. **Cross-ref:** NEW.
10. **The shared scratchpad has no write verb on CLI/MCP-app — the wave's own handoff lane is
    surface-asymmetric.** cli F-9/S-3, confirmed at §0: the web row's report elevated to `shared`,
    the mcp row's stayed in `worker:` scope, and the cli row published nothing (no write/append
    verb, `cli §1.2`). **Cost:** medium — a wave whose shared-lane handoff depends on the weakest
    surface loses members' reports. **Fix:** add a `run scratchpad append RUN_ID --scope shared
    --body …` verb (or equivalent); also refuse bare `run scratchpad` (it leaks `undefined`).
    **Cross-ref:** #139; write-verb NEW.
11. **MCP transport is stdio-only (#138).** mcp F6. Excludes process-per-call and remote/stateless
    orchestrators; `baton-mcp-web` still calls `serveMcpStdio`. **Cost:** medium. **Fix:** an HTTP
    endpoint (design sketch at mcp §7); the replay-ledger and per-tool idempotencyKey already
    support exactly-once. **Cross-ref:** #138.

---

## 3. Grammar verdict

**One canonical name, three transport spellings — the divergence is correct, but the map must be
taught.**

- **Canonical operation name** = dot-spelled (`run.view`, `waves.start`, `run.approve`) — what the
  registry already declares. **Web transport** = underscore (`run_view`). **CLI transport** =
  noun/verb argv (`run view`, `run member stop`). **MCP transport** = tool name (`baton_run_inspect`,
  `fleet_run_status`).
- The three transport spellings legitimately differ: idempotency/identity is keyed on the transport
  string (web §4 G1), and HTTP command strings, argv, and MCP tool names each carry their own
  constraint. **Divergence is correct** and should be preserved.
- The defect is **not** the divergence. It is that (a) no surface teaches its `{canonical →
  transport}` map, and (b) two surfaces advertise spellings they refuse (web card advertises dots,
  wire refuses them; CLI advertises `run watch`/`run steer` which it refuses). Fixes: (1) every
  surface advertises its admitted transport verbatim; (2) the web continuation descriptor emits the
  admitted transport (`run_inspect`, not `run.inspect`); (3) retire or wire the dead advertised
  verbs; (4) resolve the MCP dual-spelling by giving the lifecycle tail `baton_*` siblings at the
  default profile (the M4b pattern already covers only 10 ops, mcp §1.2.2).
- This **resolves `web` DECISION_REQUEST 1 in favour of Option A/C** (surface-level: advertise the
  admitted transport + carry the map). Option B (make the wire spelling-agnostic by resolving dots
  to underscores before the scopeKey) is rejected for now: it changes admission identity (M4B-1)
  and is a separate decision, not required once the map is taught.
- **Answer grammar:** unify on the validator's accepted forms (`optionId`/`text`); remove the
  advertised-but-refused `{decision}` from `applicationAnswerSchema` (mcp F5/G5), and converge the
  three answer/approve grammars (mcp G4) onto one.
- **Cursor grammar:** unify on `cursor`/`nextCursor` for the run lifecycle (mcp F8); add `--cursor`
  to `runs list`/`waves list` (cli F-4/F-5).
- **Keep:** web idempotency (scopeKey+requestDigest, replay `replayed:true`) is uniform and correct
  (web §4 G4); the closed-vocabulary refusals in the #10 family (cli §4 G5) are the model to copy.

---

## 4. Top-5 actionable list (fix first for agentic experience)

1. **Teach each surface its admitted grammar** (§3). Highest recurring cost and the root of the
   web F1 / cli F-2 / mcp F1 spelling defects; one card/help/map change per surface removes the
   `400 unsupported command` every fresh driver burns.
2. **Preserve typed refusals at every edge** (§2 #2, #139/#129/#41). Unknown-field, args-invalid,
   and `size_exceeded` coaching must carry `{field, cap, actual, unit, gracefulPath}` and a next
   action — cheapest fix, second-highest daily cost, and the CLI/MCP already do it (web drops it).
3. **Stop silent reinterpretation** (§2 #3, cli F-1). Refuse unknown `run <verb>` instead of
   compiling the typo into a new Run objective — the single most dangerous mistake-inducer.
4. **Make the MCP default profile a superset of the bus** (§2 #4, mcp F1+F2). MCP is the stated
   primary agent surface yet cannot approve/wait/adopt/resume/retry at the documented default; add
   the `baton_*` lifecycle siblings and the two missing tools.
5. **Restore wave steering and enumeration on the CLI** (§2 #5 + #6, cli F-3/F-4/F-5). Add
   `waves.send`/`waves.stop` (emergency steering) and `--cursor` to `runs list`/`waves list` (#136);
   without them the operator surface can neither stop a wave nor enumerate past page one.

---

## 5. Escalations and recorded decisions

- **`web` DECISION_REQUEST 1** (where the dot/underscore fix lives): **resolved by the coordinator**
  per §3 — Option A/C (surface-level map), Option B deferred as a separate M4B-1 admission-identity
  decision. No escalation UP required.
- **`cli` R-2** (shared-layer publication gap / missing scratchpad-write verb): **resolved by the
  coordinator** — the durable file is the harvest artifact; the missing write verb is recorded as
  §2 #10 and §0, not re-tried out-of-band (no fabrication, no resident reach). The shared lane's
  emptiness is itself evidence for #10.
- **No `DECISION_REQUEST` from `row-mcp`** (mcp § style decisions).

---

## 6. Meta-finding — the audit audited itself

Per the staging frame ("the audit audits itself"), the wave's own execution produced first-hand
evidence: (a) the shared-layer handoff is surface-asymmetric — web elevated to `shared`, mcp
worker-scoped, cli absent (§0), matching `cli F-9`/`S-3`; and (b) `row-mcp`'s parity conclusion was
skewed by an inventory that undercounts the web bus (§1.4.1) — the same class of doc-truth drift
the wave set out to find. Both are folded into the ranking as #10 and #7 respectively.
