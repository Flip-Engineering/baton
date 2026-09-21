# laws-check — evidence

CLAIM: the pinned Bend2 checker accepts the draft `docs/bend2/laws.bend` — the approval-shaped
laws file that carries no runtime laws yet and the seven development laws marked
`status: for approval` — and the checker really checks the laws the file states: a deliberately
falsified law fails the check with an expected/observed refusal.

## Environment

| | |
|---|---|
| Host | macOS 27.0.0, arm64 (Apple M4) |
| Toolchain | bend 2.0.25 at `node_modules/.bend/bin/bend`, sha256 `3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c` |
| Reference pin | `docs/bend2/reference/README.md` (`bendlang/bend@a4952426`) |
| File under check | `docs/bend2/laws.bend`, 217 lines, sha256 `a24f4187993236489217434282f5179036ed93bbf8fe6d21f8d2c695c5fec56f` |

Toolchain provenance on this host: the reference installer
(`docs/bend2/reference/toolchain/install-2.0.25.sh`) downloads its release archive from GitHub and
the download was refused from this deployment:

```
downloading https://github.com/bendlang/bend/releases/download/v2.0.25/bend-2.0.25-darwin-arm64.tar.gz
curl: (56) The requested URL returned error: 404
bend: the download failed: https://github.com/bendlang/bend/releases/download/v2.0.25/bend-2.0.25-darwin-arm64.tar.gz
```

The toolchain was therefore taken from an install the same script had already produced in another
lane workspace of this deployment. Two independent installs were compared before copying; both are
byte-identical to the copy this checkout uses:

```
3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c  <ws-A>/node_modules/.bend/bin/bend
3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c  <ws-B>/node_modules/.bend/bin/bend
```

`bend version` answers:

```
bend 2.0.25
```

## Commands and observed output

All commands ran from the worktree root with `BEND_NO_TELEMETRY=1`.

### 1. The check the mandate asks for

```sh
node_modules/.bend/bin/bend docs/bend2/laws.bend --check-only
```

```
All terms check.
```

Exit code 0.

### 2. Run mode answers the same (the file defines no `main`)

```sh
node_modules/.bend/bin/bend docs/bend2/laws.bend
```

```
All terms check.
```

Exit code 0.

### 3. The laws are machine-checked, not decoration

The claim `worker_admitted_at_any_load` was temporarily changed to state the false proposition
`room_for(Worker{}, mt, bf) == False{}`:

```sh
node_modules/.bend/bin/bend docs/bend2/laws.bend --check-only   # with the false law
```

```
Error:
- expected : True{}
- observed : False{}
Context:
- mt : Bool
- bf : Bool
Location: worker_admitted_at_any_load
82 | def worker_admitted_at_any_load(mt, bf):
83>|   {==}
```

Exit code 1. The law was restored to its proven form and the check answers `All terms check.`
again (exit code 0).

## Verdict

The claim holds at pin `a4952426` with toolchain 2.0.25 on this host: the draft laws file checks
clean, and the `law` claims in it are discharged by the checker itself — a false law refuses with
the expected and observed terms. The draft carries one proven law (`worker_admitted_at_any_load`,
the shape proof of DEV-1's admission encoding); the other six law proofs prepared on this lane
belong to runtime candidates and enter the file only when the operator approves those rows. The
file's Part II states the per-row format every approved runtime law will take, so adding an
approved row re-runs this check as part of landing it.
