IMPL_RESULT_ACCESSOR-VERIFY v1
[attempt: 9bc03aba-9e3f-4ee9-b66a-8833200495ef coordinator]
Status: GROUNDED — awaiting row-result-accessor settle signal (signalOnMembersDone). Sections
§1–§4 are measured and final at base 5ae2c7e5; §5 (verdict, row counts, spot-audit) is written
on settle. This header block is replaced then.

# impl-result-accessor redrive1 — coordinator verification notes

Coordinator: wave `impl-result-accessor-2026-08-14-wave-b`, member `coordinator` (this worktree,
`ws-6bcb487a7eaed30622e2324c6a9c6ebc`, base `5ae2c7e5`). Row under verification:
`row-result-accessor` (glm-5.3), contract: `impl/test/harvest-accessor-red.test.mjs` (#99/#179
— the run.result() materialization surface). Verification law: the #174 paraphrase carried by
the coordinator brief — verify on disk in sibling worktrees `../../wt/ws-*/`; silence is not
death; read the row's notes file. Signal: `signalOnMembersDone row-result-accessor` (pinned #175
semantics — I am the remaining member). gh is UNAUTHENTICATED in this worktree (verified:
`gh auth status` refuses, "You are not logged into any GitHub hosts"); all evidence below is
grounded in the code and suite runs, none in GitHub.

## §1 Suites read in full, immutability baseline

Contract suite read in full at base. SHA-256 at base `5ae2c7e5` (the row's tree must match these
byte-for-byte — suites are immutable, green must be earned by impl):

- `impl/test/harvest-accessor-red.test.mjs` — f9e6f0578095e16ca58265c680abde01b8e962560b887ce6036aea4380a9a427
- Adjacents: wave-observability-red d32c7f347ce3e1506a79229e6a56e6245817a51093c972179f37125e0e306d97 ·
  waves-list-scaling-red 9e1ac2d806718bf10bc2ba3d29ed671435bca96cbd6db495c9c7e399aa5c0086 ·
  event-log-read-scaling-red 2bf46b7daafb19eeda7a3e0ae9c31cda8946f8a0f4a25c97c28486331b6fe32d

Suite stage inventory (from the suite header + test names, verified by run):
- harvest-accessor-red: 39 tests — 34 RED rows (A1–A4 ports absent · B1/C1/C2/D1–D5/K1/K2
  projection absent · E1/E2/F1/F2/G2/J1/J2/L1/L2 harvest absent · H1/H2/H5 tools absent ·
  H3/H4 wire vocabulary absent · I1/I3 CLI verb absent · I4 rows absent) and 5 GREEN GUARDS
  (I2, I5, I6, M1, M2) that must STAY green.

## §2 Measured baseline at base 5ae2c7e5 (my tree, run from repo root)

`node --test impl/test/<suite>.test.mjs`, measured this session:

| suite | tests | pass | fail | expected at base |
|---|---|---|---|---|
| harvest-accessor-red | 39 | 5 | 34 | 34 red rows fail at their named stage / 5 guards green — CONFIRMED, matches the suite header's recorded split exactly |
| wave-observability-red | 30 | 30 | 0 | green — CONFIRMED |
| waves-list-scaling-red | 1 | 1 | 0 | WLS-1 GREEN at this base (the brief's "may be RED-by-design" does not bite here — named, not absorbed) |
| event-log-read-scaling-red | 2 | 2 | 0 | green — CONFIRMED |

Every red row failed AT ITS NAMED STAGE (assertion messages carry the stage names). Stage
distribution of the 34 red rows: ports absent 7 (A1–A4, D6, N1, N2) · projection absent 10
(B1, C1, C2, D1–D5, K1, K2) · harvest absent 9 (E1, E2, F1, F2, G2, J1, J2, L1, L2) · tools
absent 3 (H1, H2, H5) · wire vocabulary absent 2 (H3, H4) · CLI verb absent 2 (I1, I3) · rows
absent 1 (I4).

## §3 Base-state anchors the row's impl must land (measured, cited)

At base, none of the pinned surfaces contain the accessor surface — every stage is genuinely
absent (verified by grep at base):

- `impl/src/application.mjs`: `run.resultpin` → 0 hits, `waves.harvest` → 0 hits. The dispatch
  layer `_commandDispatch` (application.mjs:12677) routes eight workflow-surface direct ports
  plus the waves.* ergonomics ports BEFORE `validateApplicationCommandArgs` and the
  recursive-session gate — the landing site for the two new direct ports (suite A1–A4/N2 pin
  this pre-gate dispatch). `M1` pins `APPLICATION_COMMAND_DEFINITIONS` gains no keys.
- `impl/src/mcp-northbound.mjs`: `baton_run_resultpin`/`baton_waves_harvest` → 0 hits (suite
  H1: ordinary surface 33 → 35, combined 84 → 86).
- `impl/src/application-cli.mjs`: no `resultpin`/`harvest` parse branch (suite I1/I3 pin
  `parseBatonCli` verbs + `CLI_WEB_COMMANDS` entries).
- `impl/src/application-semantics.mjs`: no `run.resultpin`/`waves.harvest` canonical rows
  (suite I4 pins two registry rows with surfaces/capabilities/names).
- Result machinery already present for the accessor to call: `changedPathsAtCommit(baseSha,
  resultSha)` (impl/src/index.mjs:772), `retainResult`/`resolveResult`/`releaseResult`
  (index.mjs:842–866), `refs/baton/results/{sha}` ownership (coordination-store.mjs:360),
  `task.sessionContext.baseSha` + `task.retainedResultRef` recorded at capture (ceremonyRun in
  the suite reads these). `run.view`/`run.episode` already resolve `retainedResultRef`
  (application.mjs `_episodeResult`-class readers) — the accessor seam extends this class of
  read, never the byte-stable command table.

## §4 Authority-class observations (recorded, final at base)

- The row brief permits `impl/src/application.mjs` (ADDITIVE ONLY — another wave owns a
  different application.mjs leg this window) and the northbound/CLI surfaces ONLY where the
  suite's pins name them, and forbids `workflow-*.mjs` / `application-cli.mjs` outright.
- The suite pins CLI verbs in `application-cli.mjs` (I1/I3, stage "CLI verb absent") — a file
  the brief forbids. Whether the row touches it (authority-class ambiguity) or leaves it for
  the owning wave is a judgment call the row must record; I will re-measure the CLI stage on
  settle and, if it is not green, file a DECISION_REQUEST (see §5.x) rather than absorb it.

## §5 Row verification (written on settle)

PENDING — row-result-accessor has not settled: no `notes-row-result-accessor.md` and no
in-partition impl changes exist in ANY sibling worktree `../../wt/ws-*/` as of this grounding
(verified by poll; other waves' worktrees are active and correctly left alone). A background
watcher polls the siblings for the row's report or impl changes.

### §5.x DECISION_REQUEST (authority-class ambiguity) — filed at settle with the row's outcome
