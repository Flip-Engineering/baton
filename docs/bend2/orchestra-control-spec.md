# Native Orchestra control — implementation specification

Status: successor draft for root review, consolidating root review
`semantic-root-controls-review-2`, root's M-12 delivery decision, root's
structure-critic decisions, and five independent verdicts from the
`semantic-critical-review` Ensemble (fidelity-critic, fidelity-research,
acceptance-critic, acceptance-research, architecture-critic; each verdict is
its author's own). Implements `docs/bend2/orchestra-control-feature.md`
(commit `c8b5057d`). Baseline under audit:
`6929bffeeac32514968dd3d104dd7503eec1fba5`, installed release
`1.1.0-fca7af876c8260c32d17f95f3e19bc68ee1bf561`. No runtime change is
authorized by this document until root accepts it.

This specification defines the surface conventions for native help, MCP tool
descriptions, harness briefing and readable inspection. The semantic-context
specification (`semantic-lead`) cites these conventions for its context
commands, MCP tools and briefing lines; it does not define parallel formats.

Document ownership: `docs/bend2/orchestra-control-spec.md` (this file) is
authored and owned by `semantic-controls`. `docs/bend2/semantic-context-spec.md`
is owned by `semantic-lead`. The two feature documents are owned by root.
Runtime file ownership is assigned in section 7.

## 1. Stored model — unchanged

The specification reuses the current records and adds no new persistent state:

- Sessions: recorded `parent`, `harness`, `model`, `effort`, `workspace`,
  `branch`, `base`, endpoint. Public role derives from the stored conductor
  role and parentage (`commands.bend:106-122`).
- Ensembles: `id`, `owner` (a session with the conductor role), `coupling`
  (`loose` or `tight`), members.
- Sections: `ensemble`, `id`, `capability`, members. Section membership
  requires Ensemble membership through the existing foreign key
  (`commands.bend:73-75`, `section_member_admitted`).
- Messaging admission (`message_route`, `commands.bend:209-210`): both
  sessions registered and distinct, then one of — the sender's recorded parent
  is the recipient (immediate parent only); the sender stores the conductor
  role and is an ancestor of the recipient; both parties are explicit members
  of one shared tight Ensemble whose owner stores the conductor role, with
  neither party the other's ancestor and, when both parties store the
  conductor role, equal parent-chain depth; or the operator route with the
  parentless Conductor. An Ensemble owner is not implicitly a member and gains
  no peer route from ownership alone. The equal-depth clause applies to pairs
  of Conductors, not to pairs of Players. Section membership grants no
  messaging route. Descendant guidance and immediate-parent reporting keep
  these existing rules.

Trusted-local authority boundary: callers with access to the coordinator
database and control surface are trusted to inspect its coordination records.
CLI sender and owner fields name recorded coordination identities; they do not
authenticate the local OS caller, and any process holding the database path
can issue any command. Messaging admission governs sends; it does not restrict
reads, and session IDs and `--for` select data without acting as a read ACL.
Role assignment is an existing explicit configuration operation (`role`).
This specification adds no caller-authentication system, capability token or
role-change policy, and no view, briefing or named sender supplies access
control. Whether role writes gain an admission clause (for example requiring
the target's parent to store the conductor role, or an explicit issuing
session argument) is root's authority decision and is out of scope here; help
and the briefing state the convention that roles are assigned deliberately by
the coordinating Conductor (structure critic 4.1, option a).

Every view, briefing and help text in this specification is derived from these
records at read time. Selection and formatting grant no authority and mutate
no coordination state.

## 2. Evidence summary

Evidence lives under
`/Users/wahargis/Development/Experiments/baton-bend2-root-delivery-20260928/.scratch/semantic-context-20261005/`
in `research/` (consolidated Section reports and the five independent
verdicts), `evidence/semantic-controls-structure-research/`,
`probes/structure-critic/`, `reviews/semantic-controls-interfaces-evidence/`,
`acceptance-critic/phase2/` and `probes-fidelity-research/spec-review/`
(raw probe output). Principal observations, each verified against source and
the installed binary by at least one Section, with the structure critic and
fidelity researcher independently reproducing the route and refusal claims:

1. `usage()` (`main.bend:79-81`) is one flat positional catalogue, 2,208
   bytes. Bare `--help`/`help` print it with exit 0; two- and three-token
   forms such as `help team` fall to `Invalid` with exit 2; `ensemble --help`
   parses `--help` as an Ensemble ID and exits 1. No command help, ordering
   rules or construction sequence exists.
2. `orchestra` / `players` embed each Player's latest report body
   (`players_json`, `commands.bend:266-267`). Measured on the run database by
   two reporters at different times: 87-94 KB of report bodies in a 127-133
   KB `players` result; the mechanism, not the ratio, is the finding.
   Relationships are complete but split across the `players` and `ensembles`
   arrays; membership, Conductor depth and permitted routes require manual
   joins.
3. Ensemble/Section setup failures return a generic empty-result refusal
   (`main.bend:13-18`), except Sections which return a structured refusal
   (`section_refusal`, `commands.bend:249-250`). A conflicting Ensemble owner
   returns raw SQLite text (`NOT NULL constraint failed: ensembles.id`, exit
   19; probed by two reporters). A parentless non-conductor `report` or `ask`
   returns raw SQLite text (`NOT NULL constraint failed:
   messages.recipient`, exit 19) because `report_recipient`
   (`commands.bend:169-170`) resolves to NULL; no row is stored and no
   endpoint launches.
4. The 3-token form `ensemble ID OWNER` parses to the same constructor as an
   explicit `loose` (`commands.bend:364-365`, pinned by
   `ensemble_creation_defaults_to_loose`, `messaging-laws.bend:36-41`) and
   rewrites coupling on an existing Ensemble, silently revoking a tight
   Ensemble's peer route (probed on a scratch copy: a stored tight Ensemble
   read back as loose after the 3-token call). Documented in
   `docs/bend2/messaging.md`; not stated in help.
5. The receive briefing (`receive.bend:27-44`) interpolates only the
   executable, database and session ID. It names no recorded parent,
   Ensemble, Section or session-specific route, and its command list omits
   `delivery`, `report`, `ask`, `player`, `pending`, `session`, `stop` and
   `help`.
6. Dispatch-turn harnesses receive no briefing: `turn.bend` reads only the
   task file (`turn.bend:463-474`). The Muse adapter passes the file verbatim
   as `--prompt-file` (`muse-player.bend:4-11`); the Claude adapter takes no
   task argument and receives the prompt as a stdin stream-json frame
   (`claude-player.bend:17-21`, `turn.bend:141`). Receive sessions get
   `instructions()` prepended (`receive.bend:205`). The Codex and OMP
   Conductor adapters carry their own static briefing text
   (`codex-conductor.mjs:73-110`, `omp-conductor.mjs:76-110`) with no recorded
   parent, Ensemble, Section or route content.
7. `message`/`message-file`/`report`/`ask` commit through `Store.apply` and
   then run the recipient endpoint synchronously (`store.bend:7-34`,
   `delivery.bend:27-32,82-87`); the invoking CLI can remain attached through
   the recipient's receive lifetime (observed live: a `dispatch-message`
   delivery process and its `receive` child alive minutes after commit).
   `dispatch-file` commits and launches a detached process, returning
   `{"deliveryPid":N,"state":"launched"}` (`control.bend:149-166`,
   `host/control.c:119-149,218-228`). Endpoint failure on the synchronous
   path already answers named text separating commitment from delivery
   (`delivery.bend:20-25`), and the message stays pending. MCP `baton2_guide`
   calls the synchronous `message` path via `execFileSync`
   (`mcp-conductor.mjs:111-122,537-539`).
8. MCP tool descriptions (`mcp-conductor.mjs:124-323`, 22 tools) are one
   sentence each and omit ordering constraints, defaults and next operations.
   The tool list has no `baton2_delivery`. The adapter supplies an explicit
   `loose` coupling whenever an owner is present without coupling
   (`mcp-conductor.mjs:510-513`), so an owner-only MCP request is the
   explicit update form. `initialize.instructions` (`mcp-conductor.mjs:444`)
   states the role family and a tool list but no recorded parentage or
   membership.
9. Tight peer routes require explicit membership rows for both parties: a
   tight Ensemble's owner who is not a member has no route to its members
   (probed: `message-route-denied` until the owner joined). The equal-depth
   clause denies a cross-depth Conductor pair and does not restrict Player
   pairs (probed both).
10. Role writes check only the target's registration and parentage
    (`role_admitted`, `commands.bend:118-119`): any parented session can be
    promoted to Associate Conductor, and any session's role can be rewritten,
    by any caller of the CLI (probed: leaf Player promoted; Principal demoted
    and restored). This is the trusted-local model; see the authority
    boundary in section 1.
11. `recruit` checks only that the parent session exists; a Player-parented
    child is admitted and its reports then route to a parent that has no
    route back ([INFERENCE] from `require_parent`, `player_sql`,
    `report_recipient` and `message_route`; not executed).
12. `Muse.input` is a no-op returning success (`muse-player.bend:13-14`):
    a running Muse direct turn accepts no input.
13. Retrieval paths differ: `delivery MESSAGE_ID` returns any stored message
    body including acknowledged standalone reports; `players` returns only
    the latest report per session; `turns` returns only turn-backed reports;
    `player ID` returns no report fields (probed on installed 1.1.0 with a
    seeded standalone acknowledged report;
    `acceptance-critic/phase2/retrieval-probe.txt`).
14. `ancestors` (`commands.bend:191-192`) terminates under a directly
    injected parentage cycle (probed; cycles are reachable only by direct
    database writes).
15. The OMP tool wrapper on this run advertised a 300-second kill deadline
    for background jobs and killed backgrounded work at 120, 240 and 300
    seconds; `timeout: 0` disables it. This is observed behavior of this
    harness version's shell tool on this run, not a universal OMP property.

## 3. Surface conventions

These conventions are defined once here. Every native command, MCP tool and
briefing block follows them, including the semantic-context surface.

### 3.1 Help organization

- `baton2 DATABASE help` prints the flat usage catalogue followed by the list
  of help topics, exit 0. This remains the complete command list.
- `baton2 DATABASE help COMMAND` is a real parse arm printing one paragraph
  for that command: argument meanings, admission preconditions, defaults, the
  refusal conditions with their `condition`/`next` text, and the valid next
  operation when setup is incomplete. The paragraph reuses the same string
  constants the refusal rows assemble from; a real-function law checks that
  both are built from those constants (section 8.1).
- `help team` prints the worked construction sequence (section 4.1) using the
  real commands. Bare `--help` anywhere prints the catalogue plus a pointer
  to `help team` and `help COMMAND`.
- An unrecognized command keeps exiting 2 with the usage text. The structured
  refusal family (section 3.2) exits 2 uniformly; the exit status is part of
  the refusal contract and is stated centrally here.

### 3.2 Refusal shape

Every refused setup or messaging operation exits 2 with one JSON object:

```
{"error": "<stable-code>", "command": <safe identifying arguments>,
 "condition": "<the failed prerequisite, naming the missing or conflicting record>",
 "next": "<the reader command and the permitted next operation>"}
```

Safe echo: `command` echoes identifying arguments (IDs, kinds, action words)
and omits opaque message bodies, endpoint argv and any credential-bearing
values, per M-14 (`docs/bend2/laws-proposed.md:196-199`). A host or storage
failure is reported as the actual host failure with `next` naming the
recovery operation or `unknown`; it is never reclassified as an admission
refusal, and admitted/committed status is reported independently of the
failure.

`section-refused` (`commands.bend:249`) is the existing instance and its
shape is the template. The shape extends to `ensemble`, `ensemble-member`,
`role` (already `invalid-role`), message routing (already
`message-route-denied`), endpoint operations (already `invalid-endpoint`)
and the parentless `report`/`ask` case. New codes: `ensemble-refused`,
`ensemble-member-refused`, `report-refused`, `ask-refused`. The report/ask
refusal fires when `report_recipient` resolves to NULL (parentless
non-conductor session); a parentless Conductor's report keeps routing to the
operator (`commands.bend:169-170`). Every refusal code is registered in the
refusal classifier (`Store.refused`, `store.bend:18-24`), so a refused
operation commits nothing and launches no endpoint; the route-gated insert
leaves no row (structure critic 3.2). No exit path returns raw SQLite error
text; the owner-conflict clause in `ensemble_sql` (`commands.bend:234`) is
replaced by an explicit admission check that refuses with the stored owner
named. Admission predicates and accepted transitions otherwise do not
change; the single deliberate correction is the omitted-coupling ensure
behavior of section 4.2.

### 3.3 Readable and structured inspection

One projection function composes the Player rows (with the membership and
depth joins below) and the Ensemble rows from stored records. Four surface
forms render it:

| Form | CLI | MCP `baton2_orchestra` |
| --- | --- | --- |
| Full structured | `orchestra` / `orchestra --pretty` | no arguments |
| Focused structured | `orchestra --for SESSION` | `session: SESSION` |
| Full readable | `orchestra --view` | `view: "readable"` |
| Focused readable | `orchestra --view SESSION` | `session: SESSION, view: "readable"` |

- Full structured: one JSON object with `players`, `operators`, `ensembles`.
  Each Player row gains `ensembles` (Ensemble IDs), `sections`
  (Ensemble/Section pairs) and `depth` (parent-chain length), all derived
  joins; the pinning laws for the changed row assemblers are restated
  (`naming-laws.bend:130-140` pins `players_json` and `orchestra_sql`
  verbatim today). Each Ensemble keeps its existing `members` array of
  session-ID strings unchanged and gains an additive `memberRoles` object
  mapping each member ID to its public role; Section `members` arrays are
  likewise unchanged. The removal of the embedded `latestReport` body from
  `orchestra` Player rows is an intentional compatibility change with a
  migration note: `latestReportId` remains, consumers of
  `orchestra.players[*].latestReport` (CLI or MCP) move to the readers below,
  and the release note and `usage()` text state the change. Full retrieval:
  `delivery MESSAGE_ID` is the universal body lookup for any stored message,
  including acknowledged standalone reports; `players` keeps `latestReport`
  (latest report per session); `turns PLAYER_ID` returns turn-backed report
  bodies; `player ID` returns no report fields (evidence item 13).
- Focused structured (`--for SESSION`): `version`, `subject`, `ancestors`,
  `players`, `ensembles`, `routes`, `pending`, `selection`, `limitations`.
  Selection is explicit and derived in this order: the subject; its
  ancestors; its descendants; Ensembles owned by any included session;
  Ensembles the subject belongs to; the members of those Ensembles. Members
  included only as references carry `"reference": true` and the follow-up
  reader command (`player ID`, `orchestra --for ID`); reference-marked
  members do not trigger further owner or descendant expansion. Every
  selected record is rendered, including empty Sections, unassigned Players,
  stopped sessions and sessions with no endpoint. There is no top-N summary,
  count cap or hidden historical filter. `selection` names the rule above
  and the subject session; `limitations` names each scope boundary actually
  applied (reference-marked members, unexpanded branches). `pending` lists
  each in-scope incomplete-setup state — unassigned Players, empty Sections,
  sessions with no endpoint, unacknowledged deliveries — as
  `{id, sender, kind, receiptState, condition, next}` entries naming the
  condition and the permitted next operation; bodies stay readable through
  `delivery`. An unknown subject ID returns the refusal shape with error
  `orchestra-subject-unknown`, `condition` naming the unknown ID and `next`
  naming `players` and `orchestra`.
- `routes` is derived by applying the existing messaging admission predicates
  (`commands.bend:190-210`) between the subject and each returned session.
  Each route names its category — `parent`, `descendant`, `tight-peer` (with
  the Ensemble ID), or `operator` — from the actual predicate that admits
  it. A route displayed in a view grants no authority; admission is
  re-evaluated from current records at send time.
- Readable forms render the same projection as an indented tree. Rows are
  ordered by role rank (Principal, Associate Conductor, Player, operator)
  then session ID; each row carries its entity kind, ID, and its parent or
  owner ID with fixed labels (`parent:`, `owner:`, `coupling:`, `section:`,
  `member:`). The focused readable form additionally lists the subject's
  routes, current work (execution state, last turn) and pending input.
  Required renderings: the Principal with no owned Ensemble renders alone; a
  session belonging to several Ensembles or Sections appears under each with
  the same recorded parent label; a member whose recorded parent is outside
  the rendered branch is labelled with its recorded parent in place. The
  renderer never reparents a record and never presents membership or a
  displayed route as assigned parentage or granted authority. Incomplete
  setup renders as stored: an Ensemble with no Sections, a Section with no
  members, a Player with no Ensemble and no endpoint each appear as such.
  Acceptance compares the readable rows against the structured projection
  field-by-field on each fixture state.
- MCP adds `baton2_delivery` with required `id`, returning exactly what CLI
  `delivery ID` returns, including acknowledged messages. In MCP error
  envelopes (`isError` text, `mcp-conductor.mjs:572-575`) the refusal JSON
  object of section 3.2 is embedded intact with its fields preserved.

### 3.4 MCP tool description format

Each MCP tool description has four parts, in order: the operation in one
sentence; the admission preconditions; the defaults applied when optional
arguments are omitted; and the next operation when a prerequisite fails.
Schema fields carry the same defaults and constraints in their `description`
properties, including invalid combinations (Section `capability` without
`owner` configures with the attached owner; `owner` without `capability` is
invalid). Omitted arguments stay omitted end to end: the adapter does not
materialize defaults the coordinator is meant to apply — in particular an
omitted `coupling` reaches the coordinator as omitted, so CLI and MCP share
the ensure semantics of section 4.2 (evidence item 8; handoff to
`semantic-lead` per section 7). Initialization instructions state the
attaching session's recorded role, parentage, Ensemble ownership and
membership, and that attachment assigns a Conductor role
(`mcp-conductor.mjs:391-444`).

### 3.5 Briefing layout

One native orientation function generates the briefing from stored records.
It is used by every entry path (section 5). Layout, in order:

1. Identity: session ID, public role, immediate Conductor, harness, model,
   workspace, branch.
2. Responsibility: one sentence derived from role (Player executes and
   reports; Associate Conductor coordinates its descendants; Principal
   coordinates the Orchestra).
3. Membership: owned Ensembles with coupling, member Ensembles, Sections
   with capabilities.
4. Permitted routes: the routing rules stated as the actual predicates of
   section 1 — report/ask to the immediate Conductor; a Conductor messages
   its descendants; peer messages need both parties' explicit membership in
   one shared tight Ensemble, with equal depth required only between two
   Conductors; Ensemble ownership alone grants no route; Section membership
   grants no route. Concrete IDs are named categorically: the immediate
   Conductor always, and every peer route through each Ensemble the session
   belongs to. Any further permitted sessions (for example a Conductor's
   descendant set) are given by rule plus the native retrieval command
   `orchestra --for SESSION`, which returns the complete concrete route set
   computed from current records. No count-based choice exists anywhere in
   the block.
5. Completion semantics: the delivery contract of section 6 — every input
   operation acknowledges commitment and delivery initiation; `--wait`
   joins endpoint completion; committed, delivered and accepted (`ack`) are
   three distinct states — and how to inspect completion (`turns`, `inbox`,
   `delivery`, output logs).
6. Command list: the coordinator CLI lines, now including `delivery ID`,
   `report`, `ask`, `player`, `pending`, `orchestra --for`,
   `orchestra --view` and the `help` topics.
7. Harness note: for sessions running under the OMP shell on this run, the
   tool wrapper advertises a 300-second kill deadline for background jobs
   (observed kills at 120, 240 and 300 seconds; evidence item 15).
   Coordinator CLI calls and other owned work whose completion depends on
   another session run with the shell timeout disabled (`timeout: 0`).
   Ordinary guidance uses detached delivery (section 6), which returns at
   launch. This is invocation guidance for one supported harness; Baton
   itself imposes no time cutoff.

The orientation projection is allowlisted: it renders identity, role,
membership, route and completion facts from records, and endpoint state as
registered/absent. It never renders raw endpoint argv, identity-registry
contents, harness credential material or unfiltered backend diagnostics
(accepted endpoint text is arbitrary, `commands.bend:146-147`; installation
docs already keep registry credentials outside task files,
`docs/bend2/installation.md:168-171`).

A briefing describes recorded facts at generation time. It grants no
authority and can become stale; admission always re-evaluates current
records.

## 4. Construction and setup semantics

### 4.1 Construction sequence (published in `help team` and the briefing)

`help team` prints a runnable sequence that builds the full topology with
real commands, in admission order:

1. The Principal exists from `start`. It may create a direct Ensemble it
   owns (`ensemble ID PRINCIPAL loose|tight`) and recruit Players into it.
2. Per Associate Conductor, including several siblings under the same
   Conductor and nested Associates under an Associate:
   `recruit ID PARENT ...`, then `role ID associate-conductor`, then
   `ensemble ENSEMBLE ID loose|tight` for each owned Ensemble.
3. Per Player: `recruit`, then `ensemble-member ENSEMBLE OWNER PLAYER add`.
4. Per Section: `section ENSEMBLE SECTION OWNER CAPABILITY` creates the
   Section; then `section-member ENSEMBLE SECTION OWNER PLAYER add` for each
   member. A Section member must already be an Ensemble member.
5. Endpoint registration (`receiver`, or `attach`/`connect`) precedes
   receive-based dispatch; `dispatch-turn` needs no receiver.

Recorded parentage (the `recruit PARENT` argument, which sets report/ask and
descendant routes) and Ensemble/Section membership (which sets peer routes
and team grouping) are distinct relations: a Player's Ensemble owner need
not be its recorded parent, and the views label each relation as itself.
Independent branches of this sequence proceed concurrently. Coupling is
always shown explicitly in examples. The sequence text also states the role
convention of section 1: `role` is an explicit configuration operation
issued by the coordinating Conductor, and `recruit`'s PARENT should be a
Conductor because reports route to the recorded parent (evidence items 10
and 11; admission changes for either remain root's decision, section 10).

### 4.2 Setup operation rules

- The omitted-coupling form `ensemble ID OWNER` is an idempotent ensure: it
  creates the Ensemble with loose coupling when the ID is absent, and
  returns the stored row unchanged when the Ensemble already exists,
  whatever its coupling. The result marks the outcome explicitly:
  `created: true` on creation, `created: false` with the stored row on an
  existing Ensemble. The parser carries omission explicitly as a distinct
  ensure command variant, because the current parse maps omission and an
  explicit `loose` to the same constructor (`commands.bend:364-365`); the
  law `ensemble_creation_defaults_to_loose` (`messaging-laws.bend:36-41`)
  is restated over the ensure variant: creation with omitted coupling
  produces a loose Ensemble. The explicit form `ensemble ID OWNER
  loose|tight` is the only coupling-changing operation and requires the
  named owner to be the stored Conductor owner. Migration: a caller that
  used the 3-token form to (re-)declare loose on an existing Ensemble must
  now use the 4-token form; `help ensemble`, the briefing and
  `docs/bend2/messaging.md` state this. MCP preserves omission end to end
  (section 3.4), so the same request has the same effect on both surfaces.
  This is the one deliberate correction to an accepted transition (evidence
  item 4).
- A conflicting owner refuses with `ensemble-refused` on both the omitted
  and explicit forms, naming the stored owner and the retained declaration.
  The raw SQLite constraint path is removed.
- `ensemble-member` failures (unknown Ensemble, non-conductor owner,
  unregistered or operator session, unknown action word) return
  `ensemble-member-refused` with the missing record named. `remove` of a
  non-member stays idempotent and reports `membership:"remove"`.
- `report`/`ask` from a session whose report recipient resolves to NULL
  refuse with `report-refused`/`ask-refused` (section 3.2); nothing is
  stored and no endpoint launches.
- Removing Ensemble membership continues to cascade Section membership in
  that Ensemble (`commands.bend:75`, `PRAGMA foreign_keys=ON`); the cascade
  is stated in `help ensemble-member`.
- Conflicting recruitment never overwrites a recorded assignment; an exact
  retry returns the existing assignment (current behavior, preserved).

## 5. Briefing parity across entry paths

The orientation function (section 3.5) is applied once per native turn on
every entry path:

- Receive sessions: `receive.bend` prepends the generated orientation to the
  delivered body, replacing the current static `instructions()` text.
- Dispatch-turn sessions: `turn.bend` prepends the same generated
  orientation to the prompt. For Muse, the coordinator writes the composed
  prompt (orientation block plus the authored task body, preserved verbatim)
  to a per-attempt artifact under the turn's log directory before launch,
  and the adapter receives that file as `--prompt-file`. For Claude, the
  composed prompt is delivered as the stdin stream-json frame
  (`claude-player.bend:17-21`). A write failure of the composed-prompt
  artifact aborts the launch with a named host error; no harness starts and
  the task file is untouched. The artifact path is named in the
  `dispatch-turn` result and in `turns` output, so the exact dispatched
  prompt is retained and inspectable per attempt, including recovery
  regenerations. "No new persistent state" in section 1 means no new
  coordination or authority records; attempt artifacts under existing log
  directories are operational files.
- Attached Conductor sessions: the Codex and OMP Conductor adapters
  (`codex-conductor.mjs:73-110`, `omp-conductor.mjs:76-110`) replace their
  static briefing text with the same generated orientation for the attached
  session, keeping their adapter-specific transport instructions.
- Resume and fresh-recovery paths regenerate the orientation from current
  records.

No per-harness wrapper is introduced; orientation is generated in the
coordinator before the harness is invoked.

## 6. Delivery completion semantics

Public completion contract (changed per root's M-12 decision): every public
input operation — `message`, `message-file`, `report`, `ask`, `ask-file`,
`dispatch` and `dispatch-file` — commits through the existing admission path
(`Store.apply`, route-gated insert in one transaction), launches delivery
through the existing detached Control launch (`control.bend:149-166`,
`host/control.c:119-155`), and returns acceptance of the committed input and
the delivery initiation without joining the recipient's managed lifetime.
The current implicit synchronous default (acceptance returns only after
endpoint exit on the registered-endpoint path) is replaced. The existing
M-12 laws cover the no-delivery and empty-endpoint branches; this
specification extends the same guarantee to the registered-endpoint branch.

- Shared acceptance result (additive): `id`, `sender`, `recipient`, `kind`,
  `committed`, `deliveryPid`, `state`, `deliveryLog`, and `read` naming the
  retrieval commands (`delivery`, `inbox`, `turns`). `committed` is true
  only when the message row was stored before launch. The result names the
  actual delivery process, its log, the retained message ID and the native
  recovery operation. Three observable states stay distinct in help and
  briefing: committed (stored), delivered (endpoint ran), accepted
  (recipient `ack` set the receipt).
- Caller-selected completion wait: a trailing `--wait` flag on the input
  operations joins the same internal delivery path and returns after
  endpoint exit, preserving the current behavior for callers that want it.
  No other grammar changes.
- Failure ownership. Admission refusal: nothing commits or launches
  (section 3.2). Launch failure after commit: the result names the retained
  message ID, and the failure text follows the existing pattern
  (`delivery.bend:20-25`) naming the root log and the retry operation.
  Endpoint failure after a successful launch: the detached delivery worker
  appends the outcome to the delivery log and the message stays pending;
  the responsible party is the sender's Conductor, which observes the state
  through `inbox`/`pending` (unacknowledged), `turns` (no report) and the
  named delivery log, and re-drives delivery by the recipient's next
  receive wake or a repeated send. No automatic failure notification exists;
  the interface says so. Recipient receipt and recipient review remain
  separate later states.
- Compatibility and migration: the default for `message`, `message-file`,
  `report`, `ask` and `ask-file` changes from joined to detached. Callers
  and harness instructions that relied on the implicit wait add `--wait`.
  MCP clients of `baton2_guide` now receive a launch acknowledgment and
  retrieve outcomes through `baton2_delivery`, `baton2_inbox` and
  `baton2_turns`. Help, the briefing and `docs/bend2/messaging.md` state the
  changed contract. Inline, file and MCP forms share these semantics because
  all of them call the same coordinator commands.
- The internal synchronous endpoint run (`delivery.bend` `launch` →
  `Process.run`) remains in place for the detached delivery worker
  (`--dispatch-message`) and the receive continuation (`wake_pending`); only
  the public default changes.
- `dispatch-turn` returns `player`, `turnId`, the assigned route,
  `deliveryPid`, `state`, output log path, the composed-prompt artifact path
  (section 5) and the lookup commands for the turn and its report. A
  launched turn is not claimed as a committed task message.
- For a dispatch-turn Player, inspection states whether a registered
  endpoint can accept input during the turn. Where no such route exists
  (Muse: `Muse.input` is a no-op, evidence item 12), the view identifies the
  incomplete route and the supported continuation action (message retained
  for the next turn boundary). A successful message commit is never
  presented as live steering.

No new scheduling, parking, outcome store or duplicate routing mechanism is
introduced. Turn end continues to wake the immediate Conductor with the
report.

## 7. Runtime file ownership and handoff

Runtime file ownership follows the assignment agreed with `semantic-lead` in
the tight `semantic-task-conductors` Ensemble (peer exchange
`semantic-controls-lead-contract-1`, `semantic-controls-lead-conventions-1`
and the lead's reply), so two workstreams never edit the same function in
parallel:

- `semantic-lead` owns the shared coordinator files: `commands.bend`,
  `main.bend`, `bend2/scripts/mcp-conductor.mjs`, `package-native.py`,
  `store.bend` (including the refusal classifier), the `laws.bend`
  aggregation and the shared check-script wiring. This specification's
  changes to those files (parse variants, usage/help topics, refusal rows,
  view projections, tool descriptions, `baton2_orchestra` arguments,
  `baton2_delivery`, detached `baton2_guide`) land as reviewed handoffs:
  `semantic-controls` supplies the exact edits and their tests;
  `semantic-lead` applies, verifies and lands them.
- `semantic-controls` owns `receive.bend` (the shared orientation function
  and the briefing layout of section 3.5) and `turn.bend` (dispatch-turn
  prompt orientation and the composed-prompt artifact). The semantic-context
  orientation block is supplied by `semantic-lead` as content and rendered
  by the shared orientation function. The Conductor adapter briefing edits
  (`codex-conductor.mjs`, `omp-conductor.mjs`, section 5) are
  semantic-controls work landed as reviewed handoffs through
  `semantic-lead`, since the adapters are shared files.
- Per-feature law modules, adapter files and test files are disjoint new
  files on both sides; each side owns and registers its own.
- Packaging prerequisite note: the Git identity helper and the MCP adapter
  require Node 22.15+ per `docs/bend2/installation.md` and
  `docs/bend2/harness-setup.md` (CI selects Node 22); the bare native
  `baton2` binary runs without Node; any runtime requirement of a semantic
  backend is declared by the semantic-context specification, not inferred
  from a host's installed versions. No new runtime floor is introduced here.

## 8. Operative laws and acceptance

### 8.1 Laws

New and changed real functions carry operative laws in the existing law
modules (`naming-laws.bend`, `messaging-laws.bend`, `control-laws.bend`,
receive laws), imported into the entry's law gate (`main.bend:5,17`;
`laws.bend:87,91`). Concrete laws, named per the existing style:

- Parse laws: the `help COMMAND` arm; the omitted-coupling ensure variant
  (restating `ensemble_creation_defaults_to_loose`); the `--wait` flag;
  `orchestra --for/--view` forms; the inline `dispatch` form.
- `player_snapshot_names_its_ensemble_and_section_members` — the new joins
  in `players_json`; restates the verbatim pins at `naming-laws.bend:130-140`
  for the changed `players_json`/`orchestra_sql` text.
- `orchestra_read_and_ensemble_read_agree_on_membership` — nested members in
  `ensemble_row` equal the per-row `ensembles` projection for every listed
  session.
- `orchestra_scoped_read_selects_the_connected_set` — the focused selection
  CTE implements the section 3.3 rule in its stated order.
- `scoped_view_routes_match_message_admission` — listed route pairs are
  exactly the pairs `message_route` admits on the same state.
- `view_selections_are_relational_not_counted` — every row limit in the
  views is keyed selection ("latest per sender", "scope membership"), never
  a row or byte count.
- Refusal registration: every section 3.2 code appears in `Store.refused`;
  a refused input commits nothing and launches no process (extending
  `denied_detached_input_cannot_launch_a_process`, `control.bend:192-199`,
  and `detached_delivery_commits_before_launch_and_checks_refusals`,
  `control-laws.bend:48-60`, to the inline and `--wait` forms).
- Delivery default: ordinary acceptance returns after commit and launch
  initiation, expressed over the real default path; the `--wait` path joins
  endpoint exit; both reuse the one internal delivery path.
- Orientation: the briefing contains the recorded parent, memberships and
  sections of its session; the receive and dispatch-turn paths compose the
  same orientation function output; the authored task body appears verbatim
  after the orientation block; a stale briefing grants no capability —
  stated at the send/admission functions (`message_route`/`message_sql`),
  with orientation composition laws in the receive laws.
- Help/refusal shared constants: help paragraphs and refusal rows assemble
  from the same string constants.

Law-level claims cover the Bend decision and sequence functions; SQLite
evaluation, process spawn and file effects are host obligations checked by
the tests below. SQL-string equality laws establish the assembled SQL;
native host fixtures establish the statements' actual effects.

Existing test contracts to preserve and extend: `bend2/test/naming.py`,
`messaging.py`, `control.py` (detached guidance at 361, overlapping Players
at 386, direct-turn assignment at 452, complete pretty JSON at 476),
`mcp-command.py`, `mcp-contract.py` (CLI/MCP field parity),
`mcp-root.py`, `receive.py`, `native-cli.py`. Tests assert record and
message facts against an independently stated expected topology and expected
actions, never source line counts, topology totals, output sizes or golden
prose.

Report-body growth is covered structurally: a fixture with multi-kilobyte
Unicode report bodies must produce identical structural fields (parentage,
ownership, coupling, membership, depth, routes) to the same fixture with
empty reports, and full retrieval still works: `delivery` for any message,
`players` for the latest report per session, `turns` for turn-backed
reports. No test asserts a byte bound or a report length.

Every changed or new behavior lands on CLI and MCP together with the same
admission rules and the same facts: the refusal shape, the focused and
readable `orchestra` forms, the detached delivery default and `--wait`,
`baton2_delivery`, the omitted-coupling ensure, and the briefing content.
`mcp-contract.py`-style parity checks extend to these. Shared strings and a
shared projection support parity; the parity property itself is established
by these executed checks, not presumed.

Build and proof use the pinned compiler (2.0.25) through
`bend2/scripts/build-native.sh` and `bend2/scripts/laws-check.mjs`. The
pin's current home under `.scratch/` is a durability risk for future
rebuilds; root should pin a durable toolchain location (section 10).

### 8.2 Qualification split

Admission behavior is qualified on a controlled fixture: a scratch database
with attached empty-endpoint sessions exercises accepted and refused routes,
setup ordering, retry and conflict behavior without live harnesses. Fixture
hygiene: a copied database carries live `sessions.endpoint` values that name
the live database, so fixture copies clear `sessions.endpoint` before write
probes, or a purpose-built fixture database is used (incident recorded in
the fidelity research verdict, section 8). A fixture qualifies admission
only.

Delivery completion is qualified with host effects: a real native endpoint
held open by a test-controlled release; ordinary send acceptance returns
before release; an explicit `--wait` remains attached until release;
full message retrieval works after acknowledgment; parent routing is
preserved; a refused input produces no message and no launch; a forced
post-commit launch failure and a forced post-launch endpoint failure each
retain the body and identity, name the continuation owner and show the
responsible party's observation path (section 6).

Native use is qualified by an installed cold-agent run:

- Environment contract: the candidate archive, manifest, binary and adapter
  hashes are recorded; external tool and harness versions are recorded; Node
  22.15+ is qualified for the helper and MCP adapter; the install prefix is
  verified; package-relative adapter/native selection is verified with no
  development-checkout fallback; the MCP adapter's `serverInfo.version`
  (component version) is stated against the product release identity;
  "isolated" names which source and dependency paths are unavailable while
  harness authentication remains configured without displaying credential
  values. The existing smoke script supplies reusable extraction and
  isolation mechanics (`smoke-native-artifact.py:215-229,259-287`).
- An agent with only the installed tooling and its generated briefing
  constructs a Principal's direct Ensemble plus two Associate Conductors
  (one nested under the other), each owning an Ensemble with two capability
  Sections and at least two Players per Section, including a critic
  Ensemble. No instruction beyond the installed package and the generated
  briefing is supplied; product help (including `help team`) counts as
  product surface, not private instruction.
- The run demonstrates concurrent dispatch (shown by overlapping live
  harness execution observations, not merely two launched PIDs), scoped
  tight-Ensemble peer messages, loose-peer and unequal-depth refusals,
  parent reports, acknowledgment with full report retrieval through
  `delivery`, inspection that identifies ownership, cross-parent membership
  and a subject belonging to an Ensemble owned outside its branch (both
  absent from the current run database, so fixture-built), incomplete-setup
  refusal recovery using only help and refusal text, and reviewed landing of
  an approved change into an external fixture repository. The landed change
  cites the approving review record (reviewer session, verdict, message ID)
  and the fixture repository revision before and after; a landing receipt or
  an already-present change is insufficient.
- A Muse dispatch-turn Player's delivered prompt artifact is shown to
  contain the generated orientation ahead of the verbatim authored task
  body (diff of the artifact against the task file); a receive-path briefing
  for the same records is shown with identical orientation-block content.
  The run exercises the dispatch-turn incomplete-route branch (guidance
  committed for a running Muse Player is presented as retained input, not
  live steering).
- At least one Conductor in the run is attached through the installed MCP
  adapter and performs discovery, control and full retrieval through it.
- An independent critic, not drawn from run participants, evaluates the
  retained evidence: the exact initial task, the generated briefing, the
  installed help/tool discovery output and the ensuing agent/tool transcript
  including every intervention. Per construction step the critic records
  which product surface (help text, MCP description, generated briefing) the
  step came from; a step with no cited source fails the run.
- Readable and structured views are compared field-by-field against an
  independently inspected stored snapshot that includes incomplete setup and
  retained historical sessions.

## 9. Decisions taken in this specification

1. `orchestra` Player rows drop the embedded `latestReport` body and keep
   `latestReportId` — an intentional compatibility change with a migration
   note in `usage()`, the release note and `docs/bend2/messaging.md`.
   `delivery MESSAGE_ID` is the universal body lookup; `players` keeps the
   latest report per session; `turns` returns turn-backed reports; `player`
   carries no report fields. Ensemble `members` stays an array of session
   IDs; roles arrive in the additive `memberRoles` object.
2. Omitted coupling is an idempotent ensure carried explicitly through the
   parser: create loose when absent, return the stored row with
   `created: false` when present. The explicit 4-token form is the only
   coupling-changing operation; the parse law is restated; MCP preserves
   omission; the 3-token-to-loose migration is documented. New Ensembles
   default to loose (unchanged intent, restated law).
3. The focused projection (`--for`) and readable tree (`--view`) are
   additive; the only removed field is per decision 1.
4. Delivery default becomes detached acceptance per M-12, with `--wait` as
   the caller-selected joined form; MCP `baton2_guide` uses the detached
   operation, and MCP clients migrate to launch acknowledgment plus
   `baton2_delivery` retrieval.
5. The OMP shell deadline is addressed as briefing invocation guidance
   (`timeout: 0`) scoped to the observed harness behavior, plus the detached
   default for ordinary guidance; no Baton runtime cutoff is added.
6. `player ID` gains the same membership/depth fields as the `orchestra`
   Player row, from the same projection; it gains no report fields.
7. The composed dispatch-turn prompt is retained as a per-attempt artifact
   under the turn's log directory, named in the `dispatch-turn` result and
   `turns`; a write failure aborts the launch.
8. Role assignment and recruit-parent constraints are stated as conventions
   in help and briefing; admission changes for either are root's authority
   decision (section 10).

## 10. Open items

- For root's authority decision: whether `role` writes gain an admission
  clause (structure critic 4.1, option b), and whether `recruit` requires
  the parent to store the conductor role (structure critic 4.3). This
  specification states conventions only.
- Direct-turn live steering: `Muse.input` is a no-op (evidence item 12), so
  a Muse direct turn has no live input route today; input is retained for
  the next turn boundary. Claude's stdin input path (`turn.bend:141`) and
  OMP direct-turn input need host qualification before the interface
  advertises them. Committed input and live receipt stay distinct in every
  view.
- Semantic-context cross-references: the lead's stabilized names are
  `context-engines`, `context-query QUERY_ID REQUEST_JSON`,
  `context-query-file QUERY_ID PATH`, `context-result QUERY_ID`, and MCP
  tools `baton2_context_engines`, `baton2_context_query`,
  `baton2_context_result`. They cite sections 3.1-3.5 and 6; their unknown
  identity refusal names the absent record per section 3.2. Final
  cross-reference text lands when the semantic-context spec is committed.
- The sixth independent verdict (architecture-research) was outstanding when
  this successor was consolidated; its points land as a further revision if
  it requests changes.
- The pinned Bend 2.0.25 compiler currently lives under a `.scratch/` path;
  a durable toolchain pin is needed before rebuilds (section 8.1).
