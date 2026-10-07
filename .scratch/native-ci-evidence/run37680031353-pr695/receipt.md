# PR #695 run 37680031353 build-native failure classification

Root-routed retained-evidence inspection. No new build, compiler, test or CI run performed. Artifact `baton2-development-darwin-arm64-90f20bd6764fb02ef6d56c96e810e10f66e4253f-1`, ID 11508883189, 24,044,647 bytes, downloaded zip SHA256 `c3fae0b48723fb13715a1d418f5b7b1ba3a35f31a416a853412d66f92979b62d`. Result qualifies only PR branch head `55fce249b5d61ecadf39f3ed4ad9a507c1a84502` ("WIP: Store commit publication and failed-completion ack gate", branch codex/native685-scoped-20261006), not current primary ac55c2ef.

## Failure

`package-native.py` run_gates raised `RuntimeError("build-native failed")` 29 seconds into the step. Retained `package/gates/build-native.log` shows a Bend 2.0.25 law rejection during compilation:

- Law: `naming-laws.named_commands_execute_the_committed_query_and_classify_its_answer` (bend2/src/coordinator/naming-laws.bend:259–263).
- expected (implementation side): `Sql.query(db, "CREATE TABLE IF NOT EXISTS wake_claims …;CREATE TABLE IF NOT EXISTS sessions …;…")` — an unwrapped schema-ensure query.
- observed (law side): `Sql.query(db, "BEGIN IMMEDIATE;CREATE TABLE IF NOT EXISTS wake_claims …` — the single wrapped transaction.

## Mechanism (verified against exact source 55fce249)

The WIP commit rewrote `store.bend` (+118): `Store.apply` → `commit` → `transact_sql` (store.bend:120–124), and `transact_sql` now performs a separate `ensure_before_begin(db)` query before the wrapped `BEGIN IMMEDIATE;…COMMIT;` query. The law still states that `Store.apply(db,command)` issues exactly the single wrapped query. The implementation's first IO action is now the schema-ensure query, so the law no longer describes the implementation and the build gate is red.

This is a genuine law/implementation mismatch in the WIP source — not a stale control, not a toolchain or runner fault. All identities verified: run source 90f20bd6 is the workflow checkout; the PR head under qualification is 55fce249 per the routing.

## Boundary and owner disposition

- Boundary (authoritative, per Root's forwarding): the red qualifies only PR branch head 55fce249. Current primary ac55c2ef is not implicated; the primary handoff is not blocked by this PR-only red.
- Owner: native685 owns the source branch. Disposition for the owner: restate `named_commands_execute_the_committed_query_and_classify_its_answer` to include the ensure-before-begin step (and audit the sibling store laws for the same wrapper/ensure drift), or restructure `transact_sql` so the implementation again matches the stated law. The corrected source then needs the normal gates; no rerun was performed here per the task constraint.

## Evidence

`.scratch/native-ci-evidence/run37680031353-pr695/` — artifact.zip (digest above), extracted `package/result.json`, `package/gates/build-native.log`, gate manifests.
