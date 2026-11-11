EVAL_R0-VERIFY v1

[attempt: c8714a30-7464-49c5-904e-58a05ad458d8 coordinator]

# EVAL-R0 coordinator verification — eval-r0-2026-08-14-wave-a

Every claim below is cited evidence (coordination event seqs, on-disk files, git objects) or
an explicitly named absence. No clocks, no fabrication.

## VERDICT

**needs-fold with blockers** — the row's report (`eval-r0-report.md`) is a STOP + DECISION_REQUEST
preflight record, its preflight evidence is overwhelmingly verified, and its halt behavior was
correct per the row brief — but it contains one material factual error in its primary blocking
condition (§3.1) plus two secondary items. It is not cleanly "sound" as-is.

Blockers:
1. **§3.1 auth claim is wrong about the parent repo root.** The report states *"No
   `deepseek_key.json` exists at this worktree's root (or the parent repo root); no `glm_key.json`
   either."* The worktree-root half is true, but **both keys exist at the main repo root**
   `$HOME/Development/Experiments/baton/`: `deepseek_key.json` (55 B,
   `{"deepseek_key":"sk-3b1bcf63f8…"}`) and `glm_key.json` (64 B, `{"glm_key":"17073c24317a…"}`).
   The deployment resolves the credential via `deepseekCredentialProjection(repoRoot)` →
   `join(repoRoot,'deepseek_key.json')` (`impl/src/application-deployment.mjs:107-112`) with
   `repoRoot = repository.root` from `repositoryAuthority(rawOptions.repo ?? process.cwd())`
   (`:1752, :1912`). So the credential IS present at the main repo root; whether an eval arm
   sees it depends on the session's repo/cwd resolution, not on its absence. DECISION_REQUEST
   option A ("Operator provisions `deepseek_key.json` at the repository root") is partly moot —
   the key already exists there. The row's independent capacity blocker (§3.2, ~8–10 seat-hours
   for ten waves) still justifies the STOP on its own.
2. **§2.1 result-pin count is 461 in the report; the repo currently holds 473** under
   `refs/baton/results/*` (`git for-each-ref`, newest pins 2026-08-13). Minor variance —
   consistent with concurrent pin growth, not a substantive error.
3. **Wavefile report-file naming mismatch (coordination).** The wavefile's `report`/`harvest`
   fields target `notes-row-eval-r0.md` (must contain "attempt:"); the row delivered its
   brief-named deliverable `eval-r0-report.md` (which DOES contain the attempt line) and no
   `notes-row-eval-r0.md`. The harvest target is therefore absent.

## Signal and settlement (evidence: coordination event log)

- `signalOnMembersDone` was delivered to this coordinator as message
  `5977685db82f103d091d2405c7be060561b06e280dd4d0325f4e749b535551e9` (kind `result`,
  worker `w-435`).
- The row (worker `w-436`, worktree `ws-bb3f1e275aa069604bc83ab380528973`) settled and committed
  commit `317f3a6f` (07:30) — 14 files: `eval-r0-report.md`, `era-brief-content.md`,
  `t0-red-at-base.sh` + 5 `t0-results/*.txt`, `t1-grader-ceiling.sh` + 5 `t1-results/*.txt`.
- Row's report verdict: **STOPPED — DECISION_REQUEST. No arms ran. No eval number is reported.**
  This is the correct halt behavior per the row brief ("If the pre-registration demands live
  provider runs you cannot complete from the worktree (auth/capacity), STOP and DECISION_REQUEST
  with options — do not improvise a weaker eval and present it as R0").

## Claims verified CONFIRMED (each against the repo/artifacts)

1. **t0 red-at-base table (§2.2)** — all five splits match the committed `t0-results/*.txt`
   summary lines exactly: trust-gate 21/7/14 · kg-settle 24/3/21 · wave-grammar 5/0/5 ·
   diagnostics 8/1/7 · alias-m5 1/0/1 (tests/pass/fail). All five bases RED.
2. **t1 grader-ceiling table (§2.3)** — all five match `t1-results/*.txt` exactly: 21/21,
   24/24, 5/5, 8/8, 5/5 (all green at each impl commit).
3. **§2.2 corroboration** — `2f2d23b` commit message contains verbatim "21 tests, 14 red at
   named stages, 7 green pins".
4. **§4.4 #63 suite drift** — `git diff 2e22197 e0f9d57 -- impl/test/kg-settlement-red.test.mjs`
   = 19 insertions, 6 deletions, exact.
5. **§4.4 #64 byte-identity** — `git diff 2f2d23b ac5bd80 -- impl/test/trust-gate-steering-red.test.mjs`
   is empty (byte-identical).
6. **§4.1 M5 plant defect** — `grammar-m5-red.test.mjs` @ `bb85e35` imports `checkBannedTokens`
   from `../scripts/surface-conformance.mjs` (lines 20, 24); `checkBannedTokens` present in
   `surface-conformance.mjs` at `bb85e35` (2 hits) and absent at `bbf6791` (0 hits); the suite
   file itself is absent at `bbf6791`. The planted-suite-at-base load-error consequence is real.
7. **§6.2 scorecard pin (partial-check leg)** — `impl-receipt.json` resultSha
   `a1e0a5421e929b445b5f99838012738720b2c2e3`; pin ref `refs/baton/results/a1e0a542…` exists;
   trailers `Baton-Vendor: deepseek:deepseek`, `Baton-Model: deepseek-v4-flash`,
   `Baton-Effort: high` — all match.
8. **§2.4 era brief-content** — #64 manifest `impl-manifest.json` confirmed: `renderedMembers`
   = 1 × role `implementer`, waveId `wave:c12ac073e9b6cf0deda5a32a9f439ab8`,
   idempotencyKey `trust-gate-steering-impl-2026-08-02`, objective 3392 chars — all match the
   report's table.
9. All 10 rung commits exist; all 5 grading suites present in the repo (pre-reg §2 grounding).

## Anything unverified and why

- **The two arms and the pivot-criterion verdict:** not run — the row correctly STOPPED; there is
  no eval number to verify. The pivot criterion (§5) was explicitly NOT reached and the row did
  not fabricate a verdict (correct).
- **§6.2 full sealed-scorecard recompute:** the row marked it PARTIAL (needs the #64 deployment
  ledger, unreachable from a row worktree). Accepted as a stated limitation; the pin-identity +
  route-trailer leg is verified above.
- **Whether the eval session's `repoRoot` resolution reaches the main-repo-root credentials:**
  not decidable from this worktree — depends on how the operator re-dispatches (cwd / `repo`).
  This is the substance of blocker #1.
- **gh / issue #107 tracker text:** `gh` is unauthenticated in this worktree (verified); the row
  correctly grounded in the repo's pre-registration text. Any tracker-vs-repo discrepancy is
  outside what either the row or this coordinator could check.

## DECISION_REQUEST — authority-class ambiguity

The row's §6 options remain the right shape, with blocker #1 amended:
1. **HOLD / re-dispatch (protocol unchanged)** — before re-running the arms, resolve whether the
   eval session can use the existing `$HOME/Development/Experiments/baton/deepseek_key.json`
   (does the deployment's `repoRoot` resolve to the main repo or the worktree?). The capacity
   envelope (~8–10 seat-hours) and the §6.2 scorecard recompute still gate any arm run.
2. **FOLD-NOW** — abandon the wave at this stage; only if the operator decides the eval cannot
   proceed at all.
3. **PROVISIONAL-ACCEPT** — accept the report as the preflight record, require the §3.1
   correction (and the decision on the M5-plant / #63-pin sub-questions) before any arm session
   is dispatched.

The M5 plant-defect and #63 suite-digest sub-questions (§6.1/§6.2 of the row's report) are
sealed-protocol amendments that need the operator under any option; this coordinator confirms
the underlying facts are real (§4.1 verified, #63 drift verified) and does not decide them.
