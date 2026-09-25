# 42 — Suite verdict: failures, the environment line, the landing comparison

Status: implemented (issue #284; rewritten by #580). The code of record is
`impl/scripts/suite-verdict.mjs` (the verdict), `impl/scripts/run-suite.mjs` (the runner), and
`defaultIntegrationGates` in `impl/src/swarm-runtime.mjs` (the landing comparison). #580 removed
the expected-red manifest (`impl/scripts/expected-red-tests.json`), the `--write-expected-red`
flags, the `converged` list, and the tests that guarded them.

## 1. The verdict

A run is GREEN when no test failed and no file hung. Every failure is named by its key,
`file :: name` (nested tests as `parent > child`), with its failure type and the first line of
its message. Hangs (`fileHung`, `testTimeoutFailure`, `testAborted`) are counted apart from
failures. A file that crashes, hangs or leaks fixture directories is one failure with a stable
name (`(file leaked fixture directories)` for a leak), so two runs of the same file compare.

```
baton suite verdict: RED — 4849 passed, 2 failed, 0 hung
  failed: test/example.test.mjs :: adds two rows — expected 2, got 1
```

When `BATON_SUITE_VERDICT_FILE` names a path, the runner writes the verdict document
(`schemaVersion: 2`): `green`, `passed`, `failed` and `hung` keys, `failures` (each with
`key`, `file`, `name`, `failureType`), `skipped`, and `environment`. `unexpected` repeats
every failure key, so a reader written before #580 blocks on every failure.

## 2. The environment line

The suite names the machine-local prerequisites it observed for this run, derived from the SAME
declaration the deployment doctor and route readiness use — the served route registry and the one
omp route-readiness derivation in `impl/src/application-deployment.mjs`
(`ompProviderKeyFile`, `ompRouteReadiness`, `routeReadinessContract`). No path list is restated in
the runner: an omp route contributes the provider key file its readiness declaration names, and a
route family whose machine-local prerequisite is not resolvable from that declaration is reported
as declared, never invented.

```
baton suite verdict: RED — 4849 passed, 22 failed, 0 hung
  baton suite environment: omp/deepseek/deepseek-flash ABSENT — repository deepseek_key.json (authentication_required); codex/gpt-6-sol declared — `~/.codex/auth.json` present; …
```

The environment line is reported for the reader and does not change the verdict. A test that
needs a credential this host lacks fails here; on a landing it fails on the target as well, so the
landing comparison (§3) does not block on it.

## 3. The landing comparison (#580)

A landing gate answers one question: does the change break a test that works on its target?

1. `swarm integrate` runs the selected test files (§4) in the landing checkout at the squash
   commit.
2. When every file passes, the gate is green.
3. When some fail, the gate checks out the target commit (`targetHeadBefore`) in the same
   checkout, re-runs only the failing files that exist on the target, and checks out the squash
   again.
4. A failure blocks when the target run does not have it. A test failure compares by key; a
   file-level failure (`fileHung`, `fileCrashed`, `fixtureLeak`) compares by file and failure
   type, because its name carries run-specific detail.
5. A failing file the target does not have is new with the change, and its failures block. When
   the target run writes no verdict, or the landing has no target commit, every failure blocks.

The gate's verdict line reads `red — passed N, X failing only with the change, Y failing on the
target too, squash <sha>`, and the receipt lists the blocking keys in `unexpected` and the shared
ones in `failingOnTarget`.

## 4. The `-red` suffix

`-red.test.mjs` marks a test written before its implementation. The suffix records the file's
origin and has no effect on the verdict. Such a test fails on the target and on the change until
the implementation lands, so it never blocks a landing; the change that implements it turns it
green. The issue the test cites tracks the work. [docs/44](44-red-suffix-convention.md) states the
naming rule.

## 5. The pre-verdict selection: affected files first (#300)

The 2026-09-14 incident: every check and every landing ran the full suite (~25 minutes at
parallelism 6) because the affected file set was chosen by hand from `changedPaths`. The
selection is now derived and shared by the check and the runner:

- `impl/src/verification-selection.mjs` is the ONE selector. From the changed paths it derives
  the test files that statically import (transitively, across `impl/src` and `impl/test`) a
  changed module, every changed test file itself, and — for a changed file no test imports —
  the test files that name it in a fixture path (its basename or path suffix in the test's
  source), with the reason recorded per file so the weaker fixture-path signal is visible, never
  silent.
- A contribution check runs the affected subset FIRST, through the same verification lane, under
  the contract's own argv with the selected file arguments appended, and records its verdict as a
  typed row on the check receipt: `preverdict: {selection: {changedPaths, files, reason,
  provenance}, verdict}`. The full suite runs after it, unchanged, and stays the acceptance
  verdict — a red or unavailable subset is information on the receipt, never a failed check by
  itself. When nothing runs before the full suite, the receipt says why: `skipped: 'docs'` (the
  #269 docs gate is the whole check), `no_affected_tests`, `selection_unavailable` (no
  captured-revision reader), or `contract_shape` (a legacy string contract cannot carry file
  arguments). The selection is derived from the CAPTURED revision through its retained
  checkpoint — a capture may carry imports or tests the hub's own checkout has never seen — and
  is cached per capture commit.
- `node impl/scripts/run-suite.mjs --changed <paths…>` runs the same selection from the CLI,
  against the checkout the runner is testing, and is the PRE-VERDICT STEP of the landing
  procedure: before a landing runs the full gate, run the affected subset (fast first verdict,
  its selection printed with per-file reasons), then run the full suite.
  `--changed` is a partial run under the same contracts an explicit file list obeys (#290): it
  refuses to combine with explicit file arguments or `node --test`
  passthrough options, and refuses to run with no paths — an unnamed selection would silently
  mean the whole suite. An empty selection is not a failure: the verdict is green with zero tests
  judged, and the run says so.
  A selected file is scheduled only when its own source imports the test framework the reporter
  reads (`node:test`); the #300 selection and a direct file name can both reach a driver script
  or helper module under `test/` (#508), and the verdict reports such a file as
  `skipped: no test-framework import` while judging only the files that ran.

Over-selection is the safe direction for both entries: the subset is a fast first verdict, never
the gate. Under-selection is what would hide a failure the full suite then finds 25 minutes
later.

The native landing (`swarm integrate`, #296/#463/#466) runs the SAME selection: its gate set is
the runner's own selector (`impl/src/verification-selection.mjs`, the function `--changed` calls)
over the checkout the squash produced, UNIONED with the landing table's region gates — one
derivation, never a second table — and the receipt's `selection.provenance` names the runner's
reasons (`changed`, `imports`, `fixture-path`) beside `region`. An empty derivation runs no gate
and says `skipped: 'no_affected_tests'`. A landing's `issue` is the seat's context-package issue
(the `issue:<n>` branch), else `null`; the region labels and the swarm's purpose are never
consulted.

## 6. Served-host fixtures and the suite root (#446)

A parallel gate hands every test process its run's SUITE ROOT as `TMPDIR`
(`baton-suite-XXXXXX` under the system temp dir, 65–69 bytes on this host). A fixture that
starts a real served host under that root must keep its Unix socket path under the kernel's
103-byte `sun_path` bound, or the host's own validator refuses `Web host configuration is
invalid` — and the file then passes alone (a shorter ambient root) while failing under the gate.
The rule, followed by the resident fixtures (issue276, issue288, issue351, issue356, issue365,
issue445, issue450, issue316-sse, wake-binding): mint the SOCKET root directly under the short
system root (`mkdtempSync('/tmp/<fixture>-')`), never under the ambient `TMPDIR`, and never by a
measured fall-back — the #446 fixture measured with a one-character stand-in for mkdtemp's six
and missed a 68..72-byte band. Ledger and session roots stay under the ambient root; only the one
path the kernel bounds leaves it. Row `316-sse-d` pins both ends of the band.

## 7. A cancelled test is a failure (#460)

Node reports a test whose awaited operation never settled as `cancelledByParent` — "Promise
resolution is still pending but the event loop has already resolved" — and with it cancels EVERY
row after it in the same file. That is not a red row: it asserts nothing, so the verdict cannot
tell a broken harness from a pinned gap, and the design the row names is neither proven missing nor
present. The suite's rule runs in both directions.

**A fixture's awaits are bounded and named.** Every await a fixture takes on the deployment's own
settle chain — the spawn gate (`deployment.run`), the run's approval, the fixture open and close,
the wave preflight — carries a declared bound and fails the row naming the wait it abandoned
(`spawnWorker(a4p-sibling): run.approve never settled within 120000ms`), never leaving a pending
promise. The bound is a number the suite already declares: the deployment's probe deadline, the
registry row `route.probe_deadline_ms` that `impl/src/route-liveness.mjs` takes its own default
from — so a fixture never invents a second timeout vocabulary. A bound miss carries the typed
marker `fixture_wait_unsettled` and is rethrown by the fixture helpers: a row must never read "the
wait never settled" as "the deployment refused".

**A cancelled test is a failure.** `computeVerdict` keeps the count on the verdict line
(`N of them cancelled by a dangling await earlier in their file`) so the shape of the debt stays
visible while the harness is repaired.

The two failure shapes stay distinct in the verdict: a HANG costs its file the progress deadline
(`fileHung`, `testTimeoutFailure`, `testAborted` — `isHang`), while a dangling await drains the loop
in milliseconds (`cancelledByParent` — `isCancelled`). The 2026-09-13 audit
(`docs/audits/2026-09-13-runtime-policy/dangling-awaits.md`) is the first repair of this class;
#460 is the regression it caught, measured at master `6aad8694`.

The #460 measurements, recorded so the next reader does not have to re-derive them: both files'
fixture adapters kept ONE `onEvent` listener, while the deployment installs TWO observers on one
adapter object — the liveness controller wraps the adapter while the deployment opens
(`route-liveness.mjs` `_wrapAdapters`, which captures whatever listener exists at that moment), and
the coordinator registers its own when its deferred startup reconstruction completes (#351 lane 3
made the deployment open path async). The later registration orphaned the earlier observer on a
single-slot fixture, the probe's terminal wire reached nobody, the gate's `ensure()` never settled
and the loop drained: 26 rows of `readiness-credentials-red.test.mjs` and 15 of
`readiness-honesty-red.test.mjs` were cancelled with zero assertions. The fixtures now deliver
every event to every registered observer, in registration order.

**The orphaning itself was the production defect (#477).** The paragraph above records a
measurement made on a fixture; what it measured was the served path. A registration that REPLACES
the listener slot strands every observer installed before it — the coordinator's deferred
registration landed after `_wrapAdapters` had wrapped the adapter, so on a real `openBatonDeployment`
the probe's terminal wire reached no liveness observer, `ensure()` waited out its (unref'd) deadline
and settled `unknown` EVERY time, and the readiness tier never verified and never blocked. The chain
now lives in ONE place, `impl/src/adapter.mjs` `observeAdapterEvents` (beside the contract that
declares `onEvent`): it captures whatever listener the slot holds and forwards to it, so a
registration OBSERVES ALONGSIDE and never replaces, whichever of the two registrants lands last.
`route-liveness.mjs` `_wrapAdapters` and the coordinator's deferred seam both call it, so no fixture
shape can decide the outcome.

That makes the two fixtures' deliver-to-every-observer wiring a fixture-side guard rather than the
reason their rows assert — a fixture that fans out more generously than the tier it stands in for
can hide exactly this class of defect (here it would, since a single-slot adapter was the tier's real
shape). The served-path rows therefore live outside those fixtures, over a real `openBatonDeployment`
with a SINGLE-slot scriptable adapter: `impl/test/issue477-liveness-observer-survives-startup.test.mjs`
pins that a probe settles `verified`, that the later registration forwards through the observer it
replaced, and that a worker turn's `invalid_grant` still fans out to the credential's rows.
