# 42 — Suite legitimacy: reasoned expected-red rows, the environment dimension, the `-red` convention

Status: implemented (issue #284; 2026-09-14 deep codebase audit items S-G2, S-G3, S-I6, S-N1,
R-1). The code of record is `impl/scripts/suite-verdict.mjs` (the decision procedure),
`impl/scripts/run-suite.mjs` (the runner that reads, writes and reports it), and
`impl/scripts/expected-red-tests.json` (the manifest).

The canonical gate is `node impl/scripts/run-suite.mjs`. Green means green — but green is only
honest if the suite can say *why* a red is expected, and can tell a code red from a red this
machine cannot judge. Three things make that true.

## 1. Every expected-red row carries a reason (schemaVersion 2)

```json
{
  "schemaVersion": 2,
  "rows": [
    { "key": "test/example-red.test.mjs :: A1 RED: the contract this row pins", "reason": "#263" }
  ],
  "converged": [
    { "file": "test/example-converged-red.test.mjs", "reason": "#42" }
  ]
}
```

A `key` is the reporter's row key: `file :: name` (nested tests as `parent > child`). A `reason`
is one of:

| Reason | Class | Means |
|---|---|---|
| `#263` | `issue` | the GitHub issue that tracks the gap |
| `S-G5`, `A-G10`, `R-1`, `G-24` | `audit` | the audit item that tracks the gap |
| `credential` | environment-red | the row needs a machine-local credential |
| `environment` | environment-red | the row needs another machine-local prerequisite |
| `design` | code | a design contract pinned before its implementation |
| `unattributed` | code | nobody has attributed it yet — a TODO, never a resting place |

A row without a classifiable reason refuses the manifest (`suite_manifest_invalid`, naming the
field it needs). An environment-class row may also carry a `prerequisite`: the registry route key
it depends on (e.g. `"prerequisite": "omp/deepseek/deepseek-flash"`), so the verdict judges it
against that prerequisite's observed state instead of the global absent list; a bare
environment-class row keeps the global behaviour until it is attributed, and an empty
`prerequisite` refuses like a missing reason. The verdict reports the expected-red count **by
reason class**, so a reader can see the shape of the debt: how much is unimplemented design, how
much is a tracked issue, how much is this machine.

## 2. The environment dimension

The suite names the machine-local prerequisites it observed for this run, derived from the SAME
declaration the deployment doctor and route readiness use — the served route registry and the one
omp route-readiness derivation in `impl/src/application-deployment.mjs`
(`ompProviderKeyFile`, `ompRouteReadiness`, `routeReadinessContract`). No path list is restated in
the runner: an omp route contributes the provider key file its readiness declaration names, and a
route family whose machine-local prerequisite is not resolvable from that declaration is reported
as declared, never invented.

```
baton suite verdict: GREEN except environment — 4849 passed, 472 expected red (450 code, 22 environment-red, …), 0 unexpected failure(s), …
  baton suite environment: omp/deepseek/deepseek-flash ABSENT — repository deepseek_key.json (authentication_required); codex/gpt-5.6-sol declared — `~/.codex/auth.json` present; …
  expected red by reason class: issue=393, audit=4, credential=22, design=53
```

**Environment rows are judged against the run's prerequisites, in both directions.** A row whose
reason class is `credential`/`environment` declares that this machine decides its outcome. A row
that names its `prerequisite` (issue #327) — the registry route key the suite environment line
prints, e.g. `omp/deepseek/deepseek-flash` or `claude-code:claude/claude-opus-4-6` — is judged
against THAT prerequisite's observed state only:

- Its prerequisite is absent: the row is expected not to pass. A failure is environment-red —
  reported separately from code rows, never counted as an unexpected failure — and a pass is not
  evidence the spec went green, so staleness never applies to it.
- Its prerequisite is present: the machine can run the row, so it **must** pass. A failure is an
  unexpected failure like any other (the environment axis cannot excuse it), and a pass is simply
  fine.
- Its prerequisite is declared (the run reports the route's ready-when contract without
  evaluating it) or unknown to the run: the row stays unjudged as environment-red either way —
  the verdict never invents an observation it did not make.

A row with a bare class keeps the global behaviour until it is attributed: any prerequisite the
derivation reports ABSENT makes it unjudged for that run, and when every prerequisite was present
it must pass. That is what makes a clone-hosted or credential-less run read `GREEN except
environment` instead of a pile of unexpected failures, while a credentialed host is judged
strictly. The rows that need a machine-local credential today pin the same contracts
(`impl/test/phase78-…`, `phase79-workflow-composition-red`, `phase80-application-revision-red`,
`phase83-context-runtime-red`, `feedback-forge-hardening-red`); each carries the `credential`
reason (attributed to its route's prerequisite where the file names exactly one registry route),
and each is green on a host that has the credential.

The machine-readable form is written when `BATON_SUITE_VERDICT_FILE` names a path: the same
counts, the environment facts, and the environment-red rows by class.

## 3. Writing the manifest (`--write-expected-red`)

`node impl/scripts/run-suite.mjs --write-expected-red` rewrites the whole manifest from THIS
run's failures. It is a full-suite-only operation (an explicit-file run is refused by naming that
contract, issue #290). Two rules make it safe:

- **A reason is preserved.** Every row that stays red keeps the reason it already carried.
- **A new row needs a declared reason.** A failure the manifest has never listed cannot mint a
  row by itself: pass `--expected-red-reason <reason>` (the flag fills the manifest's own `reason`
  field) or the write is refused, naming the flag, the field, and every row that needed it. A
  rewrite never records a silent placeholder.
- **A new `credential` row needs a named prerequisite.** `--expected-red-reason credential` is
  refused without `--expected-red-prerequisite <registry-route-key>` (the route key the suite
  environment line prints for the prerequisite the row depends on), so a freshly minted
  environment row is attributable from birth instead of joining the global absent list.

Rows that went green are dropped, and `converged` is preserved.

## 4. The `-red` convention

**`-red.test.mjs` marks a red-first spec: a suite authored to pin a contract before its
implementation.** The name records the file's origin. It is NOT a statement about today's run —
the manifest is the single authority on what is still expected red:

- A `-red` file with remaining expected-red rows is listed in the manifest's `rows`, one row per
  test, with reasons.
- A `-red` file whose rows have all gone green is **converged**: it keeps the suffix as the record
  of the contract it pinned, and it is declared in the manifest's `converged` list with a reason
  (the issue, audit item, or the design contract it pinned).
- The suffix is **removed** only when the file or the contract it pins is retired — a rename, not
  a status change. Status never lives in a filename.
- A `-red` file that is neither listed in `rows` nor declared in `converged` is refused, and so is
  a `converged` entry whose file is gone or whose rows came back
  (`impl/test/suite-manifest-reasons.test.mjs` pins both directions).

## 5. Adding a row

1. Write the red-first test (name it `…-red.test.mjs`, state the stage the row fails at).
2. Run the full suite with `--write-expected-red --expected-red-reason '#<issue>'` (or the audit
   item, or the class that fits) and commit the regenerated manifest.
3. If the row cannot be attributed, its reason is `unattributed` and the attribution work is
   named where the row lives — never left implicit in a filename.

## 6. The pre-verdict selection: affected files first (#300)

The 2026-09-14 incident: every check and every landing ran the full suite (~25 minutes at
parallelism 6) because the affected file set was chosen by hand from `changedPaths`. The
selection is now derived and shared by the check and the runner:

- `impl/src/verification-selection.mjs` is the ONE selector. From the changed paths it derives
  the test files that statically import (transitively, across `impl/src` and `impl/test`) a
  changed module, every changed test file itself, and — for a changed file no test imports —
  the test files that name it in a fixture path (its basename or path suffix in the test's
  source), with the reason recorded per file so the weaker fixture-path signal is visible, never
  silent. It also projects the reasoned manifest (#284) onto the selection: the expected-red rows
  of the selected files are part of the selection, so a subset verdict can be read against what
  was already known to be red.
- A contribution check runs the affected subset FIRST, through the same verification lane, under
  the contract's own argv with the selected file arguments appended, and records its verdict as a
  typed row on the check receipt: `preverdict: {selection: {changedPaths, files, reason,
  provenance, rows}, verdict}`. The full suite runs after it, unchanged, and stays the acceptance
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
  its selection printed with per-file reasons and expected-red rows), then run the full suite.
  `--changed` is a partial run under the same contracts an explicit file list obeys (#290): it
  refuses `--write-expected-red`, refuses to combine with explicit file arguments or `node --test`
  passthrough options, and refuses to run with no paths — an unnamed selection would silently
  mean the whole suite. An empty selection is not a failure: the verdict is green with zero rows
  judged, and the run says so.

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

## 7. Served-host fixtures and the suite root (#446)

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

## 8. A cancelled row is never an expected red (#460)

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

**A cancelled row is an unexpected failure.** `computeVerdict` keeps the count on the verdict line
(`N of them cancelled by a dangling await earlier in their file`) so the shape of the debt stays
visible while the harness is repaired. Listing a cancelled row in the manifest is a transient
bridge, never a resting state: the row has no assertion to attribute, so its reason would name a
gap nobody measured. #460's rows were listed that way, and are retired with the repair.

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
