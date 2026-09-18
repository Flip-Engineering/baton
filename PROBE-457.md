# PROBE-457 — the seat's DEFAULT `swarm.view` on a large swarm

Seat `probe-457`, swarm `swarm-primary-20260918`, over the native bridge
(`node "$BATON_SWARM_CLIENT"`). Issue #457: an over-bound DEFAULT read answers
narrowed, never refused. No source or test file was touched.

Observed 2026-09-18 against the served bridge. Every number below is the one the
bridge answered in that call; byte lengths are the length of the raw stdout the
client printed, which is the answer document itself (the client unwraps the
envelope, so these payloads carry no `ok`/`result` wrapper key).

## 1. `swarm.view` (NO arguments — the seat default)

```json
{
  "exitCode": 0,
  "outcome": "answer (no refusal)",
  "topLevelKeys": ["swarmId","purpose","status","closedReason","actor","seq","ts","baseCommit","policy","caller","availableActions","admission","actionTargets","updates","deployment","cursor","projection","contributions","reviews","narrowed"],
  "projection": "contributions",
  "narrowed": {"from":"full","to":"contributions","reason":"bridge-frame"},
  "participantRows": 0,
  "contributionRows": 39,
  "reviewKeys": 32,
  "cursor": 175292,
  "page": null,
  "bytes": 339218
}
```

`participantRows: 0` is exact in the sense that matters here: the answer carries
**no `participants` key at all**, so the participants family is absent from the
narrowed answer rather than paged.

## 2. `swarm.view '{"projection":"participants"}'`

```json
{
  "exitCode": 0,
  "outcome": "answer (no refusal)",
  "projection": "participants",
  "narrowed": null,
  "participantRows": 6,
  "participantIds": ["omp-429","omp-360","omp-316","omp-drift","muse-411","muse-406"],
  "page": {"cursor":null,"next":"swarm-page:full:6","total":36,"served":6,"ceiling":{"lane":"wire.frame","class":"substrate","value":1048576,"unit":"bytes"}},
  "cursor": 175304,
  "bytes": 664761
}
```

A `page` field **is** present, verbatim as above: `total` 36 participants,
`served` 6, `next` `swarm-page:full:6`.

## 3. `swarm.view '{"projection":"contributions"}'`

```json
{
  "exitCode": 0,
  "outcome": "answer (no refusal)",
  "projection": "contributions",
  "narrowed": null,
  "contributionRows": 39,
  "reviewKeys": 32,
  "page": null,
  "cursor": 175308,
  "bytes": 339121
}
```

No `page` field: 39 contribution rows fit the frame un-paged.

## 4. `swarm.view '{"projection":"full"}'` — EXPLICIT over-size request

```json
{
  "exitCode": 1,
  "outcome": "refusal",
  "code": "swarm_bridge_frame_exceeded",
  "message": "Nothing was recorded: ask again with projection: contributions (285167 bytes fits wire.frame/substrate 1048576 bytes; measured candidates: contributions, attention, context, guidance, knowledge, outline)\nwire.frame is 3276454 bytes (cap 1048576); resend within the 1048576-byte cap",
  "detail": {"lane":"wire.frame","class":"substrate","value":1048576,"unit":"bytes","actual":3276454,"direction":"response","rule":"bridge-frame","requested":"full","fits":"contributions","fitsBytes":285167,"measured":["contributions","attention","context","guidance","knowledge","outline"],"resourceReason":"the bridge buffers exactly one JSON frame per direction in process memory; the shared wire.frame substrate row bounds that buffer, it is not a worker cap"}
}
```

The refusal's `detail.fits` names the projection the caller should ask for
(`"contributions"`), with its measured size in `detail.fitsBytes` (285167) and
the full candidate list in `detail.measured`. `detail.actual` names what the
explicit `full` answer would have cost (3276454 bytes) against the
`wire.frame/substrate` ceiling of 1048576.

## What the four records say together

- The default (step 1) is answered, not refused: the bridge substitutes
  `projection: contributions` and says so in `narrowed`
  (`{"from":"full","to":"contributions","reason":"bridge-frame"}`). The seat's
  first read returns something usable on a swarm of this size.
- The narrowing is a substitution of the *default*, not of an explicit request:
  the same over-size content asked for by name (step 4) is **refused** typed
  `swarm_bridge_frame_exceeded`, with the fitting projection named in detail.
- The two projected families page differently at this swarm size. `participants`
  (step 2) is sliced — 6 of 36 rows, with a `page` cursor to continue from.
  `contributions` (step 3) fits whole: 39 rows, no `page`.
- The default answer (step 1) is the `contributions` slice byte-for-byte in
  substance (339218 vs 339121 bytes; the small delta is the `narrowed` block and
  key order) — so a seat that wants participants on this swarm must ask for
  `participants` explicitly; the default does not carry them.
