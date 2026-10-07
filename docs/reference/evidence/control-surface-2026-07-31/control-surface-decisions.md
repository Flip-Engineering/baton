# Control-surface contract — server-truth conformance + dead-path resolution (v2)

(v2 folds the codex red-team (`redteam-v1.md`, verdict **UNSOUND**, R-CS-1..8). The decisive
corrections: (1) the board/lease authority boundary is CUT from this contract — rule 4/5's "use
the same coordinator wrappers" would have allowed a facade board write that bypasses the MCP
session-lease posture and board-fence CAS (R-CS-1 P0); (2) wave cross-surface transport is CUT —
`waves.start` stays registry-declared preset sugar per docs/36, and attach's
embedding-vs-portable decision is a separate grammar amendment (R-CS-2); (3) the bidirectional
surfacing rung is CUT — board/package rows ALREADY exist as ghost rows in the 44-op registry,
and their authority/profile/schema migration needs the security-reviewed sub-contract and the
registry-delta matrix first (R-CS-3); (4) every rung now carries its own C1/C2 coverage, the
ledger is removal-only, and quiesce preconditions are named (R-CS-5); (5) "server truth" is
pinned to a normative profile matrix with reference principals (R-CS-4); (6) the advertised
conformance command was vacuous — no main block — and gains one (R-CS-6); (7) citations
repaired (R-CS-7). Scope per R-CS-8: completion only.)

## What v2 is

Four tightly-scoped repairs that complete the grammar's *conformance* promise without moving
any authority boundary:

- **CS-1 — Server-truth docs + conformance main.** CLI.md/MCP.md generated inventories render
  from the *executable* inventory of named reference principals (never grammar intent, never
  hand lists); `surface-conformance.mjs` gains an executable main that fails on ledger
  invalidity, novel name/enum divergence, web-name collision, or stale generated docs.
- **CS-2 — Dead-path resolution.** `run resume` wired (the `lifecycleActions` omission,
  `application-cli.mjs:1332` vs parser :1612 — a bug); the seven parsed-but-whitelist-blocked
  verbs (`run episode`, `run result`, `run workstreams`, `run notify`, `run stop-member`,
  `run debug`, `context eval`) are wired to their live commands or refused at parse time with
  a typed corrective; `baton_runs` is advertised on the MCP application surface or removed
  from dispatch — no shadow operations.
- **CS-3 — `run.debug` registration.** The #53 direct port (`application.mjs:10503`, rationale
  :655-668) registers as canonical operation `run.debug`: facade accessor `run.debug()`,
  CLI dispatch for the already-parsed verb, doc rows. No new machinery — the port exists.
- **CS-4 — Citation + inventory artifact.** A checked inventory artifact produced from
  parser/dispatcher execution and instantiated MCP profiles (never regex extraction alone),
  correcting the two headline mis-citations in v1 (the "~10 parser verbs" claim cited
  `OPERATION_ALIASES` at `application-semantics.mjs:700-745`, not the parser — parser control
  begins at `application-cli.mjs:1194`, legacy CLI inventory at `application-semantics.mjs:813-856`;
  the `run.debug` comment citation belongs to `application.mjs:655-668`, not
  `application-cli.mjs:23-28`).

## Named successor contracts (out of scope here, recorded so nothing is lost)

- **S-1 — Wave grammar amendment:** `waves.start` stays preset expansion sugar of `run.start`
  (docs/36:289-294,324-326; CLI.md:24-28 "deliberately embedding-only"); `waves.attach`'s
  embedding-vs-portable decision; if portable: one canonical key with mechanically derived
  names accepted verbatim (`baton waves start`, never singular `wave start`), `waveId` as a
  required PUBLIC input to attach, only `mintWaveDetached` hidden. Deployment-facade parity
  (`waves.attach` missing at `application-deployment.mjs:1188-1195`) rides that decision.
- **S-2 — Board/package authority sub-contract (security-reviewed):** one shared admission
  primitive — closed session-authority envelope; active-lease resolution and revalidation at
  mutation admission (`coordination-store.mjs:1818-1842`); required board-fence CAS inside the
  same serialized command path (no TOCTOU split across an async authorization step);
  idempotency bound to the normalized request; untrusted callers NEVER defaulted to
  `orchestrator`; refusal order/codes pinned; negative tests for no-lease, wrong-session,
  revoked/expired lease, stale parent, closed run, stale fence, replay-same, replay-conflict
  BEFORE any facade method. Reconcile or remove the ghost board/package registry rows
  (`application-semantics.mjs:1231-1289` — ordinary-profile, all-surfaces by default,
  `runId/entryId/note/before` schema vs the live MCP `board/itemId/detail/ordinal` schema with
  required `expectedBoardFence`, `mcp-northbound.mjs:485-527`).
- **S-3 — Bidirectional surfacing matrix:** scratchpad elevate/settle, `decision.list`
  (canonical keys are dot-separated lowercase alnum — underscores rejected,
  `application-semantics.mjs:1088-1105`), REPL manifest/binding/citation, knowledge
  promote/recall — each with the R-CS-3 registry-delta row (exact key, closed profile enum,
  enabled surfaces, effect/durability, closed schema, authority-vs-server-derived fields,
  one-live-method mapping). Read-side projection ergonomics (the #51 workerResult claim bit
  dropped at `coordinator.mjs:2046-2050`, decision `deadlineAt` dropped at
  `application.mjs:337-357`, wave-driver attention extractors) belong to the separate
  bidirectional-ergonomics epic and need no authority boundary moved.
- **S-4 — M5 alias sunset** (docs/36; unchanged).

## Rules (v2)

1. **Docs render executable truth per reference profile.** A normative profile matrix names
   the reference principals (ordinary CLI principal; MCP `application` profile; MCP
   `advanced`; MCP `combined`; web bus principal; host-local CLI). Each generated doc section
   is produced by instantiating that profile's REAL inventory (MCP tool tables by profile
   construction, `mcp-northbound.mjs:824-864`; CLI parse+dispatch against the web-client
   whitelist, `application-cli.mjs:15-22,1770`; web bus entries) — never `deriveSurfaceNames`
   over grammar rows alone (`render-surface-docs.mjs:25-52` renders intent today). Hand
   inventories are deleted in the same commit; inventory-like prose (tool/verb counts and name
   lists, e.g. MCP.md:71-100) outside generated regions is linted red. Runtime introspection
   stays principal-filtered; no static manual depends on a live principal.
2. **No dead paths.** Every parsed CLI verb either dispatches or refuses at parse with a
   typed corrective naming the live spelling. `run resume` dispatches to `run.resume_work`.
   The five web-admitted blocked verbs (`run.episode`, `run.result`→`run.episode`,
   `run.workstreams`, `run.workstream.notify`, `run.workstream.stop` — all `web:true`) are
   added to the CLI web-client whitelist. `run debug` and `context eval` name host-local
   commands with no web route: `run debug` dispatches host-locally via CS-3; `context eval`
   gets a parse-time refusal naming the embedded/MCP paths — OR a host-local dispatch if the
   implementation finds one already wired (pinned either way by test). `baton_runs`
   (`mcp-northbound.mjs:29,48` dispatch, no tool definition in :325-401) is advertised on the
   MCP application surface — it is the canonical sibling of an already-advertised set — or
   deleted from dispatch; the choice is pinned by test, never left shadowed.
3. **Every repaired operation enters through the registry.** `run.debug` registers with exact
   key `run.debug` (canonical: dot-separated lowercase alnum), profile `ordinary`, surfaces
   `{embedded, cli}` (host-local; no web route exists — adding one is S-1-class scope),
   effect `observe`, mapping to the live direct port `application.mjs:10503`. Its facade
   accessor and CLI dispatch derive from the one registry row. Zero new aliases, zero new
   ledger rows (removal-only per docs/36:491-501 and R-CS-5).
4. **Green-at-every-commit rung discipline.** Each rung lands with its red-first tests AND
   its conformance coverage in the same commit: CS-1's conformance main fails before the docs
   are regenerated and passes after; CS-2/CS-3 each carry C1 name-resolution rows for their
   operations. No authority-digest-changing commit lands without a named quiesce precondition
   (CS-3 changes the registry authority digest — it lands alone, suite green, fleet quiesced:
   no waves in flight). The ledger shrinks only by removal of a real row in the exact commit
   that resolves it.
5. **Nothing in v2 moves an authority boundary.** No new mutation surfacing, no lease/fence
   relocation, no profile invention ("orchestrator profile" is not a landed name),
   `waves.*` stays embedding-only, scratchpad/board/REPL/knowledge mutation paths untouched.

## Red-first tests

- **CS-1 (`impl/test/control-surface-truth-red.test.mjs`):** (a) for each reference profile,
   instantiate the real inventory and assert the matching generated doc section equals it
   exactly — positive AND negative (a tool served but undocumented fails; a documented tool
   unserved fails); (b) `node impl/scripts/surface-conformance.mjs` has an executable main
   that exits non-zero on: invalid ledger, novel name divergence vs the registry, enum
   divergence, web-name collision, stale generated docs (pin each failure class with a
   fixture); (c) prose-inventory lint: a name-list/count outside generated regions in
   CLI.md/MCP.md fails (fixture doc).
- **CS-2 (`impl/test/cli-dead-paths-red.test.mjs`):** (a) `parseBatonCli('run resume …')`
   reaches `run.resume_work` dispatch (mock web client); (b) each of the five web-admitted
   verbs dispatches through the whitelist to its command; (c) `context eval` either dispatches
   host-locally or refuses AT PARSE with a typed code naming the live path (pinned whichever
   lands); (d) `baton_runs` appears in the instantiated MCP application-surface tool table
   (or is absent from dispatch — pinned); (e) regression: every previously-dispatching verb
   still dispatches.
- **CS-3 (`impl/test/run-debug-surface-red.test.mjs`):** registry contains `run.debug` with
   the rule-3 row; `batonRun.debug()` accessor returns the same payload as the direct port;
   `baton run debug RUN` dispatches (host-local) and prints the member-leg projection;
   CLI.md/MCP.md generated rows for `run.debug` match the served truth (CS-1 harness reuse).
- **CS-4:** the checked inventory artifact regenerates deterministically (byte-stable across
   two runs) and its counts are the ones cited in the docs (replacing v1's two mis-citations).

Deterministic: MockAdapter fixtures, in-process surfaces, mock web client, no live providers.

## Verification

```text
node --test impl/test/control-surface-truth-red.test.mjs impl/test/cli-dead-paths-red.test.mjs impl/test/run-debug-surface-red.test.mjs
node impl/scripts/surface-conformance.mjs
node impl/scripts/run-suite.mjs
```

## Explicit non-goals (v2)

Everything under "Named successor contracts" (S-1..S-4); any authority-boundary move (rule 5);
operator-console work; MCP profile restructuring; `combined`-profile split; `run.steer`
retirement; new bidirectional machinery or read-side projection changes (the #51 claim bit,
`deadlineAt` projection — bidirectional-ergonomics epic).

---

# (v1 — SUPERSEDED, retained for the fold trail)

v1 proposed four rungs (CS-1 server-truth docs + dead paths; CS-2 grammar registration of
`waves.*`/`run.debug`; CS-3 bidirectional surfacing incl. board writes through the facade with
lease/fence enforcement moved into the command path; CS-4 conformance hardening). The codex
red-team found it UNSOUND: the facade board path could bypass the MCP session-lease posture
(R-CS-1 P0); wave naming contradicted derivation and docs/36's preset-sugar treatment
(R-CS-2); rule 4 had no registry/profile/schema delta and mis-stated already-registered ghost
rows as new (R-CS-3); "server truth" was ambiguous for profile-filtered surfaces (R-CS-4);
the rungs violated green-at-every-commit (R-CS-5); the advertised conformance command was
vacuous (R-CS-6); two citation errors (R-CS-7); the scope combined completion with a
security-boundary move (R-CS-8). v2 narrows to the surviving sections: server-truth
conformance, dead-path resolution, `baton_runs`, `run.debug` registration, and the
conformance main — with the authority and wave-semantic work named as successor contracts.
