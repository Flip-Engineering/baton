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

The final canonical full-suite count will be recorded here only after the remaining Phase 90 stream work and a fresh complete run.

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
- Interrupt ends the addressed provider turn but intentionally preserves the Run and its worktree. Whole-Run stop remains the explicit exact-reap operation.

These gaps are not hidden behind the green control tests; they define the next integrated application slices.
