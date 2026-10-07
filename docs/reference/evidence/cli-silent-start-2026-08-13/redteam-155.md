# #155 RED-TEAM REPORT — adversarial attack on the CLI-silent-start contract v1.0

- **Target:** `docs/reference/evidence/cli-silent-start-2026-08-13/cli-silent-start-contract.md` (v1.0 DRAFT, issue #155 — kill the CLI silent reinterpretation of unknown `run <verb>` into `run.start`).
- **Row:** `row-rt155`. Frame: `contract-foundry-2026-08-13/foundry-brief.md` (shared laws) + `cli-silent-start-2026-08-13/contract-155-brief.md` (the target's brief) + `review-foundry-2026-08-13/row-rt155.md` (this row's brief).
- **Verification HEAD:** this worktree's git HEAD is `e371f704727cbca5fdff86af31ec8b154620a71f` ("Baton private effective-tree snapshot"). The target contract asserts verification HEAD `7bcca960db181d7b0fb57f61f558470a0c1bc4e8`; that commit is **absent** from this repo (`git cat-file -t` fails; not an ancestor). Every anchor was therefore re-verified this session against the **working tree content** with `grep -an`/`sed -n`/`Read` and live `node` parse probes. All line-number anchors hold against the working tree; the HEAD-identity claim is itself flagged (M5).
- **Issue:** `gh issue view 155` could not be fetched — `gh` is unauthenticated in this worktree (same constraint the sibling #158 fold documented). Requirements were carried by the target contract, its brief, the audit evidence, and the live parser.
- **Shared-frame laws honored:** no clocks; no new numeric limits; NUL-bearing files (`application.mjs`, `coordination-store.mjs`) are NOT cited here — every cited source is a plain UTF-8 read; every citation below was re-read this session.

---

## 0. Method

The attack plan followed the shared axes: (1) **citation audit first** — every `file:line` anchor in the target re-verified against the real code; (2) **per-decision attacks** against D1 (closed verb set / refusal shape / exit code), D2 (verb-vs-objective boundary), D3 (teaching half / edit-distance); (3) the **refusal vocabulary** (new codes? closed set? next action?); (4) the **acceptance pins** (red-at-HEAD status and **shallow-greenability** — can a lazy implementation pass them without the intended generic mechanism?); (5) the **open questions**. Where a behavioral claim was testable, it was tested live with `node` against `parseBatonCli` from `impl/src/application-cli.mjs` in this worktree.

Live parse probes (this worktree, HEAD `e371f70`):

```
["run","shwo"]      => run.start objective=shwo      (RED — the audit's headline; PT-2 target)
["run","member"]    => run.start objective=member    (RED — audit D-3; PT-5 target)
["run","watch"]     => run.start objective=watch     (RED — F-2 residual, kept by design)
["run","steek"]     => run.start objective=steek     (RED — audit F-1's OWN second example; UNFIXED by D2)
["run","viwe"]      => run.start objective=viwe      (RED — PT-2 target)
["run","follw"]     => run.start objective=follw     (RED — distance-1 typo of follow; UNFIXED)
["run","membr"]     => run.start objective=membr     (RED — distance-1 typo of member; UNFIXED)
["run","Improve Baton"] => run.start objective=Improve Baton  (green pin; preserved)
["run","follow"]    => THROW cli_command_unavailable (PT-9)
["run","steer","run:1"] => THROW cli_command_unavailable (PT-9)
["run","member","view","run:1"] => run.workstreams  (PT-7)
["run","list"]      => runs.list                    (PT-7)
```

---

## 1. Citation audit (every anchor re-verified)

Every line anchor in the target's §8 was checked against the working tree. **All line numbers are accurate.** Two evidence-fidelity issues (a wrong *characterization* of a cited source — the blocker class under the frame's citation law — and a minor wording imprecision) were found and are itemized first.

### C-1 — BLOCKER: §1.2 misattributes the audit's model-site verdict to E-5

Target §1.2 says:

> "This is the audit's verified model refusal (§3 E-5, sweep verdict: the `cli_command_unavailable` + closed-set + corrective-naming pattern is one of the two sites that pass the #41/#139 test)."

The audit says the opposite. The sweep verdict (`surface-audit-cli.md:173-176`) names the two model sites as **E-6** (context eval, `cli_command_host_local` with typed corrective naming) and **E-7** (`baton wave list` → `wave list is not a verb; use the plural spelling`, `cli_command_unavailable`) — "the two refusal sites that model the pattern well". E-5 — the exact site the target cites, `application-cli.mjs:1383-1385` (`expected waves list, progress, start, attach, or run`) — is judged **deficient** in the audit table (`surface-audit-cli.md:161`): "Refusal names the closed set but omits send/stop (which exist on web/MCP); does not say 'use web/MCP/embedded'", with Names-field/class **✘** and Names-next-action **✘**. It is *not* one of the two sites that pass the #41/#139 test, and the audit never calls it a "verified model refusal".

The actual model for the shape this contract wants (closed set + corrective naming + **next action**) is **E-7 at `application-cli.mjs:1314-1322`** — the `wave`→`waves` plural corrective, which the audit's sweep verdict blesses and which the target's own §2 (D-7) even mentions as "the model for what the rest of the surface should do".

- **Fix:** re-anchor §1.2 on E-7 (`application-cli.mjs:1314-1322`) and E-6 as the audit-verified models; state honestly that E-5 (`:1383-1385`) is judged deficient (no next action), so the contract mirrors E-5's *shape* (typed code + closed set) but must supply the next-action element the audit says E-5 lacks — which D1's messages do. Drop the "verified model refusal (E-5)" claim.
- **Note for the coordinator:** the row brief (`contract-155-brief.md`) itself framed the `waves` branch as "the model to mirror, `:1384` area". That framing is in tension with the audit's verdict on E-5; the contract compounded it by attributing to the audit a verdict the audit never gave. This is a brief-vs-evidence tension the fold should resolve in favor of the audit.
- **Law:** the shared frame makes a wrong citation an automatic blocker. The anchor (line number) is right; the claim about the cited source's verdict is false and the source says the opposite. Blocker 1.

### C-2 — minor: §5 "explore/review call parseStart directly (application-cli.mjs:1293-1299)"

`explore` calls `parseStart(args, args.shift(), idempotencyKey, 'read_only_evidence')` directly (`:1299`); `review` calls **`parseReviewStart`** (`:1295`; function at `:1130`), not `parseStart`. The non-goal's substance (both are objective-first by construction and untouched) holds; tighten the wording.

### C-3 — minor: verification-HEAD identity (M5)

The target asserts "Verification HEAD: `7bcca96…`" and "this worktree's `impl/src` is that tree". `7bcca96` does not exist in this worktree's repo (git HEAD is `e371f70`). Because every anchor verifies against the working tree, the content is right; but the contract should cite the actual snapshot commit (`e371f70`) for reproducible verification.

### C-4 — everything else: accurate

Verified accurate (line numbers and content): `application-cli.mjs:1578` (the fall-through), `:1574-1577` (29-verb `lifecycleActions`, counted), `:1383-1385` (waves refusal), `:1421-1423` (follow refusal), `:1424-1426` (start → `parseStart`), `:1430/:1456-1457/:1476/:1513/:1552-1553` (facade nouns; `attention watch`/`knowledge seed`; `:1454/:1511/:1550` `undefined` leaks), `:1775-1779` (steer refusal), `:1872` (defensive `unknown run action` floor), `:1091-1128` (`parseStart`), `:1163-1173` + `:1168` (`resolveCanonicalCliArgs` length guard), `:1288-1292` (top-level `runs list`), `:1293-1299` (explore/review region); `application-semantics.mjs:742-787` (`OPERATION_ALIASES`), `:743-746` (`run list`), `:747-750` (`run view`), `:751-754` (`run.watch` `cli: null`), `:755-774` (member view/send/stop/interrupt), `:775-786` (`run do`/`resume`/`retry`); `baton.mjs:133` (exit-2 mapping); `CLI.md:35` (`run.list`), `:48` (`run.start` bare example), `:51` (`run.watch`), `:137-138` (objective-first co-equal statement); `docs/36-unified-control-grammar.md:80-84` (F8 start-verb fan-out); `phase68-unified-agent-entrypoint.test.mjs:51-56` (green pin, byte-exact); `harvest-accessor-red.test.mjs:885-924` (I1 resultpin stage), `:909-915` (I2 comment naming the two-token form's fate "unspecified" — actually `:910-914`), `:966` (`checkSurfaceDocs`); `surface-audit-cli.md` §3 E-1, §6 F-1, §6 F-8. The `action === 'member'` absence claim verified (`grep` empty).

---

## 2. Per-decision verdicts

### D1 — closed verb set + refusal shape + exit code — **HOLE**

What is **sound**: the derived-set arithmetic (lifecycle 29 ∪ five facade nouns ∪ `start` ∪ alias first-tokens `view`/`list`/`member`, minus refused-only `follow`/`steer` from the *taught/usable* set) matches the parser exactly; excluding `watch` on parser-absent grounds (F-2) is the right D-1 discipline; the exit-code landing (`cli_command_unavailable` → 2, `baton.mjs:133`) is the F-8 bucket and matches the existing run-family refusals; no new `cli_*` code is minted.

What is **a hole** (→ Blocker 4): the contract demands the taught set be "**derived from the parser's own recognized first-token set at runtime, never a second hand-kept literal**" (§3 control law, D1, PT-4), but **no such runtime source of truth exists**. The lifecycle set is one literal (`:1574-1577`); the five facade nouns, `start`, and `follow` exist only as separate `if (action === …)` branch conditions (`:1424`, `:1430`, `:1456`, `:1476`, `:1513`, `:1552`); `view`/`list`/`member` live cross-file in `OPERATION_ALIASES` (`application-semantics.mjs:742-787`). No query yields the union. An implementer must either hand-assemble the five nouns plus `start`/`follow` — the very "second hand-kept literal" PT-4 prohibits — or refactor the dispatch into a data table, which is more than PT-10's "parse-only change" allows. PT-4's "source-scan proves… not a second hand-kept literal" therefore has no verifiable criterion, which is what makes PT-2/PT-3/PT-5 shallow-greenable (see §4).

Minor framing (M2): §1.5's "there is **no exit-code regression** … the same bucket the typo-path already lands in (today via the later `cli_config_invalid`)" is only true in the disconnected worktree context. In a connected shell today's typo-path is exit 0 (a real `run.start` launches); the contract changes it to exit 2 — the desired loud-failure improvement. The sentence should say "exit 2 either way in the disconnected case; exit 0→2 in the connected case (the improvement)".

### D2 — verb/objective boundary — **HOLE**

What is **sound**: the four-way rule preserves objective-first byte-identically for every non-verb-shaped token (live-verified: `run Improve Baton`, `run watch`, `run deploy` still compile to `run.start`); rule 1 covers the recognized dispatch; the bare-`member` prefix gap (audit D-3) is correctly identified and the rule-2 fix mirrors the facade-noun incomplete-prefix refusals; the compatibility-alias list (§D2, PT-7) is complete and live-verified (`run list`→`runs.list`, `run member view run:1`→`run.workstreams`, `run follow`/`run steer run:1` refuse).

What is **a hole** (→ Blocker 2): the taught-live-set exclusion of `follow`, `steer`, and `member` (justified for the *suggestion* half — never suggest a dead verb — and for the member prefix) leaves **distance-1 typos of those verb positions silently starting Runs**. Live-verified: `run steek` → `run.start` objective=steek, `run follw` → objective=follw, `run membr` → objective=membr. `steek` is **the audit's own second headline example** — F-1 (`surface-audit-cli.md:258`): "A connected orchestrator typo (`run shwo`, `run steek`) launches a real Run". `steek` is a single substitution (distance 1) from `steer`; `follw` a deletion from `follow`; `membr` a transposition from `member`. Under the contract's rule 3 these match **zero** taught-live verbs (their targets are excluded), so they fall to rule 4 → objective-first → a real Run with provider spend. The contract's §0/§D3 claim to kill "the realistic single-keystroke typo mechanism — `shwo`, `sned`, `viwe`, `attenton`" is therefore incomplete, and the D3 residual disclosure ("a distance-≥2 typo … or a non-verb single token") implies only distance-≥2 and non-verbs escape — it does **not** disclose that distance-1 typos of refused-only verb positions escape.

- **Fix:** extend rule 3's *detection* to the full recognized-first-token set **including** `follow`, `steer`, and `member`, with distinct handling: for `follow`/`steer` refuse naming the existing next action (`steer was deleted; use run send` — `:1778`; `follow is not shipped by the Run application` — `:1422`), never suggesting the dead verb as usable (so #136 is still satisfied); for a `member` typo route to the rule-2 prefix refusal. This closes the audit's own example at no cost to objective-first, and the residual disclosure must be expanded to name the class.
- Minor (M3): rule 2 pins only bare `run member` (PT-5). `run member foo` (unknown sub-verb) is unpinned — today it is `cli_invalid: unexpected argument foo` (non-silent, via `parseStart`'s `noRemainder`), so no safety hole, but the contract should pin `action === 'member'` → refuse with the subverb set for consistency with the targeted-refusal doctrine.

### D3 — teaching half / edit-distance — **HOLE**

What is **sound**: the "exactly one, never a guess" discipline (zero matches → objective-first; two-or-more → objective-first) is principled and the right #41/#139 posture; every refusal carries the `run start OBJECTIVE` escape (the #136 law); the false-positive trade-off (OQ-3) is honestly weighed and the asymmetry-of-harm argument is correct.

What is **a hole** (→ Blocker 3): the distance metric is **self-contradictory and, read literally, fails PT-2**. D3 says "**Levenshtein** distance ≤ 1 (single-character substitution / insertion / deletion; **transposition counts as distance 1**)". Standard Levenshtein counts an adjacent transposition as **distance 2**. Measured in this session:

```
shwo -> show: Levenshtein=2  Damerau-Levenshtein=1
sned -> send: Levenshtein=2  Damerau-Levenshtein=1
viwe -> view: Levenshtein=2  Damerau-Levenshtein=1
attenton -> attention: Levenshtein=1  Damerau-Levenshtein=1
```

Three of the four PT-2 pins (`shwo`, `sned`, `viwe`) are adjacent transpositions. An implementer who follows "Levenshtein distance ≤ 1" literally (the standard algorithm) will reject none of those three and **PT-2 fails**. The metric the pins actually require is **Damerau-Levenshtein** (adjacent transposition = 1).

- **Fix:** replace "Levenshtein distance ≤ 1" with "Damerau–Levenshtein distance ≤ 1 (single-character substitution / insertion / deletion; adjacent transposition = 1)" in D3 and PT-2, and note that the pinned examples are transpositions precisely so the metric cannot be implemented as plain Levenshtein.
- (The `steek`/`follw`/`membr` detection gap is Blocker 2, overlapping D3's residual disclosure.)

---

## 3. Refusal vocabulary — **SOUND** (with one scoping note)

No new `cli_*` code is minted — the F-8 taxonomy is undisturbed, and both message shapes (typo-suggestion + `member`-prefix) reuse `cli_command_unavailable`. Both carry the `run start` next action. The "targeted, not a wall" decision is correct for an objective-first slot: a generic 35-verb wall would fire on legitimate objectives.

Scoping note (M4): D2 rule 2 says the `member`-prefix message mirrors `attention`/`knowledge` "byte-style". The *message* does; the *code* does not — `attention`/`knowledge` throw the default `cli_invalid` (`:1457`, `:1553`), while the contract pins `cli_command_unavailable` for the member prefix. Both map to exit 2 (`baton.mjs:133`), so there is no functional inconsistency, but the "byte-style mirror" claim should be scoped to the message text so an implementer does not inherit `cli_invalid` and fail PT-5.

---

## 4. Acceptance pins — red-at-HEAD + shallow-greenability

Red-at-HEAD status is **correct** for PT-1..PT-10 (all parse-level, no connection/provider/clock; `run shwo`/`run member`/`run viwe` all currently compile to `run.start` — live-verified). PT-8 is satisfiable: `parseBatonCli` runs at `baton.mjs:66` before `discoverBatonConnection()` at `:128`, so a parse-time throw precedes any connection discovery.

**Shallow-greenability (→ Blocker 4):** PT-2 pins only four tokens (`shwo`/`sned`/`viwe`/`attenton`); PT-5 pins only bare `member`; PT-3's zero-match (`deploy`/`refactor`) and two-or-more (constructed fixture) are permissive. A lazy implementation that hardcodes `if (['shwo','sned','viwe','attenton'].includes(action)) refuse` (plus a bare-`member` special case) passes PT-1, PT-2, PT-3, PT-5, PT-6, PT-7, PT-8, PT-9, PT-10 — every pin except the **ambiguous** PT-4 source-scan (which has no defined criterion, see D1). The suite does not force the generic distance mechanism.

- **Fix:** (a) expand PT-2 into a **generated distance-1 sweep** — every Damerau-distance-1 variant of a sample of taught-live verbs must refuse with the correct suggestion, and non-variant tokens must fall through — forcing a generic metric; (b) define PT-4's source-scan precisely (assert the refusal reads a named derivation symbol; the set is assembled from `lifecycleActions` + a single named `FACADE_NOUNS` const + `OPERATION_ALIASES` alias first-tokens, cross-checked by a red test against the `action === '<noun>'` branches). PT-6/PT-7/PT-9/PT-10 are byte-identical regression guards and are not shallow-greenable; keep them.

---

## 5. Open questions

- **OQ-1 (watch)** — sound; defer to F-2. `run watch` bare keeps starting objective "watch" (not distance-1 from any taught-live verb — verified). Correctly out of scope.
- **OQ-2 (the residual)** — honest in intent, but the disclosure is incomplete: it must name the `steek`/`follw`/`membr` class (Blocker 2), not just distance-≥2 and non-verbs.
- **OQ-3 (false-positive)** — sound. `stops`↔`stop` collisions are rare, recoverable in one retyped command, and the asymmetry-of-harm argument is correct.

---

## 6. Verdict — **NOT FOLD-READY** (numbered blockers)

**1. §1.2 misattributes the audit's model-site verdict to E-5 (citation-fidelity blocker).** The audit's sweep verdict names E-6/E-7 as the two model sites; E-5 (`:1383-1385`, the site the contract says to mirror) is judged deficient (no next action, omits send/stop). The claim "the audit's verified model refusal … one of the two sites that pass the #41/#139 test" is false and the cited source says the opposite. **Fix:** re-anchor on E-7 (`application-cli.mjs:1314-1322`) / E-6; be honest that E-5's shape is mirrored but the next-action element (which D1 already supplies) is the contract's addition.

**2. D2/D3 — the taught-live exclusion of `follow`/`steer`/`member` leaves distance-1 typos of those verb positions silently starting Runs, including the audit's own headline example `run steek` (surface-audit-cli.md:258).** Live-verified `run steek`/`run follw`/`run membr` → `run.start`. The residual disclosure does not name this class. **Fix:** extend rule-3 *detection* to the full recognized set with distinct handling (existing next actions for follow/steer, rule-2 routing for member); expand the disclosure.

**3. D3/PT-2 — the distance metric is self-contradictory and, read as "Levenshtein ≤ 1", fails three of PT-2's four assertions** (`shwo`/`sned`/`viwe` are adjacent transpositions, Levenshtein distance 2, Damerau-Levenshtein distance 1). **Fix:** pin **Damerau-Levenshtein** explicitly in D3 and PT-2.

**4. D1/PT-4 — "derived at runtime from the parser's own recognized set, never a second hand-kept literal" is un-implementable as specified** (no single source of truth: facade nouns/start/follow are branch conditions; alias first-tokens are cross-file), PT-4's source-scan has no verifiable criterion, and PT-2/PT-3/PT-5 are consequently **shallow-greenable** by token special-casing. **Fix:** pin the exact composition mechanism (named derivation symbol: `[...lifecycleActions, ...FACADE_NOUNS, 'start', 'follow']` + alias first-tokens from `OPERATION_ALIASES`), redefine PT-4's check, and expand PT-2 into a generated distance-1 sweep.

**Non-blocking minors:** M1 (§5 "review calls parseStart directly" — it calls `parseReviewStart`), M2 (§1.5 exit-code framing assumes the disconnected case; connected case is 0→2, the improvement), M3 (`run member foo` unpinned), M4 ("byte-style mirror" applies to message, not code — both exit 2), M5 (verification-HEAD `7bcca96` absent from this repo; cite `e371f70`).

**What is SOUND and must be kept byte-stable in substance:** the core diagnosis (E-1 / `:1578` silent reinterpretation), the preservation of objective-first (§1.3 — pinned and live-verified), the four-way rule's rule-1/rule-4 byte-stability, the refusal vocabulary (no new code, both message shapes, next action always present), PT-1/PT-6/PT-7/PT-8/PT-9/PT-10, and the exit-code landing in bucket 2.

---

## 7. Shared-scratchpad publication note

**Client route — absent (verified).** There is no client-addressable scratchpad *write*: the `run.scratchpad.append` verb (#158) is unlanded at this HEAD (grep across `impl/` finds no `run.scratchpad.append` / `run_scratchpad_append`), and the only scratchpad commands on the three surfaces are read/elevate — CLI `run.scratchpad.read` / `run.scratchpad.elevate` (`application-cli.mjs:1476-1513`), MCP `baton_run_scratchpad_read` / `baton_run_scratchpad_elevate` (`mcp-northbound.mjs:652-663`), web: none. `run.board.post` posts to a board, not the scratchpad.

**Worker up-channel — the actual publish mechanism (verified).** The coordinator's "publish to the `shared` partition" instruction is served by the authenticated in-run worker up-channel, not a client command: a worker emits `SCRATCHPAD_WRITE: {"entry":{…},"expectedFence":"current","idempotencyKey":"…"}` as printed model text; `scanForScratchpadWrite` (`claude-session.mjs:103`, grammar `claude-session.mjs:29`) parses it and `claude-session.mjs:1146` emits `scratchpad.write`; the coordinator binds the workerId from the stream envelope and calls `writeScratchpad` (`coordinator.mjs:12690-12693`); the store writes the entry to the **worker-scoped** partition (`const scope = \`worker:${fields.workerId}\``, `coordination-store.mjs:14103`), and the `shared` partition is populated by the orchestrator's settlement/elevation lane (`elevateTaskScratchpad` `coordination-store.mjs:14173`; `settleWorkflowScratchpad` writes scope `'shared'` at `:14333`). Note entries are the closed `note{text}` kind (no `title` field — the "#155" subject leads the text), capped at `FRAME_LIMITS['scratchpad.entry.body']` = 8192 bytes (`limits.mjs:71`).

**This row's publish:** a `note` entry titled `#155` (verdict summary, this report's durable path) was emitted via the up-channel under idempotency key `rt155.report.final` at `expectedFence:"current"`. It lands in `worker:<row-rt155>` and elevates to `shared` at settlement. Per the coordinator brief's explicit fallback ("Read each report from the `shared` scratchpad (durable files as fallback — note which)"), **this file remains the durable harvest artifact** (workflow.json `mustContain` "redteam-155.md" → "#155"); the scratchpad note is the real-time channel. (`gh issue view 155` was likewise unavailable — `gh` is unauthenticated in this worktree.)

---

## 8. Citation record

All `file:line` anchors were re-read this session against the working tree at git HEAD `e371f704727cbca5fdff86af31ec8b154620a71f` via `grep -an`/`sed -n`/`Read`, plus live `node` parse probes of `parseBatonCli` and a live Damerau-vs-Levenshtein measurement. No NUL-bearing file is cited. Sorted-key literals appear in actual code-unit order where any appear; `localeCompare` is not used.
