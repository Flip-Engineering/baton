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
# The admitted plan decision Core's verdict produces, as this lane can consume it: the frozen plan and
# the result schema identity as text, or a typed refusal carrying Core's stage, code and detail. The
# caller maps Sel.AdmissionDecision into this value; this lane imports no Core closure and the request
# text is never parsed here.
type PlanDecision is Data:
  PlanAdmits{plan: String, resultSchema: String}
  PlanRefuses{stage: String, code: String, detail: String}

type Submission is Data:
  SubmissionAdmitted{admission: ContextAdmit.Admission, plan: String, resultSchema: String}
  SubmissionPlanRefused{stage: String, code: String, detail: String}
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
    Bool.pick(Submission, ContextAdmit.admit_identical(admission, expectedOwner, expectedRequest), SubmissionAdmitted{admission, plan, resultSchema}, SubmissionForeign{owner, request}),
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
def submit(+db: String, +binding: String, +id: String, +owner: String, +requestJson: String, +keeperPath: String, +cwd: String, +originAttempt: String, +artifactPath: String, decision: PlanDecision) -> IO(Submission):
  match decision:
    case PlanRefuses{stage, code, detail}: IO.pure(Submission, SubmissionPlanRefused{stage, code, detail})
    case PlanAdmits{plan, resultSchema}: admitted(db, binding, id, owner, requestJson, keeperPath, cwd, originAttempt, artifactPath, plan, resultSchema)

def admitted(+db: String, +binding: String, +id: String, +owner: String, +requestJson: String, +keeperPath: String, +cwd: String, +originAttempt: String, +artifactPath: String, +plan: String, +resultSchema: String) -> IO(Submission):
  do IO<Submission>:
    answer : Result<&1,&1,U32 & String,ContextAdmit.Admission> <- ContextAdmit.admit(db, binding, id, owner, requestJson, keeperPath, cwd, originAttempt, artifactPath)
    submission_after(owner, requestJson, plan, resultSchema, answer)

def discover(catalog: Unit -> IO(Result<&1,&1,U32 & String,String>)) -> IO(Discovery):
  do IO<Discovery>:
    selected : Result<&1,&1,U32 & String,String> <- catalog(Unit{})
    match selected:
      case Done{+document}: IO.pure(Discovery, DiscoverySelected{document})
      case Fail{error}:
        match error:
          case (code, detail): IO.pure(Discovery, DiscoveryRefused{code, detail})
