# arch-publish-target — the acceptance half and the publication half of one landing, composed

## Claim

One landing's two halves run together with the completion claim resting on the actual shared
destination: a Bend2 process journals the accept intent and reports that it carries no durability
receipt; the deployment's own publication command sends the squashed commit to the declared remote; and
completion is established only by reading that remote's ref. A wrong destination leaves the declared
remote unchanged, a lost response is reconciled by observation without a second push, and a deployment
that declares no destination publishes nothing.

This is the git half of M-18, composed with the acceptance half of M-1/M-12 from
`arch-publish-compose.evidence.md`. The publication mechanism and its four cases are
bend2-orchestrator5's fixture (`controlled-remote.sh`, commit c6824f56); this script reproduces that
mechanism, cites it, and composes it with the Bend2 acceptance half.

## Files

| File | Holds |
|---|---|
| `arch-publish-target.sh` | the five stages: acceptance, publication, a wrong destination, a lost response, no declared destination |
| `arch-effect-publication.bend` | the Bend2 program stage 1 runs |
| `controlled-remote.sh`, `controlled-remote.evidence.md` | bend2-orchestrator5's fixture: the mechanism and its four cases |
| `arch-publish-target.evidence.md` | this record |

## Host and toolchain

- Host: Darwin 27.0.0, arm64 (Apple M4); git 2.50.1.
- Toolchain: `bend 2.0.25` at the worktree root under `.bend/`; language source pin
  `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868` (`../reference/README.md`).
- All state is under `.scratch/arch-publish-target/`, which the repository ignores. Fixed commit dates
  and identity make the fixture's shas identical on every run.

## Command and output

```sh
sh docs/bend2/examples/arch-publish-target.sh
```

```text
### stage 1: the acceptance half, in a Bend2 process
intent_appended=True
journal_lines=1
durability_receipt=none
dispatch=issued
settled=observed
dispatch_count=1
journal_lines=1
### stage 2: the publication half, and the observation that claims completion
squash=54a5a3404aae5df10c6935af754ac16c89d66cc0
declared_remote_head=54a5a3404aae5df10c6935af754ac16c89d66cc0
completion_evidence=observed_match
### stage 3: a wrong destination is not completion
wrong_destination_head=54a5a3404aae5df10c6935af754ac16c89d66cc0
declared_remote_head=aa573951a310e1a0679461b42bb44b79c60f9d60
completion_evidence=no_evidence
### stage 4: a lost response, reconciled by observation
pushes_this_stage=1
declared_remote_head=54a5a3404aae5df10c6935af754ac16c89d66cc0
reconciliation=observed_convergence
this_attempt_is_proven=false
### stage 5: a deployment with no declared destination publishes nothing
no_declared_destination=fatal_empty_destination
declared_remote_head=54a5a3404aae5df10c6935af754ac16c89d66cc0
```

Exit code 0, and two clean runs are byte-identical. The base and squash shas are the same ones
`controlled-remote.sh` produces (`aa573951…`, `54a5a340…`), so both fixtures describe the same
repositories.

## What each stage establishes

| Stage | Step | Evidence |
|---|---|---|
| 1 | The acceptance half | The accept intent is on disk before the acknowledgement prints (`intent_appended=True`, then `journal_lines=1`), and the program reports `durability_receipt=none` because Base has no synchronization operation. |
| 2 | Publication and completion | The squashed commit is pushed to the declared remote, and completion is claimed by reading that remote's ref: `declared_remote_head` equals `squash`, `completion_evidence=observed_match`. The push's own output is not the evidence. |
| 3 | A wrong destination | The same commit pushed to another remote leaves the declared remote at its base: `wrong_destination_head` advanced, `declared_remote_head=aa573951…`, `completion_evidence=no_evidence`. Publication to the wrong repository is the failure M-18 names, and it is invisible to anything but a read of the declared destination. |
| 4 | A lost response | One push was issued and its output discarded; the declared remote's ref now equals the squashed commit, so `reconciliation=observed_convergence` — and `this_attempt_is_proven=false`, because convergence does not establish that this attempt caused it (M-3c). No second push was issued. |
| 5 | No declared destination | Pushing to an empty destination fails (`fatal_empty_destination`) and the declared remote is untouched. This is the shape the deployment refuses earlier and by name: a landing with no `advanced.integration.publishRemote` refuses `integrate_publish_undeclared` before anything moves. |

## What the composition still lacks

- **The two halves run on different substrates.** The acceptance record is a Bend2 process writing
  files; the publication is `git push` run by this shell script, because the native deployment has no
  process surface (`bend base Process` and `bend base exec` exit 1, `B2-PROCESS`). A native deployment
  would have to run the publication itself, and that half is `ARCH-CLOSE-05`'s work.
- **The acceptance record and the published commit are not bound.** Stage 1's journal names `op-1` and
  stage 2 publishes a commit; nothing derives one from the other, because there is no codec or digest
  available at the pin (`B2-JSON`, `B2-CRYPTO`). A landing's record should carry the commit it
  published, and that binding is the next increment's work.
- **The observation is a ref read, not a content check.** Stage 2 compares the declared remote's ref
  with the intended commit; it does not verify that the remote's tree equals the prepared squash.
- **The lost response is simulated**, by discarding the push's output rather than by interrupting it.
  The reconciliation logic is the same either way, but no crash is injected.

## Verdict

The claim holds. Both halves ran at the pinned compiler and git, the five stages behave as recorded,
and the completion claim in every stage rests on a read of the declared destination rather than on the
publishing command's own output.

## Related

- `controlled-remote.evidence.md` (bend2-orchestrator5): the publication mechanism and its four cases.
- `arch-publish-compose.evidence.md`: the acceptance half across four processes.
- `arch-effect-publication.evidence.md`: the single-process prototype and the missing-primitive table.
- `../target-architecture.md`: ARCH-CLOSE-05, M-1, M-2, M-3a, M-3c, M-12, M-18.
