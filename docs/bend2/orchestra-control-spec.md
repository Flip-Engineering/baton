# Native Orchestra control — implementation specification

Status: successor draft for root review, consolidating root review
`semantic-root-controls-review-2`, root's M-12 delivery decision, root's
structure-critic decisions, and all six independent verdicts from the
`semantic-critical-review` Ensemble (fidelity-critic, fidelity-research,
acceptance-critic, acceptance-research, architecture-critic,
architecture-research; each verdict is
its author's own). Implements `docs/bend2/orchestra-control-feature.md`
(commit `c8b5057d`). Baseline under audit:
`6929bffeeac32514968dd3d104dd7503eec1fba5`, installed release
`1.1.0-fca7af876c8260c32d17f95f3e19bc68ee1bf561`. No runtime change is
authorized by this document until root accepts it.

This specification defines the surface conventions for native help, MCP tool
descriptions, harness briefing and readable inspection. The semantic-context
specification (`semantic-synthesis`) cites these conventions for its context
commands, MCP tools and briefing lines; it does not define parallel formats.

Document ownership: `docs/bend2/orchestra-control-spec.md` (this file) is
owned by `semantic-controls-next`, continuing preserved drafts `d00c9369`
and `85f20618`. `docs/bend2/semantic-context-spec.md` is owned by
`semantic-synthesis`. The two feature documents are owned by root.
Runtime file ownership is assigned in section 7.

## 1. Stored model — unchanged

The specification reuses the current coordination records. Composed prompts
are retained operational files as specified in section 5:

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
control. Root's continuation decision retains existing role-write admission
and recruit's registered-parent admission. Help and briefing state that the
coordinating Conductor explicitly configures roles. A stored parent without
the Conductor role remains the recorded report recipient. Inspection labels
this as incomplete setup, shows `role PARENT`, and identifies
`role PARENT principal-conductor` for a parentless parent or
`role PARENT associate-conductor` for a parented parent as the available
explicit configuration. Reads and briefing generation preserve every role
and parent assignment. A separately observed failure requires its own
review before changing admission.

Every view, briefing and help text in this specification is derived from these
records at read time. Selection and formatting grant no authority and mutate
no coordination state.

## 2. Evidence summary

Evidence lives under
`/Users/wahargis/Development/Experiments/baton-bend2-root-delivery-20260928/.scratch/semantic-context-20261005/`
in `research/` (consolidated Section reports and independent
verdicts), `evidence/semantic-controls-structure-research/`,
`probes/structure-critic/`, `reviews/semantic-controls-interfaces-evidence/`,
`acceptance-critic/phase2/` and `probes-fidelity-research/spec-review/`
(raw probe output). `reviews/phase2-consolidation.md` retains the nineteen
consolidated requests and all six full-verdict message IDs, including
`semantic-review-architecture-research-report-4`, retrieved through
`delivery`. These are review evidence; acceptance remains unclaimed until
the successor receives new independent verdicts. Principal observations,
each verified against source and
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
  real commands. `--help` in the command position prints the catalogue;
  `COMMAND --help` in the two-token help form prints that command's help.
  Required body/path arguments equal to `--help` remain data. The catalogue
  points to `help team` and `help COMMAND`.
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
refusal fires when `report_recipient` resolves to NULL (including a parentless
non-conductor or a parentless Conductor with missing operator setup); a
parentless Conductor's report keeps routing to the registered operator
(`commands.bend:169-170`). Every admission refusal code is registered in the
refusal classifier (`Store.refused`, `store.bend:18-24`), so a refused
operation commits no coordination change and launches no endpoint; the
route-gated insert leaves no row (structure critic 3.2). Admission failures
return the structured refusal; the owner-conflict clause in `ensemble_sql` (`commands.bend:234`) is
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
  `players`, `operators`, `ensembles`, `routes`, `pending`, `selection`,
  `limitations`. `version` is 1; `subject` is the selected session ID;
  `ancestors` lists its recorded ancestors from immediate parent upward.
  First form the base set from the subject, its ancestors and descendants.
  Select Ensembles owned by that base set, plus Ensembles with explicit
  subject membership. Include every Section of each selected Ensemble.
  Add the owners and members of those Ensembles as references. Also add
  every admitted outgoing route recipient as a reference, including the
  operator where applicable. This final reference expansion never repeats
  the ownership or descendant expansion. Operators occupy `operators`;
  other sessions occupy `players`. Each session occurs once in these arrays.
  Base records carry `reference: false`; added references carry
  `reference: true` and `read: ["player ID", "orchestra --for ID"]`.
  Every
  selected record is rendered, including empty Sections, unassigned Players,
  stopped sessions and sessions with no endpoint. There is no top-N summary,
  count cap or hidden historical filter. `selection` is
  `{mode: "connected", subject: SESSION, rule: "parent-owner-member-routes-v1"}`.
  `limitations` contains `{kind: "reference", id, next}` for each reference
  whose remaining branch is available through `orchestra --for ID`.
  Missing external branches are described by that rule and those references;
  they do not appear as fabricated selected records. `pending` is a tagged
  array: setup entries use `{type: "setup", entity, id, condition, next}`;
  input entries use `{type: "input", id, sender, recipient, kind,
  receiptState: "unacknowledged", next: "delivery ID"}`. Setup conditions
  cover missing Conductor role on a stored parent, absent Ensemble membership,
  empty Ensembles or Sections and absent endpoints. An absent endpoint on a
  direct-turn Player names `dispatch-turn` as the supported operation; it
  does not suggest `receiver` for Muse or Claude. Input entries include all
  unacknowledged messages addressed to selected sessions. Bodies remain
  available through `delivery`. An unknown subject ID returns the refusal shape with error
  `orchestra-subject-unknown`, `condition` naming the unknown ID and `next`
  naming `players` and `orchestra`.
- `routes` applies the existing `message_route` predicate to the subject as
  sender and every registered recipient, before reference expansion. Each
  admitted pair appears once as `{sender, recipient, categories, ensembles}`;
  `categories` contains every matching `parent`, `descendant`, `tight-peer`
  or `operator` clause and `ensembles` every admitting tight Ensemble ID.
  Self routes remain excluded by admission. A route displayed in a view
  grants no authority; admission is
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
- Full forms add `version: 1`, `subject: null`, `ancestors: []`, `routes`,
  `pending`, `selection: {mode: "full", subject: null, rule: "all-records-v1"}`
  and `limitations: []` to the existing top-level fields. All sessions and
  Ensembles are selected, all references are false, and routes enumerate
  all admitted directed pairs. Full readable output includes work and pending
  input under the same rules as focused output. Empty databases return empty
  arrays and an empty-setup instruction naming `help start`; the readable
  form prints that instruction. A parentless Principal with no Ensemble
  still renders its session, role, work and setup entries. Stopped sessions
  retain their recorded status; the renderer distinguishes a structural route
  from the stopped-input admission or handoff condition at send time.
- IDs sort lexically in structured arrays; ancestor order remains the parent
  chain and input entries use stored message order. Readable rows use the role
  order above. Repeated membership appearances are references to one stored
  session, each labelled with its actual parent. Both views read one database
  snapshot. `--pretty` changes JSON whitespace only and may accompany
  `--for SESSION`; combining `--for` and `--view` refuses with usage, exit 2.
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
`semantic-synthesis` per section 7). Initialization instructions state the
attaching session's recorded role, parentage, Ensemble ownership and
membership, and that attachment assigns a Conductor role
(`mcp-conductor.mjs:391-444`).

### 3.5 Briefing layout

One native orientation function generates the briefing from stored records.
It is used by every entry path (section 5). Layout, in order:

1. Identity: session ID, public role, recorded parent and its public role,
   harness, model, workspace, branch. Label the parent as immediate Conductor
   only when its recorded role supports that label; otherwise show the
   incomplete setup and explicit next configuration from section 1.
2. Responsibility: one sentence derived from role (Player executes and
   reports; Associate Conductor coordinates its descendants; Principal
   coordinates the Orchestra).
3. Membership: owned Ensembles with coupling, member Ensembles, Sections
   with capabilities.
4. Permitted routes: the routing rules stated as the actual predicates of
   section 1 — report/ask to the recorded parent; a Conductor messages
   its descendants; peer messages need both parties' explicit membership in
   one shared tight Ensemble, with equal depth required only between two
   Conductors; Ensemble ownership alone grants no route; Section membership
   grants no route. Concrete IDs are named categorically: the immediate
   recorded parent always, and every peer route through each Ensemble the session
   belongs to, filtered through `message_route`. Parentless Conductor reports
   name the operator. Parentless Player report/ask names the prerequisite
   refusal and available setup inspection. Any further permitted sessions (for example a Conductor's
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
Conductor because reports route to the recorded parent. Root retains the
existing registered-parent admission (section 1).

The published example includes sibling Associates `development` and `review`,
and nested Associate `runtime` under `development`. The Principal owns
`direct`; each Associate owns its own Ensemble. The review Ensemble has
fidelity, architecture and acceptance Sections, each containing a critic and
a researcher. Every other Ensemble has two capability Sections with multiple
Players. The generated example uses the installed binary path and the caller's
selected harness configuration. This setup fragment defines that topology
using standard shell and public native commands. `BATON`, `DB`, `REPO`,
`BASE`, `WORKTREES`, `HARNESS`, `MODEL` and `EFFORT` are caller-selected
installation/workspace values; `principal` is the session already established
by the documented `start` command. Use fresh IDs and paths for the example:

```sh
for assignment in development:principal review:principal runtime:development; do
  id=${assignment%%:*}
  parent=${assignment#*:}
  "$BATON" "$DB" recruit "$id" "$parent" "$HARNESS" "$MODEL" "$EFFORT" \
    "$REPO" "example/$id" "$WORKTREES/$id" "$BASE"
  "$BATON" "$DB" role "$id" associate-conductor
done
for team in direct:principal development:development review:review runtime:runtime; do
  ensemble=${team%%:*}
  owner=${team#*:}
  "$BATON" "$DB" ensemble "$ensemble" "$owner" tight
  capabilities='implementation validation'
  if test "$ensemble" = review; then capabilities='fidelity architecture acceptance'; fi
  for capability in $capabilities; do
    "$BATON" "$DB" section "$ensemble" "$capability" "$owner" "$capability"
    for function in critic researcher; do
      player="$ensemble-$capability-$function"
      "$BATON" "$DB" recruit "$player" "$owner" "$HARNESS" "$MODEL" "$EFFORT" \
        "$REPO" "example/$player" "$WORKTREES/$player" "$BASE"
      "$BATON" "$DB" ensemble-member "$ensemble" "$owner" "$player" add
      "$BATON" "$DB" section-member "$ensemble" "$capability" "$owner" "$player" add
    done
  done
done
"$BATON" "$DB" orchestra --view
"$BATON" "$DB" orchestra --for review
```

The fragment runs under `sh`; help explains the supplied values and precedes
it with the complete `start` invocation. It follows with complete `receiver`/
`dispatch-file` and `dispatch-turn` examples, using an authored task file and
supported harness command. Receive-based examples configure each receiver
before dispatch. Independent branch dispatches are issued without joining
another Player's lifetime. Each task names its immediate report recipient
and retained task ID. Help shows `delivery ID`, `turns PLAYER`, `inbox PLAYER`,
`ack ID PLAYER RECEIPT` and `land-checked` with each argument explained.
Only reviewed changes are supplied to the landing example.

### 4.2 Setup operation rules

- The omitted-coupling form `ensemble ID OWNER` is an idempotent ensure: it
  creates the Ensemble with loose coupling when the ID is absent, and
  returns the stored row unchanged when the Ensemble already exists,
  whatever its coupling. The result marks the outcome explicitly:
  `created: true` on creation, `created: false` with the stored row on an
  existing Ensemble. Both cases require a registered owner with the stored
  Conductor role; an existing row additionally requires that exact recorded
  owner. The parser carries omission explicitly as a distinct
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
  to `DATABASE.direct-HEX(PLAYER)-HEX(TURN_ID)/prompt` before harness launch,
  and the adapter receives that file as `--prompt-file`. For Claude, the
  composed prompt is delivered as the stdin stream-json frame
  (`claude-player.bend:17-21`). A write failure of the composed-prompt
  artifact aborts the harness launch with a named host error; the task file
  is untouched. `Turn.choose`/`task_read`/`supervise` compose and retain it
  under the session lock; `Turn.prepare`/`finish` report a preparation failure
  and wake the parent. Direct turns currently have no retained attempt
  directory, so this is an explicit new file effect. Directory creation uses
  mode 0700, files use exclusive creation with mode 0600 and are flushed
  before launch. Existing files are retained and compared on replay; mismatched
  content produces a host-state conflict rather than overwriting evidence.
  The existing fresh-conversation recovery in `supervise_gone` writes a
  separately named `prompt-recovery` with regenerated orientation and the
  workspace recovery note. Muse's recovery launch receives that new path;
  stdin adapters receive the same retained bytes through their native frame.
  Replay of a completed turn reads its existing outcome and preserves prompts.
  `HEX` is lowercase hex of UTF-8 bytes, matching existing host path conventions.
  The result names the intended path and `promptState: "pending"` until the
  worker's successful write; `turns` derives retained paths by the turn's
  worker/ID and reports existing files without claiming an absent file exists.
  Claude, Codex and OMP direct turns use this same artifact before their native
  stdin envelope is sent. Receive already retains its composed prompt within
  the existing `DATABASE.attempt-HEX(ATTEMPT)/manifest`; that format remains
  owned by the retained-process mechanism. The orientation function supplies
  the same raw block on both paths. Operational artifacts are preserved with
  the corresponding logs and turn history; this feature introduces no cleanup.
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
`dispatch` and `dispatch-file` — commits through `Store.commit` with the
original `C.Message`, `C.Report` or `C.Ask` command and its route-gated SQL
in one transaction. `Report`/`Ask` resolve `report_recipient` within that
transaction; callers do not replace parent routing with a pre-read recipient.
After the stored refusal and stopped-input classification, the ordinary path
uses `Control.dispatch_admitted` and `Host.Control.launch` to start
`baton2 --dispatch-message DATABASE ID`. That worker enters `Control.deliver`
and `Delivery.deliver`. The public default's entry arms bypass
`main.run -> Store.apply -> Store.committed -> Delivery.after`, which joins
endpoint execution. Shared code is factored within these existing modules;
`Control.dispatch_body` and `dispatch_file` use that same commit/launch helper.
The public default returns acceptance of the committed input and
the delivery initiation without joining the recipient's managed lifetime.
The current implicit synchronous default (acceptance returns only after
endpoint exit on the registered-endpoint path) is replaced. The existing
M-12 laws cover the no-delivery and empty-endpoint branches; this
specification extends the same guarantee to the registered-endpoint branch.

- Shared acceptance result: `id`, `sender`, `recipient`, `kind`,
  `committed`, `deliveryPid`, `state`, `deliveryLog`, and `read` naming the
  retrieval commands (`delivery`, `inbox`, `turns`). `committed` is true
  only when the message row was stored before launch. The result names the
  actual delivery process, its log, the retained message ID and the native
  recovery operation. `deliveryLog` names stdout and stderr paths already
  produced by `baton_control_log`: `DATABASE.dispatch-HEX(ID).stdout` and
  `.stderr`. The delivery worker's existing aggregate log is `DATABASE.root.log`.
  A successful spawn answers `state: "launched"`; it establishes initiation
  only. `deliveryPid` is null if no process was launched. A stored receipt,
  successful endpoint exit and recipient review remain separately observed
  facts. An unacknowledged body stays pending after a successful endpoint exit.
- Caller-selected completion wait uses these exact forms, each accepting an
  optional final `--wait`: `message ID SENDER RECIPIENT KIND BODY`,
  `message-file ID SENDER RECIPIENT KIND PATH`, `report ID PLAYER BODY`,
  `ask ID PLAYER BODY`, `ask-file ID PLAYER PATH`,
  `dispatch ID SENDER RECIPIENT KIND BODY`, and
  `dispatch-file ID SENDER RECIPIENT KIND PATH`. `dispatch` is the new inline
  alias sharing message admission. Parsing uses positional arity: a required
  BODY equal to `--wait` stays a body; only the additional argument selects
  waiting. Unknown extra arguments refuse with usage and exit 2. File forms
  preserve `PATH -` stdin behavior. After the same `Store.commit` and refusal
  classification, `--wait` calls the shared `Delivery.deliver` endpoint path
  in the caller, returning `state: "endpoint-completed"` only after successful
  endpoint exit. It does not spawn a detached copy. Endpoint failure returns
  exit 1 with `committed: true` and the retained identity. MCP sending tools
  expose `wait: boolean` (default false) and append the flag only for true.
  Read-only queries and `ack` are outside this completion-wait grammar.
- Failure ownership. Admission refusal commits and launches nothing. A
  failure of `Host.Control.launch` after commit returns exit 1 to the live
  caller with `committed: true`, `state: "launch-failed"`, the retained ID,
  actual log paths, failure class and recovery command. The caller remains
  responsible for that unlaunched input and can report the failure normally.
  That result is not an acceptance of initiated delivery.
- A launched delivery worker observes both process-spawn IO failure and
  endpoint nonzero exit. `Control.deliver` must preserve the `Result` from
  `Delivery.deliver` and branch on it before `IO.try` can discard context.
  `Delivery.completed` must similarly preserve process IO failures and
  distinguish them from an observed nonzero exit. Each known failure is
  logged against the original ID and creates an ordinary retained report
  from the failed recipient to `report_recipient(recipient)`, following the
  existing `Delivery.handoff_sql` pattern. The report names the original ID,
  failed recipient, failure class, diagnostic file paths and exact recovery
  command. Its body excludes endpoint argv, original body and raw stderr.
  Its identity is `delivery-failed:HEX(ORIGINAL_ID):HEX(FAILED_RECIPIENT)`;
  first committed meaning is retained on retry, with later diagnostics in
  the existing delivery logs. The failed input's body and receipt are preserved.
- The worker immediately delivers that failure report through the same
  endpoint path. The recipient's recorded parent is the continuation owner;
  a parentless Conductor uses the registered operator via `report_recipient`.
  This rule is independent of whether the original sender has a parent.
  A notice that itself cannot be delivered is escalated by applying
  `report_recipient` to that failed owner and sending its report to the next
  existing parent. Carry the original ID and visited session IDs through
  this existing delivery traversal, stop at the operator or an absent/repeated
  parent, and retain every report. Termination follows the finite recorded
  parent chain, with no time or count cutoff. Stopped-parent handling composes
  with `Delivery.handoff`. No prefix-based suppression may leave an available
  ancestor unwoken. This is required new error handling in the existing
  delivery functions and ordinary message rows, not an observed baseline
  guarantee. The owner who receives the report decides whether to retry,
  reconfigure or stop the affected work.
- Missing endpoint is a known delivery prerequisite, not an endpoint crash.
  Acceptance exposes `state: "pending"`, null PID when no worker is needed,
  and the responsible owner and next operation. A direct-turn recipient's
  current turn remains the source of its parent wake; inspection never claims
  live input delivery. An idle recipient with retained work uses the same
  parent-report wake for missing receiver configuration. When parentage or
  operator setup provides no continuation owner, return
  `state: "continuation-unavailable"` with `committed: true` to the live
  caller before claiming initiated managed delivery, naming the missing
  setup. If all reachable owner endpoints fail after launch, retain the
  terminal diagnostic and every notification, explicitly mark continuation
  unavailable in inspection, and claim no successful wake. Complete host or
  storage failure can make observation unavailable; it is a failure of the
  execution environment, never evidence of successful continuation.
  Inspection derives failure/continuation facts from these retained reports,
  receipts and existing execution records. Diagnostic paths identify external
  evidence; their mere existence proves no outcome. An unexplained worker
  disappearance stays unresolved and names the responsible owner and logs.
- Recovery uses the existing exact-retry public command:
  `dispatch-file ID SENDER RECIPIENT KIND PATH`, with exactly the stored
  body from `delivery ID`. An unchanged retry preserves the row and retries
  its unacknowledged delivery; a conflicting meaning refuses, and an existing
  receipt suppresses endpoint redelivery. Help names the parameters and body
  retention requirement explicitly. The internal `--dispatch-message` worker
  remains internal; this feature adds no separate retry store or admission
  framework. Before retry after an uncertain process outcome, the owner
  inspects receipt, execution and logs and resolves whether the original
  endpoint is still running. Missing receipt alone never proves failure.
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
  for its owner's next explicit turn dispatch). A successful message commit is never
  presented as live steering.

`pending`, `inbox`, their MCP forms and the focused view each expose additive
`condition` and `next` on every pending input row. For a direct-turn Player
with no usable live-input route, `condition` states that the input is retained
and identifies the harness limitation. `next` names `delivery ID`,
`turns PLAYER` and the supported continuation: the owner supplies that retained
input to an explicitly dispatched next turn after the current turn's report.
The report wakes the recorded parent, which chooses continuation. The interface
does not claim that Muse consumes a newly committed message automatically at a
turn boundary. Empty-endpoint state is explicit, including the configuration
operation supported by that session's harness. `receipt` remains unchanged;
these fields report delivery prerequisites and confer no new route.

No new scheduling, parking, outcome store or duplicate routing mechanism is
introduced. Turn end continues to wake the recorded report recipient with the
report.

## 7. Runtime file ownership and handoff

Runtime file ownership follows root's continuation assignment and peer
confirmation `semantic-synthesis-control-confirm-1` in tight
`semantic-task-conductors`. These are exclusive editing boundaries after
root approves the feature:

- `semantic-synthesis` owns the shared coordinator files: `commands.bend`,
  `main.bend`, `bend2/scripts/mcp-conductor.mjs`, `package-native.py`,
  `store.bend` (including the refusal classifier), the `laws.bend`
  aggregation and the shared check-script wiring. This specification's
  changes to those files (parse variants, usage/help topics, refusal rows,
  view projections, tool descriptions, `baton2_orchestra` arguments,
  `baton2_delivery`, detached `baton2_guide`) land as reviewed handoffs:
  `semantic-controls-next` supplies exact patches, affected function names,
  base commit and validation commands;
  `semantic-synthesis` reviews, applies, verifies and lands them. This owner
  also owns `usage.bend`, `naming-laws.bend`, `messaging-laws.bend`, and shared
  naming/messaging/MCP/native-CLI tests. Control changes to those existing
  laws and tests use the same reviewed handoff.
- `semantic-controls-next` owns `receive.bend` (the shared orientation function
  and the briefing layout of section 3.5) and `turn.bend` (dispatch-turn
  prompt orientation and the composed-prompt artifact). The semantic-context
  orientation block is supplied by `semantic-synthesis` as content and rendered
  by the shared orientation function. The Conductor adapter briefing edits
  (`codex-conductor.mjs`, `omp-conductor.mjs`, section 5) are
  `semantic-controls-next` work landed as reviewed handoffs through
  `semantic-synthesis`, since the adapters are shared files.
- `semantic-controls-next` owns `control.bend`, `delivery.bend`,
  `host/control.bend`, `host/control.c`, `control-laws.bend`,
  `receive-laws.bend`, and control/delivery/receive/turn host tests. This
  includes detached admission, launch-result diagnostics, failure handoff,
  prompt retention and the real-function laws local to those modules.
  Changes to shared law imports and check registration are handed to
  `semantic-synthesis`. Semantic-context runtime operations using Control
  submit their exact handoffs to this owner.
- The root-authorized #669/#670 repair retains temporary exclusive ownership
  of its affected commands/receive/turn paths and associated laws/tests.
  Feature branches must compose and rebase on its independently reviewed
  repair before edits to those paths. `native-receive-conductor` supplies
  the repair pin; `semantic-synthesis` coordinates shared-file integration;
  `semantic-controls-next` verifies its briefing and delivery assumptions
  against that composed baseline. The repair does not authorize feature code.
- Distinct new feature test or law files are owned by their feature author;
  registration uses the shared owner. Existing files are governed by the
  explicit assignments above. Any newly discovered overlap is resolved by
  a reviewed handoff before editing it.
- Packaging prerequisite note: the Git identity helper's declared requirement
  is Node 22.15+ per `docs/bend2/installation.md` and
  `docs/bend2/harness-setup.md` (CI selects Node 22). The MCP adapter's qualified
  Node version is recorded with the candidate; the bare native
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
- Delivery failure: laws over `Control.deliver`'s result branch and the
  report/handoff builder preserve the original input and select the current
  `report_recipient`; the next delivery call names the committed notification.
  The parent-chain traversal progresses to a new recorded ancestor or returns
  an explicit unavailable result. Host checks establish the actual wake,
  endpoint-error capture and loop termination; SQL-builder equalities alone
  do not establish those effects.
- Orientation: the briefing contains the recorded parent, memberships and
  sections of its session; the receive and dispatch-turn paths compose the
  same orientation function output; the authored task body appears verbatim
  after the orientation block; a stale briefing grants no capability —
  stated at the send/admission functions (`message_route`/`message_sql`),
  with orientation composition laws in the receive laws.
- Prompt retention: the real `Turn.task_read`/`supervise`/recovery sequence
  composes the orientation and verbatim task, completes the named artifact
  write, then invokes the appropriate harness path. Write failure calls no
  harness start. Muse receives the retained file path; stdin adapters encode
  the retained content using their existing adapter functions.
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

For this run, root has supplied Bend 2.0.25 at
`.scratch/native-artifact-qualification-20261002T174637Z/toolchain-home/bin/bend`
in the root checkout. Build and proof use that isolated dependency through
`bend2/scripts/build-native.sh` and the full `bend2/scripts/laws-check.mjs`,
followed by `check-native` on the exact composition. Record compiler identity
with the candidate. This run's toolchain selection establishes no additional
product version requirement or toolchain installation task. Every compile
continues to import the operative laws. Root then requires independent review,
native fast-forward publication and remote readback.

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
  responsible party's observation path (section 6). Qualification must observe
  the owner's receive being invoked with the retained failure report. It also
  exercises an absent owner endpoint, a failing notification endpoint, stopped
  owner escalation, a parentless Conductor's operator route, missing operator
  setup and malformed cyclic ancestry. Known spawn IO failure and nonzero exit
  are separate cases. Retrying a notice preserves its first meaning; successful
  endpoint exit without `ack` remains pending. Uncertain worker disappearance
  does not authorize duplicate endpoint execution. These are effect assertions,
  not output-count or source-line assertions.

Native use is qualified by an installed cold-agent run:

- Environment contract: the candidate archive, manifest, binary and adapter
  hashes are recorded; external tool and harness versions are recorded; Node
  22.15+ is qualified for the Git identity helper and the actual Node version
  used for MCP is recorded; the install prefix is
  verified; package-relative adapter/native selection is verified with no
  development-checkout fallback; the MCP adapter's `serverInfo.version`
  (component version) is stated against the product release identity;
  "isolated" names which source and dependency paths are unavailable while
  harness authentication remains configured without displaying credential
  values. The existing smoke script supplies reusable extraction and
  isolation mechanics (`smoke-native-artifact.py:215-229,259-287`).
- An agent with only the installed tooling and its generated briefing
  constructs the topology in section 4.1: a Principal's direct Ensemble,
  multiple sibling Associates and a nested Associate, each with an owned
  Ensemble and multi-Player capability Sections. The review Ensemble has
  fidelity, architecture and acceptance Sections with independent critic and
  researcher Players. No instruction beyond the installed package and the generated
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
7. The composed dispatch-turn prompt is retained under the database's direct
   turn artifact path defined in section 5, named in the `dispatch-turn`
   result and `turns`; a write failure aborts harness launch and reports to
   the parent through the existing turn failure path.
8. Existing trusted-local role-write and registered-parent recruit admission
   remain in force per root's decision. Missing parent Conductor roles are
   incomplete setup with explicit configuration instructions.

## 10. Open items

- Direct-turn live steering: `Muse.input` is a no-op (evidence item 12), so
  a Muse direct turn has no live input route today; input is retained for
  the owner's next explicit turn dispatch. Claude's stdin input path (`turn.bend:141`) and
  OMP direct-turn input need host qualification before the interface
  advertises them. Committed input and live receipt stay distinct in every
  view.
- Semantic-context cross-references: the lead's stabilized names are
  `context-engines [--pretty]`, `context-query SESSION QUERY_ID REQUEST_JSON`,
  `context-query-file SESSION QUERY_ID PATH`, `context-result QUERY_ID [--pretty]`, and MCP
  tools `baton2_context_engines`, `baton2_context_query`,
  `baton2_context_result`. They cite sections 3.1-3.5 and 6; their unknown
  identity refusal names the absent record per section 3.2. Final
  cross-reference text lands when the semantic-context spec is committed.
- All six reviewers must review this exact successor independently before
  root's final feature review. That review and runtime/host qualification
  remain outstanding; this specification establishes no acceptance verdict.
