# Browser-use epic contract (#85) — Adversarial red-team report

Status: COMPLETE
Reviewer: browser-use-reviewer (cross-review storm, parallel lane)
Target: `docs/reference/evidence/frontier-sweep-2026-08-03/browser-use-contract.md`
Date: 2026-08-02 (worktree snapshot `31102d5`)
Read-only: no `impl/` file was modified; the only write is this report.

## Method

Every claim is grounded in `file:line` verified by `grep -an` + `sed -n` against the shipped
codebase at the worktree HEAD (`31102d5`). No whole-file reads > 1500 lines were performed.
Line numbers cited are the actual shipped lines, not the contract's citations, where they
differ. Verdicts: **CONFIRMED-HOLE** (the contract's claim or plan fails against shipped
code), **DEFENDED** (the claim holds), **NEEDS-AMENDMENT** (the claim holds but must be
changed or pinned for the epic to be coherent/reachable). Amendment text is supplied inline.

## Verdict summary

| Decision | Verdict | One-line reason |
|----------|---------|-----------------|
| BU-0 honest-empty optionalDep posture | **DEFENDED** | Pattern is real (`normalizeAtlasDeployment`, `index.mjs:73-91`); only probe-side-channel wording needs pinning. |
| BU-0-2 fetch+readability greenfield engine | **DEFENDED** (1 missed hole) | Constructive engine choice is sound; allowlist must also reject private/loopback ranges (missed hole). |
| BU-2-1 analysis:true TG5-legitimate worker | **CONFIRMED-HOLE** | `buildAuthoritativeBrief` (`goal-plan.mjs:409-423`) never propagates `analysis` to the task Brief; the premise is unreachable via the plan-gated path. |
| BU-2-2 fetch = hub-admitted receipt / TG2 | **CONFIRMED-HOLE** | Receipt side is real; "counts as TG2 progress" has **no wiring** — `_steeringEvidenceQualifies` (`coordinator.mjs:2141-2157`) admits only turn_started/scratchpad/interaction. |
| BU-2-3 digest+bounded excerpt, UNTRUSTED_WEB_CONTENT | **NEEDS-AMENDMENT** | Artifact shape defended; "one renderer, no side door" seam unpinned + `SECRET_SHAPED_TEXT` redaction exemption unjustified. |
| BU-2-4 scratch.cited_observed candidacy | **CONFIRMED-HOLE** | Promotion requires the **reader** task to be completed **and** `verified_task_outcome`-minted (`coordination-store.mjs:14374-14375`) — unstated; the named settlement ritual issues no `scratch.read`. |
| BU-1-1 deferred engine skeleton | **DEFENDED** | Coherent; hardcoded-empty needs an explicit invoke-level acceptance pin. |
| BU-1-2 Lane E review-only | **DEFENDED** | Review-not-gate is correctly bounded by non-goal + acceptance. |
| Control-law conformance | **NEEDS-AMENDMENT** | No clocks/turn-limits used — good; but the near-identical fetch-farm control is left unresolvable and could drift into a count-based violation. |

## Attack surface authority

### Identity derivation

- **Brief `analysis` is orchestrator-trusted in intent, but the enforcement point is wrong.**
  The contract (BU-2-1) asserts "analysis is issued by the Brief's author (the orchestrator),
  never claimed by the worker; confirm there is no code path where a worker's own turn output
  can retroactively set or influence its own Brief's `analysis` flag." The shipped reality:
  - The TG5 gate reads `task.brief?.analysis` (`coordinator.mjs:11359`). `validateBrief`
    (`messages.mjs:57-92`) never mentions `analysis`, and `createBrief` (`messages.mjs:95-115`)
    clones it verbatim — so a **direct** (non-plan-gated) task Brief *can* carry `analysis:true`.
  - **Plan-gated tasks cannot carry it at all**: `buildAuthoritativeBrief`
    (`goal-plan.mjs:409-423`) builds the authoritative Brief without `analysis`; `semanticBriefCore`
    (`goal-plan.mjs:428-442`) and `planBriefMatches` drop caller-supplied `analysis` for gated
    dispatches. So `task.brief.analysis` is `undefined` for every plan-gated task today — the
    contract's core premise (research Brief "carries `analysis: true`") is **false as shipped**.
  - A worker *can* influence `analysis` at plan-proposal time: `proposePlan`/`approvePlan`
    (`coordinator.mjs:3629-3637`) are gated only by the externally injected `_goalPlanAuthority`
    (`coordinator.mjs:3612-3624`). Whether a worker principal can propose an `analysis:true`
    node is a deployment-authority decision, not an impossibility. The contract's "no code path"
    claim is over-broad.
  - **Amendment:** BU-2-1 must (a) require `buildAuthoritativeBrief` to propagate
    `node.analysis` (or state that the flag is plan-level only and the gate relies solely on
    `requiredEffects` omitting `repository_edit`), and (b) require the goal-plan authority
    policy to deny worker principals `plan:propose`/`plan:approve` (a deployment-authority pin,
    not an "impossible by construction" claim).

### Injection lanes

- **The provider-visible renderer is single, but capability results bypass it.**
  The one existing seam for model-authored text into a provider-visible message is
  `prose = (worker, text) => wrapProse(worker, boundedAttentionText(text))`
  (`coordinator.mjs:325`), which wraps **and** NFKC-normalizes + `SECRET_SHAPED_TEXT`-redacts
  + caps at `MAX_ATTENTION_TEXT_BYTES` (`messages.mjs:409-437`). BU-2-3's web excerpt is not
  prose from a worker turn — it arrives inside a **capability `invoke()` result payload**
  (`capability-registry.mjs:257-320`), which is a structured ACI object, not a prose string.
  Nothing today forces that payload through `wrapProse`. The contract's BU-2-3 red-team target
  ("one renderer, no side door") is left as a *confirm*, not a *decision*: it must **pin the
  seam** where the excerpt is wrapped in `UNTRUSTED_WEB_CONTENT` before it enters any context.
- **Scratch-fact body is an unframed second lane.** A research worker's finding body is a
  scratch fact (`postScratchFact`, `coordination-store.mjs:13061-13075`) or scratchpad entry;
  neither is sanitized or framed at write time, and `readScratch`
  (`coordination-store.mjs:13149-13158`) returns the raw fact body to the reader with **no
  UNTRUSTED frame** and no `boundedAttentionText`. So a worker quoting page text into its own
  scratch fact leaks that text to a downstream reader **unframed** via `readScratch`. This is
  the exact "second, unframed field" the BU-2-3 acceptance claims is prevented ("no second,
  unframed field carrying the same text anywhere downstream (the finding body, a message, a
  board item)") — the acceptance is **not achievable as written** unless scratch reads are
  framed (a new control the contract does not specify).
- **`UNTRUSTED_WEB_CONTENT` framing is a new convention, not a reuse.** The existing family
  members (`UNTRUSTED_WORKER_TITLE`, `coordination-store.mjs:13970-13972`;
  `UNTRUSTED_CONTRADICTED_KNOWLEDGE`, `:14823`; `UNTRUSTED_RECALLED_MEMORY`, `:15445,15451`)
  are applied by **read-side projections** in the store. BU-2-3 needs the same frame applied
  at the **capability-result → context** boundary, which is the coordinator's job, not the
  store's. The contract must name that code site; it currently says only "a new, named member
  of the existing UNTRUSTED convention family," which understates the plumbing.

### Replay / idempotency

- **The registry already dedupes identical invocations — the contract misses it.**
  `CapabilityRegistry._run` (`capability-registry.mjs:257-320`) maintains a durable idempotency
  binding keyed on (action, capability, op, args, actor): a re-invoke of the **same args by the
  same actor** replays the stored result (`capability.op.replayed`) instead of executing again.
  So BU-2-2's "a second fetch whose extract digest is byte-identical… is deduplicated" is
  actually enforced *before* the network, at the arg-identity level — a stronger property than
  the contract claims, and one it should state (it changes the dedup key from "extract digest"
  to "op+args+actor", with the extract-digest dedup only mattering **across different args**).
- **The near-identical farm is open.** The contract correctly flags cache-busting
  re-parameterization as a soft farm but resolves nothing. Registry arg-identity does not
  dedupe `?t=1` vs `?t=2`; extract-digest does not dedupe paginated/dynamic content. A worker
  can loop `fetch` over query-param mutations forever. The contract must name a concrete
  control (see amendments — constructive URL normalization, or eval-able per-digest
  goal-mapping), and it must respect the control law (no fetch-count ceilings).
- **Replayed receipts must not count as progress.** If BU-2-2 later wires fetch results into
  steering cycles, a `capability.op.replayed` re-invoke must not count as fresh TG2 evidence
  (the same content-digest rule as `coordinator.mjs:9881`); the contract does not say this.

### Scope leaks

- **Allowlist construction is under-specified.** The contract's allowlist is "a closed domain
  allowlist (`string[]`, validated at construction like `pathScope`, ground truth #9)."
  `pathScope` validation (`messages.mjs:84-90`) is a string-glob shape check — it does **no
  IP classification**. Nothing in the contract forbids `localhost`, `127.0.0.1`, `10.0.0.0/8`,
  `169.254.169.254` (cloud metadata), or link-local/ULA targets inside the allowlist, and
  nothing addresses **DNS rebinding** (an allowlisted hostname resolving to an internal
  address at fetch time). For a capability whose Non-goal is "reads only what is publicly
  reachable," the allowlist validator must constructively reject loopback/private/link-local/
  ULA and non-public resolution targets. **Missed hole** (see Completeness).
- **`followLink` re-allowlists discovered targets** — the contract's Non-goal covers this
  ("a malicious page can put an off-allowlist link in its own text"). Defended.

## Attack surface lifecycle

### Ordering

- **Self-contradictory Brief (analysis:true + requiredEffects:[repository_edit]) is mintable.**
  The contract's BU-2-1 red-team target is real: `validateBrief` (`messages.mjs:57-92`) never
  rejects it, plan-node validation (`goal-plan.mjs:347-353`) only enforces the *one-way* rule
  (effectful + requiredEffects present + no repository_edit ⇒ analysis:true), and the TG5 gate
  (`coordinator.mjs:11359`) would then skip `required_effect` for a node that *demanded*
  repository_edit — silently weakening the effect audit. The contract says "the orchestrator's
  Brief-construction path must refuse to mint such a Brief" but does not say **where**. The
  enforcement belongs in `validateBrief` (and, for plan nodes, in `goal-plan.mjs` node
  validation). **Amendment required:** name the validation site and add an acceptance pin.
- **Plan-node analysis is validated, but never reaches the Brief** (see Identity derivation).
  The ordering of "plan says analysis:true → Brief should say analysis:true → gate skips"
  is broken at the second hop by `buildAuthoritativeBrief`.

### Crash recovery

- **Artifact write-once is inherited, but no receipt/artifact atomicity story is given.**
  The contract rides the `atlas-cpg` shape (`{mode:0o600, flag:'wx'}` + sha256-verify on read,
  `atlas-cpg.mjs:331-335`), which is crash-safe (write-once). What is **not** specified is the
  ordering between the network fetch, the artifact write, and the receipt mint: a crash after
  fetch but before artifact write would mint no receipt; a crash after write but before
  `validResult` leaves an orphan artifact. The contract should state that the receipt is minted
  only after the artifact is durably written and its digest verified (mirroring the CPG path),
  and that an orphaned artifact is inert (content-addressed, never admitted without a receipt).
- **`needs_resume`/cursor pagination exists** (`capability-registry.mjs:43-52` cursor rule) —
  the BU-2-3 pressure valve is real. Defended.
- **Registry idempotency persistence** (`_persistIdempotency`/`_readIdempotency`,
  `capability-registry.mjs`) gives crash recovery for re-invokes; the contract never references
  it, so a fetch re-drive after a coordinator crash replays the durable result — that property
  should be named (it is exactly what BU-2-2 wants for dedup, but only if the contract states
  it).

### Retention

- **The full extract is retained on disk with no lifecycle.** The contract allows the artifact
  to "retain the full readability-rendered extract up to a `maxSourceBytes`-style ceiling" but
  specifies no artifact root, no eviction, no read-gating, and no framing on artifact reads.
  Anyone holding the content-addressed ref (any worker that got it in a receipt) can read the
  full unframed extract via the artifact-read path — which is a **second, unframed route for
  the raw text** into a context if a future capability surfaces `refs` payloads. The
  "never raw HTML in context" property therefore depends on the artifact-read path also being
  framed, which the contract does not require.
- **No `SECRET_SHAPED_TEXT` redaction on web excerpts.** Every other text crossing a context
  boundary is redacted for credential-shaped content (`messages.mjs:410-437`). A page that
  contains a leaked secret — or text shaped like one — would pass through the web-excerpt path
  unredacted into worker context and, via scratch fact → Finding, into durable KG. BU-2-3's
  "byte-safety only" sanitization exemption is a retention/credential-bleed risk and is
  inconsistent with the shipped convention. **Amendment required** (see BU-2-3).

### Freshness

- **The dedup key is content-addressed, so freshness is content-versioned.** A re-fetch that
  returns different bytes mints a new digest (new artifact, new receipt); identical bytes
  dedupe. This matches the `coordinator.mjs:9881` rule. Defended — *if* the TG2 wiring existed.
- **Stale page freshness is not addressed.** The contract never states what happens when a
  worker re-fetches the same URL later and the page changed: is the old artifact superseded
  (a `Supersedes` knowledge edge?) or just a new sibling artifact? For research-quality
  freshness and for the KG, this should be pinned (the knowledge graph has a `Supersedes` edge
  type, `coordination-store.mjs:137`). Currently the contract is silent.

## Completeness — what the contract forgot

### Missed hole 1: SSRF / private-network reachability + DNS rebinding (BU-2 AND BU-0-2)

The Non-goal "No arbitrary-URL fetch" and the allowlist control bound *which hosts* a worker
may target, but the allowlist validator is specified only as "validated at construction like
`pathScope`" — a string-shape check that does not classify addresses. Nothing rejects:
- `http://localhost:PORT` / `http://127.0.0.1:PORT` (internal services, e.g. baton's own
  `homecloud-llama-primary` :8081 — exactly the surface BU-1 exists to QA, reachable here by
  BU-2),
- `http://169.254.169.254/` (cloud instance metadata — a classic SSRF target),
- `http://10.x` / `172.16.x` / `192.168.x` private ranges,
- **DNS rebinding**: an allowlisted public domain resolving to an internal address at fetch
  time. The engine "never contacts a URL" is about the probe, not the fetch; the fetch itself
  resolves DNS and connects to the resolved IP.

**Amendment text (new control, constructive class):** the domain allowlist validator must
reject, at construction, any entry that is an IP literal in a loopback/private/link-local/ULA
range, any bare `localhost`/`.local` host, and any hostname whose DNS resolution at fetch time
lands on such an address (a single bounded, pre-connect resolution check that fails the fetch
closed — never follows a rebinding). Add a red-first acceptance: an allowlisted hostname
rebinding to `127.0.0.1` yields a refused fetch, not a connection.

### Missed hole 2: honest-empty invocations are zero-cost and would be farmable TG2

BU-2-2's central distinction ("a CONTEXT_READ reads baton's own state for free and could be
farmed; a browser fetch reads external state, costs real wall-clock and real egress") is used
to justify fetch-as-TG2-progress. But in the `availability: 'empty'` deployment (BU-0), a
`browser.fetch` invoke returns a schema-valid **empty** result with **zero** egress, zero
external state, near-zero cost — mechanically identical to a CONTEXT_READ. The contract must
state that **honest-empty invocations never count as TG2 progress** (they are the read-excluded
class), or the farming argument collapses in the very deployment the epic is designed to
degrade gracefully into.

### Missed hole 3: replayed receipts

The registry's idempotency re-invoke path records `capability.op.replayed`
(`capability-registry.mjs:278-282`) and returns the durable result. If fetch results ever feed
TG2 progress, a replayed receipt must be non-progress (same digest, `coordinator.mjs:9881`
rule). The contract is silent on replayed receipts.

## Decision-by-decision findings

### BU-0 — honest-empty optionalDep posture — **DEFENDED** (2 pinning amendments)

- Ground truth #3 verified: `normalizeAtlasDeployment` (`index.mjs:73-91`) probes once via
  `git ls-files` (local subprocess, never network) and returns `availability:
  {status:'available'|'empty', reason}`; consumers return honest-empty results
  (`atlas-index.mjs:242,320,324`; `cartographer-quartermaster.mjs:306,556-557`, including
  `language_ceiling:'honest_empty'`). The contract's adaptation to a package-presence probe is
  faithful. Ground truth #4 verified: `impl/package.json` has exactly `{"@ast-grep/napi":
  "0.44.1"}` and no `optionalDependencies` key.
- The dynamic-import precedent (`atlas-behavior-fingerprint.mjs:30,40`) is real.
- **Amendment A (probe purity):** the contract says the probe "must be a pure local check …
  that never contacts a URL" — good — but it should also pin that the probe is a **one-time**
  computation at deployment-open injected as a constructor option (as `AtlasCodeIndex`/
  `CartographerQuartermaster` take `availability`), with no per-invoke re-probe, so a
  re-probe cannot become a per-call egress side channel. The contract already implies this
  ("computed ONCE") — make it an acceptance criterion.
- **Amendment B (lockfile):** the contract claims "no existing optional-dependency machinery
  to reuse." Correct for `package.json`, but `package-lock.json` already contains transitive
  `optionalDependencies` sections — the `npm pack → clean-install` smoke must assert the
  engine is not in the packed `files`/dependency closure, not merely that the top-level key is
  absent.

### BU-0-2 — fetch+readability engine — **DEFENDED** (1 missed hole, see Completeness)

- The "no JS execution surface ⇒ strictly smaller attack surface" argument is sound and
  constructive (the control-law "constructive" class, as the contract claims).
- The SPA honest-empty and redirect-chain targets are correctly scoped as honest-degrade
  decisions. **Defended.**
- **Amendment:** add the SSRF/private-network/DNS-rebinding allowlist control (Completeness
  missed hole 1) — a fetch-only engine still resolves DNS and connects to whatever IP the
  allowlisted hostname points at.

### BU-2-1 — analysis:true TG5-legitimate worker — **CONFIRMED-HOLE**

1. **The Brief never carries `analysis` on the plan-gated path** (`buildAuthoritativeBrief`,
   `goal-plan.mjs:409-423` omits it; `semanticBriefCore`/`planBriefMatches` drop it). The
   contract's premise ("A research worker's Brief carries `analysis: true`") is **unreachable
   as shipped**. The TG5 skip still fires — but only because `requiredEffects` omits
   `repository_edit`, not because of the flag. The contract must either amend
   `buildAuthoritativeBrief` to propagate `node.analysis`, or restate the mechanism
   accurately (the flag is plan-level; the gate is driven by `requiredEffects`). **Amendment.**
2. **The self-contradiction (analysis:true + requiredEffects:[repository_edit]) is mintable**
   on the non-plan-gated path (`validateBrief` never rejects it) and would suppress
   `required_effect` for a node that demanded it. The contract's fix ("the orchestrator's
   Brief-construction path must refuse to mint such a Brief") must name the enforcement site:
   `validateBrief` (`messages.mjs:57-92`) and plan-node validation (`goal-plan.mjs`).
   **Amendment.**
3. **"No code path where a worker influences its own `analysis`" is over-broad** —
   `proposePlan`/`approvePlan` (`coordinator.mjs:3629-3637`) are gated only by the injected
   `_goalPlanAuthority`; the contract must pin that the deployment's goal-plan authority
   denies worker principals `plan:propose`/`plan:approve`. **Amendment.**

### BU-2-2 — fetch = hub-admitted receipt / TG2 progress — **CONFIRMED-HOLE**

- **Receipt side defended:** registry admission (`validResult`, `capability-registry.mjs:43-52`)
  and `_record` sink are the generic hub-admission surface. "No new admission machinery" holds
  for the receipt.
- **TG2 side confirmed-hole:** "a completed fetch counts as TG2 progress evidence,
  deduplicated by the extract's content digest" has **no wiring in the shipped code**.
  `_steeringEvidenceQualifies` (`coordinator.mjs:2141-2157`) accepts exactly three evidence
  kinds — `turn_started`, `scratchpad` (distinct digest), `interaction` (resolved) — and
  `_observeSteeringCycle` is only ever called with `scratchpad` (via `writeScratchpad` at
  `coordinator.mjs:11048`), `interaction` (`:9145,:9275`), and `turn_started` (`:10658`).
  `invokeCapability` (`coordinator.mjs:9589`) records `capability.op.completed` on the
  registry's own sink but never reaches the steering-cycle machinery. The contract's claim
  that the registry lane "already has the equivalent guarantees" conflates *admission* (true)
  with *liveness/progress accounting* (false). BU-2-2 also contradicts BU-0's "no new
  machinery" by requiring exactly the new wiring it disclaims.
  **Amendment:** specify the wiring — a new `'capability_op'` evidence kind in
  `_steeringEvidenceQualifies` fed by a `_observeSteeringCycle(handle, {kind:'capability_op',
  digest: extractDigest})` call from the browser-use capability's invoke path, with the digest
  rule from `coordinator.mjs:9881`; replayed invokes (`capability.op.replayed`) must not count.
- **Registry arg-identity dedup missed:** identical (op,args,actor) re-invokes replay
  (`capability-registry.mjs:257-320`) — a stronger, earlier dedup than the contract's
  extract-digest rule. The contract should state both layers.
- **Soft-farm unresolved:** cache-busting re-parameterization is neither closed by registry
  arg-identity nor by extract digest. **Amendment:** a constructive control — the browser-use
  capability normalizes URLs (strip cache-busting/empty query params) **before** the
  idempotency binding and the network call, so `?t=1`/`?t=2` become one invocation; and an
  eval-able control — every fetch receipt must be cited against a research subgoal in the
  worker's report (conversational/eval-able, not a count ceiling — control-law compliant).
- Receipts-on-failure (404/network-error mint a receipt; error receipts are not citable):
  **defended** — `validResult` admits `status:'error'|'partial'` with a summary, and the
  contract correctly forbids the candidacy pipeline from treating an error receipt's absent
  extract as a source.

### BU-2-3 — digest + bounded excerpt, UNTRUSTED_WEB_CONTENT — **NEEDS-AMENDMENT**

- Artifact shape **defended**: `atlas-cpg.mjs:326,331-335` refs `{handle:'art:sha256:<digest>',
  kind, digest, bytes, mediaType, path}`, write-once `wx`, sha256-verified reads.
- **"One renderer, no side door" is unpinned.** The shipped codebase's only provider-visible
  prose renderer is `wrapProse(worker, boundedAttentionText(text))` (`coordinator.mjs:325`).
  A capability-result excerpt is a structured payload and will not pass through it. The
  contract must name the single seam: the browser-use capability returns the excerpt **only**
  inside a framed field of its `invoke()` result, and the coordinator's context assembler
  wraps it with `UNTRUSTED_WEB_CONTENT` at exactly one site, with a red-first acceptance that
  scans for an unframed copy of the extract anywhere downstream (a message, a board item, a
  scratch fact, a Finding body).
- **Scratch-read channel is currently unframed and unsanitized** (`coordination-store.mjs:
  13149-13158` returns raw fact bodies; `readScratch` facts carry no frame) — the BU-2-3
  acceptance ("no second, unframed field … (the finding body, a message, a board item)") is
  not achievable unless the contract adds framing to scratch reads for web-sourced facts, or
  forbids web-sourced text from entering unframed fact bodies entirely.
- **`SECRET_SHAPED_TEXT` exemption unjustified.** "Byte-safety only" sanitization conflicts
  with the shipped context-boundary convention (`boundedAttentionText`, `messages.mjs:410-437`).
  A page carrying credential-shaped text would reach worker context and durable KG unredacted.
  **Amendment:** either apply `boundedAttentionText`-style redaction to the excerpt (compatible
  with the Non-goal — secret-shape redaction is not instruction detection), or state an
  explicit exemption and why (e.g., "the content is public already") — silence is not a
  decision.
- Cap ambiguity: "same class of cap as BD3-B's 8KiB context-pack body ceiling" vs the existing
  `MAX_ATTENTION_TEXT_BYTES = 4_096` (`messages.mjs:409`). The contract must pick a number and
  state per-fetch (the receipt) vs per-finding (the KG body) ceilings; the `needs_resume`/cursor
  pressure valve is defended.

### BU-2-4 — candidacy gate via scratch.cited_observed — **CONFIRMED-HOLE**

- Four-source trigger set and no-fifth **defended** (`coordination-store.mjs:15460-15467`);
  queue derivation bounded ≤16 **defended** (`:15482-15509`).
- **Confirmed hole — unstated verified-reader precondition:** the `scratch.cited_observed`
  promotion (`coordination-store.mjs:14370-14378`) counts a scratch read as qualifying **only
  if** the reader task `status === 'completed'` **and** the reader task has a
  `verified_task_outcome` Finding (`verifiedOutcomes` map, `VerifiedBy` edge to
  `task:<id>`). The contract's framing — "a downstream teammate, or the orchestrator's own
  settlement-window elevation ritual … reads and cites that fact … the coordinator mints a
  Finding node … exactly as it does for any other cited scratch fact" — omits both
  preconditions:
  1. **The settlement ritual cannot be the reader.** `settlementLease`
     (`coordinator.mjs:10081-10170`) reads member scratchpads via `scratchpadSnapshot`
     (Issue #33 channel) and posts board items; it **never issues a `scratch.read` event**, so
     it can never populate the promotion's `reads` set.
  2. **A BU-2 research worker is not guaranteed to qualify as a reader.** Whether an
     `analysis:true` no-diff task reaches `completed` + `verified_task_outcome` depends on the
     orchestrator running an accepting verify pass — nothing in the contract states this, and
     the contract's own BU-2-1 premise ("no diff produced, none required") makes it *likely*
     that such tasks settle without a verified outcome.
  **Amendment:** the contract must state the verified-reader precondition, name a concrete
  qualifying reader (e.g., a downstream code-editing task in the same run that reads the fact
  resource and passes hub verification), and pin that the BU-2 acceptance's "the coordinator
  mints a Finding node via scratch.cited_observed" is only reachable once such a reader exists.
- **Self-read exclusion is not shipped.** The red test `bidirectional-v3-red.test.mjs:213-230`
  pins "the author's own read never satisfies minScratchReaders" as **red** in this snapshot —
  the shipped promotion has no author-task exclusion. BU-2-4's red-team target ("confirm the
  same task ID can never be both the fact's author and its qualifying reader") is therefore
  **unconfirmed as shipped** and depends on the BD3-A amendment landing. The contract must
  declare a **hard dependency** on BD3-A's self-read exclusion (or ship the exclusion itself)
  before this rung's candidacy acceptance can pass; it currently treats it as a confirm.
- **Citation trusts the poster** — the contract's own honesty line here is good and needs no
  change (the receipt digest proves byte-identity, not interpretation; Finding body text
  beyond the extract must carry UNTRUSTED-adjacent framing).
- `grounding:'observed'` never `'verified'` **defended** (promotion mints `grounding:'observed'`
  at `:14374`; the `:14301` verified-requires-evidence rule verified).

### BU-1-1 — deferred engine skeleton — **DEFENDED** (1 pinning amendment)

- The two-rung asymmetry (BU-2's "no auth, no JS" vs BU-1's inherently authenticated, DOM-
  interactive job) is correctly drawn, and the v1 skeleton-only deferral is coherent.
- **Amendment:** BU-1's `availability` must be **hardcoded `'empty'` at construction**, distinct
  from BU-0's dynamic probe, with an acceptance pin that `card()` reports `empty` and
  `invoke()` returns the schema-valid honest-empty result for **every** op — not merely "no
  playwright dependency remains." The contract's red-team target "confirm no code path that
  could flip it" needs the invoke-level pin to be testable.
- The "future BU-1 engine requires its own contract" gate is a good constructive control.
  **Defended.**

### BU-1-2 — Lane E review-only — **DEFENDED**

- "Findings feed review, never gate" is consistent with the Non-goal and correctly bounded;
  the v1 scope statement (registration skeleton + ledger schema, zero live runs) matches the
  acceptance. No amendment needed.

## Control-law conformance audit (bidirectional-v3-decisions.md:115-125)

The law: controls must be **eval-able**, **constructive**, or **conversational** — never
clocks or turn-limits; liveness/progress judged from the event vocabulary; count-based bounds
only on unanswered steering cycles; clocks only as deployment-class last resort.

- **No clock or turn-limit is used anywhere in the contract.** Verified across every decision
  and Non-goal. The contract even self-identifies BU-0-2's engine choice as the "constructive"
  class. **Pass.**
- **BU-2-2's "TG2 progress evidence" is event-vocabulary — blessed by the law — but the
  wiring is absent** (see BU-2-2). Adding `'capability_op'` to `_steeringEvidenceQualifies`
  is the law-compliant path.
- **Risk of drift: the near-identical fetch-farm control.** The contract flags the soft farm
  as a red-team target and resolves nothing. If a future implementer "fixes" it with a
  per-worker fetch-count ceiling, that is a **count-based bound that is NOT on unanswered
  steering cycles** — a control-law violation. The contract must pin the resolution now: a
  constructive URL-normalization control at the capability boundary, and/or an eval-able
  per-digest-to-subgoal citation requirement. **Amendment required.**
- **The honest-empty invocation must be excluded from TG2 progress** (Completeness missed
  hole 2) or it becomes a zero-cost farmable evidence source — the very class the law's
  read-exclusion exists for.

## Ground-truth verification log

| Contract ground-truth claim | Shipped reality | Verdict |
|------------------------------|-----------------|---------|
| TG5 skip at coordinator.mjs:11356-11377 | Skip condition `!task.brief?.analysis && requiredEffects.includes('repository_edit')` at `:11359`; skip comment `:11356-11358`; other phases still run | **DEFENDED** (line offset only) |
| `analysis` unvalidated Brief field, messages.mjs:95-115 | `validateBrief` (`:57-92`) never mentions it; `createBrief` clones verbatim, freezes (`:114`) | **DEFENDED for direct Briefs**; **FALSE for plan-gated** — `buildAuthoritativeBrief` (`goal-plan.mjs:409-423`) drops it |
| normalizeAtlasDeployment honest-empty at index.mjs:73-91 | Probes `git ls-files` once, returns `available/empty`; honest-empty consumers at `atlas-index.mjs:242,320,324`, `cartographer-quartermaster.mjs:306,556-557` | **DEFENDED** |
| package.json one dep, zero optionalDeps | `{"@ast-grep/napi":"0.44.1"}`, no `optionalDependencies` key | **DEFENDED** |
| capability-registry ACI at :54-93 | `validResult` `:43-52`, registration `:57-100`; summary ≤ 2048 **NUL-free** (not full control-char-free as contract states) | **DEFENDED** (minor overstatement: only `\0` is rejected, not all control chars) |
| artifact ref shape atlas-cpg.mjs:326,331 | `{handle:'art:sha256:<d>', kind, digest, bytes, mediaType, path}` at `:331-335`, `wx`+sha256-verify | **DEFENDED** |
| UNTRUSTED family at coordination-store.mjs:13968-15451 | `UNTRUSTED_WORKER_TITLE` `:13970-13972`, `UNTRUSTED_CONTRADICTED_KNOWLEDGE` `:14823`, `UNTRUSTED_RECALLED_MEMORY` `:15445,15451` | **DEFENDED** |
| Four KNOWLEDGE_CANDIDATE_TRIGGERS kinds :15460-15467 | `board.item_closed`, `package.admitted`, `scratch.cited_observed`, `verified_task_outcome` at `:15460-15467`; queue ≤16 `:15482-15509` | **DEFENDED** (but `scratch.cited_observed` promotion preconditions unstated — see BU-2-4) |
| pathScope string-glob allowlist messages.mjs:84-90 | `string[]` globs, rejects absolute-path entries | **DEFENDED** |
| content-digest dedup coordinator.mjs:9881 | `writeScratchpad` returns `contentDigest` as the steering-cycle dedup key; `_steeringEvidenceQualifies` digestSet `:2141-2157` | **DEFENDED for scratchpad**; **no wiring for capability ops** |
| PKG-2 lazy native deps mcp-packaging-decisions.md:111-117 | Lazy `@ast-grep/napi`, honest degrade, npm-pack smoke gate | **DEFENDED** |

## Required amendments (consolidated)

1. **BU-2-1 (a):** propagate `node.analysis` through `buildAuthoritativeBrief`
   (`goal-plan.mjs:409-423`) or restate the mechanism: the TG5 skip is driven by
   `requiredEffects` omitting `repository_edit`, not by `brief.analysis`.
2. **BU-2-1 (b):** enforce the analysis:true + repository_edit contradiction in
   `validateBrief` (`messages.mjs:57-92`) and plan-node validation (`goal-plan.mjs`); add a
   red-first acceptance pin.
3. **BU-2-1 (c):** pin that the deployment goal-plan authority denies worker principals
   `plan:propose`/`plan:approve` (`coordinator.mjs:3629-3637`).
4. **BU-2-2:** specify the TG2 wiring — a `'capability_op'` evidence kind in
   `_steeringEvidenceQualifies` (`coordinator.mjs:2141-2157`) fed by the browser-use invoke
   path, digest-deduped per `coordinator.mjs:9881`, replayed invokes non-progress.
5. **BU-2-2:** constructive URL normalization (strip cache-busting params) at the capability
   boundary before the idempotency binding and network call; eval-able per-digest-to-subgoal
   citation in the worker report (control-law compliant — no fetch-count ceilings).
6. **BU-2-3:** pin the single framing seam (the coordinator context assembler, analogous to
   `coordinator.mjs:325`) as the only place web-content-derived text is admitted; frame
   scratch reads for web-sourced facts or forbid web-sourced text in unframed fact bodies.
7. **BU-2-3:** apply `boundedAttentionText`-style `SECRET_SHAPED_TEXT` redaction to excerpts
   (or state an explicit exemption); reconcile the 4KiB vs 8KiB cap and per-fetch vs
   per-finding ceilings.
8. **BU-2-4:** state the verified-reader precondition
   (`coordination-store.mjs:14374-14375`); name a concrete qualifying reader; declare a hard
   dependency on the BD3-A self-read exclusion (`bidirectional-v3-red.test.mjs:213-230`).
9. **BU-0-2 / Non-goals:** add the SSRF/DNS-rebinding allowlist control (reject
   loopback/private/link-local/ULA literals and `localhost`/`.local`; a bounded pre-connect
   resolution check fails closed) — Completeness missed hole 1.
10. **BU-2-2:** exclude honest-empty invocations from TG2 progress — Completeness missed hole 2.
11. **BU-1-1:** pin `invoke()` honest-empty behavior for every op in acceptance, not just the
    absence of the playwright dependency.

## Bottom line

The contract's **architecture** (capability-adapter honest-empty, fetch-only engine, existing
candidacy rail, deferred BU-1) is sound and grounded in real shipped precedent — every
ground-truth citation verified. But four claims do not survive contact with the code:

1. **The `analysis:true` Brief premise is unreachable on the plan-gated path**
   (`goal-plan.mjs:409-423`), so BU-2-1's identity story is wrong as shipped.
2. **"A completed fetch counts as TG2 progress" has no wiring** — `_steeringEvidenceQualifies`
   admits only turn_started/scratchpad/interaction, and the contract's own "no new machinery"
   posture forbids what BU-2-2 requires.
3. **The BU-2-4 candidacy gate depends on a verified-reader precondition the contract never
   states** — and its named reader (the settlement ritual) issues no `scratch.read` events at
   all; the self-read exclusion it asks to "confirm" is a known-open red test.
4. **The "no side door" injection property is unproven**: capability-result payloads bypass
   the only renderer, and scratch-fact reads are currently unframed and unsanitized — the very
   second lane BU-2-3's acceptance claims to forbid.

Each is fixable with the amendments above; none requires abandoning the epic's shape.
