# Phase 86 — Independent Rerun Review (Progressive Execution AX)

- **Role:** `glm-rerun-review` — independent rerun reviewer (`glm/glm-5.2@xhigh`).
- **Date:** 2026-07-19.
- **Scope:** The Phase 86 progressive-execution AX implementation as it exists in the
  **effective repository tree** — i.e. the live working tree on top of the committed
  `a839909` (phase 69) baseline, which is the materialized form of the `Baton private
  effective-tree snapshot` (`4abb06c`). Reviewed as the on-disk working tree, not as a
  printed diff. All line pointers were cross-checked against the bytes on disk
  (`node:fs`) and, where behavior was in question, against runtime execution.
- **Deployment profile:** `default@8fd8e95ac30a609dfef0e19564b2cb59e03115aa0c0dd90a6a1aae93d6c49805`
  (distinct from the earlier `glm-ax-critic` profile `default@d0b1194f…`).
- **Focus areas (from the rerun brief):** progressive hidden-guard AX; two-restart
  stop/reap convergence; all-depth inspection finalization; atomic no-replace export
  helper hardening; projected-runtime Claude authentication readiness; provider auth
  classification; credential projection; captured Git path-scope enforcement; and
  whether the new Brief clearly separates full harness permission from write authority.
- **Method:** read-only source/test review; every shell operation via `rtk` (one command
  per call); no nested Baton invoked; no home state, credentials, toolchains, shims,
  caches, or global configuration mutated (see *Environmental note*).

## Verdict

**No P0 or P1 defects. All nine reviewed acceptance points are sound.** The Phase 86
work directly closes the two substantive findings from the earlier `glm-ax-critic`
review (P2-1 inspect-ceiling gap → fixed by PX1's all-depth finalizer; P2-2 ambient-`PATH`
`python3` dependency → fixed by PX3's absolute preflighted helper). A small number of
non-blocking observations/residuals are listed at the end; none block completion.

## Deployment verification

Ran the exact deployment verification command encoded in the Phase 86 runner
(`docs/reference/evidence/phase86-progressive-execution-ax-dogfood-live-2026-07-18/run.mjs:34-42`):

```
node --test \
  impl/test/phase12-web-operator.test.mjs \
  impl/test/phase67-change-aware-inspect.test.mjs \
  impl/test/phase67-progressive-agent-experience.test.mjs \
  impl/test/phase67-self-describing-continuation.test.mjs \
  impl/test/phase67-run-terminality.test.mjs \
  impl/test/phase78-concise-deployment-factory.test.mjs
```

- **Result:** `tests 43 · pass 43 · fail 0 · EXIT=0` ✅
- Additional PX-scoped suites run independently and green: `phase66-result-export-adversarial`
  (PX3), `credential-projection` (PX4), `phase83-context-runtime-red` (PX5 path-scope),
  `phase80-revision-restart-stop-red` + `phase70` family (PX2), `phase78-deployment-readiness`
  + `phase71-kimi-credential-setup` (PX4 auth) — 28 + 20 + 16 tests, all pass.

### Environmental note (constraint-compliant; no shim mutation)

The earlier `glm-ax-critic` review worked around a dead `asdf` `python3` shim
(`/Users/wahargis/.asdf/shims/python3`, exit 126) by **moving the shim aside** so `python3`
on `PATH` resolved to homebrew Python. That is a home-state/toolchain mutation, which this
rerun's constraints forbid. **It is also no longer necessary:** PX3's hardened publication
helper resolves `/usr/bin/python3` by absolute path + `realpath` and ignores `PATH`
entirely (`impl/src/result-export.mjs:81`), so the dead `asdf` shim cannot affect
publication. Verified empirically — `/usr/bin/python3` is present, `uid 0`, mode `755`,
executable — and `phase66-result-export-adversarial.test.mjs:120` ("atomic publication
ignores ambient PATH and Python import-hook authority") passes without any home mutation,
poisoning both `PATH` and `PYTHONPATH` with a sentinel-touching fake `python3` and asserting
neither sentinel fires. The previously-failing `AX5` export cascade now passes for the same
reason. No environmental blocker was encountered.

## Per-area findings

### PX1 — Progressive hidden-guard AX + all-depth inspection finalization — **SOUND**

One internal response-size guard finalizes **every** inspect depth, not only the outline.
`_finalizeSemanticInspection` (`impl/src/application.mjs:7046-7053`) measures
`Buffer.byteLength(JSON.stringify(finalized))` against `bounds.maxBytes` and throws
`application_inspect_oversize` without echoing the numeric guard.

- Both inspect code paths route every depth through it: the live `inspect()` cascade at
  `impl/src/application.mjs:7392` (outline), `:7411` (index), `:7420` (section), `:7433`
  (item), `:7445` (content), `:7463` (evidence); and the historical
  `_historicalProfileInspection` cascade at `:7180, :7212, :7221, :7233, :7244, :7262`.
- The `content` depth is double-guarded: it is byte-paged by `_contextItemContent`
  (`:5933-5976`), which throws `application_inspect_oversize` when a single item alone
  exceeds the deployment budget (`:5965-5968`) and otherwise paginates
  (`nextOffset`/`truncated`), and the assembled content response is then passed back through
  `_finalizeSemanticInspection` (`:7445`).
- The Run view itself is separately bounded before freeze (`:5506-5508`,
  `application_run_view_oversize`), so even the source view cannot exceed `MAX_RUN_VIEW_BYTES`.
- No internal byte/file bound leaks into the serialized response: the main `_buildView`
  return object (`:5441-5505`) has **no `policy` field** (so `policy: clone(view.policy)` at
  `:7177`/`:7199` is `undefined` and is omitted by `JSON.stringify`), and the historical
  view's `policy` is a sanitized descriptor `{state,reason,currentProfileApplied,mutationAuthority}`
  with no numerics (`:3684-3687`).
- Verified by `AX2b: one hidden finalizer bounds every semantic inspection depth` and
  `AX2: …without raw default leakage` (`impl/test/phase67-progressive-agent-experience.test.mjs`).

This **directly resolves the earlier review's P2-1**, which flagged the `section`/`item`
depths as bounded by item-count only. Those depths are now bounded by the same byte guard as
every other depth.

### PX2 — Two-restart stop/reap convergence — **SOUND**

The restart-safe stop path is exactly as the spec describes. In `stopRunTargets`
(`impl/src/coordinator.mjs:1205-1289`):

- The absence transition fires only on the conjunction
  `handle.currentIncarnation !== true && handle.processRef?.state === 'unconfirmed_after_restart'
  && !processGroupAlive(handle.processRef.processGroupId)` (`:1231-1233`). It then appends one
  durable `control.recovery_process_absent` (`:1234-1242`, payload
  `recoveryProcessAbsentPayload` at `impl/src/process-lifecycle.mjs:101-109`), closes the
  process coordinate (`processRef.state = 'closed'`, `:1244`), and idempotently releases the
  owned runtime scope and worktree (`:1246-1248`) **without sending any signal**.
- The convergence loop (`:1263-1288`) returns a receipt only when dispositions are complete,
  resources are released, interactions are resolved, **and**
  `processesObserved === processesClosed` (`:1270-1272`); otherwise it `break`s and retries
  until the deadline, finally throwing `coordinator_run_stop_incomplete` (`:1288`).
- "No signal sent to an unverified reused process identity" is enforced structurally, not by
  the absence branch alone: numeric process attribution requires
  `currentIncarnation === true && localAuthority === true`
  (`lifecycle.process_started` validation, `:7666-7670`; `_ownsLocalResources` `processOwned`,
  `:1393`); and a pre-restart orphaned handle returns `{ok:false,result:'session_not_attached'}`
  from `kill()` rather than reaching the adapter/numeric kill path (`:5157-5159`). The restart
  replay marks any live pre-restart `processRef` `unconfirmed_after_restart`
  (`impl/src/coordinator.mjs:8917`), so a restarted controller never treats a stale PID/PGID as
  its own to signal. `processGroupAlive` (`impl/src/process-lifecycle.mjs:10-18`) probes with
  signal `0` only (a no-op), so even the liveness check cannot disturb a reused identity.

The **live** two-restart recovery is captured in `recovery.json`: both interrupted Runs
(`run-b5ed8189…`, `run-24d140e0…`) converged with `remainingCount:0`,
`counts.processesObserved === counts.processesClosed === 1`, disposition `alreadyTerminal`
(`killConfirmed:0`), and `ownership.workers:0` after `baton.close()` produced
`closed.workers:0` — i.e. zero workers after application close, matching every PX2 acceptance
criterion. The unit variants are covered by `AR80-RS1`/`AR80-RS2`
(`impl/test/phase80-revision-restart-stop-red.test.mjs`) and the phase 70 stop family.

*Caveat (out of spec, non-blocking):* for the case the spec explicitly excludes — a
pre-restart process whose numeric group still appears alive at restart B — Baton fails closed
(deadline → `coordinator_run_stop_incomplete`) rather than converging or signaling. That is
safe; the PX2 scenario is "after the provider exits," where the absence path converges.

### PX3 — Atomic no-replace export helper hardening — **SOUND**

`publishResultExportNoReplace` (`impl/src/result-export.mjs:114-150`) does not resolve any
security-critical helper through the worker's ambient `PATH`:

- The bridge interpreter is resolved by **absolute path + `realpath`** —
  `realpathSync('/usr/bin/python3')` (`:81`) — never via `PATH`. It is preflighted as a regular
  file, not a symlink, `uid === 0`, executable, and not group/other writable
  (`trustedNoReplaceInterpreter`, `:77-93`), returning typed
  `result_export_publication_unavailable` if absent or untrusted.
- Immediately before spawn, the dev/ino identity is re-checked against the preflight result
  (`:126-130`), narrowing the TOCTOU window to root-only swaps (outside the worker threat
  model).
- The helper is spawned with `env:{LANG:'C',LC_ALL:'C'}` and `-I -S -B`
  (`:131-138`) — isolated mode, no user site, no `PATH`, no `PYTHONPATH` — and receives an
  already-opened export-root directory as fd 3 plus only direct-child names
  (`directChildName`, `:95-108`). Neither `PATH` nor child-side path resolution participates in
  the publication effect.
- The bridge invokes the kernel atomic primitives directly —
  `renameatx_np(…, RENAME_EXCL=0x4)` on Darwin / `renameat2(…, RENAME_NOREPLACE=1)` on Linux
  (`NO_REPLACE_PYTHON`, `:25-75`) — not a check-then-rename race. `EEXIST` is mapped to a typed
  occupation error (`:141`); adversarial concurrent no-replace is preserved because the
  primitive is atomic.

This **directly resolves the earlier review's P2-2** (which described a `PATH`-resolved
`python3`). Verified by `phase66-result-export-adversarial.test.mjs:120` and the now-green
`AX5` export cascade.

*Residual observation (within spec, non-blocking):* deployment `doctor` still does not
pre-probe the no-replace primitive, so a deployment lacking `/usr/bin/python3` or kernel
support discovers the unavailability at export time (fail-closed
`result_export_publication_unavailable`), not at `openBaton`. The spec's "deployment-resolved,
absolute, preflighted helper with typed availability evidence" is satisfied by the publish-time
preflight, so this is a hardening suggestion, not a defect.

### PX4 — Projected-runtime Claude authentication readiness — **SOUND**

Readiness is **observed**, not inferred from a filename.
`ClaudeSessionCli.authenticationReadiness` (`impl/src/claude-session.mjs:296-339`) runs the
worker's own `claude auth status --json` inside the projected private worker runtime
(`env:{...env, ...this._cfg.env}`, `:305-309`) and classifies:

- `status.loggedIn === true` with a clean exit → `{state:'ready', credentialState:'verified'}`
  (`:322-327`);
- `status.loggedIn === false` → `{state:'blocked', code:'authentication_refresh_required',
  credentialState:'refresh_required'}` (`:328-334`);
- anything else (including a thrown probe or non-JSON/garbage) → `authentication_probe_invalid`
  / `authentication_probe_unavailable` (`:296-302, :335-338`) — fail-closed.

Runtime provider testimony is classified consistently: `authentication_error` and
`/^Not logged in … Please run (?:\/login|claude auth login)\.?$/` map to
`authentication_refresh_required` (`claudeResultFailureCode`, `:248-253`), never to a generic
provider failure, and the result summary is rewritten to a safe fixed string in that case
(`makeResult`, `:233-246`). Verified by `DP3`, `DP3b` ("adapter authentication is probed only
inside the projected private worker runtime"), and `DP4`
(`impl/test/phase78-deployment-readiness-red.test.mjs`).

### PX4 — Provider auth classification — **SOUND**

Kimi (`kimiAuthenticationState`, `impl/src/application-deployment.mjs:293-353`) and Grok
(`grokAuthenticationState`, `:365-433`) classify bounded credential metadata into a closed set:
`ready`/`available` vs `authentication_refresh_required` (local-clock expiry, or Kimi's exact
revoked-tombstone shape at `:315-330`) vs `authentication_required` (absent) vs
`authentication_metadata_invalid` (malformed). The classification is honest about evidence
strength: metadata-based routes report `credentialState:'available'`, **not** `'verified'`,
reserving `'verified'` for the live-probed Claude route — exactly the PX4 principle that "a
credential file's existence is at most `unverified`." Grok refuses multi-scope ambiguity rather
than guessing a convenient ready entry (`:410-414`). `DP4` ("credential-present Grok, Claude,
GLM, and native Kimi stay blocked when executable compatibility is unobserved") confirms
presence ≠ ready.

### PX4 — Credential projection — **SOUND**

`projectCredentialTree` (`impl/src/credential-projection.mjs:89-161`) copies a fixed relative
allow-list from an owned source tree into a fresh `0o700` private tree and returns only
`{count, redactProviderFrame}` — no source path or credential name leaks. Source-side defenses
are rigorous: every source directory and file is checked for ownership (`uid === process.getuid`),
non-symlink (`O_NOFOLLOW`), and non-group/other-writable mode (`assertOwnedSafeDirectory`,
`:20-27`); relative paths reject absolute, NUL, `.` and `..` (`normalizeRelativeFile`,
`:29-38`); and each file is opened `O_RDONLY|O_NOFOLLOW` with a dev/ino/size/mtimeNs/ctimeNs
identity check before and after read (`sameIdentity`, `:40-43`, `:118-134`). Collected
secret-shaped values feed an in-memory redactor (`collectRedactions` `:45-69`,
`redactStrings` `:71-83`) applied to provider frames, never written to disk or returned.
Verified by `credential-projection.test.mjs` (redaction of nested frames; refusal of symlinks,
traversal, and source mutation) and `CR83-6: provider-secret sentinels are absent`
(`impl/test/phase83-context-runtime-red.test.mjs`).

### PX5 — Captured Git path-scope enforcement — **SOUND (with the spec's own caveat)**

`pathScopeRegex`/`pathMatchesScope`/`pathInScopes` (`impl/src/path-scope.mjs:5-34`) implement
the documented dialect correctly: `*` → `[^/]*` (one segment), `**` → `.*` (cross-directory),
`?` → `[^/]`, with absolute paths, backslashes, NUL, and `..` rejected for both pattern and
path. I initially suspected a dead `**` branch from a stale file read; refuted it three ways —
`node:fs` shows the guard is `pattern[index + 1] === '*'` (single-char, correct), the compiled
regex for `src/**` is `^src\/.*$`, and `pathInScopes('docs/a/b/c/d.md', ['docs/**'])` returns
`true` at arbitrary depth. The check is used **fail-closed** as a write/guard boundary:
retained-result changes that escape scope throw `context_result_scope_invalid`
(`impl/src/context-runtime.mjs:604-607`); context-source attestation items that escape the Plan
path scope are rejected (`impl/src/coordination-store.mjs:4056-4057`); and it is an inclusion
filter for indexed context (`impl/src/context-runtime.mjs:411`). A broken glob here could only
over-reject in-scope deep paths, never broaden write scope. Verified by
`CR83-0` (canonical star/double-star/question dialect) and `CR83-9` (narrow write scope retains
authorized read scope).

The PX5 spec itself states post-hoc Git path-scope verification "cannot detect or undo
arbitrary host mutations and therefore cannot satisfy this requirement by itself" — that is a
documented, accepted limitation, not a defect in this code.

### PX5 — Brief separates full harness permission from write authority — **SOUND**

`renderBrief` (`impl/src/adapter.mjs:95-138`) emits a dedicated, unambiguous
`## Write authority` section (`:118-119`):

> "Harness permissions are execution capability, not write authority. Write only inside the
> assigned Baton worktree and only at the Path scope below. Never modify, move, chmod, delete,
> replace, or repair anything outside that authority, including the home directory, credentials,
> toolchains, shims, global configuration, or caches. Report an environmental blocker instead of
> repairing the host."

followed by `## Path scope` listing the exact scope patterns (`:124-127`). This (a) states the
separation outright, (b) restricts writes to the worktree + Path scope, (c) enumerates the
prohibited host surfaces including credentials/toolchains/shims/config/caches, and (d) requires
reporting an environment blocker rather than repairing — matching PX5 and the rerun brief's own
operating constraints verbatim. Because the guard now lives in the Brief, the PX6 condition "no
new live full-permission worker is launched until its Brief carries the write-authority guard"
is satisfied.

### PX6 — Reflexive evidence and incident accounting — **SOUND**

The Phase 86 runner (`run.mjs`) uses only the sanctioned surface: `openBaton` → `baton.doctor()`
→ `baton.startMany()` → `group.complete()` → `group.inspect({depth:'section',section:'result'})`
→ `run.stop()` per Run → `baton.close()`. It performs no environment-variable budget ceremony
and removes stale report files before launch (`run.mjs:25-27`), satisfying PX6's "stale report
files are removed before launch." The runner's own verification command is the deployment
verification cited above. The earlier review's reflexive incident list (Kimi OAuth login
required, Claude readiness-from-filename, the GLM-through-Claude shim change, the ambient
`python3` export dependency, the two-restart stop/reap gap, and the missing all-depth
final-size check) is consistent with what PX1–PX5 now address in source.

## Observations and residuals (non-blocking)

1. **PX3 doctor probe (carry-over hardening).** The no-replace primitive is preflighted at
   publish time but not at `doctor`/`openBaton`. A deployment without `/usr/bin/python3` or
   without `renameatx_np`/`renameat2` support fails closed at export. Within spec, but a
   `doctor`-time probe would make the dependency declared rather than discovered.
2. **PX2 alive-but-unverified edge.** Outside the spec's "provider has exited" scenario, a
   pre-restart process whose numeric group still appears alive fails closed to
   `coordinator_run_stop_incomplete` rather than converging. Safe; noted for completeness.
3. **P2-3 (compatibility `run.wait` not bound to `followPolicy.maxWaitMs`).** This was raised
   by the earlier review and is outside the PX86 acceptance set; it is a low-exposure
   compatibility-command consistency nit, not a PX86 regression, and I did not re-verify it
   here.

## Pointers index

- PX1: `impl/src/application.mjs:7046-7053` (`_finalizeSemanticInspection`),
  `:7180,7212,7221,7233,7244,7262` (historical depths), `:7392,7411,7420,7433,7445,7463`
  (live depths), `:5959-5968` (content per-item guard), `:5506-5508` (view ceiling),
  `:5441-5505` (main view, no `policy` field), `:3684-3687` (sanitized historical policy).
- PX2: `impl/src/coordinator.mjs:1231-1252` (absence path), `:1263-1288` (convergence),
  `:1270-1272` (observed===closed), `:5157-5159` (kill refuses orphaned),
  `:7666-7670` & `:1393` (current-incarnation attribution), `:8917` (restart replay);
  `impl/src/process-lifecycle.mjs:10-18,101-109`; `recovery.json` (live evidence).
- PX3: `impl/src/result-export.mjs:77-93` (`trustedNoReplaceInterpreter`),
  `:114-150` (`publishResultExportNoReplace`), `:25-75` (`NO_REPLACE_PYTHON`),
  `:126-130` (dev/ino recheck), `:141` (EEXIST mapping).
- PX4: `impl/src/claude-session.mjs:296-339` (Claude readiness), `:248-253`
  (runtime classification), `:233-246` (safe summary);
  `impl/src/application-deployment.mjs:293-353` (Kimi), `:365-433` (Grok);
  `impl/src/credential-projection.mjs:89-161` (`projectCredentialTree`), `:45-69`
  (`collectRedactions`).
- PX5: `impl/src/adapter.mjs:95-138` (`renderBrief`; write authority `:118-119`,
  path scope `:124-127`); `impl/src/path-scope.mjs:5-34`;
  `impl/src/context-runtime.mjs:411,604-607`; `impl/src/coordination-store.mjs:4056-4057`.
- PX6: `docs/reference/evidence/phase86-progressive-execution-ax-dogfood-live-2026-07-18/run.mjs`
  (whole; stale cleanup `:25-27`; verification command `:34-42`).

## Tests run (all green)

- Deployment verification (`run.mjs:34-42`): `phase12-web-operator`,
  `phase67-change-aware-inspect`, `phase67-progressive-agent-experience`,
  `phase67-self-describing-continuation`, `phase67-run-terminality`,
  `phase78-concise-deployment-factory` — **43 pass / 0 fail, EXIT 0**.
- PX-scoped: `phase66-result-export-adversarial`, `credential-projection`,
  `phase83-context-runtime-red`, `phase80-revision-restart-stop-red`, `phase78-deployment-readiness`,
  `phase71-kimi-credential-setup` — all pass.
