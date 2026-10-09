# Context service operations for managed query admission, stored plan associations,
# retained query envelopes and catalog selection. Host failures retain their code and detail.
import Base
import ./text.bend as ContextText
import ./bound-admission.bend as ContextAdmit
import ./store.bend as ContextStore
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx
import ../coordinator/commands.bend as C

# Submission answers carry admission and plan data. Managed answers also carry
# artifact and bootstrap identity.
type Submission is Data:
  # A retained row whose stored identity equals the identity the caller supplied, carrying
  # the stored complete rendering and schema rather than the caller's proposed ones.
  SubmissionRetainedVerified{admission: ContextAdmit.Admission, planValue: String, resultSchema: String}
  SubmissionAdmitted{admission: ContextAdmit.Admission, proposedPlan: String, proposedSchema: String}
  SubmissionRetainedUnverified{admission: ContextAdmit.Admission, proposedPlan: String, proposedSchema: String}
  SubmissionPlanRefused{stage: String, reason: String}
  SubmissionRetainedRejected{admission: ContextAdmit.Admission, decision: String,
    state: String, owner: String, request: String}
  SubmissionManaged{admission: ContextAdmit.Admission, planValue: String,
    planIdentity: String, resultSchema: String, artifactSha256: String,
    bootstrapText: String}
  SubmissionManagedUncertain{stage: String, answer: String}
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
        case Nil{}: retained_tabs(query, ContextText.split_tabs(line), row)
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
def submission_retained(+expectedOwner: String, +expectedRequest: String, +plan: String, +resultSchema: String, +admission: ContextAdmit.Admission, +owner: String, +request: String, +decision: String, +state: String) -> Submission:
  Bool.pick(Submission, String.eq(decision, "accepted"),
    Bool.pick(Submission, ContextAdmit.admit_identical(admission, expectedOwner, expectedRequest), SubmissionRetainedUnverified{admission, plan, resultSchema}, SubmissionForeign{owner, request}),
    SubmissionRetainedRejected{admission, decision, state, owner, request})

def submission_of(+expectedOwner: String, +expectedRequest: String, +plan: String, +resultSchema: String, +admission: ContextAdmit.Admission) -> Submission:
  match admission:
    case ContextAdmit.AdmissionCreated{owner, request, decision, state, attempt, keeperPath, cwd, artifactPath}: SubmissionAdmitted{admission, plan, resultSchema}
    case ContextAdmit.AdmissionRetained{owner, request, decision, state, attempt, keeperPath, cwd, artifactPath}: submission_retained(expectedOwner, expectedRequest, plan, resultSchema, admission, owner, request, decision, state)
    case ContextAdmit.AdmissionAbsent{}: SubmissionAbsent{}
    case ContextAdmit.AdmissionUncertain{stage, answer}: SubmissionUncertain{stage, answer}

# The replay decision over the stored association. The stored identity is compared with
# the identity the caller supplied, which is the only comparison available without a
# parser: equal identities verify the retained association and return its stored rendering,
# a different identity refuses at the plan stage rather than attaching a fresh plan to a
# retained row, and a row that carries no association stays unestablished because nothing
# here can repair it.
def submission_stored(+expectedOwner: String, +expectedRequest: String, +plan: String, +admission: ContextAdmit.Admission, +planValue: String, +planIdentity: String, +storedSchema: String) -> Submission:
  match admission:
    case ContextAdmit.AdmissionCreated{owner, request, decision, state, attempt, keeperPath, cwd, artifactPath}: SubmissionAdmitted{admission, planValue, storedSchema}
    case ContextAdmit.AdmissionRetained{owner, request, decision, state, attempt, keeperPath, cwd, artifactPath}:
      Bool.pick(Submission, ContextAdmit.admit_identical(admission, expectedOwner, expectedRequest),
        Bool.pick(Submission, String.eq(planIdentity, plan), SubmissionRetainedVerified{admission, planValue, storedSchema}, SubmissionPlanRefused{"plan", "stale"}),
        submission_of(expectedOwner, expectedRequest, plan, storedSchema, admission))
    case _: SubmissionUncertain{"association", "unexpectedAdmission"}

def submission_replayed(+expectedOwner: String, +expectedRequest: String, +plan: String, +resultSchema: String, +admission: ContextAdmit.Admission, +association: ContextAdmit.Association) -> Submission:
  match association:
    case ContextAdmit.AssociationStored{planValue, planIdentity, storedSchema}: submission_stored(expectedOwner, expectedRequest, plan, admission, planValue, planIdentity, storedSchema)
    case ContextAdmit.AssociationMissing{}: submission_of(expectedOwner, expectedRequest, plan, resultSchema, admission)
    case ContextAdmit.AssociationMalformed{stage, answer}: SubmissionUncertain{stage, answer}

# The stored association decides the replay, and a failed read-back stays a host refusal
# rather than an absence: a row whose association cannot be read must not be answered as
# unestablished when the read failed.
def association_after(+expectedOwner: String, +expectedRequest: String, +identity: String, +resultSchema: String, +admission: ContextAdmit.Admission, result: Result<&1,&1,U32 & String,ContextAdmit.Association>) -> IO(Submission):
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

def managed_association_matches(+admission: ContextAdmit.Admission,
                                +expectedPlanValue: String, +expectedPlanIdentity: String,
                                +expectedResultSchema: String, +expectedArtifactSha: String,
                                +expectedBootstrapText: String,
                                association: ContextAdmit.ManagedAssociation) -> Submission:
  match association:
    case ContextAdmit.ManagedAssociationStored{+planValue, +planIdentity,
        +resultSchema, +artifactSha256, +bootstrapText}:
      Bool.pick(Submission,
        Bool.and(String.eq(expectedPlanValue, planValue),
        Bool.and(String.eq(expectedPlanIdentity, planIdentity),
        Bool.and(String.eq(expectedResultSchema, resultSchema),
        Bool.and(String.eq(expectedArtifactSha, artifactSha256),
          String.eq(expectedBootstrapText, bootstrapText))))),
        SubmissionManaged{admission, planValue, planIdentity,
          resultSchema, artifactSha256, bootstrapText},
        SubmissionManagedUncertain{"associationMismatch", bootstrapText})
    case ContextAdmit.ManagedAssociationMissing{}:
      SubmissionManagedUncertain{"associationMissing", ""}
    case ContextAdmit.ManagedAssociationMalformed{stage, answer}:
      SubmissionManagedUncertain{stage, answer}

def managed_admission_owner_matches(+admission: ContextAdmit.Admission,
                                   +expectedOwner: String, +expectedRequest: String) -> Bool:
  match admission:
    case ContextAdmit.AdmissionCreated{+owner, +request,
        decision, state, attempt, keeperPath, cwd, artifactPath}:
      Bool.and(String.eq(expectedOwner, owner), String.eq(expectedRequest, request))
    case ContextAdmit.AdmissionRetained{+owner, +request,
        decision, state, attempt, keeperPath, cwd, artifactPath}:
      ContextAdmit.admit_identical(admission, expectedOwner, expectedRequest)
    case _: False{}

def managed_association_result(+expectedOwner: String, +expectedRequest: String,
                               +planValue: String, +planIdentity: String,
                               +resultSchema: String, +artifactSha: String,
                               +bootstrapText: String, +admission: ContextAdmit.Admission,
                               result: Result<&1,&1,U32 & String,ContextAdmit.ManagedAssociation>) -> IO(Submission):
  match result:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(Submission, SubmissionRefused{code, detail})
    case Done{+association}:
      Bool.pick(IO(Submission), managed_admission_owner_matches(admission,
        expectedOwner, expectedRequest),
        IO.pure(Submission, managed_association_matches(admission, planValue, planIdentity,
          resultSchema, artifactSha, bootstrapText, association)),
        IO.pure(Submission, SubmissionForeign{"", ""}))

def managed_admitted_stored(+db: String, +binding: String, +id: String,
                            +expectedOwner: String, +expectedRequestJson: String,
                            +planValue: String, +planIdentity: String,
                            +resultSchema: String, +artifactSha: String,
                            +bootstrapText: String,
                            admissionResult: Result<&1,&1,U32 & String,ContextAdmit.Admission>) -> IO(Submission):
  match admissionResult:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(Submission, SubmissionRefused{code, detail})
    case Done{+admission}:
      match admission:
        case ContextAdmit.AdmissionCreated{+owner, +request,
             decision, state, attempt, keeperPath, cwd, artifactPath}:
          do IO<Submission>:
            association : Result<&1,&1,U32 & String,ContextAdmit.ManagedAssociation> <-
              ContextAdmit.readback_managed_association(db, binding, id)
            managed_association_result(expectedOwner, expectedRequestJson, planValue, planIdentity,
              resultSchema, artifactSha, bootstrapText, admission, association)
        case ContextAdmit.AdmissionRetained{+owner, +request,
             decision, state, attempt, keeperPath, cwd, artifactPath}:
          do IO<Submission>:
            association : Result<&1,&1,U32 & String,ContextAdmit.ManagedAssociation> <-
              ContextAdmit.readback_managed_association(db, binding, id)
            managed_association_result(expectedOwner, expectedRequestJson, planValue, planIdentity,
              resultSchema, artifactSha, bootstrapText, admission, association)
        case ContextAdmit.AdmissionAbsent{}: IO.pure(Submission, SubmissionAbsent{})
        case ContextAdmit.AdmissionUncertain{stage, answer}:
          IO.pure(Submission, SubmissionUncertain{stage, answer})

def admitted_managed_associated(+db: String, +binding: String, +id: String,
                                +owner: String, +requestJson: String,
                                +keeperPath: String, +cwd: String,
                                +originAttempt: String, +artifactPath: String,
                                +planValue: String, +planIdentity: String,
                                +resultSchema: String, +artifactSha: String,
                                +bootstrapText: String) -> IO(Submission):
  do IO<Submission>:
    answer : Result<&1,&1,U32 & String,ContextAdmit.Admission> <-
      ContextAdmit.admit_managed_associated(db, binding, id, owner, requestJson,
        keeperPath, cwd, originAttempt, artifactPath, planValue, planIdentity,
        resultSchema, artifactSha, bootstrapText)
    managed_admitted_stored(db, binding, id, owner, requestJson, planValue,
      planIdentity, resultSchema, artifactSha, bootstrapText, answer)


def discover_result(selected: Result<&1,&1,U32 & String,String>) -> IO(Discovery):
  match selected:
    case Done{+document}: IO.pure(Discovery, DiscoverySelected{document})
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(Discovery, DiscoveryRefused{code, detail})

def discover(catalog: Unit -> IO(Result<&1,&1,U32 & String,String>)) -> IO(Discovery):
  do IO<Discovery>:
    selected : Result<&1,&1,U32 & String,String> <- catalog(Unit{})
    discover_result(selected)
