# laws-wake-delivery — evidence

CLAIM: `bend docs/bend2/examples/laws-wake-delivery.bend` exits 0 in both runtime lanes, ten
fixtures replay with the verdicts the corpus records, the four adapter fixtures' routing metadata
agrees with what `impl/src/wake-stream.mjs` derives for their own rows, and four controls fail the
unchanged laws one at a time.

Status: a witness for the delivery half of the proposed no-park entry. The entry stays proposed:
this file approves nothing, and `docs/bend2/laws-proposed.md` and `docs/bend2/laws-trace.md` are
unchanged by it.

## Environment

| | |
|---|---|
| Host | macOS 27.0.0, arm64 (Apple M4) |
| Toolchain | bend 2.0.25 at `node_modules/.bend/bin/bend`, sha256 `3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c` |
| Node | v25.8.0 |
| Reference pin | `../reference/README.md`, `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868`, bend 2.0.25 |
| Base | the accepted laws tip `ea0bfbeb` on `baton/bend2-laws-r10-6f` |

Files under check, with the sha256 values this report records:

| File | sha256 |
|---|---|
| `examples/laws-wake-delivery.bend` | `c5bf641085b9736574f07181be82ad00f55033b3ead3bc41f18d992712a49ad1` |
| `examples/laws-wake-delivery.js` | `727952f4ec4d9c589bcdff35996287f4fb887ec38ca59fcb739f9da93c4e8b87` |

## The routing column is metadata

`deriveWakeFrame` answers from the wake class table: it reports where a coordination row is routed,
projected from the row and the attribution it is given. A frame with no `participantId` is
task-addressed in this witness, and that says where the frame goes. It carries nothing about
whether a seat's orchestrator was reached.

The witness therefore decides delivery from two columns only: the observation a fixture records
about a delivered wake, and a delivery receipt keyed by worker, task and turn epoch. The routing
column is replayed and printed for every adapter fixture, and
`routing_metadata_is_never_decisive` refuses any corpus in which routing alone produces a
`delivered` or a `rejected` verdict.

## The four facts the operator's decision needs

The witness declares the receipt column rather than reading it, because the tree carries no receipt
for a wake. At `origin/master` (the wake table file is one blob, `89059fcfca31a7c7140f695baa017f9aafaa779f`,
at both this base and master):

```sh
$ git grep -n "turn_report\|turnReport\|turn-report" origin/master -- impl/src
$ echo $?
1
```

```sh
$ git grep -n "owed_wake\|owedWake\|reportOwed" origin/master -- impl/src
$ echo $?
1
```

```sh
$ git grep -n "parentId" origin/master -- impl/src | grep -i "wake\|notify\|guide\|attention"
$ echo $?
1
```

The one place a seat's parent is written is its lineage:

```sh
$ git grep -n "parentId: p.parentId" origin/master -- impl/src/swarm-state.mjs
origin/master:impl/src/swarm-state.mjs:1302:      participantId: p.participantId, ...participantRole(p.role, meta.seq), parentId: p.parentId ?? null,
```

The tree's one delivery receipt is a peer message's, keyed by the receiving seat's turn:

```sh
$ git grep -n "kind: 'message.delivered'" origin/master -- impl/src
origin/master:impl/src/coordinator.mjs:3452:          turnEpoch: this._safeTurnEpoch(handle), kind: 'message.delivered', actor: 'orchestrator',
origin/master:impl/src/runtime-event-handlers/observation-events.mjs:263:          worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: 'message.delivered', actor: 'hub',
origin/master:impl/src/runtime-event-handlers/observation-events.mjs:278:                  turnEpoch: coordinator._safeTurnEpoch(handle), kind: 'message.delivered', actor: 'hub',
```

```sh
$ git grep -n "operationalKind('message.delivered')" origin/master -- impl/src/wake-stream.mjs
origin/master:impl/src/wake-stream.mjs:303:    rows: [operationalKind('message.delivered')],
```

That row projects the `guidance_delivered` class, whose summary reads "a message reached the
participant it was addressed to". No receipt kind exists for a wake.

## Commands and observed output

Every command ran from the worktree root. Output is verbatim.

### 1. The witness checks

```sh
$ bend docs/bend2/examples/laws-wake-delivery.bend --check-only
All terms check, but 5 defs rely on unsafe or foreign code:
- Real.adapter_routing
- render_adapter
- render
- one
- main
```

Exit code 0. The named defs are the ones that cross into the host half; the standing notice is the
same one `laws-transition.bend` prints.

### 2. The corpus replays, interpreter lane

```sh
$ bend docs/bend2/examples/laws-wake-delivery.bend
park-wake-absent source=adapter derived=task-addressed observation=wake-absent receipt=not-checked verdict=rejected
park-wake-observed source=adapter derived=task-addressed observation=wake-delivered receipt=not-checked verdict=unconfirmed
recovery-seat-addressed source=adapter derived=seat-addressed observation=wake-delivered receipt=not-checked verdict=delivered
park-transition-no-frame source=adapter derived=no-frame observation=wake-unobserved receipt=not-checked verdict=unconfirmed
correlation-unknown source=model derived=n/a observation=wake-delivered receipt=not-checked verdict=unconfirmed
correlation-missing source=model derived=n/a observation=wake-absent receipt=not-checked verdict=unconfirmed
receipt-present source=model derived=n/a observation=wake-unobserved receipt=present verdict=delivered
delivered-no-receipt source=model derived=n/a observation=wake-delivered receipt=absent verdict=delivered
parent-unresolved source=model derived=n/a observation=wake-unobserved receipt=not-checked verdict=rejected
settled-turn source=model derived=n/a observation=wake-unobserved receipt=not-checked verdict=not-applicable
wake-delivery witness: 10 fixtures replayed; every adapter derivation must agree with its declared routing, and every verdict must equal the corpus expectation.
```

Exit code 0.

### 3. The same corpus, emitted-JavaScript lane

```sh
$ bend docs/bend2/examples/laws-wake-delivery.bend -o <scratch>/laws-wake-delivery.js
$ node <scratch>/laws-wake-delivery.js
```

Exit code 0 for the emit and for the run, with the ten lines and the closing line byte-identical to
the interpreter lane. Both lanes reach `impl/src/wake-stream.mjs` through `require` from
`process.cwd()`.

The three adapter rows and the routing each derives:

| Row | Derived routing | Fixture |
|---|---|---|
| `turn.paused` (the turn-end park's own row) | `task-addressed` | `park-wake-absent`, `park-wake-observed` |
| `swarm.resume_decision_requested` | `seat-addressed` | `recovery-seat-addressed` |
| `task.paused` (the park's coordination transition) | `no-frame` | `park-transition-no-frame` |

### 4. Controls

Each control is a scratch copy with one edit; the witness itself is unchanged.

Control 1, the correlation rule: `decide` maps an unknown correlation to `Rejected{}`.

```sh
$ bend <scratch>/c1.bend --check-only
Error:
- expected : Rejected{}
- observed : Unconfirmed{}
Location: every_fixture_matches_its_expectation
```

Exit code 1. Control 1b also moves the corpus expectation, so the rule itself is the failing one:

```sh
$ bend <scratch>/c1b.bend --check-only
Error:
- expected : False{}
- observed : True{}
Location: unknown_or_missing_correlation_stays_unconfirmed
```

Exit code 1.

Control 2, the routing rule: `decide` maps a task-addressed frame with a delivered observation to
`Delivered{}`.

```sh
$ bend <scratch>/c2.bend --check-only
Error:
- expected : Delivered{}
- observed : Unconfirmed{}
Location: every_fixture_matches_its_expectation
```

Exit code 1. Control 2b moves the corpus expectation too, so the routing law is the failing one:

```sh
$ bend <scratch>/c2b.bend --check-only
Error:
- expected : False{}
- observed : True{}
Location: routing_metadata_is_never_decisive
```

Exit code 1.

Control 3: one fixture's turn loses its report.

```sh
$ bend <scratch>/c3.bend --check-only
Error:
- expected : NotApplicable{}
- observed : Rejected{}
Location: every_fixture_matches_its_expectation
```

Exit code 1.

Control 4: a receipt on file no longer establishes delivery.

```sh
$ bend <scratch>/c4.bend --check-only
Error:
- expected : False{}
- observed : True{}
Location: delivery_confirmed_only_by_evidence
```

Exit code 1.

## Scope

This is a fixture replay and a pure decision table over it, plus routing metadata derived by the
deployment's own wake table. The corpus is enumerated: ten fixtures, chosen for the shapes the
proposed entry and the operator's decision name.

The witness reads nothing about a live resident. The three adapter rows are built from the shapes
the runtime writes, with placeholder payload values, and the host half measures the derivation's
shape. A resident's own parked row and a resident's own delivery history are outside this check.

The receipt column is a fixture fact. The tree holds one delivery receipt kind, `message.delivered`
for a peer message; the witness's `receipt-present` fixture is a model case that names what the
operator's decision would need, and `receipt=not-checked` records that no receipt path exists for
the wake today.

## Verdict

The claim holds at pin `a4952426` with bend 2.0.25 on this host: the witness checks and replays ten
fixtures in both runtime lanes with the recorded verdicts, the adapter rows' derived routing agrees
with the routing each fixture declares, an unknown or missing correlation stays unconfirmed, an
observed wake that is not addressed to the seat stays unconfirmed, an absent receipt is not read as
missing delivery, and four controls fail the laws they target one at a time.
