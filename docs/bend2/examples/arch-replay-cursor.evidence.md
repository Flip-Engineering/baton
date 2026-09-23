# arch-replay-cursor — the cursor and restart differential corpus

## Claim

One frozen trace, opened live, reopened behind a projection checkpoint, and reopened under a changed
or absent authority, decides the same required logical behaviour in a pure Bend2 model and in the
branch's own coordination store: the projection a consumer resumes from and the rows that consumer is
still owed survive the restart, and a checkpoint written under one authority is rebuilt from the
ledger rather than trusted when the next open supplies another.

This corpus continues the test of one correction of the external architecture review: startup, doctor
and recovery must use one recorded policy basis, and a basis that changed is classified as its own
cause rather than reported as corruption (ARCH-CLOSE-11, with M-5, M-13 and M-17 in
`../target-architecture.md`).

## Halves

| File | Holds |
|---|---|
| `arch-replay-cursor.ledger.jsonl` | the frozen source trace: four task rows the implementation wrote |
| `arch-replay-cursor.cases` | the case inputs, read by both halves |
| `arch-replay-cursor.expect` | the required logical behaviour per case, read by neither half |
| `arch-replay-cursor.bend` | the Bend2 half: a pure decision model over the case file |
| `arch-replay-cursor.mjs` | the reference half: it opens, checkpoints, reopens and reports |
| `arch-replay-cursor.reference.txt` | the reference half's RESULT lines |
| `arch-replay-cursor.prototype.txt` | the Bend2 half's RESULT lines |

The frozen bytes are at sha256
`e46ec3df8b8f41881f390f801169b05d9e35be93d496957777851f0eab2980f6`. The checkpoint itself is written
during each case by `store._writeProjectionCheckpoint({})`, which reports 5,477 bytes on this trace,
so the corpus replays a checkpoint the implementation produced rather than a fabricated envelope.

## Host and toolchain

- Host: Darwin 27.0.0, arm64 (Apple M4); Node v25.8.0.
- Toolchain: `bend 2.0.25` at the worktree root under `.bend/`; language source pin
  `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868` (`../reference/README.md`).
- Commands run from the worktree root with `export PATH="$PWD/.bend/bin:$PATH" BEND_NO_TELEMETRY=1`.

## Commands and output

### The Bend2 half

```sh
bend docs/bend2/examples/arch-replay-cursor.bend --check-only
```

```text
All terms check.
```

```sh
bend docs/bend2/examples/arch-replay-cursor.bend
```

```text
RESULT|cursor-live|source=live|checkpoint=none|cursor=4|owed=3
RESULT|cursor-after-restart-same-basis|source=checkpoint|checkpoint=valid|cursor=4|owed=3
RESULT|cursor-after-restart-changed-basis|source=ledger_fallback|checkpoint=stale_authority|cursor=4|owed=3
RESULT|cursor-after-restart-missing-basis|source=ledger_fallback|checkpoint=stale_authority|cursor=4|owed=3
```

Exit code 0.

### The reference half

```sh
node docs/bend2/examples/arch-replay-cursor.mjs --run
```

```text
RESULT|cursor-live|source=live|checkpoint=none|cursor=4|owed=3
RESULT|cursor-after-restart-same-basis|source=checkpoint|checkpoint=valid|cursor=4|owed=3
RESULT|cursor-after-restart-changed-basis|source=ledger_fallback|checkpoint=stale_authority|cursor=4|owed=3
RESULT|cursor-after-restart-missing-basis|source=ledger_fallback|checkpoint=stale_authority|cursor=4|owed=3
```

Exit code 0. Its stderr carries the startup status each case produced:

```text
cursor-live: {"source":"live","checkpoint":"none","cursor":4,"owed":3,"checkpointBytes":null}
cursor-after-restart-same-basis: {"source":"checkpoint","checkpoint":"valid","cursor":4,"owed":3,"checkpointBytes":5477}
cursor-after-restart-changed-basis: {"source":"ledger_fallback","checkpoint":"stale_authority","cursor":4,"owed":3,"checkpointBytes":5477}
cursor-after-restart-missing-basis: {"source":"ledger_fallback","checkpoint":"stale_authority","cursor":4,"owed":3,"checkpointBytes":5477}
```

### The three-way comparison

```sh
node docs/bend2/examples/arch-replay-cursor.mjs --compare
```

```text
CASE cursor-live: AGREEMENT
  required   : source=live checkpoint=none cursor=4 owed=3
  reference  : source=live checkpoint=none cursor=4 owed=3
  prototype  : source=live checkpoint=none cursor=4 owed=3
CASE cursor-after-restart-same-basis: AGREEMENT
  required   : source=checkpoint checkpoint=valid cursor=4 owed=3
  reference  : source=checkpoint checkpoint=valid cursor=4 owed=3
  prototype  : source=checkpoint checkpoint=valid cursor=4 owed=3
CASE cursor-after-restart-changed-basis: AGREEMENT
  required   : source=ledger_fallback checkpoint=stale_authority cursor=4 owed=3
  reference  : source=ledger_fallback checkpoint=stale_authority cursor=4 owed=3
  prototype  : source=ledger_fallback checkpoint=stale_authority cursor=4 owed=3
CASE cursor-after-restart-missing-basis: AGREEMENT
  required   : source=ledger_fallback checkpoint=stale_authority cursor=4 owed=3
  reference  : source=ledger_fallback checkpoint=stale_authority cursor=4 owed=3
  prototype  : source=ledger_fallback checkpoint=stale_authority cursor=4 owed=3
cases compared: 4; disagreements: 0
```

## Verdict

The claim holds, and for this path the reference implementation already meets the requirement: every
case agrees, and the differences this track found in the other two corpora do not appear here.

## What the corpus establishes

- **The projection cursor and owed delivery survive a restart.** Reopened behind a checkpoint written
  under the same authority, the store reports `source=checkpoint`, `checkpoint=valid`, all four rows
  covered and no row replayed; the cursor a consumer resumes from is unchanged and the rows it is owed
  are still owed.
- **A changed or absent authority is classified as stale, not as corruption.** Reopened under a policy
  whose `leaseTtlMs` differs by one second, or under no policy at all, the store reports
  `source=ledger_fallback` and `checkpoint=stale_authority`: the checkpoint is set aside, the ledger
  is replayed in full, the projection and the cursor are the same, and nothing is refused or
  quarantined. This is the disposition ARCH-CLOSE-11 requires, and it is the behaviour the recorded
  stop and lease rows in the other two corpora lack.
- **The vocabulary for the distinction already exists in this store.** `stale_authority` is a
  verdict the open reaches and records; the fold's refusals of a recorded row do not reach it.

## Limits

- The corpus exercises the projection checkpoint, not the wake stream's own attachment cursor:
  `WakeStream` requires a deployment coordination authority and is not constructed here.
- It exercises one run-lineage field change and one absent policy; no other authority dimension is
  varied.
- The Bend2 half models the decision; it opens no ledger and writes nothing.

## Related

- `../target-architecture.md`: ARCH-CLOSE-11 and the authority and recovery rules.
- `../architecture-review.md`: F9's validation basis.
- `arch-replay-stop.evidence.md` and `arch-replay-basis.evidence.md`: the recorded-row corpora whose
  refusals do not classify their cause.
