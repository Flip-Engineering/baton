# Rewrite authorization

## Current decision

On 2026-09-22, the operator authorized the Baton2 rewrite to proceed on `bend2-rewrite` under
the 16 operative prohibitions in `laws-proposed.md`. This decision supersedes the earlier
design-only scope and the hold awaiting law approval. No work from this assignment lands on
`master`.

Codex's final law review approved revision 9.1 at
`1fab9a1da60db3d5d9c9d3cef89d3caabd68fe35`. The
[review record](reviews/codex/codex-final-law-review-r9.1.md) is copied unchanged from the operator's
review file at `/tmp/baton-bend2-laws-review/codex-final-law-review-r9.1.md`.

The reviewed artifacts have these SHA256 digests:

| Artifact at the reviewed commit | SHA256 |
|---|---|
| `docs/bend2/laws-proposed.md` | `c9cc0be1cc94ce70284b6ba536b80d4338427baa2701956a531e4e87f97e4290` |
| `docs/bend2/laws-design-notes.md` | `2dfc4afaa259eff931fbc530fc5fb986ac6462b4c14e0da0f6f363723ccd8233` |

## Binding entries

The operative entries are M-1, M-2, M-3a, M-3b, M-3c, M-4, M-5, M-7, M-8, M-10, M-11,
M-12, M-13, M-14, M-17, and M-18. M-6 and M-9 are absorbed into M-8. M-15 is deferred.
M-16 remains a writing instruction outside the application laws.

The final review identifies nonblocking historical and summary corrections. They may be fixed
during normal document maintenance and require no further law-approval cycle. Checked encodings,
application invariants, and host-effect conformance must establish their own stated guarantees.

## Architecture and phase entry

The separate Codex architecture review remains open at this recovery checkpoint. Its verdict
must be incorporated into the architecture and rewrite plan before an affected phase starts.
The known findings require these corrections:

- Affine-capability and automatic-cleanup claims must account for `LANG-F-26` and `LANG-F-28`.
- Phase 4 publication must establish the designated shared destination required by M-18.
  The current resident's `swarm.integrate` updates a local ref; its publication hook and an
  independent remote-ref observation establish whether the change reached GitHub.
- Durable storage requires evidence for crash recovery and the necessary host primitives.
  Base File read/write examples establish only the operations they exercise.
- `LANG-CAP-01/08/09/10` identify filesystem durability, HTTP/TLS, cancellation and supervision,
  and cryptography prerequisites.

Rewrite authorization permits work on these prerequisites and other phases whose entry
conditions are met. Production authority changes remain subject to the phase's verification
and rollback requirements in [rewrite-plan.md](rewrite-plan.md).
