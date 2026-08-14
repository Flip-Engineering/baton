# Contract seed — #151 spill query kind run-horizon authorization

[attempt: 1faf10bb-21ed-41d5-8bc7-540abddb4af6 row-seeds]

Origin: `gh issue view 151` is not reachable (`gh` unauthenticated; number absent from this repo's
history). Grounded in the row brief's stated scope — "the spill query kind's auth contract (which
principals, which horizons, the refusal taxonomy)" — and in the landed spill machinery:
`worker-delivery-push-2026-08-07/contract-fold.md` D2 (the digest-cited spill lane), the closed
`context.read` port (`coordinator.mjs`), the spill materialization (`coordination-store.mjs`), and
the run-horizon authorization its sibling read kinds already enforce.

- **Date:** 2026-08-14 · **Status:** SEED (Ring-2 draft; red-first; specifies behavior, lands no code)
- **Verification HEAD:** `5ae2c7e5c93d99404d3a292e777dd30f7d2ead27`. Every `file:line` below was
  re-verified this session at this HEAD (grep/sed/Read; NUL discipline on the two NUL-bearing files).
- **Scope of the seed, in one sentence:** the `{kind:'spill', spill:'spill:sha256:<digest>'}` query on
  the closed `context.read` port is authorized against the CALLER'S RUN HORIZON — the authenticated
  stream worker's own run — with a typed refusal taxonomy, exactly as the sibling `knowledge`/`finding`
  /`board` kinds already enforce; possession of a digest is never authority.

---

## Ground truths (verified this session)

- **G1 — the read port's principal is the authenticated stream worker; the run is derived
  server-side.** `context.read` arrives on the worker's authenticated up-channel
  (`coordinator.mjs:13007-13021`); `workerId` is bound by the stream envelope
  (`:13008-13009`), never accepted from model text. The closed wire payload carries NO `runId`/`scope`
  fields — a caller-named runId/scope is a typed refusal (`:11186-11196`); `runId` is derived from the
  worker's task (`task.runId`, `:11197`).
- **G2 — the payload shape is closed: `{expectedFence: 'current', idempotencyKey, query}`.** Non-object,
  array, wrong key set, non-`'current'` fence, or an invalid `idempotencyKey` refuses `context_read_invalid`
  (`coordinator.mjs:11188-11195`). The horizon is therefore the CURRENT horizon only — no historical fence.
- **G3 — the spill query kind resolves by digest through the closed lane.** Grammar
  `^spill:sha256:[a-f0-9]{64}$` with the exact key set `{kind, spill}` (`coordinator.mjs:11318-11321`);
  unknown/outside spill → `context_not_found` (`:11326-11328`); the answer renders through the SAME
  `_renderContextRead` spill branch (`:11333-11348`), `UNTRUSTED_READ_CONTENT`-framed.
- **G4 — the spill artifact carries NO run provenance.** `materializeSpill` returns
  `{spillId, digest, bytes, body}` only (`coordination-store.mjs:13568-13572`). There is no origin-run
  field to authorize against.
- **G5 — the spill kind has NO horizon authorization, unlike every sibling kind.** `knowledge` filters
  through `_runHorizonNodeIds(runId)` (`coordinator.mjs:11247-11249`); `finding` is resolve-then-authorized
  against the horizon with `context_scope_forbidden` (`:11262-11272`); `board` checks the board→run
  binding (`:11302-11304`). The `spill` branch (`:11318-11331`) checks only grammar and existence — a
  worker holding any digest can resolve any spilled body, regardless of which run minted it.
- **G6 — the run horizon is a node set.** `_runHorizonNodeIds(runId)` (`coordinator.mjs:11673-11692`)
  = nodes with `node.runId === runId`, OR whose `taskId` is a task of the run, OR citing an event whose
  `payload.runId`/`taskId` is in the run.

## Decisions

- **D1 — the spill query is run-horizon-authorized.** A `spill:sha256:<digest>` resolves ONLY if its
  origin run is the caller's run (the run derived at G1). A known spill outside the caller's horizon
  refuses `context_scope_forbidden` — the same code the `finding`/`board` siblings throw (G5).
- **D2 — possession of a digest is never authority.** The spill handle is a lookup key, not a
  capability (the sibling doctrine at `coordinator.mjs:11262-11263`). Resolve-then-authorize: resolve
  the spill, then test its origin run against the horizon.
- **D3 — the spill artifact gains mint-time run provenance.** `materializeSpill` must return an
  origin-run identity so D1 is enforceable. The mint side (`coordination-store.mjs` `mintSpill` seam,
  `limits.mjs:86` `spill.body` enforcedAt) records the run that requested the spill.
- **D4 — the refusal taxonomy is closed and typed.** `context_read_invalid` (malformed query / wrong
  keys / wrong fence), `context_not_found` (unknown spill), `context_scope_forbidden` (known spill,
  outside the caller's run horizon). No refusal may degrade to an untyped fallback.
- **D5 — no caller-chosen horizon.** The wire never carries a runId/scope (G1 already refuses it); the
  horizon is always the caller's own derived run. `expectedFence: 'current'` stays the only accepted
  fence (G2).

## Closed refusal vocabulary

| code | condition | sibling precedent |
|---|---|---|
| `context_read_invalid` | malformed payload, wrong key set, non-`'current'` fence, bad idempotencyKey, or a smuggled runId/scope | `coordinator.mjs:11195`, `:11321` |
| `context_not_found` | well-formed spill handle, no materialized artifact | `coordinator.mjs:11327` |
| `context_scope_forbidden` | spill materializes but its origin run ≠ the caller's run | `finding`/`board` siblings, `coordinator.mjs:11266,11303` |

## Red-first acceptance pins

Every pin is RED at the verification HEAD.

- **A1 (RED) — a cross-run spill refuses `context_scope_forbidden`.** At HEAD, mint a spill in run A,
  then have a worker in run B issue `{kind:'spill', spill}` citing its digest: the spill branch
  (`coordinator.mjs:11318-11331`) resolves it with no horizon test (G5) and `materializeSpill` has no
  run to test against (G4). Pinned: cross-run resolve is impossible.
- **A2 (RED) — the spill artifact carries origin-run provenance.** `materializeSpill`
  (`coordination-store.mjs:13568-13572`) returns `{spillId, digest, bytes, body}` with no origin-run
  field today (G4). Pinned: the returned artifact names its origin run.
- **A3 (RED) — a digest alone never resolves.** Pinned as the A1 flip side under D2: the closed
  grammar (G3) stays the ONLY admission test (that leg is GREEN at HEAD), but the horizon test (A1) is
  what makes the digest insufficient.
- **A4 (RED) — only the stream-bound worker's own run is a valid horizon.** Assert through the port
  that a query carrying a runId/scope field refuses `context_read_invalid` (the `:11194` leg is GREEN
  at HEAD) AND that no spill path accepts a caller-named run (pinned — the horizon is derived, never
  caller-chosen, D5).

## Open questions

- **OQ1 — cross-run delivery by hub citation.** When the hub itself delivers a spill citation into a
  worker's run (the D2 `attention_push` overflow block cites `spill:sha256:<digest>`, and the
  digest-cited spill is the worker's recovery path), the origin run of the spill is the run that
  OVERFLOWED — which is normally the same run, but a re-drive/re-attach could differ. The fold must
  decide: strict origin-run equality, or "delivered-by-the-hub into this run" as a second admissible
  authority. This is the seed's biggest open authority question.
- **OQ2 — spill lifetime vs run lifetime.** If spills are reaped with their run, run-provenance is
  trivially satisfied (a live spill implies the same run); if spills outlive runs, the horizon check is
  the ONLY guard. The reap seam is not pinned here.
- **OQ3 — historical horizons.** `expectedFence: 'current'` is the only accepted fence (G2); the seed
  pins that a spill read never resolves against a prior fence. Confirmed as the reading of the brief's
  "which horizons" — recorded, not blocking.
- **OQ4 — the issue body for #151 was unreachable.** If the issue names additional principals (e.g. an
  orchestrator/review authority) or additional horizons, this seed under-covers; the fold should
  re-scope from the issue body.

## Cross-references

- `worker-delivery-push-2026-08-07/contract-fold.md` D2 — the digest-cited spill lane this seed
  authorizes (the overflow block's `spill:sha256:<digest>` close).
- seed-150 (this wave) — the coaching triple family's refusals ride the same `context.read` lane.
- `docs/34-knowledge-horizons.md` — the three-horizon model (task/workflow/project); the run horizon
  here is the workflow horizon.
- `limits.mjs:86` — `spill.body` 1 MiB substrate row whose `enforcedAt` names the mint seam D3 touches.

## Judgment calls

- Resolve-then-authorize (D2) mirrors the `finding` sibling's already-landed doctrine — no new
  authority invented.
- The seed treats the caller's derived run as the ONLY horizon (D5) because the wire is already closed
  against caller-named scopes (G1); the cross-run hub-delivery case is OQ1 rather than a decided
  exception, because re-drive/re-attach semantics are not settled in this wave.
- No DECISION_REQUEST issued: the brief's "which principals, which horizons, the refusal taxonomy" is
  fully answerable from the repo (G1/G2/G3/G5). The one genuinely open authority question (OQ1) is
  recorded, not blocking.
