# Kill the CLI silent reinterpretation — unknown `run <verb>` must not start a Run — implementation contract (#155)

**v1.1 FOLDED.** Ring-2 contract form. **Verification HEAD:** `e371f70` ("Baton private
effective-tree snapshot" — this worktree's git HEAD and the tree this fold was verified against; the
v1.0 draft's asserted HEAD `7bcca96` is absent from this repo, fold M5). Every `file:line` citation
below was re-read this session against that HEAD with the Read tool / `grep -an`. No clocks.
The two NUL-bearing files are not cited here (this epic touches neither `application.mjs` nor
`coordination-store.mjs`); every cited file is a plain UTF-8 source read in full or by verified range.

Cross-referenced (not re-specced): #139 / #41 (name the class, never silently reinterpret), #136
(a refusal without a next action is a dead end), the #147 CLI surface audit
(`docs/reference/evidence/control-surface-audit-2026-08-13/surface-audit-cli.md` §3 E-1 and §6 F-1 —
the ranked finding this contract implements), #103 D6(b)/B5 (compose, don't duplicate — the closed
verb set is derived, never a second hand-list), and the #160 error-actionability gate law. Adjacent
findings recorded but **out of scope** (§5): F-2 (`run watch` advertised-but-dead), F-7 (help topics),
F-9 (the `undefined` leak on bare facade nouns).

---

## 0. The seed (why this contract exists)

The #147 CLI audit's single highest-mistake-induction site (§3 E-1, ranked §6 F-1): the `run` branch
of `parseBatonCli` turns any unrecognized first token into a Run objective. At
`application-cli.mjs:1578` —

```js
if (!lifecycleActions.has(action)) return parseStart(args, action, idempotencyKey);
```

— a token that is not a recognized lifecycle verb falls straight into `parseStart`, which compiles a
real `run.start` with that token as `intent.objective` (`application-cli.mjs:1091-1128`). Live (audit
§3 E-1 / §6 F-1): `baton run shwo`, `baton run member` (bare), and `baton run watch` (bare) all
compile to `run.start`. In a connected shell a single keystroke typo on the operator surface — `run
shwo` for `run show` — launches a **real Run with real provider spend**, with the typo as the
objective. The surface never states the valid `run` verb set for this input position, and the
reinterpretation is silent: the only symptom in this worktree was a downstream connection error
(`cli_config_invalid: user connection profile is unavailable`), which misleads the operator into
thinking their *connection* is broken rather than their *verb*.

The fix is not to remove the objective-first start form — that form is a pinned, sound design (§1.3)
— but to make the verb-position reinterpretation **loud**: a token in verb position that is not a
recognized verb must refuse at parse time with the closed verb set and the next action, never start a
Run.

---

## 1. Ground truth (all verified this session at HEAD `e371f70`)

### 1.1 The fall-through and the lifecycle set it gates

- **The fall-through:** `application-cli.mjs:1578` (quoted in §0). It is the LAST unchecked branch of
  the `run` dispatch: by the time control reaches it, `action` is known NOT to be `start`
  (`:1424-1426`), not the refused `follow` (`:1421-1423`), not one of the five facade nouns
  (`message` `:1430`, `attention` `:1456`, `scratchpad` `:1476`, `board` `:1513`, `knowledge`
  `:1552`), and not a canonical alias first-token (those resolve upstream, §1.4). So `:1578` sees
  exactly the residual: typos, bare `member`, and genuine objective text.
- **The lifecycle set** (`application-cli.mjs:1574-1577`), 29 verbs, verified by reading:
  `show, do, recover, status, approve, answer, steer, send, interrupt, progress, events, output,
  episode, workstreams, notify, result, stop, evidence, adopt, select, feedback, revise, stop-member,
  retry, resume, review, integrate, export, debug`. Membership in this set is what currently decides
  dispatch-vs-reinterpret at `:1578`.
- **Two of those verbs are recognized-but-refused positions, not live verbs.** `follow` refuses at
  `:1421-1423` (`cli_command_unavailable`, "follow is not shipped by the Run application"); `steer`
  passes `:1578` (it is in the lifecycle set) and refuses downstream at `:1775-1779`
  (`cli_command_unavailable`, "steer was deleted at the M5 alias sunset; use run send"). They are verb
  *positions* (consumed as verbs, never reinterpreted as objectives) but they are not verbs an operator
  can *use* — §D1 excludes them from the taught/usable set and from the typo-suggestion set (suggesting
  a dead verb would be a #136 dead end). Rule 3's *detection* nevertheless INCLUDES them (§D2 rule 3,
  fold B2): a distance-1 typo of `steer` (`run steek` — the audit's F-1 second headline example) or of
  `follow` (`run follw`) is caught and refused with the dead verb's existing message, never silently
  started.
- **The terminal fallback** past every lifecycle handler is `throw cliError(\`unknown run action
  ${action ?? ''}\`)` at `:1872` — unreachable today because `:1578` intercepts every non-member
  earlier; after this contract it stays as the defensive floor for any lifecycle verb whose handler is
  somehow bypassed (it is not the teaching surface).

### 1.2 The model to mirror — the audit's two model refusals (E-7, E-6), and why E-5's shape is mirrored but not its verdict

The audit's sweep verdict (`surface-audit-cli.md:173-176`) names the two refusal sites that model the
#41/#139 pattern well as **E-6** and **E-7**:

- **E-7** — `baton wave list` → `wave list is not a verb; use the plural spelling: baton waves list`,
  `cli_command_unavailable` (`application-cli.mjs:1314-1322`). Closed set via corrective naming (the
  RIGHT plural verb), typed code, next action present. This is the closest shape precedent for the
  `run` refusal.
- **E-6** — `baton context eval` → `context eval is host-local: use embedded
  BatonRun.context().evaluate(...) or MCP baton_context_eval`, `cli_command_host_local`
  (`application-cli.mjs:1307-1310`). Same pattern: typed code + corrective naming + next action.

The site the v1.0 draft called "the model to mirror" — the `waves` closed-set refusal at
`application-cli.mjs:1383-1385` (`expected waves list, progress, start, attach, or run`) — is the
audit's **E-5**, and the audit judges it **deficient** (`surface-audit-cli.md:161`): it "names the
closed set but omits send/stop (which exist on web/MCP); does not say 'use web/MCP/embedded'", with
Names-field/class **✘** and Names-next-action **✘**. The v1.0 draft's claim that E-5 is "the audit's
verified model refusal (… one of the two sites that pass the #41/#139 test)" is FALSE and is struck
(fold B1). What this contract actually does is mirror **E-5's shape** — typed `cli_command_unavailable`
+ closed set — while supplying the **next-action element the audit says E-5 lacks** and that E-6/E-7
demonstrate, which D1's message shapes do. The `run` branch's new refusal keeps two honest deviations
the contract pins (§D1): (i) the `run` set is far larger than waves' five, so it is **derived from a
single named composition symbol at runtime** (§D1's `RUN_RECOGNIZED_FIRST_TOKENS`), never a second
hand-list (the #103 compose-don't-duplicate law; and the D-1 anti-pattern — doc truth and parser truth
diverging silently — is exactly what a hand-list would reintroduce); and (ii) the `run` first-token
slot is structurally overloaded with the objective-first start form (§1.3), so the refusal fires on a
*subset* of unrecognized tokens (the verb-typo class), not on every unrecognized token.

### 1.3 The objective-first start form is a pinned, sound design (it must NOT be removed)

The bare `baton run OBJECTIVE` form is documented as co-equal with `baton run start OBJECTIVE`:
**CLI.md:137-138** — "`baton run OBJECTIVE` and `baton run start OBJECTIVE` are the same start form"
— and the generated inventory's `run.start` row leads with the bare example **CLI.md:48** — `baton run
"Ship it" --model gpt-5.6-sol --effort low`. The grammar doctrine lists bare `run` among the
start-verb fan-out (**docs/36-unified-control-grammar.md:80-84**, F8).

It is also a **green, pinned test** — `phase68-unified-agent-entrypoint.test.mjs:51-56`:

```js
test('ordinary CLI is objective-first and manual routing selects model and effort together', () => {
  assert.deepEqual(parseBatonCli(['run', 'Improve Baton', '--idempotency-key', 'run-default']), {
    kind: 'command', name: 'run.start',
    args: { intent: { objective: 'Improve Baton', resultIntent: 'change' } },
    idempotencyKey: 'run-default',
  });
```

The test name is the design principle: **the ordinary CLI is objective-first.** A sibling red test's
comment confirms the bare form is understood as "today's run-start objective shorthand" whose
two-token fate is "unspecified" (`harvest-accessor-red.test.mjs:909-915`). Removing the bare form
would break a green, named design and the documented primary start path; this contract therefore
**preserves objective-first byte-identically** and kills the silent reinterpretation by other means
(§D2). A "full kill" that requires `run start` for every objective is explicitly rejected (§5, OQ-2).

### 1.4 The canonical alias layer (recognized first-tokens that resolve upstream)

`resolveCanonicalCliArgs` (`application-cli.mjs:1163-1173`) rewrites canonical spellings to legacy
**before** the `run` branch sees them, driven by `OPERATION_ALIASES`
(`application-semantics.mjs:742-787`). The operator-facing first-tokens that are consumed as verbs by
resolution rather than by a `run`-branch handler:

- `run view …` → `run show …` (`application-semantics.mjs:747-750`) — `view` never reaches `:1578`.
- `run list` → `runs list` (`application-semantics.mjs:743-746`) — resolves to the top-level
  `runs list` branch (`application-cli.mjs:1288-1292`), never reaches the `run` branch. (This is why
  CLI.md:35's `run.list` row is served despite `list` not being in the lifecycle set.)
- `run member view|send|stop|interrupt …` → `run workstreams|notify|stop-member|interrupt …`
  (`application-semantics.mjs:755-774`) — but these are **three-token** canonical forms. A bare
  two-token `run member` does NOT match (`alias.canonical.length > args.length` skips it,
  `application-cli.mjs:1168`), and neither does a **two-token `run member <unknown-sub>`** (an unknown
  sub-verb escapes the canonical match and reaches the `run` branch unresolved — today a loud
  `cli_invalid: unexpected argument <sub>`, never silent; fold M3/H2). So `member` reaches `:1578`
  unresolved and, at v1.0, was silently reinterpreted as the objective "member" — audit D-3's second
  example. There is **no** `action === 'member'` branch anywhere in the `run` dispatch (verified:
  `grep -n "action === 'member'"` is empty). §D2 closes this with an incomplete-prefix / unknown-sub
  refusal mirroring `attention`/`knowledge` (extended to `run member <unknown-sub>` by fold M3).

### 1.5 The exit-code taxonomy the refusal lands in

`impl/scripts/baton.mjs:133` maps the typed code to the exit code:

```js
process.exitCode = error?.code === 'cli_invalid' || error?.code === 'cli_config_invalid'
  || error?.code === 'cli_command_unavailable' ? 2 : 1;
```

So `cli_command_unavailable` → **exit 2**. The audit's F-8 note records this as the "refusal" bucket
(`cli_invalid` / `cli_config_invalid` / `cli_command_unavailable` → 2; application/runtime failures →
1) and recommends all `cli_*` refusals consolidate into bucket 2. The existing `run`-family refusals
already live there: live `baton wave list` → 2, `baton run follow`/`run steer` → 2. The current
typo-path, by contrast, only fails later as `cli_config_invalid` (connection unavailable) — also exit
2 in the disconnected case, but with a message that blames the connection; in a **connected** shell
today's typo-path is exit 0 (a real `run.start` launches) — the silent-start bug itself. §D1 pins the
new refusal to `cli_command_unavailable` → 2: exit 2 either way in the disconnected case (no
regression), and **exit 0→2 in the connected case — the loud-failure improvement itself**, with the
correct message, fired at parse time (fold M2).

---

## 2. The question

The `run` first-token slot serves double duty: it is the **verb position** (`run show RUN_ID`,
`run member view RUN_ID`) and, by deliberate objective-first design, the **objective position**
(`run "Ship it"`). The parser cannot distinguish a verb typo (`run shwo`) from a genuine objective by
syntax alone — both are a single unrecognized token. Can Baton make the verb-position reinterpretation
**loud** — refusing typos at parse time with the closed verb set and the next action, killing the
silent provider-spend start — **without** breaking the pinned objective-first start form or any
canonical alias, and without minting a second hand-kept verb list that can drift from the parser (the
D-1 anti-pattern)?

---

## 3. Control-law preamble (binding)

- **#41 / #139 — never silently reinterpret; name the class, never the value.** The fall-through at
  `application-cli.mjs:1578` is a silent reinterpretation (E-1, "worst site on the surface"). The
  contract kills the silence: the verb-typo class becomes a typed refusal naming the class ("not a run
  verb") and the next action.
- **#136 — a refusal without a next action is a dead end.** Every refusal this contract adds carries a
  next action: the suggested verb (when the typo is unambiguous) and, always, the `run start OBJECTIVE`
  escape hatch.
- **Objective-first is sound and pinned (§1.3); it is not redesigned.** The line this contract draws
  (§D2) is a *typo-guard on top of* objective-first, not a removal of it. A token that is neither a
  recognized verb, nor a verb typo, nor an incomplete prefix keeps starting a Run byte-identically —
  that is the deliberate, named residual of preserving objective-first (OQ-2).
- **No second hand-list (D-1 / #103 compose-don't-duplicate).** The closed verb set the refusal names
  is **derived from the parser's own recognized first-token set at runtime**; a hand-kept duplicate
  that can drift from the parser (the exact D-1 / F-2 defect class) is a red-first failure (PT-4).
- **No clocks, no network.** The refusal is a pure parse-time decision over the token and the
  in-memory verb set; it fires before connection discovery and touches no provider (PT-8).

---

## 4. Decisions

### D1 — The closed run-verb set, the refusal shape, and the exit code

**The closed set, verified against the parser (not the doc), pinned to a named composition symbol.**
The recognized `run` first-token set at HEAD is, by derivation — and the derivation is pinned as a
single named symbol in the implementation, **`RUN_RECOGNIZED_FIRST_TOKENS`**, composed as
`[...lifecycleActions, ...FACADE_NOUNS, 'start', 'follow'] ∪ ALIAS_FIRST_TOKENS` (fold B4/H1):

- `lifecycleActions` — 29 verbs at `application-cli.mjs:1574-1577`;
- `FACADE_NOUNS` — ONE named constant, the five facade nouns: `message` (`:1430`), `attention`
  (`:1456`), `scratchpad` (`:1476`), `board` (`:1513`), `knowledge` (`:1552`); the constant must equal
  the run-branch's facade dispatch labels (a #159-style derived assertion, PT-4(a));
- `start` (`:1424`);
- `follow` — the refused-only branch at `:1421-1423` (not a lifecycle verb, so added explicitly);
- `ALIAS_FIRST_TOKENS` — `view`, `list`, `member`, the first tokens of the canonical alias rows that
  resolve upstream (`application-semantics.mjs:743-774`, `application-cli.mjs:1163-1173`).

This constant is the runtime source of truth for the typo-guard. It is the ONLY place the recognized
set is assembled; the refusal reads it, it does not re-list the verbs.

**Two sets, one derivation (fold B2/B4).** The derivation yields two layers:

- **The detection set** = `RUN_RECOGNIZED_FIRST_TOKENS` (everything above, INCLUDING the refused-only
  positions `follow`/`steer` and the prefix `member`). Rule 3 compares the token against THIS set, so
  a distance-1 typo of `steer` (`run steek`), of `follow` (`run follw`), or of `member` (`run membr`)
  is caught — never silently started.
- **The taught live set** = the detection set MINUS `follow`, `steer`, and `member`. These three are
  verb positions the parser consumes but are not verbs an operator can *use* (`follow`/`steer` are
  refused-only; `member` is an incomplete prefix), so the refusal neither names them as usable nor
  suggests them (suggesting a dead verb is a #136 dead end). This is the set the refusal renders in the
  typo-suggestion message; it is computed from the single derivation above, never handwritten.

**Parser-truth, not doc-truth.** `run watch` is advertised in CLI.md:51 but is NOT in the parser's
recognized set (`watch` has no `run`-branch handler and `run.watch`'s alias row carries `cli: null`,
`application-semantics.mjs:751-754`). The taught live set therefore **excludes `watch`** — including
it would reintroduce the D-1 doc-truth-≠-parser-truth lie. `watch`'s advertised-but-dead status is the
separate F-2 finding (§5, OQ-1); this contract neither fixes nor worsens it (`run watch` bare keeps
starting objective "watch" exactly as today — `watch` is not distance-1 from any recognized
first-token).

**The refusal shape — targeted, code `cli_command_unavailable`.** The refusal is
`cli_command_unavailable` (the existing typed code; **no new code is minted**, so the F-8 taxonomy is
not disturbed), and it is **targeted, not a wall**: because `run` is objective-first (§1.3), the
refusal fires *only* where there is positive evidence the token belongs in verb position — the
unambiguous-typo class (D2 rule 3) and the bare-/unknown-sub-`member` prefix class (D2 rule 2, fold
M3/H2). Every other
unrecognized token is a genuine objective and starts a Run (rule 4); a generic "here are all 35 verbs"
wall would fire on legitimate objectives and is therefore rejected. This is the honest reason the
`waves` mirror (§1.2) is adapted rather than copied literally: `waves` has no objective-first form, so
*every* unknown waves-token gets its five-verb wall; `run` cannot, so its refusal is scoped to the
typo/prefix class and names the closed set *inside* the targeted message. Each refusal names the class
("not a run verb"), the relevant closed subset, and the next action:

- *Typo-suggestion message* (rule 3): `run <T> is not a run verb; did you mean 'run <V>'? To start a
  run with '<T>' as the objective, use 'run start <T>'.` — names the single suggested verb `<V>` and
  the `run start` escape. (The taught live set, computed from the §D1 derivation and grouped compactly
  by lane — begin / read / lifecycle / facade — may follow in parentheses; the refused-only positions
  `follow`/`steer` and the `member` prefix are named as unavailable, never as suggestions (fold B2);
  it is rendered from the runtime derivation, never a hand-list, so it satisfies "naming the closed
  set" without the D-1 drift hazard.)
- *Prefix message* (rule 2): `expected run member view, send, stop, or interrupt` — names the member
  subverbs, mirroring `attention` (`:1457`) and `knowledge` (`:1553`) byte-style.

**The exit code — bucket 2, consistent.** `cli_command_unavailable` → exit 2
(`baton.mjs:133`). This is the same bucket the typo-path already lands in when it fails disconnected
(today via the later `cli_config_invalid` connection error, also → 2), so there is **no exit-code
regression in the disconnected case**; in a **connected** shell today's typo-path is exit 0 (a real
`run.start` launches) and this contract changes it to exit 2 — the loud-failure improvement itself
(fold M2). Bucket 2 is the bucket F-8 recommends for all `cli_*` refusals. The improvement is not the
code in the disconnected case (2 either way) but the *site and message*: the refusal now fires at
**parse time** with "not a run verb" instead of at connection time with "connection profile
unavailable" (PT-6, PT-8).

### D2 — The line between verb position and objective text

The first token after `run` is decided by a four-way rule, evaluated in order; the first match wins:

1. **Exact verb → dispatch.** The token exactly matches a recognized first-token (after canonical
   resolution). It is dispatched to that verb byte-identically to today. This covers every lifecycle
   verb, every facade noun, `start`, the refused-only positions `follow`/`steer` (dispatched to their
   existing refusals at `:1421-1423` / `:1775-1779`), and the canonical spellings `view` / `list` /
   `run member <sub>`.
2. **Incomplete canonical prefix / unknown sub-verb → refuse naming the subverbs.** The token is
   `member` with no sub-verb (bare `run member`, which canonical resolution does not expand,
   `application-cli.mjs:1168`) or with a sub-verb that is not one of `view`/`send`/`stop`/`interrupt`
   (`run member <unknown-sub>`, which also escapes canonical resolution and reaches the `run` branch
   unresolved — fold M3/H2). Refuse `cli_command_unavailable`: `expected run member view, send, stop,
   or interrupt` — mirroring `attention` (`:1457`, `expected attention watch`) and `knowledge`
   (`:1553`, `expected knowledge seed`) in **message text** (the *code* is `cli_command_unavailable`,
   unlike `attention`/`knowledge`'s default `cli_invalid`; both map to exit 2 — fold M4). This closes
   audit D-3's `run member` (bare) silent-start and the previously unpinned `run member foo` gap (today
   a loud `cli_invalid: unexpected argument <sub>` via `parseStart`'s `noRemainder`, never silent).
   (The other facade nouns already refuse when bare, though some leak `undefined` — `message` `:1454`,
   `scratchpad` `:1511`, `board` `:1550`; that `undefined` leak is the separate F-9 finding, §5, and is
   not worsened here.)
3. **Verb typo (Damerau–Levenshtein-1) → refuse + suggest.** The token is NOT an exact match and is
   distance-1 from exactly one recognized first-token (D3) — the detection set is the FULL
   `RUN_RECOGNIZED_FIRST_TOKENS` derivation (§D1), INCLUDING the refused-only positions `follow`/`steer`
   and the prefix `member` (fold B2), so distance-1 typos of those positions are caught too (`run
   steek`, `run follw`, `run membr` — the `steek`/`follw`/`membr` class). Refuse `cli_command_unavailable`
   with distinct handling per matched verb:
   - a taught-live verb → the standard suggestion message (below) + the `run start` escape;
   - `follow` → follow's existing refusal text ("follow is not shipped by the Run application",
     `:1422`) + the `run start` escape — never suggesting `run follow` as usable;
   - `steer` → steer's existing refusal text ("steer was deleted at the M5 alias sunset; use run
     send", `:1777`) + the `run start` escape — the suggested verb is `run send`, never the dead
     `run steer`;
   - `member` → route to rule 2's prefix refusal (`expected run member view, send, stop, or
     interrupt`).
   **This is the kill:** `run shwo`, `run sned`, `run viwe`, `run attenton`, `run steek`, `run follw`,
   and `run membr` no longer start a Run.
4. **Otherwise → objective-first (byte-identical).** The token is not an exact verb, not the `member`
   prefix, and not distance-1 from any recognized first-token. It is the objective: `parseStart(args,
   action, idempotencyKey)` (`application-cli.mjs:1578`'s call, unchanged) compiles `run.start`
   byte-identically to the phase68 pin. `run "Ship it"`, `run Improve Baton`, `run deploy` all still
   start Runs exactly as today.

**The line, stated plainly:** verb position and objective text share the first-token slot; the parser
treats the token as a verb when it is recognized (rule 1) or reconstructible as one (rules 2–3), and
as an objective only when it is neither (rule 4). Objective-first is preserved for every token that is
not verb-shaped.

**Compatibility aliases that MUST keep parsing (named, per the alias map §1.4).** All of these resolve
to a recognized verb position and are unchanged by this contract (PT-7 regression guard):

- `run start OBJECTIVE [--profile|--exact|--model/--effort|--harness|--run-id|--scope]`
  (`:1424-1426` → `parseStart`) — the explicit start form.
- `run view …` / `run show …` (`application-semantics.mjs:747-750` → `run.inspect`).
- `run list` (`application-semantics.mjs:743-746` → top-level `runs list`, `application-cli.mjs:1288`).
- `run member view|send|stop|interrupt …` (`application-semantics.mjs:755-774` → legacy
  `workstreams`/`notify`/`stop-member`/`interrupt`).
- `run do|resume|retry …` (self-aliases, `application-semantics.mjs:775-786`).
- every lifecycle verb and facade noun at its documented spelling; `run follow` and `run steer` keep
  refusing at their existing sites (PT-9).

The ONE behavioral change is: an unrecognized first token that is Damerau–Levenshtein-1 from a
recognized first-token (including the refused-only positions `follow`/`steer` and the prefix
`member`), or the bare / unknown-sub `member` prefix, now refuses instead of starting a Run. Every
other `run` invocation is byte-identical.

### D3 — The teaching half: closed set + nearest suggestion (Damerau–Levenshtein-1, never a guess)

The suggestion half is **implemented, not deferred** (the brief permits either; the typo class is the
issue's headline, so the suggestion carries it).

- **Damerau–Levenshtein-1 only.** Damerau–Levenshtein distance ≤ 1 (single-character substitution /
  insertion / deletion; **adjacent transposition = 1**). The metric is pinned as Damerau–Levenshtein,
  NOT plain Levenshtein, precisely because the headline typo class is transpositions: `shwo`←`show`,
  `sned`←`send`, and `viwe`←`view` are all adjacent transpositions (Damerau distance 1,
  standard-Levenshtein distance 2); `attenton`←`attention`, `follw`←`follow`, and `membr`←`member`
  are single insertions/deletions; `steek`←`steer` is a substitution (fold B3). An implementation
  using plain Levenshtein would reject none of the three transpositions and fail PT-2. This is the
  principled threshold: it captures the overwhelming majority of real keystroke typos without a
  heuristic "fuzzy" guess.
- **Never a guess.** A suggestion is offered **only when exactly one** recognized first-token is within
  distance 1 (the detection set is the full `RUN_RECOGNIZED_FIRST_TOKENS` derivation, §D1 — fold B2).
  Zero matches → the token is not verb-shaped; objective-first applies (D2 rule 4) and the token starts
  a Run — there is no refusal and no suggestion, because the parser has no basis to call it a verb.
  Two-or-more matches → objective-first applies as well (ambiguous; the parser never guesses between
  candidates). The refusal therefore catches *only* the exactly-one case (plus the `member` prefix
  class, D2 rule 2).
- **Always paired with the escape.** Every refusal ends with the next action `run start OBJECTIVE`, so
  an operator whose token was a genuine objective recovers in one retyped command (the #136 law).
  (Genuine objectives that reach rule 4 never see a refusal — they start, byte-identically to §1.3.)

**The residual, stated honestly.** The typo-guard refuses only when the token is distance-1 from
*exactly one* recognized first-token — including the refused-only verb positions `follow`/`steer` and
the `member` prefix, so the `steek`/`follw`/`membr` class is refused with its distinct handling (§D2
rule 3) and no longer silently starts a Run (fold B2). A token distance-1 from zero recognized verbs,
or from two or more, and any distance-≥2 typo, falls to objective-first (rule 4) and starts a Run.
This is the deliberate, named cost of preserving the pinned objective-first design (OQ-2): a
distance-≥2 typo (e.g. `shpw` for `show`) or a non-verb single token still starts via objective-first.
The contract kills the distance-1 class (the realistic single-keystroke typo mechanism — `shwo`,
`sned`, `viwe`, `attenton`, `steek`, `follw`, `membr`) and names the residual honestly rather than
pretending to a full kill, which would require removing objective-first (§1.3) and is rejected (§5,
OQ-2).

---

## 5. Refusal vocabulary, non-goals, and open questions

**Refusal vocabulary (closed).** This contract adds ONE new refusal *site* (the `run`-branch
typo-guard at the site of `application-cli.mjs:1578`) and ONE adjacent site (the bare-/unknown-sub-
`member` incomplete-prefix refusal, fold M3/H2). Both reuse the **existing** typed code
`cli_command_unavailable` — **no
new error code is minted** (the F-8 taxonomy is unchanged). The two message shapes are pinned in §D1;
an implementation that introduces a new `cli_*` code for this, or that fires the refusal from any
non-`run`-branch site, is a red-first failure (PT-4).

**Non-goals (out of scope for #155).**

- **F-2 — `run watch` advertised-but-dead.** `watch` is in CLI.md:51 but absent from the parser
  (`application-semantics.mjs:751-754`, `cli: null`); bare `run watch` starts objective "watch" today
  and continues to under this contract (it is not distance-1 from any live verb). That is a separate
  doc/parser-drift finding (F-2), not the silent-verb-reinterpretation this contract kills. OQ-1.
- **F-7 — help topics for facade lanes; `baton help run` teaches legacy spellings.** This contract
  does not rely on `baton help run` to enumerate the verb set (it is incomplete per audit D-5/D-7), so
  the refusal names the computed set itself; the help-topic coverage gap stays a separate finding.
- **F-9 — the `undefined` leak on bare `message`/`scratchpad`/`board`.** Those nouns already refuse
  when bare (`:1454`, `:1511`, `:1550`); their leaky message is a separate #139-family fix, untouched
  here.
- **Full kill / removing objective-first.** Rejected — it breaks the pinned green design (§1.3) and
  the documented primary start path. OQ-2.
- **Top-level `explore` / `review`.** `explore` calls `parseStart` directly
  (`application-cli.mjs:1299`, with the `read_only_evidence` stamp); `review` calls `parseReviewStart`
  (`:1295`, function at `:1130`), not `parseStart` (fold M1). Both are objective-first by construction,
  outside the `run` branch, and are not touched.
- **`run member <unknown-sub>` is refused, not a silent start — but the sub-verb typo class is out of
  scope.** The pre-fold residual (H2/M3): a typo'd sub-verb (`run member veiw`) reaches the `run`
  branch unresolved and fails today as a loud `cli_invalid: unexpected argument <sub>` via
  `parseStart`'s `noRemainder` — never silent, never a Run. Fold M3 extends rule 2 to refuse it with
  the teaching message (`expected run member view, send, stop, or interrupt`). The residual that
  remains is the sub-verb-typo class *inside* `member` (e.g. `veiw` for `view`), which is the F-7
  help-topic family, not the silent-start class this contract kills.

**Open questions.**

- **OQ-1 (watch).** Should a later hardening refuse `run watch` by teaching the parser the dead verb
  with an F-2 redirect? Yes — but as part of the F-2 fix, not #155. This contract leaves `run watch`
  exactly as today.
- **OQ-2 (the residual).** Distance-≥2 typos and non-verb single tokens still start Runs via
  objective-first. This is the accepted cost of preserving the pinned objective-first design; `run
  start` is the unambiguous escape. A future "full kill" would require deprecating the bare form
  (breaking §1.3) and is out of scope.
- **OQ-3 (false-positive trade-off).** A legitimate single-token objective that happens to be
  distance-1 from exactly one recognized first-token (e.g. an objective `stops`, distance-1 from
  `stop`) is refused. Accepted: such collisions are rare, fully recoverable via `run start <token>`,
  and the asymmetry of harm (a refused start is retyped in one command; a silent typo-start costs real
  provider spend and cleanup) overwhelmingly favors refusing. Multi-word / descriptive objectives
  (the common case — `Improve Baton`, `Ship it`) are never distance-1 from a recognized first-token
  and are unaffected.

---

## 6. Acceptance (red-first)

The red-first suite ships BEFORE implementation; every row is a deterministic parse-level assertion
(no connection, no provider, no clock). All assertions use `parseBatonCli` directly so the refusal is
tested at the parse seam where it lives.

- **PT-1 (objective-first preserved, byte-identical).** `parseBatonCli(['run', 'Improve Baton',
  '--idempotency-key', 'run-default'])` returns the exact phase68 shape (`run.start`, `intent.objective
  'Improve Baton'`, `resultIntent 'change'`); `parseBatonCli(['run', 'start', 'Improve Baton', …])`
  returns the identical command; a multi-word objective with start flags (`run 'Ship it' --exact …`)
  still compiles to `run.start`. (Regression-guards the §1.3 green pin.)
- **PT-2 (typo-guard kills the silent start — pinned examples + generated distance-1 sweep).** The
  pinned examples: `parseBatonCli(['run', 'shwo'])` THROWS with
  `error.code === 'cli_command_unavailable'`, a message matching `/did you mean 'run show'/u` and the
  `run start` escape, and does NOT return a `run.start`. Same for `['run','sned']`→`send`,
  `['run','viwe']`→`view`, `['run','attenton']`→`attention watch`. `shwo`/`sned`/`viwe` are
  **adjacent transpositions** — refused only under Damerau–Levenshtein, not plain Levenshtein (fold
  B3). The refused-position typos (fold B2): `['run','steek']` THROWS `cli_command_unavailable` with
  steer's existing message (`/steer was deleted at the M5 alias sunset; use run send/u`) and the
  `run start` escape; `['run','follw']` THROWS with follow's existing message (`/follow is not shipped
  by the Run application/u`); `['run','membr']` THROWS with the member subverb message
  (`/expected run member view, send, stop, or interrupt/u`). **Generated sweep (fold B4):** a test
  generator enumerates every Damerau–Levenshtein-distance-1 string of a sample of recognized
  first-tokens (at minimum `show`, `send`, `view`, `attention`, `status`, `list`, `member`, `steer`,
  `follow`) and asserts each variant either refuses `cli_command_unavailable` with the correct
  suggestion (exactly-one match) or falls through to `run.start` (zero / two-or-more matches) — so a
  token special-case cannot pass the pin. (The audit's headline example.)
- **PT-3 (never a guess).** A token edit-distance-1 from **zero** recognized first-tokens (e.g.
  `'deploy'`, `'refactor'`) falls through to `run.start` (objective-first) with no suggestion and no
  refusal. A token edit-distance-1 from **two or more** recognized first-tokens (a constructed fixture)
  also falls through to `run.start` (objective-first) — the parser never guesses between candidates.
  The refusal + suggestion appear only for the
  exactly-one case.
- **PT-4 (closed set derived from the pinned symbol, no drift — source-scan redefined, fold B4/H1).**
  A source-scan asserts the refusal's detection set is computed from the single named derivation
  symbol `RUN_RECOGNIZED_FIRST_TOKENS` (§D1), not a second hand-kept literal, and specifically:
  (a) `FACADE_NOUNS` equals the run-branch's facade dispatch labels — the scan compares the constant
  against the `action === '<noun>'` branch conditions at
  `application-cli.mjs:1430/1456/1476/1513/1552` (a #159-style derived assertion; a facade noun missed
  from the constant fails red); (b) `ALIAS_FIRST_TOKENS` is cross-checked against the `OPERATION_ALIASES`
  cli canonical rows (`application-semantics.mjs:742-787`); (c) the detection set INCLUDES
  `follow`/`steer`/`member` (fold B2), while the rendered/usable set EXCLUDES them and EXCLUDES
  `watch` (parser-absent, F-2); (d) the refusal is fired only from the `run` branch at the `:1578` site
  (and the `member`-prefix site, rule 2), nowhere else; (e) no new `cli_*` code is minted.
- **PT-5 (bare / unknown-sub `member` incomplete-prefix).** `parseBatonCli(['run', 'member'])` THROWS
  `cli_command_unavailable` with a message naming `member view`, `send`, `stop`, and `interrupt`, and
  does NOT return a `run.start`. Same for `['run','member','veiw']` (an unknown sub-verb — fold
  M3/H2): THROWS the same teaching refusal, never a `run.start`. (Closes audit D-3's `run member` bare
  silent-start and the unpinned `run member foo` gap.)
- **PT-6 (exit code).** The typo-guard refusal (PT-2) and the `member`-prefix refusal (PT-5) both
  surface as exit 2 when run through the `baton.mjs:133` mapping (`cli_command_unavailable` → 2), the
  same bucket as the existing `run follow` / `run steer` / `baton wave list` refusals; a genuine
  `run.start` parse still succeeds (exit 0 on a happy path). No exit-code regression versus today's
  later-firing `cli_config_invalid` (also 2).
- **PT-7 (canonical aliases unchanged).** `run view`, `run list`, `run member view|send|stop|interrupt`,
  `run do|resume|retry`, and every lifecycle verb + facade noun at its documented spelling parse
  byte-identically to HEAD (a snapshot regression-guard).
- **PT-8 (parse-time, no connection attempt).** The typo refusal is thrown by `parseBatonCli` before
  any connection discovery / client construction / provider path; a test that intercepts below the
  parse layer observes no connection or provider activity for `run shwo`. (The safety property: a typo
  cannot reach provider spend.)
- **PT-9 (refused positions unchanged).** `run follow` still refuses `cli_command_unavailable` ("not
  shipped by the Run application", `:1421-1423`); `run steer` still refuses `cli_command_unavailable`
  ("deleted at the M5 alias sunset; use run send", `:1775-1779`). (Regression-guard; confirms the
  typo-guard does not shadow the existing targeted refusals.)
- **PT-10 (conformance unchanged).** `checkSurfaceDocs()` (the `render-surface-docs.mjs` conformance
  gate, `harvest-accessor-red.test.mjs:966`) still returns `[]` — the CLI.md generated inventory is
  unchanged by this parse-only change (no verb is added or removed from the served set; the
  objective-first start form is already the documented `run.start` row at CLI.md:48).

---

## 7. Verification

```text
node --test impl/test/cli-silent-start-red.test.mjs   # the red-first suite (PT-1..PT-10)
```

then the canonical suite fully green (the `grammar-*` and `phase64`/`phase68` CLI parse tests are the
load-bearing regression guards for §1.3 and PT-7). This file is the **v1.1 fold** of the #155
contract; its fold record is appended below. The v1.1 deliverables are this contract file (folded in
place) plus `docs/reference/evidence/cli-silent-start-2026-08-13/fold-155.md` (the blocker→resolution
map). The code, tests, and any CLI.md wording adjustment land in the implementation ring that consumes
this contract.

---

## 8. Citation verification

Every citation was read this session at HEAD `e371f70` (this worktree's git HEAD — the v1.0 draft
asserted `7bcca96`, which is absent from this repo, fold M5). All cited sources are plain UTF-8; no
NUL-bearing file is cited.

- `application-cli.mjs:1578` — the fall-through into `parseStart` (read in full context `:1540-1873`).
- `application-cli.mjs:1574-1577` — the `lifecycleActions` set (29 verbs, enumerated and counted).
- `application-cli.mjs:1383-1385` — the `waves` closed-set refusal (audit E-5 — shape mirrored; its
  missing-next-action deficiency is why the audit's model verdict re-anchors on E-6/E-7, §1.2).
- `application-cli.mjs:1421-1426` — `follow` refusal and `start` → `parseStart`.
- `application-cli.mjs:1430 / 1456-1457 / 1476 / 1511 / 1513 / 1550 / 1552-1553` — the five facade
  nouns and their bare/unknown-sub refusals (`attention watch`, `knowledge seed`; `message`/
  `scratchpad`/`board` leak `undefined`).
- `application-cli.mjs:1775-1779` — `steer` refused-only position.
- `application-cli.mjs:1872` — the defensive `unknown run action` floor.
- `application-cli.mjs:1091-1128` — `parseStart` (the objective-first grammar; bare and `start` forms
  compile byte-identically).
- `application-cli.mjs:1163-1173` — `resolveCanonicalCliArgs`; `:1168` the `length` guard that leaves
  bare `run member` unresolved.
- `application-cli.mjs:1288-1292` — top-level `runs list` (the `run list` canonical target).
- `application-cli.mjs:1293-1299` — `explore` calls `parseStart` directly (`:1299`, `read_only_evidence`
  stamp); `review` calls `parseReviewStart` (`:1295`, function at `:1130`) — NOT `parseStart` (fold M1;
  both out of scope).
- `application-cli.mjs:1307-1310` — the E-6 `context eval` model refusal (`cli_command_host_local` +
  corrective naming + next action).
- `application-cli.mjs:1314-1322` — the E-7 `wave`→`waves` model refusal (corrective naming of the
  RIGHT plural verb, `cli_command_unavailable`, next action present).
- `application-cli.mjs:1421-1423` — `follow` refuses `cli_command_unavailable` ("follow is not shipped
  by the Run application", the exact message at `:1422`).
- `application-cli.mjs:1775-1779` — `steer` refuses `cli_command_unavailable` ("steer was deleted at
  the M5 alias sunset; use run send", the exact message at `:1777`).
- `application-semantics.mjs:742-787` — `OPERATION_ALIASES` canonical→legacy CLI rows (`view`, `list`,
  `member view|send|stop|interrupt`, `do`, `resume`, `retry`); `:751-754` `run.watch` carries
  `cli: null` (F-2).
- `baton.mjs:133` — the `cli_command_unavailable` → exit 2 mapping.
- `CLI.md:48 / :137-138` — the bare `run OBJECTIVE` form documented co-equal with `run start`.
- `CLI.md:35 / :51` — `run.list` served (via canonical) vs `run.watch` advertised-but-dead (F-2).
- `docs/36-unified-control-grammar.md:80-84` — F8 start-verb fan-out (bare `run` is a documented
  start spelling).
- `phase68-unified-agent-entrypoint.test.mjs:51-56` — the green objective-first pin (read `:1-90`).
- `harvest-accessor-red.test.mjs:885-924` — the red `run.resultpin` stage and the `:909-915` comment
  naming the bare two-token form "today's run-start objective shorthand" with unspecified fate.
- `docs/reference/evidence/control-surface-audit-2026-08-13/surface-audit-cli.md` §3 E-1, §6 F-1, §6
  F-8 — the audit finding this contract implements and the exit-code taxonomy note.
- `docs/reference/evidence/control-surface-audit-2026-08-13/surface-audit-cli.md:161` — the audit's
  E-5 row judging the `waves` refusal deficient (no next action; omits send/stop).
- `docs/reference/evidence/control-surface-audit-2026-08-13/surface-audit-cli.md:173-176` — the sweep
  verdict naming E-6 / E-7 as the two model refusal sites.
- `docs/reference/evidence/control-surface-audit-2026-08-13/surface-audit-cli.md:258` — F-1: "A
  connected orchestrator typo (`run shwo`, `run steek`) launches a real Run" — the audit's second
  headline example, closed by fold B2.

Line numbers were checked once on read and once before this write. Sorted-key literals appear in
ACTUAL code-unit order where any appear; `localeCompare` is banned and appears nowhere here.

---

## Fold record

- **Date:** 2026-08-13.
- **Red-team:** `docs/reference/evidence/cli-silent-start-2026-08-13/redteam-155.md` (verdict NOT
  FOLD-READY; 4 numbered blockers B1-B4 + 5 non-blocking minors M1-M5).
- **QA:** `docs/reference/evidence/review-foundry-2026-08-13/review-qa.md` §1 (verdict NOT
  FOLD-READY; §1.5 fold instruction set — six items, all applied). The four row-report blockers are
  preconditions, per §1.5's preamble.
- **Version:** v1.0 DRAFT → v1.1 FOLDED.
- **Verification HEAD:** `e371f70` (this worktree's git HEAD; the v1.0 draft's `7bcca96` is absent —
  M5).

Blocker / amendment → resolution (every item FOLDED — none STRUCK, none ESCALATED; no
top-orchestrator decision was quoted for this row — the QA's DR-1/2/3, §5, belong to rows #164/#161):

- **B1** (§1.2 misattributes the audit's model-refusal verdict to E-5) → **FOLDED** — §1.2 re-anchored
  on E-6 (`application-cli.mjs:1307-1310`) / E-7 (`:1314-1322`), the audit's two model sites per the
  sweep verdict (`surface-audit-cli.md:173-176`); E-5's deficiency (`surface-audit-cli.md:161`) stated
  honestly; the "verified model refusal (E-5)" claim struck.
- **B2** (D2/D3 — distance-1 typos of `follow`/`steer`/`member` silently start; `run steek` is the
  audit's F-1 second headline) → **FOLDED** — D2 rule 3 detection extended to the full
  `RUN_RECOGNIZED_FIRST_TOKENS` set with distinct handling (existing messages for follow/steer, rule-2
  routing for member, never suggesting a dead verb); D3's residual disclosure expanded to name the
  `steek`/`follw`/`membr` class; PT-2 pins the three refusals.
- **B3** (D3/PT-2 — "Levenshtein ≤ 1" self-contradictory; fails PT-2's three transpositions) →
  **FOLDED** — D3 and PT-2 pin **Damerau–Levenshtein ≤ 1** (adjacent transposition = 1); `shwo`/`sned`/
  `viwe` pinned as transpositions so plain Levenshtein cannot pass.
- **B4** (D1/PT-4 — "derived at runtime, never a hand list" un-implementable; PT-2/3/5
  shallow-greenable) → **FOLDED** — D1 pins the named derivation symbol
  `RUN_RECOGNIZED_FIRST_TOKENS = [...lifecycleActions, ...FACADE_NOUNS, 'start', 'follow'] ∪
  ALIAS_FIRST_TOKENS`; PT-4 redefined as a precise source-scan (a-e); PT-2 expanded into a generated
  Damerau-distance-1 sweep.
- **QA §1.5 instruction 1 (B1)** → FOLDED (see B1).
- **QA §1.5 instruction 2 (B2)** → FOLDED (see B2).
- **QA §1.5 instruction 3 (B3)** → FOLDED (see B3).
- **QA §1.5 instruction 4 (B4)** → FOLDED (see B4).
- **QA §1.5 instruction 5 (ship the sound remainder)** → **FOLDED** — refusal vocabulary, the four-way
  rule's rules 1/4, exit-code bucket 2, and PT-1/6/7/8/9/10 shipped byte-stable as written.
- **QA §1.5 instruction 6 (keep coordinator amendments H1/H2)** → **FOLDED** — H1 (one named
  `FACADE_NOUNS` constant, source-scan-pinned) and H2 (`run member <unknown-sub>` non-goal line)
  folded into B4/M3 (§D1, D2 rule 2, PT-4(a), PT-5, §5 non-goals).
- **H1 (coordinator amendment — facade-noun constant)** → **FOLDED** — `FACADE_NOUNS` named as one
  constant and pinned by a #159-style derived source-scan against the run-branch facade dispatch
  labels (D1, PT-4(a)).
- **H2 (coordinator amendment — `run member <unknown-sub>` non-goal)** → **FOLDED** — rule 2 extended
  to refuse the unknown-sub form (M3), and the residual named in §5 non-goals.
- **M1** (`review` calls `parseReviewStart`, not `parseStart`) → **FOLDED** — §5 non-goals and §8
  corrected (`application-cli.mjs:1295` / `:1130`).
- **M2** (exit-code framing — connected case is exit 0→2) → **FOLDED** — §1.5 and D1's exit-code
  paragraph state the connected-case 0→2 improvement and the disconnected-case 2-either-way no-regression.
- **M3** (`run member foo` unpinned) → **FOLDED** — D2 rule 2 and PT-5 extend to the unknown-sub form.
- **M4** ("byte-style mirror" = message, not code) → **FOLDED** — D2 rule 2 scopes the mirror claim to
  message text; both codes exit 2.
- **M5** (verification HEAD `7bcca96` absent from this repo) → **FOLDED** — header, §8, and this
  record cite the actual snapshot HEAD `e371f70`.

No blocker was STRUCK or ESCALATED; every item above changed the contract text (FOLDED) or was already
sound and shipped as written (QA instruction 5).
