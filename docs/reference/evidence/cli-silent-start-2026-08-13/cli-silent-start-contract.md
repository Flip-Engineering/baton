# Kill the CLI silent reinterpretation — unknown `run <verb>` must not start a Run — implementation contract (#155)

**v1.0 DRAFT.** Ring-2 contract form. **Verification HEAD:** `7bcca960db181d7b0fb57f61f558470a0c1bc4e8`
(the swept effective-tree snapshot; this worktree's `impl/src` is that tree). Every `file:line`
citation below was read this session against that HEAD with the Read tool / `grep -an`. No clocks.
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

## 1. Ground truth (all verified this session at HEAD `7bcca96`)

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
  `:1421-1423` (`cli_command_unavailable`, "not shipped by the Run application"); `steer` passes
  `:1578` (it is in the lifecycle set) and refuses downstream at `:1775-1779` (`cli_command_unavailable`,
  "deleted at the M5 alias sunset; use run send"). They are verb *positions* (consumed as verbs, never
  reinterpreted as objectives) but they are not verbs an operator can *use* — §D1 excludes them from
  the taught live set and from the typo-suggestion set (suggesting a dead verb would be a #136 dead
  end).
- **The terminal fallback** past every lifecycle handler is `throw cliError(\`unknown run action
  ${action ?? ''}\`)` at `:1872` — unreachable today because `:1578` intercepts every non-member
  earlier; after this contract it stays as the defensive floor for any lifecycle verb whose handler is
  somehow bypassed (it is not the teaching surface).

### 1.2 The model to mirror — the `waves` branch closed-set refusal

`application-cli.mjs:1383-1385`:

```js
if (action !== 'attach') {
  throw cliError('expected waves list, progress, start, attach, or run', 'cli_command_unavailable');
}
```

This is the audit's verified model refusal (§3 E-5, sweep verdict: the `cli_command_unavailable` +
closed-set + corrective-naming pattern is one of the two sites that pass the #41/#139 test). The
`run` branch's new refusal mirrors this exactly in *shape* — typed code `cli_command_unavailable`,
names the closed set, names the next action — with two honest deviations the contract pins (§D1):
(i) the `run` set is far larger than waves' five, so it is **derived from a single source of truth at
runtime**, never a second hand-list (the #103 compose-don't-duplicate law; and the D-1 anti-pattern —
doc truth and parser truth diverging silently — is exactly what a hand-list would reintroduce); and
(ii) the `run` first-token slot is structurally overloaded with the objective-first start form (§1.3),
so the refusal fires on a *subset* of unrecognized tokens (the verb-typo class), not on every
unrecognized token.

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
  `application-cli.mjs:1168`), so `member` reaches `:1578` unresolved and is silently reinterpreted as
  the objective "member" — audit D-3's second example. There is **no** `action === 'member'` branch
  anywhere in the `run` dispatch (verified: `grep -n "action === 'member'"` is empty). §D2 closes this
  with an incomplete-prefix refusal mirroring `attention`/`knowledge`.

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
2, but with a message that blames the connection. §D1 pins the new refusal to
`cli_command_unavailable` → 2: same bucket (no exit-code regression), correct message, fired at parse
time.

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

**The closed set, verified against the parser (not the doc).** The recognized `run` first-token set at
HEAD is, by derivation:

- the lifecycle set — 29 verbs at `application-cli.mjs:1574-1577`;
- plus the five facade nouns — `message` (`:1430`), `attention` (`:1456`), `scratchpad` (`:1476`),
  `board` (`:1513`), `knowledge` (`:1552`);
- plus `start` (`:1424`);
- plus the canonical alias first-tokens that resolve upstream — `view`, `list`, `member`
  (`application-semantics.mjs:743-774`, `application-cli.mjs:1163-1173`).

**The taught live set is the recognized set MINUS the refused-only positions** `follow`
(`application-cli.mjs:1421-1423`) and `steer` (`:1775-1779`) — they are verb positions the parser
consumes, but they are not verbs an operator can use, so the refusal neither names them as usable nor
suggests them (suggesting a dead verb is a #136 dead end). The taught live set is what the refusal
renders; it is computed from the derivation above, never handwritten.

**Parser-truth, not doc-truth.** `run watch` is advertised in CLI.md:51 but is NOT in the parser's
recognized set (`watch` has no `run`-branch handler and `run.watch`'s alias row carries `cli: null`,
`application-semantics.mjs:751-754`). The taught live set therefore **excludes `watch`** — including
it would reintroduce the D-1 doc-truth-≠-parser-truth lie. `watch`'s advertised-but-dead status is the
separate F-2 finding (§5, OQ-1); this contract neither fixes nor worsens it (`run watch` bare keeps
starting objective "watch" exactly as today — `watch` is not edit-distance-1 from any live verb).

**The refusal shape — targeted, code `cli_command_unavailable`.** The refusal is
`cli_command_unavailable` (the existing typed code; **no new code is minted**, so the F-8 taxonomy is
not disturbed), and it is **targeted, not a wall**: because `run` is objective-first (§1.3), the
refusal fires *only* where there is positive evidence the token belongs in verb position — the
unambiguous-typo class (D2 rule 3) and the bare-`member` prefix class (D2 rule 2). Every other
unrecognized token is a genuine objective and starts a Run (rule 4); a generic "here are all 35 verbs"
wall would fire on legitimate objectives and is therefore rejected. This is the honest reason the
`waves` mirror (§1.2) is adapted rather than copied literally: `waves` has no objective-first form, so
*every* unknown waves-token gets its five-verb wall; `run` cannot, so its refusal is scoped to the
typo/prefix class and names the closed set *inside* the targeted message. Each refusal names the class
("not a run verb"), the relevant closed subset, and the next action:

- *Typo-suggestion message* (rule 3): `run <T> is not a run verb; did you mean 'run <V>'? To start a
  run with '<T>' as the objective, use 'run start <T>'.` — names the single suggested verb `<V>` and
  the `run start` escape. (The taught live set, computed from the §D1 derivation and grouped compactly
  by lane — begin / read / steer / lifecycle / facade — may follow in parentheses; it is rendered from
  the runtime derivation, never a hand-list, so it satisfies "naming the closed set" without the D-1
  drift hazard.)
- *Prefix message* (rule 2): `expected run member view, send, stop, or interrupt` — names the member
  subverbs, mirroring `attention` (`:1457`) and `knowledge` (`:1553`) byte-style.

**The exit code — bucket 2, consistent.** `cli_command_unavailable` → exit 2
(`baton.mjs:133`). This is the same bucket the typo-path already lands in (today via the later
`cli_config_invalid` connection error, also → 2), so there is **no exit-code regression**, and it is
the bucket F-8 recommends for all `cli_*` refusals. The improvement is not the code (2 either way) but
the *site and message*: the refusal now fires at **parse time** with "not a run verb" instead of at
connection time with "connection profile unavailable" (PT-6, PT-8).

### D2 — The line between verb position and objective text

The first token after `run` is decided by a four-way rule, evaluated in order; the first match wins:

1. **Exact verb → dispatch.** The token exactly matches a recognized first-token (after canonical
   resolution). It is dispatched to that verb byte-identically to today. This covers every lifecycle
   verb, every facade noun, `start`, and the canonical spellings `view` / `list` / `run member <sub>`.
2. **Incomplete canonical prefix → refuse naming the subverbs.** The token is `member` with no
   sub-verb (bare `run member`, which canonical resolution does not expand,
   `application-cli.mjs:1168`). Refuse `cli_command_unavailable`: `expected run member view, send,
   stop, or interrupt` — mirroring `attention` (`:1457`, `expected attention watch`) and `knowledge`
   (`:1553`, `expected knowledge seed`) byte-style. This closes audit D-3's `run member` (bare)
   silent-start. (The other facade nouns already refuse when bare, though some leak `undefined` —
   `message` `:1454`, `scratchpad` `:1511`, `board` `:1550`; that `undefined` leak is the separate F-9
   finding, §5, and is not worsened here.)
3. **Verb typo (edit-distance-1) → refuse + suggest.** The token is NOT an exact match and is
   edit-distance-1 from exactly one taught-live verb (D3). Refuse `cli_command_unavailable` with the
   suggestion and the `run start` escape. **This is the kill:** `run shwo` no longer starts a Run. The
   guard compares against the taught-live set (lifecycle − {steer}, facade nouns, `start`, `view`,
   `list`; `member` excluded — it is a prefix, handled by rule 2).
4. **Otherwise → objective-first (byte-identical).** The token is not an exact verb, not the `member`
   prefix, and not edit-distance-1 from any live verb. It is the objective: `parseStart(args, action,
   idempotencyKey)` (`application-cli.mjs:1578`'s call, unchanged) compiles `run.start`
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
- every lifecycle verb and facade noun at its documented spelling.

The ONE behavioral change is: an unrecognized first token that is edit-distance-1 from a live verb, or
the bare `member` prefix, now refuses instead of starting a Run. Every other `run` invocation is
byte-identical.

### D3 — The teaching half: closed set + nearest suggestion (edit-distance-1, never a guess)

The suggestion half is **implemented, not deferred** (the brief permits either; the typo class is the
issue's headline, so the suggestion carries it).

- **Edit-distance-1 only.** Levenshtein distance ≤ 1 (single-character substitution / insertion /
  deletion; transposition counts as distance 1). This is the principled threshold: it captures the
  overwhelming majority of real keystroke typos (`shwo`←`show`, `sned`←`send`, `viwe`←`view`,
  `attenton`←`attention`) without a heuristic "fuzzy" guess.
- **Never a guess.** A suggestion is offered **only when exactly one** taught-live verb is within
  distance 1. Zero matches → the token is not verb-shaped; objective-first applies (D2 rule 4) and the
  token starts a Run — there is no refusal and no suggestion, because the parser has no basis to call
  it a verb. Two-or-more matches → objective-first applies as well (ambiguous; the parser never guesses
  between candidates). The refusal therefore catches *only* the exactly-one case (plus the `member`
  prefix, D2 rule 2).
- **Always paired with the escape.** Every refusal ends with the next action `run start OBJECTIVE`, so
  an operator whose token was a genuine objective recovers in one retyped command (the #136 law).
  (Genuine objectives that reach rule 4 never see a refusal — they start, byte-identically to §1.3.)

**The residual, stated honestly.** The typo-guard refuses only when the token is distance-1 from
*exactly one* live verb. A token distance-1 from zero verbs, or from two+, and any distance-≥2 typo,
falls to objective-first (rule 4) and starts a Run. This is the deliberate, named cost of preserving
the pinned objective-first design (OQ-2): a distance-≥2 typo (e.g. `shpw` for `show`) or a non-verb
single token still starts via objective-first. The contract kills the distance-1 class (the realistic
single-keystroke typo mechanism — `shwo`, `sned`, `viwe`, `attenton`) and names the residual honestly
rather than pretending to a full kill, which would require removing objective-first (§1.3) and is
rejected (§5, OQ-2).

---

## 5. Refusal vocabulary, non-goals, and open questions

**Refusal vocabulary (closed).** This contract adds ONE new refusal *site* (the `run`-branch
typo-guard at the site of `application-cli.mjs:1578`) and ONE adjacent site (the bare-`member`
incomplete-prefix refusal). Both reuse the **existing** typed code `cli_command_unavailable` — **no
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
- **Top-level `explore` / `review`.** These call `parseStart` directly (`application-cli.mjs:1293-1299`),
  not via the `run` branch; they are objective-first by construction and are not touched.

**Open questions.**

- **OQ-1 (watch).** Should a later hardening refuse `run watch` by teaching the parser the dead verb
  with an F-2 redirect? Yes — but as part of the F-2 fix, not #155. This contract leaves `run watch`
  exactly as today.
- **OQ-2 (the residual).** Distance-≥2 typos and non-verb single tokens still start Runs via
  objective-first. This is the accepted cost of preserving the pinned objective-first design; `run
  start` is the unambiguous escape. A future "full kill" would require deprecating the bare form
  (breaking §1.3) and is out of scope.
- **OQ-3 (false-positive trade-off).** A legitimate single-token objective that happens to be
  edit-distance-1 from exactly one live verb (e.g. an objective `stops`, distance-1 from `stop`) is
  refused. Accepted: such collisions are rare, fully recoverable via `run start <token>`, and the
  asymmetry of harm (a refused start is retyped in one command; a silent typo-start costs real
  provider spend and cleanup) overwhelmingly favors refusing. Multi-word / descriptive objectives
  (the common case — `Improve Baton`, `Ship it`) are never distance-1 from a verb and are unaffected.

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
- **PT-2 (typo-guard kills the silent start).** `parseBatonCli(['run', 'shwo'])` THROWS with
  `error.code === 'cli_command_unavailable'`, a message matching `/did you mean 'run show'/u` and the
  `run start` escape, and does NOT return a `run.start`. Same for `['run','sned']`→`send`,
  `['run','viwe']`→`view`, `['run','attenton']`→`attention watch`. (The audit's headline example.)
- **PT-3 (never a guess).** A token edit-distance-1 from **zero** live verbs (e.g. `'deploy'`,
  `'refactor'`) falls through to `run.start` (objective-first) with no suggestion and no refusal. A
  token edit-distance-1 from **two or more** live verbs (a constructed fixture) also falls through to
  `run.start` (objective-first) — the parser never guesses between candidates. The refusal + suggestion
  appear only for the
  exactly-one case.
- **PT-4 (closed set derived, no drift).** A source-scan proves the refusal's verb list is computed
  from the recognized-first-token derivation (§D1), not a second hand-kept literal; the rendered set
  EXCLUDES `watch` (parser-absent, F-2) and EXCLUDES the refused-only `follow`/`steer` from the usable
  set; the refusal is fired only from the `run` branch at the `:1578` site (and the bare-`member`
  prefix site), nowhere else; no new `cli_*` code is minted.
- **PT-5 (bare `member` incomplete-prefix).** `parseBatonCli(['run', 'member'])` THROWS
  `cli_command_unavailable` with a message naming `member view`, `send`, `stop`, and `interrupt`, and
  does NOT return a `run.start`. (Closes audit D-3's `run member` bare silent-start.)
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
load-bearing regression guards for §1.3 and PT-7). The deliverable for THIS contract is the contract
file only (`docs/reference/evidence/cli-silent-start-2026-08-13/cli-silent-start-contract.md`); the
code, tests, and any CLI.md wording adjustment land in the implementation ring that consumes this
contract.

---

## 8. Citation verification

Every citation was read this session at HEAD `7bcca960db181d7b0fb57f61f558470a0c1bc4e8` (this
worktree's effective tree). All cited sources are plain UTF-8; no NUL-bearing file is cited.

- `application-cli.mjs:1578` — the fall-through into `parseStart` (read in full context `:1540-1873`).
- `application-cli.mjs:1574-1577` — the `lifecycleActions` set (29 verbs, enumerated and counted).
- `application-cli.mjs:1383-1385` — the `waves` closed-set refusal (the model to mirror).
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
- `application-cli.mjs:1293-1299` — `explore`/`review` call `parseStart` directly (out of scope).
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

Line numbers were checked once on read and once before this write. Sorted-key literals appear in
ACTUAL code-unit order where any appear; `localeCompare` is banned and appears nowhere here.
