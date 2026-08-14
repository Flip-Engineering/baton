EVAL_R0-VERIFY v1

[attempt: 324fd864-db96-4d60-a871-cd9e11ee65b7 coordinator]

# EVAL-R0 coordinator verification — eval-r0-2026-08-14-wave-b (redrive1)

Every claim below is cited evidence (coordination event seqs, on-disk files, session
transcripts, git objects) or an explicitly named absence. No clocks, no fabrication.

## VERDICT

**needs-fold with blockers — point-in-time.** At verification time the row's deliverable
`notes-row-eval-r0.md` does not exist on disk, because row-eval-r0 (worker `w-455`, worktree
`ws-0490fae95482f1f0608ae959ef069a00`) is still executing the registered protocol — it is
NOT dead and NOT failed. The verdict cannot be "sound": there is no row report on disk to
audit, no arm runs, no numbers, no pivot-criterion verdict. Blocker: **row not terminal;
deliverable absent.** This is a snapshot finding, not a judgment of the row's work; the row
had already dissolved wave-a's §3.1 blocker (both keys exist at the repo root) and was
establishing a working connection to the live resident at the last observed action.
Re-verification is required when the row settles.

## Signal and settlement status (evidence)

- **`signalOnMembersDone` has NOT been delivered** to this coordinator at verification time.
  The wavefile targets the remaining member with kind `result` when row-eval-r0 settles:
  `signalOnMembersDone row-eval-r0 result "The row settled (you are the remaining member —
  pinned #175 semantics). Verify per your brief and write verify-notes.md."`
  (`redrive1/eval-r0.wavefile:21`).
- My session transcript (`…/runtime/w-454/config/deepseek/projects/…ws-a5879aef…/0dd51fae….jsonl`)
  contains the task dispatch (type `user`, promptId `c3215732-…`) followed by my own tool
  calls/results only — no `result`-kind message has arrived.
- **Dispatch-order anomaly (the authority-class ambiguity):** my coordinator worktree
  `ws-a5879aef41cc9b3c5eae109bd48a4e8f` materialized at `2026-08-14T15:33:36Z`
  (`.baton/capacity/reservations.json`), the row's `ws-0490fae…` at `2026-08-14T15:34:45Z` —
  the coordinator was dispatched while the row was still starting, so the #175 "verify after
  the row settles" handshake cannot have completed.

## On-disk verification (the #174 law — silence is not death; read the row's notes)

- The row is **not silent**: worker `w-455`'s session transcript
  (`…/runtime/w-455/config/glm/projects/…ws-0490fae…/8bc0018f-….jsonl`) was observed growing
  from 39 lines (08:36) to 194 lines (08:48) with fresh mtimes at each observation. The row's
  first message is the wave-b ROW BRIEF with `[attempt: 324fd864-… row-eval-r0]`.
- The row's observed trajectory (transcript tool calls): read `eval-r0-preregistration.md`
  and wave-a's `eval-r0-report.md` (from snapshot `317f3a6f`); confirmed `deepseek_key.json`
  + `glm_key.json` exist at the main repo root; confirmed commit `a3e96e8` (#221) is in the
  base; discovered the live resident deployment (PID 5425, socket
  `/private/tmp/baton-501/4421cf2925043322-7158260f7ed2.sock`); its first raw socket HTTP
  probes timed out (60s / 20s); it excluded the Bash sandbox as the cause and adopted the
  flood script's working `curl --unix-socket` mechanism. It had not yet written any file.
- **Deliverable absent everywhere:** `find /Users/wahargis/Development/Experiments/baton
  -name notes-row-eval-r0.md` returns **0 hits** — absent from `redrive1/` in my worktree,
  from the row's worktree, from all other `.baton/wt/*/` worktrees, and from the main repo.
  The row's worktree `redrive1/` contains only the three base files
  (`coordinator-brief.md`, `eval-r0.wavefile`, `row-eval-r0-brief.md`); `git status
  --porcelain` there shows no uncommitted work.
- Per the #174 law a missing attempt marker is not a dead row: here the row is verifiably
  **alive and mid-flight**, which strengthens the "not terminal" reading over the
  contract-qa precedent (whose rows were reserved-but-never-materialized).

## Ground-truth verified for the eventual audit (all CONFIRMED against the repo)

These are the facts the row's landed claims must build on; I verified them independently so
the final audit can move fast:

1. **Credentials (wave-a §3.1 correction CONFIRMED):** `deepseek_key.json` (55 B) and
   `glm_key.json` (64 B) both exist at `/Users/wahargis/Development/Experiments/baton/`.
   The deployment resolves them via `deepseekCredentialProjection(repoRoot)` →
   `authTokenFile: join(repoRoot, 'deepseek_key.json')` (`impl/src/application-deployment.mjs:107-112`).
2. **#221 law (CONFIRMED):** commit `a3e96e8` "fix(#221): RIP OUT the invented seat-ceiling
   pre-cap — operator ruling" exists and `git merge-base --is-ancestor a3e96e8 HEAD` is true —
   invented seat ceilings are out of the base the row runs from.
3. **Rung table (CONFIRMED):** all ten commits exist (`git cat-file -t`): `ac5bd80`/`2f2d23b`
   (#64), `e0f9d57`/`2e22197` (#63), `480154a`/`3733096` (S-1), `6d0ca11`/`47993f7` (DG-1),
   `bb85e35`/`bbf6791` (M5).
4. **Suite presence matches pre-registration (CONFIRMED):** `trust-gate-steering-red.test.mjs`
   present at base `2f2d23b` (blob `5642f3f6…`); `grammar-m5-red.test.mjs` **absent** at base
   `bbf6791` and present at impl `bb85e35` (blob `4b8af169…`) — the "born-in-impl / planted"
   mode rows check out.
5. **Wave-a preflight artifacts (CONFIRMED):** snapshot commit `317f3a6f` exists carrying the
   14 wave-a files (`eval-r0-report.md`, `era-brief-content.md`, `t0-red-at-base.sh` +
   5 `t0-results/*.txt`, `t1-grader-ceiling.sh` + 5 `t1-results/*.txt`).
6. **Result-pin namespace (CONFIRMED):** `git for-each-ref refs/baton/results/` = **481** pins
   (vs 461 in wave-a's report §2.1, 473 at wave-a's coordinator verification — monotonic
   growth consistent with the concurrent flood, not a discrepancy).
7. **Pre-registration is the binding contract (READ IN FULL):**
   `docs/reference/evidence/eval-scoping-2026-08-03/eval-r0-preregistration.md` (2026-08-07)
   — five rungs (§2), SOLO/DRIVEN arms (§3), sealed scorecard measurement (§4), the quoted
   pivot criterion (§5), preconditions (§6: #125 replay note, scorecard verification, t0
   red-at-base), cost/seat plan (§7). The row brief forbids any scope drift or post-hoc
   criterion edit.

## Anything unverified and why

- **The row's report, the arm runs, the numbers, the pivot-criterion verdict:** not verifiable
  — the row has not settled and `notes-row-eval-r0.md` does not exist. There are no claims to
  spot-audit yet.
- **Whether the row will successfully drive the arms through the resident** (its
  `curl --unix-socket` attempt was the last observed action): in flight, not decidable at
  verification time.
- **gh / issue #107 tracker text:** `gh` is unauthenticated in this worktree (verified); the
  row correctly grounded in the repo's pre-registration text. Tracker-vs-repo discrepancy is
  outside what either party could check here.

## DECISION_REQUEST — authority-class ambiguity (dispatch ordering)

The #175 corrected semantics make the coordinator the recipient of `signalOnMembersDone`
after the watched rows settle. This coordinator was dispatched before the row settled (its
worktree materialized 15:33:36Z vs the row's 15:34:45Z), so the verification trigger cannot
have fired. Who may decide how to proceed is the authority-class question:

1. **HOLD / re-dispatch (protocol-faithful)** — resume or re-dispatch this coordinator once
   row-eval-r0 settles, so the audit runs against the landed `notes-row-eval-r0.md`. This is
   the #175-intended path; my ground-truth record above then serves as the audit's starting
   evidence. Recommended.
2. **PROVISIONAL-ACCEPT** — accept this point-in-time verification as the coordinator's
   record for wave-b, with the explicit requirement of a follow-up audit when the row lands
   (the row's harvest `notes-row-eval-r0.md` mustContain "attempt:" proceeds independently).
3. **FOLD-NOW** — abandon the wave at this stage if the operator judges the eval cannot
   proceed at all.

The underlying facts verified above (keys at repo root, #221 in base, rungs/suites intact)
stand under any option and were true before this wave began.
