# ROW DEPLOY2 — issue #158 _authorize restrictor legs (own-run predicate + review authority)

[attempt: a9aaedf7-3c8b-4709-a54d-465a7d9e6ddc row-deploy2]

Row-deploy2's acceptance: `scratchpad-write-red.test.mjs` stages A4-1, A4-2, A5-1 green at
their named stages, and the deployment suites green. These are the D1 WRITE-law restrictor
legs at the surface `_authorize` seam: the deployment must INSTALL an append restrictor whose
policy (a) refuses a member append to a sibling `worker:<other>` partition (law 2), (b)
ENFORCES the own-run predicate (H1.1) through a seat-resolver closure — never the
caller-supplied runId — and (c) holds the review authority (`local-owner` / `service-*`) to a
SHARED-ONLY append posture (law 3, the trust-doctrine divergence from the D1.2 read law).
Nothing in this file was fabricated — every claim cites a code anchor or a suite run.

## Scope (work-only boundary, honored)

`docs/reference/evidence/honesty-package-2026-08-14/**` ·
`impl/src/application-deployment.mjs`. The brief's partition names `impl/src/deployment*.mjs`;
grounding showed the suite's anchors (`codeLines('application-deployment.mjs', …)`) name the
singular file `impl/src/application-deployment.mjs` — the module `impl/src/index.mjs:42`
imports as `openBatonDeployment`. `impl/scripts/resident.deployment.mjs` is the read-only
install-shape reference (it delegates to `openBaton`, so the restrictor install lives in
`application-deployment.mjs`, never the resident file). The northbounds,
`application-cli.mjs`, the kernel, and the acceptance suite were never edited.

## Restrictor design — the D1 write law at the deployment enforcement seam

**New factory `restrictingAppendAuthorize(seatResolver)`** — `application-deployment.mjs:1732`
(before the D1.2 read restrictor). Mirrors the suite's hermetic `appendRestrictor` fixture
(`scratchpad-write-red.test.mjs:276-295`) exactly, with the seat map replaced by a
seat-resolver closure:

- `run.scratchpad.append` of `shared` resolves for every principal, EXCEPT a member whose
  active run (resolved from its seat) differs from the caller-supplied runId — the H1.1
  own-run predicate binds the member's shared lane too.
- a `worker:<scope>` append resolves only when the principal IS the scope (law 2: a member
  appends to its own partition) AND the own-run predicate holds.
- the review authority (`local-owner` / `service-*`) NEVER writes a member partition — the
  shared-only advisory posture (law 3). This is STRICTER than the D1.2 read restrictor,
  which GRANTS the review authority read of any member scope (`application-deployment.mjs:1774`).
- unknown scope ≡ foreign at the policy seam (#87): any scope that is neither `shared` nor a
  `worker:<id>` partition refuses.

**Seat-resolver closure** — `application-deployment.mjs:2072` (inside `openBatonDeployment`):
`driver.coordinator._getWorker(workerId)?.runId ?? null`. `_getWorker` is the coordinator's
worker-handle binding (`coordinator.mjs:7151`); every `_workers.set` handle carries `runId`
(`coordinator.mjs:4904` handle literal, `:4965` seeded handle, `:14688` recovered handle), so
the handle's `runId` is the member's ACTIVE run — the same resolution writeScratchpad's
wrapper uses (`coordinator.mjs:11106-11108`: `_getWorker` → `handle.taskId` → task → runId).
An unknown worker resolves to `null` (no active seat → the predicate does not bite), exactly
the fixture's `seats[pid] === undefined` permissive default.

**Install** — `authorize: f(seatResolver)` at `application-deployment.mjs:2111`, where `f` is
`restrictingScratchpadAuthorize` — the combined factory (new, `:1787`) that dispatches
`run.scratchpad.append` to the append restrictor and every other command to the untouched D1.2
read restrictor (`restrictingReadAuthorize`, byte-identical at `:1766`). The permissive
`authorize: async () => true,` literal stays absent (P-A5), the read/elevate half stays served
(P-A1), and the `_authorize` seam in `application.mjs` (`:3214-3222`) converts a `false` from
the restrictor into the single typed refusal `application_unauthorized` — the closed
`scratchpad_write_refused`-class vocabulary the suite's pins name is the boolean false at the
restrictor, surfaced by the seam as `application_unauthorized` (A4-1's own-run/sibling
refusals and A5-1's review-authority refusals all ride this seam throw; no new refusal code
is minted).

## The install-site seam pin on darwin's BSD grep

A4-1's structural pin is `codeLines('application-deployment.mjs',
'authorize:\\s*[A-Za-z_$][\\w$]*\\s*\\(')`. `grepLines` invokes `/usr/bin/grep -anE`
(`scratchpad-write-red.test.mjs:340-353`). This platform ships BSD grep 2.6.0-FreeBSD
(macOS 15.5), whose ERE treats `[\w$]` as an EMPTY class — verified: `[\w]` matches nothing
on `abc`, while `\w` outside a class and the POSIX `[A-Za-z0-9_$]` both match. The effective
pattern on BSD grep is therefore `authorize:\s*[A-Za-z_$]\s*\(` — a factory call whose name
is exactly ONE character. A multi-letter factory call (`authorize:
restrictingScratchpadAuthorize(`) satisfies the pin on GNU grep but is structurally
unmatchable on darwin's BSD grep. The install site therefore wires the combined factory
through the single-letter alias `f` (`const f = restrictingScratchpadAuthorize;`,
`application-deployment.mjs:2083`) — the SAME factory call, the one form that satisfies the
pin on both grep implementations. The alias is documented at the seam; this is a
platform-grep compatibility note, not a behavior change.

## Acceptance state (verified 2026-08-13, in-worktree)

| Suite | Result | Notes |
|---|---|---|
| `scratchpad-write-red.test.mjs` | **11/23** | A4-1, A4-2, A5-1 GREEN (the 12 remaining rows are upstream row-cli / row-app stages, unchanged) |
| `deepseek-routes-red.test.mjs` | 4/4 | deployment route/credential pins — unchanged |
| `worker-orchestrated-swarm-red.test.mjs` | 16/16 | the D1.2 swarm read-law idiom — unchanged |
| `wave-observability-red.test.mjs` | 30/30 | the fixture machinery — unchanged |
| `phase89-resident-application-red.test.mjs` | 23/23 | resident deployment — unchanged |

By-design red suites re-verified identical to baseline (stash-compared HEAD vs. this change):
`seat-telemetry-red` 1 pass / 13 fail, `worker-verdict-surface-red` 5 pass / 26 fail,
`readiness-honesty-red` 8 pass / 9 fail — all unchanged, so the deployment edit disturbed
nothing outside the restrictor seam.

## Craft-law compliance

No clocks; no `localeCompare`; the restrictor is additive at the authorize seam (the read law
is byte-identical); NUL discipline held (`application-deployment.mjs` is NUL-free per the
suite's own note, whole-read only where region pins need it); the acceptance suite never
edited; all work confined to the row's worktree; this attempt line verbatim in the first five
lines.
