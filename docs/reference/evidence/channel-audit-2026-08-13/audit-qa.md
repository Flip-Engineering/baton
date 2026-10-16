AUDIT-QA v1

# CHANNEL-AUDIT QA — coordinator cross-check (v4-pro seat), increment 2

**Coordinator seat:** deepseek-v4-pro[1m]. **HEAD verified at:** `e371f70` ("Baton private
effective-tree snapshot"). **Wave:** channel-audit-2026-08-13. **Rows:** row-chan (channels),
row-suborch (#74 suborchestrator remainder), row-know (knowledge tiers), row-env (member
environment fidelity).

> **Method note (NUL discipline).** `application.mjs` and `coordination-store.mjs` carry
> NUL bytes (3 each) and are binary to a plain `grep`; every citation against them below used
> `grep -an`/`sed -n` per the foundry frame. A plain grep silently returns nothing on those
> two files — an early pass of this QA over-read that as "facade absent" and was corrected.

---

## 0. Provenance and state (read first)

I received **no `signalOnMembersDone`**. The `shared` scratchpad read **did not work FOR ME**
(no `run.scratchpad.read`/write verb is advertised to this worker seat, and no `channel-audit*`
wave state exists under `.baton/`). Durable-file fallback found **no row report on disk** —
no `row-chan*`, `row-suborch*`, `row-know*`, `row-env*` file exists anywhere in this tree or
in any sibling worktree (the 12 `.baton/wt/ws-*` seats are all other waves: `blind-waits`
#164, `orchestrator-plan-object` #161, clean seats). The four rows are **silent and
un-landed**, so there are no row findings to uphold or overturn. Everything below is a
**coordinator-direct** re-verification of the evidence base at HEAD, clearly labeled.

### The publish attempt — exact refusal (audit evidence)

I attempted the publish the frame mandates ("write your file AND post the full text to the
`shared` scratchpad partition"). Result, verbatim:

```
$ parseBatonCli(["run","scratchpad","write","run:x","--scope","shared","--kind","note","--title","channel-audit","--text","AUDIT-QA v1 …"])
→ PARSE-REFUSAL { message: "unexpected argument write", code: "cli_invalid" }

$ parseBatonCli(["run","scratchpad","append","run:x","--scope","shared"])
→ PARSE-REFUSAL { message: "unexpected argument append", code: "cli_invalid" }

$ parseBatonCli(["run","scratchpad","read","run:x","--scope","shared"])
→ PARSE-OK { name: "run.scratchpad.read" }   // read/elevate exist; write/append do not
```

The refusal is thrown at `impl/src/application-cli.mjs:1511` (`throw cliError(\`unexpected
argument ${sub}\`)`). **A publish that fails IS a finding** — this is the live, typed proof
that #158 (the shared-scratchpad WRITE verb) is still RED: the row→coordinator handoff channel
has a read half and no write half, which is precisely why this wave's rows had no way to post
to `shared` and the coordinator had no way to read it.

---

## 1. Per-report VERDICT

| Row | Assigned axis | Report landed? | VERDICT |
|---|---|---|---|
| row-chan | channels | NO — silent/un-landed | **NO-REPORT** — cannot uphold or overturn |
| row-suborch | #74 suborchestrator remainder | NO — silent/un-landed | **NO-REPORT** — cannot uphold or overturn |
| row-know | knowledge tiers | NO — silent/un-landed | **NO-REPORT** — cannot uphold or overturn |
| row-env | member environment fidelity | NO — silent/un-landed | **NO-REPORT** — cannot uphold or overturn |

---

## 2. Unified channel-gap table (coordinator-direct; verified at HEAD `e371f70`)

Every verdict carries a citation I re-verified this session (with NUL discipline). "Stale"
marks a citation in the evidence base (`comm-topology-audit.md`, HEAD `05740e0`) that no
longer reproduces verbatim at `e371f70`.

### 2a. LANDED — reproduce at HEAD

| Channel | Verdict | Verified instance (this session) |
|---|---|---|
| Message lane (#86/#92) | LANDED | `MESSAGE_SEND_GRAMMAR` `claude-session.mjs:33` |
| Reply chains (#105) | LANDED | `MAX_MESSAGE_DEPTH_BUDGET=8` `limits.mjs:119`; `refuse('message_target_not_member')` `coordinator.mjs:12799`; `refuse('message_depth_exceeded')` + `lastRefusal` `coordinator.mjs:12813-12814` — **stale in evidence base** (cited `:12570-12592`; shifted) |
| Decision lane (DECISION_REQUEST) | LANDED | `DECISION_REQUEST_GRAMMAR` `claude-session.mjs:27` |
| Attention inbox + waitingOn (#10) | LANDED | `WAITING_ON_KINDS` closed five `application-semantics.mjs:59-61` |
| Board (#78) | LANDED | dispatch `application.mjs:12524`; `boardPost` seam `application.mjs:13153` — **stale in evidence base** (cited `:13093`; shifted) |
| Scratchpad read/elevate (#33/#68) | LANDED | dispatch `application.mjs:12522`; `scratchpadRead` seam `application.mjs:13091` — **stale in evidence base** (cited `:13031`; shifted); suite `scratchpad-33-red.test.mjs` **50/50** |
| Wave observability (#132) | LANDED | `_waveRegistry` `coordination-store.mjs:1231`; suite `wave-observability-red.test.mjs` **30/30** |

### 2b. OVERTURNED — evidence base said GAP/RED; landed at HEAD

| Channel | Evidence-base verdict | QA verdict | Verified instance (this session) |
|---|---|---|---|
| `coordinator_authority_forbidden` (#74 A5) | GAP — "no emitter at HEAD" | **LANDED** | `_refuseCoordinatorAuthority` `application.mjs:3230-3238` emits `COORDINATOR_AUTHORITY_FORBIDDEN` with `{attempted: name, gracefulPath: 'DECISION_REQUEST'}`; constants `limits.mjs:141-142`. The #74 A5 `{attempted, gracefulPath}` shape is exactly this. |

### 2c. REFINED — partially closed at HEAD (evidence base is binary; reality is graded)

| Channel | QA verdict | Verified instance (this session) |
|---|---|---|
| Context packs (BD3-B) | **PARTIAL** — orchestrator facade landed, worker verb still absent | Epic #103 `resolveBriefing` `application.mjs:12757` (comment: "DIRECT PORT — never advertised on MCP/CLI/web"); `mintContextPack` call `application.mjs:12797`; kernel `mintContextPack` `coordination-store.mjs:13255`. Evidence base's "kernel-only, no facade" is now **stale**: a facade exists but is orchestrator-internal — the specific BD3-B gap (a sub-orchestrator handing a *member* a pack through a surfaced verb) remains open. |
| Knowledge tiers (#70) | **PARTIAL** — recall/horizon landed; cross-deployment federation RED | `knowledge.recall`/`knowledge.horizon` MCP tools `mcp-northbound.mjs:782-783`, `baton_knowledge_recall`/`baton_knowledge_horizon` at `:1094-1097`; but **zero** `primaryRoot`/federation matches in `impl/src` → the #70 project-tier-across-roots rung is contract-only. |

### 2d. STILL GAP / RED — reproduce at HEAD

| Channel | Verdict | Verified instance (this session) |
|---|---|---|
| **Scratchpad WRITE verb (#158)** | GAP — RED | exact refusal `cli_invalid: unexpected argument write` at `application-cli.mjs:1511` (Section 0) |
| Tight-cell rung (#102) | GAP — RED | `wave.mjs` **0** `group`/`cell` matches (D-depth-1..4, collector all contract-only) |
| Orchestrator wake (#71) | GAP — RED | `orchestrator-wake-red.test.mjs` **6/36** |
| REPL shared objects (#69) | GAP — RED | `repl-realization-red.test.mjs` **10/34** |
| Doubt lane (#66) | GAP — RED | `doubt-review-red.test.mjs` **5/35** (e.g. `coordinator.resolveDoubt` missing) |
| Coordinator seat (#74 A1–A8) | GAP — RED (mostly) | no `role:'coordinator'` admission in `workflow-interpreter.mjs` (only the D4 `MESSAGE_KINDS` brief/result comment at `:44`) — the authority *refusal* (2b) landed ahead of the seat it coaches |
| CLI wave ghosts (#157) | GAP — RED | semantic registry advertises `waves.send` `application-semantics.mjs:1599` while the CLI waves branch refuses `application-cli.mjs:1383-1385` (`cli_command_unavailable`) — the exact #153 advertised-but-dead divergence; `cli-wave-fidelity-red.test.mjs` **absent** |
| CLI silent reinterpretation (#155) | GAP — RED | unknown `run <verb>` falls through to `parseStart` `application-cli.mjs:1578`; `cli-silent-start-red.test.mjs` **absent** |
| Cross-deployment knowledge federation (#70) | GAP — RED | no `primaryRoot`/project-federation surface (see 2c) |

### 2e. C0 — the live failure (this wave's own channel gap)

The row→coordinator handoff failed in this very wave: no rows materialized, no
`signalOnMembersDone` emitted, and the publish/read channel is missing its write half
(Section 0). This is the #163 silent-turnless failure mode made live — the completion/settle
signal the coordinator depends on is produced by exactly the surface (#158) that is still RED.

---

## 3. Spot-check record

| # | Claim | Command | Result |
|---|---|---|---|
| 1 | Publish refusal (store-path + live) | `parseBatonCli(["run","scratchpad","write",…])` | **CONFIRMS** — `cli_invalid: unexpected argument write` (`application-cli.mjs:1511`) |
| 2 | Context-pack kernel lane | `sed -n 13250,13260p coordination-store.mjs` | **CONFIRMS** — `mintContextPack(fields, auth)` `:13255` |
| 3 | #102 tight-cell RED | `grep -ac 'group\|cell' wave.mjs` | **CONFIRMS** — 0 |
| 4 | Message-lane grammar | `sed -n 30,36p claude-session.mjs` | **CONFIRMS** — `MESSAGE_SEND_GRAMMAR` `:33` |
| 5 | #157 ghost | `sed -n 1380,1386p application-cli.mjs` | **CONFIRMS** — waves branch names only `{list,progress,start,attach,run}` |
| 6 | #74 A5 emitter (overturn) | `sed -n 3230,3238p application.mjs` | **CONFIRMS** — `_refuseCoordinatorAuthority` emits `{attempted, gracefulPath}` |

**No false alarm in my direction; one false alarm in the evidence base's direction.** The
evidence base (`comm-topology-audit.md`, HEAD `05740e0`) is **stale at `e371f70`**: (a) line
anchors for reply chains, board, and scratchpad have all shifted; (b) the
`coordinator_authority_forbidden` "no emitter" GAP has flipped to LANDED; (c) the context-pack
"kernel-only" verdict is now graded (orchestrator facade exists, worker verb does not). A
gap that no longer reproduces — and a "LANDED" whose cited line no longer exists — is exactly
what this QA exists to catch, and both are present.

---

## 4. Prioritized fix list (mapped to issues; corrected for what is still RED at HEAD)

| Pri | Fix | Owning issue | State at HEAD |
|---|---|---|---|
| 1 | Scratchpad WRITE/append verb — the publish channel's missing half (this wave's live failure) | #158 | RED — exact refusal `cli_invalid: unexpected argument write` |
| 2 | Quiescence-derived wave completion (de-clock `hardCapMs`; silent-turnless rows observable to settle) | #163 | RED — contract-only; this wave is the live instance |
| 3 | Coordinator **seat** (role admission A1–A8) — the authority refusal (2b) landed ahead of the seat | #74 | RED (refusal LANDED, seat RED) |
| 4 | Tight-cell rung (group admission, D-depth-1..4, collector) | #102 | RED — `wave.mjs` 0 group/cell |
| 5 | Orchestrator wake (top woken on park/doubt) | #71 | RED — 6/36 |
| 6 | CLI wave ghosts (parse+admit+doc `waves.send`/`waves.stop`; add the missing red suite) | #157 | RED — semantics advertise, CLI refuses; no test file |
| 7 | Context-pack **worker** facade/MCP projection (BD3-B remainder) | #87/#48 (OQ2) | PARTIAL — orchestrator-only `resolveBriefing` landed |
| 8 | Doubt lane (receipted `doubt` kind) | #66 | RED — 5/35 |
| 9 | REPL shared objects | #69 | RED — 10/34 |
| 10 | CLI silent reinterpretation (unknown verb must refuse, not start; add the missing red suite) | #155 | RED — fall-through at `application-cli.mjs:1578`; no test file |
| 11 | Cross-deployment knowledge federation (project tier across roots) | #70 | RED — no `primaryRoot` surface |
| 12 | Admission-coherence discipline (parser AND admission AND docs) | #153 | doctrine — the #157 ghost is its live violation |

**Unresolved cross-refs:** #171 and #173 have no discoverable local contract (`gh`
unauthenticated here) — flagged, not guessed. **Reference-only (LANDED/DONE):** #10
(waitingOn, verified), #12 (baton-absence refusal — the vocabulary the A5 wrapper sits over),
#147 (control-surface audit — the completed precedent for this wave's shape).

---

## 5. The named miss

All four rows missed everything (they produced nothing) — but the substantive miss to name is
that **the evidence base itself is stale and none of the rows would have caught it**: the
`coordinator_authority_forbidden` gap (#74 A5) has landed at HEAD, and the context-pack gap
has been partially closed, both *since* the reference audit was written. A channels audit that
re-cited `comm-topology-audit.md` verbatim would have reported a RED pin that is now GREEN —
a false alarm in the fix list. The single most valuable correction this QA makes is in
Section 2b/2c: two "RED" verdicts in the durable evidence are already stale.

---

## 6. Escalations (recorded — no escalation verb on this seat)

- **E1 — is a coordinator seat meant to have a scratchpad read/write verb?** The read half
  exists (`run.scratchpad.read`), the write half does not (#158). Until #158 lands, the
  coordinator cannot see row posts except as durable files — which this wave shows is not a
  workable handoff.
- **E2 — settle signal for silent-un-landed rows.** #163 covers silent-*turnless* rows that
  still *write*; this wave's rows wrote nothing. Confirm whether "proceed + name the gap" was
  the correct dispatch, or the rows should be re-dispatched.
- **E3 — #171/#173 contracts are absent locally.** Confirm in-scope status before folding
  into the fix list.

---

## 7. Shared-publish record

**Refused, verbatim:** `cli_invalid: "unexpected argument write"` (and `"unexpected argument
append"`) at `application-cli.mjs:1511`. Full text not published to `shared`; the refusal is
Section 0's finding and fix-list item #1.
