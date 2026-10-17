# Revision brief: 31-b steering-acts contract (v1 → v2)

Every finding MUST be resolved or explicitly rebutted with file:line evidence. SHARED DECISIONS
(pinned by the orchestrator — do not deviate; 31-a is told the same):

- **Key space**: `_pausedTurns` keyed `pause:${task.id}:${seq}` (31-a's), reused unmodified.
- **story.mjs**: 31-a's TURN_PAUSED status `'paused'` wins (with its fold-set fix); 31-b's
  "worker goes idle, nothing new in story.mjs" is REJECTED.
- **Attention**: `'paused'` → `'turn_checkpoint'` in wave.mjs:78-88 (31-b's); 31-a's null pin
  is superseded.
- **coordination-store.mjs:10630/:10637**: the `paused` mapping edit lives in 31-a. 31-b's
  rule-14 `node?.state === 'paused'` branches stay (they become live once 31-a lands).

## P0-1 — wait/wedge contradiction

Rule 1 (second act on a resolved record → already_resolved) + rule 6 (wait "consumes" the
record but later acts stay legal) cannot both hold; and under either reading the task wedges
permanently (no new pause can ever mint). FIX: **wait never consumes** — it appends a receipt
(`turn.wait_noted {pauseId, actor}`), the record stays `pending`, ALL later acts remain legal.
Rewrite the Part G wait test to prove: wait → nudge succeeds; wait → claim succeeds; wait →
wait is idempotent receipt.

## P0-2 — claim cannot run the gate "against changedPathsDigest"

The trust gate consumes LIVE `_worktrees.capture()` products (captured.sha, changedPaths
array, baseSha; coordinator.mjs:10242-10255) — a digest of committed-only paths fits none of
its inputs. FIX: state explicitly that `claim` RE-RUNS the live capture at claim time (gate
"unchanged in content" per docs/35 §3); `changedPathsDigest` serves attention/classification
only. The Part G claim test asserts the same verdict shape on the same tree as a claim-path
completion, not a digest comparison.

## P1-3 — paused renders as 'running' (the real site)

coordination-store.mjs:10629-10631 maps any live non-terminal task status to `'dispatched'`
→ all three phase ternaries (application.mjs:4986/:6382/:6675) fall to `'running'`. The
rule-14 branches are dead code until 31-a's :10630 edit lands. FIX: name :10630 AND the
workflow attempt-state equivalent as cross-contract dependencies on 31-a (do not duplicate
the edit); red-test all three ternaries AFTER 31-a's edit is present (integration note: this
red test runs against the 31-a-landed tree).

## P1-4 — nudge's "exact bundle" omits the admission machinery (double-admit path)

`_deliverFollowUp` also does `_admitProviderTurn` (:6234, governance/reserve gate
:2506-2560), queues synchronously-emitted adapter events (`handle.turnAdmission` :6252-6253,
drained :6310), sets handle/task status working (:6296-6299), and clears turnTerminalObserved
(:6300). A bare bumpTurn nudge double-admits a native adapter's synchronous turn_started and
never re-arms the watchdog (`_armWatchdog` no-ops unless handle.status==='working' :7403;
`_clearWatchdog` increments generation regardless :7396 — the specified red test passes
vacuously). FIX: specify the FULL sequence (reserve → provider-turn admission + event queue →
delivery → claim invalidation → bump → task/handle status to working with _coordTransition
parity (:8463-8466) → clearBudgetStop/resetWatchdog → `turn_started` append carrying pauseId
→ drain queue); the red test asserts `handle.watchdogTimer != null` AND
`handle/task.status === 'working'`.

## P1-5 — over-invalidation

docs/35 §2.2(6) names SCRATCH claims only. Rule 5's board-claim expiry is wrong twice: board
claims CAS on the BOARD fence, never the turn fence (coordinator.mjs:9193-9201) — the set is
empty by construction, and expiring them anyway kills valid claims on a continuing worker
(:10200-10201 fires only on death/failure). Also expiry-before-admission: if admission then
throws, claims stay expired with no turn admitted (rollback ordering undefined). FIX:
scratch-only, FENCE-FILTERED expiry (claim records carry `fence` :9131 — expire only claims
CAS'd on a fence that predates the pause); expiry happens only AFTER successful turn
admission, inside the same reservation rollback boundary.

## P2s

- Rule 10's "re-arms on turn_completed" is backwards: the handler CLEARS (:9899); re-arm
  happens at admission.
- story.mjs: :617-620 IS a verdict-based statusPhrase override; the map is LEGAL_TRANSITIONS
  (:220-232).
- Rule 13: :8707's allowlist is ANDed with validText(attention.requestId) (:8708) —
  turn_checkpoint entries need a requestId-shaped pauseId or the rule must carve it out.
- MCP nudge enums also at mcp-northbound.mjs:298 and :345 (not just :293/:392/:689).
- Part G "no `settle` survives a repo-wide grep" is unwritable — 31-a lands turn.settled /
  TURN_SETTLED legitimately. Rephrase to: no wave.settle-colliding ACT NAME.
- Rule 9's "re-parked outcome" is undefined — define it or cut it.
- Rule 16 (new MCP verb) vs rule 13 ("no separate raw control surface") — pick one routing
  and say why.

Grounding citations verified accurate (keep): _resolveRecord reservation shape, bare-lane
stamp semantics (fence.mjs:22-26, coordinator.mjs:6034), :7408 verbatim, expiry mirrors
:7045-7066/:10200-10201, phase ternary sites, :8707 allowlist location.
