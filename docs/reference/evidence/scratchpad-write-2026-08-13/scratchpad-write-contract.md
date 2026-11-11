# Issue #158 — the shared scratchpad WRITE verb: surface completion of the worker write lane

The implementation contract for issue #158: the shared scratchpad has no write/append verb on
ANY agent-facing surface — proven live by the #147 dogfood (the cli row could not publish its
report to `shared`; the handoff failed asymmetrically mid-wave). This contract is a **Ring-2
contract** (ground truths → decisions → refusal vocabulary → red-first acceptance pins → open
questions). It **specifies behavior**; it does not amend implementation in this artifact. It
cross-references — it does not re-specify — the landed read law (contract-fold.md §D1.2), the
tight-cell D-depth-2 direct shared-tier write law, the #33 worker-side write lane, the #153
admission pattern (admitted means parser AND admission AND docs), and the #157 CLI ghost-trap
anti-pattern (advertised-but-dead verbs are the failure mode this contract refuses to create).

- **Date:** 2026-08-13
- **Status:** DRAFT — implementation contract (red-first; no code landed for this rung)
- **Verification HEAD:** `72a0c0f` ("Baton private effective-tree snapshot"), the tree this
  contract was verified against. Every `file:line` citation below was re-verified this session
  with `grep -an`/`sed -n`/`Read` at this HEAD, not inherited. The two NUL-bearing files whose
  anchors are grep/sed/Read-verified, never whole-file reads: `application.mjs` and
  `coordination-store.mjs` (3 NUL bytes each). `web-northbound.mjs`, `mcp-northbound.mjs`,
  `application-cli.mjs`, `application-deployment.mjs`, `application-semantics.mjs`,
  `coordinator.mjs`, `workflow-interpreter.mjs`, and `limits.mjs` were read directly (NUL-free).
- **Brief:** `contract-158-brief.md` (same dir) — read fully. The issue body (`gh issue view 158`)
  could not be fetched (`gh` is not authenticated in this worktree); the requirements are carried
  by the brief and the read-order below.
- **Read-order executed.** (1) this brief; (2) the control-surface audit and its CLI/web/MCP
  surface audits (§0, §1.3 parity table, §2 #10, `surface-audit-cli.md` §6 F-9/S-3); (3) the
  landed read law (contract-fold.md §D1.2) and its enforcement seam (`restrictingReadAuthorize`,
  `application-deployment.mjs:1728-1742`); (4) the scratchpad kernel (partition grammar + kinds +
  bounds + `writeScratchpad` + `elevateTaskScratchpad`, `coordination-store.mjs`); (5) the #33
  worker-side write (store `writeScratchpad` + coordinator wrapper + `scratchpad.write`
  up-channel); (6) the wave integration points (`elevateWhenNotes`, `workflow-interpreter.mjs`).
- **Scope of the rung, in one sentence:** the shared scratchpad gains a WRITE/append verb
  (`run.scratchpad.append`) on CLI, MCP, and the web bus — the surface completion of the #33
  worker write lane — governed by a write law that is the exact sibling of the D1.2 read law, so
  a member writes `worker:<ownId>` and `shared`, the top orchestrator/review authority appends to
  `shared` only, cross-partition writes refuse with the typed code, and the write never becomes a
  knowledge-graph candidacy shortcut (elevation remains the promotion law).

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
  `{scope}` to `_authorize('run.scratchpad.read', …)` and the deployment authorize
  `restrictingReadAuthorize()` (`application-deployment.mjs:1728-1742`) resolves `shared` and the
  caller's own partition, and is installed as the DEFAULT at the construction site (`:2041`) — the
  permissive `async () => true` literal is GONE. `_authorize` throws `application_unauthorized`
  when the authorize does not return `true` (`application.mjs:3222`). The write law must be its
  exact sibling.
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
- **G9 — the kernel currently hardcodes the worker scope on write.** `writeScratchpad` computes
  `const scope = \`worker:${fields.workerId}\`` (`coordination-store.mjs:14103`) and mints the
  entry id under that scope. The kernel envelope is closed to `['runId','taskId','workerId',
  'entry']` (`:14065`) with `auth.actor === 'worker'` and `auth.principalId === fields.workerId`
  (`:14066`). A surface append to `shared` therefore requires the direct shared-tier write shape
  (G8) to admit a `shared` scope on the write path — the mechanism is the tight-cell contract's,
  this contract names the surface verb that completes it.
- **G10 — `run.scratchpad` (the bare parent) and its read/elevate children are distinct registry
  rows, and the parent is itself a CLI ghost.** Registry rows: `run.scratchpad` (surfaces
  `['embedded','cli']`, effect `observe`, `application-semantics.mjs:1338-1348`),
  `run.scratchpad.read` (surfaces `['embedded','mcp','cli']`, `:1678-1686`), and
  `run.scratchpad.elevate` (surfaces `['embedded','mcp','cli']`, `:1687-1695`). The bare parent
  row claims `cli` but has no parser branch — the D4 trap. `run.scratchpad.read`/`elevate` are
  NOT in `APPLICATION_COMMAND_DEFINITIONS` (`application.mjs:168-207`), which is why they are
  absent from the web bus (G4) and why they dispatch as pre-gate direct ports
  (`application.mjs:12522-12523`).

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
2. **A cross-partition write refuses with the typed code.** A member appending to a sibling
   `worker:<other>` scope — or to a partition outside its own run — is refused
   `application_unauthorized` at the authorization seam. The "unknown ≡ foreign at the policy
   seam" default (#87, `facade-projection-contract.md:636`) that D1.2 implements for reads
   (`contract-fold.md:166-168`) applies identically to writes: a foreign write is refused before
   any entry is minted.
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
   knowledge-graph candidacy.
4. **A direct `shared` write is workflow-ephemeral and never a candidacy shortcut.** Writing to
   `shared` (whether by a member or the review authority) lands an entry in the shared partition —
   it does NOT mint a scratch-fact, does NOT create a KG candidate, and does not bypass the
   orchestrator's elevation law. This is the tight-cell D-depth-2 law verbatim
   (`tight-cell-contract.md:818-822`): "direct shared writes are the workflow-ephemeral tier,
   never a candidacy shortcut."

**Enforcement seam.** The surface verb passes `{scope}` to
`_authorize('run.scratchpad.append', principal, runId, {scope})`, exactly as `run.scratchpad.read`
passes `{scope}` (`application.mjs:13097`); `_authorize` throws `application_unauthorized` when
the deployment authorize does not return `true` (`application.mjs:3222`). The deployment seam
(`application-deployment.mjs:2041`) must install an append restrictor whose policy is the write
law above: `shared` resolves for every principal; `worker:<scope>` resolves only for
`principalId === scope` (the member's own partition); a `local-owner` / `service-*` (review
authority) write to `worker:<scope>` is REFUSED unless `principalId === scope` — the review
authority's write posture is shared-only (law 3). This is a STRICTER restrictor than
`restrictingReadAuthorize` (which lets the review authority read any member scope): the strictness
is the trust-doctrine divergence, and it is the seam closure the acceptance pins assert (A4/A5).

---

## D2 — the verb and its admission on the three surfaces

### D2.1 — the verb shape

- **Canonical operation name:** `run.scratchpad.append`.
- **Arg closure (closed, no extra fields):** `{ runId, scope, kind?, body, idempotencyKey? }`.
  - `runId` — the run whose scratchpad receives the entry (required, `validId`).
  - `scope` — `shared` or `worker:<id>` (required, the `SCRATCHPAD_SCOPE` grammar,
    `coordination-store.mjs:533`). Which scopes a given principal may target is D1 law.
  - `kind` — one of `SCRATCHPAD_KINDS` (`['note','plan','doubt','link']`,
    `coordination-store.mjs:535`). Defaults to `note`.
  - `body` — the entry content. For `note`: a string (the note text). For `plan`/`doubt`/`link`:
    a JSON value matching the kernel's closed per-kind shape
    (`normalizeScratchpadEntry`, `coordination-store.mjs:607-696`: `plan` = `{objective, steps,
    supersedes?}`; `doubt` = `{question, context?}`; `link` = `{label, relation, target}`).
  - `idempotencyKey` — optional at the facade; when present it must match
    `SCRATCHPAD_IDEMPOTENCY_KEY` (`^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$`, `coordination-store.mjs:534`)
    and drives the kernel's `_byKey` replay. When absent, the surface derives a server-side key
    (see D3 — replay).
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
  grammar (same check as the read branch at `:1483`); `--body` required; `--kind` optional
  (default `note`) and validated against `SCRATCHPAD_KINDS`; `noRemainder(args)` (the closed-set
  discipline the read/elevate branches already use).
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
- **Registration:** add `baton_run_scratchpad_append` to `ORDINARY_EXPLICIT_TOOLS`
  (`:822-829`) so it is admitted (not just defined) at the MCP surface. (The read/elevate tools
  are already in that set — the append joins the same admission list.)

### D2.4 — web bus admission (the direct-port pattern)

- `run.scratchpad.append` is NOT in `APPLICATION_COMMAND_DEFINITIONS` (G10), and that table's
  byte-stability is pinned by grammar-m3-red — so the web bus admits the verb via the **direct-port
  pattern** exactly as the wave verbs are admitted (`WAVE_WEB_ENTRIES`, `web-northbound.mjs:37-47`):
  a `run_scratchpad_append` entry carrying its own closed field set joins `COMMAND_CAPABILITY`
  (`:87-94`), `ARG_FIELDS`/`ACCEPTED_ARG_FIELDS` (`:112-148`), and `APPLICATION_COMMAND`
  (`:149-151`). `validateEnvelope`'s `unsupported command` refusal (`:405`) then admits the verb,
  and `_dispatch` routes it through `this.application.command('run.scratchpad.append', …)`
  (`:1026,1035`).
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
  question OQ3 names the follow-on.

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
  law (a member cannot write another member's partition, so cross-member spam is structurally
  impossible). A member cannot fill `shared` beyond 512 entries, and can never touch a sibling's
  partition.
- **Durable event + replay.** A successful append lands a `scratchpad.entry_written` event
  (the kernel's existing event, `coordination-store.mjs:14148`) with the full receipt
  (`{ok, result, entryId, entryDigest, scope, scratchpadFence, eventSeq}`). Replay is the
  kernel's existing `_byKey` idempotency (`:14086-14102`): an exact retry under the same
  idempotency key returns the prior receipt (`result: 'idempotent'`); a retry whose binding
  changed (different runId/taskId/workerId/contentDigest under the same key) refuses
  `scratchpad_write_conflict`. The surface append carries the idempotency key through to the
  kernel auth (`auth.key`), so the surface replay IS the kernel replay — no second layer.
- **Elevate interaction.** A written entry is elevatable per the existing machinery: an entry
  appended to a member's `worker:<ownId>` partition joins that partition and is eligible for
  `run.scratchpad.elevate` (`application.mjs:13131-13151` → `elevateTaskScratchpad`,
  `coordination-store.mjs:14173+`) exactly as a #33 up-channel note is today, and
  `elevateWhenNotes` (`workflow-interpreter.mjs:248-258` validation, `tryElevate` `:877-908`)
  reads the worker partition and elevates to `shared` once per (runId, role). An entry appended
  DIRECTLY to `shared` is already in the shared tier — it needs no elevation, and it NEVER mints a
  KG candidate (D1 law 4, G8). The `scratchpad.write` up-channel event does not fire for a surface
  append (the surface completes the lane server-side; the up-channel is the worker-emulated path
  the surface supersedes for CLI/MCP/web callers).

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

The D4 refusal is the CLI half of "the surface teaches what it refuses" (`control-surface-audit.md`
§2 #7): a refusal that names the admitted set is coaching; a refusal that leaks `undefined` is a
defect. This contract pins the coaching form.

---

## Refusal vocabulary

Reused codes (all landed; the append verb surfaces them verbatim, never re-spells them):

| Code | Source | Context |
|---|---|---|
| `application_unauthorized` | `application.mjs:3222` | D1 cross-partition / review-authority write to a member partition refused at the `_authorize` seam. |
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
`application_unauthorized` (`contract-fold.md:419`).

---

## Red-first acceptance pins

RED = fails at HEAD (`72a0c0f`); GREEN = passes after this contract's rung lands. Each pin
asserts behavior, not implementation.

| Pin | Assertion | At HEAD |
|---|---|---|
| A1 | CLI append: `baton run scratchpad append RUN_ID --scope shared --kind note --body TEXT` writes an entry and returns the receipt `{ok:true, result:'written', entryId, entryDigest, scope:'shared', scratchpadFence, eventSeq}`. | **RED** — no append branch; `unexpected argument append`. |
| A2 | MCP append: `baton_run_scratchpad_append` is advertised (capabilities `['control','observe']`), validated, and admitted (in `ORDINARY_EXPLICIT_TOOLS`); a valid call writes to `shared`. | **RED** — no tool, no capability, no validator, not admitted. |
| A3 | Web append: `run_scratchpad_append` is admitted on the web bus via the direct-port pattern (COMMAND_CAPABILITY + ARG_FIELDS + APPLICATION_COMMAND); a valid envelope is dispatched, not refused `unsupported command`. | **RED** — `validateEnvelope` refuses `unsupported command` (`web-northbound.mjs:405`). |
| A4 | D1 cross-partition: a member appending to `worker:<other>` (a sibling partition) refuses `application_unauthorized` at the `_authorize` seam, and no entry is minted. | **RED** — no append verb exists at all (trivially RED); the law is unenforced because unwritten. |
| A5 | D1 review-authority posture: `local-owner`/`service-*` appends to `shared` resolve; appends to a member `worker:<scope>` (where `principalId !== scope`) refuse `application_unauthorized`; the deployment seam installs the append restrictor (the permissive literal absent for the append verb). | **RED** — no append restrictor at `application-deployment.mjs:2041`. |
| A6 | D1 shared-write is ephemeral: a direct `shared` append never mints a scratch-fact / KG candidate; the entry is elevatable only via the existing elevation machinery, and a `shared` entry needs no elevation. | **RED** — no direct shared write exists. |
| A7 | D3 bounds: a body over `scratchpad.entry.body` (8192 B for a steering-registered run) refuses `scratchpad_entry_exceeded`; the 513th shared entry refuses `scratchpad_partition_exhausted`; the 129th worker entry refuses `scratchpad_partition_exhausted`. | **RED** — no append surface exists to test the bound through (the kernel bounds exist and are G7-verified, but no surface exposes them). |
| A8 | D3 replay: an exact append retry under the same idempotency key returns `result:'idempotent'` with the prior receipt; a retry whose binding changed refuses `scratchpad_write_conflict`. | **RED** — no append surface. |
| A9 | D4 refusal: bare `baton run scratchpad` refuses with the closed-set teaching `run scratchpad requires a subcommand: read|elevate|append` — never `unexpected argument undefined`; an unknown subverb names the unknown and restates the set. | **RED** — `unexpected argument undefined` (`application-cli.mjs:1511`). |
| A10 | Admission coherence (the #153 three-way): the append verb is (a) in the CLI parser, (b) in `CLI_WEB_COMMANDS` + the web direct-port admission, and (c) in the semantic-registry row + docs; there is no surface where the verb is advertised-but-dead (no #157 ghost). | **RED** — absent everywhere (trivially coherent because absent; the pin asserts the ADMITTED state is coherent). |

---

## Open questions

- **OQ1 — `run.scratchpad.read`/`elevate` web admission.** This rung completes the WRITE half of
  the parity table only (`control-surface-audit.md:85`); the web bus still refuses
  `run_scratchpad_read`/`run_scratchpad_elevate`. Should a follow-on rung admit the read/elevate
  verbs on the web bus via the same direct-port pattern (completing the web row of the facade
  ports), or is web write-only a deliberate posture (the orchestrator operates the wave via
  MCP/CLI, not the web)? The #147 dogfood's failure was the WRITE half; the read half is served
  by CLI/MCP today.
- **OQ2 — idempotency-key derivation when the facade omits it.** The kernel requires an
  idempotency key (`SCRATCHPAD_IDEMPOTENCY_KEY`, `coordination-store.mjs:534`); the facade makes
  it optional. When absent, the surface must derive a deterministic server-side key — the
  contract names the shape (`run.scratchpad.append:<runId>:<scope>:<contentDigest>` is one
  candidate) but does not pin it. Derivation must make an exact retry replay under the SAME key
  (idempotent) and distinct content mint a DISTINCT entry (never a silent overwrite — the #33
  contentDigest discipline). Which derivation is canonical?
- **OQ3 — the `run.scratchpad` bare parent row.** The registry row `run.scratchpad` claims
  surfaces `['embedded','cli']` (`application-semantics.mjs:1338-1348`) but the CLI has no parent
  branch (G10, D4). Once D4's closed-set refusal lands, is the parent row's `cli` surface claim
  retained (as a help/grouping node the parser resolves to the closed set) or dropped from the
  row? The D4 refusal teaches `read|elevate|append`, so retaining the row as the grouping node is
  coherent; the registry row's `cli` claim becomes honest once the parser refuses with the closed
  set.
- **OQ4 — steering-registered `noteMaxBytes` and the surface.** The kernel applies
  `noteMaxBytes = FRAME_LIMITS['scratchpad.entry.body'].value` (8192) only for steering-registered
  runs (`coordination-store.mjs:14070-14077`); a non-steering note is capped at 2048
  (`:623-626`). A surface `append` to a non-steering run's partition will therefore refuse at the
  kernel for notes over 2048 even though the #89 row's headline value is 8192. Is the surface
  refusal verbatim (`scratchpad_entry_exceeded`) sufficient coaching, or should the surface
  distinguish "over the steering-registered cap" from "over the row cap"? This contract keeps the
  kernel's single refusal; a doc note naming the 2048/8192 split is the suggested resolution.

---

## Cross-references

- **`worker-orchestrated-swarm-2026-08-13/contract-fold.md`** §D1.2 (`:139-168`) — the landed
  read law this write law mirrors; §D1 (fabricated-results seam, the trust-doctrine justification
  for law 3); §D1.3 (truthful steering trail — the elevation lane the write feeds).
- **`tight-cell-2026-08-06/tight-cell-contract.md`** D-depth-2 (`:815-822`) — the direct
  shared-tier write with the cell's nonce; the mechanism the surface verb completes.
- **`facade-projection-contract.md`** (`:217,636`) — the scratchpad scope grammar and the
  "unknown ≡ foreign at the policy seam" default D1 law 2 implements for writes.
- **`control-surface-audit-2026-08-13/control-surface-audit.md`** §0 (asymmetric handoff), §1.3
  (`:85` parity row), §2 #10 (`:191-197` — the write-verb finding this contract answers),
  §1.4.1 (`webBusNames()` undercounts the web bus — the direct-port admission must be taught to
  the conformance inventory, else the web append reads as un-inventoried).
- **`control-surface-audit-2026-08-13/surface-audit-cli.md`** §6 F-9 (`:351-360`) and §3 E-11/
  E-14 (`:167,170`) — the D4 trap's live evidence and the `run scratchpad append` fix sketch.
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
  (`limits.mjs:71`; `coordination-store.mjs:492-493,524-525`). No new cap is declared.
- **No redesign of landed SOUND law.** D1.2 is law (`contract-fold.md:139-168`) — cited, not
  re-litigated. The write law is its sibling, with the ONE documented divergence (law 3, the
  review authority's shared-only write posture) justified against the trust doctrine.
- **Ring-2 form.** This contract specifies behavior; it does not amend implementation. Every
  `file:line` citation was verified at HEAD this session.
- **Deliverable boundary.** The sole deliverable is
  `docs/reference/evidence/scratchpad-write-2026-08-13/scratchpad-write-contract.md`; work was
  confined to `docs/reference/evidence/scratchpad-write-2026-08-13/**`. No source files were
  modified.
