# V2 build and proof boundary

The v2 branch starts at master `da69bc25`. The operator's directive of
2026-09-28 requires law verification through the coordinator's import graph.
The approved statements are retained in [laws-proposed.md](laws-proposed.md).

`bend2/src/coordinator/main.bend` imports `laws.bend`, whose declarations and
proofs refer to `startup.bend`, the actual response used by the executable.
The startup result type has one constructor, `Unavailable`. The executable
explains that the session store is absent. It accepts no work.

This first commit establishes the build mechanism and the M-1/M-14 startup
obligations. It does not establish all clauses of the 16 operative statements.
Sessions, workers, native process ownership, durable acceptance, recovery,
authority, delivery and publication have no implementation in this skeleton.
Their proofs must be added over their actual types and functions as those
functions are implemented. Compiling this skeleton is insufficient evidence
for those capabilities.

Set `BEND` to the existing Bend 2.0.25 executable. Run:

```sh
sh bend2/scripts/build-native.sh
python3 docs/bend2/laws-check.py
sh bend2/scripts/check-native.sh
```

The build accepts an optional output path and always compiles the coordinator
entry. `check-native.sh` runs `laws-check.py`. The latter builds and executes
the current tree, then copies the source into a temporary directory within
the checkout. It adds a deliberately false law to the imported law module
and requires the same build command to fail with that law named in its
diagnostics. It repeats this for an open law and a TODO proof. Each mutation
is reverted, and the restored tree must compile. Temporary trees are removed.

This test establishes compiler reachability of the imported laws and rejection
of unfinished proofs. It does not establish that every required behavioral
obligation has been stated. Review must compare the stated laws and the
implementation with the operative statements before a push.
