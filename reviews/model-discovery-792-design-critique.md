# #792 model-discovery design critique

Status: review record, 2026-10-17, seat accounts-glm, answering conductor
`message:accounts-wonder:b3018910c8fc19152902673239557695`. Subject: the "Model discovery for
#792" section added to `docs/bend2/account-credit-793-702.md` by `d33bc1f`. This is a
spec-level critique; no implementation exists. Grounded in issue #792's own problem statement,
the existing `usage.bend` read family, and this seat's earlier records.

**Verdict: the design is directionally right and its honesty rules are correct — per-source
unknown retention, Muse enumeration unknown, empty assessments with
`noRecordedAssessmentSource`, facts-only. Three gaps need spec text before implementation:
the answer must name its own enumeration basis (C1), account-only sources need a specified
answer shape (C2), and off-catalog harnesses such as claude-code need their explicit-unknown
behavior stated (C3). Two documentation defects (C5) should be fixed in the spec itself.**

## 1. Command-surface fit: fits, with three conditions

A new `models-all` read leaves `models --session` byte-identical, which is the right shape:
the existing read answers a registered session's harness and its failure conditions, and
nothing in #792 asks to change that contract. Conditions that keep the fit:

- The verb must be registered in the same places every read lives:
  `agent-domain.known`, the `names` option map, and `help`. The design is silent on wiring;
  the #792 failure report began with an agent reading `help models`, so the help entry is part
  of the feature, not plumbing.
- The read runs provider queries and is therefore an explicit read in the #694 sense:
  routine status and UI reads never invoke it. The design's "adds no admission or selection
  rule" covers decisions; add the sentence that the read runs only when invoked.
- "No new process type" is verified against the current code: the per-harness query family
  (`models_args`/`models_argv`) already spawns exactly the recorded command with
  `models --json` (codex, omp) or the Muse profile read. Reusing it is the whole point.

## 2. Secret-reference exclusion: right rule, one implementation trap

Excluding references from a conductor-facing discovery read is correct least-surface: a
reference is not a credential value (the confinement invariant bans values), but a model list
lands in transcripts where a reference adds nothing to read. The trap: the existing account
projection (`account_object_sql`) emits `secretRef`, and the natural implementation — joining
recorded accounts into the answer — would leak it by reuse. The spec should say the account
source uses its own narrower projection (label, provider, harness, funding route,
organization state), not the accounts-read object. The accounts read itself keeps `secretRef`;
that is correct there and must stay.

## 3. Enumeration source: sessions table is right; the gap is what the answer says about itself

Endpoints add nothing over the sessions table: the endpoint is a sessions column, and the
existing command derivation (`harness_command_sql`, the nine- and seventeen-element receiver
forms) already extracts commands from registered sessions' endpoints. Endpoint-derived
enumeration is a strict subset of sessions-table enumeration.

Accounts extend coverage to harnesses with no registered session, which is the case that
matters for #793 (an API-key account on claude-code with no claude session yet). But two
coverage facts remain, and #792's own acceptance language demands they be visible:

- **C1 — the answer must state its enumeration basis.** #792's failure was an agent mistaking
  a partial roster for the operator's options. A models-all answer built from
  sessions-plus-accounts is still partial: a harness the operator has configured but never
  recorded as a session or account stays invisible. The read cannot see what the database
  does not record, so the answer should carry its basis — per-source `sourceType`
  (`session` | `account`) and counts of each — so a reader sees the limit inside the answer
  rather than reconstructing it. This is the same provenance rule the credit pool follows.
- **C2 — account-only sources need a specified answer shape.** An account record carries no
  command and no workspace. When no session shares its harness, there is nothing to query;
  the spec should fix that source's answer as identity plus
  `state:"unknown", condition:"noRecordedHarnessCommand"` — the exact shape
  `provider_usage_absent` already uses — and state the dedup interaction: an account whose
  harness matches an already-queried (harness, command, workspace) contributes no second
  query and references the shared answer.
- **C3 — off-catalog harnesses.** `models_supported` is codex, omp, muse. A claude-code
  source — now a first-class source through accounts — must yield the existing
  `unsupportedHarness` unknown, never silence. Say it in the spec, because the natural
  implementation inherits it by accident and a future `models_supported` edit would silently
  change the answer's shape.

The operator's declared route list (`<db>.routes`, which already carries harness, model and
command) is the natural third source and would cover declared-but-never-recorded routes.
Adding it is not required for #792's minimum; the design should either include it or state
its absence as a limit. C1's basis fields make that limit visible either way.

## 4. Verified correct as designed

- Muse enumeration unknown per source: matches the measured Muse client behavior in #792
  (`model-profile show` resolves one identifier, existence unknown).
- `capabilityAssessments` empty with `noRecordedAssessmentSource`: correct. The legacy
  Artificial Analysis cache is stale from 2026-09-20 and a benchmark catalog is not
  configured availability — the design's own wording matches the issue's evidence, and a
  dated recorded source is the only path a future assessment may take.
- Per-source unknown retention with schema, time and cause: the #694 discipline, already
  implemented for the single-session read.
- One query per distinct (harness, command, workspace): right dedup key; workspace belongs in
  it because catalogs can differ per working directory. C6: when several sources share one
  query, the answer should mark the shared execution, so duplicated source entries are not
  misread as independent confirmations.
- Facts-only, no admission or selection rule: #598-safe.

## 5. Documentation defects in the spec text itself

- **C5:** the section cites
  `/run/baton2-native-homelab/.../repo/bend2/src/coordinator/usage.bend:466` — an absolute
  workstation path that leaks host layout into a checked-in document and breaks in every other
  checkout, and the line anchor points past the end of the file (the base copy is 460 lines).
  Cite the function (`models`, `models_command`) with a repo-relative link.
- The design says sources are "the recorded sessions and the recorded accounts" without saying
  the project database bounds them; one sentence naming the project scope prevents the next
  reader from expecting a machine-wide view.

## 6. Related confirmation

`06c67c1` implements this seat's R1 follow-up exactly: the pool conflict count now scopes to
`cycle = r.cycle`, so a cross-cycle refresh no longer flags a conflict. The readings list still
omits the cycle and observing account; harmless while conflicts never gate, kept on the
follow-up list.

## Boundary

Spec-level critique of `d33bc1f`; the assigned implementation (accounts-deepseek dispatch
`f4aef729`, stalled) does not exist to review. No build or run has occurred for any of this;
the remote bundle's outcome remains the first evaluator word on everything it covers.
