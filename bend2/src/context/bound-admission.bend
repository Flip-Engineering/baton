# CLAIM: the atomic bound admission of one managed semantic query and the
# same-binding read-back of its committed decision. The lookup, the insert-if-absent
# and the read-back happen in one BEGIN IMMEDIATE transaction on one qualified
# connection, so no grant can occur between the decision and its commit: the run
# that created the row is told it created it, and a later caller with a different
# request sees the winner's recorded owner, canonical request, decision, state,
# origin attempt and exact preparation instead of inserting a second row.
#
# The answer is one row of ten tab-separated columns read by a closed decoder: a
# surplus row, a short row, an unknown presence marker, an unknown state marker and
# a value outside its domain are each reported as uncertain with the stage that
# failed and the original answer; a successful read that proves absence is reported
# as absent. Missing, malformed and unknown therefore stay distinct from a committed
# grant, and a failed bound call stays a failure rather than an absence.
import Base
import ../coordinator/commands.bend as C
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx
import ./contracts.bend as Context
import ./store.bend as ContextStore

# One committed admission decision and the row it left behind. `AdmissionCreated`
# means this transaction inserted the row; `AdmissionRetained` means the row already
# existed and its recorded values are returned. `AdmissionAbsent` is a successful
# read that proved no row; `AdmissionUncertain` carries the failing stage
# (`empty`, `surplus`, `short`, `mark` or `domain`) and the original answer.
type Admission is Data:
  AdmissionCreated{owner: String, request: String, decision: String, state: String, attempt: String, keeperPath: String, cwd: String, artifactPath: String}
  AdmissionRetained{owner: String, request: String, decision: String, state: String, attempt: String, keeperPath: String, cwd: String, artifactPath: String}
  AdmissionAbsent{}
  AdmissionUncertain{stage: String, answer: String}

def admit_present(id: String) -> String:
  "EXISTS(SELECT 1 FROM semantic_queries WHERE id=" ++ C.q(id) ++ ")"

# Every value column is empty for an absent identity, so a present answer is the
# only one that carries recorded values.
def admit_column(+id: String, expression: String) -> String:
  "CASE WHEN " ++ admit_present(id) ++ " THEN " ++ expression ++ " ELSE '' END"

# The answer row: presence, then whether this transaction created the row, then the
# recorded owner, canonical request, admission decision, state, origin attempt and
# the exact preparation (prepared keeper path, cwd, artifact path). `changes()` still
# refers to the insert because the read is a SELECT.
def admit_row_sql(+id: String) -> String:
  "SELECT CASE WHEN " ++ admit_present(id) ++ " THEN 'present' ELSE 'absent' END," ++ admit_column(id, "CASE WHEN changes()=1 THEN 'created' ELSE 'retained' END") ++ "," ++ admit_column(id, "coalesce((SELECT owner FROM semantic_queries WHERE id=" ++ C.q(id) ++ "),'')") ++ "," ++ admit_column(id, "coalesce((SELECT request_json FROM semantic_queries WHERE id=" ++ C.q(id) ++ "),'')") ++ "," ++ admit_column(id, "coalesce((SELECT admission_decision FROM semantic_queries WHERE id=" ++ C.q(id) ++ "),'')") ++ "," ++ admit_column(id, "coalesce((SELECT state FROM semantic_queries WHERE id=" ++ C.q(id) ++ "),'')") ++ "," ++ admit_column(id, "coalesce((SELECT origin_attempt FROM semantic_queries WHERE id=" ++ C.q(id) ++ "),'')") ++ "," ++ admit_column(id, "coalesce((SELECT prepared_keeper_path FROM semantic_queries WHERE id=" ++ C.q(id) ++ "),'')") ++ "," ++ admit_column(id, "coalesce((SELECT cwd FROM semantic_queries WHERE id=" ++ C.q(id) ++ "),'')") ++ "," ++ admit_column(id, "coalesce((SELECT artifact_path FROM semantic_queries WHERE id=" ++ C.q(id) ++ "),'')") ++ ";"

# The whole admission: schema, the insert that runs only while the identity is
# absent, the retained row's read-back, and the commit. The transaction holds the
# database write lock across both statements, so a concurrent admission of the same
# identity resolves to exactly one row and this run's answer names what it did.
def admit_sql(+id: String, +owner: String, +requestJson: String, +keeperPath: String, +cwd: String, +originAttempt: String, +artifactPath: String) -> String:
  "BEGIN IMMEDIATE;" ++ ContextStore.schema()
  ++ "INSERT INTO semantic_queries(id,owner,request_json,admission_decision,prepared_keeper_path,cwd,origin_attempt,state,artifact_path) SELECT "
  ++ C.q(id) ++ "," ++ C.q(owner) ++ "," ++ C.q(requestJson) ++ ",'accepted'," ++ ContextStore.text_or_null(keeperPath) ++ "," ++ C.q(cwd) ++ "," ++ ContextStore.text_or_null(originAttempt) ++ ",'accepted'," ++ C.q(artifactPath)
  ++ " WHERE NOT EXISTS(SELECT 1 FROM semantic_queries WHERE id=" ++ C.q(id) ++ ");"
  ++ admit_row_sql(id) ++ "COMMIT;"

# The same-binding read-back: the identical ten-column answer for a committed
# decision, run on the qualified connection without writing a row.
def readback_sql(+id: String) -> String:
  "BEGIN IMMEDIATE;" ++ ContextStore.schema() ++ admit_row_sql(id) ++ "COMMIT;"

# The decision domain is the one the schema constrains; the state spelling comes
# from the canonical contract module rather than a second list here.
def admit_decision_ok(decision: String) -> Bool:
  Bool.or(String.eq(decision, "accepted"), String.eq(decision, "rejected"))

def admit_state_ok(state: String) -> Bool:
  Maybe.is_some(&2, Context.QueryState, Context.query_state_of(state))

def admit_domain(+owner: String, +request: String, +decision: String, +state: String, +cwd: String, +artifactPath: String) -> Bool:
  Bool.and(Bool.not(String.is_empty(owner)),
  Bool.and(Bool.not(String.is_empty(request)),
  Bool.and(admit_decision_ok(decision),
  Bool.and(admit_state_ok(state),
  Bool.and(Bool.not(String.is_empty(cwd)), Bool.not(String.is_empty(artifactPath)))))))

def admit_mark(+mark: String, +owner: String, +request: String, +decision: String, +state: String, +attempt: String, +keeperPath: String, +cwd: String, +artifactPath: String) -> Admission:
  Bool.pick(Admission, String.eq(mark, "created"), AdmissionCreated{owner, request, decision, state, attempt, keeperPath, cwd, artifactPath},
  Bool.pick(Admission, String.eq(mark, "retained"), AdmissionRetained{owner, request, decision, state, attempt, keeperPath, cwd, artifactPath},
    AdmissionUncertain{"mark", mark}))

def admit_checked(+mark: String, +owner: String, +request: String, +decision: String, +state: String, +attempt: String, +keeperPath: String, +cwd: String, +artifactPath: String) -> Admission:
  Bool.pick(Admission, admit_domain(owner, request, decision, state, cwd, artifactPath),
    admit_mark(mark, owner, request, decision, state, attempt, keeperPath, cwd, artifactPath),
    AdmissionUncertain{"domain", decision})

def all_empty(xs: List<String>) -> Bool:
  match xs:
    case Nil{}: True{}
    case h <> t: Bool.and(String.is_empty(h), all_empty(t))

# The nine columns after the presence marker, in order. A short or long row is
# uncertain rather than a record.
def admit_tabs(+fields: List<String>, +answer: String) -> Admission:
  match fields:
    case +mark <> more0:
      match more0:
        case +owner <> more1:
          match more1:
            case +request <> more2:
              match more2:
                case +decision <> more3:
                  match more3:
                    case +state <> more4:
                      match more4:
                        case +attempt <> more5:
                          match more5:
                            case +keeperPath <> more6:
                              match more6:
                                case +cwd <> more7:
                                  match more7:
                                    case +artifactPath <> more8:
                                      match more8:
                                        case Nil{}: admit_checked(mark, owner, request, decision, state, attempt, keeperPath, cwd, artifactPath)
                                        case _: AdmissionUncertain{"surplus", answer}
                                    case _: AdmissionUncertain{"short", answer}
                                case _: AdmissionUncertain{"short", answer}
                            case _: AdmissionUncertain{"short", answer}
                        case _: AdmissionUncertain{"short", answer}
                    case _: AdmissionUncertain{"short", answer}
                case _: AdmissionUncertain{"short", answer}
            case _: AdmissionUncertain{"short", answer}
        case _: AdmissionUncertain{"short", answer}
    case _: AdmissionUncertain{"short", answer}

def admit_line(+fields: List<String>, +rest: List<String>, +answer: String) -> Admission:
  match rest:
    case Nil{}: admit_answer(fields, answer)
    case _: AdmissionUncertain{"surplus", answer}

# The presence marker decides between a proven absence, which must carry no other
# value, and the recorded row the field decoder reads.
def admit_answer(+fields: List<String>, +answer: String) -> Admission:
  match fields:
    case +presence <> more:
      Bool.pick(Admission, String.eq(presence, "absent"),
        Bool.pick(Admission, all_empty(more), AdmissionAbsent{}, AdmissionUncertain{"surplus", answer}),
        Bool.pick(Admission, String.eq(presence, "present"), admit_tabs(more, answer), AdmissionUncertain{"mark", presence}))
    case _: AdmissionUncertain{"short", answer}

# The decode: exactly one row, and either the absence row or the ten present columns.
def admit_decode(+row: String) -> Admission:
  match Tx.split_lines(row):
    case Nil{}: AdmissionUncertain{"empty", row}
    case +line <> +rest: admit_line(Tx.split_tabs(line), rest, row)

def admit_after(result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,Admission>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Admission>, Fail{error})
    case Done{+rows}: IO.pure(Result<&1,&1,U32 & String,Admission>, Done{admit_decode(rows)})

# The admission operation. A failed bound call stays a failure; it is never
# reported as an absent record and it authorizes no launch.
def admit(+db: String, +binding: String, +id: String, +owner: String, +requestJson: String, +keeperPath: String, +cwd: String, +originAttempt: String, +artifactPath: String) -> IO(Result<&1,&1,U32 & String,Admission>):
  do IO<Result<&1,&1,U32 & String,Admission>>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, admit_sql(id, owner, requestJson, keeperPath, cwd, originAttempt, artifactPath))
    admit_after(result)

# The read-back of one committed decision on the same qualified binding.
def readback(+db: String, +binding: String, +id: String) -> IO(Result<&1,&1,U32 & String,Admission>):
  do IO<Result<&1,&1,U32 & String,Admission>>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, readback_sql(id))
    admit_after(result)

# Whether a retained answer carries the caller's own owner and canonical request.
# A different owner or request is a conflict the caller must refuse; this predicate
# performs no effect and grants nothing.
def admit_identical(+admission: Admission, +expected_owner: String, +expected_request: String) -> Bool:
  match admission:
    case AdmissionCreated{owner, request, decision, state, attempt, keeperPath, cwd, artifactPath}: False{}
    case AdmissionRetained{owner, request, decision, state, attempt, keeperPath, cwd, artifactPath}:
      Bool.and(String.eq(owner, expected_owner), String.eq(request, expected_request))
    case AdmissionAbsent{}: False{}
    case AdmissionUncertain{stage, answer}: False{}

# A safe rendering that names the decision, the state and the retained attempt
# without echoing the canonical request body or the recorded owner.
def admit_text(admission: Admission) -> String:
  match admission:
    case AdmissionCreated{owner, request, decision, state, attempt, keeperPath, cwd, artifactPath}: "created:" ++ decision ++ ":" ++ state
    case AdmissionRetained{owner, request, decision, state, attempt, keeperPath, cwd, artifactPath}: "retained:" ++ decision ++ ":" ++ state ++ ":" ++ attempt
    case AdmissionAbsent{}: "absent"
    case AdmissionUncertain{stage, answer}: "uncertain:" ++ stage
