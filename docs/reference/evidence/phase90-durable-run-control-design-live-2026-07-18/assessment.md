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

## Validation

Focused and affected regressions are green:

- Phase 64 integrated application plus Phase 90 control authority: 27/27.
- coordination store, policy invalidation, drain/close, restart recovery, and canonical order: 104/104.
- Coordinator plus Claude, Codex, Grok, Kimi Code, and GLM harness regressions: 185/185.
- semantic authority plus CLI/Web/MCP transport regressions: 82/82 before the compact projection, and the updated CLI projection suite is green at 13/13.
- updated kernel/control/timeline cluster: 93/93;
- updated integrated application and CLI cluster: 39/39;
- progressive agent-experience coverage: 11/11;
- authenticated Web/MCP transport coverage: 62/62; and
- authenticated resident/restart coverage: 34/34.

The complete suite then reached 2213/2214 and found one eager-startup compatibility regression:
an application card fixture with no admitted Run controls was required to fabricate durable control
authority. Startup now permits the all-absent/no-history compatibility case while partial authority
or durable control history still fails closed; that focused recovery/control cluster is green at
12/12. Adapter Brief/argv coverage is green at 65/65, and the combined timeline, CLI, progressive
AX, route-discovery, and Kimi-readiness cluster is green at 78/78. A new complete-suite result is
still required after the Web-stream increment lands.

The final canonical full-suite count will be recorded here only after the remaining Phase 90 stream work and a fresh complete run.

## Verification agent-experience repair (Run run-0546d3fbf747f2170f13e83915e3094d)

A real candidate_failed checkpoint exposed two agent-experience gaps. The motivating failure (private
worker log `w-22.jsonl` seq 323) was a single isolated descendant-reap timeout: `observedExit 1`,
`outputExceeded false`, `outcome candidate_failed`, `failureOwnership candidate`,
`durationMs 100072`, with an immediate root rerun passing `2225/2225`. An operator or agent should
never have to read a private worker log to understand that, and a clean rerun must never be
laundered into a clean pass.

Two coherent increments landed and are covered by focused Phase 67/Phase 69 regressions:

- **Stable, authority-bound section summary addresses.** Singleton section summary item addresses
  (`section-summary:<section>:g<goalVersion>:p<planVersion>`) are now bound to the authoritative
  Goal/Plan version instead of the coordination cursor. They stay stable across a coordination-only
  cursor advance (transport noise, audit churn) and fail closed (`application_inspect_item_invalid`)
  after an authoritative Goal/Plan version change. The cursor remains response state, not item
  identity; no cursor-suffix compatibility alias is offered, because it could not distinguish old
  semantic content from a new authority version. Attention items likewise bind to their stable
  request identity rather than a cursor-suffixed position. AX2d proves stability across cursor
  advance and staleness after a Plan version change.

- **Closed, credential-safe verification failure projection.** Ordinary Run inspection and status
  now project closed verifier mechanics so a mechanical failure is self-explanatory without a
  private log: `outcome` and `failureOwnership` reduced to the referee's closed enums,
  `expectedExit`/`observedExit`, candidate and baseline `execution` state+code selected from closed
  enums, `outputExceeded`, `outputTailBytes`/`outputTailDigest` plus a `tailWindowSaturated` flag,
  bounded `durationMs`, validated `runtimeDigest`/verdict digest, and an `attemptOrdinal`. The raw
  `observedOutputTail` and the free-form verifier `note` are deliberately excluded — the tail may
  persist repository secrets and the note is not a closed enum; captured output is reduced to a
  bounded-tail byte count and digest. A secret-bearing verifier fixture (VR9) proves the generated
  secret never reaches outline, section, evidence, status, or the application-projected receipts.

Two related invariants are documented as remaining rather than approximated, because their durable
state machine lives outside this increment's seven-file scope:

- **Candidate-confirmation retry for an initial `candidate_failed` checkpoint.** The intended
  boundary change is a real Phase 69 invariant, not a broadened outcome gate: pin the non-adoptable
  exact checkpoint; record `originOutcome=candidate_failed` on the durable retry record; admit
  exactly one operator-authorized confirmation across restart/response loss with the same
  Plan/command/base/runtime/checkpoint binding and no provider turn; consume the single shot even if
  the retry lands inconclusive; retain both attempt records; and mark a later pass
  `passed_after_candidate_failure`/unstable, never laundering it into a clean pass. Enforcing this
  durably requires changes in `coordination-store.mjs` (origin outcome on the durable record plus
  one-shot admission across the inconclusive-completion corner), `coordinator.mjs`, and `referee.mjs`
  (verdict relabel), which are outside this scope. The application `retryProjection` therefore still
  offers retry only for `inconclusive` outcomes; broadening it alone would violate the no-laundering
  invariant and was intentionally not done.

- **Operational-log raw-output sanitization.** The closed projection guarantees the ordinary
  application surface never carries the raw captured output tail, but the durable worker log and
  coordination artifacts still persist the full verdict (including `observedOutputTail`) as written
  by `referee.mjs`. Replacing that durable storage with captured-output digest and byte metadata, or
  moving raw diagnostics behind a distinct protected authority, is a `referee.mjs`/`coordinator.mjs`
  change outside this scope and is tracked here rather than claimed as receipt safety.

## Honest remaining gaps

- `run.follow` remains an advanced compatibility feed, while the new Run streams are progressive
  inspection chapters. A Run-bound authenticated Web/SSE ticket and browser rendering still need
  to replace the repository-wide operator stream for ordinary live observation.
- The application-level outline returned over Web/MCP is still more detailed than the compact CLI presentation; cross-surface progressive rendering remains a convergence task.
- Read-only/research/review objectives need explicit intent/effect authority so a valid no-edit result is not rejected as `required_effect_absent`.
- Pre-Phase-90 operational history needs an explicit one-time deterministic mapping policy; Baton
  does not invent historical cross-worker order from timestamps.
- Opaque `runs.list` pagination, browser migration, crash-supervisor takeover, and populated
  `knowledge` / `capabilities` chapters remain open.
- Semantic interrupt currently checkpoints the worktree but terminalizes a one-member Run as
  `cancelled`; Baton cannot yet start a successor turn on the preserved provider session through the
  ordinary Run surface. This contradicts the intended reusable-session contract. Whole-Run stop
  remains the explicit exact-reap operation and was verified separately.

These gaps are not hidden behind the green control tests; they define the next integrated application slices.
