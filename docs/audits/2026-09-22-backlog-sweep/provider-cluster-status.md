# Provider, route and model-catalog cluster: status at 2026-09-22 21:20 UTC

Lane: `provider-lead2` in `swarm-backlog-20260921`, under `backlog-lead3`. Base: the served commit
`1e050e42`. This file records what the cluster delivered, what it could not, and the environmental
blocker that stopped the rest. It is a status ledger, not a product document.

## Delivered commits (all on the served base; nothing integrated)

| Branch | Commit | What |
|---|---|---|
| `baton/ws-c148ff0358ea487d147edfbf3a8dc123` | `94cddf53` | Issue #167: the honest readiness tier. `test/readiness-honesty-red.test.mjs` 17/17 (was 8/17); the 9 `#167` rows leave `impl/scripts/expected-red-tests.json` and the file joins `converged`. `verdict`/`probedAt` ride every serializing transport; the four probe refusal codes gain `PROVIDER_TERMINAL_GUIDANCE` rows; a quota/capacity wire on a probe turn classifies `provider_quota` and is excluded from the automatic re-probe cadence; `baton doctor --check` forces one fresh probe per stale route; `#livenessGate` is consulted on all five spawn surfaces. |
| `baton/ws-c148ff0358ea487d147edfbf3a8dc123` | `5c01672c` | Issue #491 item 2: `quotaWindowPosture` derives what a route's provider-stated `resetAt` may be read as (`fixed_clock` = hard boundary, `rolling` = re-probe, unknown = today's reading) and every re-route candidate row carries the declared window shape beside the instant. Red-before row `491-item2`. |
| `baton/ws-c148ff0358ea487d147edfbf3a8dc123` | `09615dd3` | Regeneration of `impl/scripts/seam-inventory.json` for the new `_rerouteCandidates` size. |
| `baton/ws-4c29256a265592fe537fb8b0a9ff8021` | `91282c17` | Issue #146 (seat telemetry): 12 of 14 rows green; the 11 rows that went green leave the manifest (355 -> 344). A7 and A8 stay red (see below). |
| `baton/ws-f33a0f8387ee6c2e83ba9dce8904ddc7` | `6e103bd1` | Issue #148/#319: the blind-waits `A4` row is green and off the manifest; the wave-driver pump logs refused status reads and stops after three consecutive authority refusals; the issue5 seed wait is evidence-derived. |
| `baton/ws-30956be3dde4fabec85d25fef5b69cc4` | `bc5db3da` | Issue #281 item 6 (OMP half): `OmpRpcCli.kill()` reports the close latch's own observation instead of a bare `ok`. Items 1-5 verified already landed at `0032b3a4` and `c7f93c37`. |

## Contract-146 rows that cannot pass

`test/seat-telemetry-red.test.mjs` A7 and A8 fail on the base tree, not because of an implementation
gap:

- A7's slice `mcp.slice(indexOf('baton_deployment_doctor'), indexOf('baton_decision_answer'))` is
  zero bytes: in `impl/src/mcp-northbound.mjs` the doctor name occurs at offset 11686 and the
  decision name at 10879, so the slice is inverted. No file content can satisfy the three
  assertions over it. The waves slice is the 33-byte capability-table entry
  `baton_waves_list: ['observe'],`.
- A8's first assertion compares the doctor route row's enumerable key set against the DP5 set. The
  fixture's adapter card carries no `workerPolicy`, so the route is blocked
  `route_policy_unsupported` and the row legitimately gains `code`; the assertion fails at HEAD on a
  clean baseline. The `#146` parts of A8 pass.

Both rows need a contract fold on the fixture or the anchors. They stay pinned and red.

## The 21 assigned issues

| Issue | Disposition |
|---|---|
| #167 | Delivered (`94cddf53`). |
| #146 | Delivered in part (`91282c17`, 12/14); A7 and A8 are contract defects, reported above. |
| #148 | Delivered in part (`6e103bd1`): the driver auth-stop row is green. The credential-TTL half (write `sessionExpiresAt`/`sessionTtlMs` into the publication files, name the renewal action at the socket edge) is not started; it overlaps issue #559, which another seat holds. |
| #491 | Item 1 was landed earlier (`00c45a7e`); item 2 delivered (`5c01672c`). Items 3 and 4 (rendering the shape as prose on `route show` and the swarm view) are a rendering pass over the same rows. |
| #319 | Partly delivered: the issue5 seed wait is evidence-derived; the target row now fails at its own untouched assertion (worktree count 3 where 1 is expected after recovered startup). `grok-acp` A-E4 measures green here (1198-1481 ms against a 2000 ms bound). |
| #257 | Not reproducible in isolation on the current tree: `phase11-concurrent-grok-reap`, `worktree-capacity-contention` and `phase44-cairn-route-stats` pass; `phase56-drain-and-close` flaked once under load and passed on a rerun. No assertion was weakened. |
| #281 | Delivered: items 1-5 were already landed (`0032b3a4`, `c7f93c37`); item 6's OMP half is `bc5db3da`. |
| #199, #221 | In flight on a second seat at the time of writing (spawn grace; ceiling deferral visibility). |
| #72 | In flight on a second seat (13 of 17 rows red at the start; the largest remaining pinned set in this cluster). |
| #126 | In flight on a second seat (fleet_bakeoff as a recipe; spec at `docs/reference/evidence/dropped-features-2026-08-06/docs-deep-finds.md` section 2.4). |
| #218 | Covered by the #146 seats atom: the deferred count and its reason ride the wave capacity block. |
| #221's pre-cap removal | Blocked by a contract conflict: contract-146 A2/D1.2 pins the ceiling-skip and the deferred aggregate as a read, so removing the deferral mechanism before #146 converges makes its A2 row unreachable. The ceiling is a scheduler policy with a ledgered deferral today; the removal needs a decision. |
| #347 | Already landed under #441 lane A: `test/issue441a-recruit-issue-package.test.mjs` passes 7/7 and the root's CLI pulls an issue into a context package the brief renders. |
| #444 | Landed on the base (`7268bb08`). The live Design Arena check needs a key at `~/.config/baton/designarena_key`; that is an operator action. |
| #145 | Landed by adoption: the omp harness serves routes (`impl/src/omp-rpc.mjs`, the contract record at `docs/reference/evidence/omp-harness-contract-2026-08-14/`) and `omp/deepseek/deepseek-flash` is a live route. |
| #144 | Landed: `impl/src/lsp-pool.mjs`; `test/issue144-lsp-pool-red.test.mjs` passes 23/23 and the file is converged. |
| #80 | Landed: `test/tg3-window-red.test.mjs` passes 10/10 and is converged. |
| #2 | Landed in part: harness, model and effort are selection axes (`RECRUIT_ROUTE_AXES`) and the codex adapter declares and passes `serviceTier`, which the card publishes. A service tier is not an orchestrator-selectable axis on the recruit path today. |
| #3 | Not delivered: a live proof of the whole route matrix needs real provider turns for every harness, which this host cannot fund. The forced probe landed for #167 gives the bounded mechanism for a one-token proof per route. |
| #197 | Not delivered: the delegated-turn provider and the followup-routing decision table are design items; the source material is `docs/reference/evidence/dsh-comparison-2026-08-13/dsh-seams.md`. |
| #115 | Not delivered: a branded TUI surface is an ideation item with no acceptance row. |

## Blocker at the time of writing

The host volume is full: `/System/Volumes/Data` reports 558 MiB free at 100% capacity. The swarm
ledger refuses every write and every read with `operational_log_unavailable` (ENOSPC), so no
contribution, guide, stop or view can be recorded. Measurements: `/tmp/baton-resident-20260921/.baton`
is 8.6 GB with 185 worktrees under it; `/tmp/baton-*` is 14 GB in total, of which roughly 5.4 GB is
stale suite fixture directories outside the resident root (the largest single cluster is
`/tmp/baton-501`, 121 entries). Two finished seats (provider-146, provider-148) still hold their
worktrees. Clearing the stale fixtures and releasing finished seats is the reclaim path; nothing was
deleted by this lane, since the fixtures belong to other lanes and cleaning the host is outside this
seat's authority.

## Manifest merge hazard

Three delivered commits each edit `impl/scripts/expected-red-tests.json` from the same 355-row base:
`94cddf53` drops 9 rows, `91282c17` drops 11, `6e103bd1` drops 1. Integration must merge the
removals; taking one side would resurrect rows whose files are green and the acceptance run would
then count them stale.
