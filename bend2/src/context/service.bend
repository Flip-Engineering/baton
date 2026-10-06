# CLAIM: the context service companion for the native context operations. It submits one
# query through validated admission, reads the retained envelope of one query with its state,
# and performs passive discovery through a supplied catalog selection, with every failure
# keeping its original code and detail.
#
# The Core plan validation and the catalog selection arrive as supplied operands, because
# Core's modules are not part of this worktree's closure and this module invents no bridge to
# them. A pure plan decision is validation, not an effect callable. The catalog operand stays
# unconnected until the actual passive catalog consumer is bound.
#
# Reference expansion is not restated here: ContextStore.ref_lookup is the typed ref access of
# this service, with its own staged answers and its own host failure.
import Base
import ./bound-admission.bend as ContextAdmit
import ./store.bend as ContextStore
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx
import ../coordinator/commands.bend as C

# What one submission concluded. Every admission variant is carried as itself: an answer this
# run created, a retained row whose owner and request are the caller's own, a retained row
# that belongs to another owner or request, a read-back absence, and uncertainty with its
# stage and raw answer.
# The admitted plan decision Core's verdict produces, as this lane can consume it. Every value here is
# the caller's proposed carrier and this lane neither interprets it nor treats it as a retained
# association.
#
# Core publishes two renderings and they answer different questions. The association this lane carries
# must be the complete rendering, Wire.plan_value(plan), because it has to be written atomically with
# creation and read back as the original frozen plan. Comparisons use Wire.plan_identity(plan), which
# renders only the members that decide what will run and therefore treats two plans that differ only in
# observed availability or in their captured records as the same plan.
#
# The identity text establishes equality between two renderings and nothing more. A caller holding the
# same member values can reproduce it, so equal caller supplied text authorizes nothing here; Core
# provides no parser, and reconstruction from the text belongs to the parsing owner. A literal
# placeholder cannot be told from a real rendering by this lane, so a placeholder refuses where the
# association is actually compared, in the retained comparison below, not in the presence check here:
# an empty identity is an absent association and refuses before any row is created, while any other
# value is carried unexamined.
#
# The refusal carries Core's literal stage together with Core's reason as this lane's own carrier, and
# that is all it carries literally: this value holds a reason string, and no mapper to a code and a
# detail exists in this lane. Core's AdmissionRefuses derives that code and detail from the same reason
# and keeps the typed reason under native173, so connecting the two is Core's to supply rather than
# something this comment may claim.
#
# The dependency this lane waits on is the Codec decode of the admitted canonical request into
# Sel.RequestOperands plus the request text; Sel.ProjectState is configured, inventoried or observed and
# is supplied by its own owner separately, assembled through Sel.sel_inputs, never as request authority.
type PlanDecision is Data:
  PlanAdmits{proposedPlan: String, proposedSchema: String}
  PlanRefuses{stage: String, reason: String}

# The plan and schema arrive as the caller's lossless carrier of the frozen plan, whose exact
# representation must be agreed with Core; this lane never interprets them.
type Submission is Data:
  # A retained row whose stored identity equals the identity the caller supplied, carrying
  # the stored complete rendering and schema rather than the caller's proposed ones.
  SubmissionRetainedVerified{admission: ContextAdmit.Admission, planValue: String, resultSchema: String}
  SubmissionAdmitted{admission: ContextAdmit.Admission, proposedPlan: String, proposedSchema: String}
  SubmissionRetainedUnverified{admission: ContextAdmit.Admission, proposedPlan: String, proposedSchema: String}
  SubmissionPlanRefused{stage: String, reason: String}
  SubmissionRetainedRejected{decision: String, state: String, owner: String, request: String}
  SubmissionAbsent{}
  SubmissionForeign{owner: String, request: String}
  SubmissionRefused{code: U32, detail: String}
  SubmissionUncertain{stage: String, answer: String}

# What one retained read concluded, from a single statement so the state and the envelope
# describe the same row. An empty present envelope and a non-empty absent row are malformed
# answers rather than found or absent ones.
type Retained is Data:
  RetainedFound{state: String, envelope: String}
  RetainedAbsent{query: String}
  RetainedUnreadable{stage: String, answer: String}
  RetainedRefused{code: U32, detail: String}

# What passive discovery concluded. The selection document is the supplied catalog answer;
# this module starts no target and no module for discovery.
type Discovery is Data:
  DiscoverySelected{document: String}
  DiscoveryRefused{code: U32, detail: String}

# The retained read of one query: whether the row exists, its state, and its envelope. The
# envelope expression is the unterminated body, because the terminated statement cannot be
# embedded inside a scalar subquery. The envelope is one line of JSON, so the row framing
# cannot be broken by its content.
def retained_sql(+query: String) -> String:
  "SELECT CASE WHEN EXISTS(SELECT 1 FROM semantic_queries WHERE id=" ++ C.q(query) ++ ") THEN 'present' ELSE 'absent' END,"
  ++ "coalesce((SELECT state FROM semantic_queries WHERE id=" ++ C.q(query) ++ "),''),"
  ++ "coalesce((" ++ ContextStore.envelope_body_sql(query) ++ "),'');"

def retained_absent_shape(+query: String, +state: String, +envelope: String, +answer: String) -> Retained:
  Bool.pick(Retained, Bool.and(String.is_empty(state), String.is_empty(envelope)), RetainedAbsent{query}, RetainedUnreadable{"absentShape", answer})

def retained_present_document(+query: String, +state: String, +envelope: String, +answer: String) -> Retained:
  Bool.pick(Retained, String.starts_with(envelope, "{"), RetainedFound{state, envelope}, RetainedUnreadable{"envelopeShape", answer})

def retained_present_shape(+query: String, +state: String, +envelope: String, +answer: String) -> Retained:
  Bool.pick(Retained, String.is_empty(envelope), RetainedUnreadable{"presentEnvelope", answer},
  Bool.pick(Retained, ContextAdmit.admit_state_ok(state), retained_present_document(query, state, envelope, answer), RetainedUnreadable{"stateDomain", answer}))

def retained_answer(+query: String, +presence: String, +state: String, +envelope: String, +answer: String) -> Retained:
  Bool.pick(Retained, String.eq(presence, "absent"), retained_absent_shape(query, state, envelope, answer),
  Bool.pick(Retained, String.eq(presence, "present"), retained_present_shape(query, state, envelope, answer), RetainedUnreadable{"presence", answer}))

def retained_tabs(+query: String, fields: List<String>, +answer: String) -> Retained:
  match fields:
    case +presence <> more0:
      match more0:
        case +state <> more1:
          match more1:
            case +envelope <> more2:
              match more2:
                case Nil{}: retained_answer(query, presence, state, envelope, answer)
                case _: RetainedUnreadable{"surplus", answer}
            case _: RetainedUnreadable{"short", answer}
        case _: RetainedUnreadable{"short", answer}
    case _: RetainedUnreadable{"short", answer}

def retained_lines(+query: String, +row: String, lines: List<String>) -> Retained:
  match lines:
    case Nil{}: RetainedUnreadable{"empty", row}
    case +line <> rest:
      match rest:
        case Nil{}: retained_tabs(query, Tx.split_tabs(line), row)
        case _: RetainedUnreadable{"surplus", row}

# The rows are bound before they are inspected, so the scrutinee is a parameter.
def retained_decode(+query: String, +row: String) -> Retained:
  retained_lines(query, row, Tx.split_lines(row))

def retained_after(+query: String, result: Result<&1,&1,U32 & String,String>) -> IO(Retained):
  match result:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(Retained, RetainedRefused{code, detail})
    case Done{+rows}: IO.pure(Retained, retained_decode(query, rows))

# The retained envelope of one query, read on the qualified connection.
def retained(+db: String, +binding: String, +query: String) -> IO(Retained):
  do IO<Retained>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, retained_sql(query))
    retained_after(query, result)

# A retained row is admitted only when its owner and request are the caller's own.
def submission_retained(+expectedOwner: String, +expectedRequest: String, +plan: String, +resultSchema: String, admission: ContextAdmit.Admission, +owner: String, +request: String, +decision: String, +state: String) -> Submission:
  Bool.pick(Submission, String.eq(decision, "accepted"),
    Bool.pick(Submission, ContextAdmit.admit_identical(admission, expectedOwner, expectedRequest), SubmissionRetainedUnverified{admission, plan, resultSchema}, SubmissionForeign{owner, request}),
    SubmissionRetainedRejected{decision, state, owner, request})

def submission_of(+expectedOwner: String, +expectedRequest: String, +plan: String, +resultSchema: String, admission: ContextAdmit.Admission) -> Submission:
  match admission:
    case ContextAdmit.AdmissionCreated{owner, request, decision, state, attempt, keeperPath, cwd, artifactPath}: SubmissionAdmitted{admission, plan, resultSchema}
    case ContextAdmit.AdmissionRetained{owner, request, decision, state, attempt, keeperPath, cwd, artifactPath}: submission_retained(expectedOwner, expectedRequest, plan, resultSchema, admission, owner, request, decision, state)
    case ContextAdmit.AdmissionAbsent{}: SubmissionAbsent{}
    case ContextAdmit.AdmissionUncertain{stage, answer}: SubmissionUncertain{stage, answer}

def submission_after(+expectedOwner: String, +expectedRequest: String, +plan: String, +resultSchema: String, result: Result<&1,&1,U32 & String,ContextAdmit.Admission>) -> IO(Submission):
  match result:
    case Done{+admission}: IO.pure(Submission, submission_of(expectedOwner, expectedRequest, plan, resultSchema, admission))
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(Submission, SubmissionRefused{code, detail})

# One submission: the Core plan validation runs first and a refusal there creates no row, then
# the atomic admission creates or replays the row and its answer is dispatched as itself.
# Presence only: an empty identity is an absent association. Any other value is carried unexamined,
# because a caller supplied rendering authorizes nothing here on its own.
def plan_identity_present(+identity: String) -> Bool:
  Bool.not(String.is_empty(identity))

def admitted(+db: String, +binding: String, +id: String, +owner: String, +requestJson: String, +keeperPath: String, +cwd: String, +originAttempt: String, +artifactPath: String, +plan: String, +resultSchema: String) -> IO(Submission):
  do IO<Submission>:
    answer : Result<&1,&1,U32 & String,ContextAdmit.Admission> <- ContextAdmit.admit(db, binding, id, owner, requestJson, keeperPath, cwd, originAttempt, artifactPath)
    submission_after(owner, requestJson, plan, resultSchema, answer)

# The stored association decides the replay, and a failed read-back stays a host refusal
# rather than an absence: a row whose association cannot be read must not be answered as
# unestablished when the read failed.
def association_after(+expectedOwner: String, +expectedRequest: String, +identity: String, +resultSchema: String, admission: ContextAdmit.Admission, result: Result<&1,&1,U32 & String,ContextAdmit.Association>) -> IO(Submission):
  match result:
    case Done{+association}: IO.pure(Submission, submission_replayed(expectedOwner, expectedRequest, identity, resultSchema, admission, association))
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(Submission, SubmissionRefused{code, detail})

# A created or retained row is known before the association is read, so the read runs only
# after the admission answered.
def admitted_stored(+expectedOwner: String, +expectedRequest: String, +identity: String, +resultSchema: String, +db: String, +binding: String, +id: String, result: Result<&1,&1,U32 & String,ContextAdmit.Admission>) -> IO(Submission):
  match result:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(Submission, SubmissionRefused{code, detail})
    case Done{+admission}:
      do IO<Submission>:
        stored : Result<&1,&1,U32 & String,ContextAdmit.Association> <- ContextAdmit.readback_association(db, binding, id)
        association_after(expectedOwner, expectedRequest, identity, resultSchema, admission, stored)

# The submission that records the association. `planValue` is the complete rendering the
# creating transaction stores as the carrier and `identity` is the rendering over the
# members that decide what will run, which is what a replay compares; the association is
# written in the same BEGIN IMMEDIATE as the query row and read back for the answer.
def admitted_associated(+db: String, +binding: String, +id: String, +owner: String, +requestJson: String, +keeperPath: String, +cwd: String, +originAttempt: String, +artifactPath: String, +planValue: String, +identity: String, +resultSchema: String) -> IO(Submission):
  do IO<Submission>:
    answer : Result<&1,&1,U32 & String,ContextAdmit.Admission> <- ContextAdmit.admit_associated(db, binding, id, owner, requestJson, keeperPath, cwd, originAttempt, artifactPath, planValue, identity, resultSchema)
    admitted_stored(owner, requestJson, identity, resultSchema, db, binding, id, answer)

# The presence of the identity is bound before it is inspected, so the scrutinee is a
# parameter and the IO action is chosen inside the match: an absent identity refuses in
# this branch and reaches no bound call, and a present one proceeds to the admission.
def submit_identified(+absent: Bool, +db: String, +binding: String, +id: String, +owner: String, +requestJson: String, +keeperPath: String, +cwd: String, +originAttempt: String, +artifactPath: String, +plan: String, +resultSchema: String) -> IO(Submission):
  match absent:
    case True{}: IO.pure(Submission, SubmissionPlanRefused{"plan", "absent"})
    case False{}: admitted(db, binding, id, owner, requestJson, keeperPath, cwd, originAttempt, artifactPath, plan, resultSchema)

def submit(+db: String, +binding: String, +id: String, +owner: String, +requestJson: String, +keeperPath: String, +cwd: String, +originAttempt: String, +artifactPath: String, decision: PlanDecision) -> IO(Submission):
  match decision:
    case PlanRefuses{stage, reason}: IO.pure(Submission, SubmissionPlanRefused{stage, reason})
    case PlanAdmits{proposedPlan, proposedSchema}:
      submit_identified(plan_identity_present(proposedPlan), db, binding, id, owner, requestJson, keeperPath, cwd, originAttempt, artifactPath, proposedPlan, proposedSchema)

# The replay decision over the stored association. The stored identity is compared with
# the identity the caller supplied, which is the only comparison available without a
# parser: equal identities verify the retained association and return its stored rendering,
# a different identity refuses at the plan stage rather than attaching a fresh plan to a
# retained row, and a row that carries no association stays unestablished because nothing
# here can repair it.
def submission_stored(+expectedOwner: String, +expectedRequest: String, +plan: String, admission: ContextAdmit.Admission, +planValue: String, +planIdentity: String, +storedSchema: String) -> Submission:
  match admission:
    case ContextAdmit.AdmissionCreated{owner, request, decision, state, attempt, keeperPath, cwd, artifactPath}: SubmissionAdmitted{admission, planValue, storedSchema}
    case ContextAdmit.AdmissionRetained{owner, request, decision, state, attempt, keeperPath, cwd, artifactPath}:
      Bool.pick(Submission, ContextAdmit.admit_identical(admission, expectedOwner, expectedRequest),
        Bool.pick(Submission, String.eq(planIdentity, plan), SubmissionRetainedVerified{admission, planValue, storedSchema}, SubmissionPlanRefused{"plan", "stale"}),
        submission_of(expectedOwner, expectedRequest, plan, storedSchema, admission))
    case _: SubmissionUncertain{"association", "unexpectedAdmission"}

def submission_replayed(+expectedOwner: String, +expectedRequest: String, +plan: String, +resultSchema: String, admission: ContextAdmit.Admission, association: ContextAdmit.Association) -> Submission:
  match association:
    case ContextAdmit.AssociationStored{planValue, planIdentity, resultSchema: storedSchema}: submission_stored(expectedOwner, expectedRequest, plan, admission, planValue, planIdentity, storedSchema)
    case ContextAdmit.AssociationMissing{}: submission_of(expectedOwner, expectedRequest, plan, resultSchema, admission)
    case ContextAdmit.AssociationMalformed{stage, answer}: SubmissionUncertain{stage, answer}

def discover(catalog: Unit -> IO(Result<&1,&1,U32 & String,String>)) -> IO(Discovery):
  do IO<Discovery>:
    selected : Result<&1,&1,U32 & String,String> <- catalog(Unit{})
    match selected:
      case Done{+document}: IO.pure(Discovery, DiscoverySelected{document})
      case Fail{error}:
        match error:
          case (code, detail): IO.pure(Discovery, DiscoveryRefused{code, detail})
