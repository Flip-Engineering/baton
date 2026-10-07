# Provider683 re-qualification, implementer commit 4fe300f (2026-10-07)

Reviewer seat `provider683-muse-review-20261006`, ensemble
`provider683-completion-20261006`. This report re-qualifies
`4fe300fdf654fbd54bef7531e008ee698ba2741b` (parent `ecfbdd0b`, tip of
`codex/provider683-deepseek-impl-20261006`): the `models` read and the
`provider-probe` control operation for #683. No candidate source was
modified. The first review
(`docs/bend2/provider683-muse-review-20261006.md`) stands; this report
checks that commit against it.

## File review

- `bend2/src/coordinator/models.bend` (new, 158 lines): the `models`
  read answers one `baton2-models-v1` document with registry aliases,
  observed routes, per-harness provider rows, and seat continuation.
  The read starts no process and runs no transaction of its own. The
  declared-at-bind columns are labeled as declared, not observed.
- `bend2/src/coordinator/probes.bend` (new, 295 lines): the
  `provider-probe` command resolves the executable through the host
  binding, runs the adapter's own read, and commits one append-only
  `provider_probes` row with the provider text verbatim, parsed
  metadata and capacity, and the store clock. The insert in the probe
  path is the only write to the table. Catalog reads: codex
  `debug models`, omp `models --json`. Model-scoped read: muse
  `model-profile show MODEL`. `claude-code` has no read and is
  recorded `refused`.
- `bend2/src/coordinator/continuation.bend` (new, 96 lines):
  candidates are recorded or observed routes on the four turn
  adapters. Usable requires a successful latest probe plus a registry
  alias or a listed identifier. A registry that maps no key does not
  refuse. Zero usable candidates answer
  `continuation-capacity-unknown` with candidates and pending input
  kept visible.
- `bend2/src/coordinator/discovery-laws.bend` (new, 8 laws) plus 4
  harness laws plus 1 entry law: 13 operative laws, each over its
  function, each with a mutation control in `laws-check.mjs` (13
  entries verified present).
- `bend2/src/harness/{codex,omp,muse}-player.bend` and `laws.bend`:
  each adapter states its own query argv; laws pin the exact argv.
- `bend2/src/coordinator/{commands,control,main,laws}.bend`:
  `Models` and `ProviderProbe` commands, `provider_probes` schema,
  read dispatch, and usage text. The parse covers `models`,
  `models SESSION`, `models --pretty`, `models SESSION --pretty`,
  and `provider-probe HARNESS HARNESS_CMD [MODEL]`.
- `bend2/test/models.py` (new, 16 tests): fixture-harness coverage
  of the read, the probe outcomes, access states, refusal naming, and
  both continuation answers.
- `bend2/README.md` and `docs/bend2/provider683-discovery-2026-10-07.md`:
  surface documentation with observed adapter boundaries. The README
  example uses `muse-spark-1.3` as a sample argument only.

## Composition items from the first review

1. Exact-selector versus cross-provider marking: addressed. A listed
   candidate matches only the identifier its own harness reported, by
   exact string equality. `proposal.basis` names `listed-exact-selector`
   or `configured-registry-alias`.
2. Registry and catalog precedence for zai and opencode-go keys:
   addressed on the discovery side. Usable admits a probed model that
   is configured or listed, and an unmapped registry does not refuse.
   The `configure` operation itself is not in this commit; its
   registry resolution stays with the #681 verb.
3. Route-change record with prior route and failure: not in this
   change. The discovery doc defers applying and recording a route to
   `configure` and the #681 failover verb.
4. Codex doctor access probe with quota unknown: addressed. The Codex
   probe runs `doctor --json` beside the catalog and parses the stored
   credential mode and status. The parsed field paths match the live
   report shape observed on 2026-10-07. The report states no quota
   window, so capacity stays unknown.
5. Bend laws over selection and continuation: addressed. Thirteen
   laws bind the read, the probe record, the candidate set, the
   capacity answer, and the four adapter queries.

## Capacity boundary

A probe that states no limit, usage, remaining, or reset time leaves
capacity unknown and names all four in `absent`; a zero component
stays zero. A failed or absent read records an error or refused row
with cause and observation time, and the models list stays null. The
candidate set consults only the latest probe per harness, so a
recorded failure stays history. The refusal keeps the would-be candidates, their
conditions, and the seat's owed input count visible.

## Acceptance verdicts

1. Codex set with Sol and Luna: PROVED for the adapter read. Live
   `codex debug models` (codex-cli 0.160.1, 2026-10-07) returns 11
   slugs including `gpt-6-sol` and `gpt-6-luna`; the law pins that
   exact argv. End to end through the built binary against the live
   harness is UNOBSERVED: the Linux binary cannot run the laptop
   harnesses.
2. Kimi K3, Muse, and GLM variants: PROVED for the omp path. Live
   `omp models --json` (17.4.0, 92 models) lists `kimi-code/k3`,
   `opencode-go/muse-spark-1.3-contributor`, and zai plus opencode-go
   GLM entries. The muse probe is model-scoped only (finding F1).
3. Alias versus account-usable distinction: PROVED. The document
   separates configured aliases, observed routes, per-harness
   metadata with access, capacity with absent components, and
   continuation candidates with per-candidate conditions.
4. Quota failure plus fresh query continuing same-seat work: PROVED
   at fixture level. The refusal keeps candidates and pending input
   visible, and a probed alternative is proposed for the same seat.
   A live quota-exhaustion failover is UNOBSERVED; no provider states
   a quota window.
5. Bend law coverage: PROVED. Thirteen laws compile with the entry;
   three scoped negative controls fail closed naming their law (see
   receipts). The implementer's full gate was still running at report
   time with no discovery lines on record.
6. No hard-coded model allowlist: PROVED. New runtime source names no
   model. Identifiers arrive only in provider output or caller
   arguments. Test fixtures use invented names.

## Findings

- F1. The muse probe trusts the caller's string. A zero exit records
  the supplied MODEL as the listed identifier without parsing provider
  output. Live `muse model-profile show no-such-model-xyz` exits 0
  with the generic profile, so a muse `listed-exact-selector` basis can
  rest on an unverified name. This contradicts the discovery doc
  sentence that reported identifiers are stored exactly as the
  provider stated them, for the muse path.
- F2. With zero recorded routes the refusal `next` reads
  `["provider-probe", null, ""]`. The operator supplies the harness.
- F3. `models --pretty` needs `json_pretty`; a SQLite without it
  answers exit 1 on stderr. The test already skips that case on such
  hosts.
- F4. The implementer's relay note counts nine discovery mutation
  entries; the commit carries thirteen. The scope description is
  otherwise accurate: the delta is additive and holds no 685 files.
- The #685 overlap from the first review is unchanged: same files
  `commands.bend` and `laws.bend`, different regions. Landing order
  stays with the native685 conductor and root integration source.

## Remote receipts (atari-homelab, pinned toolchain)

- `build-native.sh` with `bend` (2.0.25), `CC=clang-19`: exit 0,
  binary `.scratch/bend2/baton2` (5,836,872 bytes). Entry compile
  proves the thirteen laws.
- `bend2/test/models.py`: 16 tests, OK, 1 skip (no `json_pretty` in
  host SQLite).
- Scoped negative gate on the composed tree, 3/3 passed (mutation
  applied, compile failed, failure names the law):
  `discovery-usable-ignores-the-observation`,
  `discovery-missing-read-becomes-an-empty-catalog`,
  `discovery-probe-writes-an-inbox-row`.
- Direct binary checks: `models` on an empty store answers the schema
  document with registry absent; `provider-probe claude-code`
  records the refused row with full-absent capacity; unknown harness
  exits 2 with `probe-harness-unsupported`.
- Full `check-native.sh` over the composed tree: exit 1 with one
  failure, `accept-kimi-hierarchy.py` GeneratedCheck (`OSError:
  argument list too long` from a deep scratch path). The same failure
  occurs on the implementer's baseline run, so it is pre-existing and
  not caused by this commit. The script stops at that file and never
  reaches `models.py`; the direct `models.py` run above is the models
  receipt on this host.
- Implementer's `laws-check` full gate: still running at report time;
  no discovery mutation lines on record yet. The three scoped negative
  controls above are the independent negative evidence.

## Live harness observations (operator laptop, 2026-10-07)

- `codex debug models`: 11 slugs, exit 0. Includes `gpt-6-sol` and
  `gpt-6-luna`.
- `codex doctor --json`: `auth.credentials` status ok with stored
  mode details; no quota window. Only shapes recorded, no secret
  values.
- `omp models --json`: 92 models with selector, provider, id, name,
  context window, thinking levels; no quota, account, or auth field.
- `muse model-profile show`: resolves the named id per effort tier;
  exit 0 with a generic profile for an invented id.
- `claude-code`: no metadata read observed, matching the refused
  recording.

## Recommendation

 land the discovery surface after the full gate receipts complete,
 fix the F1 muse basis (parse the provider's echoed identifier or
 mark muse listings caller-stated), and keep the F2 null-harness
 guidance explicit. Route application and its record stay with the
 `configure` and #681 verb work.
