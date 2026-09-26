# Baton in Bend2

This directory contains the Bend2 work on `bend2-rewrite`. The
[design](../docs/bend2/target-architecture.md) describes a local coordinator,
native harness adapters and Git operations. The
[implementation plan](../docs/bend2/rewrite-plan.md) describes the first live slice.

Application logic belongs in imported Bend2 modules under `src/`. Native host
primitives use small C bindings where needed. Tests use separate entry points
and assert the behavior needed by the worker workflow. The native executable is
the target for integration checks involving host effects.

The current JSON and replay programs are earlier experiments. Their optional
runner is:

```sh
node bend2/scripts/run-checks.mjs
```

That runner discovers the existing programs, runs interpreted and native modes,
and compares their output with their `.expected.txt` fixtures. It can install
Bend 2.0.25 locally if absent. It does not yet build or test the planned service.
Application modules need no law annotations, frozen stdout files or independent
`main` function. The implementation adds a native build and integration command.
