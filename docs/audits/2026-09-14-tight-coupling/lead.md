# lead.md — swarm tight-271, declared tight coupling on real work (2026-09-14)

Lead: participant `lead` (swarm-native bridge identity `swarm-native:tight-271:lead`).
Builders: `projections` (omp / zai/glm-5.3-flash, effort max, own checkout), `surface` (omp /
deepseek/deepseek-flash, effort max, recruited with `shareWorkspaceWith: "projections"` into
checkout `ws-b833ceca0bbe311b1c1911696cb1472c`). Both units landed in ONE shared checkout.
Deliverable: issue #271 — W1 projections (guidance, guide receipt, workspace custody, seq/ts)
and W2 refusals + surface (`swarm.operation_refused`, docs, tests), plus a live exercise of
every declared coupling verb while the root audited from outside.

Outcome: both contributions accepted by the root orchestrator —
`contribution-projections-1` (checkpoint `cf199d3032a8…`, accepted 07:34:40Z, seq 2165) and
`contribution-surface-1` (checkpoint `7a8ed6ac…`, accepted 08:09:02Z, seq 2739, "14
swarm/custody/bridge files GREEN (114 passed) incl. swarm-refusals and swarm-projection-pins;
surface gate ok"). Both works completed (W1 seq 2742, W2 seq 2745). All coupling records
released or settled as designed.

## Timeline (UTC)

| Time | Event |
| --- | --- |
| 05:36:13 | First `swarm.view`: swarm open, `lead` alone (seq 5). |
| 05:43:48 / 05:43:52 | Opened `W1-projections`; opened `W2-surface` with `dependsOn: [{workId:"W1-projections"}]` (seq 191). |
| 05:44:53 | Recruited `projections` (run-0cc8ab…, worker w-2). |
| 05:46:34 | Recruited `surface` (run-b44b67…, worker w-3); recorded in `ws-b833cec…` — adoption of projections' live checkout visible in the view (`workspaceId` on the adopted row only). |
| 05:46:56–57 | Group `impl` [projections, surface]; declared `sync-gate` (seq 333), `writer-checkout` (seq 334), `policy-impl` (seq 335). |
| 05:47:28 | Guides to both builders (W1 cleared to edit; W2 told read-only until handover). |
| 05:49:32 | Watch wake: `timeout` (all three working). |
| 05:52:20 | Watch wake: `event` — `evidence.mapped` / `content.message` (seq 692): worker conversation telemetry waking the feed. |
| 05:54 | **Lead stalls**: an eval-kernel watch loop passed `process.execPath` (the omp binary, not node) as the bridge executable; omp read piped stdin as a prompt and hung. My bash `timeout: 0` disabled the deadline. Stalled ~105 minutes. |
| 07:27:57 | `projections` self-captured `contribution-projections-1` (revision `cf199d30…`, observedHead `53031f16…`, checkout `ws-b833cec…`, seq 2163), arrived at `sync-gate` (arrivals `["projections"]`), paused its turn. |
| 07:34:40 | Root accepted W1 from outside: "checkpoint cf199d30 cherry-picked onto master+audit 4abcbee4 in a landing worktree; swarm-projections.test.mjs and ten other swarm/custody files GREEN (102 passed); surface gate ok. The guide-to-paused receipt gap (nudgeTurn writes no message.sent) is recorded on #273." Dependency `W2-surface → W1-projections` settled (`waitsOn: [{workId:"W1-projections", settled:true, evidence:["contribution-projections-1"]}]`). |
| ~07:36–07:58 | Root, holding the lead's review duties during the stall, re-declared `writer-checkout` naming `surface` (record v2/v3, now carrying `workspaceId: ws-b833cec…`). `surface` edited W2 files in the shared checkout from ~07:36 (mtime evidence) — before my handover. |
| 07:40:03 | Stall returns: view shows the contribution, the arrival, and the root's accept — the swarm moved on without me; nothing was lost (the feed is durable). |
| 07:40:55 | **Refusal #1 (verbatim below)**: my `swarm.capture` refuses `swarm_replay_conflict` — the author had already self-captured. |
| 07:41–07:56:52 | My independent check `run-suite-lead-1` on `cf199d30…`: full suite failed (environmental; see Verification). Review row seq 2600. |
| 07:57:48–49 | Writer handover: released `writer-checkout` ("W1-projections accepted (root landing GREEN); handing the checkout to surface") and declared `writer-checkout-2` for `surface` over `ws-b833cec…`. Guided `surface`: dependency settled, you hold the writer. |
| 08:01:22 | `surface`'s own test run records a `swarm.operation_refused` row (verbatim below) — its deliverable working live in its fixture. |
| 08:01:37 | `surface` arrives at `sync-gate` (record v3, actor `swarm-native:tight-271:surface`, `arrived: true`, `awaiting: []`). |
| ~08:05 | `surface` publishes `contribution-surface-1` with plain disclosure that it edited before the handover (full quote below). |
| 08:09:02–07 | Root accepts W2 (seq 2739), completes both works (seq 2742/2745), releases `sync-gate` ("Both builders arrived and both contributions are accepted by the root; the gate is open", v4) and `writer-checkout-2` ("W2 accepted; no writer needs the shared checkout", v2). |

## Coupling record 1: the dependency (`swarm.work_updated.dependsOn`)

What I declared (verbatim payload, seq 191, 05:43:52Z):

```json
{"workId":"W2-surface","objective":"Refusals and surface: durable swarm.operation_refused rows that wake a watch, documented guidance/workspace/refusal surface, tests for both units (impl/src/swarm-event-schemas.mjs, swarm-contract.mjs, swarm-runtime.mjs, swarm-surface.mjs, CLI.md, MCP.md)","dependsOn":[{"workId":"W1-projections"}]}
```

What the workers saw: `surface`'s published view quote — `waitsOnVerbatim: [ { workId:
'W1-projections', settled: true, evidence: [Array] } ]` (settled after the root's W1 accept).
Before settlement the same row showed `settled: false, evidence: []` (the shape
swarm-coupling.test.mjs pins). The wait is informed, never gated: `surface` proceeded against
the unsettled record during my stall (allowed, and visible — see Frictions).

What woke my watch: the settlement itself was not wake-observed by me (I was stalled); the
wake semantics were exercised on the declaration side earlier in swarm-coupling tests and by
my own wakes at 05:49/05:52. Settlement evidence is the durable accept review seq 2165.

Time it took: declaration → settlement 1h50m (05:43:52 → 07:34:40), of which ~1h40m was W1
building and ~15 min the root's landing verification. Publication → acceptance: 6m43s
(07:27:57 → 07:34:40).

## Coupling record 2: the synchronization point `sync-gate` (name "gate", group `impl`)

What I declared (seq 333, 05:46:56.882Z): `{couplingId:"sync-gate", coupling:"synchronization",
action:"declare", groupId:"impl", name:"gate"}` — projected with the declared roster
`members:["projections","surface"]`, `awaiting:["projections","surface"]`, `arrivals:[]`,
`arrived:false` (quoted verbatim in `projections`' contribution).

What each worker saw:

- `projections` (in contribution-projections-1, before its arrival): `"sync-gate":{couplingId:"sync-gate",coupling:"synchronization",groupId:"impl",name:"gate",members:["projections","surface"],arrivals:[],released:false,releasedBy:null,releaseReason:null,awaiting:["projections","surface"],departed:[],arrived:false,version:1,actor:"swarm-native:tight-271:lead",seq:333,ts:"2026-09-14T05:46:56.882Z"}`
- `surface` (in contribution-surface-1, after both arrivals): `couplingId: 'sync-gate', … arrivals: [Array], released: false, releasedBy: null, … version: 3, actor: 'swarm-native:tight-271:surface', seq: 2687, ts: '2026-09-14T08:01:37.391Z', awaiting: [], departed: [], arrived: true`

Arrivals were the workers' own honest reports (`action:"arrive"` — read authority suffices for
one's own arrival). Release: by the root, seq 2748, 08:09:05.898Z — `releasedBy: null`
(external actor), `releaseReason: "Both builders arrived and both contributions are accepted by the root; the gate is open"`.

Honest ordering note: `surface` deferred `surface-gate --write` pending the release ("The
surface gate passes in check mode with no stale block, artifact, or parity row; surface-gate
--write is deliberately NOT run yet, pending the lead releasing the sync-gate after both
arrivals, so no regenerated artifact bytes are claimed"), and the root released the gate at
08:09:05 — 3 seconds after W2's accept — then validated the gate on the landing branch. Whether
the `--write` artifacts were regenerated before or after the release is not visible from my
view; the root's landing validation ("surface gate ok") is the accepted evidence.

## Coupling record 3: the exclusive writer (`writer-checkout`, then `writer-checkout-2`)

What I declared (seq 334, 05:46:56.967Z): `{couplingId:"writer-checkout", coupling:"writer",
action:"declare", participantId:"projections"}` — recorded `writer:"projections"` with
`workspaceId: null`, because projections OWNS its checkout rather than having adopted one and
only adopted participants carry a recorded `workspaceId`. This is the exact gap the 2026-09-13
coupling audit predicted ("writer checkout identity for owning holders"), materializing on
first live use: a second claim over the same physical checkout could not have refused, because
`null ≠ ws-b833cec…` in the conflict check.

The handover (me, 07:57:48–49Z): release `writer-checkout` — `"W1-projections accepted (root
landing GREEN); handing the checkout to surface"` — and declare `writer-checkout-2` naming
`surface`, which DID carry the checkout identity: `writer:"surface"`,
`workspaceId:"ws-b833ceca0bbe311b1c1911696cb1472c"`. During my stall the root had already
re-declared `writer-checkout` naming `surface` (record v2/v3 — visible to me only after the
fact as `writer:"surface", ws:"ws-b833cec…"` on the released row; `surface` discloses: "the
root orchestrator … handed me the writer (writer-checkout v2/v3 named surface)"). My release
landed as v4. The root released `writer-checkout-2` at 08:09:07.323Z: "W2 accepted; no writer
needs the shared checkout".

What the coupling did and did not do: it did not stop `surface` from editing ~20 minutes
before my handover (records inform, never fence); it did make the state legible — every viewer
could see who the checkout's one writer was claimed to be, and the deviation is on the record
(see Frictions).

## Coupling record 4: the group failure policy (`policy-impl`, `independent`)

What I declared (seq 335, 05:46:57.049Z): `{couplingId:"policy-impl", coupling:"failure",
action:"declare", groupId:"impl", policy:"independent"}`. Never exercised: no member's runtime
died during the swarm's life, so no `group_member_gone` row ever appeared — the undeclared
default and the declared policy were observationally identical here. Released: no (it remains
declared; the swarm stays open).

## What woke my watch

- 05:49:32 — `{"reason":"timeout"}`: honest no-news.
- 05:52:20 — `{"reason":"event","event":{"seq":692,"kind":"evidence.mapped","payloadKind":"content.message"}}`: worker conversation telemetry waking the feed.
- 05:54–07:40 — nothing: I was the one stalled (below), not the feed. The feed is durable; state was fully reconstructable from `swarm.view` on return.
- During the stall the root demonstrably acted on the same feed (accepts at 07:34/08:09, releases at 08:09) — the wake path works for a watcher that is actually parked.

## Every refusal, verbatim

1. Mine — `swarm.capture` after the author's self-capture, 07:40:55Z:

```
{"ok":false,"error":{"message":"Swarm mutation identity already names another request","code":"swarm_replay_conflict","detail":{}}}
```

   on `swarm.capture {"participantId":"projections","contributionId":"contribution-projections-1"}`. Cause: the capture receipt keys are coordinate-keyed (`swarm-capture-revision:<hash>`) but actor-checked, so a second capture of the same (swarm, participant, contribution) by a DIFFERENT actor refuses instead of replaying. The lead-captures-author flow I had briefed assumes the author does not self-capture first; both of us were entitled to, and the second one loses. The pinned revision was already immutable, so nothing was lost — but the refusal is friction, not protection, in this order of events.

2. `surface`'s own, recorded by ITS deliverable in its test fixture (quoted verbatim from its
   contribution, `refusalRowVerbatim`):

```json
{"schemaVersion":1,"seq":37,"ts":"2026-09-14T08:01:22.246Z","kind":"driver.recorded","actor":"worker:w-2","idempotencyKey":"swarm-refusal:4f6c443986e7f303750a13958dbcf3aedec9cf20ae35b1b61e47d6e21ab89636","payload":{"kind":"swarm.operation_refused","swarmId":"swarm-0f679e84e5a828f0383633848f1a2eed","command":"swarm.update","event":"swarm.group_updated","code":"swarm_permission_required","field":null,"participantId":"alpha"}}
```

   My refusal #1 was produced BEFORE W2's recording code ran this deployment's live traffic, so it exists only as the caller-visible error above, not as a durable `swarm.operation_refused` row — the new row kind never observed a live refusal in THIS swarm during my turn.

## The lead's 105-minute stall

At 05:54Z, inside one eval-kernel tool call, I built a watch loop that invoked the bridge with
`process.execPath` — which inside that kernel is the omp binary, not node. omp read the piped
stdin as a prompt ("Reading prompt from piped stdin… Still starting after Ns — phase:
readPipedInput") and never answered; my `timeout: 0` on the cell disabled the deadline, so the
call hung for ~105 minutes instead of failing fast. What I saw when it returned: an
`execFile` failure naming the omp binary and 1200+ lines of omp startup notices — and, on the
next `swarm.view`, a swarm that had moved on without me: W1 published and self-captured
(07:27:57), arrived at the gate, accepted by the root (07:34:40, with the review noting "the
lead has been inside one eval tool call since 05:54Z and never reviewed"), the writer record
re-declared to `surface`, and `surface` already editing. Lessons: (a) an orchestrator-side tool
mistake stalls the orchestrator, never the swarm — the declared couplings and the durable log
carried the state; (b) "the lead reviews" is not a guarantee — the root correctly stepped into
the vacuum and the records show exactly who did what; (c) a `timeout: 0` on a call whose
callee can wait forever is how a 2-second mistake becomes a 105-minute stall.

## Gaps, frictions, insights

1. **Writer checkout identity for owning holders** (known gap, now observed live): the first
   writer claim recorded `workspaceId: null` (owner, not adopter), so per-checkout exclusivity
   was unprovable between the claims — and the record's discipline still held socially. Recording
   the allocator's checkout on first recruit would close it.
2. **A builder proceeded against an unsettled dependency and a writer record naming someone
   else — allowed, visible, and fine**: `surface` disclosed it plainly: "I edited before the
   lead own handover guide arrived. While the lead was stuck inside one native tool call, the
   root orchestrator held the lead review duties for this swarm: it accepted W1-projections and
   handed me the writer (writer-checkout v2/v3 named surface), so I proceeded with W2 while the
   W2 dependency record still showed W1 unsettled and the lead handover message had not arrived.
   The lead guide arrived during the work; I continued under it — my swarm-runtime.mjs edits
   stay stacked on the accepted W1 changes, and gate --write waits for the lead release. The
   lead asked this timing be stated plainly here." I made the deviation visible in the swarm
   record itself with a 07:44:12Z guide acknowledging the edits and restating the constraints.
   Coupling-as-record worked exactly as designed: nothing stopped, everything was attributable.
3. **Shared-checkout capture integrity, resolved by luck**: the W1 capture (07:27:57) predates
   `surface`'s first W2 file edits (~07:36) by ~9 minutes, so checkpoint `cf199d30…` is pure W1
   (`Baton-Base`/`Baton-Head` = `53031f16…`, one file excluded). One minute later and the
   author's "immutable revision" would have pinned a co-holder's WIP. The revision record's
   `workspaceId` + `observedHead` are what make this auditable; a shared-checkout capture
   protocol (per-holder staging or a writer-coupling check at capture time) would make it safe.
4. **`swarm.guide` to a paused participant writes no `message.sent` receipt** — found by W1
   (out of its file set), reported in its contribution, filed as #273 by the root; until fixed,
   guides to paused workers return `guide: null` and are invisible in the guidance projection.
5. **Refusal rows cannot be fabricated** (W2's design holds): the durable
   `swarm.operation_refused` identity derives from request+refusal, records only typed refusal
   codes on mutation commands, replays byte-identically, and refused reads record nothing.
6. **Coordination between two agents in one checkout without a fence is a social contract
   enforced by records** — and the records were sufficient: two builders, one
   `swarm-runtime.mjs`, zero lost edits; the only near-miss was the capture window (item 3).
7. **The wake feed wakes on worker conversation** (`content.message`), not only on swarm
   events — correct (worker messages are swarm-relevant), but a chatty worker produces
   non-event wakes a follower must filter mentally.

## Verification truth

- Contract verification: `node impl/scripts/run-suite.mjs`, expected exit 0. On this host the
  full suite does not reach that bar for ANY change today: at clean HEAD `53031f16…` my own
  baseline run (finished 08:09Z, 682.9s wall) fails with the same signature the workers
  reported — "No provider credential is projected into the worker runtime for this route"
  (phase79/80/83 and feedback-forge specs), "fleet drain did not converge before its deployment
  deadline" (phase56), and a worktree-capacity contention flake. W1 reported 25 unexpected
  failures with a byte-identical failure-set comparison against clean HEAD; W2 reported 33,
  none in a swarm file.
- The accepted evidence is therefore targeted and independent: the root's landing-branch
  validations (W1: 11 swarm/custody files, 102 passed; W2: 14 files, 114 passed, "incl.
  swarm-refusals and swarm-projection-pins; surface gate ok"), the workers' own suite runs, and
  my clean-HEAD baseline proving the failures are environmental. My own full-suite check of
  `cf199d30…` failed (review seq 2600) — consistent with the environment, not evidence against
  the change.
- Not done by me, deliberately: I did not re-run the suite for this document (per instruction),
  and I did not run `swarm.check` on my own docs.

## What remains

- #273 (guide receipts for paused participants), the writer-checkout-identity gap (item 1), a
  shared-checkout capture protocol (item 3), and the host's missing provider credential that
  keeps the full suite red for everyone. `policy-impl` remains declared on the still-open swarm;
  the failure-policy path (`group_member_gone`) is test-covered (swarm-coupling.test.mjs) but
  was never exercised live here.
