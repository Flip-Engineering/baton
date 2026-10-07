# Context import and engine source review

## Scope

Reviewed base `fc265b4c6526fbe734a0d2988f4626744f50b6eb`, replay-requirement repair `99cf0b38344bc3da76303dc23e916a83dfb89486`, import and engine merge `3ef1c471950efdde921451377fa7208c83a33c96`, and root composition `256b01869f9c64511d2a763bc1b1f416c8eb0d0a`.

The ten reviewed source paths are `codec-convert.bend`, `codec-wire.bend`, `engines-decl.bend`, `engines-decl-laws.bend`, `engines-select.bend`, `engines-select-laws.bend`, `engines-wire.bend`, `engines-wire-laws.bend`, `snapshot-validate.bend`, and `snapshot-validate-laws.bend`, all under `bend2/src/context/`.

## Verdict

The review found one reproducible plan-construction defect. A dependency on a distinct module-operation pair can be refused as a cycle because `pending_step_key` uses an ambiguous string encoding. The reviewed source should not be merged without correcting that key and adding a regression check.

## Finding

**P2 — dependency step keys can collide.** `engines-select.bend` builds each ancestor key as `module_id ++ "/" ++ operation` in `pending_step_key`, then `plan_drain` checks that string in the current path. Declaration admission checks that module IDs and operation IDs are nonempty; it does not reject `/` or encode the pair unambiguously.

A remote probe supplied two admitted declarations: module `a/b`, operation `c`, with a dependency on module `a`, operation `b/c`. Both step keys become `a/b/c`. `Decl.admit_catalog` returned `CatAdmitted`, while the request path returned `PlanCycle{"a"}` for the distinct dependency. The probe output is retained at `/home/atari2036/baton-imports-deepseek-20261006/r17-luna-context-review-20261006/cycle-run.stdout`; its build, link and run exits are all `0`. A typed pair key or another collision-free representation is required. The current selection laws cover a true self-cycle but not colliding distinct pairs.

## Verified obligations and evidence

- Catalog admission checks every declaration against the full catalog. `cat_conflict` continues after a matching identical identity, and discovery carries the complete catalog as its comparison context. The laws cover a later conflicting duplicate. The request wire reader maps exact `engine: "auto"` to the empty selector; omitted and named selectors have separate laws.
- `effective_requirements` accumulates historical requirements first, then the common minimum, then declared additions under `Eng.union_add`'s append semantics. Its law verifies that all three distinct operands remain in that order. Declaration and binding paths retain the authoritative package path, artifact digest, role and schema identities; frame validation compares the full binding, with schema identities compared as a set.
- Root qualification at `/home/atari2036/baton-core-5375515a/qualification` records successful build and run exits. `run.stdout` contains 34 passing assertions and `context-core fixtures: all green`. Its entry imports the context law modules, including the reviewed declaration, selection, wire and snapshot-validation laws.
- The r14 raw-wire evidence at `/home/atari2036/baton-imports-deepseek-20261006/r14-native-probe/evidence.json` records stable source hashes and successful completion. The ten reviewed source hashes match the corresponding files at root composition `256b0186`. Its native probe reports 34 old/new comparisons over raw-value constructors and continuation modes. This probe does not exercise dependency-key collisions.
- An additional remote-only probe in `r17-luna-context-review-20261006` verified escaped object keys and string values, nested arrays and objects, exact `1e400` preservation, escaped query text and the emitted event-frame shape. Its build, link and run exits are `0`; output is in `run.stdout`. The probe source and logs are remote qualification artifacts only; no candidate output was copied into a checked-in expected fixture.

The remote runs used `/home/atari2036/baton-logging-686/toolchain-home/bin/bend` (SHA-256 `d9c0dad1f77be6a13dd8dcc16aef4f59047a956a2744f25d5c220cb8de384693`) and `/usr/bin/clang-19` (SHA-256 `f6d5286a52de10b1e3e8841457c9903a1ea28f222ac0f58cd616697d0dcd9db3`). The root full62 codec mutation run remains gated on schema green and was not duplicated. Schema-worker and provider-crew paths were not changed.