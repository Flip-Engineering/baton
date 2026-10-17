# REFLEX-3 decisions contract — knowledge/context hand-off packages (F11 resolved)

Ground truth: docs/32 §3.3 (docs/32-reflexive-orchestration.md:160-183), issue #18, the red-team
report in this directory (reflex-redteam.md finding F11 lines 205-231 and correction #10 lines
338-343). Code: the ledger-derived binding precedent `scratchFactOracleTarget`
(coordination-store.mjs:11564-11585 — derives provenance from `this._events[fact.createdEvent-1]`,
binds `sourceEventSeq`/`sourceEventDigest`, refuses on mismatch with `scratch_oracle_integrity`);
the reserved-field guard `_knowledgePayload` (rejects lifecycle-owned fields on submission,
coordination-store.mjs:11648-11651); the shape-normalization precedent `normalizeContextManifest`
(deletes the supplied `digest`, `exact()`-checks fields, recomputes, context-program.mjs:183-192);
manifest branch normalization (context-program.mjs:178-181); resolve-time verification
`withContextArtifactVerification` (application.mjs:8165, :9903); §93.5 ValueRef read rules
(spec/phase93-closed-program-ir.md:308-316 — "schema-validated on write and every read … Missing
or changed bytes settle `artifact_unavailable`; they are never silently recomputed"). F11 names
three independent holes in §3.3; each is pinned below.

## Part A — provenance from the admission ledger event, not a self-cited envelope (F11.1)

The doc's `packageDigest` covers `provenance.packageEvent`, but the admission event cannot exist
before the digest, so a submitter-supplied `packageEvent` is either circular or an *unverified
claim* the hub would propagate as if hub-computed (F11.1, reflex-redteam.md:209-216). The scratch
oracle already solves exactly this by deriving the binding from the ledger event itself.

1. **`packageEvent` is hub-derived, never submitted.** `provenance.packageEvent` is a
   lifecycle-owned field: the admission envelope MUST NOT carry it, and a submission that does is
   refused (`reserved_package_field`) with the reserved-field stance of `_knowledgePayload`
   (coordination-store.mjs:11648-11651). The hub admits the package, then binds
   `packageEvent = { sourceEventSeq, sourceEventDigest }` from the admission event it just
   appended — `this._events[...]` indexed exactly as `scratchFactOracleTarget` does
   (coordination-store.mjs:11572, 11581-11582).
2. **Bind after admission; recompute on replay.** `packageDigest` is computed over the branch/
   policy body **without** `packageEvent`, using the delete-and-recompute discipline of
   `normalizeContextManifest` (context-program.mjs:183-192); the ledger-derived `packageEvent` is
   the commitment that *points at* that admission, not an input to the digest. On replay the hub
   re-derives `packageEvent` from the same log position; a disagreement between the stored binding
   and the recomputed one is a loud `CoordinationIntegrityError('package_provenance_integrity')`,
   the shape of `scratch_oracle_integrity` (coordination-store.mjs:11574-11575), never a silent
   accept. Result: "branch content … carries its provenance" (§3.3 line 181) means hub-computed
   provenance, not a worker-authored claim.

## Part B — branch identity: unique names, at-least-one ref (F11.2)

`branches: exact{name, source|null, artifact|null, valueRef|null, schema|null}[0..max]` as drafted
admits duplicate names and all-null branches; a reader resolving by name (the only key) gets
ambiguous lineage, and a zero-content named branch is a placeholder a worker can be told to trust
(F11.2, reflex-redteam.md:217-222). `ContextManifest` normalization exists to pin this class of
shape (context-program.mjs:183, branch normalization :178-181).

3. **Normalize like a manifest.** Package admission runs a `normalizeContextPackage` in the
   `normalizeContextManifest` mold (context-program.mjs:183-192): `exact()`-check every field,
   delete-and-recompute `packageDigest`, bound the branch count to `policy.maxEvidenceRefs`
   (§3.3 line 168), and reject unknown fields — no partial/loose acceptance.
4. **Unique names.** Duplicate branch `name`s are refused at admission
   (`package_branch_name_conflict`); `name` is the sole resolution key and must be unambiguous.
5. **At least one ref per branch.** Each branch requires **exactly-one-or-more** of
   `source`/`artifact`/`valueRef` non-null (a `schema` alone is not content); an all-null branch
   is refused (`package_branch_empty`). No lineage placeholder can be minted for a worker to
   trust.

## Part C — revalidate at resolve/read, not at attach (F11.3)

The doc's "every branch resolves (artifact bytes revalidated …) at admission and at every attach"
(§3.3 lines 174-176) is O(total package bytes) per attach: attaching one package to a run, M
workers, and B boards is (1+M+B) full re-reads (F11.3, reflex-redteam.md:223-231). §93.5 already
makes revalidation-on-*read* mandatory; revalidation on *attach* (a ledger transition, not a read)
is unbounded cost the doc neither justifies nor bounds.

6. **Validate once at admission.** At `package.admitted` the hub validates the package once:
   normalize (Part B), compute+bind the digest and provenance (Part A), and resolve each branch
   ref once to confirm it exists (artifact bytes present, ValueRef registered) — the single
   verification point, not a per-attach loop.
7. **Attach is a fenced pointer binding, not a re-read.** `run.attach_package(run, packageDigest,
   { scope:"run"|"worker:<role>"|"board:<board>" })` is a durable, replay-exact, fenced binding of
   an *already-admitted* digest to a scope. Attach performs **no** byte re-read and **no**
   re-digest — it binds an immutable pointer. Attaching to N scopes is N cheap bindings, not N full
   package re-reads.
8. **Revalidate lazily at resolve/read time, per §93.5.** Branch bytes are revalidated when a
   reader *resolves* a branch (brief render, Bench read, board read), through
   `withContextArtifactVerification` (application.mjs:8165, :9903) — exactly §93.5's
   "schema-validated on write and every read"; missing or changed bytes settle
   `artifact_unavailable` and are never silently recomputed (spec/phase93-closed-program-ir.md:
   313-316). Resolve-time revalidation subsumes what attach-time revalidation would have caught,
   without the (1+M+B) attach cost.
9. **Stated threat model (why attach-time re-read is droppable).** Package artifacts are immutable
   and content-addressed; the CAS cannot change bytes under a fixed digest between admission and
   attach (§93.1(2) mutable refs are already forbidden, §3.3 line 180), and §93.5 already forces a
   fresh schema-validated read at every *resolve*. The only drift attach-time re-reading could
   detect — a missing/changed artifact — is precisely what resolve-time revalidation settles as
   `artifact_unavailable`. Attach-time revalidation would therefore be redundant work on the
   replay-critical transition path; it is dropped deliberately, not omitted. (If a future
   deployment treats the CAS as untrusted between admission and attach, that is a *named* threat
   model that would re-introduce attach-time revalidation — it is not the default.)

## Part D — projection sanitization (F14, carried)

10. **Branch content is untrusted input to every reader.** Package projections (brief branch
    digests + schemas, RunView/CLI/MCP surfaces) route worker-authored text through the
    `boundedAttentionText`/`SECRET_SHAPED_TEXT` discipline (application.mjs:196-203) and carry
    untrusted-prose provenance marking (F14, reflex-redteam.md:282-294). The package carries no
    credentials and no mutable refs (§3.3 line 180).

## Part E — red tests first (`impl/test/reflex3-packages-red.test.mjs`)

F11.1: a submission carrying `provenance.packageEvent` is refused (`reserved_package_field`); the
admitted package's `packageEvent` binds the real admission event's `sourceEventSeq`/
`sourceEventDigest`; replay re-derives the same binding and a tampered binding raises
`package_provenance_integrity`. F11.2: duplicate branch names refused; an all-null branch refused;
a `schema`-only branch refused; branch count over `policy.maxEvidenceRefs` refused; a submitted
`packageDigest` mismatch refused (delete-and-recompute). F11.3: attach performs no byte re-read
(no `artifact_unavailable` work at attach) and is O(1) per scope; a branch whose artifact bytes go
missing settles `artifact_unavailable` at *resolve* time (not attach); attaching to run+worker+
board is three cheap bindings, not three full re-reads. Replay: packages replay byte-for-byte and
are never relabeled. Sanitization: branch projections are redacted and provenance-marked.

## Part F — boundaries

Packages are immutable artifacts (mode-0600 receipt); new content = new digest, never mutation in
place (§3.3 line 180). No submitter-authored provenance (hub-derived only). No attach-time byte
re-read (resolve-time revalidation per §93.5 is the single read-verification point). No new event
kinds beyond `package.admitted`/`package.attached` and the named replay reconstruction. No
credentials, no mutable refs. Do NOT modify the evaluator (`context-program.mjs`) or §93.5 read
semantics. No git commits, no scratch/log writes anywhere (including /tmp).

## Part G — validation

Focused suite green, then the full suite `node impl/scripts/run-suite.mjs` green from the worktree
root; the wave-driver reviewer contract (`node --test impl/test/wave-driver-red.test.mjs`, exit 0)
stays green.
