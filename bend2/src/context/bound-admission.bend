# CLAIM: the atomic bound admission of one managed semantic query. The lookup, the
# insert-if-absent and the read-back happen in one BEGIN IMMEDIATE transaction on
# one qualified connection, so no grant can occur between the decision and its
# commit: the run that created the row is told it created it, and a later caller
# with a different request sees the winner's recorded owner, canonical request,
# decision, state and attempt instead of inserting a second row.
#
# A failed bound call is an error, never an absence: the caller treats a failure or
# an unreadable answer as uncertain and reconciles it against the same binding
# before any effect. The answer row uses the store transport's own column shape, so
# no second JSON document is assembled here.
import Base
import ../coordinator/commands.bend as C
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx
import ./store.bend as ContextStore

# One committed admission decision and the row it left behind. `AdmissionCreated`
# means this transaction inserted the row; `AdmissionRetained` means the row already
# existed and its recorded values are returned. `AdmissionUncertain` means the
# answer could not be read as a complete row, which authorizes no effect.
type Admission is Data:
  AdmissionCreated{owner: String, request: String, decision: String, state: String, attempt: String}
  AdmissionRetained{owner: String, request: String, decision: String, state: String, attempt: String}
  AdmissionUncertain{answer: String}

# The answer row: whether this transaction created the row, then the recorded owner,
# canonical request, admission decision, state and origin attempt. `changes()` after
# the insert still refers to that insert because the read is a SELECT.
def admit_row_sql(+id: String) -> String:
  "SELECT CASE WHEN changes()=1 THEN 'created' ELSE 'retained' END,coalesce((SELECT owner FROM semantic_queries WHERE id=" ++ C.q(id) ++ "),''),coalesce((SELECT request_json FROM semantic_queries WHERE id=" ++ C.q(id) ++ "),''),coalesce((SELECT admission_decision FROM semantic_queries WHERE id=" ++ C.q(id) ++ "),''),coalesce((SELECT state FROM semantic_queries WHERE id=" ++ C.q(id) ++ "),''),coalesce((SELECT origin_attempt FROM semantic_queries WHERE id=" ++ C.q(id) ++ "),'');"

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

def admit_fields(+mark: String, fields: List<String>) -> Admission:
  match fields:
    case +owner <> more0:
      match more0:
        case +request <> more1:
          match more1:
            case +decision <> more2:
              match more2:
                case +state <> more3:
                  match more3:
                    case +attempt <> tail: admit_mark(mark, owner, request, decision, state, attempt)
                    case _: AdmissionUncertain{mark}
                case _: AdmissionUncertain{mark}
            case _: AdmissionUncertain{mark}
        case _: AdmissionUncertain{mark}
    case _: AdmissionUncertain{mark}

def admit_mark(+mark: String, +owner: String, +request: String, +decision: String, +state: String, +attempt: String) -> Admission:
  Bool.pick(Admission, String.eq(mark, "created"), AdmissionCreated{owner, request, decision, state, attempt},
  Bool.pick(Admission, String.eq(mark, "retained"), AdmissionRetained{owner, request, decision, state, attempt},
    AdmissionUncertain{mark}))

# The decode: one row of tab-separated columns, terminated by the transport's
# newline. A missing or short row is uncertain, never absent.
def admit_decode(+row: String) -> Admission:
  match Tx.split_lines(row):
    case Nil{}: AdmissionUncertain{row}
    case line <> rest:
      match Tx.split_tabs(line):
        case mark <> fields: admit_fields(mark, fields)
        case _: AdmissionUncertain{row}

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

# Whether a retained answer carries the caller's own owner and canonical request.
# A different owner or request is a conflict the caller must refuse; this predicate
# performs no effect and grants nothing.
def admit_identical(+admission: Admission, +expected_owner: String, +expected_request: String) -> Bool:
  match admission:
    case AdmissionCreated{owner, request, decision, state, attempt}: False{}
    case AdmissionRetained{owner, request, decision, state, attempt}:
      Bool.and(String.eq(owner, expected_owner), String.eq(request, expected_request))
    case AdmissionUncertain{answer}: False{}

# A safe rendering that names the decision and the retained attempt without echoing
# the canonical request body or the recorded owner.
def admit_text(admission: Admission) -> String:
  match admission:
    case AdmissionCreated{owner, request, decision, state, attempt}: "created:" ++ decision ++ ":" ++ state
    case AdmissionRetained{owner, request, decision, state, attempt}: "retained:" ++ decision ++ ":" ++ state ++ ":" ++ attempt
    case AdmissionUncertain{answer}: "uncertain"
