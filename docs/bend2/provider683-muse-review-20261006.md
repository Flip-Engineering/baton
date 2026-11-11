# Provider683 muse review (2026-10-07)

Reviewer seat `provider683-muse-review-20261006`, ensemble
`provider683-completion-20261006`. Review covers two preserved source
candidates for #683 and the live harness queries the acceptance clauses
require. No candidate source was modified. No parallel implementation
was started.

## Candidates

- `06a03f16` (`codex/recovery-platform-muse-conductor-20261006`), draft
  PR #692: `bend2/scripts/provider-availability.mjs` (224 lines) and
  `bend2/test/provider-availability.mjs` (9 node tests). CI run
  37524348429 (`darwin-arm64`) was `in_progress` at review time.
- `b8129b2a` (`codex/recovery-platform-deepseek-worker-20261006`):
  native `configure` operation over 11 files, unlanded, no completed
  report on record.

Common base of the DS candidate and the native685 branch:
`98fbfe03b9f47d847e2a746450005eb38f88c464`.

## Acceptance checks derived from #683

1. Real run discovers the current Codex model set; reports GPT Sol and
   GPT Luna when the subscription exposes them.
2. Real run discovers Kimi K3, Muse, and GLM variants through their
   configured harnesses.
3. The view separates configured aliases from models the account can
   use now.
4. A quota failure followed by a fresh provider query selects a usable
   alternative and continues the same seat's pending work (#681).
5. Operative Bend laws cover the provider-selection and continuation
   functions.
6. Remote qualification proves discovery against configured harnesses
   with no hard-coded model allowlist.

## Verdicts on 06a03f16

- Check 2, partial. Against the live `omp models --json` catalog (92
  models, omp 17.4.0, captured 2026-10-07 UTC), the tool reports
  `kimi-code/k3`, `opencode-go/muse-spark-1.3-contributor`,
  `opencode-go/gpt-6-luna`, `zai/glm-5.3`, `zai/glm-5.3-flash`, and
  `opencode-go/glm-5.3` as catalogued. All of these arrive through the
  omp harness only. The muse harness itself has no catalog query in
  the tool.
- Check 1, not met. Codex, muse, and claude harnesses report
  `unknown` with a fixed reason string. No Codex subscription model
  set is queried. GPT Sol appears in no live source observed (full
  92-model omp catalog searched). GPT Luna appears only as
  `opencode-go/gpt-5.6-luna` and `opencode-go/gpt-6-luna` in the omp
  catalog, not through a Codex subscription query.
- Check 3, not met. `reconcile` reports `catalogued` /
  `not-in-catalog`. Catalog presence is not account usability: the
  tool performs no access or quota check, and `currentQuota` is a
  fixed `unknown`. A catalogued model can still be unusable by the
  account, and the report does not mark that boundary.
- Check 4, partial. `rankCandidates` excludes the refused selector
  and `buildReport` keeps history entries with observation time; a
  past quota failure does not flip a catalogued row to unavailable.
  Refused exclusion matches one exact selector only: a bare id such
  as `k3` would not exclude `kimi-code/k3`. No path wires the report
  into a continuation operation.
- Check 5, not met. The candidate is Node only. No `.bend` function
  and no law covers selection, reconciliation, or ranking.
- Check 6, open. The script carries no model allowlist. Its tests run
  against a synthetic fixture only. CI 37524348429 was still
  `in_progress`; no completed remote gate exists on record.

## Alias over-match in reconcile

Against the live catalog, `zai/glm-5.3` matches both `zai/glm-5.3`
and `opencode-go/glm-5.3`; `zai/glm-5.3-flash` matches both
providers' flash entries; `deepseek/deepseek-flash` matches both
`deepseek/deepseek-flash` and `opencode-go/deepseek-flash`. Bare ids
(`glm-5.3-flash`) match across providers the same way. The `matches`
list does not mark exact-selector hits apart from same-id hits on
other providers, so a Conductor reading `matches` can select another
provider's model while acting on the configured provider's identity.

## Live harness API inventory (observed, operator laptop)

- `omp models --json`: 92 entries under `{models: [...]}` with
  `provider`, `id`, `selector`, `name`, `contextWindow`, `thinking`.
  Entries carry no `kind` field and no quota, account, or auth
  fields. The candidate's `kind === 'chat'` filter therefore passes
  every live entry through the empty-string branch; the `chat` branch
  is exercised by the synthetic fixture only.
- `codex --help`: no model-list subcommand. `codex doctor --json`
  advertises a redacted machine-readable report over installation,
  config, auth, and runtime health. Unverified output; candidate
  access-state probe for the Codex harness.
- `muse model-profile show <id> [--effort <tier>]`: resolves the
  named catalog model id for one effort tier.
- `claude --help`: `--model`, `--fallback-model`, `auth`
  management. No catalog list command observed.

## Verdicts on b8129b2a (configure route)

- The operation writes only `harness`, `model`, `effort`, `endpoint`
  on the named session row and keeps identity, parentage, workspace,
  branch, base, native conversation, and messages. It refuses a
  terminal stop, an owned attempt, a harness outside
  `codex/omp/muse/claude-code`, an empty model key, and an
  inadmissible endpoint. Five laws bind the parser, the
  expected-route predicate, the guarded update, and dispatch under
  M-8. This is the continuation primitive #681 and the #683
  integration clause need.
- Composition gap with discovery. `configure` resolves the model key
  through the Git identity series registry
  (`github-apps/series.json`) and refuses unmapped keys. The registry
  holds 5 model keys; `zai/glm-5.3` (the model named in the #683
  summary) and every `opencode-go/*` key are absent from it.
  Discovery lists those models as catalogued while `configure`
  refuses them. The two candidates assign precedence to different
  sources and share no composition path.
- The update records no provider-change entry and preserves the old
  route only inside the overwritten row. #681 requires the provider
  change recorded with the old failure kept as history.

## Overlap with native685 work

Since base `98fbfe03`, the native685 branch and the DS candidate both
edit `bend2/src/coordinator/commands.bend` and
`bend2/src/coordinator/laws.bend`, in different regions: #685 edits
`terminal_body` and appends terminal/activity laws; the DS candidate
adds the `Configure` builders, the `configure` verb case, the M-8
header binding, and the configure laws. The remaining DS files
(`control.bend`, `main.bend`, `mcp-conductor.mjs`, `bend2/README.md`,
`laws-trace.md`, `configure.py`, `mcp-command.py`) are untouched by
the listed #685 commits. Landing order stays with the #685 conductor
and root integration source; composition needs a rebase and a pinned
compiler entry build over the two files.

## Remote qualification (atari-homelab, pinned Node22)

- `node --test` over the candidate test file: 9 pass, 0 fail
  (`/home/atari2036/baton-integrate-recovered-20261006/node22`).
- Discovery run against a byte replay of the live 92-model capture
  through a stub `omp`: exit 0, `omp: queried, count 92`,
  codex/muse/claude `unknown`, 8 configured selectors reconciled
  (7 catalogued, `zai/glm-9` not-in-catalog), 91 candidates with
  `kimi-code/k3` refused, `currentQuota.unknown`, history preserved.
  Scoped run only; the full `check-native.sh` suite and the active
  PR #692 build were not duplicated.
- Evidence hashes: live capture `eb685a33...551c`,
  remote report `04a4dafd...339c`, script `2c7fc74e...d163`, test
  `1b15e7ec...35f7`. Raw files retained at `/tmp/qa683` on both
  machines; remote replay directory `/tmp/qa683` left in place.

## Recommended scoped composition (lead owns)

1. Mark exact-selector matches apart from cross-provider same-id
   matches in the discovery report.
2. Rule the registry/catalog precedence: either map the missing
   `zai/*` and `opencode-go/*` keys or scope `configure` refusal so a
   live-catalogued model is not refused by a stale registry.
3. Record each route change with its prior route and the failure that
   caused it.
4. Qualify `codex doctor --json` as the Codex access-state probe;
   keep quota `unknown` until a provider supplies windows.
5. State Bend laws over the selection and continuation functions and
   qualify the composed path on the remote runner against the live
  catalog shape in addition to the fixture shape.
