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

# The retained association of one committed admission. `AssociationStored` is the plan
# rendering and result schema the creating transaction recorded; `AssociationMissing` is a
# row that carries none, which is how a database created before any association existed
# answers; `AssociationMalformed` keeps the failing stage and the raw answer.
type Association is Data:
  AssociationStored{planValue: String, planIdentity: String, resultSchema: String}
  AssociationMissing{}
  AssociationMalformed{stage: String, answer: String}

def hex_digit_ok(c: Char) -> Bool:
  +code = Char.to_u32(c)
  Bool.or(Bool.and(U32.is_lt(47, code), U32.is_lt(code, 58)),
  Bool.or(Bool.and(U32.is_lt(64, code), U32.is_lt(code, 71)),
          Bool.and(U32.is_lt(96, code), U32.is_lt(code, 103))))

# Framing is hex in whole bytes: a value with an odd count or a character outside the hex
# alphabet is malformed rather than decoded.
def hex_ok(s: String) -> Bool:
  match s:
    case SNil{}: True{}
    case SCon{a, rest}:
      match rest:
        case SNil{}: False{}
        case SCon{b, more}: Bool.and(Bool.and(hex_digit_ok(a), hex_digit_ok(b)), hex_ok(more))

def association_mark(+mark: String, +plan: String, +identity: String, +schema: String, +answer: String) -> Association:
  Bool.pick(Association, String.eq(mark, "absent"),
    Bool.pick(Association, Bool.and(Bool.and(String.is_empty(plan), String.is_empty(identity)), String.is_empty(schema)), AssociationMissing{}, AssociationMalformed{"shape", answer}),
  Bool.pick(Association, String.eq(mark, "present"),
    Bool.pick(Association, Bool.and(Bool.and(hex_ok(plan), hex_ok(identity)), hex_ok(schema)), AssociationStored{Tx.hex_decode(plan), Tx.hex_decode(identity), Tx.hex_decode(schema)}, AssociationMalformed{"framing", answer}),
    AssociationMalformed{"mark", answer}))

def association_fields(fields: List<String>, +answer: String) -> Association:
  match fields:
    case +mark <> more0:
      match more0:
        case +plan <> more1:
          match more1:
            case +identity <> more2:
              match more2:
                case +schema <> more3:
                  match more3:
                    case Nil{}: association_mark(mark, plan, identity, schema, answer)
                    case _: AssociationMalformed{"surplus", answer}
                case _: AssociationMalformed{"short", answer}
            case _: AssociationMalformed{"short", answer}
        case _: AssociationMalformed{"short", answer}
    case _: AssociationMalformed{"short", answer}

def association_decode_lines(lines: List<String>, +answer: String) -> Association:
  match lines:
    case Nil{}: AssociationMalformed{"empty", answer}
    case +line <> +rest:
      match rest:
        case Nil{}: association_fields(Tx.split_tabs(line), answer)
        case _: AssociationMalformed{"surplus", answer}

def association_decode(+row: String) -> Association:
  association_decode_lines(Tx.split_lines(row), row)

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
def admit_query_insert_sql(+id: String, +owner: String, +requestJson: String, +keeperPath: String, +cwd: String, +originAttempt: String, +artifactPath: String) -> String:
  "INSERT INTO semantic_queries(id,owner,request_json,admission_decision,prepared_keeper_path,cwd,origin_attempt,state,artifact_path) SELECT "
  ++ C.q(id) ++ "," ++ C.q(owner) ++ "," ++ C.q(requestJson) ++ ",'accepted'," ++ ContextStore.text_or_null(keeperPath) ++ "," ++ C.q(cwd) ++ "," ++ ContextStore.text_or_null(originAttempt) ++ ",'accepted'," ++ C.q(artifactPath)
  ++ " WHERE NOT EXISTS(SELECT 1 FROM semantic_queries WHERE id=" ++ C.q(id) ++ ");"

def admit_sql(+id: String, +owner: String, +requestJson: String, +keeperPath: String, +cwd: String, +originAttempt: String, +artifactPath: String) -> String:
  "BEGIN IMMEDIATE;" ++ ContextStore.schema() ++ admit_query_insert_sql(id, owner, requestJson, keeperPath, cwd, originAttempt, artifactPath) ++ admit_row_sql(id) ++ "COMMIT;"

# The same atomic admission, additionally recording the admitted plan rendering and its
# result schema. The association insert is the statement between the query insert and the
# read-back, so `changes()` still refers to the query insert and the association is
# written only by the run that created the row, inside the same BEGIN IMMEDIATE.
def admit_associated_sql(+id: String, +owner: String, +requestJson: String, +keeperPath: String, +cwd: String, +originAttempt: String, +artifactPath: String, +planValue: String, +planIdentity: String, +resultSchema: String) -> String:
  "BEGIN IMMEDIATE;" ++ ContextStore.schema() ++ admit_query_insert_sql(id, owner, requestJson, keeperPath, cwd, originAttempt, artifactPath) ++ ContextStore.association_insert_sql(id, planValue, planIdentity, resultSchema, originAttempt) ++ admit_row_sql(id) ++ "COMMIT;"


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

def admit_mark(+mark: String, +owner: String, +request: String, +decision: String, +state: String, +attempt: String, +keeperPath: String, +cwd: String, +artifactPath: String, +answer: String) -> Admission:
  Bool.pick(Admission, String.eq(mark, "created"), AdmissionCreated{owner, request, decision, state, attempt, keeperPath, cwd, artifactPath},
  Bool.pick(Admission, String.eq(mark, "retained"), AdmissionRetained{owner, request, decision, state, attempt, keeperPath, cwd, artifactPath},
    AdmissionUncertain{"mark", answer}))

def admit_checked(+mark: String, +owner: String, +request: String, +decision: String, +state: String, +attempt: String, +keeperPath: String, +cwd: String, +artifactPath: String, +answer: String) -> Admission:
  Bool.pick(Admission, admit_domain(owner, request, decision, state, cwd, artifactPath),
    admit_mark(mark, owner, request, decision, state, attempt, keeperPath, cwd, artifactPath, answer),
    AdmissionUncertain{"domain", answer})

def field_count(xs: List<String>, acc: U32) -> U32:
  match xs:
    case Nil{}: acc
    case h <> t: field_count(t, U32.add(acc, 1))

# An absent answer carries the same ten columns as a present one, with every value
# column empty, so a one-column answer is not an absence.
def all_empty(xs: List<String>) -> Bool:
  match xs:
    case Nil{}: True{}
    case h <> t: Bool.and(String.is_empty(h), all_empty(t))

# The nine columns after the presence marker, in order. A short or long row is
# uncertain rather than a record.
def nine_values_absent(values: List<String>) -> Bool:
  Bool.and(U32.is_eq(field_count(values, 0), 9), all_empty(values))

def admit_tabs(fields: List<String>, +answer: String) -> Admission:
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
                                        case Nil{}: admit_checked(mark, owner, request, decision, state, attempt, keeperPath, cwd, artifactPath, answer)
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

def admit_answer(fields: List<String>, +answer: String) -> Admission:
  match fields:
    case +presence <> more:
      Bool.pick(Admission, String.eq(presence, "absent"),
        Bool.pick(Admission, nine_values_absent(more), AdmissionAbsent{}, AdmissionUncertain{"shape", answer}),
        Bool.pick(Admission, String.eq(presence, "present"), admit_tabs(more, answer), AdmissionUncertain{"mark", answer}))
    case _: AdmissionUncertain{"short", answer}

# The decode: exactly one row, and either the absence row or the ten present columns.
def admit_line(fields: List<String>, rest: List<String>, +answer: String) -> Admission:
  match rest:
    case Nil{}: admit_answer(fields, answer)
    case _: AdmissionUncertain{"surplus", answer}

# The presence marker decides between a proven absence, which must carry no other
# value, and the recorded row the field decoder reads.
def admit_decode_lines(lines: List<String>, +answer: String) -> Admission:
  match lines:
    case Nil{}: AdmissionUncertain{"empty", answer}
    case +line <> +rest: admit_line(Tx.split_tabs(line), rest, answer)

# The raw row is parsed once here into the lines the decoder consumes, so a caller that
# already holds the lines decodes them directly.
def admit_decode(+row: String) -> Admission:
  admit_decode_lines(Tx.split_lines(row), row)

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

# The same-binding read-back: the identical ten-column answer for a committed
# decision, run on the qualified connection. This statement inserts no admission row, and
# it is not a read-only operation: it begins an immediate transaction for the write lock
# and carries the schema's create-if-missing statements. The bound call configures its
# connection with two pragmas before it, and those are connection settings, not writes.
def readback_sql(+id: String) -> String:
  "BEGIN IMMEDIATE;" ++ ContextStore.schema() ++ admit_row_sql(id) ++ "COMMIT;"

# The read-back of one committed decision on the same qualified binding.
def readback(+db: String, +binding: String, +id: String) -> IO(Result<&1,&1,U32 & String,Admission>):
  do IO<Result<&1,&1,U32 & String,Admission>>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, readback_sql(id))
    admit_after(result)

# The stored association of one committed admission, read on the qualified binding after
# the caller has established that the row is its own. The statement writes nothing: a row
# created before any association existed answers missing and is never repaired here.
def association_readback_sql(+id: String) -> String:
  "BEGIN IMMEDIATE;" ++ ContextStore.schema() ++ ContextStore.association_row_sql(id) ++ "COMMIT;"

# The admission record is read back from the row this transaction wrote; the association
# is the value the statement text recorded, not the caller's argument.
def admit_associated(+db: String, +binding: String, +id: String, +owner: String, +requestJson: String, +keeperPath: String, +cwd: String, +originAttempt: String, +artifactPath: String, +planValue: String, +planIdentity: String, +resultSchema: String) -> IO(Result<&1,&1,U32 & String,Admission>):
  do IO<Result<&1,&1,U32 & String,Admission>>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, admit_associated_sql(id, owner, requestJson, keeperPath, cwd, originAttempt, artifactPath, planValue, planIdentity, resultSchema))
    admit_after(result)


def association_after(result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,Association>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Association>, Fail{error})
    case Done{+rows}: IO.pure(Result<&1,&1,U32 & String,Association>, Done{association_decode(rows)})

def readback_association(+db: String, +binding: String, +id: String) -> IO(Result<&1,&1,U32 & String,Association>):
  do IO<Result<&1,&1,U32 & String,Association>>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, association_readback_sql(id))
    association_after(result)

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
