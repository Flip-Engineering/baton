[attempt: ac47ee06-4629-4d26-8420-a50d94a94277 row-cli2]

# row-cli2 notes — the CLI parser legs (append branch + run.watch + teaching)

## Scope

Owned seam: `impl/src/application-cli.mjs`, `impl/CLI.md`, and this notes file. The four
recovered rows' work is in the tree; the drain truncated the #158/#159 CLI legs (the append branch,
the D4 teaching, `scratchpadAppendBody`, `run.watch`, and `baton application help`). This row
restores those legs. Never touched the suites, the northbounds, application.mjs, or the ledger /
artifact (row-docs2's files). No clocks; byte literals stay in limits.mjs; additive-only.

## Implementation decisions

### `run.scratchpad.append` CLI parse (A1-1 / A1-2)

- Admitted `'run.scratchpad.append'` into `CLI_WEB_COMMANDS` (beside read/elevate) — the CLI/web
  shared admission set. This is what makes the verb DISPATCHABLE: the CLI web-client `command()`
  refuses any parsed name outside this set (`unsupported Run command`, application-cli.mjs:2199),
  so a parse-only append would be advertised-but-dead (the #157/#158 ghost the contract kills).
- `scratchpadAppendBody(kind, rawBody)` (application-cli.mjs:128): the closed per-kind body
  validator. `note` rides text verbatim; `plan`/`doubt`/`link` ride JSON parsed and validated into
  the kernel's closed per-kind shape (normalizeScratchpadEntry, coordination-store.mjs:607-696).
  A malformed body refuses `cli_invalid` naming the expected shape, never a silent string.
- The append branch (`baton run scratchpad append RUN_ID --scope shared|worker:ID --kind
  note|plan|doubt|link --body TEXT`): closed arg closure `{runId, scope, kind, body}` (no
  caller-supplied workerId, H1.3); `--scope` validated against `shared|worker:ID` exactly as the
  read branch; `--kind` defaults `note`.

### D4 bare/unknown-subverb teaching (A9-1 / A9-2)

- bare `run scratchpad` → `cli_invalid: run scratchpad requires a subcommand: read|elevate|append`
  (never `unexpected argument undefined`).
- unknown subverb is NAMED and the closed set restated:
  `run scratchpad bogus is not a subcommand; use read|elevate|append`.

### `run watch RUN_ID` → `run.watch` (R1 / R4)

- `run watch RUN_ID` compiles to `{kind:'command', name:'run.watch', args:{runId}}`. The name is a
  REGISTERED canonical operation (application-semantics.mjs:1261), so R1's registry assertion holds.
- bare `run watch` refuses value-required: `cli_invalid` with `id(undefined,'Run ID')` → "Run ID is
  invalid" (matches R4's `/run id|runId|required/i`).
- **PT-7 cross-wave constraint honored:** the `watch` branch is placed AFTER the
  `const lifecycleActions = new Set(...)` declaration, INSIDE the `!lifecycleActions.has(action)`
  guard. The cli-silent-start (#155) DERIVED detection set (`extractRunBranchFacadeLabels` scans
  only up to the `const lifecycleActions = new Set(` token) therefore never sees `watch`, so the
  detection set stays 39 and `detection.has('watch')` stays false — PT-7 (and PT-4's
  "watch-excluded" clause) stay green. The 39→40 re-pin is AVOIDED, not papered over.

### `baton application help` → `application.help` (R5 verb leg)

- The `application.help` canonical verb is `baton application help` (deriveSurfaceNames), but the
  parser only served `baton help` — so R5's verb column refused with the "expected credentials,
  setup, …" spelling. Added an `application` first-token handler that routes `application help
  [topic]` to the same `application.help` read, so the taught verb is never a refusing spelling.

### CLI.md taught forms

- Regenerated `impl/CLI.md` via `render-surface-docs.mjs` (the shipped generator, never hand-edit).
  The only diff is the added `run.scratchpad.append` row. `MCP.md` was byte-identical (already in
  sync), so the generator's rewrite left it unchanged.

## Verification (this worktree)

| Suite / rows | Expected | Actual |
|---|---|---|
| `scratchpad-write-red` A1-1, A1-2, A9-1, A9-2, P-A1 | green | **5/5 green** ✔ |
| `doc-truth-conformance-red` R1, R4, R5 | green | **3/3 green** ✔ |
| `cli-wave-fidelity-red` | green (16/16) | **16/16 green** ✔ |
| `cli-silent-start-red` | 7 pins green, 5 #155 rows red-by-design | **7 pass / 5 fail** (PT-1,PT-3,PT-6,PT-7,PT-8,PT-9,PT-10 green; PT-2a/2b/2c/4/5 red) ✔ |
| deployment verification (executable `true`, args `[]`, cwd `.`) | exit 0 | exit 0 ✔ |

The PT-7 `detection.size` assertion stays 39 (verified via the 7/5 split above — PT-7 green, and
the derived detection set never gains `watch`).

## Cross-row dependencies (NOT my seam — for row-docs2)

Adding `run.scratchpad.append` to `CLI_WEB_COMMANDS` changes the admitted CLI set, which makes the
committed inventory artifacts stale and leaves the verb unledgered. These are row-docs2's files and
landing order (their brief polls for this notes file before finalizing the artifact):

- **R7 (facade-ports-unledgered):** `run.scratchpad.append` is now in `CLI_WEB_COMMANDS` but is
  absent from the pinned 31-name web card (it is web-admitted via the WAVE_WEB_ENTRIES direct port,
  not the APPLICATION_COMMAND_DEFINITIONS card) and from `surface-divergence-ledger.json`. Needs a
  full-shape ledger entry (the `waves.compile` entry is the existing precedent for
  "web-admitted-direct-port but absent from the 31-name card").
- **R11 / P-CS1-b / P-CS4 (doc-truth) and CS1-b / CS4 (control-surface-truth):** the
  `surface-inventory-artifact.json` `counts.cliWebCommands` is now 39 vs the admitted 40.
  Regenerate via `node impl/scripts/surface-conformance.mjs --write-inventory` (row-docs2's step)
  — the counts derive from admission + parser, so this is sequenced after this row.

## DECISION_REQUEST (inherited from row-cli, unchanged)

`scratchpad-write-red` A10-1 leg (b) uses the regex `/run\\.scratchpad\\.append/u` (double
backslash) to pin `CLI_WEB_COMMANDS`. In a JS regex literal `\\.` is "backslash + any char", so the
pattern requires literal `run\.scratchpad\.append` (backslash-dots); a correct plain-dot admission
can never match. The P-A1 pin's single-backslash `/run\.scratchpad\.read/u` style proves the typo.
Leg (b) is unsatisfiable by any correct implementation — the verb IS admitted (leg (a) and the
plain-dot region both pass), but the row stays red. Suite not edited (craft law). Options: correct
the regex to single-backslash (matches P-A1's own style on the same set), or treat leg (b) as
unreachable-green and judge admission by leg (a) + the plain-dot entry.
