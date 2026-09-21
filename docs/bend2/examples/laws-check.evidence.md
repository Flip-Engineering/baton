# laws-check — evidence

CLAIM: the pinned Bend2 checker accepts `docs/bend2/laws.bend` — a laws file whose runtime laws
are stated as typed encodings (closed enums, exact records, total derivations) and whose
machine-checkable laws are stated as Bend `law` claims proven by defs — and the checker really
checks the laws: a deliberately false law fails the check with an expected/observed refusal.

## Environment

| | |
|---|---|
| Host | macOS 27.0.0, arm64 (Apple M4) |
| Toolchain | bend 2.0.25 at `node_modules/.bend/bin/bend`, sha256 `3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c` |
| Reference pin | `docs/bend2/reference/README.md` (`bendlang/bend@a4952426`) |
| File under check | `docs/bend2/laws.bend`, 586 lines, sha256 `829b5cc96d39809ad22def16af70f00cec8da1c6ea483e266e1159c2441e8a51` |

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

The claim `one_accept_is_accepted` was temporarily changed to state the false proposition
`review_state_of([Acc{Seat{"rev"}}]) == Rejected{}`:

```sh
node_modules/.bend/bin/bend docs/bend2/laws.bend --check-only   # with the false law
```
Error:
- expected : Accepted{}
- observed : Rejected{}
Location: one_accept_is_accepted
276 | def one_accept_is_accepted():
277>|   {==}
```

Exit code 1. The law was restored to its proven form and the check answers `All terms check.`
again (exit code 0).

## Verdict

The claim holds at pin `a4952426` with toolchain 2.0.25 on this host: the laws file checks clean,
and the `law` claims in it are discharged by the checker itself — a false law refuses with the
expected and observed terms, so the seven proven laws in `docs/bend2/laws.bend` are compile-time
guarantees, and the remaining laws carry their proof method (`type-level`, `total-function`,
`runtime-residue`, `claim-open`) in their header comments.
