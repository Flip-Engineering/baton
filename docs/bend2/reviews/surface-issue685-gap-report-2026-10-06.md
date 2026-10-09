> Audit record by `audit-surface`, committed 2026-10-06 from the author's worktree. The gap list G1–G6 below is the surface-side acceptance target for the #685 repair. The author's original file `surface-issue685-gap-report.md` remains uncommitted in its worktree.

# audit-surface: #685 surface review — status/players/orchestra/inbox vs the issue invariant

Read-only review via the dev-prefix CLI against orchestra.db, using the validator census (.scratch/recovery-coordination-20261006/deepseek/stranded-notification-census.json; 35 sessions, 4,233 unacknowledged). Required facts per seat: F1 pending input, F2 actual receive ownership, F3 wake obligation, F4 blocking evidence. Read-only; no edits/builds/fanout.

## Seat findings (census class → surfaces)

### 1. Live receiver + pending input — semantic-controls-next (17 pending, codex)
- status --pretty: F1 ✓ (`"pending": 17`); F2 ✗ (no execution/receiver fields in status); F3 ✗ (nothing says the live receiver is mid-wake); F4 ✗ (nothing blocked — correct here, but absence is indistinguishable from omission).
- players: F1 ✓ (`pendingCount: 17`); F2 PARTIAL — `"execution": {"attempt": "receive:semantic-controls-next:12578:…", "mode": "retained", "phase": "running"}` implies a live receiver but no field states it; F3 ✗; F4 ✗.
- orchestra: identity/role/hierarchy only — F1–F4 all absent from the seat entry.
- inbox: F1 ✓ — 17 exact rows (oldest `remind-semantic-controls-next`, newest `synthesis276-native-operation-spec-controls`, kind guidance).

### 2. Stopped seat naming a successor — audit-kimi (196 pending, stop_id root-quota-continuation-stop-audit-kimi)
- status --pretty: F1 ✓ (196); F4 PARTIAL — `"stop": {"id": …, "reason": "K3 subscription quota exhausted; assignment superseded by native-receive-conductor. …", "status": "stopped"}`. The successor (native-receive-conductor) is only prose inside `reason`, not a field; F2 ✗ (no executions shown; the retained attempt receive:audit-kimi:1119 is exited); F3 ✗ (no continuation-scheduled field).
- players: F1 ✓ (pendingCount 196); F2 PARTIAL (execution receive:audit-kimi:1119 exited/exit 0); F4 ✗ — players has NO stop block at all.
- orchestra: identity only; stop and pending absent.
- inbox: F1 ✓ — 196 rows retained.

### 3. Woken after newest pending — semantic-impl-codec (5 pending; execution receive:semantic-impl-codec:13435 exited exit 0)
- status --pretty: F1 ✓ (5); F2 ✗; F3 ✗ — the core defect: the wake that triggered seq 13435 already completed (players shows the receive exited 0) yet 5 messages remain pending, and NO surface says whether another wake is owed, running, or refused.
- players: F1 ✓ (5); F2 PARTIAL (exited receive attempt visible); F3 ✗; **MISLEADING combination**: `execution.status: "exit 0"` next to `pendingCount: 5` reads as complete while pending input remains.
- orchestra: identity only. inbox: F1 ✓ — 5 rows.

### 4. Never-woken with pending input — semantic-impl-native (31 pending, muse, no receiver path)
- status --pretty: F1 ✓ (31); F2 ✓-by-absence (endpoint "" — no receiver registered; muse has no receiver path per stop.bend's omp/codex-only admission, but NO surface states that limitation); F3 ✗ (no scheduled/owed wake field); F4 ✗ (no actionable blocked state; the currently RUNNING direct turn `semantic-impl-native-root-retained-native-turn-20261006` (phase starting) is not shown in status at all).
- players: F1 ✓ (31); F2 ✓ (execution direct/starting — process verified live, PID 16879); F3 ✗; F4 ✗.
- orchestra: identity only. inbox: F1 ✓ — 31 rows.

### 5. Harness without receiver path — audit-evidence (muse, 1 pending) and recovery-muse-20261006
- audit-evidence: status F1 ✓ (1); players F1 ✓ and F2 ✓ (execution `issue685-evidence-muse-turn-5` direct/starting — live process verified, PID 20030: root's repair dispatched it mid-review); F3/F4 ✗. orchestra: identity only. inbox: 1 ✓.
- recovery-muse-20261006: census said 2 pending/never-woken; NOW status pending 0, inbox 0, players execution `recovery-muse-20261006-delivery-1` exited 0 — its pending input was handled between census and review. Demonstrates pending counts move and surfaces keep no history of the transition.

## Cross-cutting gap list (surface-side acceptance target)

- **G1 — receive ownership not exposed**: no field in any of the four surfaces states live-receiver/ownership; only `players.execution` implies it (retained receive attempt running) and status/orchestra/inbox omit it entirely.
- **G2 — wake obligation not exposed**: no surface shows an owed/scheduled wake, a wake-after-newest-pending state (class 3: exited receive + 5 pending), or a never-woken state (class 4); `newest_triggering_receive`-style facts exist only in external census tooling.
- **G3 — blocking evidence incomplete and uneven**: stop blocks appear only in status --pretty, only for stopped seats; successor/continuation owner is prose inside `reason`, not a structured field; provider failures, capacity refusals and missing-receiver support (muse) expose no actionable blocked state at all.
- **G4 — surface normalization**: status --pretty omits executions; players omits endpoint/stop; orchestra seat entries carry no operational facts; inbox is exact for F1 only. The four surfaces must expose the same four facts consistently.
- **G5 — misleading completion combination**: players `execution: exited, exit 0` alongside `pendingCount > 0` (class 3) presents as done while input remains.
- **G6 — attempt-bound status required**: `starting`/`running` executions rows must be bound to exact attempts (verified live here: PIDs 16879/20030 for `semantic-impl-native-root-retained-native-turn-20261006` and `issue685-evidence-muse-turn-5`) rather than inferred by recency; surfaces should show the attempt id with the phase.

## Could not determine

Whether the two live turns (audit-evidence, semantic-impl-native) will complete — they were running at review time with no provider/receiver observed. Why recovery-muse-20261006's census-pending 2 reached 0 (its delivery exited 0; the transition history is not retained by any surface). Census-vs-surface pending drift for growing seats (semantic-impl-native 27→31) is real movement, not a surface defect.

Verdict: the four surfaces today satisfy F1 (status/players/inbox) and partially F2 (players execution only); F3 and F4 are absent except the status-only stop block. The gap list above is the surface-side acceptance target for the #685 repair.
