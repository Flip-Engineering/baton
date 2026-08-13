[attempt: e4fb268d-8a0e-41b9-99db-c60ba66b6dce row-chan]

# CHANNEL-AUDIT v1 — row-chan: the cross-agent channel audit

**Row:** `row-chan` · **Frame:** `docs/reference/evidence/channel-audit-2026-08-13/foundry-brief.md` (commit `82baf5b`) · **Wave:** `channel-audit-2026-08-13-wave-a` (`wave:8424ad0df634463dda22fdfb639ba38d`, store seq 53795).

Every channel a member uses to reach another member or the orchestrator, audited against this
campaign's real foundry waves (contract foundry wave-b, review foundry wave-a) with citations.
Verdicts: **PROVEN / GAPPED / UNEXERCISED**. The evidence base is the resident's coordination
store (path below), the three wave specs, the QA/red-team reports, and the interpreter source.

---

## 0. First job — the resident's coordination store (the frame's "location is UNDOCUMENTED" anchor)

The frame's anchor list says the store location is undocumented and row-chan's first job is to
find it. **Found.** The resident's coordination store (event-sourced, `events.jsonl`) lives at:

```
/Users/wahargis/Development/Experiments/baton/.git/baton/application-v3/state/coordination/events.jsonl
```

**Derivation (citied):** `application-deployment.mjs:1796-1797` —
`deploymentRoot = privateDirectory(advanced.deploymentRoot ?? join(repository.common, 'baton', 'application-v3'))`
— and `:185-187` sets `repositoryAuthority.common = realpathSync(git rev-parse --git-common-dir)`.
The resident (`impl/scripts/resident.deployment.mjs`, `openBaton({repo})` with no explicit
stateDir) therefore persists under the repo's git-common-dir. On disk: a 34 MB `events.jsonl`,
all campaign wave events recorded here (this audit read through store seq 57500+, still live;
events for the wave under audit — channel-audit wave-a, seq 53795 — were read through the current
run). The foundry frame's hint that "`.baton/` top-level holds per-taskwave
dirs but none for resident-run waves" is consistent: the resident writes wave state under
`.git/baton/application-v3/`, not `.baton/`.

**Campaign wave boundaries read from this store** (`driver.recorded` / `wave.started`): contract
foundry wave-b seq 48209 (07:51:18Z), review foundry wave-a seq 49623 (08:31:11Z), suite foundry
wave-a seq 51212, review foundry wave-b seq 51657, fold foundry wave-a seq 51934, channel-audit
wave-a seq 53795 (mine).

---

## 1. Channel: scratchpad `shared` partition writes — **GAPPED**

**Claim to audit:** did any member's publish actually land in `shared`?

**Verdict: GAPPED.** Across the entire store range 48209–58128 (all campaign waves through this
audit's final read), there are exactly **4** `scratchpad.entry_written` events, and **every one
landed in a `worker:<id>` partition, never `shared`**:

| seq | ts | runId (role) | workerId | scope | kind |
|-----|-----|--------------|----------|-------|------|
| 50790 | 08:49:00Z | `run-436409eaf1…` (row-rt155) | w-205 | `worker:w-205` | note |
| 52296 | 09:36:09Z | `run-8aca988a8e…` (row-rt164) | w-208 | `worker:w-208` | note |
| 53762 | 10:14:59Z | `run-85d2d81383…` | w-210 | `worker:w-210` | note |
| 58092 | 12:02:48Z | `run-b770ab218d…` (**row-chan, this audit**) | w-225 | `worker:w-225` | note |

The fourth row is **row-chan's own live up-channel write** (§6): emitted as a
`SCRATCHPAD_WRITE` publish attempt, scanned by the coordinator, and written to
`worker:w-225` — a first-hand, in-session demonstration that a member's "publish to `shared`"
lands in the worker partition.

No `shared`-scoped entry was ever written. During contract foundry wave-b (seq 48209–49599)
**zero** scratchpad entries were written at all — the four rows' "publish to `shared`" attempts
landed nowhere, matching `foundry-qa.md:9-10` ("The `shared` scratchpad partition is UNREACHABLE
from this session — the `run.scratchpad.append` verb is unlanded at HEAD (the #158 write verb)")
and `foundry-qa.md:236-237` ("All four shared posts are absent (the #158 append verb is
unlanded)"). Review wave-a produced exactly one entry (rt155, worker-scoped) — matching
`review-qa.md:22` ("The `shared` scratchpad … is not reachable from this snapshot") and
`redteam-155.md:153` ("It lands in `worker:<row-rt155>`").

**Why it is structurally gapped (citied):**
- `writeScratchpad` — the only worker write path — hardcodes the worker scope:
  `coordination-store.mjs:14103` `const scope = \`worker:${fields.workerId}\`;`. A worker cannot
  address `shared` with a write at all.
- The only `shared`-write lane is `elevateTaskScratchpad` (`coordination-store.mjs:14183`), which
  requires `auth.actor === 'orchestrator'` — a client/member can never invoke it.
- The client surfaces expose read/elevate only: CLI `run.scratchpad.read` / `run.scratchpad.elevate`
  (`application-cli.mjs:1476-1515`; a `run scratchpad write` verb throws `cli_invalid`, reproduced
  in §6 below). No write/append verb exists at HEAD.

**Consequence:** the shared frame's publish-as-you-go rule (kind `note`, title = row role) is
currently unfulfillable by any member; every wave's rows fell back to the durable file, and the
coordinators named the gap (foundry-qa, review-qa §6).

---

## 2. Channel: task→workflow→project elevation — **UNEXERCISED**

**Claim to audit:** did any entry elevate? Who CAN elevate today (surface + capability)?

**Verdict: UNEXERCISED.** No entry ever elevated.

**Absence, citied (the store):** in the entire range 48209–57490 there are **zero**
`scratchpad.entry_elevated` events and **zero** `scratch.fact_posted` events. The only
elevation-shaped records are 24 `knowledge.promoted` events, and every one is the task
hub-verification outcome pipeline — body verbatim "Task baton-…-work passed its hub
verification", `type: Finding` — 8 of them in the foundry-wave range (seq 48863, 49191, 49412,
49495, 49533 [contract wave era]; 50807, 51006, 51014 [review wave-a era]). None of these is a
scratchpad-note elevation; the notes never moved.

**The claim that an elevation WOULD happen is unsubstantiated:** `redteam-155.md:153` asserted the
row's note "lands in `worker:<row-rt155>` and elevates to `shared` at settlement." The store shows
rt155's note (seq 50790) sitting in `worker:w-205` un-elevated through seq 57490 — no
`entry_elevated` for it or for anything else.

**Surface + capability (citied):**
- Surface exists: CLI `run.scratchpad.elevate` (`application-cli.mjs:1496-1506`), MCP
  `baton_run_scratchpad_elevate` (`mcp-northbound.mjs:652-663`), and the interpreter's
  `elevateWhenNotes` steering policy (`workflow-interpreter.mjs:729-730`, `tryElevate` at :877-908).
- **Capability: orchestrator-only.** The kernel `elevateTaskScratchpad` (`coordination-store.mjs:14183`)
  rejects any `auth.actor !== 'orchestrator'`. A member row cannot elevate its own note; only the
  wave driver (or a human with orchestrator authority) can.
- The policy was configured in all three foundry specs — contract-foundry `workflow.json`
  (`elevateWhenNotes: { kinds: [doubt, plan], maxEntries: 20 }`), review-foundry `workflow.json`
  (identical), channel-audit `workflow.json` (identical) — but its precondition (a `doubt`/`plan`
  note in the worker partition) was never met: members could not write anywhere (channel 1), and
  the one note that did land (rt155) was kind `note`, outside the kinds filter.

**Verdict note:** this is not a broken channel — it is an unexercised one. The elevate surface is
orchestrator-gated and never had input; no wave produced a single elevated entry.

---

## 3. Channel: the up-channel / DECISION_REQUEST lane — **GAPPED**

**Claim to audit:** did any member escalate? Is DECISION_REQUEST wired through the wave driver
(`answerDecisions`) or does it park?

**Verdict: GAPPED.** Members escalated, but the runtime lane parks; the escalations traveled the
durable-file/harvest path instead — the frame's "bypass" finding.

**Members did escalate (citied):** review wave-a's coordinator recorded three authority-class
escalations in `review-qa.md:354-378` — **DR-1** (#164 OQ2, terminal-vocabulary), **DR-2** (#161
OQ1, surface prefix), **DR-3** (#161 OQ2, exactly-one-in-progress scope) — "Recorded here (the
`shared` publish is unreachable from this snapshot; the top orchestrator reads these from the
harvest artifact)." That is the escalation-by-file bypass.

**The lane is not wired (citied):** the interpreter's `answerDecision` (workflow-interpreter.mjs:805-854)
only acts when the wave spec sets `answerDecisions` (`:712-723` — `if (st.answerDecisions &&
decision)`). **No foundry wave configured it**: contract-foundry, review-foundry, and
channel-audit `workflow.json` steering all omit `answerDecisions` (they carry
approveOnAdvertisedPlan / nudgeOnCheckpoint / claimOnStall / messageOnSpawn / elevateWhenNotes /
signalOnMembersDone only). A DECISION_REQUEST surfaced as an `answer_decision` attention item in
those waves would therefore park — never answered, never routed up.

**Store corroboration (citied):** all 580 `message.sent` events in the range are kind `brief`
(563) or `result` (17). **No `query` / `steer` / `inform` message was ever sent** — no escalation
ever traveled the message lane. No `decision.*` event kind exists in the store at all.

**Posture note:** the member-side DECISION_REQUEST grammar exists
(`claude-session.mjs:26`, `_scanForDecisionRequest`) — the worker prints a DECISION_REQUEST and
it is surfaced as attention — but the driver's answering/forwarding half (`answerDecisions`
policy) was never configured, so the request parks at the member until a human reads the harvest
artifact. This is the concrete gap the frame's "QA escalated via its FILE, §5" refers to.

---

## 4. Channel: `signalOnMembersDone` — **GAPPED** (fires correctly, signals the wrong recipients)

**Claim to audit:** did it fire for review wave-a? The coordinator's initial draft (01:45 PDT =
08:45Z) predated redteam-155 (01:48 = 08:48Z) and redteam-161 (01:51 = 08:51Z): did the signal
fire **early**, or did the coordinator proceed **un-signalled**?

**Verdict: GAPPED — the coordinator proceeded un-signalled.** The signal did NOT fire early.

**Timing, citied (store seq + ts):**
- Review wave-a started seq 49623 (08:31:11Z). Spawn briefs delivered seq 49678-49681 (08:36:28Z).
- The last row's task passed verification seq 51014 (08:50:52Z, row-rt161's task
  `baton-f38d8fa2…`). rt155's note landed seq 50790 (08:49:00Z).
- The signal fired seq **51015/51018/51020/51023** (08:51:00–01Z), **after** every row had
  settled. **Not early.**

**But the signal went to the rows, not the coordinator (citied):** the interpreter builds
`recipients = [...handles.keys()].filter((role) => !signalRoles.has(role))`
(`workflow-interpreter.mjs:739-751`, signalRoles = `["coordinator"]`). The store shows the
`result` message delivered to **w-205/w-206/w-207/w-208** — the four ROWS (rt155/rt156/rt161/
rt164: deliveries seq 51017/51019/51022/51024) — and **not** to the coordinator (run-fa9f5e57,
w-204). Same shape in contract foundry wave-b: deliveries seq 49536-49545 to rows w-200…w-203,
never the coordinator (w-199).

**The coordinator therefore never received the signal it was briefed to wait for** ("You receive a
`signalOnMembersDone` message when they settle" — review-foundry `coordinator-brief.md`). It
drafted at 08:45Z — `review-qa.md:12` ("this QA's initial draft predated two row reports") and
`:387` ("the coordinator's initial draft (01:45) predated `redteam-155.md` (01:48) and
`redteam-161.md` (01:51), so its §1/§3 declared those rows dead") — and only revised after
detecting the landed durable reports itself. The coordinator's early draft is **not** a signal
that fired early; it is a coordinator that was never gated by the signal.

**The mismatch is confirmed by who acted on it:** the signal's body is addressed to the
coordinator's job ("…write review-qa.md per your brief"), yet the message landed on the rows, and
`review-qa.md:388` records **row-rt155 revising the coordinator's file "on the post-settlement
signal."** A row receiving a coordinator-addressed signal is direct evidence the recipient list
inverts the intent.

---

## 5. Channel: `messageOnSpawn` / nudge delivery — **PROVEN (both legs)**

**Claim to audit:** did members receive the spawn brief? Any cited instance of a nudge landing
mid-flight?

**`messageOnSpawn` — PROVEN.** All five members of each foundry wave received the spawn brief:

- Contract wave-b: briefs sent seq 48259-48263 (07:52:55Z), delivered 48264-48267 (07:52:56Z) to
  w-199…w-202; the fifth (row-telemetry, w-203) delivered seq 48943 (08:03:34Z) after the pump's
  repeated attempts (48474–48942) while its worker materialized.
- Review wave-a: briefs sent seq 49673-49677 (08:36:28Z), delivered 49678-49681 to w-204…w-207;
  the fifth (row-rt164, w-208) delivered seq 50876 (08:50:11Z) after attempts 50030–50875.
- This row (channel-audit wave-a) received its spawn brief in-session (the mid-turn `brief`
  message, marked UNTRUSTED, quoting `workflow.json`'s messageOnSpawn body verbatim).

The late deliveries are the pump's defer-on-spawning behavior, not delivery failure:
`pumpMessageOnSpawn` (`workflow-interpreter.mjs:771-803`) defers without consuming its ≤3 budget
when the worker is not yet live (`catch { return; }`), so a slow-to-materialize worker is
retried across polls until delivered.

**Nudges — PROVEN (a nudge landed mid-flight on this row, this audit).**
`nudgeOnCheckpoint` is configured in contract-foundry, review-foundry, and channel-audit
`workflow.json` (contract-foundry: "Continue your draft drive — write your contract
incrementally, publish to the shared scratchpad when complete."). During this audit, channel-audit
wave-a's `nudgeOnCheckpoint` fired for row-chan:

- **In-session cited instance:** this row received the mid-flight message **"Continue the audit —
  every verdict needs a cited instance; a publish that fails IS a finding (record the exact
  refusal). Write your report incrementally."** — the channel-audit `workflow.json`
  `nudgeOnCheckpoint.message` verbatim.
- **Store bracket (citied):** the nudge's pause→resume is observable as the run's task transitions
  for row-chan's task `baton-24c4dbbe…` / run `run-b770ab218d…` / w-225: seq **58097** `task
  transitioned → paused` (12:02:48Z, the checkpoint that admits the nudge) and seq **58100** `task
  transitioned → working` (12:03:24Z, the nudge's fresh turn unparked). The nudge itself is
  invisible as an event — `nudge_turn` is a `run.act` provider-control command
  (`application-semantics.mjs:501`, effect `provider_control`), not a store event; all 580+
  `message.sent` events are kind `brief`/`result`, and the 258 `nudge` strings in `events.jsonl`
  are config/command payloads, none a delivery.

**Honest statement:** the nudge channel is PROVEN by the in-session instance + the pause→resume
store bracket; it is a channel the store alone cannot attest (only the receiving session can). No
other member's nudge is observable from here, but the mechanism is now cited for at least one
wave.

---

## 6. The `shared` publish attempt for THIS row — exact refusal

Per the frame's publish rule ("publish to `shared` … if the publish path itself fails, THAT is a
finding — record the exact refusal"), row-chan attempted the publish. Attempts and refusals:

1. **CLI write verb — refused.** `run scratchpad write <run> --scope shared --kind note --body …`
   throws `cli_invalid: unexpected argument write` (reproduced via `parseBatonCli` from
   `application-cli.mjs`; the family at :1476-1515 admits only `read`/`elevate`). Same for
   `append` and `post`.
2. **Kernel scope — structurally refused.** Even a hypothetical admitted write goes through
   `writeScratchpad`, which hardcodes `const scope = \`worker:${fields.workerId}\``
   (`coordination-store.mjs:14103`). A `shared`-scoped write from a member is impossible; the only
   `shared` writer (`elevateTaskScratchpad`, :14183) is orchestrator-only.
3. **Worker up-channel emission — attempted, landed worker-scoped (verified in the store).** Per
   the documented up-channel (`redteam-155.md:151`; grammar `SCRATCHPAD_WRITE:\s*(\{…\})`,
   `claude-session.mjs:29`), a member publishes by printing `SCRATCHPAD_WRITE` model text. row-chan
   emitted one under idempotency key `row-chan.channel-audit.publish`; the coordinator scanned and
   wrote it — **seq 58092, `scratchpad.entry_written`, scope `worker:w-225`** (row-chan's
   partition). The write mechanism works; it is structurally worker-scoped (`writeScratchpad:14103`),
   so the `shared` publish remains impossible, and this row's entry is the 4th live confirmation
   (channel 1) that no member publish ever reaches `shared`.

**Net:** the `shared` publish is not executable by a member today. This file is the durable
artifact (matching the frame's fallback and what every prior row did).

---

## Open questions / judgment calls

- **J1 — signal recipient inversion.** `signalOnMembersDone` sends the coordinator-addressed
  message to the rows (`workflow-interpreter.mjs:744`). Either the policy should signal the
  `roles` members (the coordinator) once rows are done, or the message body and the recipient set
  disagree by design. Recommend: signal the members named in `signal.roles` when the complementary
  set is terminal — the frame's own coordinator-brief promises the coordinator the signal.
- **J2 — DECISION_REQUEST wiring.** No foundry spec configured `answerDecisions`, so member
  escalations park. If the top orchestrator is expected to read DRs from harvest artifacts only,
  that is the documented design; if the runtime lane is meant to be live, the wave specs must set
  `answerDecisions` (and the interpreter's `:712` gating already honors it).
- **J3 — `elevateWhenNotes` configured but starved.** All three specs configure it (kinds
  `doubt`/`plan`), yet no `doubt`/`plan` note was ever writable (channel 1). The elevation policy
  cannot be exercised until the shared/write gap (#158) is closed or rows can write worker-scoped
  `doubt`/`plan` entries.

No authority-class ambiguity beyond these; each is recorded with the evidence above.
