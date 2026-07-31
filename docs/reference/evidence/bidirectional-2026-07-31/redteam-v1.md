UNSOUND

The direction is right, but v1 does not define one implementable contract. Its central
`checkpoint`/`checkpoint+claim` distinction is not a distinction the live pause state machine
can produce: every live pause is downstream of a completed `WorkerResult`, while restart
reconstruction drops that result. Decision callback ownership, concurrency, and failure semantics
are unspecified; exact expiry reporting is not derivable from the projected view; and the named
`run.follow` seam is not the public client seam the rule describes. These are divergent-behavior
defects, not merely missing test detail.

## R-BD-1 — P1 — Absence of `claim` is not a stable parked-working signal

- **Grounding:** `coordinator.mjs:10482-10521` sends every non-`completed` worker result to
  `_failProviderResult` before `_admitPauseRecord`; therefore the only live path that mints
  `turn.paused` has `workerResult.status === 'completed'`. The in-memory pause record retains that
  result (`coordinator.mjs:1993-2008`), but the durable `turn.paused` payload does not. Replay then
  reconstructs the still-pending pause without `workerResult`
  (`coordinator.mjs:11232-11247,11758-11771`). `pausedTurnStatus` projects neither result nor an
  origin discriminator (`coordinator.mjs:2043-2050`). Replay fail-closes the nonterminal task while
  retaining that dangling pause (`coordinator.mjs:11893-11921,12087-12104`), so the current target
  guard normally refuses it as `not_paused` before `claimTurn` could pass the reconstructed
  record's missing result as `null` (`coordinator.mjs:2107-2113,2277-2284`). Crash and watchdog
  paths do not mint another kind of park: a crash that is itself the turn terminal fails the task,
  while a crash observed after the completed pause sees `turnWasTerminal` and instead races cleanup
  without that failure transition (`coordinator.mjs:10130,10534-10565`); the watchdog only
  interrupts or kills (`coordinator.mjs:7859-7893`).
- **Failure:** BD-1's “member parked mid-work” and BD-6's claim-absent parked-WORKING member have
  no live coordinator production path. Before restart, every pending pause qualifies for the
  proposed claim; after restart, the same completed pause appears claim-absent if the implementation
  derives the field from the reconstructed record. Thus absence means “not durably reconstructed,”
  not “working,” and the RunView can advertise a checkpoint whose failed recovered task refuses
  every pause act. A crash after a pause creates a separate race: `_pausedActTargets` checks only
  that the task is still `paused`, not whether the handle is stopping/dead, so claim may enter the
  gate before cleanup or be refused after cleanup. Watchdog action never supplies a new park state.
  Two implementers can reasonably (and incompatibly) derive the bit from the live record, from the
  preceding durable completion event, or attach it to every checkpoint.
- **Minimal repair:** Define and persist an explicit pause-origin field in the `turn.paused` event,
  reconstruct it byte-for-byte, and make the projected claim derive only from that durable field.
  If parked-working is a required state, first name the event and transition that can create it;
  otherwise delete that classification and state honestly that every `turn_checkpoint` is a
  completed-result claim candidate. Pin restart, crash-after-pause, watchdog action, and
  claim-after-restart behavior, including whether recovered/terminal handles suppress the
  checkpoint projection and a typed refusal before any null-result gate call.

## R-BD-2 — P1 — The bounded summary rule can ship a prohibited prose leak

- **Grounding:** The application-local attention sanitizer NFKC-normalizes, credential-redacts,
  and then bounds text (`application.mjs:267-280`). The shared helper has safer scalar-aware byte
  capping (`messages.mjs:410-438`), while `wrapProse` gives model text its explicit
  `{provenance:'model-authored', untrusted:true}` wrapper (`messages.mjs:367-377`). Rule 1 only says
  “summary bounded (≤240 bytes, prose-wrapped untrusted)” and BD-1 checks only that it is bounded
  (`bidirectional-decisions.md:62-68,99-103`).
- **Failure:** The contract does not say whether 240 bytes bounds the text, the wrapper, or the
  serialized claim; whether redaction happens before truncation; what the exact `summary` type is;
  or which sanitizer is normative. One conforming implementation can emit a bounded string, while
  another emits a `wrapProse` object. Truncating first can prevent a credential-shaped token from
  matching the redactor, and byte slicing can split a UTF-8 scalar. Both implementations pass BD-1.
- **Minimal repair:** Pin the exact JSON shape and operation order, for example
  `summary: wrapProse(workerId, boundedAttentionText(workerResult.summary, 240))`, and state that
  240 bounds the wrapped object's `text` field. Reuse one shared sanitizer. Add credential-shaped,
  Unicode-boundary, empty-summary, provenance, and total-RunView-ceiling rows.

## R-BD-3 — P1 — `onDecision` has no callback lifecycle or complete refusal contract

- **Grounding:** The present policy is a closed field set and catches `onProgress` throws
  (`wave-driver.mjs:29-104,293-296`); v1 does not say whether `onDecision` follows that precedent.
  `run.answer` returns a new view whose `lastAction.result` carries coordinator outcomes
  (`application.mjs:11245-11264`), but a missing interaction throws
  `application_interaction_not_found` before the coordinator, while adapter delivery can throw or
  return `delivery_refused` (`coordinator.mjs:8950-9026`). The client method merely forwards the
  command (`application-client.mjs:1163-1170`). If an uncaught callback error exits the loop, the
  existing `finally` closes the wave (`wave-driver.mjs:406-411`), potentially superseding the very
  decision that was supposed to remain gated.
- **Failure:** “Callback return value” does not define sync versus awaited async callbacks,
  once-per-request deduplication, whether `undefined` is reconsidered, throw behavior, invalid
  callback returns, answer throws, or where “surfaced to the callback's caller” is represented.
  The named taxonomy is also incomplete and non-uniform: `not_found` is translated to an
  application exception, while `delivery_refused`, authorization errors, and adapter throws are
  omitted. Implementers can crash-and-close, swallow, retry on every poll, or permanently suppress
  the request while all claiming compliance.
- **Minimal repair:** Make `onDecision` explicitly async and awaited, invoke it at most once per
  `(runId, requestId)` unless a separately named retry policy applies, validate its closed return
  union, and catch callback errors as evidence while leaving the interaction attention-required.
  Define one normalized driver outcome union for application exceptions and every coordinator
  result, and record it in the returned driver evidence. A callback throw must never implicitly
  close/supersede a pending decision.

## R-BD-4 — P1 — One member can hold two decisions while the projection exposes only one

- **Grounding:** Decision admission checks request shape, drain state, duplicate request ID, and
  terminal task state, but it does not reject a worker that already has a pending decision
  (`coordinator.mjs:10695-10754`). Each admission overwrites the singular
  `handle.pendingDecisionId` (`coordinator.mjs:10749-10752`). `projectDecisionAttention` consults
  only that one ID (`application.mjs:337-357`), even though both records remain in `_pending`.
  During answer delivery the first record is `resolving` across an awaited adapter call, and its
  completion clears the handle field only if the field still names it
  (`coordinator.mjs:9011-9026,9061-9067`), so a second decision raised reentrantly can survive as
  the visible one while the first remains a separate record.
- **Failure:** Two pending requests from one buggy or reentrant adapter are admitted, but the older
  one becomes permanently invisible after the newer one resolves. The contract asks that the
  callback fire “when a member parks at a decision” without defining serialization when a second
  request arrives while the first callback or answer is in flight. A per-member dedup bit loses the
  second; parallel callbacks can answer out of order; clearing local state after the first answer
  can lose the reentrant request.
- **Minimal repair:** Either enforce one-pending-decision-per-worker at coordinator admission with
  a durable typed rejection, or replace the singular handle field with an ordered projection of
  all pending records. Then require per-member serialization, request-ID-scoped deduplication, and
  a fresh status read after every answer. Add two-pending and decision-during-answer tests.

## R-BD-5 — P1 — Exact-once expiry progress is not observable from the proposed view

- **Grounding:** Expiry emits durable `decision.expired`, transitions the task to `working`, and
  clears `pendingDecisionId` (`coordinator.mjs:9074-9103`). The attention projection includes only
  still-pending decisions (`application.mjs:337-357`). Follow reduces the coordination event to a
  generic `task.transitioned` execution change (`application.mjs:7373-7398,7492-7532`) and returns
  a cloned current view; it does not expose the interaction disposition. Answered, expired,
  superseded, and stale-discarded decisions therefore all disappear from attention. A local
  `deadlineAt` comparison is not authoritative because answer and expiry share a single-consumer
  race (`coordinator.mjs:9070-9079`).
- **Failure:** After a request disappears, the driver cannot determine whether to print “expired.”
  Printing from the local clock can falsely label a concurrently answered decision; printing on
  disappearance conflates four dispositions; printing nothing violates rule 3. Exactly-once is
  additionally undefined across driver restart/reattach and callback answer races. The simple BD-3
  expiry case can pass while production reports a false or duplicate expiry.
- **Minimal repair:** Project a bounded durable disposition/tombstone keyed by request ID, or expose
  the typed `decision.expired` change with its durable cursor through the follow result. Define the
  exactly-once scope (one driver invocation versus durable wave lifetime) and deduplicate on that
  coordinate. Test answer-at-deadline, supersede-at-deadline, reattach, and duplicate follow pages.

## R-BD-6 — P1 — Rule 5 names two incompatible follow APIs and omits loser cleanup

- **Grounding:** The low-level application operation requires exactly `{afterCursor, timeoutMs}`
  and can return on changes, backlog (`hasMore`), terminal state, or timeout
  (`application.mjs:7508-7532,7535-7607`). In contrast, the public member handle's
  `run.follow(options)` aliases the async `changes()` iterator, accepts only `{signal}`, performs
  an `inspect()` unless its last response is already an outline, and yields the current view before
  requesting a continuation (`application-client.mjs:911-949`). `status()` stores a status response,
  not that outline continuation (`application-client.mjs:860-872`). The current driver performs one
  status read per member and then a plain sleep (`wave-driver.mjs:256-286,403`).
- **Failure:** Calling `run.follow().next()` after `status()` wakes immediately on its initial
  inspection and can turn the poll loop into a spin; calling the internal `_command('run.follow',
  ...)` uses the desired cursor but is a different, uncontracted seam. A race across members also
  needs to cancel every losing long poll. Without cancellation, each loop leaves up to N-1 pending
  follows that later wake and accumulate. An unrelated-event backlog can return `hasMore` with no
  relevant changes; reusing the old cursor spins, while discarding `throughCursor` repeatedly scans
  the same page. The rule does not exclude already-terminal members, define cursor advancement on
  empty changes, or define whether `application_follow_unavailable`/cancellation is a one-time
  fallback, retry, or fatal error. “Follow disabled mid-wave” is not a modeled profile transition,
  so it cannot repair those runtime-error semantics.
- **Minimal repair:** Add or name one public one-shot API such as
  `run.followOnce({afterCursor, timeoutMs, signal})`. For each wait cycle, retain the cursor from
  that member's status, exclude terminal members, race the timer and one follow per live member,
  abort and await all losers, and advance each cursor through `follow.throughCursor` even when
  `changes` is empty. Only target changes should end the sleep early; unrelated backlog should
  continue against the remaining interval. Pin typed unavailable/cancelled behavior and one
  evidence-only downgrade per member.

## R-BD-7 — P1 — Multi-attention precedence can nudge through a gate

- **Grounding:** The RunView deliberately pushes turn checkpoints alongside independently pending
  question, approval, and decision entries (`application.mjs:7094-7109`). The current driver finds
  a checkpoint independently and nudges every paused entry (`wave-driver.mjs:134-138,282-285,
  298-355`). Rule 2 says its new extractor handles all three interaction kinds, but its progress
  taxonomy contains only `decision`, `checkpoint+claim`, `checkpoint`, and `working`
  (`bidirectional-decisions.md:69-83`).
- **Failure:** The contract gives no reduction order when one member has both an interaction and a
  checkpoint, no tie-break for multiple interactions, and no classification for question or
  approval. Merely changing the progress label does not remove the member from the independent
  `paused` steering list, so an implementation can print `decision` and still nudge the checkpoint
  in the same poll. Another can classify a first-array checkpoint and hide the decision. Both fit
  the text; one violates the promised gate.
- **Minimal repair:** Specify one ordered per-member reducer, for example pending interaction
  (`decision`/`question`/`approval`, stable request-ID order) over `checkpoint+claim` over
  `checkpoint` over `working`, and make its result control both rendering and steering. Any pending
  blocking interaction must suppress nudge and claim for that member. Either add distinct progress
  classes for question/approval or remove them from rule 2. Test interaction-plus-checkpoint and
  multiple-attention ordering.

## R-BD-8 — P1 — BD-1 through BD-6 permit production-red implementations to ship green

- **Grounding:** BD-1 checks only a live completed pause, one invented mid-work pause, a byte bound,
  and gate re-entry; BD-3 checks one callback success, one `undefined`, and one uncontended expiry;
  BD-5 checks one target wake and the statically disabled case
  (`bidirectional-decisions.md:97-119`). The MockAdapter can emit one scripted decision
  (`adapter.mjs:590-610`), but no row requires overlapping asks, adapter answer reentrancy, callback
  failure, restart reconstruction, unrelated coordination traffic, or abandoned-follow accounting.
- **Failure:** All six named rows can pass while the implementation (a) leaks credential-shaped
  summary prose, (b) drops the claim after restart yet advertises a dangling unclaimable checkpoint,
  (c) races a claim against crash cleanup, (d) loses the first of two decisions, (e) closes the wave
  on callback throw, (f) labels a concurrent answer as expiry, or (g) spins/leaks long polls on
  unrelated events. BD-3 also asks for a durable
  `decision.resolved`, while the live durable event is named `decision.settled`
  (`coordinator.mjs:9029-9033`).
- **Minimal repair:** Add a red row for each failure above, using fixed clocks plus an instrumented
  coordination wait/AbortSignal fixture. Assert active follow count returns to zero every cycle,
  cursor monotonicity on empty pages, exact durable event names, normalized refusal evidence, and
  no steering while any blocking interaction is pending.

## R-BD-9 — P2 — Two citations overstate the live seam, and scope needs a hard fence

- **Grounding:** `application.mjs:7535-7607` proves the low-level long poll but not “returns on any
  event”: unrelated events are filtered and cause a return only when backlog/terminal/timeout
  conditions apply. `application.mjs:10954-10966` is semantic-action input validation and dispatch,
  not the `run.answer` command implementation; the latter is at `application.mjs:11245-11264`.
  The sibling control-surface v2 contract expressly assigns claim/deadline projections and
  wave-driver extractors to this epic, but reserves canonical `decision.list` surfacing for S-3
  and portable wave grammar for S-1
  (`control-surface-2026-07-31/control-surface-decisions.md:43-70`). It also requires `waves.*` to
  remain embedding-only and forbids new mutation surfacing
  (`control-surface-2026-07-31/control-surface-decisions.md:96-111`).
- **Failure:** An implementer following the cited “run.follow” wording can select the wrong public
  API. Separately, “decisionList carry the same” can be read as merely extending the existing
  direct projection or as registering/promoting `decision.list`; the latter collides with S-3 and
  its registry/profile/schema migration. Promoting `onDecision` to CLI/MCP/Web would likewise
  collide with the sibling's embedding-only wave boundary. Rule 6's authority statement does not
  state these surface exclusions.
- **Minimal repair:** Correct the citations and state explicitly that v1 changes only existing
  RunView/direct-read projection plus the embedded `createWaveDriver` policy. It must not register
  `decision.list`, add aliases/profiles/surfaces, or portable-wave grammar; those remain S-3/S-1.
  If any canonical surface is desired, move it to the sibling contract with its required registry
  delta and conformance rows.

## Citation audit

- **Verified as cited:** `coordinator.mjs:2006,2046-2050,2277-2284,2502-2503,9074-9103,
  10695-10754`; `application.mjs:337-357,7102-7109`; `application-semantics.mjs:31-62`;
  `wave-driver.mjs:128-138,262-403`; `wave.mjs:107-127,316,484-486`;
  `adapter.mjs:505-610`; and `claude-session.mjs:1007-1015`. These ranges contain the named
  storage/projection, phase mapping, checkpoint extraction/poll loop, wave projection/handle,
  deterministic adapter decision, and terminal-result behaviors.
- **Verified code, overstated claim:** `application.mjs:7535-7607` has the filtering/return caveat
  in R-BD-6/R-BD-9. `application-client.mjs:911-949` proves an async inspection iterator, not the
  cursor-accepting one-shot continuation rule 5 describes. `application.mjs:10954-10966` proves
  the semantic-action path only. `application-client.mjs:1163` correctly proves the client answer
  entry point, with its body continuing through line 1170.

## Surviving sections

- The problem statement survives: the shipped driver ignores decision attention and sleeps at
  `pollIntervalMs`, while the application already carries useful sanitized decision content.
- Additive `deadlineAt` projection survives if it is derived from the authoritative numeric
  deadline, rendered as a pinned ISO value, and added consistently to the existing attention,
  semantic-action target, and direct `decisionList` projection without registering a new surface.
- Completion intent may be surfaced as untrusted gate input, never proof, and `claimTurn` must keep
  re-running the live trust gate. The claim needs a durable pause-origin source before absence can
  carry meaning.
- Embedded driver decision handling through each member's existing `run.answer` authority survives
  after callback, concurrency, refusal, and expiry semantics are closed.
- Wake-capable waiting survives as a goal, but requires a single public one-shot cursor API plus
  cancellation and cursor laws.
- Rule 6's no-authority-move boundary and the explicit non-goals survive, strengthened by the
  S-1/S-3 surface fence in R-BD-9.
- Deterministic MockAdapter/fixed-clock testing and the existing full-suite verification remain the
  right test posture once the missing adversarial rows are added.
