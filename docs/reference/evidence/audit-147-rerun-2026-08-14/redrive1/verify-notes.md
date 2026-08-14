AUDIT_147-VERIFY v1
[attempt: 661c2f42-e327-42c1-b178-72c5cdad2ee8 coordinator]

## VERDICT: sound

The row's re-run deliverable (`redrive1/audit-147-rerun.md`) is sound: every claim I
spot-audited verified against current master, `surface-conformance` runs green (exit 0),
and the attempt-echo requirement is met (every claim carries a quoted command+output or a
`file:line` anchor, re-verified this run). One authority-class ambiguity blocks the wave-b
harvest gate for the row's *notes* (path mismatch — notes at base, directive expects
`redrive1/notes-row-audit-147.md`); it is raised as DECISION_REQUEST DR-1 below. It is a
placement decision, not a content defect — the row's findings stand and need no re-run.

## Evidence

### Row deliverable + notes located
- Deliverable: `docs/reference/evidence/audit-147-rerun-2026-08-14/redrive1/audit-147-rerun.md`
  (25,417 bytes) — attempt marker `[attempt: audit147-rerun-redrive1-20260814 row-audit-147]`
  on line 3.
- Notes: `docs/reference/evidence/audit-147-rerun-2026-08-14/notes-row-audit-147.md` (2,232
  bytes) — attempt marker on line 3; row's deliberate placement (row settled message: "`redrive1/`
  was my choice — discoverable via the notes file").
- Row settled: transcript `.../w-556/config/deepseek/projects/.../3d77b1eb-...jsonl` grew
  584 → 724 lines on nudge; final turn: "Both deliverables are complete and verified. The work
  is done. ## Final state — row-audit-147 settled".

### Acceptance: run what it names
- `node impl/scripts/surface-conformance.mjs` → `surface-conformance: ok`, exit 0 (fresh run this
  session; the row's transcript shows 4× `surface-conformance: ok` + `EXIT: 0`).
- No code edits by the row: row worktree `git status` shows only the two partition paths, untracked.

### Spot-audits — five claims, all confirmed
1. **F-1 typo refusal — CLOSED.** `node impl/scripts/baton.mjs run shwo` →
   `cli_command_unavailable: unknown run verb shwo; expected adopt, answer, approve, ...`,
   exit 2. `cliRunVerbTypoRefusal()` at `application-cli.mjs:1123`, message at `:1129`.
2. **F-2 `run.watch` — STILL BITES.** Taught at `CLI.md:51`
   (`| run.watch | ordinary | baton run watch | baton run watch RUN_ID |`); `watch` is NOT in
   `lifecycleActions` (`application-cli.mjs:1673-1676`) so it falls through `parseStart` at
   `:1685`. Live: `baton run watch abc123` → `cli_invalid: unexpected argument abc123` (exit 2);
   bare `baton run watch` → `cli_config_invalid: user connection profile is unavailable` (exit 2) —
   parsed as a NEW run whose objective is the literal `watch`.
3. **F-3 `waves.send`/`waves.stop` — CLOSED.** Parse branches `application-cli.mjs:1459`
   (`waves.send`) and `:1477` (`waves.stop`). Live: `baton waves send WAV-123 --message T` and
   `baton waves stop WAV-123 --reason T` both reach the connection phase
   (`cli_config_invalid: user connection profile is unavailable`) — no parse refusal.
4. **N-2 conformance undercount — CONFIRMED.** `impl/scripts/surface-inventory-artifact.json`
   `counts.webBusCommands = 31`; the `web.bus` profile (artifact lines 209-241) lacks
   `waves.compile` and `run.scratchpad.append`, which the northbound direct ports expose
   (`web-northbound.mjs:47`, `:53`). `surface-conformance: ok` stays green — the undercount is
   invisible to the gate.
5. **N-5 glm-5.3 doc-truth — CONFIRMED.** `application-deployment.mjs:865`
   `const allowedModels = new Set(['glm-5.2', 'glm-5.3']);`, ceiling 4 (`:876`
   `model: 'glm-5.2', approvals: false, ceiling: 4`); `CLI.md:171` fleet table lists only
   `glm-5.2`.

### Row's deliverable content (summary)
Delta tables F-1..F-10 (CLI), F1..F9 (MCP), F1..F9 (Web) + the §2 unified-friction map; 7 NEW
findings (N-1..N-7); prioritized list; 3 DECISION_REQUESTs (DR-1 `run.watch`, DR-2 scratchpad,
DR-3 MCP profile). Every claim sampled carried a quoted command+output or a `file:line` anchor;
the row made no `gh` claims (grounded in the repo only).

## Unverified / why
- **F-6 connection-refusal diagnostics, live-server half.** No live resident in this wave, so
  mid-flight connection failures were not re-probed; the code-surface half (typed code + human
  message) was verified. The row classified F-6 PARTIAL and said so — consistent.
- **MCP profile counts (37 vs 88)** were verified against the committed artifact
  (`mcpApplicationTools: 37`, `mcpCombinedTools: 88`), not by importing the northbound modules
  live; artifact and the row's quoted names agree.

## DECISION_REQUEST — authority-class ambiguity

**DR-1 (harvest-path authority).** Wave-b directive:
`harvest "docs/reference/evidence/audit-147-rerun-2026-08-14/redrive1/notes-row-audit-147.md"
mustContain "attempt:"`. The row's notes sit at the BASE path
`docs/reference/evidence/audit-147-rerun-2026-08-14/notes-row-audit-147.md` — the row's deliberate
choice (matches the wave-a report path; the row brief names no notes path and the partition is the
whole `audit-147-rerun-2026-08-14/**` tree). `redrive1/notes-row-audit-147.md` does not exist and
the row's work is uncommitted (no snapshot pin carries it yet). At wave close the orchestrator's
snapshot will capture `redrive1/audit-147-rerun.md` and the base notes, but the directive's path
resolves to `harvest_miss` (D4 absent-path). Options:
- **(a)** Re-point the harvest directive to the base notes path (operator edits the wavefile) —
  accepts the row's placement.
- **(b)** Copy the row's notes verbatim to `redrive1/notes-row-audit-147.md` (mechanical
  relocation, no content change) — satisfies the directive as written.
- **(c)** Treat `redrive1/audit-147-rerun.md` (which carries the row's attempt marker) as the
  row's authoritative report and retire the notes gate.

Recommendation: (b) is the lowest-risk fix if the directive must stand; (a) if the wavefile is
still open for edit. Neither requires re-running the row.

**Row's own DR-1/DR-2/DR-3** (`run.watch` silent-compilation vs the #160 R6 contract; scratchpad
append MOVED vs STILL BITES; MCP profile non-superset tracked-red vs STILL BITES) are endorsed as
correctly framed authority-class questions; my spot-audits support the row's evidence on each.

## Laws
Cited evidence only; every command quoted above was run this session. No clocks, no fabrication.
Read-and-run only outside this deliverable (all CLI probes are parse/connect-phase refusals with
no side effects).
