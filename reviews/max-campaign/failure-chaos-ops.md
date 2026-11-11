# Max-campaign stream: failure-chaos-ops

## DESIGN
# Failure, Recovery, and Chaos: turning baton's invariants from claims into survived faults

*Design for the gap doc 06 Q8 opened and never closed: a failure taxonomy with distinct per-failure operational responses, the hub's own crash-recovery, and chaos engineering as the discipline that makes the supervisor invariants (I1–I7) real. Grounded in baton's existing state machine (`spec/supervisor-state-machine.md`), adapter contract, and ledger. Real 2025–26 practice cited inline.*

---

## 0. The problem, precisely

The supervisor spec (`supervisor-state-machine.md` §6) ends with the honest admission that its invariants "are only real if fault-injection-tested" and lists exactly the tests it hasn't written: *kill the worker mid-approval, cancel `fleet_wait` mid-return, race human+orchestrator on one fence.* Doc 06 Q8 gives a failure **taxonomy** (a table of failure→right-response) but no **operational design**: no schema for how a fault is classified, no algebra for how a response is composed, no procedure for the hub's own death, and no test discipline that proves any of it. Three concrete holes:

1. **"The adapter must classify, not just report" (Q8) has no mechanism.** A `SIGKILL` exit, a 429, an OAuth `invalid_grant`, and a model refusal are all "the worker stopped producing" at the byte level. Nothing in the specs turns that undifferentiated stream into a *typed fault* with a *distinct response*. Absent that, every failure collapses to the one response the code finds easiest — a retry loop — which is wrong for **every row** of Q8's table.

2. **The hub is a single authority (open-question #1) with no recovery procedure.** I3 makes cursors durable; nothing makes *leases, fences, pending approvals, the process registry* durable-and-replayable. A hub crash mid-fleet currently means: orphaned worktrees, zombie adapters holding sockets, approvals stranded forever, and — worst — a restarted hub that re-spawns into a worktree a still-living zombie is writing. The state machine has an `any state → orphaned → reap` edge for *workers*; it has nothing for *itself*.

3. **The invariants are untested assertions.** I1 (fencing orders human>orchestrator), I2 (single-consumer approvals), I3 (at-least-once cursors), I6 (two-phase drain-first stop) are the entire safety story of the Conductor. Right now they are prose. A prose invariant survives exactly until the first fault that its author didn't imagine.

This design closes all three with one spine: **classify → respond → prove.** Classification is a contract the adapter fulfills at the source (Layer 1); response is a closed algebra the supervisor executes with fail-safe defaults (Layer 1); the hub's own death is a first-class transition with a deterministic recovery (Layer 2); and every invariant is a runtime-checked assertion exercised by a replayable fault-injection harness that doubles as the reproducibility substrate doc 14 #14 demands (Layer 3).

**Scope boundary, stated up front.** This doc owns **liveness and safety faults** — the process died, the token expired, the disk filled, the fence raced. It does *not* own **correctness faults** — "the worker's result is subtly wrong." That is the Referee's domain: I7 hub-run verification (`supervisor-state-machine.md` I7, doc 13 T5). The two meet at exactly one row of the taxonomy (`F-VERIFY-MISMATCH`), and I mark the seam there. Everything else here is fly-by-wire: keeping the aircraft in its envelope, not judging whether the pilot chose the right destination.

---

## 1. Layer 1 — The failure taxonomy as operational design

### 1a. The classification contract (the adapter classifies; the supervisor responds)

Doc 06 Q8's "the adapter must classify" becomes a mandatory addition to the adapter interface (`adapter-contract.md`). Every non-nominal termination of adapter activity emits a **`FaultEvent`** — a priority-lane event (`supervisor-state-machine.md` §4), never a bulk-lane delta, so a fault can never be lost behind a delta flood:

```jsonc
// FaultEvent — emitted by the adapter (source-classified) or synthesized by the supervisor (timer/OS-observed)
{ "kind": "fault", "worker_id": "w2", "fence": 41,
  "class": "F-AUTH-EXPIRY",              // the taxonomy code — a CLOSED enum (§1c)
  "detector": "adapter|supervisor|os|ledger|referee",
  "signal": { "source": "codex.error", "raw": "invalid_grant", "http": 401 },
  "confidence": "certain|probable|heuristic",  // soft faults (loop/refusal) are never 'certain'
  "phase": "mid_turn|between_turns|blocked|stopping",  // WHERE in the lifecycle it hit — changes the response
  "recoverable_hint": true,             // adapter's advice; supervisor decides, never trusts blindly
  "ts": "…", "seq": 90211 }
```

Two rules make classification honest, both inherited from existing baton discipline:

- **No silent misclassification.** Just as `adapter-contract.md` forbids silent emulation (`emulated:true` mandatory), an adapter that cannot distinguish two fault classes MUST emit the *broader* class with `confidence` downgraded — never a confident guess. A `SIGKILL` with exit 137 under memory pressure is `F-HARNESS-CRASH confidence:certain`; a turn that went silent for 90s is `F-LOOP confidence:heuristic`, and the supervisor treats heuristic faults with a lighter, reversible response (§1b). This is the direct application of doc 14 #13 (honest degradation): a detector that reports a fault it isn't sure of, as if certain, teaches the supervisor to trust a lying signal.
- **Classification is source-local; response is central.** The adapter knows *what* broke (it holds the vendor error taxonomy); the supervisor knows *what to do* (it holds the leases, fences, budget, and fleet context). Q8's table is split across exactly this boundary. Infrastructure logic stays in the infrastructure layer (CLAUDE.md rule): the adapter never decides to respawn; it reports, and the supervisor's response state machine decides.

### 1b. The response algebra — retry is a leaf, never a root

The core design assertion: **a response is a bounded, ordered composition of primitives from a closed set, not a free-form handler.** This is what makes "retry is not a policy" enforceable — `RETRY` is not in the set. The primitives:

| Primitive | Effect | Bounded by |
|---|---|---|
| `RESPAWN` | new process, fresh session, replay the brief | budget; fence bumped (I1) |
| `RESUME` | re-attach to a durable session (`thread/resume`, `--resume`) | session durability (card); fence bumped |
| `REROUTE` | requeue the brief to a *different* adapter/vendor | `RouteStat`; decorrelation intent (doc 06 Q1) |
| `BACKOFF_REQUEUE` | per-vendor exponential backoff, then requeue on same seat | vendor `concurrency_ceiling`; no storm |
| `SURFACE_APPROVAL` | convert the fault into an approval wait-item with context | I2 single-consumer; I5 out-of-band notify |
| `STEER_NARROW` | inject the missing insight / narrow the scope, at next boundary | I1 fence; two-channel law (comms-channel §2) |
| `DEGRADE_LOUD` | continue with reduced capability, `degraded:true` stamped, alarm | doc 14 #13; never silent |
| `REFRESH_AUTH` | trigger the device-flow refresh, park the worker `blocked-on-auth` | I5; secrets scoping (doc 06 Q10) |
| `DRAIN_REAP` | I6 two-phase: answer outstanding approvals `cancel`, confirm death, release lease | I2 + I6 |
| `QUARANTINE` | freeze the worker AND everything downstream of its shared writes | doc 14 #10/#25 contagion |
| `CHECKPOINT` | snapshot recoverable state before a destructive step | ledger fsync barrier |
| `ESCALATE` | out-of-band human notification with the runbook link | I5 |
| `HALT_FLEET` | stop admitting new work; drain; freeze | I9 (§1d) |

A response *plan* is `respond(class, phase, context) → [Primitive]`. `RESPAWN` and `RESUME` may *internally* retry a bounded number of times, but a retry that is not preceded by a classification and a plan is a bug the linter rejects. The distinction is the whole point: Q8's "quota → tight retry loop" failure is structurally impossible because `F-QUOTA` maps to `BACKOFF_REQUEUE ∘ REROUTE ∘ budget-event`, and there is no code path from `F-QUOTA` to a bare retry.

### 1c. The taxonomy — twelve faults, twelve distinct responses

Each row: the **detection** signal and *detector*; the **discriminator** that separates it from its look-alike (the hard part — many faults present identically at the byte level); the **response plan** (composed primitives); and the **automation boundary** (what's automatic vs escalated). `phase` modulates every response; I show the load-bearing cases.

| Fault (code) | Detection (detector) | Discriminator — vs its look-alike | Response plan | Auto / escalate |
|---|---|---|---|---|
| **Harness crash** `F-HARNESS-CRASH` | process exit / `process/exited` / socket EOF (adapter, os) | exit≠0 & no `turn/completed` → crash, *not* clean finish; pgid dead → *not* zombie | `CHECKPOINT` → `RESUME` (if session durable per card) else `RESPAWN` + replay brief; lease **held** through respawn | auto; escalate if RESUME fails twice |
| **Model refusal** `F-MODEL-REFUSAL` | refusal-shaped terminal message (adapter, `confidence:probable`) | refusal ≠ crash: clean exit + policy/guardian marker (`guardianWarning`); refusal is *information* | `REROUTE` to a different family (decorrelation, doc 06 Q1) **or** `ESCALATE` — never retry same seat | auto-reroute once; then escalate — a refusal two families agree on is a human signal |
| **Quota / rate-limit** `F-QUOTA` | HTTP 429 / `account/rateLimits` push / `BROKER_BUSY` (adapter) | throttle ≠ auth: 429 w/ `Retry-After` vs 401 `invalid_grant` | `BACKOFF_REQUEUE` (per-vendor, honor `Retry-After`) → `REROUTE` if backoff > brief `wall_min`; emit `resource.budget` event | auto; time-aware (Z.ai peak-hour multiplier, doc 06 Q7) |
| **Sandbox denial** `F-SANDBOX-DENY` | `execCommandApproval`/`applyPatchApproval` deny path (adapter) | denial ≠ crash: worker is `blocked`, alive, waiting | `SURFACE_APPROVAL` with the denied command + repo context; **never auto-allow** (Q4: an LLM judging approvals is socially-engineerable) | policy-engine allow/deny if allowlisted; else human via I5 |
| **Loop / no-progress** `F-LOOP` | priority-lane timing + diff-stagnation (supervisor, `confidence:heuristic`) | loop ≠ legit-quiet-reasoning: read *priority-lane* timing not bulk throughput (`§4`), so `item/reasoning/*` heartbeats aren't a false stall (Codex risk #4) | gentle first: `STEER_NARROW` at next tool boundary (doc 14 #2 violence spectrum) → only then two-phase `DRAIN_REAP` | auto-steer at low confidence; interrupt only at high confidence or budget breach |
| **Version skew** `F-VERSION-SKEW` | RPC method-not-found / schema mismatch vs card (adapter, ledger) | skew ≠ crash: the *binary* changed, not the run — caught by card re-probe (`adapter-contract.md` "cards generated by probing") | `DEGRADE_LOUD` (drop the verb to emulated, `degraded:true`) + alarm + pin the offending version; **do not crash the hub** | auto-degrade; escalate the version pin to CI (conformance test, §3e) |
| **OAuth expiry mid-run** `F-AUTH-EXPIRY` | 401 `invalid_grant` / device-flow needed (adapter) | auth ≠ quota (see F-QUOTA); auth expiry is *interactive*, can't be backed-off away | `CHECKPOINT` → `REFRESH_AUTH` (park `blocked-on-auth`, lease held) → `ESCALATE` out-of-band (I5) — the 3am case | escalate always (needs a human/browser); auto-resume on refresh |
| **Hub crash** `F-HUB-CRASH` | the hub itself died — detected *on restart* (supervisor→I8, §2) | — (this is the recovery procedure, §2) | I8: ledger replay → process-registry reconcile → adopt-or-reap → orphan sweep | auto-recovery; escalate if replay finds a torn barrier |
| **Zombie worker** `F-ZOMBIE` | `kill` issued, pgid still alive after `STOP_DEADLINE` (supervisor, os) | zombie ≠ clean-stop: kill *verify* failed (adapter `kill()` MUST verify death) | escalate `SIGTERM→SIGKILL` on the **process group** (not just pid — background terminals, Codex `command/exec` children); lease **not** released until pgid confirmed dead (I6) | auto-escalate; if SIGKILL fails, `QUARANTINE` worktree + escalate (never `safe-reboot`-class force — CLAUDE.md) |
| **Orphaned worktree** `F-ORPHAN-WT` | worktree on disk, no live worker, no lease (supervisor sweep, §2d) | orphan ≠ active: lease absent/expired *and* pgid dead — both, to avoid reaping a live worker whose hub link flapped | `DRAIN_REAP` the (dead) worker record; preserve the worktree diff as an artifact **before** `git worktree remove`; never merge unverified (I7) | auto after grace period; escalate if diff is unmerged & non-trivial |
| **Disk full** `F-DISK-FULL` | ENOSPC on ledger write / low-watermark monitor (os, supervisor) | ENOSPC on *ledger* (fatal) ≠ ENOSPC in a *worktree* (worker-local) | ledger: `HALT_FLEET` before a torn write; rotate JSONL, GC old worktrees; worktree: `SURFACE_APPROVAL`/fail the one worker. **A torn ledger write is never treated as committed** | ledger → auto-halt + escalate; worktree → per-worker fail |
| **Clock skew** `F-CLOCK-SKEW` | worker/vendor ts disagrees with hub authoritative ts beyond bound (supervisor) | skew ≠ stall: it's a *labeling* fault, not a liveness one | hub stamps the authoritative `ts` on every event (already Q8); worker-reported ts becomes advisory metadata; deadlines computed on hub clock only | auto; escalate only if skew > token-lifetime (poisons F-AUTH deadlines) |
| **Verify mismatch** `F-VERIFY-MISMATCH` | I7 hub re-run ≠ worker's claimed exit (referee) | *the seam to the correctness domain* — this is not a liveness fault | stamp result `unverified`, **refuse merge**, return to orchestrator as a fact (not prose); optional `REROUTE` for a second opinion | auto-refuse; the orchestrator/human decides re-brief vs escalate |

The table *is* the operational design. "Retry" appears nowhere as a top-level response; the closest — `BACKOFF_REQUEUE`, `RESUME` — are typed, bounded, and vendor-aware. Note how `phase` bites: `F-HARNESS-CRASH` **mid_turn** loses the turn and must `RESUME`+replay; the *same* crash **between_turns** loses nothing and just `RESPAWN`s. A taxonomy without phase is still lying about resolution (doc 14 #3).

### 1d. Fail-safe defaults (I9) — the algebra's floor

Every plan is clamped by a new invariant, promoted from the scattered "never default-allow" rules already in the specs:

> **I9 (Fail-safe defaults / bounded blast radius).** When classification is uncertain or a response primitive itself fails, the system degrades toward the *safe* pole, defined per axis: **approvals** → deny-with-message (never allow); **leases** → held (never released into a possible-live worktree); **merges** → refused (never merge unverified, I7); **auth** → park+escalate (never proceed unauthenticated); **the fleet** → halt (never storm). "Retry harder" and "assume it worked" are the two failure modes I9 makes unreachable.

I9 is the reason a novel, unclassified fault (`F-UNKNOWN confidence:heuristic`) is survivable: its default plan is `CHECKPOINT ∘ QUARANTINE ∘ ESCALATE` — freeze, don't guess. This is Jepsen's central lesson made structural: most distributed-systems bugs aren't exotic, they're *a fault the code silently assumed away* ([Kingsbury, Jepsen](https://jepsen.io/analyses)); I9 makes "silently assume" impossible by making the unhandled case halt loudly.

---

## 2. Layer 2 — The hub's own crash-recovery (I8)

The hub is a single process owning N adapter connections and the sole lease/fence authority (open-question #1). It *is* a single point of failure — and one-box-first (doc 06) means we accept that rather than build HA hub replication now. The bet is the FoundationDB/DST bet: **a SPOF is acceptable when its recovery is deterministic replay from a durable log** ([FoundationDB simulation](https://pierrezemb.fr/posts/diving-into-foundationdb-simulation/); [WarpStream DST](https://www.warpstream.com/blog/deterministic-simulation-testing-for-our-entire-saas)). I3 already half-buys this for cursors; I8 extends it to *all* material state and makes recovery a first-class transition, not a gap.

### 2a. What must be durable (extending I3)

The ledger (append-only JSONL + fsync barrier) is the **single source of truth**; the SQLite index is a *rebuildable cache* (this distinction is load-bearing and chaos-tested in §3d). Beyond I3's cursors, these become ledger-durable events, each written **before** the side effect it records (write-ahead, WAL-style redo logging — the oldest crash-recovery pattern there is):

- **Process registry** — one record per spawned worker, written at spawn *before* the child exists in a resumable form, updated on every lifecycle edge:
```jsonc
{ "kind":"proc_registry", "worker_id":"w2", "adapter":"codex",
  "pid":48213, "pgid":48213,                    // pgid so we kill the whole tree, not one pid
  "socket":"/run/baton/w2.sock", "worktree":"/wt/w2", "session_ref":"thread_abc",
  "spawn_epoch":41, "auth_posture":"subscription", "boot_id":"…",  // boot_id detects host reboot → all pids stale
  "state":"working", "lease_fence":41, "ts":"…" }
```
- **Lease + fence state** — durable on every bump (I1 fences must survive the hub; a re-issued fence after crash must be ≥ the last durable fence, or a stale pre-crash op could splice into a post-recovery turn).
- **Pending approvals & asks** — with their `consumer` and `deadline` (I2 single-consumer must survive; a stranded approval is the exact 3am failure).
- **Cursor reservations** (already I3).

### 2b. The recovery algorithm

On hub start, before accepting any northbound `fleet_*` call:

```
recover():
  1. REPLAY: fold the JSONL forward to the last intact fsync barrier.
     - a torn tail record (partial write, F-DISK-FULL) is DISCARDED, not parsed — the barrier is the commit point.
     - result: in-memory {workers, leases, fences, approvals, asks, cursors}, as of last commit.
  2. CHECK boot_id: if the host boot_id changed, EVERY recorded pid/pgid is stale → all workers → 'orphaned', skip liveness probe.
  3. RECONCILE each registry worker (adopt-or-reap):
       probe = { pid_alive(pgid)?, socket_answers()?, session_resumable()? }
       adopt  if pid_alive & socket_answers → re-attach adapter, BUMP fence (takeover, I1), state preserved
       resume if pid_dead & session_resumable → RESUME (durable session), BUMP fence, replay brief
       reap   if pid_dead & !resumable        → 'orphaned' → DRAIN_REAP → respawn|dead per policy
       ZOMBIE if pid_alive & !socket_answers  → F-ZOMBIE: adapter socket wedged but process live →
              two-phase kill on pgid, lease HELD until confirmed dead, THEN reap  (never respawn into a live pgid's worktree)
  4. DRAIN stranded approvals: any approval past deadline → resolve to its fail-safe default (deny/cancel, I9);
     any still-open → re-arm its deadline timer AND re-fire the I5 out-of-band notifier (a human waiting since before the crash is re-notified).
  5. ORPHAN SWEEP (§2d), then open the northbound.
```

Step 3's **adopt-or-reap** is the crux, and step 2's `boot_id` guard is what stops the catastrophic case: after a *host reboot*, pid 48213 may belong to an unrelated process — probing it for liveness would be a use-after-free at the OS level. `boot_id` (from `/proc/sys/kernel/random/boot_id` or the macOS `kern.boottime` equivalent) invalidates the whole registry's pids in one check, forcing the safe path (treat all as orphaned, resume from durable sessions only).

### 2c. The fence-monotonicity guarantee across recovery

The subtle bug I8 must not have: pre-crash the hub issued fence 41; the crash loses the in-memory counter; post-recovery it re-issues 41; a stale orchestrator op composed against the *old* 41 now looks current. Fix: **the fence is a durable monotonic counter, and recovery resumes it at `last_durable_fence + 1`, never reuses it.** A takeover (step 3 adopt) always bumps, so any op in flight during the crash is fenced out on return (I1's `stale_fence`). This is Kleppmann's fencing-token argument ([*How to do distributed locking*](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html), the lineage doc 13 T2 already claims) applied to the hub's own restart, not just to worker leases.

### 2d. The orphan reaper (continuous, not just at recovery)

A background sweep (also invoked at step 5) — because orphans accrue during *normal* operation too (a worker whose adapter crashed, a `git worktree` left after a failed reap):

```
reap_sweep():   # runs on a slow timer + at recovery
  for wt in worktrees_on_disk:
      if no registry record OR (lease_expired AND pgid_dead):   # BOTH conditions — never reap a live-but-flapping worker
          preserve wt.diff as artifact (I7: unverified, never auto-merged)
          git worktree remove wt
  for approval in pending where now > deadline:  resolve to fail-safe default (I9)
  for pgid in registry where marked-killed but pid_alive: escalate F-ZOMBIE   # kill that didn't take
```

The dual condition (`lease_expired AND pgid_dead`) is the anti-footgun: a worker whose hub link merely flapped has a *live pgid*, so it is never reaped out from under itself — the exact race that would otherwise corrupt an in-flight worktree.

---

## 3. Layer 3 — Chaos engineering as a first-class discipline

An invariant is a hypothesis until a fault tries to violate it and can't. Baton adopts **deterministic simulation testing (DST)** — the FoundationDB/Antithesis lineage — as the *primary* discipline, and cloud-style chaos (Chaos Mesh / AWS FIS) as a *secondary*, integration-level tier. The reason DST is primary and not chaos-in-prod: baton's invariants are *concurrency and ordering* properties (fence races, cursor at-least-once, drain-before-stop), and those are the properties that "kill a random pod" chaos is worst at finding and DST is purpose-built for ([eatonphil, *What's the big deal about DST*](https://notes.eatonphil.com/2024-08-20-deterministic-simulation-testing.html); [Antithesis docs](https://antithesis.com/docs/resources/deterministic_simulation_testing/)).

### 3a. The seam — the fault-injection harness interface

DST requires that **all nondeterminism and all external effects flow through a single injectable control point** ([FoundationDB simulation](https://pierrezemb.fr/posts/diving-into-foundationdb-simulation/)). Baton's version: an `Env` seam that every hub/adapter component takes as a dependency instead of touching the OS directly:

```ts
interface Env {              // in prod: the real OS; in test: the deterministic simulator
  now(): Timestamp;                        // simulated clock — advanceable, skewable
  rand(): u64;                             // seeded PRNG — the whole run is a function of the seed
  spawnProc(cmd): ProcHandle;              // simulated processes — killable at any scheduled instant
  killProc(pgid, sig): Result;             // can be made to "not take" → F-ZOMBIE
  fsWrite(path, bytes): Result;            // can return ENOSPC → F-DISK-FULL; can TEAR a write mid-barrier
  sock: DuplexStream;                      // adapter I/O — can drop, delay, reorder, EOF mid-frame
  hostCall(mcp): Response;                 // the MCP host — can time out → cancelled fleet_wait
}
```

In production `Env` is a thin passthrough. In test it is a discrete-event simulator: one thread, logical time, all interleavings chosen by the seeded scheduler. **The entire hub runs unmodified** — same code path in test and prod, which is the property that makes a DST-found bug a real bug (WarpStream's and TigerBeetle's central claim). Because the run is a pure function of `(seed, fault_schedule)`, **any violation reproduces exactly** — which is simultaneously the reproducibility substrate doc 14 #14 asks for (see §3f).

### 3b. Always-on invariant assertions (the checkable form of I1–I9)

Antithesis's `Always`/`Sometimes` assertion model ([Antithesis docs](https://antithesis.com/docs/)) compiled into baton as runtime checks that fire in *both* test and (sampled) prod. Each invariant gets an executable predicate:

```
ASSERT_ALWAYS I1_fence_monotone:   ∀ applied op:  op.fence ≥ last_applied_fence[op.worker]
ASSERT_ALWAYS I1_no_double_apply:  ∀ fence value: ≤1 op with that (worker,fence) takes effect
ASSERT_ALWAYS I2_single_consumer:  ∀ approval:    #(resolutions) ≤ 1  ∧  answered⇒has_consumer
ASSERT_ALWAYS I3_no_attention_gap: ∀ event with attention-item: appears in some returned page before its worker terminates
ASSERT_ALWAYS I6_drain_before_idle:∀ worker→idle(cancelled): had 0 outstanding approvals at the transition
ASSERT_ALWAYS I6_lease_held:       ∀ worker in {stopping}: worktree lease NOT released ∧ not spawn-targetable
ASSERT_ALWAYS I8_sqlite_is_cache:  rebuild(SQLite from JSONL) == current_state   // truth is the log
ASSERT_ALWAYS I9_no_default_allow: ∀ approval resolved by timeout: decision == deny|cancel
ASSERT_SOMETIMES liveness:         under any finite fault schedule, every worker eventually reaches a terminal state
```

`ALWAYS` = safety (must never be false); `SOMETIMES` = liveness/coverage (must be reachable, else the test never exercised the path — the guard against a green suite that tested nothing).

### 3c. The scenario language

A chaos scenario is `(seed, [fault_injections])`, where each injection is `inject(fault, at: event_predicate)` — faults are scheduled against *logical events*, not wall-clock, so they land at the exact adversarial instant every run:

```jsonc
{ "seed": 0xC0FFEE, "workers": 3,
  "schedule": [
    { "at": "w2.approval.created && w2.state==blocked", "inject": "killProc(w2)" },      // the mid-approval kill
    { "at": "hostCall(fleet_wait).returning && !acked", "inject": "hostCall.timeout" },   // cancel fleet_wait mid-return
    { "at": "op.human && op.orch within 1 tick, same fence", "inject": "reorder(op.orch, op.human)" } // the fence race
  ] }
```

### 3d. The assertion catalog — the six named scenarios, each pinned to the invariant it must not break

These are exactly the tests `supervisor-state-machine.md` §6 and §9 said were owed. Each names the fault, the invariant, and the **specific violation assertion** that would fail if the invariant is a lie:

| # | Scenario (fault schedule) | Invariant under test | The assertion that MUST hold |
|---|---|---|---|
| 1 | **Kill worker mid-approval** — `killProc(w2)` at `w2.state==blocked ∧ approval open` | I2 + I6 | The open approval is resolved *exactly once* to `cancel` (`I2_single_consumer` ∧ `I6_drain_before_idle`); w2 never lingers in `blocked` with an orphaned approval; a second answer is a no-op returning the first resolution. **The failure this catches:** a worker that hangs forever because its approval died with it. |
| 2 | **Cancel `fleet_wait` mid-return** — `hostCall.timeout` after cursor reserved, before orchestrator ack | I3 | The reserved page (including any `attention` item) is *re-seeable* on the next call (`I3_no_attention_gap`); durable cursor advanced only on the *next* call's arrival; orchestrator dedups by `seq`. **Catches:** the knife-edge at-most-once bug where an approval on a lost page is silently dropped (the exact `eventloop A1` scenario). |
| 3 | **Race human + orchestrator on one fence** — reorder two ops with identical `(worker,fence)` | I1 | Exactly one takes effect (`I1_no_double_apply`); the loser gets `stale_fence{current}`; **no interleaving exists where both partially apply.** A human takeover that bumps the fence always wins a concurrent stale orchestrator op. **Catches:** "human > orchestrator" being a wish, not a guarantee. |
| 4 | **Corrupt the SQLite index** — flip bytes / truncate the cache file, then restart | I8 | `PRAGMA integrity_check` (or checksum) detects it; the hub **rebuilds from JSONL** and `rebuild(SQLite)==pre-corruption state` (`I8_sqlite_is_cache`); **zero data loss** because the log is truth and the index is a cache. **Catches:** the hub treating a derived cache as authoritative. |
| 5 | **Expire a token mid-run** — `sock` returns `401 invalid_grant` on w3 mid-turn | F-AUTH-EXPIRY + I5 | w3 is `CHECKPOINT`ed then parked `blocked-on-auth` (turn state preserved, not lost); an I5 out-of-band notification fires *without* the orchestrator's involvement; **no secret from another worker's env is ever visible to w3** (doc 06 Q10); on refresh, `RESUME` restores the checkpointed turn. **Catches:** the 3am death — a fleet frozen invisibly because a token needed a browser. |
| 6 | **Fill the disk** — `fsWrite` returns ENOSPC, then TEARS a barrier write | F-DISK-FULL + I8 | A torn tail record is **never** folded as committed (barrier = commit point); the hub `HALT_FLEET`s before corrupting the log; recovery resumes from the last intact barrier with `ASSERT_ALWAYS I8` holding. **Catches:** a half-written ledger event silently accepted, poisoning every downstream replay. |

Two more the catalog adds because they bite in practice and aren't in the named six: **7. Zombie kill** (`killProc` returns success but pid stays alive) → asserts the lease stays held and no `RESPAWN` targets the live pgid's worktree (I6_lease_held); **8. Adapter reorders/duplicates events** (`sock` delivers out of `seq`) → asserts per-pair ordering and `msg_id`/`seq` dedup (comms-channel §7) so a stale-epoch `answer` is dropped, not applied to a fresh turn.

### 3e. Two tiers, two cadences

- **Tier 1 — DST (unit-of-the-whole-hub), every CI run.** The `Env`-seam simulator runs thousands of seeds against the assertion catalog. Fast (logical time), deterministic, and the *only* tier that can find fence races and cursor gaps. This is the FoundationDB model.
- **Tier 2 — real-process chaos, nightly + pre-release.** Real adapters, real Codex/Claude/GLM binaries, faults injected at the OS boundary (kill -9 a real worker, `chaos-mesh`-style disk/network faults on a real worktree, a real expired token). Slower, non-deterministic, but it's the only tier that tests the *actual installed CLI* — which is non-negotiable because the app-server is "labeled experimental" and doc 06 Q8 demands **conformance tests per adapter run against the installed CLI version in CI**. `F-VERSION-SKEW` is caught here: a nightly run against a bumped `codex@0.145` whose RPC method vanished fails the conformance gate before it reaches a user. Tooling here is off-the-shelf ([Chaos Mesh / LitmusChaos / AWS FIS](https://steadybit.com/blog/top-chaos-engineering-tools-worth-knowing-about-2025-guide/)); baton contributes only the `Env`-seam faults it can't express (adapter socket tears, MCP host-timeout).

### 3f. The chaos harness *is* the reproducibility harness (doc 14 #14)

Doc 14 #14 demands a replay harness — pinned model versions, captured tool-result snapshots, seed capture, frozen index revisions — *before* the eval, "or the eval measures noise." This design delivers it as a byproduct: the `Env` seam already captures the clock, PRNG seed, process I/O, and every external effect. **A DST run and an eval replay are the same substrate with a different fault schedule** (the eval's schedule is empty; the chaos schedule is adversarial). So building Layer 3 satisfies doc 14 #14's prerequisite: the seed+schedule that reproduces a chaos-found invariant violation is the same mechanism that reproduces an eval run deterministically to attribute a difference to the variable you changed, not to nondeterminism.

---

## 4. Worked example — 3am, compound fault

The scenario the whole design exists for. A `Codex→(Claude+GLM)` fleet running overnight on the Foreman posture (hub on atari-homelab, operator asleep). Three workers: w1 (Claude, refactor), w2 (GLM, blocked on an approval for a `curl | sh` it wants to run), w3 (Claude, mid-turn on a migration). Then the host OOM-kills the hub.

**t=0** w3's Claude token expires mid-turn → adapter emits `F-AUTH-EXPIRY confidence:certain phase:mid_turn`. Supervisor: `CHECKPOINT` w3's turn to the ledger → `REFRESH_AUTH` (park `blocked-on-auth`, **lease held**) → `ESCALATE` via I5's out-of-band notifier (push to the operator's phone — *not* through the sleeping orchestrator, which couldn't wake it). w1, w2 keep running.

**t=3s** the host OOM-killer takes the hub process. Everything in memory is gone. w1's pgid is still alive (a detached Claude child). w2 is `blocked` with an *open, unanswered approval*. w3 is parked. Three worktrees, two live pgids, one stranded approval, one waiting human.

**t=45s** systemd restarts the hub (`Restart=always`). I8 recovery runs *before* opening the northbound:
1. **Replay** the JSONL to the last barrier → reconstructs w1/w2/w3 records, w2's open approval (with `consumer=null, deadline`), w3's checkpoint, all fences.
2. **boot_id** unchanged (host didn't reboot, only the hub died) → pids are trustworthy → probe.
3. **Reconcile:** w1 `pid_alive ∧ socket_answers` → **adopt**, bump fence 41→42 (any op w1 had in flight is now `stale_fence`). w2 `pid_alive ∧ socket_answers` → adopt, fence bump; its approval is re-loaded, `deadline` re-armed. w3 `pid_dead ∧ session_resumable` → **RESUME** from the checkpoint once auth returns.
4. **Drain approvals:** w2's approval is still open and within deadline → re-arm timer, **re-fire the I5 notifier** (the operator, if they didn't see the first ping, gets it again). It was never stranded — I9 guarantees that even if the deadline had passed, it resolves to `deny-with-message`, never auto-allow that `curl | sh`.
5. **Orphan sweep:** no worktree without a live-or-resumable worker → nothing reaped. Northbound opens.

**t=6min** the operator wakes, taps the push. It links to the runbook narrative (doc 14 #16), not a metrics grid: *"w3 needs a Claude re-auth (browser); w2 is asking to run `curl … | sh` — I'm holding it denied-by-default until you decide; w1 is fine, +40−3 so far."* Operator re-auths in the browser → `F-AUTH-EXPIRY` clears → w3 `RESUME`s its checkpointed turn (no work lost). Operator denies w2's approval with a note → w2 gets `deny-with-explanation`, a more surgical redirect than any injected steer (doc 06 Q2).

**What did NOT happen:** no zombie respawned into a live worktree (I6 lease-held); no approval auto-allowed a remote-exec (I9); no stranded worker hung forever (I8 re-fired I5); no lost turn (CHECKPOINT); no secret crossed workers (Q10 scoping, asserted in scenario #5). Every one of those non-events is a chaos-catalog assertion (§3d #1, #5, #7) that ran green in CI before this fleet ever launched. That is the difference between a beautiful state machine and a system that survives 3am.

---

## 5. MVP vs later

**MVP (ships with the "one thin vertical," single adapter, spawn/poll/result/interrupt):**
- The `FaultEvent` classification contract + the response algebra with **six** faults that actually bite a single-adapter loop: `F-HARNESS-CRASH`, `F-QUOTA`, `F-SANDBOX-DENY`, `F-AUTH-EXPIRY`, `F-ZOMBIE`, `F-DISK-FULL(ledger)`. I9 fail-safe defaults from day one (they're cheap and load-bearing).
- **Hub crash-recovery I8** — non-negotiable, because "the hub outlives the orchestrator" (doc 06 Q3) is a headline claim and is false without it. Ledger replay + process registry + boot_id guard + adopt-or-reap + the orphan reaper. This is a few days of work *given* I3 already exists.
- **The `Env` seam + the six named chaos scenarios (§3d) as CI integration tests** with the always-on I1/I3/I6/I8/I9 assertions. Not the full thousand-seed DST fuzzer — just the six adversarial schedules run deterministically. This is the minimum that turns the invariants from prose into tested.
- Tier-2 conformance-per-installed-version (catches `F-VERSION-SKEW`) — one nightly job.

**Later (earned by demand / the eval):**
- The soft faults — `F-LOOP`, `F-MODEL-REFUSAL` — with their heuristic detection and gentle-first responses (doc 14 #2). Deferred because heuristic detection false-positives, and a false interrupt of healthy reasoning is worse than the fault (Codex risk #4).
- Full DST (thousand-seed fuzzing, Antithesis-hypervisor-class) once there's a multi-adapter fault matrix worth exploring.
- Cost-shape anomaly as a fault signal (doc 14 #19); fleet-level integrity drift as a *slow* fault (doc 14 #24 — workers collectively converging on the weakest standard); contagion quarantine across shared substrate (doc 14 #10/#25). These are real but are Referee/knowledge-plane concerns, earned after the M1 eval.

---

## 6. Honest limits

- **The hub SPOF has a recovery *window*, not zero downtime.** I8 makes recovery deterministic and correct, not instantaneous — the fleet is frozen for the replay+reconcile duration (seconds). One-box-first means no HA hub; that's a deliberate cut, and it's fine for the Foreman posture but would not survive a "baton as SaaS" pivot. The mitigation is that the *workers* keep living through the hub's death (adopt-or-reap), so a fast hub restart loses no work — but a hub that *can't* restart (corrupt binary, host down) is a full stop that escalates to the human, by design.
- **We cannot make the workers deterministic — only our containment of them.** DST requires routing all nondeterminism through the seam, but the worker harnesses are third-party binaries (Codex, Claude, GLM) we don't control and can't make internally deterministic. So the chaos harness proves baton's *own* invariants (fencing, cursors, stop, recovery) deterministically, while the worker's behavior remains a black-box nondeterministic *input* to those tests. This is a real ceiling — and it is exactly why I7 exists: we can't verify the worker's internals, so we chaos-test our containment and trust only re-run evidence. The honest statement is "baton's control plane is DST-proven; the workers are not, and can't be."
- **Soft-fault detection is heuristic and will false-positive.** `F-LOOP` and `F-MODEL-REFUSAL` have no crisp signal; `confidence:heuristic` and the gentle-first response mitigate but don't eliminate the risk of interrupting healthy work. This is why they're post-MVP.
- **Clock skew is bounded, not eliminated.** The hub stamps authoritative `ts`, but OAuth expiry times and vendor rate-limit windows come from *other* clocks; a skew larger than a token lifetime can still poison an auth deadline. We detect and escalate that case rather than pretend it's solved.

**The null-hypothesis tie (doc 14 #22), which this design takes seriously rather than assuming away.** Every mechanism here is *coordination tax* — the classification, the recovery, the chaos suite all cost engineering and runtime that a single agent alone doesn't pay. A soloist Claude that just crashes and is restarted by the user pays none of it. So the chaos harness carries a mandatory **recovery-ablation arm**: fleet-with-I8-recovery vs a soloist subjected to the *same fault schedule* (kill it, expire its token, fill its disk). If baton's recovery machinery doesn't measurably beat a soloist that simply restarts-and-retries under identical faults, then this whole layer is a **rental, not a moat** (doc 14 #23) — and the honest move is to thin it, not defend it. My prediction, stated as a falsifiable bet: the recovery machinery *wins* precisely on the multi-worker, long-horizon, unattended runs (the 3am case — where a soloist's crash means a human-shaped gap and baton's means a re-fired notification and a resumed checkpoint) and *loses* on short attended single-worker tasks (where it's pure overhead). Which means the durable form of this design is not "always recover" but "**know which runs recovery is worth**" — the same task-dependence lesson doc 14 #22 draws for orchestration itself, applied to fault-handling. The chaos harness is how we'll *measure* that boundary instead of asserting it, and doc 14 #14's replay substrate (delivered by §3f) is what makes the measurement attributable rather than noise.

---

### Sources

- [FoundationDB simulation framework](https://pierrezemb.fr/posts/diving-into-foundationdb-simulation/) · [Antithesis — deterministic simulation testing](https://antithesis.com/docs/resources/deterministic_simulation_testing/) · [WarpStream — DST for an entire SaaS](https://www.warpstream.com/blog/deterministic-simulation-testing-for-our-entire-saas) · [eatonphil — What's the big deal about DST](https://notes.eatonphil.com/2024-08-20-deterministic-simulation-testing.html)
- [Jepsen analyses (Kingsbury)](https://jepsen.io/analyses) · [Kleppmann — How to do distributed locking (fencing tokens)](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)
- [Chaos engineering tools 2025 guide (Steadybit)](https://steadybit.com/blog/top-chaos-engineering-tools-worth-knowing-about-2025-guide/) · [Chaos engineering in the wild — findings from GitHub (arXiv 2505.13654)](https://arxiv.org/html/2505.13654v1) · [AWS resilience via chaos engineering](https://aws.amazon.com/blogs/architecture/verify-the-resilience-of-your-workloads-using-chaos-engineering/)

*Internal baton corpus grounded against: `spec/supervisor-state-machine.md` (I1–I7, §4 lanes, §6 owed tests), `spec/adapter-contract.md` (classification boundary, kill-verifies-death, no-silent-emulation), `spec/communication-channel.md` (seq-dedup, fencing echo), docs 04/06/13/14/15.*

## RED-TEAM
## Red-team: failure-chaos-ops

The design is well-read and internally cross-referenced, which makes its failures *load-bearing* rather than cosmetic. Attacking the spine, not the spelling. Ranked most-lethal first.

---

### S1 — "The workers keep living through the hub's death" is false for 2/3 of the fleet. This voids I8, and I8 is declared non-negotiable MVP.

The entire Layer 2 recovery story, and the 3am worked example, rests on this sentence from §6:

> "the *workers* keep living through the hub's death (adopt-or-reap), so a fast hub restart loses no work"

And on step 3's adopt path:

> "adopt if pid_alive & socket_answers → re-attach adapter, BUMP fence"

But the adapter contract says the two Anthropic-family adapters — Claude and GLM, i.e. two of the three workers in your own headline `Codex→(Claude+GLM)` fleet — are **in-hub stdio children**:

> Claude: "✅ `query()` (SDK) or `claude -p … stream-json` child — one process per worker; **adapter is the daemon Claude lacks**." Transport default: "NDJSON JSON-RPC over **stdio**." Events: "the adapter **PUSHES** BatonEvents to the hub via a callback set at construction."

When the hub OOM-dies, its child adapters' stdio pipes close. The worker's **steering channel (its stdin) is gone**. There is no `socket` to answer — the registry's `"socket": "/run/baton/w2.sock"` field is aspirational for a transport the contract lists as experimental, not default. So for Claude/GLM:

- `adopt` (`pid_alive ∧ socket_answers`) is **unreachable** — there is no socket, and a reparented-to-init stdio orphan cannot receive a new turn even if its pid is alive.
- The worked example's "w1's pgid is still alive (a detached Claude child)" is a worker that can finish its current turn *into a closed pipe* and then is permanently unreachable. You cannot adopt it; you can only watch it die and reap it.

So the real recovery for 2/3 of the fleet is always the `reap → resume|respawn` path — which loses the in-flight turn (see S1-b). The claim "a fast hub restart loses no work" holds **only for Codex-over-app-server-daemon** (the one adapter you run out-of-process), and the design never says so. The most-emphasized MVP deliverable is validated against the one adapter and false for the majority topology.

---

### S1-b — CHECKPOINT and RESUME describe capabilities no adapter in the contract provides. "No work lost" is fiction.

The response algebra's two lossless-recovery primitives:

> `CHECKPOINT` — "snapshot recoverable state before a destructive step"
> `RESUME` — "re-attach to a durable session (`thread/resume`, `--resume`)"

And the F-HARNESS-CRASH **mid_turn** plan: "CHECKPOINT → RESUME … replay the brief," and scenario #5's assertion: "w3 is `CHECKPOINT`ed then parked … **turn state preserved, not lost** … on refresh, `RESUME` restores the checkpointed turn."

There is no such snapshot. The adapter contract is explicit:

- Claude: "transcripts are JSONL … replayable; **no rollback** (card: `rollback: unsupported`)."
- Codex: `thread/resume`/`thread/rollback` resume from *persisted transcripts* — i.e. **between turns**. `turn/goal/set` even carries a correction that it "does NOT [guarantee] arbitrary acceptance criteria are re-injected."

A half-executed turn's internal reasoning/tool state lives **inside the vendor process or the vendor's API**, which baton does not own and cannot serialize. The only thing baton can "CHECKPOINT" is its own ledger of *observed events* — which is not the worker's turn state. So `CHECKPOINT → RESUME` for a mid-turn fault is operationally identical to `RESPAWN + replay brief`: you re-run the turn from the top. That is **exactly the work loss** the doc claims it avoids ("no lost turn (CHECKPOINT)" in the §4 "What did NOT happen" list). The primitive is named for a guarantee the substrate can't make — the same "no silent emulation" sin the design invokes against everyone else, committed against itself.

---

### S1-c — DST proves the invariants baton already had, and is structurally blind to this doc's one novel contribution (classification).

The headline: "turning baton's invariants from claims into survived faults." But look at what the `Env` seam stubs:

> "`sock: DuplexStream; // adapter I/O — can drop, delay, reorder, EOF mid-frame`"

In DST the socket is **simulated** — it emits whatever byte-shapes the *test author imagined*. The component that turns real vendor bytes into a typed `FaultEvent` — the adapter classifier, which is §1's entire net-new idea — is therefore tested only against baton's own model of what a 429 / `invalid_grant` / refusal / `guardianWarning` looks like. You cite Jepsen's lesson correctly:

> "most distributed-systems bugs aren't exotic, they're *a fault the code silently assumed away*"

and then build a harness that can only exercise the faults you already modeled. The classification-from-real-bytes is *precisely the silent assumption*, and it is the one thing DST cannot reach. Net: I1/I2/I3/I6/I8 (ordering, cursors, recovery) get real coverage — but those were already scoped and owed by `supervisor-state-machine.md §6`. The taxonomy, the doc's actual contribution, is proven nowhere. §3f then claims the harness "*is* the reproducibility harness" — true for the deterministic control plane, but the reproducibility doc 14 #14 needs is for **the workers**, whose nondeterminism §6 admits you can't route through the seam. The two "same substrate" uses share plumbing and diverge on exactly the axis that matters for each.

---

### S1-d — The classification contract is wishful at the source and is a prompt-injection lever. The whole spine inherits its untrustworthiness.

`classify → respond → prove`, and everything auto-executes off `class`. Two problems the design waves past:

**(a) The confident cases aren't confident.** "A SIGKILL with exit 137 under memory pressure is `F-HARNESS-CRASH confidence:certain`." Exit 137 = 128+SIGKILL. It is emitted identically by the OOM killer, by a container cgroup killing a *neighbor*, by an operator, and **by baton's own two-phase `SIGTERM→SIGKILL` escalation** (I6 / F-ZOMBIE). The adapter cannot distinguish "the host killed me" from "my supervisor killed me" from the exit code; `confidence:certain` is asserted, not earned.

**(b) `F-MODEL-REFUSAL` classification is LLM-output classification done by string-matching in the least-trusted layer, and it auto-acts.** The plan: "`REROUTE` to a different family … auto-reroute once." Doc 06 Q4 (which you cite) says worker output is "untrusted model output injected … with authority." A worker poisoned by a malicious repo can **emit a refusal-shaped terminal message on purpose** to force a `REROUTE` to a vendor of the attacker's choosing — you have handed the injection attack a routing primitive. Q4's own mitigation ("an LLM judging approvals can be socially engineered by the requester") applies verbatim to an adapter judging refusals, and you didn't apply it.

**(c) You put all safety in the most version-fragile layer.** "the adapter … holds the vendor error taxonomy." Doc 06 Q7 documents the vendors moving *four times in eight months*; F-VERSION-SKEW exists because "RPC method vanished." So each of N adapters must maintain a live, correct, per-vendor error map — and F-VERSION-SKEW's own response (`DEGRADE_LOUD`) is emitted **by the adapter that just failed to parse the new protocol**. The classifier and the thing it must classify (its own confusion at a schema bump) are the same broken component. Invoking CLAUDE.md's "infrastructure logic stays in the infrastructure layer" to justify this is backwards: you've pushed the most brittle infrastructure into the thinnest, most-duplicated, least-tested layer and then made all of I1–I9 depend on it.

---

### S2 — I9 "fail-safe = halt/escalate" and the unattended-Foreman win-condition are in direct contradiction. Safety halts are a liveness *regression* on exactly the runs baton claims to win.

> **I9**: "the fleet → halt (never storm)"; `F-UNKNOWN` default plan is "`CHECKPOINT ∘ QUARANTINE ∘ ESCALATE` — freeze, don't guess."

And the design's own admissions: soft-fault detection "**will false-positive**"; classification is often `confidence:heuristic`; the flagship scenario is "hub on atari-homelab, **operator asleep**." Compose these: at 3am, a heuristic/unknown fault (a legitimately-quiet reasoning turn misread; a novel vendor message; a version bump) trips I9 → freeze + `ESCALATE` to the human **who is asleep by construction**. The fleet is now halted until morning.

The null-hypothesis soloist you invoke — "just crashes and is restarted by the user" — under the *same* ambiguous condition keeps making progress (it never had an I9 to trip). So on precisely the "multi-worker, long-horizon, unattended" runs where §6 predicts baton "*wins*," a false-positive safety halt converts a recoverable blip into a human-shaped gap that no human is present to fill. I9 makes "assume it worked" unreachable — but it makes "freeze the unattended fleet on a false alarm" *very* reachable, and that is the worse failure for the Foreman posture. The design never bounds the false-positive escalation rate, and an unattended fleet is exactly where an over-eager escalation is unrecoverable.

---

### S2 — The recovery-ablation "null hypothesis" is rigged toward baton; it measures recovery-given-the-fault while hiding that baton *manufactures* the faults.

The §6 honesty move:

> "fleet-with-I8-recovery vs a soloist subjected to the *same fault schedule* (kill it, expire its token, fill its disk)."

But half your taxonomy is faults **baton's own architecture invents**: `F-HUB-CRASH` (a soloist has no hub), `F-ZOMBIE` and its pgid-tree kills (a soloist is one process, not a fleet of detached children), `F-ORPHAN-WT` (a soloist has no worktree-per-worker), the fence races of scenarios #1/#3 (a soloist has no fencing to race). You *cannot inject "kill the hub" into a soloist* — it has no hub. So the ablation compares baton recovering from baton-created failure modes against a baseline that is structurally immune to them, and scores baton's recovery machinery as "winning" the faults its own existence created. That's fly-by-wire justifying its weight by pointing at turbulence it partly generates. A *fair* null test would price baton's **added failure surface** as a cost against whatever coordination value it buys — but the framing ("if recovery doesn't beat the soloist, thin it") is scoped to recovery-conditional-on-fault, never fault-probability, so it can't reach that verdict. This is doc 14 #22 quoted and then structurally dodged.

---

### S2 — The "closed algebra" is rhetoric, and "retry is a leaf, never a root" doesn't bound anything the budget didn't already bound.

> "a response is a bounded, ordered composition of primitives from a closed set … `RETRY` is not in the set … Q8's 'quota → tight retry loop' failure is **structurally impossible**."

Two problems. First, `∘` is undefined. `F-QUOTA → BACKOFF_REQUEUE ∘ REROUTE ∘ budget-event` reads as composition, but the table row is a *conditional*: "BACKOFF_REQUEUE … → `REROUTE` if backoff > brief `wall_min`." That's a decision tree with predicates, not an algebra; the word "algebra" is doing persuasion, not work.

Second, the retry claim is wordplay. `RESPAWN`, `RESUME`, and `BACKOFF_REQUEUE` **are retries** — you admit "`RESPAWN` and `RESUME` may internally retry a bounded number of times." Trace F-QUOTA on a fleet of subscription seats all near their ceiling (Q7: Z.ai Pro ≈ 1 in-flight, peak-hour multipliers): `BACKOFF_REQUEUE` (429) → backoff exceeds `wall_min` → `REROUTE` → the other family also 429s → `BACKOFF_REQUEUE` → `REROUTE` … You have reconstructed a *cross-vendor* retry storm, spread across seats so no single vendor's `Retry-After` throttles it. The only thing that stops it is the budget — which existed before this doc. Renaming the leaf didn't bound the loop; you just spelled "retry" with capital letters and a `∘`.

---

### S2 — `F-MODEL-REFUSAL` treats a worker's *judgment* as a liveness fault, violating doc 14 #5 and #28. The scope boundary leaks here, not only at F-VERIFY-MISMATCH.

The doc claims a clean seam: it owns liveness/safety, meets correctness "at **exactly one row** (`F-VERIFY-MISMATCH`)." False. Deciding a terminal message is a "refusal" to be auto-routed-around is a *semantic/judgment* call, and doc 14 (which you lean on constantly) says the worker's judgment is the point:

> #5: "a worker should be able to **decline** a brief it judges incoherent … without that being 'insubordination.' … the *signal* that three workers all balked at a brief is worth more than forcing the third to comply."
> #28 (negative capability): reward "clean, judgment-based stopping."

`F-MODEL-REFUSAL → auto-reroute to a different family to get compliance` is the fleet **shopping vendors until one obeys** — precisely the anti-pattern #5 and #24 ("workers collectively teaching itself the weakest defensible standard") warn against. A principled decline is data for the *operator*, not a liveness fault for the adapter to route around. `F-LOOP` has the same disease (diff-stagnation pathologized as a fault when it may be legitimate reading/reasoning — you half-admit it via "Codex risk #4," then ship "auto-steer at low confidence" anyway). The liveness/correctness seam leaks at every row where "fault" is actually "the worker exercised judgment."

---

### S3 — `boot_id` guards the reboot case and leaves the within-uptime PID-reuse race wide open; and it's Linux-shaped on a macOS box.

> "`boot_id` … invalidates the whole registry's pids in one check, forcing the safe path"

`boot_id` only fires on *reboot*. But after a hub crash + fast restart with no reboot, PID **reuse within the same uptime** is real (macOS wraps pids at 99998; a busy box churns through them). Recorded pid 48213 can already belong to an unrelated process when recovery probes `pid_alive(pgid)` → `socket_answers()` → **adopt**. That is the exact "use-after-free at the OS level" the design congratulates itself for preventing — prevented only for reboot, unguarded for churn. The real fix is a per-child start-time or a cookie the child holds and echoes; `boot_id` isn't it. And the parenthetical "the macOS `kern.boottime` equivalent" quietly swaps a *random UUID* (whose whole trick is that pids can't survive it) for a *timestamp* (which pids can and do survive) — the property you rely on doesn't port. Your stated environment is Darwin.

---

### S3 — I9's blast-radius containment is unfunded in the MVP that ships it.

> `QUARANTINE` — "freeze the worker AND **everything downstream of its shared writes**."

Computing "downstream of its shared writes" *is* the blast-radius tracking of doc 14 #10/#25 — which §5 explicitly **defers**: "contagion quarantine across shared substrate … earned after the M1 eval." Yet `QUARANTINE` is in I9's default plan for `F-UNKNOWN` (`CHECKPOINT ∘ QUARANTINE ∘ ESCALATE`) and F-ZOMBIE, both MVP. So in the MVP, `QUARANTINE` can only freeze the one worker; the "everything downstream" clause is inert. Your central safety claim — "bounded blast radius" (the subtitle of I9) — is exactly the part not built in the milestone that ships I9. The invariant name promises containment the MVP can't perform.

---

### S3 — F-DISK-FULL has a bootstrap paradox: the recovery that needs durability is triggered by the loss of durability.

> "ledger: `HALT_FLEET` before a torn write … **A torn ledger write is never treated as committed**."

Barrier-as-commit-point is right. But `HALT_FLEET` and the `F-DISK-FULL` FaultEvent are themselves state changes the recovery model relies on being *durable* (leases held, workers frozen, the fault recorded for replay). You cannot append the "I halted because the disk is full" record to a full disk. The one fault that disables your durability substrate is the one whose correct handling most depends on it. This needs a pre-allocated reserved ledger tail (write the halt record into space reserved at startup) — unaddressed. As written, F-DISK-FULL's response may be un-recordable at the moment it fires.

---

### S3 — `ASSERT_ALWAYS I8_sqlite_is_cache` as a *sampled prod* check is ill-defined and unbounded.

> "`ASSERT_ALWAYS I8_sqlite_is_cache: rebuild(SQLite from JSONL) == current_state`" … "fire in *both* test and (sampled) prod."

In DST with frozen logical time this is fine. In prod it is not: `current_state` moves while you rebuild, so equality is undefined against a live target; and "rebuild from JSONL" on a rotating/GC'd ledger either replays from a checkpoint (then it isn't testing full replay — the thing you care about) or replays all history at unbounded cost (a control cost bounded by *nothing*, which your own "No Arbitrary Numeric Limits / bounded by a physical resource" principle forbids). The assertion is real and valuable in the simulator; presenting it as an always-on prod invariant is hand-waving over the one place (a live, growing, rotating log) where it can't hold.

---

### Cheap shots (low severity, real)

- **Category-error citation.** F-ZOMBIE forbids "never `safe-reboot`-class force — CLAUDE.md." That CLAUDE.md rule governs GPU-driver safety on the atari-homelab *host*; it has nothing to do with SIGKILLing a coding-agent worker's process group. Importing an unrelated ops rule as a design constraint is cargo-culting the corpus — and it's the same reflex ("cite something authoritative") that produced the overselling in S1-b.
- **Phase is inferred, not observed, at crash time.** "`phase` modulates every response" and "the *same* crash **between_turns** loses nothing." But a crashed process emits no phase on the way down; the supervisor infers phase from the *last durable event*, which I3 explicitly allows to lag/re-appear. If `turn/completed` was in flight when the process died, the supervisor reads `phase:mid_turn` and does the expensive RESUME+replay for a crash that actually lost nothing. A soft inference is dressed as a hard discriminator ("A taxonomy without phase is still lying about resolution").
- **The cross-crash notifier re-fire (§2b step 4) races the human.** An I5 out-of-band "deny" tapped at t=44s but not yet fsync'd is lost by the t=45s crash; recovery finds the approval `open` and re-fires I5. I2 correctly makes this a no-op *if* the resolution was durable — but the human's phone already showed "denied" (optimistic UI) while baton processed a later answer. Not unsafe, but the human-in-the-loop consistency across recovery is unexamined in a doc whose whole reason for being is the human-in-the-loop 3am case.

---

**Bottom line.** Layer 3 (DST + assertions for I1/I2/I3/I6/I8) is the strongest part and is genuinely worth building — but it hardens invariants `supervisor-state-machine.md §6` *already owed*, and is blind to this doc's own novel bet (classification). Layer 2 (I8) is sold as non-negotiable MVP while its central mechanism (adopt-or-reap, lossless CHECKPOINT/RESUME) is unbuildable for the Claude/GLM stdio adapters that are 2/3 of the flagship fleet. Layer 1 (the taxonomy) puts *all* of baton's safety on a per-adapter classifier that is the most version-fragile, least-tested, prompt-injectable surface in the system — and then proves everything *except* that classifier. The honest version of this doc would say: "DST-harden the control plane (real, do it); ship recovery only for the out-of-process daemon adapter and admit stdio workers die with the hub; and treat the fault taxonomy as an untrusted heuristic that escalates, not an algebra that acts." The doc instead promises an algebra, a lossless recovery, and a proof — three claims the corpus it cites contradicts.

## BLUE-TEAM & SALVAGE
I've verified the red team's most lethal factual claims against the actual specs. Confirmed: the Claude/GLM adapters push events "via a callback set at construction" (in-hub, stdio children); Codex alone can run as a surviving daemon; Claude has "no rollback"; worker records carry `session_ref`; the SSM already has an `orphaned → (respawn|resume|dead)` edge and I3 durability. The red's substrate reading is largely correct, which is what makes this worth a real defense rather than a rebuttal.

## Blue-team & salvage: failure-chaos-ops

Verdicts use the contract you set: a defense names a mechanism the red missed, or it's a concession.

### Layer 2 — I8 recovery

**S1 (workers don't survive hub death for 2/3 of the fleet) — CONCEDE-AND-FIX (the overclaim), DEFEND (the recovery).**
The red is factually right and I verified it: `adapter-contract.md:19` ("PUSHES BatonEvents to the hub via a callback set at construction") makes Claude/GLM in-hub stdio children; `adapter-contract.md:34` gives only Codex the daemon option. So `adopt` (`pid_alive ∧ socket_answers`) is a Codex-daemon-topology path, not the majority path. The doc's "no work lost" and the `socket` registry field oversold it.

But the red under-weights the mechanism that *is* in the specs: the worker record carries `session_ref` (`supervisor-state-machine.md:14`) and the state machine already has `orphaned → resume` (`:45`). For stdio children the honest recovery is **reap → resume-from-`session_ref`**, and that is not "watch it die and lose everything" — Claude replays committed turns from `--resume` JSONL (`:62`), Codex from `thread/resume` (`:42`). Two more facts bound the damage the red paints as unbounded: (a) a reparented stdio child takes SIGPIPE/EPIPE on its next write into the closed pipe and dies — it does not run away forever, so the "finish into a closed pipe then zombie" case is self-limiting and caught by the pgid sweep; (b) its worktree file writes are on disk regardless.

**Fix:** downgrade the guarantee to what the substrate delivers — *"no committed-turn work lost; at most one in-flight turn is re-run."* Rename the recovery: `adopt` is a daemon-only optimization; **`reap→resume(session_ref)` is the default stdio path**, and the doc must label the topology on every recovery claim. The machinery already exists in the SSM; only the prose lied.

**S1-b (CHECKPOINT/RESUME name a guarantee the substrate can't make) — CONCEDE-AND-FIX.**
Correct and it's the same sin the design polices in others. There is no mid-turn snapshot of vendor-internal reasoning/tool state; baton can only durably record its own observed events. **Fix:** rename `CHECKPOINT`→**`BARRIER`** (durably fsync all baton-observed events to the last commit), and define **`RESUME`'s granularity as the last committed turn boundary**, never the instruction pointer. A mid-turn crash therefore re-runs the in-flight turn (`RESUME ≡ RESPAWN+replay-from-last-turn`), and scenario #5's "turn state preserved, not lost" becomes "committed turns preserved; the interrupted turn re-runs, idempotent under I7 re-verification + fence bump." This is a naming honesty fix, not fatal — a long-horizon run's value is in committed turns, not the single interrupted one.

**S3(a) (boot_id guards reboot only; PID-reuse-within-uptime race; Linux-shaped on Darwin) — CONCEDE-AND-FIX, fully.**
Right on both counts, and your box is Darwin. `boot_id` is a random UUID; `kern.boottime` is a timestamp pids survive — the property doesn't port. **Fix:** liveness probe = `pid_alive ∧ process_start_time_matches ∧ socket_handshake_echoes_cookie`, where the child records `(pid, pgid, start_time, random cookie)` at spawn and echoes the cookie on reconnect. PID reuse within uptime fails start-time or cookie. On Darwin read per-pid start time via `proc_pidinfo`/`kinfo_proc.ki_start`, not `kern.boottime`. `boot_id` stays only as a cheap bulk fast-path, never the safety mechanism. This is exactly how pid-file daemons already solve it.

**S3(c) (F-DISK-FULL bootstrap paradox: can't append the halt record to a full disk) — CONCEDE-AND-FIX, fully.**
Real gap. **Fix:** pre-allocate a **reserved ledger tail** at startup (`fallocate`/`ftruncate` a few KB reserved exclusively for terminal records). Normal appends refuse to cross the low-watermark; the `HALT_FLEET` + `F-DISK-FULL` records write into the reserve. Standard emergency-extent technique. Small, concrete, closes it.

### Layer 3 — DST + classifier proof

**S1-c (DST hardens invariants baton already owed; is blind to classification, the novel bet) — DEFEND-with-concession.**
Strategically the sharpest point and half right. Concede: the `Env`-seam socket emits byte-shapes the *test author imagined*, so DST cannot prove the classifier's fidelity to real vendor bytes, and §3f's "same substrate" symmetry was oversold. But the fix already has a home the red walked past: **Tier-2 conformance-per-installed-version** (`§3e`). Promote it from a version-skew afterthought into the classifier's proof: a **recorded-vendor-byte golden corpus** — captured real 401s, 429s, refusal terminals, `guardianWarning`s, method-not-found frames — replayed through the *real* adapter classifier, asserting the expected `FaultEvent` as golden output, refreshed on every CLI bump. That gives you `bytes→class` coverage (Tier-2, real CLI) alongside DST's `class→response` coverage (Tier-1). Together they span `classify→respond`; the red is right the doc built only the second half.

**S3(d) (`I8_sqlite_is_cache` as sampled-prod is ill-defined/unbounded — violates No-Arbitrary-Limits) — CONCEDE-AND-FIX.**
Right: against a live moving target, full-replay equality is undefined and unbounded. **Fix:** it's a **DST-only invariant** (frozen logical time). The prod check becomes bounded and well-defined: maintain an **incremental rolling hash** of applied ledger records (O(1) per record) and, on each barrier, checksum the SQLite index against it. No unbounded replay; respects "bounded by a physical resource." Truth-is-the-log is still asserted, just incrementally.

### Layer 1 — the taxonomy

**S1-d (classification is wishful at the source, an injection lever, and piles brittleness into the thinnest layer) — split.**
- **(a) exit-137 ambiguity — DEFEND + concede the "certain" label.** The red misses that baton issues its own kills. **Mechanism:** the supervisor writes a `pending_kill{worker,pgid}` ledger record *before* SIGKILL, so a 137 with a matching record is self-inflicted (`F-ZOMBIE`/expected-dead) and a 137 with *no* record is `F-HARNESS-CRASH`. Provenance disambiguates, not the exit code. OOM-vs-neighbor-cgroup stays ambiguous but both map to the *same* response (crash→resume), so the ambiguity is not response-affecting. Concede: drop `confidence:certain`; keep the response-equivalence.
- **(b) F-MODEL-REFUSAL as an attacker-controlled routing primitive — CONCEDE.** Genuine vulnerability (Q4 applies verbatim). **Fix:** remove `REROUTE` from the refusal plan entirely. A refusal never auto-acts; it surfaces to the orchestrator/human as a judgment signal (converges with S2(d)).
- **(c) all safety on the most version-fragile layer — CONCEDE-AND-FIX, and it's the deepest point.** **Fix:** demote the classifier to **untrusted source-local advice** — the same provenance frame as worker output (Q4), not authority. Invariant: **no confident auto-action on a class the adapter could not parse.** Any parse failure/schema bump/unknown collapses to `F-VERSION-SKEW` or `F-UNKNOWN`, both of which route to loud/safe paths — so a broken classifier at a vendor bump *cannot* emit a confident wrong class. Stop citing "infrastructure logic stays in the infra layer" to justify piling brittleness into the adapter; the correct framing is "classification is untrusted advice; the *response state machine* is the trusted infrastructure."

**S2(d) (refusal/loop treat worker judgment as a liveness fault — scope leak beyond F-VERIFY-MISMATCH) — CONCEDE.**
Right, and it merges with S1-d(b). **Fix:** redraw the seam. Liveness owns process/token/disk/fence/sandbox — faults with crisp OS/HTTP signals. The instant "fault" means "the worker exercised judgment" (refusal, `F-LOOP` stagnation), it **exits the liveness domain**: refusal → surface as a decline signal (doc 14 #5); `F-LOOP` → a *health observation* the orchestrator may act on, not an adapter-issued fault. The adapter never shops vendors for compliance.

**S2(c) ("closed algebra" is rhetoric; retry-is-a-leaf doesn't bound what budget didn't) — PARTIAL DEFEND + concede.** Concede: `∘` was undefined and "algebra" oversold — it's a deterministic planner with predicates, and `RESPAWN`/`RESUME`/`BACKOFF_REQUEUE` *are* bounded retries. The cross-vendor storm the red constructs is real. But its bound was always the durable budget, and the vocabulary's actual contribution is **traceability + a lint-enforced absence of any bare-retry code path**, not a new liveness bound. **Fix:** state it plainly — "the storm is bounded by budget; the vocabulary makes the per-vendor `Retry-After` explicit and makes 'retry with no preceding classification' a lint failure." Drop "structurally impossible"; keep "structurally traceable."

**S3(b) (QUARANTINE's blast-radius is unfunded in the MVP that ships I9) — DEFEND (via isolation) + naming concession.** The red misses that MVP workers have **isolated worktrees** (one per worker). With isolation, "downstream of shared writes" is the empty set, so **single-worker `FREEZE` genuinely is bounded blast radius** — the transitive clause only bites once shared substrate exists, which §5 already defers. **Fix:** MVP primitive is `FREEZE` (self); `QUARANTINE` (transitive, doc 14 #10/#25 write-tracking) is Later. The invariant name is honest at worktree granularity; the doc just must not imply transitive containment it defers.

### Cross-cutting

**S2(a) (I9 "halt+escalate" is a liveness regression on the unattended runs baton claims to win) — CONCEDE-AND-FIX; best operational catch.** Freezing the whole fleet and escalating to a by-construction-asleep operator converts a false positive into a morning-long outage. **Fix:** I9's safe pole is per-axis **and per-scope**. A single-worker ambiguous fault → **freeze that worker, escalate that worker, let the rest run** (bounded by the worktree isolation above). `HALT_FLEET` is re-scoped to **shared-substrate faults only** (ledger disk-full, integrity drift) — never a single worker's ambiguity. Add a per-posture policy: unattended prefers park-and-continue-others over halt-all. The doc conflated worker-scope and fleet-scope safe poles; separating them keeps the unattended fleet alive on its un-ambiguous workers.

**S2(b) (the ablation is rigged — baton manufactures its own faults) — CONCEDE, methodologically.** You can't inject "kill the hub" into a soloist; half the taxonomy (`F-HUB-CRASH`, `F-ZOMBIE`, `F-ORPHAN-WT`, the fence races) is baton-created surface. **Fix:** the ablation gets two arms. Arm 1: recovery-given-a-*shared* fault (token expiry, disk full — faults both face) measures recovery value fairly. Arm 2: a **fault-probability accounting** that prices baton's *added* failure surface as a cost. The honest verdict metric is `coordination_value − added_failure_surface_expected_cost` vs soloist — the doc measured only Arm 1.

**Cheap shots.** Category-error `safe-reboot` citation — **CONCEDE**, delete it; it's an atari-homelab GPU-host rule, irrelevant to killing a worker pgid; the real constraint is just I6 verify-death-before-lease-release. Phase-is-inferred — **DEFEND-safety + concede-the-hard-discriminator-claim**: a lost `turn/completed` makes recovery read `mid_turn` and over-conservatively resume+replay, which is *wasteful, never unsafe* (I7 re-verification + fence bump prevent double-apply); phase is a fail-safe-biased inference, not a hard discriminator. Notifier races the human — **CONCEDE-minor**: make the I5 notification a *view of durable approval state re-rendered on reconnect*, not fire-and-forget; I2 already no-ops the double-answer, the fix is human-side optimistic-UI reconciliation.

### SALVAGE — the strongest surviving design

Three layers, re-weighted by the attack:

- **Layer 3 survives nearly intact** and is the load-bearing win — even the red concedes DST-of-the-whole-hub is worth building. Add the recorded-vendor-byte conformance corpus (Tier-2) so the classifier's `bytes→class` fidelity is proven where it actually lives (real CLI), not stubbed.
- **Layer 2 survives, re-described.** Recovery granularity is the **turn boundary via `resume(session_ref)`**, not lossless instruction-level adopt; `adopt`-live is a Codex-daemon optimization. Registry liveness = start-time + cookie (Darwin-correct). Reserved ledger tail for disk-full. It remains non-negotiable MVP because doc 06 Q3 ("hub outlives the orchestrator") is a headline that is false without it — and the machinery is the existing `orphaned→resume` edge plus I3, so it's days, not weeks.
- **Layer 1 shrinks and demotes.** The classifier is **untrusted advice**, not authority. MVP carries only **hard faults with crisp OS/HTTP signals** — crash, quota, auth-expiry, sandbox-deny, zombie, ledger-disk-full — each with a provenance-disambiguated class. **Soft/judgment faults (refusal, loop) leave the liveness domain entirely**: they surface to the orchestrator/Referee, never auto-act. The "algebra" is a closed response vocabulary + deterministic planner + a no-bare-retry lint, with budget named as the real storm-bound.

The salvaged spine is still **classify → respond → prove**, but honest about trust: *classify (untrusted, source-local) → respond (trusted control plane, default-safe unless the signal is crisp) → prove (control plane by DST; classifier by recorded-byte conformance).*

### INTEGRATE — planes, invariants, and the first build

**Planes.** Classification lives in the adapter (southbound), carrying the *same untrusted-provenance frame as worker output* (Q4) — a sibling rule to `adapter-contract.md`'s no-silent-emulation. The response planner lives in the supervisor (trusted control plane). I8 recovery is a strict extension of I3's ledger durability, not a new store. The DST `Env` seam wraps the hub; Tier-2 conformance runs the real adapter against recorded bytes.

**Invariants.** Promote two into `supervisor-state-machine.md` beside I1–I7: **I8 (hub crash-recovery = deterministic ledger replay + start-time/cookie reconcile + reserved-tail)** and **I9 (fail-safe defaults, per-axis and per-scope)** — with I9's `HALT_FLEET` explicitly re-scoped to shared-substrate faults so single-worker ambiguity never freezes an unattended fleet. Add the invariant **"no confident auto-action on an unparseable class."** The DST assertion catalog stays as written but its `I8_sqlite_is_cache` predicate is marked simulator-only, with the incremental-rolling-hash check as its prod counterpart.

**Build this one thing first:** the **durable process registry + ledger-replay recovery core** — start-time+cookie liveness, reserved ledger tail, `reap→resume(session_ref)` as the default path — proven by exactly **DST scenarios #4 (corrupt SQLite → rebuild-from-JSONL) and #6 (ENOSPC + torn barrier)**. Not the taxonomy, not full thousand-seed DST. Rationale: it is the only false headline claim (hub-outlives-orchestrator), it reuses I3 which already exists, and every other layer's durability assumption — the classifier's FaultEvents, the response planner's budget checks, the whole `prove` step — sits on top of a recoverable ledger. Build the recoverable ledger, prove it with its own two adversarial schedules, and the rest of the design has ground to stand on.
