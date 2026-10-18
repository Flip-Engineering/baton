# Publishable source bundle: accounts-glm correctness landing

Status: bundle receipt, 2026-10-17, seat accounts-glm, branch `accounts-glm-793-702`;
this commit is the bundle tip.

## Source binding

- Base: `account-credit-base` `1658d4543bd57b984d58ce968f0b109e32abc6ec` (`1658d45`, the G2 repair; lineage
  `895f995` -> `44db78d` -> `637f6b6` -> `39ca8c1`/`393cf9d` -> `dd62ce8`).
- This branch contains base in full plus this seat's landing: the G3 admission guards, the
  pin-canonical arrow form, G5/C12 v1 status-first classification, R-G2a, the C7/C9 fixtures,
  and the C8 probe with its remote-queue registration.

## Contents

1. G3 admission guards (`bend2/src/coordinator/accounts.bend`): `json_valid` bound into
   observe and import admission; reported organization observations require a document id;
   the verification UPDATE gates organization and verified_at on a nonempty id.
2. Pin-canonical arrow form: all `IO<Unit>` signatures in `accounts.bend` (42) and the
   fixture `account-credits.bend` (26) replaced with `IO(Unit)`; grep receipts: zero
   remaining in both files. `usage.bend` carries six `IO<Unit>` occurrences from the #792
   work and is flagged to the conductor for that lane, not edited here.
3. G5/C12 v1 (`subscription-fallback.bend`): a failed Claude result frame with
   `api_error_status` 402 classifies as billing exhaustion by status, before wording; the
   documented tier-cap 429 and spend-limit 400 shapes stay on wording until an observed
   fixture terminal names them, per the observed-failure rule.
4. R-G2a (`subscription-fallback.bend`): `exhausted_reported` accepts the
   `account-exhausted` report beside `profile-exhausted`, so an account-bound session that
   exhausts its last account reaches the cross-harness route path with the task retained.
5. C7 and C9 fixtures (`bend2/test/account-credits.py`, now 15 tests): last-account
   exhaustion report and wake; two-session isolation where one session's exhaustion and
   advance leave the other session's binding and attempt record untouched.
6. C8 probe (`bend2/test/api-key-exec.test.mjs`, registered as `node-api-key-exec` in
   `check-native-parallel.py`): the launch wrapper's confinement invariant, executed.

## Check receipts

- EXECUTED on this host: `node --test bend2/test/api-key-exec.test.mjs` -> # tests 5 # pass 5 # fail 0 
  (node v22.23.3).
- Syntax receipts: `account-credits.py` and `check-native-parallel.py` parse clean
  (`ast.parse`).
- PENDING remote: Bend compiler check for `accounts.bend`, `subscription-fallback.bend` and
  the fixture (no bend toolchain installed on this host; the pinned reference is
  `docs/bend2/reference/toolchain/install-2.0.25.sh`); the behavioral suites
  (`account-credits.py` 15 tests, `observed-usage.py`, `logs.py`, `turn.py`) drive the
  built coordinator binary.

## Runtime notes

- Node runs executed under the host cgroup; no Bun driver was used. Bun-based drivers on the
  slot should run with ample or unlimited virtual address space per the operator's budget
  note.
- The macOS browser worker holds in a separate local database (TCC/Chrome consent pending);
  account identity, Max entitlement and monthly API-credit organization and balance remain
  UNVERIFIED for both accounts. Nothing in this bundle claims login setup, entitlement, or
  balance facts.

## Pinned-compile receipt (for root execution)

The landing's Bend sources need the pinned compiler under the stated budget; no bend
toolchain is installed on this host, so the exact command is prepared for root:

    systemd-run --scope -p MemoryMax=16G -p MemorySwapMax=0 \\
      sh -c 'install docs/bend2/reference/toolchain/install-2.0.25.sh ... && \\
      .bend/bin/bend --check-only bend2/src/coordinator/accounts.bend && \\
      .bend/bin/bend --check-only bend2/src/coordinator/subscription-fallback.bend && \\
      .bend/bin/bend --check-only bend2/test/account-credits.bend'

Constraints honored: 16 GiB real memory, zero swap, unlimited virtual address space (no
RLIMIT_AS is set), no full Main build. The native boundary specification for the runtime seat
is `docs/bend2/api-key-exec-native-boundary.md`.

## Native module status (2026-10-18)

`bend2/harness/api-key-exec.bend` is source-ready: the full product policy
(reference parsing for `file:` and `keychain:` with typed
`unsupportedSecretReference` refusals carrying the scheme only, the
credential variable constant, and the env-spec assembly) in proven Bend2
constructs, outside every check gate until the boundary lands. The boundary
integration facts for the runtime seat are recorded in
`docs/bend2/api-key-exec-native-boundary.md`: the host C layer registers
effects with `BP_EFFECT(name, CID, kind)` where CIDs arrive as `-D` compile
definitions and kinds dispatch through `baton_process_begin_mode` - the new
env-spec spawn effect is one kind there plus one `ProcessChild` wrapper, and
the Bend compiler side of the marshalling is the compiler seat's part.
Source-ready is not runtime-qualified: the module has no compiler check and
no execution until the effect lands and a build runs.

## Coordinated completion hook (for the runtime seat)

The one-line integration the attempt facts need, to land inside the
receive/turn completion paths the runtime seat owns:

- receive path, in `completed_observation` after the outcome is known:
  `Accounts.attempt_completed(db,attempt,outcome_text,error_text)` where
  `outcome_text` is the terminal classification and `error_text` the
  provider's original error text (empty when none).
- direct-turn path, at the same point in `direct_handoff_checked` /
  `direct_second_started` completion: the same call with the direct attempt
  identity.

`attempt_completed` is `INSERT`-free (an UPDATE by attempt directory): a
completion call for an attempt that never recorded still updates nothing and
reports through the ordinary result.
