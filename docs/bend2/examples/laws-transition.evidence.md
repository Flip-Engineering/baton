# laws-transition — evidence

CLAIM: a Bend2 effect's JS half reaches `impl/src` through `require` in both the interpreter and
the emitted-JavaScript lanes, and the witness built on that mechanism compares the real
`foldSwarmEvent` review append and the real host-capacity worker admission against the checked
models in `laws.bend` on eight enumerated cases, each printing `agree`; a host half that drops a
retained row is caught by the same comparison.

## Environment

| | |
|---|---|
| Host | macOS 27.0.0 (build 26A428), arm64 (Apple M4) |
| Toolchain | bend 2.0.25 at `node_modules/.bend/bin/bend`, sha256 `3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c` |
| Python | `/opt/homebrew/bin/python3`, Python 3.14.3 |
| Node | v25.8.0 |
| Reference pin | `../reference/README.md`, `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868` |

## The capability the witness rests on

The witness needs two things from the pin: a way to call the real implementation from a Bend
program, and a way to compare what it answers against a law's model. The first is the capability
finding recorded here; the second is the model comparison in the program itself.

### 1. A static `import` in a host half refuses in both lanes

The compiler inlines the host half inside the emitted closure, so a static import is not a module
declaration there. A probe effect whose `.js` half began `import os from "node:os";` answered:

```sh
$ bend <probe>.bend
SyntaxError: Unexpected identifier 'os'. import call expects one or two arguments.
```

```sh
$ bend <probe>.bend -o <scratch>/<probe>.js && node <scratch>/<probe>.js
file://<scratch>/<probe>.js:127
import os from "node:os";
       ^^
```

Exit code 2 from the interpreter run and a non-zero Node exit; the same probe with `require`
instead of `import` ran in both lanes. The probe files were temporary and are not kept; the two
lane commands below are the reproducible form of the same observation against the witness, whose
host half requires `impl/src` itself.

### 2. The witness reaches `impl/src` in both lanes

```sh
$ bend docs/bend2/examples/laws-transition.bend
reviews n=0 real 0 model 0 agree
reviews n=1 real 1 model 1 agree
reviews n=2 real 5 model 5 agree
reviews n=3 real 18 model 18 agree
reviews n=4 real 55 model 55 agree
worker tight=0 free=4096 real 1 model 1 agree
worker tight=18 free=64 real 1 model 1 agree
worker tight=64 free=1 real 1 model 1 agree
transition witness: 8 cases compared; every line above must read agree.
```

```sh
$ bend docs/bend2/examples/laws-transition.bend -o <scratch>/laws-transition.js
$ node <scratch>/laws-transition.js
reviews n=0 real 0 model 0 agree
reviews n=1 real 1 model 1 agree
reviews n=2 real 5 model 5 agree
reviews n=3 real 18 model 18 agree
reviews n=4 real 55 model 55 agree
worker tight=0 free=4096 real 1 model 1 agree
worker tight=18 free=64 real 1 model 1 agree
worker tight=64 free=1 real 1 model 1 agree
transition witness: 8 cases compared; every line above must read agree.
```

Exit code 0 in both lanes, with the same eight answers. Both commands ran from the worktree root,
because the host half resolves the implementation as `process.cwd() + "/impl/src/…"`. The
interpreter lane prints the standing notice that three defs rely on foreign code.

## The eight cases

`reviews n=k` folds `k` accepted review rows into one contribution through the real
`foldSwarmEvent` and reports the base-3 fingerprint of the rows it retained (each retained row
contributes its decision digit plus one, folded left to right). The model's column is
`History.append_review` applied `k` times over `laws-history-model.bend`, fingerprinted the same
way. The five fingerprints are distinct, so a dropped row or a reordered pair changes the number.

| Case | Real | Model | Verdict |
|---|---|---|---|
| reviews n=0 | 0 | 0 | agree |
| reviews n=1 | 1 | 1 | agree |
| reviews n=2 | 5 | 5 | agree |
| reviews n=3 | 18 | 18 | agree |
| reviews n=4 | 55 | 55 | agree |
| worker tight=0 free=4096 | 1 | 1 | agree |
| worker tight=18 free=64 | 1 | 1 | agree |
| worker tight=64 free=1 | 1 | 1 | agree |

`worker` builds the case's host observation, asks the real `HostCapacityAuthority` for its own
room-for-worker reading, and compares it with `Worker.room_for(Worker.Worker{}, mt, bf)` from
`laws-worker-model.bend`. All three cases admit a worker, including the two under memory pressure,
which is the shape the M-10 model obligation states.

## The control

`laws-check.py` copies the witness into a scratch directory, rewrites the host half's review loop
to `reviews.slice(0, -1)`, and runs it again:

```sh
$ bend <scratch>/examples/laws-transition.bend
reviews n=0 real 0 model 0 agree
reviews n=1 real 0 model 1 DISAGREE
...
```

The control row requires `DISAGREE` in that output. A comparison that could not see a dropped row
would pass this control, so the row is what holds the eight agreements above to being a real
comparison.

## Scope

The corpus is enumerated, not quantified: eight cases, chosen for the shape the two models state.
The witness binds the real fold and the real admission decision to the models. It does not
establish the host effects the approved entries need and this pin does not supply; `../laws-trace.md`
records per entry whether the pin can carry its witness.

## Verdict

The claim holds at pin `a4952426` with bend 2.0.25 on this host: a host half reaches `impl/src`
through `require` in both runtime lanes, and on eight enumerated cases the real review append and
the real worker admission answer exactly what the checked models predict, with a control that
fails when the host half drops a row.
