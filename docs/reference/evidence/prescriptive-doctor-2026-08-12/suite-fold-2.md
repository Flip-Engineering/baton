# #72 SUITE — fold-2 (blue-team) finding→resolution map

**Suite:** `impl/test/prescriptive-doctor-red.test.mjs`
**Blue-team report:** `suite-blueteam.md` — **NEEDS-FOLD**
**Binding contract:** `prescriptive-doctor-contract.md` (**v1.2** after this fold — the only contract
movement is Finding 1's surface-attribution correction; §4.1/§4.2/§4.3/§4.4/§6 are otherwise
unchanged).
**Draft notes:** `suite-draft-notes.md` (updated to the fold-2 inventory).

## Verified split (two consecutive runs from the repo root)

| run | tests | pass | fail | note |
|-----|-------|------|------|------|
| 1 | 17 | **4** | **13** | 4 guard pins green (PT-2p, PT-4p, PT-8p, **PT-L**); 13 PT rows red at the stage guard |
| 2 | 17 | **4** | **13** | identical — **STABLE** |

The fold adds one green pin (**PT-L**, the fixture-lint self-test, finding 9) and hardens the 13 red
rows per findings 1–8 and 10. All 13 red rows still fail at the stage guard
(`resolvePrescriptiveDoctorHome()` → `{ surface: null }`); every fold-2 red-keeping assertion was
**verified RED against the current tree** where it fires post-stage-guard (the `setupBatonConnection`
anti-misdirection returns `create_profile` today, application-cli.mjs:458-466).

## Finding → resolution

| # | Finding (blue-team) | Resolution |
|---|---------------------|------------|
| 1 | PT-10's #137 half is vacuous: malformed fixture + wrong surface | PT-10 rewritten: **valid** schema-v2 selector + matching resident profile + ABSENT socket → `inspectBatonConnection` reaches the resident-mid-startup branch (diagnosis asserted: `stale`/`stale_authority`/`baton serve`); anti-misdirection **retargeted to `setupBatonConnection`** (the surface that actually emits `create_profile`), verified RED today. Contract §4.1 W6/§4.2 corrected to `setupBatonConnection` (**v1.2**). |
| 2 | PT-3 is a shape test, not a surface test (web/CLI/MCP parity unpinned) | PT-3 rewritten as a **real-surface parity row**: real `openBaton` deployment → `doctor()` sibling non-enumerable + byte-stable `JSON.stringify`/`Object.keys`, served web card (`deployment.card()`) carries exactly ONE named `warnings` field with identical rows, CLI (`BatonWebClient.doctor`) and MCP source pins for the same named additive, sanitize-at-source canary. |
| 3 | PT-11 can't discriminate a max accessor from a last-element read | PT-11 fixtures reordered: highest eventSeq NOT last (fired `[{failed auth e9},{completed e1}]`), highest in the MIDDLE of a three-observation fired array, quiet when a lower row failed auth; `buildDegradedReads` W7 observations likewise reordered. |
| 4 | PT-4 accepts any `git <verb>` as a valid action link | `invalidNextCommand` tightened: only `git update-ref -d refs/baton/(results\|checkpoints)/…` (the W5 doc anchor, B7) is accepted in the git namespace; an unknown `git <verb>` is a ghost verb. Doc anchors restricted to the **evidence-tree issue set** (`#\d+` ∈ the closed anchor set) or a repo-relative `.md` path — a fabricated `#NNN` is rejected. |
| 5 | PT-5 doesn't pin the W1 live-owner discriminator | PT-5 adds `plantOwnerReceipt` (a **fully valid** 15-field receipt, digest closes) for a live owner (real pid + `/bin/ps` pidStart) → quiet, and a dead owner → fires; the same dir is discriminated by owner liveness, never a clock/grace window. |
| 6 | PT-3's byte-stable half is self-referential | PT-3 now asserts the behavior on the REAL `doctorReadiness()` output (not a suite-built object) and tightens the source pin to a comment-stripped `Object.defineProperty(…'warnings'…enumerable:false)` over the resolved home **and** `application-deployment.mjs`. |
| 7 | The local `--depth` subset render is unpinned | PT-3 drives the local `--depth` outline against a degraded deployment and asserts every rendered code ∈ {W1,W2,W4,W5,W6} — never `warning_credential_ttl`/`warning_route_last_auth_failure`. |
| 8 | W1's reserved-fraction branch and W5's checkpoints namespace are untested | PT-5 plants a **real reservation ledger** (worktree-capacity authority; 7GiB ≥ 0.8×8GiB with ghostCount === 0) → W1 fires via the reserved-fraction disjunct. PT-9 adds a **checkpoints-only** fixture (257 × `refs/baton/checkpoints/pin-N`) → W5 fires. |
| 9 | The stage guard masks fixture correctness | New green **PT-L fixture-lint** pin (stage-independent): proves `buildDegradedReads()` returns a valid schema-v2 selector, the W7 observations are order-discriminating, `writeStaleLease` writes the real schema, the PT-10 resident fixture reaches the `stale` window, and `plantOwnerReceipt` closes. |
| 10 | PT-3's source pin hardcodes `application-deployment.mjs` against the resolver's dedicated-home preference | PT-3's `defineProperty` pin now scans the resolved home's source AND `application-deployment.mjs` (comment-stripped), matching the suite's documented home-following convention. |

## The fold-2 red-keeping assertions (each verified red-today where it runs post-stage)

- **W6 valid-selector + resident-starting diagnosis (F1b):** `inspectBatonConnection` on the planted
  fixture returns `stale`/`stale_authority`/`baton serve` today — the fixture genuinely exercises the
  W6 window (PT-L lints this), and the row is red at the stage guard.
- **`setupBatonConnection` anti-misdirection (F1c):** with a resident selector present and an EMPTY
  config root, `setupBatonConnection` returns `profiles: missing → create_profile` today
  (application-cli.mjs:458-466). The row asserts `create_profile` is absent and that the render
  reports the resident-starting state — **both fail today**, so a wrong implementation that only lands
  `detectResidentNotPublished` cannot green PT-10.
- **W1 live-owner discriminator (F5):** `plantOwnerReceipt` with `process.pid` + the real
  `/bin/ps -o lstart=` is a live owner → W1 must stay quiet; the same dir with a dead owner
  (`pid: 4194305`) must fire. An implementation that omits the discriminator fires on the live case →
  fails.
- **W1 reserved-fraction disjunct (F8a):** a real `WorktreeCapacityAuthority.reserve` of 7GiB against
  `maxReservedBytes = 8GiB` crosses `0.8 × 8GiB` with zero ghosts → W1 must fire. An implementation
  that only counts residue is quiet → fails. The policy passed to the detection carries the sealed
  `runtimeReserveBytes/Inodes` so an authority-based read's policy digest matches (PT-L lints the
  ledger is real).
- **W5 checkpoints namespace (F8b):** 257 × `refs/baton/checkpoints/pin-N` alone crosses the ceiling →
  W5 must fire. An implementation that counts only `refs/baton/results` is quiet → fails.
- **W7 max accessor (F3):** the fired fixture has the highest eventSeq NOT last; a three-observation
  fired fixture has it in the MIDDLE; the quiet discriminator has a failed-auth row below a completed
  max. A last-element read returns the wrong answer on each → fails.

## Contract movement (v1.1 → v1.2)

One correction, required by Finding 1: the #137 misdirection surface is `setupBatonConnection`
(application-cli.mjs:458-466, the `create_profile` step at :464) — NOT `inspectBatonConnection`
(application-cli.mjs:489-638, which never emits `create_profile` in any branch). The contract's §4.1
W6 / §4.2 / §6 PT-10 attribution is corrected to name `setupBatonConnection`; the PT-10 row and the
contract now name the same surface. No other contract text changes.

## What held (not folded — verified sound by the blue-team)

The stage-guard skeleton (13 red rows each name their stage), the three original guard pins
(PT-2p/PT-4p/PT-8p), the hermeticity/no-clock/NUL-discipline/ordering-law suite law, and the
closed-schema `{ cause, code, next, severity, summary }` row shape all stand. The fold only
**hardens fixtures and surfaces**; it does not weaken any red-keeping assertion.

## Non-arbitrary numeric defaults touched by the fold

The reserved-fraction fixture's `runtimeReserveBytes = 64MiB` / `runtimeReserveInodes = 10_000` are
the worktree-capacity policy's runtime-reserve fields (worktree-capacity.mjs POLICY_FIELDS), passed
through the W1 `policy` so the ledger's policy digest matches an authority-based read. The W1
fraction threshold itself is unchanged: `ghostReservedFraction = 0.8 × maxReservedBytes = 8GiB`.
