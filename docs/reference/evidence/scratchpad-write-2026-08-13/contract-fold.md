# Issue #158 — the shared scratchpad WRITE verb: folded contract v1.1

The implementation contract for issue #158: the shared scratchpad has no write/append verb on
ANY agent-facing surface — proven live by the #147 dogfood (the cli row could not publish its
report to `shared`; the handoff failed asymmetrically mid-wave). This is the **v1.1 fold** of
`scratchpad-write-contract.md` (v1): the adversarial red-team report (`contract-redteam.md`, same
dir) found v1 **NOT FOLD-READY** with five numbered blockers, four non-blocking minors, two
citation nits, and one ordering dependency. Every finding is folded below with the red-team's
concrete fix; where the red-team offered a choice, this contract names ONE option and states why.
Everything verdict'd SOUND in the red-team report is kept byte-stable in substance. The contract
remains a **Ring-2 contract** (ground truths → decisions → refusal vocabulary → red-first
acceptance pins → open questions): it **specifies behavior**; it does not amend implementation
in this artifact. It cross-references — it does not re-specify — the landed read law
(`contract-fold.md` §D1.2), the tight-cell D-depth-2 direct shared-tier write law, the #33
worker-side write lane, the #153 admission pattern (admitted means parser AND admission AND docs),
and the #157 CLI ghost-trap anti-pattern (advertised-but-dead verbs are the failure mode this
contract refuses to create).

- **Date:** 2026-08-13
- **Status:** FOLDED — implementation contract v1.1 (red-first; no code landed for this rung)
- **Verification HEAD:** `f8427ae` ("Baton private effective-tree snapshot"), the tree this fold
  was verified against. Every `file:line` citation below was re-verified this session with
  `grep -an`/`sed -n`/`Read` at this HEAD, not inherited. The red-team's report was written at
  `722bd36`; the diff `722bd36..f8427ae` touches `impl/src/workflow-interpreter.mjs` only at
  `:652-661` (the `harvest_ok` code — unrelated to every anchor this contract cites) plus its
  test — so every anchor the red-team verified holds verbatim at the fold HEAD. The two
  NUL-bearing files whose anchors are grep/sed/Read-verified, never whole-file reads:
  `application.mjs` and `coordination-store.mjs` (3 NUL bytes each). `web-northbound.mjs`,
  `mcp-northbound.mjs`, `application-cli.mjs`, `application-deployment.mjs`,
  `application-semantics.mjs`, `coordinator.mjs`, `workflow-interpreter.mjs`, and `limits.mjs`
  were read directly (NUL-free).
- **Brief:** `contract-fold-brief.md` (same dir) — read fully. The issue body (`gh issue view 158`)
  could not be fetched (`gh` is not authenticated in this worktree); the requirements are carried
  by the brief, the v1 contract, and the read-order below.
- **Read-order executed.** (1) `contract-redteam.md` (the adversarial report — NOT FOLD-READY, five
  numbered blockers at its end); (2) the v1 contract `scratchpad-write-contract.md` (the edit
  source); (3) the cross-referenced landed laws the red-team cites: `worker-orchestrated-swarm
  -2026-08-13/contract-fold.md` §D1/D1.2 (`:139-168`), `tight-cell-2026-08-06/tight-cell-contract.md`
  D-depth-2 (`:808,815-822`), `facade-projection-2026-08-03/facade-projection-contract.md`
  (`:217,636`), the control-surface audit suite, and every source anchor above.
- **Scope of the rung, in one sentence:** the shared scratchpad gains a WRITE/append verb
  (`run.scratchpad.append`) on CLI, MCP, and the web bus — the surface completion of the #33
  worker write lane — governed by a write law that is the exact sibling of the D1.2 read law, so
  a member writes `worker:<ownId>` + `shared` **of its own run**, the top orchestrator/review
  authority appends to `shared` only, cross-partition and cross-run writes refuse with the typed
  code, and the append verb itself never becomes a knowledge-graph candidacy shortcut (a direct
  `shared` append never mints a scratch-fact; elevation remains the promotion law, whose gate is
  pre-existing — see D1 law-4 scope note).

---

## Fold map (red-team finding → resolution → where in v1.1)

| # | Finding (red-team) | Verdict | Resolution folded | Where in v1.1 |
|---|---|---|---|---|
| 1 | H2.1 / A3 — web admission omits `WEB_DIRECT_PORT_COMMANDS`; every append envelope is refused `application_command_arguments_invalid` (a #157 ghost) | blocker | `run_scratchpad_append ∈ WEB_DIRECT_PORT_COMMANDS` is REQUIRED; the direct-port admission is four tables; A3 asserts a dispatched envelope | D2.4, A3 |
| 2 | H2.2 / A2 — MCP admission omits the `_dispatch` branch; the tool is advertised-but-dead | blocker | specify the `else if (name === 'baton_run_scratchpad_append')` dispatch branch routing to `application.command('run.scratchpad.append', …)` | D2.3, A2 |
| 3 | H1.1 — the "own run" predicate is unenforced at the seam | blocker | **choice (b):** the append restrictor resolves the principal's active run via the coordinator `_getWorker` seat binding and refuses `application_unauthorized` when `request.runId` differs | D1 law-2 + enforcement seam, D2.1, A4 |
| 4 | H1.2 — write→elevate self-escalation is open; law-4/A6 overstate the guarantee | blocker | **choice (b):** scope the pre-existing elevation-gate gap out and weaken law-4/A6 to "the append verb itself never mints a candidacy"; name the elevation-gate narrowing as a follow-on seam | D1 law-4 + enforcement seam note, D3, A6 |
| 5 | H3.1 / A8 — the replay binding omits `scope` for the two-scope verb; same-key cross-scope retry replays wrong | blocker | **choice (b):** the surface namespaces every idempotency key by scope before the kernel auth (`auth.key = \`${callerKey}:${scope}\``); the absent-key derivation is pinned (OQ2 resolved) | D3, A8, OQ2 |
| 6 | H1.3 — shared-append provenance (author identity) never pinned | minor | pin that a `shared` append's entry carries `workerId === auth.principalId` (server-bound, never a caller field), stated as a GREEN condition of the tight-cell mechanism | D2.1, D3, A1/A6/A7 |
| 7 | H1.4 / H3.2 — a member fills the shared cap → the review authority's mandated shared writes starve | minor | **choice:** accept the shared cap as the disclosed shared-drain bound and say so plainly; no ranking admission; A5 scoped | D1 law-3 note, D3, A5 |
| 8 | H2.3 — CLI underspecifies non-note JSON bodies | minor | **choice:** specify the CLI JSON parse + shape-validation for `plan`/`doubt`/`link` → `cli_invalid` naming the expected shape (mirrors the elevate branch's `--entries` handling) | D2.2, A1 |
| 9 | H2.4 — `ORDINARY_EXPLICIT_TOOLS` framing nit ("admitted" is loose) | nit | corrected: it is the typed-failure-mapping lane (`:1530`), not the admission set; admission is `TOOL_DEFINITIONS` (`:830`) | D2.3 |
| 10 | Nits — CLI scope grammar test is `:1485` (take at `:1483`); the `application_unauthorized` throw is `application.mjs:3222` (`contract-fold.md:419`'s `:3215` is the same `_authorize` function) | nit | corrected citations throughout | D2.2, refusal vocabulary, G3 |
| 11 | D4 ordering dependency — the message names `append`; message and parser branch must land in the same rung | note | folded as a red-first same-rung requirement | D4, A9 |
| 12 | A1/A3/A6/A7 GREEN all depend on the **unlanded** tight-cell shared-write kernel mechanism | note | each relevant pin states the kernel dependency in its GREEN condition | A1, A3, A6, A7, D2.1 |

---

## Ground truths (verified this session)

- **G1 — the write/append verb is absent on every agent-facing surface.** The control-surface
  parity table (`control-surface-audit.md:85`) marks scratchpad **write/append** absent on web,
  CLI, and MCP ("no verb on any surface — cli §1.2, §6 F-9"). A session-wide `grep -rn` for
  `run.scratchpad.append` / `run_scratchpad_append` / `baton_run_scratchpad_append` across `impl/`
  returns nothing — no parser branch, no registry row, no tool, no web admission, no docs.
- **G2 — the #33 worker-side write lane already exists.** The kernel `writeScratchpad`
  (`coordination-store.mjs:14064-14155`) writes a member's own `worker:<id>` partition with
  fence/CAS and idempotency-key replay; the coordinator wrapper `writeScratchpad(workerId, entry,
  opts)` (`coordinator.mjs:10790-10840`) resolves the member's active task and the live fence
  (the #48 erratum: the literal `'current'` resolves to the live worker fence); the emulated
  up-channel event is `scratchpad.write` → `scratchpad.write_result`
  (`coordinator.mjs:12690-12707`). The write lane this contract exposes is that lane's **surface
  completion**, not a new mechanism.
- **G3 — the D1.2 read law is LANDED and is this contract's authority anchor.** A member reads
  `worker:<ownId>` + `shared`; the top orchestrator (review authority, FP-18) reads any member
  scope of its own wave; a swarm row reads coordinator sub-specs only via an explicit wave-scoped
  grant or `shared` (`contract-fold.md:139-168`). Enforcement: `run.scratchpad.read` passes
  `{scope}` to `_authorize('run.scratchpad.read', principal, runId, {scope})` (`application.mjs:
  13097`) and the deployment authorize `restrictingReadAuthorize()`
  (`application-deployment.mjs:1728-1742`) resolves `shared` and the caller's own partition, and
  is installed as the DEFAULT at the construction site (`:2041`) — the permissive `async () => true`
  literal is GONE. `_authorize` throws `application_unauthorized` when the authorize does not
  return `true` (`application.mjs:3222` — the throw line; the same `_authorize` function holds
  both this citation and `contract-fold.md:419`'s `:3215`, which the #158 fold unifies on `:3222`).
  The write law must be its exact sibling.
- **G4 — the web bus refuses ALL eight facade ports, including scratchpad read/elevate.**
  `COMMAND_CAPABILITY` (`web-northbound.mjs:87-94`) has no scratchpad entry, so `validateEnvelope`
  refuses `run_scratchpad_read`/`run_scratchpad_elevate` with `unsupported command` (`:405`) —
  `surface-audit-web.md:41,304-309` (CLI_WEB_COMMANDS advertises the 8 facade ports the web
  refuses; a parity trap). The web bus's only facade-adjacent admissions are the S-1/S-2 wave
  direct ports (`WAVE_WEB_ENTRIES`, `web-northbound.mjs:37-47`) — the admission template for new
  verbs that must NOT touch `APPLICATION_COMMAND_DEFINITIONS`.
- **G5 — MCP has read/elevate tools and capabilities, no append.** Capabilities
  `baton_run_scratchpad_read: ['observe']`, `baton_run_scratchpad_elevate: ['control','observe']`
  (`mcp-northbound.mjs:114-115`); tool definitions `baton_run_scratchpad_read` (`:652-659`) and
  `baton_run_scratchpad_elevate` (`:661-668`); argument validation branches (`:1178-1193`); both
  in `ORDINARY_EXPLICIT_TOOLS` (`:822-829`). No `baton_run_scratchpad_append` exists.
- **G6 — CLI has read/elevate parse branches, no append; the bare `run scratchpad` leaks
  `undefined`.** The scratchpad parse branch (`application-cli.mjs:1476-1511`) handles `read`
  (`--scope`, `--cursor`) and `elevate` (`--task`, `--entries`); any other subverb — including the
  bare case where `sub === undefined` — falls through to `throw cliError(\`unexpected argument
  ${sub}\`)` (`:1511`), producing the live `baton run scratchpad` → `unexpected argument
  undefined` (`surface-audit-cli.md` §6 F-9, `:351-360`; §3 E-11/E-14, `:167,170`).
- **G7 — the byte/partition bounds already exist as declared constants; the write verb reuses
  them, it does not invent new caps.** `scratchpad.entry.body` (the #89 FRAME_LIMITS admission
  row, `limits.mjs:71`): 8192 bytes, class `admission`, enforcedAt `coordination-store
  .writeScratchpad`, refusalCode `scratchpad_entry_exceeded`. Store constants:
  `MAX_SCRATCHPAD_WRITE_REQUEST_BYTES = 16_384` (`coordination-store.mjs:492`),
  `MAX_SCRATCHPAD_ENTRY_BYTES = FRAME_LIMITS['scratchpad.entry.body'].value` (`:493`),
  `MAX_SCRATCHPAD_WORKER_ENTRIES = 128` (`:524`), `MAX_SCRATCHPAD_SHARED_ENTRIES = 512` (`:525`).
  These are deployment constants, not caller policy ("so live admission and replay use the same
  ceilings", `:490-491`).
- **G8 — the shared-tier write is not a new idea; the tight-cell D-depth-2 law already contracts
  it (RED at HEAD).** `tight-cell-contract.md:815-822`: cell members may write the shared tier
  directly with the cell's minted nonce; the fence CAS is unchanged (a stale fence refuses
  `stale_scratchpad_fence` exactly as today); idempotency keys are per-member; the orchestrator's
  elevation remains the law for PROMOTION to the knowledge graph — direct shared writes are the
  workflow-ephemeral tier, never a candidacy shortcut. The surface write verb rides this shape.
  **Fold (H1.3 / kernel-dependency note):** the mechanism is **unlanded at HEAD** —
  `tight-cell-contract.md:808` states "today: orchestrator elevation only" — so every GREEN pin
  whose receipt is a `shared` write states that kernel dependency explicitly (A1/A3/A6/A7).
- **G9 — the kernel currently hardcodes the worker scope on write.** `writeScratchpad` computes
  `const scope = \`worker:${fields.workerId}\`` (`coordination-store.mjs:14103`) and mints the
  entry id under that scope. The kernel envelope is closed to `['runId','taskId','workerId',
  'entry']` (`:14065`) with `auth.actor === 'worker'` and `auth.principalId === fields.workerId`
  (`:14066`). A surface append to `shared` therefore requires the direct shared-tier write shape
  (G8) to admit a `shared` scope on the write path — the mechanism is the tight-cell contract's,
  this contract names the surface verb that completes it. **Fold (H3.1):** the kernel `_byKey`
  replay (`:14086-14102`) binds `{kind, actor, runId, taskId, workerId, contentDigest}` — no
  `scope` term — so the surface must disambiguate the two-scope verb's idempotency keys before
  the kernel auth (D3).
- **G10 — `run.scratchpad` (the bare parent) and its read/elevate children are distinct registry
  rows, and the parent is itself a CLI ghost.** Registry rows: `run.scratchpad` (surfaces
  `['embedded','cli']`, effect `observe`, `application-semantics.mjs:1338-1348`),
  `run.scratchpad.read` (surfaces `['embedded','mcp','cli']`, `:1678-1686`), and
  `run.scratchpad.elevate` (surfaces `['embedded','mcp','cli']`, `:1687-1695`). The bare parent
  row claims `cli` but has no parser branch — the D4 trap. `run.scratchpad.read`/`elevate` are
  NOT in `APPLICATION_COMMAND_DEFINITIONS` (`application.mjs:168-207`), which is why they are
  absent from the web bus (G4) and why they dispatch as pre-gate direct ports
  (`application.mjs:12522-12523`).
- **G11 — the elevation gate is permissive for every command except the read verb.** The shipped
  default restrictor returns `true` for every non-read command (`application-deployment.mjs:1731`);
  `run.scratchpad.elevate` is a pre-gate direct port (`application.mjs:12523`) whose facade
  resolves the task server-side but authorizes against that permissive restrictor, and the
  coordinator wrapper hardcodes `actor: 'orchestrator'` at the kernel (`coordinator.mjs:10857-10860`).
  This is the pre-existing condition the H1.2 fold scopes out (D1 law-4 scope note).

---

## D1 — the write law (the D1.2 sibling)

Who may WRITE to a scratchpad partition is contract law, stated so the #158 handoff is decidable.
It mirrors the landed D1.2 read law (`contract-fold.md:139-168`) — cited, not re-litigated — with
one deliberate divergence for the review authority, justified against the trust doctrine below.

1. **A member principal may append to `worker:<ownId>` + `shared`** — exactly the D1.2
   visibility predicate (a worker sees its own `worker:<id>` scope plus the read-only `shared`
   scope). The member's own partition is the member's authored evidence trail; `shared` is the
   coordination tier the member may contribute to directly (G8: workflow-ephemeral, never a
   candidacy shortcut).
2. **A cross-partition or cross-run write refuses with the typed code.** A member appending to a
   sibling `worker:<other>` scope — or to a partition outside its own run — is refused
   `application_unauthorized` at the authorization seam. The "unknown ≡ foreign at the policy
   seam" default (#87, `facade-projection-contract.md:636`) that D1.2 implements for reads
   (`contract-fold.md:166-168`) applies identically to writes: a foreign write is refused before
   any entry is minted. **Fold (H1.1, blocker 3):** the "outside its own run" leg is ENFORCED at
   the seam, not merely stated — the append restrictor resolves the principal's active run and
   refuses when the caller-supplied `request.runId` differs (the enforcement-seam paragraph
   below). The D1.2 read restrictor has the same runId blindness (the red-team notes it), but
   this rung drafts the write restrictor fresh and does not inherit the gap.
3. **The top orchestrator / review authority (FP-18) appends to `shared` ONLY — never to a member
   partition.** This is the deliberate divergence from the D1.2 read law, which grants the review
   authority read access to any member scope of its own wave. **Justification against the trust
   doctrine:** a member's `worker:<ownId>` partition is that member's OWNED evidence — the
   fabricated-results seam (`contract-fold.md` §D1, SOUND as verified by the red-team) makes the
   separation of author and record a hard line. Read access for review is one thing; WRITE access
   would let the orchestrator mint records under a member's partition key that the member did not
   author, falsifying the member's audit trail. The review authority's write posture is therefore
   **shared-only advisory append**: its notes land in the shared tier (the ephemeral coordination
   lane every member reads), and its PROMOTION authority is unchanged — the elevation/settlement
   lane (`elevateTaskScratchpad`, `coordination-store.mjs:14173+`) is the only path that mints a
   knowledge-graph candidacy. **Fold (H1.4/H3.2, minor):** the review authority's shared advisory
   appends are bounded by the same declared 512-entry shared cap as any member's — the shared tier
   is a disclosed shared drain (D3); no ranking admission is introduced.
4. **A direct `shared` write is workflow-ephemeral and never a candidacy shortcut — and this
   rung's guarantee is bounded to the append verb's own action.** Writing to `shared` (whether by
   a member or the review authority) lands an entry in the shared partition — it does NOT mint a
   scratch-fact, does NOT create a KG candidate, and does NOT bypass the orchestrator's elevation
   law. This is the tight-cell D-depth-2 law verbatim (`tight-cell-contract.md:818-822`): "direct
   shared writes are the workflow-ephemeral tier, never a candidacy shortcut." **Fold (H1.2,
   blocker 4 — weakened claim + scoped gap):** the enforceable claim is **the append verb itself
   never mints a KG candidacy** — a direct `shared` append lands in the ephemeral tier, and a
   `worker:<ownId>` append joins the elevation-eligible partition without minting anything. The
   broader claim that "elevation remains the orchestrator's law" is NOT a guarantee this rung's
   seam enforces: the elevation gate is PRE-EXISTING and permissive (G11) — any principal who
   reaches the open `run.scratchpad.elevate` port can already elevate a resolved task's entries
   today via the #33 up-channel lane, and the append verb completes that same lane rather than
   opening a new escalation class. **Narrowing `run.scratchpad.elevate` to orchestrator/own-task
   is a NAMED FOLLOW-ON SEAM** — the deployment restrictor this rung installs (below) is the
   natural home — not a promise this rung ships. A6 is weakened to match.

**Enforcement seam.** The surface verb passes `{scope}` to
`_authorize('run.scratchpad.append', principal, runId, {scope})`, exactly as `run.scratchpad.read`
passes `{scope}` (`application.mjs:13097`); `_authorize` throws `application_unauthorized` when
the deployment authorize does not return `true` (`application.mjs:3222`). The deployment seam
(`application-deployment.mjs:2041`) must install an append restrictor whose policy is the write
law above:

- `shared` resolves for every principal;
- `worker:<scope>` resolves only for `principalId === scope` (the member's own partition);
- a `local-owner` / `service-*` (review authority) write to `worker:<scope>` is REFUSED unless
  `principalId === scope` — the review authority's write posture is shared-only (law 3). This is
  a STRICTER restrictor than `restrictingReadAuthorize` (which lets the review authority read any
  member scope): the strictness is the trust-doctrine divergence, and it is the seam closure the
  acceptance pins assert (A4/A5).
- **Fold (H1.1, blocker 3):** the restrictor additionally ENFORCES the own-run predicate of law 2.
  It is constructed with a seat-resolver closure — the coordinator's `_getWorker` binding
  (`coordinator.mjs:10791-10794`, which `writeScratchpad`'s wrapper already uses to resolve a
  member's active task) — so that for a worker-seat principal (`principalId` matching
  `worker:<id>`) it resolves the principal's ACTIVE run and refuses `application_unauthorized`
  when `request.runId` differs. `_authorize` already carries `runId` in the request object it
  passes to the deployment authorize (`application.mjs:3215-3222`), so the restrictor has the
  caller-supplied run in hand. **Choice made — option (b), why:** (a) pure server-side derivation
  of `runId` would break the review authority's mandated shared-append posture — a
  `local-owner`/`service-*` principal has no worker seat from which to derive a run, yet law 3
  requires its shared advisory appends; (c) a kernel run-membership check would amend the closed
  `writeScratchpad` envelope (G9/G10) and the unlanded tight-cell shared-write path — the
  campaign law forbids redesign of landed SOUND law, and this rung does not amend the kernel. The
  review authority's runId is accepted as named (orchestrator authority — the wave operator names
  the run it advises).
- **Fold (H1.2, blocker 4 — follow-on seam):** the same restrictor is the named home for
  narrowing `run.scratchpad.elevate` to orchestrator/own-task (the subject is `{taskId,
  entryCount}`, resolved against the task's assigned worker). It is NOT shipped by this rung; the
  law-4 scope note names the gap explicitly so a reader does not inherit it silently.

---

## D2 — the verb and its admission on the three surfaces

### D2.1 — the verb shape

- **Canonical operation name:** `run.scratchpad.append`.
- **Arg closure (closed, no extra fields):** `{ runId, scope, kind?, body, idempotencyKey? }`.
  - `runId` — the run whose scratchpad receives the entry (required, `validId`). The client names
    the run it *believes* it addresses; the D1 own-run predicate is enforced at the seam (the
    restrictor resolves the principal's active run and refuses a foreign `runId`, D1 enforcement
    seam).
  - `scope` — `shared` or `worker:<id>` (required, the `SCRATCHPAD_SCOPE` grammar,
    `coordination-store.mjs:533`). Which scopes a given principal may target is D1 law.
  - `kind` — one of `SCRATCHPAD_KINDS` (ACTUAL order `['note','plan','doubt','link']`,
    `coordination-store.mjs:535`). Defaults to `note`.
  - `body` — the entry content. For `note`: a string (the note text). For `plan`/`doubt`/`link`:
    a JSON value matching the kernel's closed per-kind shape
    (`normalizeScratchpadEntry`, `coordination-store.mjs:607-696`: `plan` = `{objective, steps,
    supersedes?}`; `doubt` = `{question, context?}`; `link` = `{label, relation, target}`).
  - `idempotencyKey` — optional at the facade; when present it must match
    `SCRATCHPAD_IDEMPOTENCY_KEY` (`^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$`, `coordination-store.mjs:534`)
    and drives the kernel's `_byKey` replay. When absent, the surface derives a server-side key
    (see D3 — replay).
  - **Fold (H1.3, minor — provenance pinned):** the closure EXCLUDES `workerId` — a caller cannot
    supply a forged author at the surface. The entry's `workerId` is **server-bound to
    `auth.principalId`** — for a `worker:<ownId>` append by the kernel's existing binding
    (`coordination-store.mjs:14066`), and for a `shared` append by the tight-cell D-depth-2
    mechanism this contract rides (G8): the shared-write kernel path must bind the entry's
    `workerId` to `auth.principalId` exactly as the worker path does (`:14100-14116`). That
    binding is a **GREEN condition** of the unlanded tight-cell mechanism (`tight-cell-contract.md:
    808` "today: orchestrator elevation only"); A1/A3/A6/A7 state the dependency.
- **Fence discipline (cross-referenced, not re-specified):** the write path keeps the
  tight-cell D-depth-2 fence CAS — a stale fence refuses `stale_scratchpad_fence` exactly as
  today (`tight-cell-contract.md:817-818`). At the surface, `expectedFence` is optional and
  absent resolves to the live fence exactly as the coordinator wrapper's `'current'` literal does
  (the #48 erratum, `coordinator.mjs:10807`; the #114 emulated up-channel omits the field). The
  surface append does NOT admit a numeric fence argument (prose workers cannot observe the turn
  fence — `coordinator.mjs:10799-10803`); fence CAS stays a coordinator/`shared`-write-path
  concern, not a client-supplied knob.

### D2.2 — CLI admission (parser AND admission AND docs — the #153 pattern)

- **Parser:** add an `append` branch to the scratchpad parse branch (`application-cli.mjs:1476-1511`)
  so `baton run scratchpad append RUN_ID --scope shared --kind note --body TEXT [--idempotency-key
  KEY]` compiles to `{kind:'command', name:'run.scratchpad.append', args:{runId, scope, kind?,
  body, ...}, idempotencyKey}`. `--scope` required and validated against the `SCRATCHPAD_SCOPE`
  grammar (the grammar test at `application-cli.mjs:1485` — the same check the read branch uses;
  the `take` of the value is at `:1483`); `--body` required; `--kind` optional (default `note`)
  and validated against `SCRATCHPAD_KINDS`; `noRemainder(args)` (the closed-set discipline the
  read/elevate branches already use).
  - **Fold (H2.3, minor — non-note bodies):** the CLI handles non-note kinds with a JSON parse +
    shape-validation step, refusing `cli_invalid` with a message naming the expected shape. For
    `--kind note`, `--body` is the text verbatim. For `--kind plan|doubt|link`, `--body` must be
    a JSON value matching the kernel's closed per-kind shape (`normalizeScratchpadEntry`,
    `coordination-store.mjs:607-696`): the parser `JSON.parse`s `--body` and, on malformed JSON or
    a shape mismatch, throws `cliError` (`cli_invalid`, the CLI's default class,
    `application-cli.mjs:50`) naming the expected shape (e.g. `--body must be JSON matching
    {objective, steps, supersedes?} for kind plan`). This mirrors the elevate branch's `--entries`
    JSON handling (`application-cli.mjs:1499-1501`). **Choice made, why:** restricting the CLI to
    `note` would re-create a partial-parity gap on the very surface the #147 dogfood failure
    implicated (the cli row's report could not publish to `shared`); the kernel already validates
    the shapes, so the CLI adds only the thin JSON-parse step.
- **Admission:** add `run.scratchpad.append` to `CLI_WEB_COMMANDS` (`application-cli.mjs:16-32`)
  so the CLI's web-client `command()` dispatch (`:2012-2026`) can route it. This is the #153
  admission half — a parser branch without the web whitelist entry would be a second ghost.
- **Docs:** the surface docs renderer must teach the verb (the #153 docs half). "Admitted means
  parser AND admission AND docs" is the pattern; the #157 ghost trap (advertised-but-dead, e.g.
  `run watch`) is the anti-pattern — this contract refuses to create one. A registry row
  `run.scratchpad.append` (surfaces `['embedded','cli']`, effect `control`, capabilities
  `['control','observe']`) in `application-semantics.mjs` (next to the read/elevate rows at
  `:1678-1695`) is the canonical docs/inventory source, and the pre-gate direct-port dispatch
  (`application.mjs:12522-12523` family) is extended by one branch.

### D2.3 — MCP admission

- **Tool:** add `baton_run_scratchpad_append` to the tool definitions (`mcp-northbound.mjs`, next
  to read/elevate at `:652-668`), input schema `{ repoId, runId, scope, kind?, body,
  idempotencyKey? }` with `scope` matching the `SCRATCHPAD_SCOPE` grammar and `kind` matching
  `SCRATCHPAD_KINDS`. Capability class `['control','observe']` in the capabilities table (next to
  `baton_run_scratchpad_elevate` at `:115`).
- **Validation:** add a `baton_run_scratchpad_append` branch to `validateArguments` (next to the
  read/elevate branches at `:1178-1193`): `runId` valid, `scope` matches the grammar, `kind`
  (when present) is a member of `SCRATCHPAD_KINDS`, `body` is a string (for `note`) or a valid
  JSON value, `idempotencyKey` (when present) matches `SCRATCHPAD_IDEMPOTENCY_KEY`. Refusal code
  `invalid_scratchpad_append`.
- **Admission + typed-failure lane:** add `baton_run_scratchpad_append` to `TOOL_DEFINITIONS`
  (`:830`) — **that** is the admission set — and to `ORDINARY_EXPLICIT_TOOLS` (`:822-829`) so its
  refusals reach the typed `stateFailureCode` lane, never the generic `command_failed` (the
  `:1530` mapping). **Fold (H2.4, nit):** `ORDINARY_EXPLICIT_TOOLS` is the **typed-failure-
  mapping** lane, NOT an admission set — a tool is admitted by being in `TOOL_DEFINITIONS`. The
  contract's intent (append refusals reach the typed lane) is correct and important; the framing
  is now exact: the append joins BOTH sets.
- **Fold (H2.2, blocker 2 — the dispatch branch):** the MCP `_callTool` dispatch chain must gain an
  explicit branch next to the read/elevate branches (`mcp-northbound.mjs:1900-1909`):

  ```js
  else if (name === 'baton_run_scratchpad_append') {
    value = await this.application.command('run.scratchpad.append', {
      runId: args.runId, scope: args.scope,
      ...(Object.hasOwn(args, 'kind') ? { kind: args.kind } : {}),
      body: args.body,
      ...(Object.hasOwn(args, 'idempotencyKey') ? { idempotencyKey: args.idempotencyKey } : {}),
    }, {
      actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
      principalId: principal.userId, sessionId: principal.sessionId,
    }, this._applicationDispatchContext(args, callId, principal));
  }
  ```

  Without this branch a `baton_run_scratchpad_append` that is defined + capability-advertised +
  validated falls through the chain with `value` unset → toolError/undefined: a #157 ghost on MCP.
  A2 asserts the dispatch.

### D2.4 — web bus admission (the direct-port pattern)

- `run.scratchpad.append` is NOT in `APPLICATION_COMMAND_DEFINITIONS` (G10), and that table's
  byte-stability is pinned by grammar-m3-red — so the web bus admits the verb via the **direct-port
  pattern** exactly as the wave verbs are admitted (`WAVE_WEB_ENTRIES`, `web-northbound.mjs:37-47`).
  **Fold (H2.1, blocker 1 — the fourth table):** the direct-port admission is FOUR tables, not
  three. `validateEnvelope` admits a command via `COMMAND_CAPABILITY` (`:405`), then gates argument
  validation at `:414`:

  ```js
  if (APPLICATION_COMMAND[envelope.command] && !WEB_DIRECT_PORT_COMMANDS.has(envelope.command)) {
      try { validateApplicationCommandArgs(...); } catch { return 'application_command_arguments_invalid'; }
  ```

  `validateApplicationCommandArgs` throws `application_command_unavailable` for any name not in
  `APPLICATION_COMMAND_DEFINITIONS` (`application.mjs:1846-1847`), and `run.scratchpad.append` is
  deliberately absent from that table (G10; its byte-stability is grammar-m3-red). Therefore the
  verb MUST be a web direct port: **`run_scratchpad_append ∈ WEB_DIRECT_PORT_COMMANDS`
  (`web-northbound.mjs:62`)** — extend the `:62` set (or its `WAVE_WEB_ENTRIES` derivation at
  `:37-47`) so the `:414` gate skips the `APPLICATION_COMMAND_DEFINITIONS` validator. A
  `run_scratchpad_append` entry carrying its own closed field set then joins `COMMAND_CAPABILITY`
  (`:87-94`), `ARG_FIELDS`/`ACCEPTED_ARG_FIELDS` (`:112-148`), and `APPLICATION_COMMAND`
  (`:149-151`) — those three plus `WEB_DIRECT_PORT_COMMANDS`. `validateEnvelope`'s `unsupported
  command` refusal (`:405`) then admits the verb, and `_dispatch` routes it through
  `this.application.command('run.scratchpad.append', …)` (`:1026,1035`). **Choice made, why:** the
  alternative (adding the transport to the three tables alone) leaves every append envelope refused
  `application_command_arguments_invalid` — the verb advertised and dead, the exact #157 ghost this
  contract's header swears to refuse. A3 now asserts a DISPATCHED envelope, not merely "not refused
  `unsupported command`".
- **Argument authority:** the web transport's argument authority is the port's own closed
  normalizer (`_normalizeScratchpadAppend`, the sibling of `_normalizeScratchpadRead`,
  `application.mjs:12870-12882`) — the direct-port pattern routes through the normalizer the
  dispatch already runs, so `validateApplicationCommandArgs` (which keys on
  `APPLICATION_COMMAND_DEFINITIONS`) is deliberately skipped (the `WEB_DIRECT_PORT_COMMANDS`
  skip, `web-northbound.mjs:62`). The web surface never admits fields the port's normalizer
  rejects.
- **Read/elevate web parity is OUT of scope for this rung.** The web bus continues to refuse
  `run_scratchpad_read`/`run_scratchpad_elevate` until a separate rung admits them; this contract
  only completes the WRITE half of the parity table (`control-surface-audit.md:85`). Open
  question OQ1 names the follow-on.

---

## D3 — bounds, rate/replay, and the elevate interaction

- **Byte bound (the #89 row governs the body).** `scratchpad.entry.body` (`limits.mjs:71`) is the
  governing admission row: 8192 bytes, class `admission`, enforcedAt `coordination-store
  .writeScratchpad`, refusalCode `scratchpad_entry_exceeded`. The kernel already enforces it
  through `normalizeScratchpadEntry` (`coordination-store.mjs:623-626` applies the
  `noteMaxBytes` override for a steering-registered run; the base cap is 2048 for non-steering
  notes and 8192 for steering-registered ones — `writeScratchpad`, `:14073-14077`). The surface
  verb does not re-declare the cap; it surfaces the kernel's existing refusal verbatim
  (`scratchpad_entry_exceeded`). The raw envelope ceiling `MAX_SCRATCHPAD_WRITE_REQUEST_BYTES =
  16_384` (`coordination-store.mjs:492`) bounds the whole request and is a deployment constant,
  not a new limit.
- **Partition caps (existing constants, not new limits).** A worker-scope append honors
  `MAX_SCRATCHPAD_WORKER_ENTRIES = 128` (`coordination-store.mjs:524`); a `shared` append honors
  `MAX_SCRATCHPAD_SHARED_ENTRIES = 512` (`:525`). Overflow refuses
  `scratchpad_partition_exhausted` (the kernel's existing refusal at `:14106-14107`). No arbitrary
  numeric limits are introduced; the campaign control law ("no clocks") is respected — no
  time-based rate limiter is added. **Rate/spam discipline:** the write is bounded by (a) the
  partition caps above, (b) the per-member idempotency-key replay (below), and (c) the D1 scope
  law (a member cannot write another member's partition, so cross-member spam into a worker
  partition is structurally impossible). **Fold (H1.4/H3.2, minor — the shared tier is a disclosed
  shared drain):** "cross-member spam is structurally impossible" is true only for `worker:`
  partitions; the `shared` tier is a shared drain. Any writer — member OR review authority — is
  bounded by the 512-entry cap (`:525`); the review authority's advisory appends may refuse
  `scratchpad_partition_exhausted` when the tier is full. **Choice made, why:** ranking the review
  authority ahead of members (a separate priority admission) would be a NEW admission tier — a new
  mechanism the discipline does not warrant for an advisory lane, and one that could not in any
  case protect the elevation batch path (which is capped at the same 512, `:14238-14240`, and is
  pre-existing). The contract therefore ACCEPTS the shared cap as the bound and says so plainly:
  A5's "appends to shared resolve" is scoped to "except when the shared tier is at its declared
  cap."
- **Durable event + replay.** A successful append lands a `scratchpad.entry_written` event
  (the kernel's existing event, `coordination-store.mjs:14148`) with the full receipt
  (`{ok, result, entryId, entryDigest, scope, scratchpadFence, eventSeq}`). Replay is the
  kernel's existing `_byKey` idempotency (`:14086-14102`): an exact retry under the same
  idempotency key returns the prior receipt (`result: 'idempotent'`); a retry whose binding
  changed (different runId/taskId/workerId/contentDigest under the same key) refuses
  `scratchpad_write_conflict`. **Fold (H3.1, blocker 5 — the two-scope replay binding):** the
  kernel `_byKey` binding has no `scope` term (it binds `{kind, actor, runId, taskId, workerId,
  contentDigest}`, `:14086-14102`, because the worker path hardcodes `worker:${fields.workerId}`,
  `:14103`). The append verb targets TWO scopes, so a caller-supplied key first used for `shared`
  and then for `worker:<ownId>` (or vice-versa, same content) would otherwise replay against the
  prior binding and return the prior receipt **with the wrong scope** — the shared write silently
  dropped or the worker write reported as shared. **The surface namespaces EVERY idempotency key
  by scope before the kernel auth:** a caller-supplied key `K` for scope `S` reaches the kernel as
  `auth.key = \`${K}:${S}\``; an absent key derives `run.scratchpad.append:<runId>:<scope>:
  <contentDigest>` (OQ2, now pinned). A same-key cross-scope retry therefore lands on DISTINCT
  kernel bindings (distinct entries), and an exact retry (same key, same scope) lands on the SAME
  namespaced binding (idempotent replay). **Choice made — surface namespacing, why:** the kernel
  `_byKey` replay is the #33 worker lane's landed mechanism and the kernel envelope is closed
  (G9/G10 — this rung does not amend the kernel; the shared-write kernel path is the unlanded
  tight-cell mechanism). Namespacing at the surface fully disambiguates the two-scope verb without
  touching the kernel, and composes with the OQ2 derived-key shape, which already includes
  `scope`. The "surface replay IS the kernel replay — no second layer" claim therefore holds for
  the two-scope verb.
- **Elevate interaction.** A written entry is elevatable per the existing machinery: an entry
  appended to a member's `worker:<ownId>` partition joins that partition and is eligible for
  `run.scratchpad.elevate` (`application.mjs:13131-13151` → `elevateTaskScratchpad`,
  `coordination-store.mjs:14173+`) exactly as a #33 up-channel note is today, and
  `elevateWhenNotes` (`workflow-interpreter.mjs:248-258` validation, `tryElevate` `:877-908`)
  reads the worker partition and elevates to `shared` once per (runId, role). An entry appended
  DIRECTLY to `shared` is already in the shared tier — it needs no elevation, and it NEVER mints a
  KG candidate (D1 law 4, G8). **Fold (H1.2):** this guarantee is bounded to the append verb's own
  action — the elevation gate itself is pre-existing and permissive (G11, D1 law-4 scope note),
  and this rung does not alter it. The `scratchpad.write` up-channel event does not fire for a
  surface append (the surface completes the lane server-side; the up-channel is the worker-emulated
  path the surface supersedes for CLI/MCP/web callers).

---

## D4 — the bare-`run scratchpad` trap

At HEAD, `baton run scratchpad` (bare) parses as `sub === undefined` and falls through to
`throw cliError(\`unexpected argument ${sub}\`)` (`application-cli.mjs:1511`) — the live refusal
`unexpected argument undefined` (`surface-audit-cli.md:351-354`, §3 E-11). `baton run scratchpad
<unknown>` produces the same throw with the unknown verb (`:170`, §3 E-14). The contract names
both refusals:

- **Bare `run scratchpad`** refuses with a closed-set teaching refusal, e.g.
  `run scratchpad requires a subcommand: read|elevate|append` (exit class `cli_invalid`). The
  refusal names the full closed set of subverbs — it never leaks `undefined` and never suggests a
  path the parser does not admit (the #157 ghost-trap avoidance).
- **Unknown subverb `run scratchpad <verb>`** refuses with the same closed-set teaching: the
  `<verb>` is named as unknown and the set `read|elevate|append` is stated.
- **Fold (D4 ordering dependency, red-first):** the teaching message names `append` — so the
  message and the parser's `append` branch MUST land in the SAME rung. A reader must not ship the
  message first (it would advertise a subverb the parser cannot serve — a miniature ghost). The
  red-first pin A9 asserts both together.

The D4 refusal is the CLI half of "the surface teaches what it refuses" (`control-surface-audit.md`
§2 #7): a refusal that names the admitted set is coaching; a refusal that leaks `undefined` is a
defect. This contract pins the coaching form.

---

## Refusal vocabulary

Reused codes (all landed; the append verb surfaces them verbatim, never re-spells them):

| Code | Source | Context |
|---|---|---|
| `application_unauthorized` | `application.mjs:3222` | D1 cross-partition / cross-run / review-authority-write-to-a-member-partition refused at the `_authorize` seam. (The throw is at `:3222`; `contract-fold.md:419` cites `:3215` in the same `_authorize` function — both unify here on `:3222`.) |
| `application_scratchpad_append_invalid` | new (normalizer) | Malformed append args at the facade normalizer (`_normalizeScratchpadAppend`, the sibling of `_normalizeScratchpadRead`, `application.mjs:12870-12882`). |
| `invalid_scratchpad_append` | new (MCP validator) | Malformed append args at the MCP `validateArguments` branch. |
| `scratchpad_write_invalid` | `coordination-store.mjs:14068` | Kernel envelope / idempotency-key shape invalid. |
| `scratchpad_entry_invalid` | `coordination-store.mjs:615` | Unknown kind or unknown/missing per-kind fields. |
| `scratchpad_entry_exceeded` | `limits.mjs:71` (row refusalCode) | Body over the #89 admission bound. |
| `scratchpad_partition_exhausted` | `coordination-store.mjs:14107` | Partition at cap (128 worker / 512 shared). |
| `scratchpad_write_conflict` | `coordination-store.mjs:14091` | Idempotency-key binding changed on retry. |
| `stale_scratchpad_fence` | `tight-cell-contract.md:817`; store fence CAS | Stale fence on the shared/write path. |
| `run_stopping` | `coordinator.mjs:10837` (allowed set) | Write attempted against a stopping run. |

No new refusal code is introduced for the D1 law itself — `application_unauthorized` at the
seam IS the D1 refusal (the write law's typed code), exactly as D1.2's sibling-refusal leg uses
`application_unauthorized` (`contract-fold.md:419`). **Fold (§6 caveat):** `stale_scratchpad_fence`
and `scratchpad_partition_exhausted` (shared) only exist on kernel paths that are
orchestrator/worker-only today; a member `shared` append reaching those codes requires the
unlanded tight-cell shared-write kernel path (G8) — consistent with a Ring-2 spec, and the reason
every `shared` GREEN pin states the kernel dependency.

---

## Red-first acceptance pins

RED = fails at HEAD (`f8427ae`); GREEN = passes after this contract's rung lands. Each pin asserts
behavior, not implementation. Verdicts from the red-team report are folded; where a pin's GREEN
depends on the unlanded tight-cell shared-write kernel mechanism, the pin STATES that dependency.

| Pin | Assertion | At HEAD |
|---|---|---|
| A1 | CLI append: `baton run scratchpad append RUN_ID --scope shared --kind note --body TEXT` writes an entry and returns the receipt `{ok:true, result:'written', entryId, entryDigest, scope:'shared', scratchpadFence, eventSeq}`. GREEN condition: a `shared` receipt depends on the **unlanded** tight-cell shared-write kernel path (`tight-cell-contract.md:808` "today: orchestrator elevation only") — the pin does not hide that kernel dependency. The `--kind note` path exercises the CLI's text body; the non-note JSON path (H2.3) is pinned at D2.2. | **RED** — no append branch; `unexpected argument append`. |
| A2 | MCP append: `baton_run_scratchpad_append` is advertised (capabilities `['control','observe']`), validated, **admitted in `TOOL_DEFINITIONS`**, routed through the typed-failure lane (`ORDINARY_EXPLICIT_TOOLS`), **AND dispatchable** — the `_dispatch` chain branch (H2.2, D2.3) routes a valid call to `application.command('run.scratchpad.append', …)` and a valid call writes to `shared`. | **RED** — no tool, no capability, no validator, no dispatch branch, not admitted. |
| A3 | Web append: `run_scratchpad_append` is admitted on the web bus via the direct-port pattern — the **four** tables: `COMMAND_CAPABILITY` + `ARG_FIELDS`/`ACCEPTED_ARG_FIELDS` + `APPLICATION_COMMAND` + **`WEB_DIRECT_PORT_COMMANDS`** (H2.1); a valid envelope is **dispatched** (assert a receipt, not merely "not refused `unsupported command`"), never refused `application_command_arguments_invalid`. GREEN condition: the dispatch's `shared` write depends on the unlanded tight-cell shared-write kernel path (G8). | **RED** — `validateEnvelope` refuses `unsupported command` (`web-northbound.mjs:405`). |
| A4 | D1 cross-partition AND cross-run: a member appending to `worker:<other>` (a sibling partition) — or to `shared`/`worker:<ownId>` of a run other than its own (H1.1) — refuses `application_unauthorized` at the `_authorize` seam, and no entry is minted. | **RED** — no append verb exists at all (trivially RED); the law is unenforced because unwritten. |
| A5 | D1 review-authority posture: `local-owner`/`service-*` appends to `shared` resolve **except when the shared tier is at its declared cap** (the disclosed shared-drain bound, H1.4/H3.2 — then `scratchpad_partition_exhausted`, the same refusal any shared write receives); appends to a member `worker:<scope>` (where `principalId !== scope`) refuse `application_unauthorized`; the deployment seam installs the append restrictor (the permissive literal absent for the append verb). | **RED** — no append restrictor at `application-deployment.mjs:2041`. |
| A6 | D1 shared-write is ephemeral: **the append verb itself never mints a scratch-fact / KG candidate** — a direct `shared` append lands in the workflow-ephemeral tier and needs no elevation; a `worker:<ownId>` append joins the elevation-eligible partition without minting anything. The pin does NOT assert the write→elevate path: the elevation gate's permissive non-read authorize is a PRE-EXISTING condition this rung explicitly does not remediate (H1.2, D1 law-4 scope note; the narrowing of `run.scratchpad.elevate` is a named follow-on seam). GREEN condition: a direct `shared` append exists only via the unlanded tight-cell shared-write kernel path (G8). | **RED** — no direct shared write exists. |
| A7 | D3 bounds: a body over `scratchpad.entry.body` (8192 B for a steering-registered run) refuses `scratchpad_entry_exceeded`; the 513th shared entry refuses `scratchpad_partition_exhausted`; the 129th worker entry refuses `scratchpad_partition_exhausted`. GREEN condition: the 513th-shared assertion exercises the **unlanded** tight-cell shared-write kernel path (G8); the pin states that kernel dependency rather than reading as a surface-only assertion. | **RED** — no append surface exists to test the bound through (the kernel bounds exist and are G7-verified, but no surface exposes them). |
| A8 | D3 replay: an exact append retry under the same idempotency key returns `result:'idempotent'` with the prior receipt; a retry whose binding changed refuses `scratchpad_write_conflict`; **a same-key different-scope retry lands as a DISTINCT entry** — the surface namespaces every key by scope before the kernel auth (H3.1, D3), so a key first used for `shared` and then for `worker:<ownId>` never replays against the wrong binding. | **RED** — no append surface. |
| A9 | D4 refusal: bare `baton run scratchpad` refuses with the closed-set teaching `run scratchpad requires a subcommand: read|elevate|append` — never `unexpected argument undefined`; an unknown subverb names the unknown and restates the set. **The teaching message and the parser's `append` branch land in the SAME rung** (the message never advertises a subverb the parser cannot serve). | **RED** — `unexpected argument undefined` (`application-cli.mjs:1511`). |
| A10 | Admission coherence (the #153 three-way, extended): the append verb is (a) in the CLI parser, (b) in `CLI_WEB_COMMANDS` + the **four-table** web direct-port admission incl. `WEB_DIRECT_PORT_COMMANDS`, (c) on MCP in `TOOL_DEFINITIONS` + `ORDINARY_EXPLICIT_TOOLS` + the `_dispatch` chain, and (d) in the semantic-registry row + docs; there is no surface where the verb is advertised-but-dead (no #157 ghost). The coherence A10 asserts is exactly what H2.1/H2.2 broke in v1's literal tables — the pin now covers the missing points. | **RED** — absent everywhere (trivially coherent because absent; the pin asserts the ADMITTED state is coherent). |

---

## Open questions

- **OQ1 — `run.scratchpad.read`/`elevate` web admission.** RESOLVED (SOUND, as the red-team
  verdicts): this rung completes the WRITE half of the parity table only
  (`control-surface-audit.md:85`); the web bus still refuses `run_scratchpad_read`/
  `run_scratchpad_elevate`. The WRITE-half-only posture is defensible — the #147 dogfood's failure
  was the write half, and the read half is served by CLI/MCP today. A follow-on rung may admit the
  read/elevate verbs on the web bus via the same direct-port pattern; it is named, not shipped.
- **OQ2 — idempotency-key derivation when the facade omits it.** **RESOLVED (folded into the D3
  fix, H3.1):** when absent, the surface derives the deterministic server-side key
  `run.scratchpad.append:<runId>:<scope>:<contentDigest>`. When present, the surface namespaces the
  caller-supplied key by scope before the kernel auth (`auth.key = \`${callerKey}:${scope}\``).
  Both shapes make an exact retry replay under the SAME namespaced key (idempotent) and distinct
  content mint a DISTINCT entry (never a silent overwrite — the #33 contentDigest discipline). The
  red-team's note that OQ2 as written covered only the absent-key case is folded: the
  caller-supplied-key cross-scope collision is now addressed by the same namespacing.
- **OQ3 — the `run.scratchpad` bare parent row.** RESOLVED (SOUND): once D4's closed-set refusal
  lands, the parent row's `cli` surface claim (`application-semantics.mjs:1338-1348`) is retained
  as a help/grouping node the parser resolves to the closed set — the D4 refusal teaches
  `read|elevate|append`, so the registry row's `cli` claim becomes honest once the parser refuses
  with the closed set.
- **OQ4 — steering-registered `noteMaxBytes` and the surface.** RESOLVED (SOUND): the kernel
  applies `noteMaxBytes = FRAME_LIMITS['scratchpad.entry.body'].value` (8192) only for
  steering-registered runs (`coordination-store.mjs:14070-14077`); a non-steering note is capped at
  2048 (`:623-626`). The surface keeps the kernel's single refusal verbatim
  (`scratchpad_entry_exceeded`); a doc note naming the 2048/8192 split is the resolution — no new
  surface distinction is introduced.

---

## Cross-references

- **`worker-orchestrated-swarm-2026-08-13/contract-fold.md`** §D1.2 (`:139-168`) — the landed
  read law this write law mirrors; §D1 (fabricated-results seam, the trust-doctrine justification
  for law 3); §D1.3 (truthful steering trail — the elevation lane the write feeds); `:419` (the
  `application_unauthorized` sibling-refusal leg, cited here at `application.mjs:3222`).
- **`tight-cell-2026-08-06/tight-cell-contract.md`** D-depth-2 (`:808,815-822`) — the direct
  shared-tier write with the cell's nonce; the mechanism the surface verb completes. `:808`
  ("today: orchestrator elevation only") is the RED-at-HEAD condition every `shared` GREEN pin
  states.
- **`facade-projection-contract.md`** (`:217,636`) — the scratchpad scope grammar and the
  "unknown ≡ foreign at the policy seam" default D1 law 2 implements for writes.
- **`control-surface-audit-2026-08-13/control-surface-audit.md`** §0 (asymmetric handoff), §1.3
  (`:85` parity row), §2 #10 (`:191-197` — the write-verb finding this contract answers),
  §1.4.1 (`webBusNames()` undercounts the web bus — the direct-port admission must be taught to
  the conformance inventory, else the web append reads as un-inventoried).
- **`control-surface-audit-2026-08-13/surface-audit-cli.md`** §6 F-9 (`:351-360`) and §3 E-11/
  E-14 (`:167,170`) — the D4 trap's live evidence and the `run scratchpad append` fix sketch.
- **`control-surface-audit-2026-08-13/surface-audit-web.md`** (`:41,304-309`) — the CLI_WEB_COMMANDS
  parity trap the web admission's fourth table (H2.1) exists to avoid.
- **`contract-redteam.md`** (same dir) — the adversarial report this fold resolves; its numbered
  blockers are folded per the fold-map at the top.
- **Issue #147 dogfood** (via `control-surface-audit.md` §0) — the live proof the shared-handoff
  failed because the CLI row had no write verb.
- **#33 worker scratchpad** — `coordination-store.mjs:14064-14155` + `coordinator.mjs:10790-10840`
  + `coordinator.mjs:12690-12707` (the up-channel); the lane this contract completes.
- **#74 swarm handoff / #114 interpreter** — `elevateWhenNotes` (`workflow-interpreter.mjs:248-258,
  877-908`), the wave integration the appended notes feed.
- **#89 FRAME_LIMITS** — `limits.mjs:71`, the governing byte row.

## Campaign-law constraints

- **No clocks.** No time-based rate limiter or expiry is introduced; the write is bounded by the
  declared partition caps and idempotency replay (D3), not by wall time.
- **No arbitrary numeric limits.** Every bound the verb honors is an existing declared constant
  (`limits.mjs:71`; `coordination-store.mjs:492-493,524-525`). No new cap is declared. The shared
  tier's 512-entry bound is accepted as the disclosed shared-drain limit (H1.4/H3.2) — a declared
  constant, not a new one.
- **No redesign of landed SOUND law.** D1.2 is law (`contract-fold.md:139-168`) — cited, not
  re-litigated. The write law is its sibling, with the ONE documented divergence (law 3, the
  review authority's shared-only write posture) justified against the trust doctrine. The kernel
  `writeScratchpad` envelope is not amended (H3.1's fix is at the surface); the elevation gate's
  permissive authorize is a named pre-existing condition, not silently altered (H1.2).
- **Ring-2 form.** This contract specifies behavior; it does not amend implementation. Every
  `file:line` citation was re-verified at HEAD (`f8427ae`) this session — the NUL-bearing files
  (`application.mjs`, `coordination-store.mjs`) by `grep -an`/`sed -n` only. Sorted-key literals
  appear in their ACTUAL order (`SCRATCHPAD_KINDS` = `['note','plan','doubt','link']`,
  `coordination-store.mjs:535`); `localeCompare` is never used.
- **Deliverable boundary.** The sole deliverable is
  `docs/reference/evidence/scratchpad-write-2026-08-13/contract-fold.md`; work was confined to
  `docs/reference/evidence/scratchpad-write-2026-08-13/**`. No source files were modified.
