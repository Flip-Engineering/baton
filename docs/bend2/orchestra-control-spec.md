# Native Orchestra control — implementation specification

Status: draft for root review. Implements `docs/bend2/orchestra-control-feature.md`
(commit `c8b5057d`). Baseline under audit: `6929bffeeac32514968dd3d104dd7503eec1fba5`,
installed release `1.1.0-fca7af876c8260c32d17f95f3e19bc68ee1bf561`. No runtime change
is authorized by this document until root accepts it after independent Ensemble
criticism.

This specification defines the surface conventions for native help, MCP tool
descriptions, harness briefing and readable inspection. The semantic-context
specification (`semantic-lead`) cites these conventions for its context commands,
MCP tools and briefing lines; it does not define parallel formats.

File ownership is explicit: `docs/bend2/orchestra-control-spec.md` (this file) is
authored and owned by `semantic-controls`. `docs/bend2/semantic-context-spec.md`
is owned by `semantic-lead`. The two feature documents
(`docs/bend2/semantic-context-feature.md`, `docs/bend2/orchestra-control-feature.md`)
are owned by root. No other file is shared between the two specifications; a
change to a shared surface convention lands here first and is cited by the
semantic-context specification.

## 1. Stored model — unchanged

The specification reuses the current records and adds no new persistent state:

- Sessions: recorded `parent`, `harness`, `model`, `effort`, `workspace`, `branch`,
  `base`, endpoint. Public role derives from the stored conductor role and
  parentage (`commands.bend:106-122`).
- Ensembles: `id`, `owner` (a session with the conductor role), `coupling`
  (`loose` or `tight`), members.
- Sections: `ensemble`, `id`, `capability`, members. Section membership requires
  Ensemble membership through the existing foreign key
  (`commands.bend:73-75`, `section_member_admitted`).
- Messaging admission: Conductor to descendants, report/ask to the immediate
  parent, peer messages only inside a shared tight Ensemble with equal Conductor
  depth (`commands.bend:190-210`).

Every view, briefing and help text in this specification is derived from these
records at read time. Selection and formatting grant no authority and mutate no
state.

## 2. Evidence summary

Evidence lives under
`/Users/wahargis/Development/Experiments/baton-bend2-root-delivery-20260928/.scratch/semantic-context-20261005/`
in `research/` (consolidated reports) and `evidence/semantic-controls-structure-research/`
and `reviews/semantic-controls-interfaces-evidence/` (raw probe output). Principal
observations, each verified against source and the installed binary:

1. `usage()` (`main.bend:79-80`) is one flat positional catalogue. Every `--help`
   invocation prints the identical text. No command help, ordering rules or
   construction sequence exists.
2. `orchestra` / `players` embed each Player's latest report body
   (`players_json`, `commands.bend:266`). Measured on the run database: `players`
   132,633 bytes of which 94,027 are report bodies; `orchestra --pretty`
   160,897 bytes, 1,493 lines. Relationships are complete but split across the
   `players` and `ensembles` arrays; membership, Conductor depth and permitted
   routes require manual joins.
3. Ensemble/Section setup failures return a generic empty-result refusal
   (`main.bend:23`), except Sections which already return a structured refusal
   (`section_refusal`, `commands.bend:249`). A conflicting Ensemble owner returns
   raw SQLite text (`NOT NULL constraint failed: ensembles.id`, exit 19).
4. The 3-token form `ensemble ID OWNER` is a write that re-declares loose
   coupling on an existing Ensemble (`commands.bend:364`), silently revoking the
   peer route of a tight Ensemble. Documented in `docs/bend2/messaging.md`; not
   stated in help.
5. The receive briefing (`receive.bend:27-44`) states role vocabulary and routing
   rules generically; it names no recorded parent, Ensemble, Section or
   session-specific route, and omits `delivery`, `report` and `ask` from its
   command list.
6. Dispatch-turn harnesses receive no briefing: `turn.bend` reads only the task
   file and the Muse harness passes it verbatim as `--prompt-file`
   (`turn.bend:373-380`, `muse-player.bend:4-8`). Receive sessions get
   `instructions()` prepended (`receive.bend:205`).
7. `message`/`message-file`/`report`/`ask` commit through `Store.apply` and then
   run the recipient endpoint synchronously (`store.bend:7-34`,
   `delivery.bend:27-32,82-87`); the invoking CLI can remain attached through the
   recipient's receive lifetime. `dispatch-file` launches a detached process and
   returns `{deliveryPid, state:"launched"}` immediately (`control.bend:149-166`,
   `host/control.c:119-149,218-225`). MCP `baton2_guide` calls the synchronous
   `message` path via `execFileSync` (`mcp-conductor.mjs:111-122,537-539`).
8. MCP tool descriptions (`mcp-conductor.mjs:124-323`) are one sentence each and
   omit ordering constraints, defaults and next operations. The advertised tool
   list has no `baton2_delivery`, so an acknowledged message body is not
   retrievable over MCP.

## 3. Surface conventions

These conventions are defined once here. Every native command, MCP tool and
briefing block follows them, including the semantic-context surface.

### 3.1 Help organization

- `baton2 DATABASE help` prints the flat usage catalogue followed by the list of
  help topics. This remains the complete command list.
- `baton2 DATABASE help COMMAND` prints one paragraph for that command: argument
  meanings, admission preconditions, defaults, the refusal conditions with their
  `condition`/`next` text, and the valid next operation when setup is incomplete.
  The paragraph is generated from the same strings the refusal rows use, so help
  and runtime behavior cannot diverge.
- `help team` prints the worked construction sequence (section 4.1) using the
  real commands. Bare `--help` anywhere prints the catalogue plus a pointer to
  `help team` and `help COMMAND`.
- An unrecognized command keeps exiting 2 with the usage text.

### 3.2 Refusal shape

Every refused setup or messaging operation returns one JSON object:

```
{"error": "<stable-code>", "command": <echoed arguments>,
 "condition": "<the failed prerequisite, naming the missing or conflicting record>",
 "next": "<the reader command and the permitted next operation>"}
```

`section-refused` (`commands.bend:249`) is the existing instance and its shape is
the template. The shape extends to `ensemble`, `ensemble-member`, `role` (already
`invalid-role`), message routing (already `message-route-denied`) and endpoint
operations (already `invalid-endpoint`). New codes: `ensemble-refused`,
`ensemble-member-refused`. No exit path returns raw SQLite error text; the
owner-conflict clause in `ensemble_sql` (`commands.bend:234`) is replaced by an
explicit admission check that refuses with the stored owner named. Admission
predicates and accepted transitions do not change.

### 3.3 Readable and structured inspection

- `orchestra` and `orchestra --pretty` keep one JSON object with `players`,
  `operators`, `ensembles`. Each Player row gains `ensembles` (Ensemble IDs),
  `sections` (Ensemble/Section pairs) and `depth` (parent-chain length), all
  derived joins. Each Ensemble member entry gains the member's public `role`.
  Player rows in `orchestra` carry `latestReportId` and drop the embedded
  `latestReport` body; the body remains retrievable in full through
  `delivery MESSAGE_ID`, `player ID --pretty`, `players` and `turns PLAYER_ID`.
  `players` keeps `latestReport` unchanged, matching the existing `usage()` text.
- `orchestra --for SESSION` returns a focused structured projection:
  `version`, `subject`, `ancestors`, `players`, `ensembles`, `routes`, `pending`,
  `selection`, `limitations`. Selection is explicit: the subject, its ancestors,
  its descendants, Ensembles owned by any included session, Ensembles the subject
  belongs to, and the members of those Ensembles. Members included only as
  references are marked as references. Every selected record is rendered,
  including empty Sections, unassigned Players, stopped sessions and sessions
  with no endpoint. There is no top-N summary, count cap or hidden historical
  filter; `selection` records the rule applied.
- `routes` is derived by applying the existing messaging admission predicates
  (`commands.bend:190-210`) between the subject and each returned session. Each
  route names its category (descendant, parent, tight peer) and the Ensemble
  where applicable. A route displayed in a view grants no authority; admission is
  re-evaluated from current records at send time.
- `orchestra --view [SESSION]` renders the same facts as an indented readable
  tree: Principal, each Associate Conductor under its Conductor, each owned
  Ensemble with coupling, each Section with capability, each member. A member
  whose recorded parent is outside the rendered branch is labelled with its
  parent in place; the renderer never reparents records. The readable form and
  the structured form are generated from the same projection, so they agree by
  construction.
- MCP `baton2_orchestra` gains optional `session` and `view: "json"|"readable"`
  parameters mapping to `--for` and `--view`. With no arguments it returns the
  current structured form. MCP adds `baton2_delivery` with required `id`,
  returning exactly what CLI `delivery ID` returns, including acknowledged
  messages.

### 3.4 MCP tool description format

Each MCP tool description has four parts, in order: the operation in one
sentence; the admission preconditions; the defaults applied when optional
arguments are omitted (for example, mutation ownership defaults to the attached
session and coupling defaults to loose, `mcp-conductor.mjs:510-523`); and the
next operation when a prerequisite fails. Schema fields carry the same defaults
and constraints in their `description` properties, including invalid
combinations (Section `capability` without `owner` configures with the attached
owner; `owner` without `capability` is invalid). Initialization instructions
state the attaching session's recorded role, parentage, Ensemble ownership and
membership, and that attachment assigns a Conductor role
(`mcp-conductor.mjs:391-444`).

### 3.5 Briefing layout

One native orientation function generates the briefing from stored records. It is
used by every entry path (section 5). Layout, in order:

1. Identity: session ID, public role, immediate Conductor, harness, model,
   workspace, branch.
2. Responsibility: one sentence derived from role (Player executes and reports;
   Associate Conductor coordinates its descendants; Principal coordinates the
   Orchestra).
3. Membership: owned Ensembles with coupling, member Ensembles, Sections with
   capabilities.
4. Permitted routes: derived from the admission predicates as in section 3.3,
   naming concrete session IDs where the set is small, and the rule otherwise.
5. Completion semantics: the delivery behavior of `dispatch-file`,
   `dispatch-turn`, `message`/`message-file`/`report`/`ask` (section 6), and how
   to inspect completion (`turns`, `inbox`, `delivery`, output logs).
6. Command list: the coordinator CLI lines, now including `delivery ID`,
   `report`, `ask`, `orchestra --for`, `orchestra --view` and `help` topics.
7. Harness note: for sessions running under an OMP shell, coordinator CLI calls
   and other work whose completion depends on another session run with the shell
   timeout disabled (`timeout: 0`), because a `message`/`report` call can remain
   attached through the recipient's receive lifetime and the harness default
   kills background jobs at 300 seconds. This is invocation guidance for one
   supported harness; Baton itself imposes no time cutoff.

A briefing describes recorded facts at generation time. It grants no authority
and can become stale; admission always re-evaluates current records.

## 4. Construction and setup semantics

### 4.1 Construction sequence (published in `help team` and the briefing)

Per Associate Conductor: `recruit`, then `role ID associate-conductor`, then
`ensemble ID OWNER COUPLING` for each owned Ensemble. Per Player: `recruit`,
then `ensemble-member ENSEMBLE OWNER PLAYER add`, then `section-member ENSEMBLE
SECTION OWNER PLAYER add`. Endpoint registration (`receiver` or `attach`/
`connect`) precedes receive-based dispatch. Independent branches proceed
concurrently. Coupling is always shown explicitly in examples.

### 4.2 Setup operation rules

- Newly created Ensembles default to loose coupling: the 3-token form
  `ensemble ID OWNER` on a new Ensemble keeps its documented creation default
  and its law (`messaging-laws.bend:36-41` pins the creation parse). Omitting
  the coupling on an existing Ensemble is an explicit read: the call returns the
  stored row unchanged and never alters coupling, so a tight declaration keeps
  its peer route until coupling is named explicitly. Coupling updates only
  through the 4-token form `ensemble ID OWNER loose|tight`. This resolves the
  silent tight-to-loose downgrade (evidence item 4); `help ensemble` states the
  rule.
- A conflicting owner refuses with `ensemble-refused`, naming the stored owner
  and the retained declaration. The raw SQLite constraint path is removed.
- `ensemble-member` failures (unknown Ensemble, non-conductor owner,
  unregistered or operator session) return `ensemble-member-refused` with the
  missing record named. `remove` of a non-member stays idempotent and reports
  `membership:"remove"`; the `condition`/`next` fields are absent on success.
- Removing Ensemble membership continues to cascade Section membership in that
  Ensemble (`commands.bend:75`, `PRAGMA foreign_keys=ON`); the cascade is stated
  in `help ensemble-member`.
- Conflicting recruitment never overwrites a recorded assignment; an exact retry
  returns the existing assignment (current behavior, preserved).

## 5. Briefing parity across entry paths

The orientation function (section 3.5) is applied once per native turn on every
entry path:

- Receive sessions: `receive.bend` prepends the generated orientation to the
  delivered body, replacing the current static `instructions()` text.
- Dispatch-turn sessions: `turn.bend` prepends the same generated orientation to
  the prompt, including the Muse/Claude path where the task file is passed as
  `--prompt-file`. The authored task body is preserved verbatim after the
  orientation block. The actual dispatched prompt is retained and inspectable.
- Resume and fresh-recovery paths regenerate the orientation from current
  records.

No per-harness wrapper is introduced; orientation is generated in the
coordinator before the harness is invoked.

## 6. Delivery completion semantics

Completion behavior is taught explicitly in help and briefing, and dispatch
results state what they prove:

- `dispatch-file` and the new inline form `dispatch ID SENDER RECIPIENT KIND
  BODY` commit the message through the existing admission path
  (`control.bend:149-166`), launch a detached delivery process and return an
  additive result: `id`, `sender`, `recipient`, `kind`, `committed`,
  `deliveryPid`, `state`, and `read` naming the retrieval commands
  (`delivery`, `inbox`, `turns`). `committed` is true only when the message row
  was stored before launch. A launch error after commit names the retained
  message ID and its recovery operation.
- `dispatch-turn` returns `player`, `turnId`, the assigned route, `deliveryPid`,
  `state`, output log path and the lookup commands for the turn and its report.
  A launched turn is not claimed as a committed task message.
- `message`, `message-file`, `report` and `ask` keep their current behavior:
  commit through `Store.apply`, then run the recipient endpoint synchronously
  (`delivery.bend:27-32,82-87`). Help and briefing state that the command can
  remain attached through the recipient's receive lifetime, that a committed
  message is durable independent of endpoint outcome, and that endpoint success
  and recipient review are separate facts.
- MCP `baton2_guide` calls the detached dispatch operation with `kind=guidance`
  and returns the launch result, replacing the synchronous `execFileSync`
  `message` call (`mcp-conductor.mjs:537-539`).
- For a dispatch-turn Player, inspection states whether a registered endpoint
  can accept input during the turn. Where no such route exists, the view
  identifies the incomplete route and the supported continuation action
  (message retained for the next turn boundary). A successful message commit is
  never presented as live steering.

No new scheduling, parking or wake mechanism is introduced. Turn end continues
to wake the immediate Conductor with the report.

## 7. Operative laws and acceptance

### 7.1 Laws

New and changed real functions — the parse variants, the membership/depth joins,
the focused projection, the readable renderer, the orientation function, the
detached dispatch result — carry operative laws in the existing law modules
(`messaging-laws.bend`, `control-laws.bend`, receive laws), imported into the
entry's law gate. Required properties: projections resolve to stored facts;
formatting never mutates state; explicit selection is complete under its stated
rule; route facts use the actual admission predicates; a stale briefing grants
no capability; inline, file and MCP guidance share admission and stored-body
semantics; a denied input launches nothing; full retrieval preserves
acknowledged bodies; both entry paths prepend the same orientation and preserve
the task body. Build and proof use the pinned compiler
(`/Users/wahargis/Development/Experiments/baton-bend2-root-delivery-20260928/.scratch/native-artifact-qualification-20261002T174637Z/toolchain-home/bin/bend`,
2.0.25) through `bend2/scripts/build-native.sh` and `bend2/scripts/laws-check.mjs`.

Existing test contracts to preserve and extend: `bend2/test/naming.py`,
`messaging.py`, `control.py` (detached guidance at 361, overlapping Players at
386, direct-turn assignment at 452, complete pretty JSON at 476),
`mcp-command.py`, `mcp-contract.py` (CLI/MCP field parity), `mcp-root.py`,
`receive.py`, `native-cli.py`. Tests assert record and message facts against an
independently stated expected topology and expected actions, never source line
counts, topology totals, output sizes or golden prose.

Report-body growth is covered structurally: a fixture with multi-kilobyte
Unicode report bodies must produce identical structural fields (parentage,
ownership, coupling, membership, depth, routes) to the same fixture with empty
reports, and `delivery`/`turns`/`player` must still return the complete bodies.
No test asserts a byte bound or a report length.

Every changed or new behavior lands on CLI and MCP together with the same
admission rules and the same facts: the refusal shape, the focused and readable
`orchestra` forms, the detached guidance dispatch, `baton2_delivery`, and the
briefing content. `mcp-contract.py`-style parity checks extend to these.

### 7.2 Qualification split

Admission behavior is qualified on a controlled fixture: a scratch database copy
with attached empty-endpoint sessions exercises accepted and refused routes,
setup ordering, retry and conflict behavior without live harnesses. A fixture
qualifies admission only.

Native use is qualified by an installed cold-agent run: an agent with only the
installed tooling and its generated briefing constructs a Principal's direct
Ensemble plus two Associate Conductors (one nested under the other), each owning
an Ensemble with two capability Sections and multiple Players, including a
critic Ensemble. The run demonstrates concurrent dispatch, scoped tight-Ensemble
peer messages, loose-peer and unequal-depth refusals, parent reports,
acknowledgment with full report retrieval, inspection that identifies ownership
and cross-parent membership, and reviewed landing of an approved change into an
external fixture repository. A Muse dispatch-turn Player's delivered prompt is
shown to contain the generated orientation without Conductor-authored additions.
Readable and structured views are compared against stored records, including
incomplete setup and retained historical sessions. An independent critic
evaluates whether the agent could complete the task without private
instructions. The run uses the installed package in an isolated qualification
path; no manual command recipe is supplied.

## 8. Decisions taken in this specification

1. `orchestra` Player rows drop the embedded `latestReport` body and keep
   `latestReportId`; `players` keeps the body (documented in `usage()`).
   Full retrieval is unchanged through `delivery`, `player` and `turns`.
2. Newly created Ensembles default to loose (unchanged, law-backed). Omitting
   coupling on an existing Ensemble is an explicit read of the stored row;
   coupling changes only through the explicit 4-token form.
3. The focused projection (`--for`) and readable tree (`--view`) are additive;
   no existing output field is removed except per decision 1.
4. MCP `baton2_guide` becomes detached dispatch; its result is a launch
   acknowledgment, and the description says so.
5. The OMP shell deadline is addressed as briefing invocation guidance
   (`timeout: 0`), not as a Baton runtime change.

## 9. Open items

- Direct-turn live steering (whether a Muse/Claude Player can accept input
  mid-turn through a registered endpoint) is traced only to the dispatch and
  briefing paths; it needs a host qualification before the interface advertises
  it.
- Whether `player ID --pretty` gains the same membership/depth fields as the
  `orchestra` Player row. Current position: yes, from the same projection.
- The semantic-context spec's exact command and tool names
  (`context-engines`, `context-query`, `context-query-file`,
  `baton2_context_engines`, `baton2_context_query`) will cite sections 3.1-3.5
  for their help, descriptions and briefing lines; final cross-references are
  added when those names stabilize.
