# CLAIM: the observer consumer of the selected artifact's managed binding and original
# keeper. It commits one observed event, commits the completed result coherently with its
# notice and cursor, and releases one target from its committed intent.
#
# The physical per-call file binding says which file this call observes. It is not custody:
# the keeper and its admitted custody arrive as a supplied value, and no handle, Boolean
# authority or signal success is fabricated when that value is absent.
#
# release_target runs the supplied original keeper action before the database claim, so a
# completed release means the effect ran. claim_release is the database claim alone: it
# records the intent's delivery state and proves no keeper release. A caller that has no
# keeper action answers with release_unavailable, naming the missing primitive.
import Base
import ./roles.bend as ContextRoles
import ./store.bend as ContextStore
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx
import ../coordinator/commands.bend as C

# The original keeper and its admitted custody, as supplied by the wiring owner: the keeper
# identity, the admitted database binding it is held under, and the holder.
type Custody is Data:
  Custody{keeper: String, admitted: String, holder: String}

# Whether the supplied custody is held under the binding this call was given.
type CustodyCheck is Data:
  CustodyAdmitted{binding: String}
  CustodyMismatch{binding: String, custodyBinding: String}
  CustodyForeignKeeper{keeper: String, expectedKeeper: String}

# How one returned row read. An absent answer and a malformed answer are different facts, and
# a document is checked for shape only: this module has no JSON parser, so identity is
# established by the guards inside the statement rather than by re-reading the document.
type RowRead is Data:
  RowAbsent{}
  RowDocument{document: String}
  RowMalformed{answer: String}

# One observer step. A failed step keeps the host or validation code and detail.
# One observed receipt. The identity and cursor are the requested ones, which the statement has
# already compared, and the two flags say which evidence the row retains. Nothing here is a
# document, and no column carries arbitrary text.
type Receipt is Data:
  Receipt{query: String, role: String, incarnation: String, cursor: String, captureRetained: Bool, exitRetained: Bool}

# How one receipt read concluded.
type ReceiptRead is Data:
  ReceiptAbsent{}
  ReceiptPresent{receipt: Receipt}
  ReceiptMalformed{stage: String, answer: String}

type ObserverStep is Data:
  ObserverCommitted{receipt: Receipt}
  ObserverAbsent{stage: String}
  ObserverUnreadable{stage: String, answer: String}
  ObserverFailed{code: U32, detail: String}

# One release outcome. Claim-only and effect-completed are distinct answers, an effect that ran
# but could not be recorded keeps its own outcome with the effect's observation, an
# inadmissible retained intent is refused before any effect, missing or foreign custody answers
# before any effect, and an unavailable keeper action names the missing primitive.
type ReleaseOutcome is Data:
  ReleaseEffectCompleted{claim: String, effect: String, document: String}
  ReleaseEffectUnpersisted{claim: String, effect: String, fate: String}
  ReleaseClaimOnly{document: String}
  ReleaseIntentRefused{stage: String, detail: String}
  ReleaseEffectUnavailable{keeper: String, holder: String, need: String}
  ReleaseMissingCustody{need: String}
  ReleaseCustodyMismatch{binding: String, custodyBinding: String}
  ReleaseForeignKeeper{keeper: String, expectedKeeper: String}
  ReleaseFailed{code: U32, detail: String}
  ReleaseUnreadable{stage: String, answer: String}

# The decision of one retained release intent, taken before any effect runs.
type ReleaseIntent is Data:
  IntentAdmissible{delivery: String}
  IntentMissing{stage: String}
  IntentStale{recorded: String, expected: String}
  IntentUnreadable{stage: String, answer: String}

def line_count_ok(lines: List<String>) -> Bool:
  match lines:
    case Nil{}: True{}
    case +line <> rest:
      match rest:
        case Nil{}: Bool.not(String.is_empty(line))
        case _: False{}

# The rows are bound before they are inspected, so the scrutinee is a parameter.
def single_line(+row: String) -> Bool:
  line_count_ok(Tx.split_lines(row))

def flag_true(+flag: String) -> Bool:
  String.eq(flag, "1")

def flag_on(+flag: String) -> Bool:
  Bool.or(String.eq(flag, "0"), String.eq(flag, "1"))

def receipt_match(+query: String, +role: String, +incarnation: String, +cursor: String, expr: String) -> String:
  expr

# The receipt of one role row as presence plus flags only. Every comparison happens inside SQL, so
# no identity, cursor or phase text travels as a tab or newline separated column and no delimiter
# can appear in it.
def receipt_sql(+query: String, +role: String, +incarnation: String, +cursor: String) -> String:
  "SELECT CASE WHEN EXISTS(SELECT 1 FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ ") THEN 'present' ELSE 'absent' END,"
  ++ "CASE WHEN (SELECT query_id FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ ")=" ++ C.q(query) ++ " THEN '1' ELSE '0' END,"
  ++ "CASE WHEN (SELECT role FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ ")=" ++ C.q(role) ++ " THEN '1' ELSE '0' END,"
  ++ "CASE WHEN (SELECT incarnation FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ ")=" ++ C.q(incarnation) ++ " THEN '1' ELSE '0' END,"
  ++ "CASE WHEN (SELECT observer_cursor FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ ")=" ++ C.q(cursor) ++ " THEN '1' ELSE '0' END,"
  ++ "CASE WHEN (SELECT capture_json FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ ") IS NULL THEN '0' ELSE '1' END,"
  ++ "CASE WHEN (SELECT exit_evidence_json FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ ") IS NULL THEN '0' ELSE '1' END;"

def receipt_all_off(+qm: String, +rm: String, +im: String, +cm: String, +cap: String, +ext: String) -> Bool:
  Bool.and(Bool.and(Bool.and(String.eq(qm, "0"), String.eq(rm, "0")), Bool.and(String.eq(im, "0"), String.eq(cm, "0"))), Bool.and(String.eq(cap, "0"), String.eq(ext, "0")))

def receipt_absent(+answer: String, +qm: String, +rm: String, +im: String, +cm: String, +cap: String, +ext: String) -> ReceiptRead:
  Bool.pick(ReceiptRead, receipt_all_off(qm, rm, im, cm, cap, ext), ReceiptAbsent{}, ReceiptMalformed{"absentShape", answer})

def receipt_evidence(+query: String, +role: String, +incarnation: String, +cursor: String, +answer: String, +cap: String, +ext: String) -> ReceiptRead:
  Bool.pick(ReceiptRead, Bool.and(flag_on(cap), flag_on(ext)),
    ReceiptPresent{Receipt{query, role, incarnation, cursor, flag_true(cap), flag_true(ext)}},
    ReceiptMalformed{"evidence", answer})

def receipt_cursor(+query: String, +role: String, +incarnation: String, +cursor: String, +answer: String, +cm: String, +cap: String, +ext: String) -> ReceiptRead:
  Bool.pick(ReceiptRead, String.eq(cm, "1"),
    receipt_evidence(query, role, incarnation, cursor, answer, cap, ext),
    ReceiptMalformed{"cursor", answer})

def receipt_present(+query: String, +role: String, +incarnation: String, +cursor: String, +answer: String, +qm: String, +rm: String, +im: String, +cm: String, +cap: String, +ext: String) -> ReceiptRead:
  Bool.pick(ReceiptRead, Bool.and(Bool.and(String.eq(qm, "1"), String.eq(rm, "1")), String.eq(im, "1")),
    receipt_cursor(query, role, incarnation, cursor, answer, cm, cap, ext),
    ReceiptMalformed{"identity", answer})

def receipt_of(+query: String, +role: String, +incarnation: String, +cursor: String, +answer: String, +presence: String, +qm: String, +rm: String, +im: String, +cm: String, +cap: String, +ext: String) -> ReceiptRead:
  Bool.pick(ReceiptRead, String.eq(presence, "present"),
    receipt_present(query, role, incarnation, cursor, answer, qm, rm, im, cm, cap, ext),
  Bool.pick(ReceiptRead, String.eq(presence, "absent"),
    receipt_absent(answer, qm, rm, im, cm, cap, ext),
    ReceiptMalformed{"presence", answer}))

def receipt_identity(+query: String, +role: String, +incarnation: String, +cursor: String, +answer: String, fields: List<String>) -> ReceiptRead:
  match fields:
    case +presence <> m0:
      match m0:
        case +qm <> m1:
          match m1:
            case +rm <> m2:
              match m2:
                case +im <> m3:
                  match m3:
                    case +cm <> m4:
                      match m4:
                        case +cap <> m5:
                          match m5:
                            case +ext <> m6:
                              match m6:
                                case Nil{}: receipt_of(query, role, incarnation, cursor, answer, presence, qm, rm, im, cm, cap, ext)
                                case _: ReceiptMalformed{"surplus", answer}
                            case _: ReceiptMalformed{"short", answer}
                        case _: ReceiptMalformed{"short", answer}
                    case _: ReceiptMalformed{"short", answer}
                case _: ReceiptMalformed{"short", answer}
            case _: ReceiptMalformed{"short", answer}
        case _: ReceiptMalformed{"short", answer}
    case _: ReceiptMalformed{"short", answer}

def receipt_lines(+query: String, +role: String, +incarnation: String, +cursor: String, +answer: String, lines: List<String>) -> ReceiptRead:
  match lines:
    case Nil{}: ReceiptMalformed{"empty", answer}
    case +line <> rest:
      match rest:
        case Nil{}: receipt_identity(query, role, incarnation, cursor, answer, Tx.split_tabs(line))
        case _: ReceiptMalformed{"surplus", answer}

def receipt_decode(+query: String, +role: String, +incarnation: String, +cursor: String, +answer: String) -> ReceiptRead:
  receipt_lines(query, role, incarnation, cursor, answer, Tx.split_lines(answer))

def step_of(+query: String, +role: String, +incarnation: String, +cursor: String, read: ReceiptRead) -> ObserverStep:
  match read:
    case ReceiptAbsent{}: ObserverAbsent{"role"}
    case ReceiptPresent{receipt}: ObserverCommitted{receipt}
    case ReceiptMalformed{stage, answer}: ObserverUnreadable{stage, answer}

# The receipt read is a later observation than the commit, and the commit's own answer stays
# unused: only the fixed columns decide whether the commit is observed.
def receipt_after_read_result(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +cursor: String, read: Result<&1,&1,U32 & String,String>) -> IO(ObserverStep):
  match read:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(ObserverStep, ObserverFailed{code, detail})
    case Done{+answer}: IO.pure(ObserverStep, step_of(query, role, incarnation, cursor, receipt_decode(query, role, incarnation, cursor, answer)))

def receipt_after(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +cursor: String) -> IO(ObserverStep):
  do IO<ObserverStep>:
    read : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, receipt_sql(query, role, incarnation, cursor))
    receipt_after_read_result(db, binding, query, role, incarnation, cursor, read)

def step_after(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +cursor: String, result: Result<&1,&1,U32 & String,String>) -> IO(ObserverStep):
  match result:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(ObserverStep, ObserverFailed{code, detail})
    case Done{+answer}: receipt_after(db, binding, query, role, incarnation, cursor)

# --- the commit statement, as named clauses so a law can pin each one and their assembly ---
def terminal_payload_matches(+next: String, +resultJson: String, +errorJson: String) -> String:
  "state=" ++ C.q(next) ++ " AND result_json IS " ++ ContextStore.json_or_null(resultJson) ++ " AND error_json IS " ++ ContextStore.json_or_null(errorJson)

# One event commit: the same statement the role observer already uses, whose guards keep the
# cursor, the capture and the exit evidence replay-safe and whose notice is bound to the query.

def commit_state_clause(+query: String, +next: String, +resultJson: String, +errorJson: String) -> String:
  "UPDATE semantic_queries SET state=CASE WHEN " ++ ContextStore.terminal_recorded() ++ " THEN CASE WHEN " ++ terminal_payload_matches(next, resultJson, errorJson) ++ " THEN state ELSE NULL END ELSE " ++ C.q(next) ++ " END,"
  ++ "result_json=CASE WHEN " ++ ContextStore.terminal_recorded() ++ " THEN result_json ELSE " ++ ContextStore.json_or_null(resultJson) ++ " END,"
  ++ "error_json=CASE WHEN " ++ ContextStore.terminal_recorded() ++ " THEN error_json ELSE " ++ ContextStore.json_or_null(errorJson) ++ " END "
  ++ "WHERE id=" ++ C.q(query) ++ ";"

def commit_role_clause(+query: String, +role: String, +incarnation: String, +expectedCursor: String, +nextCursor: String, +captureJson: String, +exitEvidenceJson: String, +progressJson: String) -> String:
  "UPDATE semantic_roles SET observer_cursor=" ++ ContextRoles.replay_column(expectedCursor, query, role, incarnation, nextCursor, C.q(nextCursor), captureJson, exitEvidenceJson, progressJson, "observer_cursor") ++ ","
  ++ "capture_json=" ++ ContextRoles.replay_column(expectedCursor, query, role, incarnation, nextCursor, ContextStore.json_or_null(captureJson), captureJson, exitEvidenceJson, progressJson, "capture_json") ++ ","
  ++ "exit_evidence_json=" ++ ContextRoles.replay_column(expectedCursor, query, role, incarnation, nextCursor, ContextStore.json_or_null(exitEvidenceJson), captureJson, exitEvidenceJson, progressJson, "exit_evidence_json") ++ " "
  ++ "WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ ";"

def commit_tail_clause(+query: String, +role: String, +incarnation: String, +owner: String, +progressJson: String, +noticeId: String, +noticeBody: String) -> String:
  ContextRoles.role_present_guard(query, role, incarnation)
  ++ "UPDATE semantic_queries SET progress_json=" ++ ContextStore.json_or_null(progressJson) ++ " WHERE id=" ++ C.q(query) ++ ";"
  ++ ContextStore.owner_notice_bound_sql(noticeId, owner, noticeBody, query)
  ++ ContextRoles.role_read_sql(query, role, incarnation) ++ "COMMIT;"

def failure_schema(+failureJson: String) -> Maybe<String>:
  Bool.pick(Maybe<String>, String.is_empty(failureJson), None{}, Some{failureJson})

# The terminal payload identity: a repeated terminal state is admitted only when the stored
# result and error are the same documents as the supplied ones under the same rendering the
# write uses. A changed document assigns NULL to the not-null state column, which aborts the
# whole transaction before any progress or notice is applied. This is deliberately stricter
# than the publish path, whose text stays untouched.
def commit_event_sql(+query: String, +role: String, +incarnation: String, +owner: String, +expectedCursor: String, +nextCursor: String, +progressJson: String, +noticeId: String, +noticeBody: String, +captureJson: String, +exitEvidenceJson: String) -> String:
  ContextRoles.event_commit_sql(query, role, incarnation, owner, expectedCursor, nextCursor, progressJson, noticeId, noticeBody, captureJson, exitEvidenceJson)

# The result commit the event commit lacks. It keeps the cursor, the capture and the exit
# evidence assignments the event statement uses, so a first commit retains what an identical
# replay compares, and it binds the terminal payload identity rather than trusting the state
# alone.
def commit_result_sql(+query: String, +role: String, +incarnation: String, +owner: String, +expectedCursor: String, +nextCursor: String, +next: String, +resultJson: String, +errorJson: String, +progressJson: String, +noticeId: String, +noticeBody: String, +captureJson: String, +exitEvidenceJson: String) -> String:
  "BEGIN IMMEDIATE;" ++ ContextStore.schema()
  ++ commit_state_clause(query, next, resultJson, errorJson)
  ++ commit_role_clause(query, role, incarnation, expectedCursor, nextCursor, captureJson, exitEvidenceJson, progressJson)
  ++ commit_tail_clause(query, role, incarnation, owner, progressJson, noticeId, noticeBody)

def commit_event(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +owner: String, +expectedCursor: String, +nextCursor: String, +progressJson: String, +noticeId: String, +noticeBody: String, +captureJson: String, +exitEvidenceJson: String) -> IO(ObserverStep):
  do IO<ObserverStep>:
    committed : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, commit_event_sql(query, role, incarnation, owner, expectedCursor, nextCursor, progressJson, noticeId, noticeBody, captureJson, exitEvidenceJson))
    step_after(db, binding, query, role, incarnation, nextCursor, committed)

# The database claim alone: it records the committed intent's delivery state and completes the
# release state while the query's evaluation state stays untouched. It proves no keeper
# release and is not a substitute for the effect.











def release_claim_state(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +label: String, result: Result<&1,&1,U32 & String,String>) -> IO(ReleaseOutcome):
  match result:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(ReleaseOutcome, ReleaseFailed{code, detail})
    case Done{+answer}:
      IO.pure(ReleaseOutcome, ReleaseClaimOnly{label})

# The claim-only path: the intent decides, the caller's complete intent document is claimed, and
# the recorded state is read back rather than assumed from the call succeeding.

def custody_check(+binding: String, +custodyBinding: String, +keeper: String, +expectedKeeper: String) -> CustodyCheck:
  Bool.pick(CustodyCheck, String.eq(custodyBinding, binding),
    Bool.pick(CustodyCheck, String.eq(keeper, expectedKeeper), CustodyAdmitted{binding}, CustodyForeignKeeper{keeper, expectedKeeper}),
    CustodyMismatch{binding, custodyBinding})

# The retained release intent as fixed columns: presence, whether the intent column is set, and
# the recorded delivery state.

def intent_sql(+query: String, +role: String, +incarnation: String) -> String:
  "SELECT CASE WHEN EXISTS(SELECT 1 FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ ") THEN 'present' ELSE 'absent' END,"
  ++ "CASE WHEN (SELECT release_intent_json FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ ") IS NULL THEN '0' ELSE '1' END,"
  ++ "coalesce((SELECT json_extract(release_intent_json,'$.delivery') FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ "),'');"

def intent_decision(+presence: String, +hasIntent: String, +recorded: String, +expected: String) -> ReleaseIntent:
  Bool.pick(ReleaseIntent, String.eq(presence, "absent"), IntentMissing{"role"},
  Bool.pick(ReleaseIntent, Bool.not(String.eq(hasIntent, "1")), IntentMissing{"intent"},
  Bool.pick(ReleaseIntent, String.eq(recorded, expected), IntentAdmissible{recorded}, IntentStale{recorded, expected})))

def intent_tabs(+expected: String, +row: String, fields: List<String>) -> ReleaseIntent:
  match fields:
    case +presence <> m0:
      match m0:
        case +hasIntent <> m1:
          match m1:
            case +recorded <> m2:
              match m2:
                case Nil{}: intent_decision(presence, hasIntent, recorded, expected)
                case _: IntentUnreadable{"shape", row}
            case _: IntentUnreadable{"short", row}
        case _: IntentUnreadable{"short", row}
    case _: IntentUnreadable{"short", row}

def intent_fields(+expected: String, +row: String, lines: List<String>) -> ReleaseIntent:
  match lines:
    case Nil{}: IntentUnreadable{"empty", row}
    case +line <> rest:
      match rest:
        case Nil{}: intent_tabs(expected, row, Tx.split_tabs(line))
        case _: IntentUnreadable{"surplus", row}

def intent_decode(+expected: String, +row: String) -> ReleaseIntent:
  intent_fields(expected, row, Tx.split_lines(row))

def intent_after(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expected: String, result: Result<&1,&1,U32 & String,String>) -> IO(ReleaseIntent):
  match result:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(ReleaseIntent, IntentUnreadable{"host", U32.show(code) ++ ":" ++ detail})
    case Done{+rows}: IO.pure(ReleaseIntent, intent_decode(expected, rows))

def intent_read(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expected: String) -> IO(ReleaseIntent):
  do IO<ReleaseIntent>:
    read : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, intent_sql(query, role, incarnation))
    intent_after(db, binding, query, role, incarnation, expected, read)

# A rendered error document, when the caller supplied one. The empty case is its own value so
# the commit below branches on a parameter rather than on a computed condition. This checks
# non-empty text only: it is not schema validation, which remains the caller's operand.

def claim_release_run(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +nextJson: String, +claim: String) -> IO(ReleaseOutcome):
  do IO<ReleaseOutcome>:
    claimed : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextRoles.release_claim_sql(query, role, incarnation, expectedDelivery, nextJson))
    release_claim_state(db, binding, query, role, incarnation, claim, claimed)

# One release: the committed target intent and the original keeper under admitted custody. The
# supplied keeper action runs first; only when it answers does the database claim follow, so a
# completed release carries the effect's own answer beside the claim's read-back. Missing
# custody and a custody held under another binding are answered before any effect.

def claim_release_after(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +nextJson: String, read: ReleaseIntent) -> IO(ReleaseOutcome):
  match read:
    case IntentAdmissible{delivery}: claim_release_run(db, binding, query, role, incarnation, expectedDelivery, nextJson, delivery)
    case IntentMissing{stage}: IO.pure(ReleaseOutcome, ReleaseIntentRefused{"missing", stage})
    case IntentStale{recorded, expected}: IO.pure(ReleaseOutcome, ReleaseIntentRefused{"stale", recorded ++ ":" ++ expected})

# The claim statement of one stage. The matched label is the state this claim compares against,
# so the attempt stage passes the committed state and the completion stage passes the state the
# attempt recorded. Single-sourcing the three call sites keeps the label argument law-visible.
def claim_statement(+query: String, +role: String, +incarnation: String, +matched: String, +documentJson: String) -> String:
  ContextRoles.release_claim_sql(query, role, incarnation, matched, documentJson)

def claim_attempt_statement(+query: String, +role: String, +incarnation: String, +expectedDelivery: String, +attemptJson: String) -> String:
  claim_statement(query, role, incarnation, expectedDelivery, attemptJson)

def claim_completion_statement(+query: String, +role: String, +incarnation: String, +attempt: String, +completionJson: String) -> String:
  claim_statement(query, role, incarnation, attempt, completionJson)

def claim_verified(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +label: String, read: ReleaseIntent) -> IO(ReleaseOutcome):
  match read:
    case IntentAdmissible{recorded}: IO.pure(ReleaseOutcome, ReleaseClaimOnly{recorded})
    case IntentMissing{stage}: IO.pure(ReleaseOutcome, ReleaseIntentRefused{"claim", stage})
    case IntentStale{recorded, expected}: IO.pure(ReleaseOutcome, ReleaseIntentRefused{"claim", recorded ++ ":" ++ expected})
    case IntentUnreadable{stage, answer}: IO.pure(ReleaseOutcome, ReleaseIntentRefused{"claim", stage ++ ":" ++ answer})

def claim_verify(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +label: String) -> IO(ReleaseOutcome):
  do IO<ReleaseOutcome>:
    read : ReleaseIntent <- intent_read(db, binding, query, role, incarnation, label)
    claim_verified(db, binding, query, role, incarnation, label, read)

def claim_run_read_result(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expected: String, +next: String, +nextJson: String, claimed: Result<&1,&1,U32 & String,String>) -> IO(ReleaseOutcome):
  match claimed:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(ReleaseOutcome, ReleaseFailed{code, detail})
    case Done{+answer}: claim_verify(db, binding, query, role, incarnation, next)

def claim_run(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expected: String, +next: String, +nextJson: String) -> IO(ReleaseOutcome):
  do IO<ReleaseOutcome>:
    claimed : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, claim_statement(query, role, incarnation, expected, nextJson))
    claim_run_read_result(db, binding, query, role, incarnation, expected, next, nextJson, claimed)

# The claim-only path: the committed state decides, the caller's complete intent document is
# claimed against it, and the read-back must show the NEW label, so an unchanged old label cannot
# satisfy the claim and a real transition is confirmed rather than refused.
def claim_release_read_result(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +nextDelivery: String, +nextJson: String, read: ReleaseIntent) -> IO(ReleaseOutcome):
  match read:
    case IntentAdmissible{recorded}: claim_run(db, binding, query, role, incarnation, recorded, nextDelivery, nextJson)
    case IntentMissing{stage}: IO.pure(ReleaseOutcome, ReleaseIntentRefused{"missing", stage})
    case IntentStale{recorded, expected}: IO.pure(ReleaseOutcome, ReleaseIntentRefused{"stale", recorded ++ ":" ++ expected})
    case IntentUnreadable{stage, answer}: IO.pure(ReleaseOutcome, ReleaseIntentRefused{"unreadable", stage ++ ":" ++ answer})

def claim_release(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +nextDelivery: String, +nextJson: String) -> IO(ReleaseOutcome):
  do IO<ReleaseOutcome>:
    read : ReleaseIntent <- intent_read(db, binding, query, role, incarnation, expectedDelivery)
    claim_release_read_result(db, binding, query, role, incarnation, expectedDelivery, nextDelivery, nextJson, read)

def release_completed_after(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +claim: String, +effect: String, read: ReleaseIntent) -> IO(ReleaseOutcome):
  match read:
    case IntentAdmissible{recorded}: IO.pure(ReleaseOutcome, ReleaseEffectCompleted{claim, effect, recorded})
    case IntentMissing{stage}: IO.pure(ReleaseOutcome, ReleaseEffectUnpersisted{claim, effect, "completion:missing:" ++ stage})
    case IntentStale{recorded, expected}: IO.pure(ReleaseOutcome, ReleaseEffectUnpersisted{claim, effect, "completion:unconfirmed:" ++ recorded ++ ":" ++ expected})
    case IntentUnreadable{stage, answer}: IO.pure(ReleaseOutcome, ReleaseEffectUnpersisted{claim, effect, "completion:unreadable:" ++ stage ++ ":" ++ answer})

def release_completion_read_result(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +attempt: String, +completion: String, +completionJson: String, +effect: String, written: Result<&1,&1,U32 & String,String>) -> IO(ReleaseOutcome):
  match written:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(ReleaseOutcome, ReleaseEffectUnpersisted{attempt, effect, U32.show(code) ++ ":" ++ detail})
    case Done{+answer}: do IO<ReleaseOutcome>:
      read : ReleaseIntent <- intent_read(db, binding, query, role, incarnation, completion)
      release_completed_after(db, binding, query, role, incarnation, attempt, effect, read)

def release_completion(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +attempt: String, +completion: String, +completionJson: String, +effect: String) -> IO(ReleaseOutcome):
  do IO<ReleaseOutcome>:
    written : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, claim_completion_statement(query, role, incarnation, attempt, completionJson))
    release_completion_read_result(db, binding, query, role, incarnation, attempt, completion, completionJson, effect, written)

def release_effect_after(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +attempt: String, +completion: String, +completionJson: String, result: Result<&1,&1,U32 & String,String>) -> IO(ReleaseOutcome):
  match result:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(ReleaseOutcome, ReleaseFailed{code, detail})
    case Done{+effect}: release_completion(db, binding, query, role, incarnation, attempt, completion, completionJson, effect)

def release_effect_run(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +attempt: String, +completion: String, +completionJson: String, action: Unit -> IO(Result<&1,&1,U32 & String,String>)) -> IO(ReleaseOutcome):
  do IO<ReleaseOutcome>:
    acted : Result<&1,&1,U32 & String,String> <- action(Unit{})
    release_effect_after(db, binding, query, role, incarnation, attempt, completion, completionJson, acted)

# The attempt claim must be visible before the effect runs, and the completion claim compares
# against the observed attempt state rather than the state the caller replaced.
def release_attempt_verified(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +attempt: String, +completion: String, +completionJson: String, action: Unit -> IO(Result<&1,&1,U32 & String,String>), read: ReleaseIntent) -> IO(ReleaseOutcome):
  match read:
    case IntentAdmissible{recorded}: release_effect_run(db, binding, query, role, incarnation, attempt, completion, completionJson, action)
    case IntentMissing{stage}: IO.pure(ReleaseOutcome, ReleaseIntentRefused{"attempt", stage})
    case IntentStale{recorded, expected}: IO.pure(ReleaseOutcome, ReleaseIntentRefused{"attempt", recorded ++ ":" ++ expected})
    case IntentUnreadable{stage, answer}: IO.pure(ReleaseOutcome, ReleaseIntentRefused{"attempt", stage ++ ":" ++ answer})

def release_attempt_verify(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +attempt: String, +completion: String, +completionJson: String, action: Unit -> IO(Result<&1,&1,U32 & String,String>), answer: String) -> IO(ReleaseOutcome):
  do IO<ReleaseOutcome>:
    read : ReleaseIntent <- intent_read(db, binding, query, role, incarnation, attempt)
    release_attempt_verified(db, binding, query, role, incarnation, attempt, completion, completionJson, action, read)

def release_attempt_claim_read_result(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +attempt: String, +attemptJson: String, +completion: String, +completionJson: String, action: Unit -> IO(Result<&1,&1,U32 & String,String>), claimed: Result<&1,&1,U32 & String,String>) -> IO(ReleaseOutcome):
  match claimed:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(ReleaseOutcome, ReleaseFailed{code, detail})
    case Done{+answer}: release_attempt_verify(db, binding, query, role, incarnation, attempt, completion, completionJson, action, answer)

def release_attempt_claim(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +attempt: String, +attemptJson: String, +completion: String, +completionJson: String, action: Unit -> IO(Result<&1,&1,U32 & String,String>)) -> IO(ReleaseOutcome):
  do IO<ReleaseOutcome>:
    claimed : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, claim_attempt_statement(query, role, incarnation, expectedDelivery, attemptJson))
    release_attempt_claim_read_result(db, binding, query, role, incarnation, expectedDelivery, attempt, attemptJson, completion, completionJson, action, claimed)

def release_intent_after(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +attempt: String, +attemptJson: String, +completion: String, +completionJson: String, action: Unit -> IO(Result<&1,&1,U32 & String,String>), read: ReleaseIntent) -> IO(ReleaseOutcome):
  match read:
    case IntentAdmissible{recorded}: release_attempt_claim(db, binding, query, role, incarnation, recorded, attempt, attemptJson, completion, completionJson, action)
    case IntentMissing{stage}: IO.pure(ReleaseOutcome, ReleaseIntentRefused{"missing", stage})
    case IntentStale{recorded, expected}: IO.pure(ReleaseOutcome, ReleaseIntentRefused{"stale", recorded ++ ":" ++ expected})
    case IntentUnreadable{stage, answer}: IO.pure(ReleaseOutcome, ReleaseIntentRefused{"unreadable", stage ++ ":" ++ answer})

def release_intent_read(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +attempt: String, +attemptJson: String, +completion: String, +completionJson: String, action: Unit -> IO(Result<&1,&1,U32 & String,String>)) -> IO(ReleaseOutcome):
  do IO<ReleaseOutcome>:
    read : ReleaseIntent <- intent_read(db, binding, query, role, incarnation, expectedDelivery)
    release_intent_after(db, binding, query, role, incarnation, expectedDelivery, attempt, attemptJson, completion, completionJson, action, read)

def release_intent_start(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +attempt: String, +attemptJson: String, +completion: String, +completionJson: String, action: Unit -> IO(Result<&1,&1,U32 & String,String>), refusal: Maybe<ReleaseOutcome>) -> IO(ReleaseOutcome):
  match refusal:
    case Some{+outcome}: IO.pure(ReleaseOutcome, outcome)
    case None{}: release_intent_read(db, binding, query, role, incarnation, expectedDelivery, attempt, attemptJson, completion, completionJson, action)

def release_refusal_of(+binding: String, decision: CustodyCheck) -> Maybe<ReleaseOutcome>:
  match decision:
    case CustodyMismatch{binding, custodyBinding}: Some{ReleaseCustodyMismatch{binding, custodyBinding}}
    case CustodyForeignKeeper{keeper, expectedKeeper}: Some{ReleaseForeignKeeper{keeper, expectedKeeper}}
    case CustodyAdmitted{binding}: None{}

def release_refusal_check(+binding: String, +keeper: String, +expectedKeeper: String, +admitted: String) -> Maybe<ReleaseOutcome>:
  release_refusal_of(binding, custody_check(binding, admitted, keeper, expectedKeeper))

def release_refusal(+binding: String, +expectedKeeper: String, custody: Maybe<Custody>) -> Maybe<ReleaseOutcome>:
  match custody:
    case None{}: Some{ReleaseMissingCustody{"keeper under admitted custody"}}
    case Some{+held}:
      match held:
        case Custody{keeper, admitted, holder}: release_refusal_check(binding, keeper, expectedKeeper, admitted)

def release_target(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +attempt: String, +attemptJson: String, +completion: String, +completionJson: String, +expectedKeeper: String, action: Unit -> IO(Result<&1,&1,U32 & String,String>), custody: Maybe<Custody>) -> IO(ReleaseOutcome):
  release_intent_start(db, binding, query, role, incarnation, expectedDelivery, attempt, attemptJson, completion, completionJson, action, release_refusal(binding, expectedKeeper, custody))

def release_unavailable(+keeper: String, +holder: String, +need: String) -> ReleaseOutcome:
  ReleaseEffectUnavailable{keeper, holder, need}

def commit_failed_schema(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +owner: String, +expectedCursor: String, +nextCursor: String, +progressJson: String, +noticeId: String, +noticeBody: String, +captureJson: String, +exitEvidenceJson: String, +code: U32, +detail: String, schema: Maybe<String>) -> IO(ObserverStep):
  match schema:
    case None{}: IO.pure(ObserverStep, ObserverFailed{code, detail})
    case Some{+rendered}:
      do IO<ObserverStep>:
        written : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, commit_result_sql(query, role, incarnation, owner, expectedCursor, nextCursor, "failed", "", rendered, progressJson, noticeId, noticeBody, captureJson, exitEvidenceJson))
        step_after(db, binding, query, role, incarnation, nextCursor, written)

def commit_failed(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +owner: String, +expectedCursor: String, +nextCursor: String, +failureJson: String, +progressJson: String, +noticeId: String, +noticeBody: String, +captureJson: String, +exitEvidenceJson: String, +code: U32, +detail: String) -> IO(ObserverStep):
  do IO<ObserverStep>:
    schema : Maybe<String> <- IO.pure(Maybe<String>, failure_schema(failureJson))
    commit_failed_schema(db, binding, query, role, incarnation, owner, expectedCursor, nextCursor, progressJson, noticeId, noticeBody, captureJson, exitEvidenceJson, code, detail, schema)

# The validated outcome decides what is recorded: a validated document publishes complete, and
# a failed validation publishes failed with the caller's rendered error document. A failed
# validation with no rendered error document records nothing and reports the failure, because
# the error document schema belongs to the notification contract rather than to this module.
def commit_result(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +owner: String, +expectedCursor: String, +nextCursor: String, verdict: Result<&1,&1,U32 & String,String>, +failureJson: String, +progressJson: String, +noticeId: String, +noticeBody: String, +captureJson: String, +exitEvidenceJson: String) -> IO(ObserverStep):
  match verdict:
    case Done{+document}:
      do IO<ObserverStep>:
        written : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, commit_result_sql(query, role, incarnation, owner, expectedCursor, nextCursor, "complete", document, "", progressJson, noticeId, noticeBody, captureJson, exitEvidenceJson))
        step_after(db, binding, query, role, incarnation, nextCursor, written)
    case Fail{error}:
      match error:
        case (code, detail): commit_failed(db, binding, query, role, incarnation, owner, expectedCursor, nextCursor, failureJson, progressJson, noticeId, noticeBody, captureJson, exitEvidenceJson, code, detail)
