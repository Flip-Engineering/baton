# Phase 90 durable Run control assessment

## Outcome

Phase 90 closes the first integrated resident-control and Run-timeline vertical. Ordinary callers can now use `Run.send()` / `Run.interrupt()` or `baton run send` / `baton run interrupt` with a semantic recipient such as `work` or a Workflow role. Baton resolves the current worker, task, fence, and role generation internally, binds that resolution to a durable control identity, and never accepts those private coordinates from the ordinary caller.

The control lifecycle is first-class coordination authority:

1. `run.control_admitted`
2. `run.control_effect_started`
3. `run.control_provider_acked`
4. `run.control_settled`

Recovery may safely execute an admitted control that never crossed the provider boundary, settle a provider acknowledgement without redelivery, or expose `outcome_unknown` after an effect-start boundary that cannot be reconciled. It never silently repeats an uncertain provider effect.

The existing execution chapter now owns stable `execution:progress`, `execution:events`, and
`execution:output` items. Pythonic `run.progress()`, `run.events()`, and `run.output()` and concise
`baton run progress|events|output` facades compile through `run.inspect`; callers do not supply
event cursors, page sizes, wait durations, worker coordinates, or response ceilings. The
rebuildable timeline assigns contiguous per-Run positions in coordination order, verifies mapped
operational digests, excludes sibling Runs, and labels opt-in provider prose
`contentTrust: untrusted_provider`. Opaque content cursors bind Run, channel, recipient filter, and
the exact durable prefix, including UTF-8-safe resume within large provider messages.

## Baton-on-Baton design review

The design runner dispatched two reviewers concurrently through Baton against one bounded effective-tree export:

- GLM: exact requested and resolved `glm/glm-5.2/xhigh`, Run `run-0de05d978c65c7b99f833e96b4e8bc86`, mechanically verified result `014071faf6a03c374ee4655ee86207c3ed3c2ab2`.
- Codex: exact requested and resolved `codex/gpt-5.6-sol/high`, Run `run-5f52c11615a53aeb26b9c4f0797abcfb`, mechanically verified result `910b4f2cd48f45ee7f7bb4b4dd99e16e2a308538`.

Provider-native model observation was retained where available; provider-native harness and effort observation remained unavailable and was not fabricated. The runner closed with zero workers and worktrees. The reports independently converged on a semantic `run.act` path, a durable admit/effect/ack/settle boundary, server-side recipient resolution, and progressive Run-level observation rather than another raw worker-control command family.

## Resident CLI dogfood

The implementation was then exercised through the zero-assembly authenticated resident:

- Run `run-82306b4ca44078cf3bac3a2cb8aacc81` proved that the first live `run.send` traversed coordination sequences 398-401 and settled confirmed. It also exposed two unrelated AX failures: routine mutations printed the entire internal RunView, and a read-only review objective was compiled with a mandatory repository-edit effect.
- Run `run-86b8d809a8c5fca5a7da0b29fe462bf5` exercised the repaired ordinary surface using exact `codex/gpt-5.6-sol/low`. `run.send` traversed sequences 437-440 and settled confirmed with the semantic recipient `work`; no caller-supplied worker ID or fence was used. `run.interrupt` traversed sequences 445, 446, 452, and 453 and settled confirmed. A subsequent whole-Run stop completed at sequence 464 with `targetCount:1`, `remainingCount:0`, `killConfirmed:1`, `processesObserved:1`, `processesClosed:1`, and `runAuthorityReleased:true`; receipt digest `3b7a59912d362daeec67e575affcb999b082ceda2f4adf32df133754630326b8`.

After shutdown, `git worktree list` contained only the main checkout and `.baton/capacity/reservations.json` contained an empty reservation set.

## Agent-experience repair driven by dogfood

Routine CLI mutations now project a compact machine-readable Run outline. They preserve objective, phase, current progress, exact requested/resolved/observed route, attention, action outcome, next actions, and a progressive inspection command while omitting internal budgets, ceilings, task IDs, worker IDs, fences, policy attestations, full lifecycle chapters, and storage details.

`baton run show RUN_ID` is compact by default. The same command now accepts the existing cascade directly:

```text
baton run show RUN_ID --depth index
baton run show RUN_ID --depth section --section SECTION
baton run show RUN_ID --depth item --section SECTION --item ITEM
baton run show RUN_ID --depth content --section context --item ITEM --offset N
baton run show RUN_ID --depth evidence --section SECTION --item ITEM
```

This is a presentation projection only. Authenticated application, Web, MCP, and Pythonic callers retain the exact authoritative objects and the same command bus.

## Stream dogfood and route-readiness feedback

The new surface was exercised through the same zero-assembly authenticated resident while the
implementation tests ran concurrently:

- exact native Kimi Code `kimi-code/kimi-code/k3@max` was selected for
  `run-phase90-kimi-stream-dogfood`; the provider refused with `authentication_required` because
  the current local subscription metadata is a rejected-refresh tombstone. Baton stop then
  reported zero remaining ownership. This exposed a discovery bug: file presence was advertising
  the route even though the bounded authentication reader had already classified it as revoked.
  Local route discovery now reuses that authentication authority and will not advertise a
  tombstoned Kimi route as ready.
- exact Codex `codex/gpt-5.6-sol@high` was then selected for
  `run-phase90-codex-stream-dogfood`. `baton run output ... --follow` immediately replayed and
  followed attributed provider messages with no worker, task, fence, process, or opaque cursor in
  the CLI projection. The dogfood review ran in its isolated Baton worktree while foreground test
  clusters continued.

The first live stop projection also exposed that actual receipts nest reap facts under `counts`
and authority facts under `checks`; the safe timeline now retains `remainingCount`,
`killConfirmed`, `processesObserved`, `processesClosed`, `dispatchClosed`,
`interactionsResolved`, and `runAuthorityReleased`. A terminal caught-up timeline no longer
advertises a meaningless continuation.

A later Baton-on-Baton Web-stream Run (`run-f35e76514cd2c258c1182ac31f4d681f`) exposed three more
application frictions rather than hiding them behind the provider:

- the resident-loaded Brief rendered only verification `command` and dropped structured `arguments`,
  so a verifier contract of executable `npm` plus `['test', '--prefix', 'impl']` told the worker to
  run bare `npm`. One shared provider-facing renderer now presents executable, ordered JSON argv,
  working directory, execution mode, and expected exit across Codex, Claude, Claude-via-Kimi,
  GLM, Grok, and native Kimi;
- `--follow` and `--wait 30s` raced the individual Web request's own 30-second timeout even after
  command reconciliation had been enlarged. Per-command transport timing now adds bounded slack to
  the server-owned wait; a restarted resident sustained output following beyond the former cutoff;
  and
- semantic interrupt confirmed the provider stop and checkpointed the dirty effective tree at
  `refs/baton/checkpoints/5cbd9b79e5c97e7e8e86f4ae752090167b2fcbfb`, but it also terminalized
  the one-member Run as `cancelled`. Whole-Run stop then proved zero ownership and exact reap. The
  checkpoint behavior is correct; successor-turn/session semantics are not yet correct.

## Independent Web-stream red audit

The authenticated Run-bound SSE surface was subsequently red-tested independently. Two data-loss
defects were reproduced and fixed:

- an events/output page could place its candidate `id:` on the wire before a false backpressure
  result was handled, and a lag frame could repeat that undelivered candidate cursor. Run page
  writes now stage the event body before committing `id:`; page state advances only after both
  writes are accepted, and lag/shutdown provenance names only the last committed durable cursor;
- the first progress read after a supplied older cursor initialized its digest baseline from the
  current view and silently advanced without emitting the accumulated state. Resume now emits the
  current closed progress projection whenever the durable view cursor is newer than the supplied
  cursor.

Snapshot, progress, events, and output now have distinct closed wire projections. Recursive
whitelisting removes unknown, authority, session, credential, and token-shaped object fields;
provider output is admitted only through its explicit untrusted text/fragment/digest schema. Every
Run frame binds a SHA-256 payload digest to its exact `run.inspect` repository/Run/channel/view
cursor/channel cursor/recipient coordinate. The browser recomputes that digest and validates the
closed frame, source coordinate, scope, trust labels, channel payload, and SSE id agreement before
retaining a cursor. Executed browser behavior also proves that switching Runs clears prior output
consent and re-enables the per-Run output opt-in control; a failed output connection rolls consent
back instead of leaving the control unusable.

## Validation

Focused and affected regressions are green:

- Phase 64 integrated application plus Phase 90 control authority: 27/27.
- coordination store, policy invalidation, drain/close, restart recovery, and canonical order: 104/104.
- Coordinator plus Claude, Codex, Grok, Kimi Code, and GLM harness regressions: 185/185.
- semantic authority plus CLI/Web/MCP transport regressions: 82/82 before the compact projection, and the updated CLI projection suite is green at 13/13.
- updated kernel/control/timeline cluster: 93/93;
- updated integrated application and CLI cluster: 39/39;
- progressive agent-experience coverage: 11/11;
- authenticated Web/MCP transport coverage: 62/62;
- authenticated resident/restart coverage: 34/34; and
- scoped Phase 12 Web stream/operator red coverage after the independent audit: 31/31, including
  executed browser validation and Run-switch behavior.

The complete suite then reached 2213/2214 and found one eager-startup compatibility regression:
an application card fixture with no admitted Run controls was required to fabricate durable control
authority. Startup now permits the all-absent/no-history compatibility case while partial authority
or durable control history still fails closed; that focused recovery/control cluster is green at
12/12. Adapter Brief/argv coverage is green at 65/65, and the combined timeline, CLI, progressive
AX, route-discovery, and Kimi-readiness cluster is green at 78/78. After the Web-stream and durable
candidate-confirmation increments, the exact deployment verification `npm test --prefix impl`
completed with exit code 0: 2239/2239 tests passed with no failures, cancellations, skips, or
todos.

## Verification agent-experience repair (Run run-0546d3fbf747f2170f13e83915e3094d)

A real `candidate_failed` checkpoint exposed two agent-experience gaps. The motivating private
worker-log receipt was a single isolated descendant-reap timeout: `observedExit 1`,
`outputExceeded false`, `outcome candidate_failed`, `failureOwnership candidate`, and
`durationMs 100072`, while an immediate root rerun passed `2225/2225`. An operator or agent should
not need a private worker log to understand that, and a clean rerun must never rewrite the original
failure into a clean pass.

Three coherent increments landed with focused coordinator and Phase 69 regressions:

- **Stable, authority-bound section summary addresses.** Singleton summary addresses now use
  `section-summary:<section>:g<goalVersion>:p<planVersion>` instead of the coordination cursor.
  They remain stable across coordination-only audit churn, while a differently versioned selector
  refuses closed as `application_inspect_item_invalid`. No cursor-suffix compatibility alias maps
  old semantic content onto current authority. Attention items likewise prefer their request
  identity instead of a cursor-suffixed position.
- **Closed verifier receipt at rest.** Ordinary Run inspection and status expose
  enum-checked outcome, failure ownership, expected/observed exit, candidate and baseline execution
  state/code, `outputExceeded`, exact `capturedOutputBytes`/`capturedOutputDigest`, a closed
  diagnostic code, bounded duration, validated runtime/verdict digests, and attempt ordinal. The
  coordinator closes even an injected referee result before task, worker-log, coordination, or
  artifact persistence; output-derived identity lists become count/digest pairs. Raw tails, notes,
  argv/cwd/environment echoes, worker/session IDs, and free-form provider output are not verdict
  fields. The credential-canary test now recursively scans the actual persisted worker and
  coordination stores, including artifact manifests, and proves the verifier-only secret is absent;
  this replaces the earlier application-only test that misleadingly claimed receipt coverage.
- **One-shot candidate confirmation.** An initial `candidate_failed` result pins its exact
  non-adoptable checkpoint with `originOutcome=candidate_failed`. The reason-only
  `retry_verification` action durably admits exactly one confirmation across concurrency, restart,
  and response loss, binds the same Plan, command, base, runtime, toolchain, candidate SHA/ref, and
  consumes no provider turn. Passed, candidate-failed, and inconclusive outcomes all consume the
  shot; later failure/inconclusiveness is final. A pass accepts only the original SHA and records
  `stability=passed_after_candidate_failure` / `mechanically_verified_unstable`. Both attempts and
  the original counterexample remain; route learning retains the original loss, and restart,
  artifacts, evidence, and integration retain the instability label. Inconclusive-origin runtime
  repair remains a separate repeatable path using the current deployment runtime.

## Concurrent root-suite authority incident

An in-place root full suite was run concurrently with a live Baton Run and changed the effective
tree beneath that Run. The coordinator correctly invalidated the worker as
`worker_worktree_authority_lost`. This is recorded as an operator/test-isolation incident only; this
increment does not broaden into repairing it. No separate in-place root suite was run during the
candidate-confirmation provider turn; only scoped tests and the Brief's final deployment command
belong to this work.

## Honest remaining gaps

- `run.follow` remains an advanced compatibility feed. Ordinary browser observation now uses the
  Run-bound progress/events/output streams; the repository-wide stream remains explicitly
  separated under Advanced rather than serving as Run activity.
- The application-level outline returned over Web/MCP is still more detailed than the compact CLI presentation; cross-surface progressive rendering remains a convergence task.
- Read-only/research/review objectives need explicit intent/effect authority so a valid no-edit result is not rejected as `required_effect_absent`.
- Pre-Phase-90 operational history needs an explicit one-time deterministic mapping policy; Baton
  does not invent historical cross-worker order from timestamps.
- Opaque `runs.list` pagination, crash-supervisor takeover, and populated
  `knowledge` / `capabilities` chapters remain open.
- Semantic interrupt currently checkpoints the worktree but terminalizes a one-member Run as
  `cancelled`; Baton cannot yet start a successor turn on the preserved provider session through the
  ordinary Run surface. This contradicts the intended reusable-session contract. Whole-Run stop
  remains the explicit exact-reap operation and was verified separately.

These gaps are not hidden behind the green control tests; they define the next integrated application slices.
