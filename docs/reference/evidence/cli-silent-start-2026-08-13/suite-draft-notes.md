# suite-draft-notes — row-suite-155 (#155 CLI silent-start red-first suite)

[attempt: 08d0dac7-8ad0-4e7c-a13e-9d7a3bb855bc row-suite-155]

**Source of truth:** `cli-silent-start-contract.md` **v1.1 FOLDED** (verification HEAD `e371f70`).
The worktree copy is the v1.0 DRAFT; every citation in this suite was checked against the v1.1
text read from master (`20b8f6f`). The red team is `redteam-155.md`, the fold map `fold-155.md`.
The suite law that binds this row is `suite-foundry-2026-08-13-b/foundry-brief.md` (wave-b).

## Deliverable

`impl/test/cli-silent-start-red.test.mjs` — 12 tests, PT-1..PT-10. Parse-seam assertions only
(`parseBatonCli` imported from `../src/index.mjs`) plus static source-scan rows (ORDER/EXISTENCE/
byte-string only — no absolute line-window anchors, #166). No connection, no provider, no clock, no
host state, no temp files — hermetic by construction, so no `mkdtemp`/`test.after` fixture is needed
(the suite-law mkdtemp requirement is for suites that build fixtures; this one has none).

## Row inventory

| Row | Kind at HEAD | What it guards |
|---|---|---|
| PT-1 | **PIN (green)** | objective-first start form byte-identical to the phase68 pin (bare + `run start` + multi-word with flags) |
| PT-2a | **capability (RED)** | pinned transposition typos `shwo`/`sned`/`viwe`/`attenton` refuse `cli_command_unavailable` + suggestion + `run start` escape |
| PT-2b | **capability (RED)** | refused-position typos `steek`/`follw`/`membr` refuse with the dead verb's existing text (fold B2) |
| PT-2c | **capability (RED)** | generated Damerau–Levenshtein-1 sweep over the 9 contract seeds: exactly-one→refuse, zero/two-or-more→`run.start` (fold B4) |
| PT-3 | **PIN (green)** | never a guess: `deploy`/`refactor` (zero-match) and `stow` (two-or-more) fall through to objective-first |
| PT-4 | **capability (RED)** | recognition set computed from the single named derivation symbol — source-scan (a) FACADE_NOUNS, (b) ALIAS_FIRST_TOKENS, (c) detection ⊇ follow/steer/member ∧ taught-live ∌ watch, (d) guard replaces the naked fall-through, (e) no new `cli_*` code |
| PT-5 | **capability (RED)** | bare `run member` and `run member <unknown-sub>` refuse with the subverb teaching message |
| PT-6 | **PIN (green)** | `cli_command_unavailable` → exit 2 mapping in `baton.mjs`; happy-path `run.start` parse succeeds |
| PT-7 | **PIN (green)** | canonical aliases unchanged (view/list/member-view\|send\|stop\|interrupt/do/resume/retry resolve to HEAD); every recognized first-token still dispatches, never `run.start` |
| PT-8 | **PIN (green)** | `parseBatonCli(` precedes `discoverBatonConnection(` in `baton.mjs` — a parse-time refusal is structurally pre-connection |
| PT-9 | **PIN (green)** | `run follow` and `run steer <RUN_ID>` keep their existing `cli_command_unavailable` refusals |
| PT-10 | **PIN (green)** | `checkSurfaceDocs()` returns `[]` — the generated CLI inventory is unchanged |

## Stage table — every row at its named stage (pins green at HEAD, capabilities red)

Each test's name carries its canonical named stage (`PT-<n> [<stage>]`); the assertion messages
carry the granular stages below. "Fails a plausible wrong impl that…" is the pin-audit column the
suite law demands (green at HEAD **and** under a correct impl, but red under a plausible wrong one).

| Row | Kind | Named stage(s) | Reading at HEAD `e371f70` | Fails a plausible wrong impl that… |
|---|---|---|---|---|
| PT-1 | PIN | `stage[objective-first-*]` | **green** — bare / `run start` / multi-word all compile to `run.start` byte-identically to the phase68 pin | requires `run start` for every objective (removes the documented bare form, §1.3 / OQ-2) |
| PT-2a | capability | `stage[pinned-typo-<token>]` | **RED** — `run shwo`/`sned`/`viwe`/`attenton` all return `run.start` (the silent-start bug itself) | special-cases a token list, or uses plain Levenshtein (the three transpositions would pass at distance 2) |
| PT-2b | capability | `stage[pinned-typo-steek]`, `stage[pinned-typo-follw]`, `stage[pinned-typo-membr]` | **RED** — the refused-position typo class silently starts at HEAD (`run steek` = audit F-1 second headline) | drops follow/steer/member from the detection set (fold B2) or suggests a dead verb |
| PT-2c | capability | `stage[generated-damerau1-sweep]` | **RED** — 2711 exactly-one variants all return `run.start`; mismatch message shows first 12 + count | hardcodes any subset of variants (the sweep generates them), uses plain Levenshtein, or mis-renders any suggestion |
| PT-3 | PIN | `stage[never-guess-*]` | **green** — `deploy`/`refactor` (zero-match) and `stow` (two-or-more) start objective-first, never a guess | refuses zero-match or two-or-more tokens (over-refuses / guesses between candidates) |
| PT-4 | capability | `stage[facade-nouns-symbol-absent]`, `stage[alias-first-tokens-symbol-absent]`, `stage[derivation-symbol-absent]`, `stage[guard-replaces-naked-fallthrough]`, `stage[new-cli-code-minted]` | **RED** — the named derivation symbols are absent; the naked fall-through is still present | hand-lists the verb set (D-1 drift), mints a new `cli_*` code, or keeps the naked fall-through |
| PT-5 | capability | `stage[member-prefix-member]`, `stage[member-prefix-member-veiw]`, `stage[member-prefix-member-foo]` | **RED** — bare `run member` starts objective "member" (audit D-3); unknown sub-verbs throw `cli_invalid: unexpected argument` (fold M3/H2) | leaves the bare / unknown-sub `member` prefix unguarded |
| PT-6 | PIN | `stage[exit-code-bucket-2]`, `stage[exit-code-happy-path]` | **green** — `cli_command_unavailable` → exit 2; happy-path `run.start` parse succeeds | remaps the `cli_*` → exit 2 bucket |
| PT-7 | PIN | `stage[alias-*]`, `stage[recognized-dispatch-*]` | **green** — aliases resolve to HEAD (canonical ≡ legacy); all 39 recognized first-tokens dispatch, never `run.start` | disturbs the canonical alias layer or lets a recognized verb fall through to objective-first |
| PT-8 | PIN | `stage[parse-before-connection]`, `stage[parse-seam-importable]` | **green** — `parseBatonCli(` precedes `discoverBatonConnection(` in `baton.mjs` | moves connection discovery before parse (a typo could then reach provider spend) |
| PT-9 | PIN | `stage[follow-refuses]`, `stage[steer-refuses]` | **green** — `run follow` and `run steer <RUN_ID>` keep their existing `cli_command_unavailable` refusals | lets the typo-guard shadow the follow/steer refusals (suggesting a dead verb = #136 dead end) |
| PT-10 | PIN | `stage[surface-docs-conformance]` | **green** — `checkSurfaceDocs()` returns `[]` | adds or removes a served verb from the generated CLI inventory |

## Measured splits (split-twice, run from the repo root)

```
node --test impl/test/cli-silent-start-red.test.mjs
```

- **Run 1 — 12 tests, 7 pass / 5 fail** (7 PIN rows green; PT-2a, PT-2b, PT-2c, PT-4, PT-5 red)
- **Run 2 — 12 tests, 7 pass / 5 fail** (stable — identical split; the sweep ran in 416 ms run 1)
- Re-confirmed on the final named-stage suite (every pin a row at its named stage):
  **Run A — 12 / 7 / 5**, **Run B — 12 / 7 / 5** (stable)

Green PIN rows at their named stages: `[objective-first]`, `[never-a-guess]`, `[exit-code-bucket-2]`,
`[canonical-aliases-unchanged]`, `[parse-time-pre-connection]`, `[refused-positions-unchanged]`,
`[surface-docs-conformance]`. Red capability rows at their named stages: `[pinned-typo-refusals]`,
`[refused-position-typos]`, `[generated-damerau1-sweep]`, `[derivation-symbol-source-scan]`,
`[member-prefix]`.

The sweep composition at HEAD: exactly-one = **2711**, zero = **0**, two-or-more = **4**
(`stow`→{show,stop}, `shop`→{show,stop}, `eview`→{review,view}, `rview`→{review,view}),
skipped-exact = **3** (`attention`, `steer`, `follow` — identity variants produced by the
adjacent-duplicate transposition of the seeds themselves, which are rule-1 exact dispatches).
Zero-match is 0 by construction (every generated variant is distance-1 from its seed); the
zero-match arm of the exactly-one law is exercised by PT-3's dedicated `deploy`/`refactor` row.

## Judgment calls (recorded — no DECISION_REQUEST channel exists in this worktree)

1. **`shpw` residual example is internally inconsistent; the pinned metric wins.** The v1.1 §D3
   residual disclosure cites `shpw` for `show` as a "distance-≥2 typo" that escapes to
   objective-first. Measured: `shpw`~`show` = **1** (single substitution) under both Damerau and
   plain Levenshtein — the generated sweep classifies it exactly-one-match and asserts a refusal,
   contradicting the residual example. Decision: the sweep follows the pinned Damerau metric (the
   PT-2 acceptance pin wins; the residual example is treated as illustrative, not normative). This
   is recorded for the fold stage; the alternative (special-casing `shpw` to objective-first to
   match the prose) would contradict PT-2/D3's own metric.
2. **PT-9 pins `run steer <RUN_ID>`, not bare `run steer`.** Bare `run steer` at HEAD throws
   `cli_invalid: Run ID is invalid` at the parseStart runId position **before** reaching the
   `:1775-1779` M5-alias-sunset refusal. The contract's "run steer still refuses" is shorthand for
   the refusal site; reaching it requires a runId. `run steer RUN123` → `cli_command_unavailable:
   steer was deleted at the M5 alias sunset; use run send` (verified). `run follow` refuses at
   either spelling.
3. **PT-7 compares `{kind, name, args}`, not the whole parse object.** `run.start` generates a
   fresh random idempotencyKey per parse, so whole-object deep-equal would make the alias rows
   non-deterministic. The snapshot pins kind/name/args — the substantive parse semantics. The
   canonical↔legacy equivalence pairs (`run view`≡`run show`, `run list`≡`runs list`,
   `run member view`≡`run workstreams`, etc.) are byte-equivalence of those three fields.
4. **The lifecycle-set extraction is tolerant of the fold's rename.** PT-2c/PT-7 derive the
   lifecycle verbs by matching any `new Set([...])` literal of all-lowercase verb tokens and taking
   the maximal one (29 at HEAD; no other set literal rivals it). The contract D1's
   `RUN_RECOGNIZED_FIRST_TOKENS = [...lifecycleActions, ...]` composes the set, so under the fold
   the membership must survive even if the constant is renamed; the extraction tracks membership,
   not the identifier.
5. **The `run member interrupt` alias is pinned as resolving to `run interrupt`.** At HEAD both
   produce the same `semantic-action` parse result (the interrupt handler's pre-existing `undefined`
   name — a separate bug this contract does not touch). PT-7(a) asserts the equivalence, recording
   the byte-identical HEAD behavior rather than manufacturing a clean shape.

## Shared-scratchpad publish — failed; refusal recorded (campaign evidence #158)

The foundry-brief asks rows to publish notes to the `shared` scratchpad partition as they go; a
failed publish is itself campaign evidence. Attempted from this worktree at HEAD `e371f70`:

```
node scripts/baton.mjs run scratchpad write shared "<notes>"   →  cli_invalid: unexpected argument write
node scripts/baton.mjs run scratchpad elevate RUN123 --task T1 --entries '[]'  →  cli_config_invalid: user connection profile is unavailable
```

**Exact refusal:** the scratchpad facade at HEAD exposes only `read` and `elevate` sub-verbs
(`application-cli.mjs:1476-1511`) — there is **no client-addressable scratchpad write** verb, so a
`kind=note` publish to the `shared` partition cannot be addressed from the client surface. The
`SCRATCHPAD_WRITE` channel is a worker up-channel, not a CLI/MCP client path. The write-adjacent
`elevate` verb additionally fails at connection discovery in this disconnected worktree. This is
filed as the #158 family evidence: the campaign's publish instruction is unaddressable at HEAD.

## Deployment verification

Executable `"true"`, args `[]`, cwd `"."` — expected exit 0:

```
true   →   exit 0   (verified)
```
