# Provider683 verification, fix commit f7877106 (2026-10-07)

Reviewer seat `provider683-muse-review-20261006`, ensemble
`provider683-completion-20261006`. This note verifies
`f7877106ed596bfa1b27b114c29fa6df250b3a55` (parent `4fe300fd`, tip of
`codex/provider683-deepseek-impl-20261006`) against the F1 and F2
findings of the re-qualification report
(`docs/bend2/provider683-muse-requalify-20261007.md`). No candidate
source was modified.

## F1: model-scoped identifier parsing

The muse probe path now parses the identifier its own output echoed
(`model: <id>` on the first such line), records the caller string as
`requestedModel`, and states `provenance` as `provider-catalog`,
`provider-echoed`, or `caller-stated`. Output with no echoed
identifier leaves `models` null and names `model-identifier` in
`absent`. The law
`m8_a_model_scoped_read_lists_only_the_echoed_identifier` states the
exact equation, the mutation control
`discovery-muse-caller-string-becomes-a-provider-listing` pins it,
and two maintained tests cover the echo and no-echo paths. Direct
checks against the built binary confirm both answers. F1 is fixed as
specified.

Residual: the muse harness echoes any requested id (live
`model-profile show` exits 0 with a generic profile for an invented
id, verified 2026-10-07), so an echo restates the request and carries
no existence proof from the harness. The provenance marking keeps
that boundary visible.

## F2: refusal names the harness

With no recorded route the refusal guidance falls back to the seat's
own recorded harness, so `next` reads `["provider-probe", <harness>,
""]` with no null entry. The law
`m12_a_continuation_refusal_names_a_harness` states the equation, a
maintained test asserts `next[1]` for a routeless seat, and a direct
binary check confirms it. F2 is fixed.

## New finding F5: one mutation control cannot apply

The committed find string of
`discovery-refusal-guidance-names-no-harness` occurs nowhere in the
tree, so the full gate records it as unapplied and therefore failing.
The F2 law itself is load-bearing: the same mutation with the
corrected find string fails compilation naming the law (receipt
below). The control needs a one-line correction to its find string;
the law and the behavior stand.

## #694 provider scope

Catalog reads group identifiers by the `provider` field the catalog
states, `capacity.scope` names the observing harness, and
`probe.ageSeconds` dates the observation. Live verification: the omp
catalog states exactly `deepseek`, `google-antigravity`, `kimi-code`,
`opencode-go`, `zai`; the codex catalog states no provider field.
The law `m8_a_catalog_metadata_groups_the_provider_scopes` and its
mutation control pin the grouping, and a maintained test asserts the
grouped rows with scope and age. A successful read establishes
observed usability at that time and no remaining amount.

## Acceptance table update

1. Codex set with Sol and Luna: PROVED (unchanged). Live
   `codex debug models` returns 11 slugs including `gpt-6-sol` and
   `gpt-6-luna`; the adapter argv is law-pinned.
2. Kimi K3, Muse, and GLM variants: PROVED with the stated caveat.
   The F1 fix marks muse listings by echo provenance; the residual
   above applies.
3. Alias versus account-usable distinction: PROVED (unchanged), now
   with per-provider scopes separating same-name routes on different
   providers.
4. Quota failure plus fresh query continuing same-seat work: PROVED
   at fixture level (unchanged). A live quota-exhaustion failover is
   UNOBSERVED; no provider states a quota window, and no
   credit-spending invocation was attempted.
5. Bend law coverage: PROVED. Sixteen laws compile with the entry
   (thirteen plus three new). Scoped negative controls pass for all
   three new laws; the F5 wiring defect affects one committed control
   string while its law stands proven by the corrected control.
6. No hard-coded model allowlist: PROVED (unchanged). The fix adds no
   model identifiers to runtime source.

## Remote receipts (atari-homelab)

Own tree `/home/atari2036/provider683-muse-verify-20261007`,
archived from the fix commit. Pinned `bend` 2.0.25 with
`CC=clang-19` and the newer SQLite path.

- `build-native.sh`: exit 0.
- `bend2/test/models.py`: 20 tests, OK, 0 skipped.
- Scoped negative controls, all failing closed naming their law:
  the two directly committed controls for the echo and grouping
  laws, plus the corrected refusal control.
- Direct binary checks: muse echo probe lists the echoed id as
  `provider-echoed`; muse no-echo probe answers null models with
  `caller-stated` provenance; routeless-seat refusal names the
  seat harness.
- Implementer full gate: running at verification time. Its early
  lines pass the eight prior discovery laws; the three new mutation
  lines are not on record yet. Implementer source hashes match the
  fix commit exactly. Reviewer and implementer build in separate
  directories.

## Remaining live evidence

- End-to-end binary runs against live harnesses: UNOBSERVED. No such
  run is on record, and the Linux binary cannot run the laptop
  harnesses. Attempted commands were metadata reads only.
- OpenCode Go account surface (#694): the scope, freshness, and
  unknown-capacity surface is implemented and law-bound. A live
  account usage or limit value is UNOBSERVED: no quota field appears
  in any observed provider output, and the installed `opencode`
  binary answers `--help` and `--version` with empty output, so no
  non-interactive usage read was found. Unknown balance stays
  information in the implemented surface; the surface proposes no
  availability from it.
- Same-Player failover with operator-authorized credits: UNOBSERVED.
  No exercise is on record, and none was attempted here.

## Recommendation

Correct the F5 find string, then land the discovery surface. The F1
residual needs no code change: the provenance marking already keeps
the muse echo boundary visible. Route application and its record
stay with the `configure` and #681 verb work.
