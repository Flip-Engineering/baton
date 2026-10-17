# Account and credit design: independent critique and adjudication verdicts

Status: review record, 2026-10-17, seat accounts-glm (ensemble `account-credit-product`),
answering conductor task `message:accounts-wonder:8ac1a1ce3763ecac95b91d90258abd2e`, conductor
spec report `message:accounts-wonder:c9e4a4dc9a4f895dc31f35f6dca12584`, and worker
`message:accounts-deepseek:823f1c6db81e1d9fdb4cd1e3a1c5e0aa` (attack the six design points).
Source snapshot `dd62ce8`. Companion records: `reviews/account-credit-critic-audit-20261016.md`
(contracts A1-A8, findings F1-F8, counterexamples C1-C12) and
`reviews/account-credit-api-research-20261017.md` (primary-source research). This critique adds
the adversarial pass over the named source files and the requested verdicts.

## 1. Where subscription and API-key funding conflate in current source

- `bend2/src/harness/claude-player.bend:27-40`: the profile route unsets
  `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` and binds only
  `CLAUDE_CONFIG_DIR`. Every profile launch is subscription-funded by construction; an API-key
  funding route has no path into this argv.
- `bend2/src/coordinator/subscription-fallback.bend:16-17,90-91`: `Profile{harness,label,store}`
  carries no funding-route or organization field; `store_variable` maps harness to a directory
  variable only.
- `bend2/src/coordinator/agent-route.bend:1-142`: read in full; this module is CLI context and
  verb classification (Explicit/Project/Current/Implicit/InDatabase). It carries no credential or
  funding logic. No conflation exists here; the funding decision lives entirely in the launch
  composition above.
- `bend2/src/coordinator/turn.bend:855-872,932-948`: `current_store` reads the binding in force
  and `retained_prepare` composes `/usr/bin/env` assignments; the only per-spawn credential-adjacent
  facts are directory paths.
- Exhaustion wording (`subscription-fallback.bend:249-268`) covers subscription shapes and one
  generic balance fragment. The documented API-key funding failures (402 `billing_error`, spend
  limit 400, tier spend-cap 429) and the documented credit-balance wording
  (`reviews/account-credit-api-research-20261017.md` section 2) are outside the current marker
  list.

Repair direction stays F1-F3 of the audit; the research record adds the citable wording and
status/type anchors, and the `-p` key-precedence fact that makes `--print` spawns
key-decided.

## 2. Where attempt account and funding route are not persisted

The binding in force lives in the per-session sidecar (`<db>.profile-<hex>`), advanced at handoff
time; attempt directories carry it only through the `.continued-<label>` suffix
(`turn.bend:1129-1136`). No attempt record names the account, funding route, organization or
credential reference. Repair F6: write `(label, funding route, credential reference, organization
state)` at admit time, before the spawn is attempted, keyed to the same attempt identity
`ProcessChild.recovery_argv` and the retained-observation path resolve. An unstarted or
failed-spawn attempt still consumed the selection and must keep its attribution.

## 3. Fallback, re-entry and receipt risks

The existing handoff path preserves identity and receipts: guidance is written only when the
inbox holds nothing owed at cursor `0` (`receive.bend:496-510`), no receipt is reset, the native
conversation survives same-harness advances (`subscription-fallback.bend:846-856`), and
`route-unavailable` retains the task with owed input and wakes the conductor
(`subscription-fallback.bend:816-844`). No defect found in this path at `dd62ce8`. The risk
surface is the new code that will sit beside it; the acceptance counterexamples are C6
(same-conversation API-key fallback), C7 (all-routes wake with retained task), C11 (owed input
across exhaustion must not be double-read or acknowledged), C9 (per-session isolation), C12 (429
scoping per frame shape) of the audit doc. The new API-key advance must reuse this path
unchanged: same record append, same report IDs, same cursor rule, same native-identity rule.

## 4. Numeric precision risks

`cost_report` returns USD cents as decimal strings; balances arrive as decimal strings; #711
showed rounding entering through three independent layers (server parse, browser parse, renderer)
before correction `966e593c`. The credit rows must carry values as recorded text with units, and
C10 pins one imported value through CLI read, org view and a UI round trip. The risk is not the
record schema; it is every formatting boundary after it.

## 5. Verdicts on the conductor's adjudicated facts

**(1) "Claude Code not covered, so claude -p eligibility conflicts; route claude-code to
subscription, api/agent-sdk to api-credit." Verdict: the conflict is resolved by the primary
sources, and harness-name routing is the wrong predicate.** The platform coverage table's
"Claude Code: No" names the Claude Code product surfaces; the support article's FAQ states
explicitly that self-run `claude -p` and Agent SDK runs with an API key from the linked
organization are covered as Agent SDK usage, while subscription-authenticated runs draw plan
limits, and that GitHub Action/IDE/desktop launches are Claude Code usage even with `-p`. The
`ANTHROPIC_API_KEY` row of the Claude Code env reference states the key is always used in
non-interactive (`-p`) mode when present. Baton's claude-code harness spawns exactly the headless
`--print` shape. Correct predicate: funding credential + self-run headless execution + verified
organization. The same harness runs under either funding route; the funding-route field decides
eligibility, the harness never does.

**(2) "No documented remaining-promotional-balance endpoint; /v1/organizations/me verifies org
for a key; Usage/Cost Admin API reports spend only; balance source = console-observed or
operator-imported." Verdict: confirmed on all four claims**, with citations in the research
record sections 1-2. Addition: the spend cap resets on the calendar month while credits refresh
on the billing cycle, so a spend-cap refusal can coexist with remaining credits; the classifier
must keep those refusal facts distinct (audit F3/C12).

**(3) "Amounts are decimal strings, never floats (#711)." Verdict: confirmed**, with the
qualification in section 4: pin the boundary after the schema, not only the schema.

## 6. Attacks on the worker's six design points

For each point: the strongest concrete failure I can construct, then the observed-failure
justification audit it asked for.

**(1) Accounts table (provider/harness, label, funding route, secret reference, org possibly
unknown).** Strongest failure: identity ambiguity under the existing aliasing — `claude` and
`claude-code` both read `CLAUDE_CONFIG_DIR` (`subscription-fallback.bend:90-91`), so two records
that differ only by harness alias name one credential directory twice, and a fallback that
advances by label across the alias boundary can rebind the same store under a new label and read
that as an account change. Records need identity that survives the alias: the credential
reference must be unique per provider, and advance selection must treat alias-equal stores as the
same credential. Justification audit: the information content is forced by the operator's real
two-account situation and the issue acceptance rows; the database-table medium is a design choice
no observed failure forces — the sidecar-file pattern of A1 carries the same facts. Choose the
medium that adds the least mechanism; either is defensible, table or sidecar, but the choice is
the conductor's, and it is not failure-driven.

**(2) Attempt-scoped record of account + route + organization + cause.** Strongest failure:
attribution written after a successful spawn is missing exactly when it matters — a spawn that
never starts (unreadable process status, `RSpawn`) or dies pre-terminal still consumed the
selection, and recovery via `recovery_argv` re-enters an attempt whose record does not exist yet.
The write must precede the spawn attempt and key the identity recovery resolves. Justification:
forced by requirement 2 of the assignment and by the existing retained-recovery mechanics; this
one is failure-driven.

**(3) Organization-keyed credit observations.** Strongest failure: concurrent observations of one
organization — an operator import landing while a refresh reads — must produce a retained
conflict fact with both values readable; last-write-wins discards a real observation and launders
the survivor's provenance. Second failure: stale/unknown must be part of what the read returns,
not a mutable flag that an unrelated later observation silently clears. Justification: forced by
the acceptance rows (multiple credentials sharing one organization pool; fresh, stale and
unavailable observations) and by the operator's two-sign-in situation.

**(4) No invented balance.** Strongest failure lives outside the record: the import seam. A
free-text import field records whatever the operator types with source `operator-import`, so a
transcription error becomes an indistinguishable observation. Store the verbatim imported text
alongside the parsed value and units, so every observation carries its own raw evidence. Second
seam: the UI render path that formats balances is where #711 actually lost digits; pin C10 there.
Justification: the prohibition is a fact-integrity rule, not a mechanism; it needs no observed
failure to stand. The verbatim-evidence requirement is failure-driven (silent corruption is the
failure).

**(5) Balance source research.** Confirmed by the research record; additions: the documented
exhaustion wording is now citable for the classifier (research section 2), and the two-clock fact
(spend cap calendar month vs credits billing cycle) means "credits remain" and "requests succeed"
are different facts; do not model one from the other. Justification: fully observed/documented.

**(6) API-key funding binding resolved at launch.** Strongest failure: argv exposure — the only
child-environment mechanism in the tree is `/usr/bin/env` argv elements
(`turn.bend:940`, `claude-player.bend:29-40`, `process-spawn.c` spawns with the inherited
`environ`), so a key bound through the current composition is readable in `ps` for the child's
lifetime. The host-level secret resolution boundary (audit F2) is the repair, and C8 is its probe.
Second failure: binding order — a subscription route must keep unsetting `ANTHROPIC_API_KEY`
(inherited operator shells may carry one; the `-p` precedence fact makes its presence decisive),
and an api-key route must unset the subscription tokens before binding the key. The order is
observable in argv and must be pinned in the `claude_order` test pattern. Third: the binding must
anchor to the headless `--print` shape and fail closed (no resolution) for any command shape that
is not it. Justification: the exposure is grounded in read code today; the precedence facts are
documented; this point is failure-driven end to end.

## 7. What no observed failure justifies

- The accounts-table medium (see (1)) and any schema beyond the facts named in (1)-(3).
- Automatic organization verification on every launch: `/v1/organizations/me` exists and is the
  supported check, but a recurring implicit verification call is a mechanism without a named
  failed run. Verification is an explicit account setup or refresh action, recorded as a fact with
  its source and time; launches consume the recorded fact.
- Any freshness deadline, admission gate, or availability claim derived from balance or staleness
  (the #598/#683 constraints; staleness routes as a flag, never as a gate).
- A model-output source kind, a derived-balance computation, or any balance endpoint beyond the
  documented surfaces.

## 8. Boundary

Source-level critique at `dd62ce8` plus fetched primary documentation. No executable, installed,
or live-provider claim is made; the operator's account and organization identities remain unknown;
credentials were never requested, printed, or stored.
