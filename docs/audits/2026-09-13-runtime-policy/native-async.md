# native-async.md — OMP background-task completion visibility (2026-09-13)

Participant: `native-async` (swarm `swarm-0311a4f017915c3fc86ce6787ba6507e`).
Scope honored: normalizer/adapter/view + this doc + the three test files. Native
runtime ownership untouched.

## The incident, restated from durable evidence

A real OMP 17.4.0 parent (`deepseek/deepseek-flash`, worker w-1) delegated two native
`task` tools. Baton's wire lane recorded `tool_execution_start` and a
`tool_execution_end` whose `result.details` was the batch shape
`{projectAgentsDir, results: [], totalDurationMs, progress[], async: {state: "running",
jobId: "DetachReapReview2", type: "task"}}`. One child job failed (route unavailable),
the other completed — but the native parent could only see that through its own
harness (`agent://DetachReapReview2`). Durable normalized observations:
`/tmp/baton-shared-custody-review-20260913/state/w-1.jsonl` (raw frames were purged with
the runtime home at explicit stop; the normalized file is the surviving evidence).
One artifact in that file: the start frame carried a top-level `intent` field that the
then-known-field set flagged as unknown.

## Protocol determination (OMP 17.4.0)

Sources: the installed binary's embedded `rpc-mode`/`rpc-subagents` bundles
(`/opt/homebrew/Cellar/omp/17.4.0/bin/omp`), the protocol document
(`omp read omp://rpc.md`), and a **bounded live delegation performed by this
participant**: a real `omp --mode rpc` child, prompted to start one tiny background
task (`general` agent, job id `DoneWordAgent`, "reply DONE"), with
`set_subagent_subscription level:"events"` for evidence capture. Raw frames:
`/tmp/baton-native-async-probe-20260913/raw-frames.jsonl` (contains the child's
conversation frames — classification: probe-only, no secrets, retained for provenance).

Findings:

1. `tool_execution_update` frames exist and carry `partialResult.details.async =
   {state: "running", jobId, type: "task"}` plus the batch shape
   (`projectAgentsDir`, `results[]`, `totalDurationMs`, `progress[]`). Live: 5/5 task
   updates stayed `running` — **a terminal async state was never observed on an update
   frame**, even long after `tool_execution_end`.
2. The terminal child event is a **second `subagent_lifecycle` frame**: same
   `id`, `sessionFile`, `parentToolCallId`; `status` flips `started` → `completed`
   (observed ~5 s after `tool_execution_end`). Exact live-captured payload keys:
   `{id, index, agent, agentSource, status, detached, sessionFile, parentToolCallId}`.
   The binary's registry (`rpc-subagents.ts`) treats every non-`started` status as
   terminal. These frames are **gated**: `set_subagent_subscription`
   (`off` default | `progress` | `events`). Baton never subscribed — that is the exact
   reason the parent run saw start + tool-return and nothing else.
3. After the terminal lifecycle, the parent runs an async-delivery turn
   (`agent_end` `isTerminal: false`, per rpc.md). So a parent pause/turn-end is
   demonstrably NOT child completion evidence — matching the brief's constraint.
4. `get_subagents` / `get_subagent_messages` are native pull surfaces (registry
   snapshot; incremental transcript by `subagentId`/`sessionFile`). Baton does not poll
   them; they remain native-owned.

## What changed

- `native-subagent-observations.mjs`
  - `tool_execution_update` task frames normalize to in-flight observations
    (`asyncState`/`jobId`/`asyncType`, `batchResultCount`/`progressCount`; never
    completion). `intent` on start frames is now a known field (w-1 wire evidence).
  - New `normalizeOmpSubagentFrame`: `subagent_lifecycle` → child records keyed by
    child identity (`subagent:<id>` namespace — batch-safe: several children share one
    `parentToolCallId`), carrying `parentInvocationKey` linkage, verbatim native
    `status` (`completed`→COMPLETED, `failed`→FAILED, unknown words stay UNKNOWN) and
    the actual `sessionFile`. `subagent_progress` → in-flight child records; prompt/
    assignment/output text is never retained (presence-only unknown fields).
    `subagent_event` → null (Baton never subscribes at `events`).
- `omp-rpc.mjs`
  - Requests `set_subagent_subscription level:"progress"` (exported constant) once
    after ready, before the first turn — fire-and-forget; the control stays OMP-owned
    and an older runtime's refusal degrades to today's honest observations.
  - `tool_execution_update` added to provider-traffic frame types (evidence only).
  - Subagent frames feed `native.subagent_observed`; ordinary tools stay silent.
- `native-subagent-view.mjs`
  - Terminal child truth lands on the parent invocation as `jobTerminal
    {state, seq}` — structurally separate from `invocationOk` (a failed call may
    report a completed child and vice versa). Agents take their state from real
    native status; identity only when the wire supplied it.

## Honest limits (unknown coverage kept explicit)

- Terminal statuses other than `started`/`completed` were not observed live; `failed`
  mapping follows the binary's terminal-status rule, anything else stays UNKNOWN with
  a `subagent_status_unknown` gap.
- If an omp runtime rejects the subscription request, detached jobs remain
  `async_job_in_flight` with no terminal event — stated, not papered over.
- Child session lifetime/process ownership remain unknown; `controls: []` everywhere;
  no polling, no provider calls, no new dependencies.

## Verification

`node --test impl/test/native-subagent-observations.test.mjs
impl/test/native-subagent-view.test.mjs impl/test/omp-native-async.test.mjs` →
144 tests, 0 failures (exit 0). Root-control smoke:
`native-subagent-integration`, `omp-native-features`, `omp-control-truth`,
`swarm-native-access`, `participant-contributions`, `concurrency-policy-admission` —
all passing.
