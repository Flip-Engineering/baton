# 24 — /goal: whole-system completion (phase 10)

*The user's directive (2026-07-10): "we are looking at a whole of system and subsystem completion
as our next big-aim… synthesize all of that including methodology and experience in this codebase
and design process thus far into a /goal proposal and then pursue that goal." This document is
that proposal — a pinned objective in the spirit of the goal surfaces the harnesses themselves
grew this year (codex `thread/goal/set`, grok's `/goal` runtime command): objective, definition
of done, and the standing constraints that govern pursuit.*

## The goal, pinned

> **Every subsystem baton has built is wired, gated, and live-proven — no built-not-wired gaps —
> culminating in a coordinator-driven fleet of real vendor session workers (Claude, Codex, Grok;
> GLM credentials permitting) that can be spawned, steered mid-turn, interrupted, approved, and
> trust-gated end-to-end through `createDriver()`.**

"Completion" here is a **wiring property, not a feature count**. The completeness audit
(docs/22) found the deterministic trust spine real and well-tested, and every overclaim living in
the seams: modules built and unit-green but never plumbed into the shipped path (`accept()`
hardening, vendor attribution), or capabilities proven per-adapter but unreachable through the
driver (session adapters not constructible via `createDriver()` — docs/23 re-steer item 2). The
fleet driver IS the product (doc 19); a product whose steering exists only in adapter unit tests
is not complete.

### Definition of done (checkable, in order)

1. **Every docs/22 §6 audit gap is closed or explicitly retired with evidence** — verified
   against current code first (phase B below), because phases 8–9 already closed an unknown
   subset and re-fixing fixed things is waste.
2. **Assembly**: `createDriver()` constructs with the session adapters
   (`ClaudeSessionCli`/`CodexAppServerCli`/`GrokAcpCli`, + `GlmSessionCli` as the Claude-session
   subclass with Z.ai env), exported from `index.mjs`, routable (the `route()` collision fix was
   the prerequisite, already landed).
3. **Driver-level fake E2E** (zero quota): through `createDriver()` — spawn → stream → mid-task
   steer → interrupt → approve → trust-gate (fresh-worktree re-verification) against the fake
   binaries, per session vendor. This is the test that would have caught the built-not-wired
   pattern a phase earlier.
4. **Driver-level LIVE E2E capstone**: ≥3 real vendors (claude, codex, grok — all authenticated
   on this machine) driven by the coordinator simultaneously; at least one mid-task steer, one
   interrupt, every result trust-gated; evidence ledger committed under `docs/reference/evidence/`.
5. **Capability tags plumbed**: `card()` carries optional capability metadata —
   `nonRefuserFor: ['ml-ai-inference-training', 'cybersecurity']` on the GLM tier, the explicit
   classifier tag the fleet needs so domain-sensitive work routes deterministically to the
   capable-non-refuser vendor instead of by operator folklore — and `route()` can select on it.
6. **GLM session tier built to the credential boundary**: `GlmSessionCli` exists as the
   Claude-session subclass with Z.ai env wiring (the proven `ZCodeCli` pattern: base-URL +
   auth-token + model-map env, ceiling 1), fake-backed and conformance-tested. Its live smoke is
   gated on credential presence — checked by presence only, values never printed — and recorded
   PENDING-LIVE in the capstone ledger if absent.
7. **No dead surface**: full `node --test` green; every event kind the system emits is either
   consumed by the coordinator/story fold or deliberately, visibly forwarded — no kind that
   silently no-ops where a state transition is owed; no export that cannot be constructed; no
   constructor that cannot be routed.
8. **Record straight**: `impl/VALIDATION.md` rewritten (not appended) to describe the completed
   system; docs/01–02 matrix rows accurate; all live evidence JSONL committed under
   `docs/reference/evidence/`.

## Standing constraints (the rules of pursuit)

Carried forward from the project's operating history; they bound every phase below.

- **No quick wins.** "There is no such thing as a 'quick win' — that's called task avoidance."
  Every change runs the full loop: spec contract → red test → implementation → green → review.
- **Session-mode is the product posture.** One-shot adapters remain only as an explicitly labeled
  fire-and-forget tier; capability work lands on session adapters.
- **The live-smoke gate.** Every verb a card declares `native` must be proven against the real
  binary; live findings correct the fake, and the corrected fake re-locks the adapter.
  Corrections land as errata by contract ID — never silent rewrites.
- **Quota discipline.** Live CLI turns spend subscription quota: fakes for everything until the
  capstone; capstone prompts stay probe-sized.
- **No arbitrary numeric limits** as control mechanisms unless derived from a physical resource;
  a limit that must exist is configurable with its derivation documented.
- **Failing tests are resolved, never waved off** — fix, or file with a reproduction; never
  "pre-existing."
- **Credentials are checked by presence only.** Values are never printed, logged, or committed.

## Methodology, synthesized

Seven practices got this codebase to 372/372 green with three live-proven session adapters. Each
was earned by a specific incident; phase 10 runs on all seven.

1. **Reference dossier before adapter.** Every harness gets `docs/reference/<harness>.md` with
   every claim provenance-tagged `[live]`/`[help]`/`[doc]`/`[acp-spec]`. Earned by: codex
   app-server omits the `jsonrpc` member; grok includes it. Two ACP-shaped surfaces, two wire
   framings — only live capture tells them apart, and the dossier is where that knowledge lives.
2. **Numbered contracts, spec-first.** D1–D9 session shape, R-contracts (follow-up supersession),
   X-contracts (anti-wedge X3, keyed waits X4), GA1–GA20 per-adapter. Tests cite contract IDs;
   errata overturn contracts by ID. A claim that cannot be cited is a vibe, not a contract.
3. **Protocol doubles shaped by live evidence.** The fake binaries speak the wire verbatim from
   captures — down to grok's permission optionIds and `_meta` usage payloads. Fakes that drift
   from live make tests lie. The rule: after every live smoke, correct the fake to what live
   showed; the corrected fake then re-locks the adapter.
4. **The live-smoke gate.** Earned by GA20: the spec said "no wire usage telemetry"; the
   post-auth probe showed full `_meta` token accounting on every prompt response — overturned
   same-day (F1/F2, test-locked). Likewise grok's mid-turn prompts *queue* rather than splice: a
   doc-trusting implementation would have shipped a phantom steer; the live gate is why `steer`
   stays honestly `emulated` there.
5. **Adversarial completeness audits.** docs/22 audited claim-vs-code and named the recurring
   failure mode: **built-not-wired** — unit-green modules never plumbed into the shipped path.
   The lesson is structural: overclaims live in the seams, not the modules; so completion must be
   proven with driver-level E2E, not more module tests.
6. **Evidence ledger.** Raw JSONL of every live probe is committed under
   `docs/reference/evidence/<vendor>-<version>/`. Claims decay; captures don't.
7. **Verify before re-work.** Phases 8–9 closed an unknown subset of the audit findings. Phase B
   re-derived every believed gap against HEAD with file:line evidence before any spec was
   written — and found 5 of 12 already fixed (map below). Re-fixing fixed things is waste.

## Subsystem completion map — verified 2026-07-10

Phase B ran as a 12-agent read-only verification workflow (`phase10-gap-verify`, one agent per
believed gap, structured verdicts with file:line evidence). Verdicts against HEAD:

| Gap | Believed (docs/22 §6) | Verified | Phase-10 work |
|---|---|---|---|
| G1 assembly | session adapters unreachable via `createDriver()` | **OPEN — worse than believed.** Two incompatible `spawn()` contracts: the coordinator passes `{worktreeReady, timeoutMs}` (coordinator.mjs:223); all three session adapters expect synchronous `opts.worktree`. claude-session fails loudly; **codex/grok silently run in the orchestrator's own cwd**. Session classes also unexported from index.mjs. | SC1–SC3 |
| G2 accept-gate | `accept()` return discarded | **FIXED** — captured and branches the done-gate (coordinator.mjs:839/856; wired index.mjs:93–94). | retire |
| G3 vendor attribution | `captureCommit` lacks vendor | **FIXED** — C5 threads `handle.vendor` through capture to the `Baton-Vendor` trailer (coordinator.mjs:824 → worktree.mjs:180–184). | retire |
| G4 interrupt dependability | `_forceStop` only fires in `tick()` | **FIXED** — C4 real unref'd deadline timer armed in `_beginStop` (coordinator.mjs:466–469), tick sweep demoted to backup; test-locked. | retire |
| G5 fence ordering | deliver-then-recheck race | **OPEN** — a mid-flight fence bump still delivers, then logs `control.delivery_amended` (coordinator.mjs:370–386); the suite documents the race as known behavior. | SC4 |
| G6 router wiring | `pick()` never consulted | **FIXED** — real selection with null-means-queue and first-listed-wins collision rule (index.mjs:77–84); learn hook fed from the *verified* accept (coordinator.mjs:861). | retire |
| G7 story active | completed worker still "active" | **OPEN** — story.mjs never transitions on turn completion; only EXITED/CRASHED leave `working` (story.mjs:322/331/593). | SC5 |
| G8 baton exclude | `.baton` not git-excluded | **FIXED** — `ensureBatonExcluded` idempotent, called from `pinBaseSha` on the shipped path (worktree.mjs:92 → index.mjs:29); tested. | retire |
| G9 createDriver tests | entrypoint untested | **PARTIAL** — C7 tests exercise real `createDriver()` (phase8-correctness:633–701); `e2e.test.mjs` routeFn stub still drifts silently from the real `route()`. | SC9 |
| G10 one-shot posture | tier decision pending | **PARTIAL** — tier is honest and opt-in-only (no default registry), but one-shot cards expose 4 verb keys instead of the canonical 8; `kill` is native yet undeclared. | SC8 |
| G11 GLM session | `GlmSessionCli` absent | **OPEN** — no session GLM anywhere in impl; `nonRefuserFor` exists in no card; Z.ai env vars unset in the current shell (presence-checked only). | SC6–SC7 |
| G12 event kinds | coordinator ignores new kinds | **PARTIAL** — coordinator handles all kinds; story.mjs lacks `kill.confirmed` in its KIND vocabulary, so a killed worker's narrative never reaches a terminal state. | SC5 |

Net confirmed backlog: **G1 (correctness-critical), G5, G7+G12 (one story-lifecycle cluster),
G11 (+ the card capability field), G10 (card-shape normalization), G9 (drift note)**. Five
retired with evidence.

## Plan of pursuit

- **A. Proposal** — this document; done when committed.
- **B. Gap verification** — done: workflow `phase10-gap-verify`, 12/12 structured verdicts
  (table above).
- **C. Spec + red** — `spec/phase10/system-completion.md`, contracts SC1…SC11 drawn only from
  verified-open work; red tests land first and fail for the stated reason.
- **D. Implement to green** — smallest diffs that satisfy the contracts; the contended core files
  (coordinator.mjs, index.mjs, story.mjs, adapters) stay single-writer by design.
- **E. Adversarial review** — a review workflow fans dimensions (correctness, contract fidelity,
  concurrency, test honesty) over the phase-10 diff; findings adversarially verified; confirmed
  findings fixed and re-locked before the capstone.
- **F. Live capstone** — real claude + codex + grok driven concurrently through `createDriver()`:
  at least one mid-task steer, at least one interrupt, every result trust-gated in a fresh
  worktree; GLM live if credentials present, else PENDING-LIVE. Evidence JSONL committed;
  `impl/VALIDATION.md` rewritten.

## Non-goals (named, so scope cannot creep)

- **E2 cross-vendor decorrelation eval** (docs/23) — phase 11; it needs the completed fleet this
  goal delivers, and nothing here needs it.
- **MCP northbound** (baton exposed as an MCP server to other agents) — phase-11 candidate; this
  goal is the southbound control plane.
- **New vendor adapters** (Gemini CLI ACP, Qwen Code, …) — matrix-documented, not adapter-built.
- **Coordinator persistence/resume across process restarts** — out unless a confirmed gap forces
  it (none does).
- **One-shot tier expansion** — G10 normalizes its card honesty; nothing more. Session-mode is
  the posture.

---

*Goal pinned. Phase B closed 5 of 12 believed gaps by evidence and confirmed the remaining 7 as
real work; pursuit continues C → F.*