# Seam slice 3 — the brief seam, and the wiring the composition root was missing

Issue #259, slice 3. Slices 1 and 2 moved the store's `surface` (95 members) and `recovery` (41
members) buckets into `coordination-internals.mjs` and `coordination-replay.mjs` and re-anchored the
map's pins on the member name. This slice takes the next seam the map names — the brief the runtime
serves at the provider edge — in `coordinator.mjs` and `application.mjs`, and delivers the
`createDriver` wiring test the issue's required outcome asks for.

Revision under audit: `eb5b31f6` plus this slice's working tree. The slice was written against
`c6876a29`; after its seat was reincarnated the work was recovered onto `eb5b31f6` unchanged (the two
commits landed in between, `6d433364` and `eb5b31f6`, touch none of the files below).

Write scope: `impl/src/runtime-briefing.mjs`, `impl/src/application-briefing.mjs`,
`impl/src/coordinator.mjs`, `impl/src/application.mjs`, `impl/src/index.mjs`,
`impl/scripts/seam-inventory.mjs` + its regenerated artifact,
`impl/test/create-driver-wiring.test.mjs`, and this file.

## 1. The wiring the composition root was missing

`Coordinator` has read `opts.knowledgeBriefingProvider` since KG-3 landed, and consults it at the
provider edge: `_providerBrief` attaches the provider's answer as a separate `briefing` block on the
provider-facing value, leaving `task.brief` and its digest byte-identical (`kg3-activation-red`
KG3-H pins both halves).

Nothing supplied it. At the revision under audit `coordinator.mjs` read the option in exactly three
places — the validation at line 1453, the field assignment at 1456, and the consult site inside
`_providerBrief` at 5623-5625 — `createDriver` had no such option, no validation for it and no
pass-through, and no other module composes a provider.

`recallPreview` — the store-side projection KG-3 rule 8 specifies for this seam — is in the same
position: `coordination-store.mjs:16434`, exercised by `kg3-activation-red` and `kg4-quality-red`,
called by no production path. `docs/34-knowledge-horizons.md` names the consequence in its own
terms: "the briefings exist as functions but are not yet wired… never seen".

That is the failure shape the issue's motivating incident describes, one layer out: the consumer
guards the hand-off (`if (!this._knowledgeBriefingProvider) return inner;`), so an unwired driver
reaches every normal terminal with the seam inert and nothing anywhere reporting it.

This slice closes the composition half: `createDriver` validates and passes
`knowledgeBriefingProvider`, so the wiring is observable end to end. The provider's *content* — the
composition of `recallPreview` and `renderBriefing` under a deployment's preview policy, and the
query text derived from the worker's brief — is a deployment decision and is not made here; §6
records it as the open half.

## 2. What moved

| member | from | to | lines | delegate |
| --- | --- | --- | ---: | --- |
| `_providerBrief` | `Coordinator` | `runtime-briefing.mjs` (`providerBrief`) | 100 | same name, same arity |
| `resolveBriefing` | `BatonApplication` | `application-briefing.mjs` | 17 | same name, same arity |
| `mintCampaignBriefingInternal` | `BatonApplication` | `application-briefing.mjs` | 9 | same name, same arity |

Bodies are verbatim: `this.` became the explicit receiver parameter, and each module names its
receiver `coordinator` / `application`, which is the spelling its map target declares. Both
`BRIEFING_FRAME` and `BRIEFING_DISCLOSURE` moved with the serve lane that reads them;
`BRIEFING_FAMILY` is imported from `coordination-store.mjs` by the briefing module, and
`application.mjs` no longer imports it (its remaining users — `application-deployment.mjs` and
`mcp-northbound.mjs` — import it themselves).

The one helper a moved member cannot reach across the module boundary is the canonical digest the
attention receipt cites, and one is the application's refusal constructor: each arrives as an
explicit port (`runtimeBriefing.providerBrief(coordinator, brief, workerId, canonicalDigest)`,
`applicationBriefing.resolveBriefing(application, args, principal, applicationError)`). A moved
module therefore imports neither monolith, and no primitive is duplicated to make the move compile.

The dispatcher entries are untouched: `context.briefing` and `_briefing.mint` still call
`this.resolveBriefing` / `this.mintCampaignBriefingInternal`.

## 3. The map

Two module targets, one per new module, with the receiver each module's first parameter carries
(`coordinator`, `application`), joined by two evidence rules:

- `observation:brief_port` — the class delegate calls `runtimeBriefing.<member>(`. Without it
  `_providerBrief`'s three-line delegate would be read off its name and lose the seam its body had
  (its committed seam is `observation`, which is where its own evidence — the attention receipt and
  the coordination reads — puts the body in the module target).
- `observation:campaign_briefing_authority` — the application's briefing surface reaches the
  driver's coordination store through a local binding, so the rule names both facts it reads: the
  `driver?.coordination` authority and a `contextPackHead` / `contextPack` /
  `materializeContextPack` / `mintContextPack` / `composeCampaignBriefing` call. It is written
  against that hop and does not reach the store's own pack members.

The three class entries stay in the map under the same names with the same ordinals, their `size`
dropping from 100 / 17 / 9 to 3 each (the delegate), and the bodies appear in the new module
targets with their own sizes. No other member of any target reclassified.

Corpus counts: 1 590 → 1 593 members; `observation` 520 → 523. `coordinator.mjs` 18 458 → 18 367
lines; `application.mjs` 14 989 → 14 961; `runtime-briefing.mjs` 124;
`application-briefing.mjs` 63.

## 4. The wiring test

`impl/test/create-driver-wiring.test.mjs` gains two cases, and both were run against the pre-fix
tree first:

```
$ node --test impl/test/create-driver-wiring.test.mjs      # before the composition fix
✖ CDW4: the injected knowledge-briefing provider is consulted, and its block reaches the
        provider-facing brief only
    AssertionError: the injected briefing provider must be consulted for a dispatched worker
✖ CDW5: every option the composition root reads is classified ...
    AssertionError: a classified option must still be read by the composition root
    + [ 'knowledgeBriefingProvider' ]
```

`CDW4` builds the real driver over a real repository, dispatches one task to a verified terminal, and
observes three facts: the injected provider was consulted, the provider was handed the admitted
brief with no `briefing` key of its own, and the block reached the adapter's spawn brief while
`task.brief` carries none. The failure above is behavioural — the option was ignored, the run still
reported `completed`, and the seam stayed inert — which is the point of the case.

`CDW5` is the completeness ratchet around the composition root. It parses `createDriver`'s own body
for every `opts.<name>` it reads and requires each to be classified in exactly one of two tables:
`EXERCISED_OPTIONS` (option → the case in this file that exercises it, whose body must name the
option) or `UNEXERCISED_OPTIONS` (option → the path that would exercise it). A new authority added
to the factory, or an option a seam cut drops, fails the ratchet instead of disappearing. The
unexercised table is the file's own debt ledger: `hostCapacity` (consulted only by a contribution
check), `providerQuotaAuthority` (only by a provider quota refusal), `publisher` (only by a landing),
`gitExec` / `structuredMerge` (only by the preserved-result and structured-integration lanes), the
four acceptance-policy flags, the supervisors, and the construction policies.

After the fix both pass, and `CDW1`–`CDW3` are unchanged.

## 5. Evidence

| command | result |
| --- | --- |
| `node impl/scripts/seam-inventory.mjs` | `ok` (regenerated with `--write`) |
| `node impl/scripts/surface-gate.mjs` | `surface-gate: ok` |
| `node impl/scripts/run-suite.mjs` over `seam-inventory`, `frame-economics-red`, `worker-verdict-surface-red`, `kg3-activation-red`, `create-driver-wiring` | GREEN — 88 passed, 13 expected red, 0 unexpected, 0 stale expectation |
| `node impl/scripts/run-suite.mjs` over `worker-delivery-push-red`, `repl-realization-red`, `redrive-continuity-red`, `lane-contract-brief-305`, `swarm-knowledge`, `coordinator`, `phase64-integrated-run-application`, `workflow-surface-red` | GREEN — 195 passed, 48 expected red, 0 unexpected, 0 stale expectation |
| `npm test --prefix impl` (canonical suite, 652 files) | RED in this environment — 6 119 passed, 453 expected red, 28 unexpected, and RED at the pristine baseline without this slice: §7 |

The two subsets cover every pinned reader of the moved members: `frame-economics-red` F1 (the
byte-literal ratchet, which resolves exemptions through the live seam inventory and therefore
followed the moved bodies into their new module windows) and `worker-verdict-surface-red` C4/E4 both
stay green without an exemption added, and the behavioural suites of the second subset — which call
`_providerBrief` on either a live coordinator or a bare prototype receiver, and drive the two
application members through the dispatcher — are unchanged.

## 6. What this slice does not claim

- The seam is *reachable*, not deployed. No production path composes a knowledge-briefing provider
  from `recallPreview` and `renderBriefing` yet; a deployment must supply one to be briefed. The
  composition root now carries it, and `CDW4` fails if it stops.
- `appendWaveClosedInternal` stays on `BatonApplication`: it appends a wave closure, which is not a
  briefing.
- The wiring test exercises four of the factory's options directly. `CDW5` classifies the rest and
  names, per option, what would exercise it; it does not claim those paths are covered.
- The map's `receiver` normalization rewrites `<receiver>.` to `this.`, so a module member's
  evidence is read with its explicit receiver in place. A module that reads its receiver through a
  local alias (`const coordination = application.driver?.coordination`) needs a rule written against
  that shape, as `campaign_briefing_authority` is.

## 7. The canonical verdict, and what the environment decided

`npm test --prefix impl` ran all 652 files on this worktree: 6 119 passed, 453 expected red (22 of them
the credential-class environment rows), 28 unexpected, 0 stale, 0 unseen, 0 hung, 0 stalled lane. The
run proceeded without the host verify lease — admission queued it and the 2 000 ms wait was spent on a
memory shortfall (2 728 427 520 bytes observed against 15 461 882 262 required) — so it ran beside
another lane's suite on a host whose load stayed between 25 and 122.

A full baseline verdict is not obtainable here: the same command on a pristine worktree at `eb5b31f6`
was refused before any lane started (load 122 observed against 10 required, dimension `load`). The
comparison is therefore per file. Each of the 18 files that carried an unexpected row was run in
isolation on this worktree and on the pristine baseline, in the same environment:

- Fifteen fail on both trees. Twelve of them fail in isolation at both revisions with the host at load
  25–122, row for row: `phase42-policy-invalidation` (PI1, PI2/PI3/PI5/PI6, PI3/PI7/PI10, PI4/PI5,
  PI4/PI6, PI4/PI7, PI5/PI7/PI9), `phase43-hmac-webhook` AF2/AF7/AF10, `phase43-provider-reconciliation`
  AF5/AF6, `served-commit-306` #306(2), `surface-truth` ordinaryMcpToolNames, `suite-manifest-reasons`
  S-G3 (`test/log-archival-285-red.test.mjs` is a `-red` file the manifest does not list),
  `phase89-resident-host-red` P92-RH5, `phase92-result-intent-vertical` RI1 and RI6,
  `issue390-context-call-stopping` a390 (d), `issue351-open-liveness` OL-e, `test-runner` TF2/TF3, and
  `pre-verdict-selection`.
- Two are decided by this deployment's lane git wrapper (issue #357), which refuses `git stash` in
  every spelling and so fails any test that stashes: `test/worktree.test.mjs` (`pinBaseSha` with
  `autoStash`) and `test/issue285-custody-capacity-hardening.test.mjs` G-6. They fail on both trees.
- One is bound to a clock this host cannot meet: `issue360-drain-releases-settled` 360b waits a
  1 500 ms drain deadline, and it failed on both trees in all 12 runs made at load 25–76 (the baseline
  passed it twice at lower load).
- The remaining rows are what the host decided, not the code: `issue351-open-liveness` OL-a,
  `issue390-context-call-stopping` a390 (a)(b) and (c), `issue467-stop-converges` 467c/467d,
  `issue351-reconstruction-liveness` RL-a, and `phase92.2-physical-workspace-owner-red` P92.2-PO3 pass
  in isolation on both trees.

Run with the documented operator bypass (`BATON_HOST_CAPACITY_DISABLED=1`, which a host that refuses a
verify lease above load 10 makes a prerequisite for any verdict here), the slice's own files are GREEN
in this environment: `test/seam-inventory`, `test/create-driver-wiring`, `test/runtime-briefing`,
`test/kg3-activation-red`, `test/frame-economics-red` and `test/worker-verdict-surface-red` — SUBSET
verdict, 91 passed, 13 expected red, 0 unexpected. `seam-inventory: ok`; `surface-gate: ok`.

This slice adds no failing row that the baseline revision does not have.
