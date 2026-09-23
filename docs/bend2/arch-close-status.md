# ARCH-CLOSE closure status

[`target-architecture.md`](target-architecture.md) names corrections `ARCH-CLOSE-01` through
`ARCH-CLOSE-11` that its findings require before the affected behavior may be deleted or replaced.
This file indexes what each correction has on the branch today, so a phase entry decision reads one
table instead of eleven sections and the plan.

Status words used here:

- **Open** — no evidence on the branch.
- **Counterevidence recorded** — the branch records what the pin does not supply. This bounds the
  work; it does not discharge the correction.
- **Gap reproduced** — a corpus shows the current implementation diverging from the correction's
  requirement on a frozen trace.
- **Conforming path evidenced** — a corpus shows the current implementation meeting the requirement
  on a frozen trace.
- **Discharged** — the correction's own stated evidence exists.

A row moves when its evidence file is on the branch or in the accepted landing sequence; each row
names that file, and the three `arch-replay-*` corpora and the review record below are accepted
contributions whose files arrive with that sequence. This index records no phase decision.

| Correction | Obligation, shortened | Status | Evidence on this branch |
|---|---|---|---|
| `ARCH-CLOSE-01` | Record the external verdict, reviewed commit and artifact hashes; map every finding to a correction or decision; obtain a phase disposition | Discharged | [`reviews/codex/`](reviews/codex/) holds the review, its message, the manifest, the Base surface checks and the probe with their hashes; `target-architecture.md` carries the operator dispositions; [`authorization.md`](authorization.md) records the law basis |
| `ARCH-CLOSE-02` | Prove-indexed capability before deleting authority checks; forged constructors, duplicate issuance, second producers, cross-scope use, stale generations and post-revocation replay must fail | Counterevidence recorded | `examples/lang-cap-lease.bend`, `examples/lang-cap-forge.bend` and `examples/lang-cap-probes.evidence.md` (an exported constructor is forgeable and `release` answers the forged field); `examples/lang-cap-second-predicate.bend` (two defs produce one type); `examples/lang-cap-drop.bend` (an affine value drops without its release path) |
| `ARCH-CLOSE-03` | Cancellation and supervision: cancel intent, join outcome, child accounting, observed close and reap, across normal, error, stop, parent-failure and restart cases | Counterevidence recorded | `examples/lang-cap-dropped-child.bend` and its evidence: dropping the `IO.fork` channel cancels nothing, the parent returns, the child continues, and the process waits for the child. The wider case set is open |
| `ARCH-CLOSE-04` | Durability and metadata operations: safe creation, enumeration, metadata, atomic publication and rename, file and directory sync, with fault injection at each boundary | Counterevidence recorded | `examples/lang-cap-durability.bend` and its evidence: write and close only; `File.sync`, `File.rename` and `File.stat` refuse as undefined at the pin |
| `ARCH-CLOSE-05` | Process effects: nonblocking spawn, concurrent output streams, exit and signal status, cancellation, wait and reap, incarnation, restart recovery | Counterevidence recorded | `examples/lang-host-foreign.bend` and its evidence (a `popen`-style effect answers whole stdout and the exit status, blocks the loop, and carries no handle, stream, signal or kill); [`language-review.md`](language-review.md) `LANG-CAP-05` |
| `ARCH-CLOSE-06` | HTTP, HTTPS/TLS, WebSocket and bridge framing with recorded native dependencies | Counterevidence recorded | [`language-review.md`](language-review.md) `LANG-CAP-08` (no HTTP, TLS or Unix-socket library at the pin); `examples/lang-host-interop.evidence.md` (Base TCP bytes only) |
| `ARCH-CLOSE-07` | Hashing, HMAC, secure randomness, constant-time comparison and signatures through audited effects, with vectors and dependency records | Counterevidence recorded | [`language-review.md`](language-review.md) `LANG-CAP-10`: `IO.random_u32` is the only crypto-adjacent name at the pin |
| `ARCH-CLOSE-08` | Knowledge promotion with attribution, reader-relative views and delegation, before and after restart | Open | No evidence file on this branch |
| `ARCH-CLOSE-09` | Typed declarations, independent structural scans and consumer validation of `CheckedChangeImpact` for the exact snapshot, over the four change kinds | Open | The committed inventory the correction replaces is still the branch's gate input; [`architecture-review.md`](architecture-review.md) records its F17 disposition |
| `ARCH-CLOSE-10` | Native journal inventory and supported-platform durability contract, with fault injection and a segmentation design for large journals | Open | [`rewrite-plan.md`](rewrite-plan.md) carries the obligation and the `B2-FS-DURABILITY` work item |
| `ARCH-CLOSE-11` | One recorded schema and policy basis for startup, doctor and recovery, with cause classification before repair | Gap reproduced, conforming path evidenced | Gap: `examples/arch-replay-stop.evidence.md` (a missing policy basis and a corrupted row both return `replay_refused` / `run_stop_integrity`, where the required behavior separates `missing_policy_basis` from `corrupt_source_bytes` and quarantines only the second) and `examples/arch-replay-basis.evidence.md` (a changed authorization basis and a rejected mutation differ on classification and on the diagnostic verdict). Conforming path: `examples/arch-replay-cursor.evidence.md` (all four owed-cursor and restart cases agree) |

## What the track still owes

[`rewrite-plan.md`](rewrite-plan.md) phases the work, and each correction above names the evidence
its phase entry needs. The architecture lane's remaining increments are the native effect prototype
(`arch-effect-*`) and the composed durable-acceptance-to-canonical-publication path
(`arch-publish-*`); the composed path is where `ARCH-CLOSE-03`, `ARCH-CLOSE-04` and the M-18
publication obligation meet.
