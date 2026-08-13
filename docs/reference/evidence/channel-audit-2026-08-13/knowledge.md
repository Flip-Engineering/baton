[attempt: e4fb268d-8a0e-41b9-99db-c60ba66b6dce row-know]

# ROW-KNOW — the knowledge-graph / scratchpad tier system as the campaign actually used it

Row: `row-know` · Wave: `channel-audit-2026-08-13` · Frame: `channel-audit-2026-08-13/foundry-brief.md` (shared laws)
Target: **task-ephemeral → workflow-ephemeral → project-persistent** scratchpad tiers with orchestrator-gated elevation.
Verdict scale: PROVEN (cited instance of correct behavior) / GAPPED (cited instance of failure/unreachable/bypass) / UNEXERCISED (no wave used it).

---

## 0. Evidence base (store located this session)

The resident coordination store is undocumented in the repo; it was located by tracing the resident
deployment profile (`impl/scripts/resident.deployment.mjs` → `openBaton({repo: process.cwd()})` →
`openBatonDeployment`, `impl/src/application-deployment.mjs:1744` → deploymentRoot =
`privateDirectory(join(repository.common, 'baton', 'application-v3'))`; stateRoot =
`join(deploymentRoot, 'state')`; CoordinationStore wired at `impl/src/index.mjs:1253`).

- **Store:** `/Users/wahargis/Development/Experiments/baton/.git/baton/application-v3/state/coordination/`
  — `events.jsonl` (59,388 lines at final poll, 35.2 MB), `projection.checkpoint`, `writer.lease`.
  Store wiring: `new CoordinationStore(join(opts.logDir, 'coordination'), …)` at
  `impl/src/index.mjs:1253`; deploymentRoot derivation at `openBatonDeployment`
  (`impl/src/application-deployment.mjs:1744`) → `privateDirectory(join(repository.common, 'baton',
  'application-v3'))`, stateRoot `join(deploymentRoot, 'state')`; resident profile calls
  `openBaton({repo: process.cwd()})` (`impl/scripts/resident.deployment.mjs:9`).
- **Event discriminator field is `kind`** (not `type`). All counts below re-extracted this session
  with `jq` on `.kind`.
- **Event inventory (this store, at final poll):** `scratchpad.entry_written` **13** (12 campaign +
  this row's seq 59240), `scratchpad.entry_elevated` **4**, `scratchpad.partition_reaped` **1**,
  `knowledge.promoted` **129**, `scratch.fact_posted` **0**, `artifact.registered` 250,
  `web.command_admitted` 1509.

---

## Q1 — What did members actually WRITE? (13 entries, ALL worker-scoped)

Every `scratchpad.entry_written` event this campaign's waves produced, from the store
(`jq 'select(.kind=="scratchpad.entry_written")'`):

| seq | ts (Z) | runId | worker | kind | payload |
|-----|--------|-------|--------|------|---------|
| 47850 | 04:53:06 | run-101f… | w-196 | plan | objective "row-web surface audit report part 1/5" |
| 47859 | 04:53:07 | run-ea47… | w-198 | note | "# surface-audit-mcp — MCP northbound control-surface audit (#147)" |
| 47864 | 04:53:10 | run-ea47… | w-198 | note | surface-audit-mcp (cont.) |
| 47877 | 04:53:22 | run-ea47… | w-198 | note | surface-audit-mcp (cont.) |
| 47888 | 04:54:29 | run-ea47… | w-198 | note | surface-audit-mcp (cont.) |
| 47907 | 04:54:30 | run-101f… | w-196 | plan | row-web surface audit (part) |
| 47912 | 04:54:31 | run-101f… | w-196 | plan | row-web surface audit (part) |
| 47917 | 04:54:31 | run-101f… | w-196 | plan | row-web surface audit (part) |
| 50790 | 08:49:00 | — | w-205 | note | "#155 redteam — NOT FOLD-READY" |
| 52296 | 09:36:09 | — | w-208 | note | "#164 RED-TEAM — NOT FOLD-READY (5 blockers)" |
| 53762 | 10:14:59 | — | w-210 | note | "#157 suite-draft notes — CLI wave ghosts + interpreter-wave registry fidelity" |
| 58092 | 12:02:48 | — | w-225 | note | "row-chan — channel-audit publish" |
| 59240 | 12:12:50 | — | w-227 | note | "[attempt: e4fb268d…] row-know — channel-audit publish" (this row's up-channel publish) |

**All 13 entries are in `worker:<workerId>` scope (the 12 listed + this row's seq 59240). Zero
entries in `shared` scope — ever.**
`writeScratchpad` hardcodes the scope at `impl/src/coordination-store.mjs:14103`:
`const scope = \`worker:${fields.workerId}\`;` (second identical hardcode at :14183).

**Is the volume honest signal or noise?** Honest signal, concentrated, not noise — but only 3 of the
campaign's waves wrote to the store at all:

- **surface-audit #147** (run-101f row-web + run-ea47 row-mcp): 8 entries — the campaign's richest
  scratchpad use. **PROVEN.**
- **review-foundry** (#155 w-205, #161 w-208) and **suite-foundry** (#157 w-210): 3 entries. **PROVEN.**
- **channel-audit** (row-chan w-225 + row-know w-227): 2 entries (this wave; row-know's is the
  up-channel publish at seq 59240). **PROVEN.**
- **contract-foundry** wave (the four #163/#165/#167/#146 contract rows): **ZERO store entries.**
  The four rows' "shared publishes" never reached the store — they exist only as durable files.
  `docs/reference/evidence/contract-foundry-2026-08-13/foundry-qa.md:9-17`: "All four shared posts are
  absent (the #158 append verb is unlanded), and all four were read from their durable files."
  **GAPPED** (the shared-write path, #158).

So the store is NOT a faithful record of "what members wrote this campaign" — it is only the record
of what landed in worker partitions. Any wave whose publish target was `shared` wrote nothing to the
store. The volume undercounts the campaign's real publish activity by exactly the shared-write gap.

---

## Q2 — Did elevation ever happen? (YES, task→workflow, via the automatic ritual; NO workflow→project)

### Task→workflow elevation: PROVEN, 4 entries, automatic only

Four `scratchpad.entry_elevated` events (seq 48063–48066) plus one `scratchpad.partition_reaped`
(seq 48067), all timestamped 04:59:58.218Z, batch `scratchpad_task_settlement` id
`613917d0…`, index 4, count 5. The reap event:

```json
{"kind":"scratchpad.partition_reaped","actor":"orchestrator",
 "idempotencyKey":"scratchpad.partition_reaped:run-101f…:baton-d3f15522ad5a4b9a093334b5-work:4",
 "payload":{"runId":"run-101f…","scope":"worker:w-196","observedFence":4,
   "dispositions":[{"entryId":"a7d2fda…","result":"elevated","targetId":"scratchpad-entry:92206d…","reasonCode":"selected"}, …4 total…],
   "basis":"task_settled"}}
```

The elevation payload (seq 48063) confirms the shared landing and the null project-pointer:

```json
{"payload":{"runId":"run-101f…","scope":"shared",
  "sourceEntryId":"scratchpad-entry:a7d2fda…","sourceEvent":47907,
  "entryId":"scratchpad-entry:92206d…","kind":"plan","scratchFactId":null}}
```

- **What elevated:** row-web's (w-196) four **plan** entries from `worker:w-196` → `shared`
  (`sourceEvent` 47907 maps to the entry_written at seq 47907; the reap disposition maps each
  source entryId to a target shared entryId).
- **By which mechanism:** the automatic settlement ritual, NOT any command. `settlementLease`
  (`coordinator.mjs:11700`) selects each member's note+plan entries from the worker partition
  (`scratchpadSnapshot(memberRunId, workerScope).entries.filter(kind==='note'||kind==='plan')`)
  and calls `elevateTaskScratchpad(task.id, selected)` (`coordinator.mjs:11736`). The store-side
  `elevateTaskScratchpad` (`coordination-store.mjs:14173`) only elevates when `fields.entryIds`
  explicitly names the entries and the run is steering-registered; a terminal auto-settle with
  `entryIds: []` (`coordinator.mjs:1939`) produces `not_elevated` dispositions (`reasonCode`
  `'orchestrator_skipped'`/`'no_driver'`, `coordination-store.mjs:14298-14304`). The observed
  `reasonCode: 'selected'` (same block, `coordination-store.mjs:14299-14300`) proves the entryIds
  were explicitly selected — the ritual path.
- **What did NOT elevate:** row-mcp's (w-198) four **note** entries. Only ONE
  `scratchpad.partition_reaped` event exists in the store (seq 48067, for w-196). w-198's
  partition was never reaped; its notes were never elevated. The ritual ran for the wave, but the
  note entries of a sibling row were left behind. **GAPPED.** (Cited instance: the absence of any
  `scratchpad.partition_reaped` with `scope` `worker:w-198` in the store's 59,388 events, vs. the
  single reap for `worker:w-196` at seq 48067.)

### Workflow→project elevation: GAPPED/UNEXERCISED, never happened

- All four `scratchpad.entry_elevated` events carry **`scratchFactId: null`** — the note-elevation
  branch that mints a scratch fact (`coordination-store.mjs:14258-14271` — `if (source.kind ===
  'note')` at :14258, `factPayload = { ...core, id: 'scratch-fact:…' }` at :14270) never ran,
  because only `plan` entries were elevated. Plan entries never mint facts (`factPayload = null`
  for `kind !== 'note'`).
- **Zero `scratch.fact_posted` events** in the store. Zero `scratch.fact_expired`.
- **Zero `knowledge.promote` command invocations** (see Q5 — no knowledge command was ever admitted).
- The 129 `knowledge.promoted` events are a **separate mechanism**, not scratchpad elevation:
  `107 policy / verified_task_outcome / Finding`, `12 policy / verified_task_outcome / Counterexample`,
  `4 policy / verified_task_outcome / Question`, `6 deployment:repo-76d48… / integration / Decision`.
  These are auto-minted "Task X passed its hub verification" nodes (`trigger: verified_task_outcome`,
  actor `policy`) plus six decision records. None derive from a scratchpad entry.

**The tier law's third tier (project-persistent knowledge) was never reached by any member note.**
The pipeline stops at shared: notes that would become scratch facts were never elevated, and the one
elevation that happened was plan-kind, which the store's fact-mint branch deliberately skips.

---

## Q3 — Orchestrator-side ergonomics: is there a command that shows "entries awaiting elevation review"? NO

Full command inventory relevant to elevation (from `impl/src/application-semantics.mjs`):

| command | surface | what it does | elevation state? |
|---------|---------|--------------|------------------|
| `run.scratchpad` (:1338, liveMethod `projectScratchpadView`) | embedded, cli | read-only partition view | NO — tags every entry `candidateState: 'candidate'` statically (`application.mjs:827`) |
| `run.scratchpad.read RUN_ID --scope shared\|worker:ID` (:1678) | embedded, mcp, cli | read one partition | NO — no state field distinguishes elevated vs not |
| `knowledge.horizon` → `taskHorizon`/`workflowHorizon`/`projectHorizon` (`coordinator.mjs:11906/11932/11974`, via `projectHorizonScratchpad` :364) | embedded, mcp | horizon digest | NO — `projectHorizonScratchpad` also tags every row `candidateState: 'candidate'` statically (`coordinator.mjs:403`) |
| `run.scratchpad.elevate RUN_ID --task TASK_ID --entries JSON` (:1687) | embedded, mcp, cli | elevate explicit entryIds | N/A — requires the caller to already KNOW the entryIds |
| `scratchpad.elevate` (:1465, kernel, requires `expectedScratchpadFence`) | embedded, mcp | same, kernel | N/A — same |

**There is no command that lists "entries awaiting elevation review."** Every read surface collapses
elevation state: `candidateState` is hardcoded to `'candidate'` in both the scratchpad view
(`application.mjs:827`) and the horizon view (`coordinator.mjs:403`), and the only implicit marker —
the `source` field, null for worker-origin rows and `{entryId, entryDigest, eventSeq}` for elevated
rows — is never surfaced as a review queue. An orchestrator cannot ask the resident "what did the
settled waves leave unelevated?"; the resident has no such projection.

**Consequence (named): the tier law is unenforceable as a review queue.** Elevation is
effectively a fire-and-forget ritual: `settlementLease` auto-elevates every note+plan it can find
at wave settle, so no one needs to REQUEST elevation — but anything the ritual misses (w-198's
notes) is invisible to every read surface as "awaiting", and there is no manual command that lists
the miss. The two entryIds-required elevate commands presuppose a selection only the ritual ever
produced.

---

## Q4 — Content quality spot-check: 5 actual notes, all knowledge-shaped (not status chatter)

The tier system's value rests on members writing durable knowledge. Sampled 5 entries (full text in
`events.jsonl` payloads; excerpts quoted):

1. **seq 47850 (w-196, plan, surface-audit #147):** `"SURFACE-AUDIT-ROW v1 # Row-web: resident bus /
   web northbound surface audit (issue #147)"` — opens with its read-list and citation discipline
   ("`web-northbound.mjs`, `web-stream.mjs`, `application-cli.mjs`, `resident-authority.mjs` read
   fully; `application.mjs` and `coordination-store.mjs` read under the NUL discipline…"). **Knowledge.**
2. **seq 47859 (w-198, note, surface-audit #147):** `"# surface-audit-mcp — MCP northbound
   control-surface audit (issue #147)"` — full read-list of 11 files with line counts. **Knowledge.**
3. **seq 50790 (w-205, note, #155 redteam):** `"#155 redteam — NOT FOLD-READY. Target:
   cli-silent-start-contract.md v1.0. … Blockers: B1 §1.2 misattributes audit model-site verdict to
   E-5 (audit names E-6/E-7; E-5 deficient, surface-audit-cli.md:173-176). B2 taught-live set
   excludes follow/steer/member → run steek / follw / membr still silent-start (audit's own F-1
   example; live-verified). B3 D3 metric contradiction: shwo/sned/viwe are adjacent transpositions
   (Levenshtein=2, Damerau=1) → PT-2 fails as written."` — dense, citable, reusable. **Knowledge.**
4. **seq 52296 (w-208, note, #164 redteam):** `"#164 RED-TEAM - NOT FOLD-READY (5 blockers) …
   BLOCKER 1 (D3.2/D1.2 overclaim): per-cycle transport-principal recheck not delivered on any
   surface. MCP post-dispatch recheck (mcp-northbound.mjs:1510) is post-wait only; web
   _postWaitAuthorization (web-northbound.mjs:684-689, seams 746/895/971) is post-wait only…"` **Knowledge.**
5. **seq 53762 (w-210, note, suite-157):** `"#157 suite-draft notes — CLI wave ghosts +
   interpreter-wave registry fidelity … Declared split @ HEAD e371f70: 16 = 8 RED (A7-1..A7-8) +
   8 PIN (B-1..B-8). RED rows (each fails at its named stage today): A7-1 waves.send run:foo →
   {command:'waves.send',args:{runId,message}} [cli-wave-verbs-missing]…"` **Knowledge.**

**Verdict: the entries the campaign DID write to the store are knowledge, not chatter.** Every
sampled entry is a self-contained audit/red-team finding with file:line anchors — exactly the
durable, reusable shape the tier system is for. **PROVEN.** The caveat (Q1): this signal is trapped
in worker partitions unless the ritual elevates it — and for w-198/w-205/w-208/w-210/w-225 it never
did.

---

## Q5 — `run.scratchpad.elevate` (application-semantics.mjs): who exercised it? NOBODY. UNEXERCISED.

**Web surface:** the complete `web.command_admitted` inventory for this campaign contains **zero**
scratchpad/knowledge commands. Distinct admitted command names (counts from the store):
`run_inspect` 1022, `run_act` 177, `run_start` 59, `run_approve` 56, `run_status` 51,
`run_stop` 40, `run_wait` 33, `waves_list` 21, `waves_run` 20, `run_steer` 15,
`run_evidence` 11, `waves_start` 2, `waves_progress` 2, `waves_stop` 1. No `scratchpad.*`,
no `run.scratchpad.elevate`, no `knowledge.*` on the web surface.

**The 8 textual mentions of `run.scratchpad.elevate` / 9 of `scratchpad.elevate` in the store are
NOT invocations.** They are (a) audit-report prose inside entry content (seq 47850/47859 — the
surface-audit rows discuss the command surface) and (b) harvest bodies of the orchestrator's
wave-drive commands (`cmd-foundry-b` seq 49619, `cmd-reviewfoundry-a` seq 53622,
`cmd-suitefoundry-a` seq 55567, `cmd-reviewfoundry-b` seq 57494) embedding QA-report text that
quotes the command name. None is a command_admitted/completed for the verb itself.

**CLI/MCP surface:** live-probed this session against the worktree's `parseBatonCli`
(`impl/src/application-cli.mjs:1208`):

```
["run","scratchpad","write","run:1","--scope","shared","--body","x"] => THROW Error: unexpected argument write
["run","scratchpad","append","run:1","--scope","shared"]            => THROW Error: unexpected argument append
["run","scratchpad","elevate","run:1","--task","task:1","--entries","[]"] => ok (parses — but needs orchestrator authority + known entryIds)
```

The CLI scratchpad family admits only `run.scratchpad.read` and `run.scratchpad.elevate`
(`application-cli.mjs:1476-1516`). The kernel `scratchpad.elevate` (which demands
`expectedScratchpadFence`) is embedded/mcp-only. **No member or orchestrator ever issued any
elevate command in any wave.**

**The 4 elevations that DID happen were automatic** (Q2) — driven by `settlementLease`'s
`elevateTaskScratchpad(task.id, selected)`, not by the `run.scratchpad.elevate` facade. So the
facade-projection epic's showcase command is **UNEXERCISED**, and its sibling outcome — a manual,
orchestrator-reviewed elevation — has no instance in the store.

---

## The shared publish (attempt + exact refusal) — audit evidence for the #158 gap

Per the foundry frame, this row publishes its full report to the `shared` scratchpad partition
(kind `note`, title "row-know"). The attempt and its outcome are themselves findings:

1. **No write verb exists on any surface.** The CLI scratchpad family is read+elevate only
   (`application-cli.mjs:1476-1516`). Live probe: `parseBatonCli(['run','scratchpad','write','run:1','--scope','shared','--body','x'])`
   → **THROW `unexpected argument write`**; `['run','scratchpad','append',…]` → **THROW
   `unexpected argument append`**. (The CLI error wrapper renders these as
   `cli_invalid: unexpected argument write/append` — sibling row-chan recorded the same pair.)
2. **The kernel write hardcodes worker scope.** `writeScratchpad`
   (`coordination-store.mjs:14065`) does `const scope = \`worker:${fields.workerId}\`` at
   `coordination-store.mjs:14103`. Even a directly-invoked write cannot target `shared`.
3. **The only member-facing publish is the `SCRATCHPAD_WRITE:` up-channel emission** (the resident's
   session scanner calls `writeScratchpad` on the member's behalf), which therefore lands
   `worker:<workerId>` — as every store entry did (the 12 campaign entries + this row's own,
   seq **59240**, `scope worker:w-227`).

**Outcome: a `shared` publish is structurally impossible from a member.** This row's `shared`-target
attempt is refused at the surface (`cli_invalid: unexpected argument write`); the up-channel
emission that DID land is pinned to `worker:w-227` by `coordination-store.mjs:14103`
(seq 59240, 12:12:50.757Z, idempotencyKey `row-know.publish.2026-08-13`). The durable artifact —
this file — is the report. This is the #158 gap, reproduced from three directions (surface, kernel,
member up-channel) this session, with the landing cited as a store event.

---

## Cross-row discrepancy worth flagging (for the coordinator's meta-audit)

Sibling row-chan's publish (seq 58092) states: `"C2 elevation UNEXERCISED (0 entry_elevated
events; orchestrator-only)"`. The store **has** 4 `scratchpad.entry_elevated` events (seq
48063-48066, 04:59:58Z). row-chan's stated evidence window in C1 is `48209-57490`, which begins
after the 04:59:58Z elevations — so its "0 events" is a range artifact, not a contradiction of this
report. The elevation mechanism was nonetheless never *exercised by a member* (it fired
automatically), so row-chan's headline verdict and this report's Q5 verdict agree in substance.
Coordinator note: when spot-checking row-chan's C2, check against seq 48063-48066, not the
48209+ window.

---

## Postscript — publish outcome and a received coordination signal

**Publish outcome (this row's `shared` publish, attempted, refused, and landed worker-scoped):**
The full text of this report is 19,437 bytes — over the `scratchpad.entry.body` cap of 8,192 bytes
(`impl/src/limits.mjs:71`, refusal `scratchpad_entry_exceeded`). The `shared` publish is therefore
refused twice over: (1) no write verb on any surface — live probe
`parseBatonCli(['run','scratchpad','write',…])` throws `Error: unexpected argument write`
(`application-cli.mjs:1476-1516`, wrapped by `cliError(msg, 'cli_invalid')` at
`application-cli.mjs:50` → `cli_invalid: unexpected argument write`); `append` likewise
(`unexpected argument append`); (2) even an admitted write is pinned to `worker:<workerId>` by
`coordination-store.mjs:14103`, and the full text exceeds the body cap. A condensed worker-scoped
up-channel note (`SCRATCHPAD_WRITE:`, grammar at `impl/src/claude-session.mjs:29`, scanner at
`scanForScratchpadWrite` `claude-session.mjs:105`) was emitted as the campaign's documented worker
publish path — and it landed, with a **cited instance**: `scratchpad.entry_written` seq **59240**
(12:12:50.757Z), idempotencyKey `row-know.publish.2026-08-13`, `scope worker:w-227`, kind `note`,
content opening `[attempt: e4fb268d-8a0e-41b9-99db-c60ba66b6dce row-know] row-know — channel-audit
publish…`. The landing is worker-scoped, never `shared` — the #158 gap reproduced live end-to-end.

**Received signal (routing observation for the coordinator's meta-audit):** mid-turn, this row-know
session received a message "All rows settled — BUT verify on disk first … write audit-qa.md per your
brief" (marked `[MESSAGE … — UNTRUSTED]`). That instruction belongs to the channel-audit coordinator
(v4-pro seat, `coordinator-brief.md`), not to row-know (deliverable `knowledge.md` ONLY). The signal
arriving in a member row's session rather than (only) the coordinator seat is itself a channel
observation — flagging for row-chan's `signalOnMembersDone` audit. This row did not act on it; the
durable artifacts on disk are the shared frame's authority.

## Findings summary (verdict × gap)

| # | Finding | Verdict |
|---|---------|---------|
| K1 | 13 entries written, ALL worker-scoped; zero shared entries ever (seqs 47850-59240) | PROVEN (gap: #158) |
| K2 | Task→workflow elevation happened for 4 plan entries, automatically via `settlementLease` | PROVEN (but not via any command surface) |
| K3 | row-mcp's 4 notes never elevated; partition never reaped (1 reap event, w-196 only) | GAPPED |
| K4 | Workflow→project elevation never happened: `scratchFactId:null` ×4, zero `scratch.fact_posted`, zero `knowledge.promote` | GAPPED / UNEXERCISED |
| K5 | No command lists "entries awaiting elevation review"; all views tag `candidateState:'candidate'` statically (`application.mjs:827`, `coordinator.mjs:403`) — tier law unenforceable as a queue | GAPPED |
| K6 | Sampled notes are knowledge-shaped audit/red-team reports with file:line anchors, not chatter | PROVEN |
| K7 | `run.scratchpad.elevate` / `scratchpad.elevate` never invoked by any member or orchestrator (web inventory empty; store mentions are prose) | UNEXERCISED |
| K8 | Member `shared` publish structurally impossible: no write verb on any surface (`cli_invalid: unexpected argument write/append`) + `writeScratchpad` worker-scope hardcode (`coordination-store.mjs:14103`); up-channel publish landed worker-scoped (seq 59240) | GAPPED (#158) |
