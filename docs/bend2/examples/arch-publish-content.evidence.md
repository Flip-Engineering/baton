# arch-publish-content — completion evidence from the published content

## Claim

Completion of a publication can be established from the content the declared destination holds, not
only from the commit its ref names: the destination's own object store is read with `git ls-tree -r`
at the commit its declared ref names, that listing is hashed, and it is compared with the same listing
taken from the prepared squash. A destination naming another commit supplies no evidence.

This is gap (3) of the composition, and it is what M-3a asks for: evidence about the actual artifact,
at the actual destination, rather than about a name.

## Files

| File | Holds |
|---|---|
| `arch-publish-content.sh` | the three stages: publish and check, a destination naming another commit, republication |
| `arch-publish-content.evidence.md` | this record |

## Host and toolchain

- Host: Darwin 27.0.0, arm64 (Apple M4); git 2.50.1.
- All state is under `.scratch/arch-publish-content/`, which the repository ignores. Fixed commit dates
  and identity make the fixture's shas identical on every run; the base and squash shas are the ones
  `controlled-remote.sh` and `arch-publish-target.sh` produce.

## Command and output

```sh
export PATH="$PWD/.bend/bin:$PATH" BEND_NO_TELEMETRY=1
sh docs/bend2/examples/arch-publish-content.sh
```

```text
### the artifact that was prepared
squash=54a5a3404aae5df10c6935af754ac16c89d66cc0
prepared_content_sha256=e8217ad930b1d47f87bbb3dbef865c0819b999131d1b07e4527e46aa217524f6
### stage 1: publish, then read the content the declared destination holds
declared_ref=54a5a3404aae5df10c6935af754ac16c89d66cc0
declared_content_sha256=e8217ad930b1d47f87bbb3dbef865c0819b999131d1b07e4527e46aa217524f6
completion=observed_match
### stage 2: a destination naming another commit supplies no evidence
declared_ref=aa573951a310e1a0679461b42bb44b79c60f9d60
declared_content_sha256=872f8e98d09e3ec9775a89a72dd6629c51bac8754fc67d8ef911170fa2bb5b6a
completion=no_evidence
### stage 3: the prepared content read back from the destination after republication
declared_ref=54a5a3404aae5df10c6935af754ac16c89d66cc0
declared_content_sha256=e8217ad930b1d47f87bbb3dbef865c0819b999131d1b07e4527e46aa217524f6
completion=observed_match
evidence_source=destination_object_store
content_compared=ls-tree -r of the commit the declared ref names
```

Exit code 0, and the output is identical across runs. (The `bend` executable is not needed for this
script; the export line above is present because the worked example in this directory assumes it, as
bend2-orchestrator5's review of increment 7 noted.)

## What each stage establishes

| Stage | Evidence |
|---|---|
| The prepared artifact | The prepared squash's content digest is `e8217ad9…`, read from the source repository's listing of `54a5a340`. |
| 1 Publication | The declared ref names the prepared commit and the digest read from the destination's own object store equals the prepared digest: `completion=observed_match`. |
| 2 Another commit at the destination | The declared ref names the base commit; the destination's content digest is `872f8e98…`, which differs from the prepared digest, so `completion=no_evidence`. A ref that names something else is not completion, and with the digest in hand the difference is visible in the artifact rather than inferred from the ref. |
| 3 Republication | The prepared content is at the destination again and the digest matches the prepared one. |

The read is `git --git-dir=<declared> ls-tree -r <the commit the declared ref names>`, so the objects
come from the destination, not from the source repository. That is what makes the comparison evidence
about the destination rather than about the publisher's own copy.

## What this does not establish

- **The listing is hashed, not the objects' bytes.** A tree listing names paths and blob ids; a
  destination holding different blob *content* under the same ids is not possible in a valid object
  store, but this check does not walk the blobs to prove it. `git fsck` on the destination would be the
  stronger check and belongs to the deployment's verification, not to this corpus.
- **The comparison is between two listings of one process's output.** The prepared listing is read from
  the source repository the publisher wrote, so this is self-consistency, not independent
  verification.
- **No crash is injected between the push and the read.**

## Verdict

The claim holds. Completion rests on a digest of the destination's own content; a destination naming
another commit reports no evidence; and the whole check is available at the pin with git alone.

## Related

- `arch-publish-target.sh`, `arch-publish-target.evidence.md`: the ref-read completion this corpus
  replaces with a content check.
- `arch-publish-bind.sh`, `arch-publish-bind.evidence.md`: the record-to-commit binding, which carries
  the composition's final gap table.
- `controlled-remote.sh` (bend2-orchestrator5): the publication mechanism.
- `../target-architecture.md`: M-3a, M-3c, M-18.
