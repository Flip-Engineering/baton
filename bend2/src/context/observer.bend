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
type ObserverStep is Data:
  ObserverCommitted{document: String}
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

def receipt_flag(+flag: String) -> Bool:
  String.eq(flag, "1")

def receipt_flag_ok(+flag: String) -> Bool:
  Bool.or(String.eq(flag, "0"), String.eq(flag, "1"))

# The fixed-column receipt of one role row: presence, the three identity columns, the cursor, the
# phases and the two evidence flags. Nothing here is a document, so no prefix can stand in for a
# decoded receipt.
def receipt_sql(+query: String, +role: String, +incarnation: String) -> String:
  "SELECT CASE WHEN EXISTS(SELECT 1 FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ ") THEN 'present' ELSE 'absent' END,"
  ++ "coalesce((SELECT query_id FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ "),''),"
  ++ "coalesce((SELECT role FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ "),''),"
  ++ "coalesce((SELECT incarnation FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ "),''),"
  ++ "coalesce((SELECT observer_cursor FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ "),''),"
  ++ "coalesce((SELECT phase FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ "),''),"
  ++ "coalesce((SELECT cleanup_phase FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ "),''),"
  ++ "CASE WHEN (SELECT capture_json FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ ") IS NULL THEN '0' ELSE '1' END,"
  ++ "CASE WHEN (SELECT exit_evidence_json FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ ") IS NULL THEN '0' ELSE '1' END;"

def receipt_domain_checked(+query: String, +role: String, +incarnation: String, +cursor: String, +rcursor: String, +phase: String, +cleanup: String, +capture: String, +exit: String, +answer: String) -> ReceiptRead:
  Bool.pick(ReceiptRead, Bool.and(Bool.and(Bool.not(String.is_empty(phase)), Bool.not(String.is_empty(cleanup))), Bool.and(receipt_flag_ok(capture), receipt_flag_ok(exit))),
    ReceiptPresent{Receipt{query, role, incarnation, cursor, phase, cleanup, receipt_flag(capture), receipt_flag(exit)}},
    ReceiptMalformed{"domain", answer})

def receipt_cursor_checked(+query: String, +role: String, +incarnation: String, +cursor: String, +rcursor: String, +phase: String, +cleanup: String, +capture: String, +exit: String, +answer: String) -> ReceiptRead:
  Bool.pick(ReceiptRead, String.eq(rcursor, cursor),
    receipt_domain_checked(query, role, incarnation, cursor, rcursor, phase, cleanup, capture, exit, answer),
    ReceiptMalformed{"cursor", answer})

def receipt_checked(+query: String, +role: String, +incarnation: String, +cursor: String, +rquery: String, +rrole: String, +rincarnation: String, +rcursor: String, +phase: String, +cleanup: String, +capture: String, +exit: String, +answer: String) -> ReceiptRead:
  Bool.pick(ReceiptRead, Bool.and(Bool.and(String.eq(rquery, query), String.eq(rrole, role)), String.eq(rincarnation, incarnation)),
    receipt_cursor_checked(query, role, incarnation, cursor, rcursor, phase, cleanup, capture, exit, answer),
    ReceiptMalformed{"identity", answer})

def receipt_answer(+query: String, +role: String, +incarnation: String, +cursor: String, +presence: String, +rquery: String, +rrole: String, +rincarnation: String, +rcursor: String, +phase: String, +cleanup: String, +capture: String, +exit: String, +answer: String) -> ReceiptRead:
  Bool.pick(ReceiptRead, String.eq(presence, "absent"), ReceiptAbsent{},
  Bool.pick(ReceiptRead, String.eq(presence, "present"),
    receipt_checked(query, role, incarnation, cursor, rquery, rrole, rincarnation, rcursor, phase, cleanup, capture, exit, answer),
    ReceiptMalformed{"presence", answer}))

def receipt_tabs(+query: String, +role: String, +incarnation: String, +cursor: String, fields: List<String>, +answer: String) -> ReceiptRead:
  match fields:
    case +presence <> m0:
      match m0:
        case +rquery <> m1:
          match m1:
            case +rrole <> m2:
              match m2:
                case +rincarnation <> m3:
                  match m3:
                    case +rcursor <> m4:
                      match m4:
                        case +phase <> m5:
                          match m5:
                            case +cleanup <> m6:
                              match m6:
                                case +capture <> m7:
                                  match m7:
                                    case +exit <> m8:
                                      match m8:
                                        case Nil{}: receipt_answer(query, role, incarnation, cursor, presence, rquery, rrole, rincarnation, rcursor, phase, cleanup, capture, exit, answer)
                                        case _: ReceiptMalformed{"surplus", answer}
                                    case _: ReceiptMalformed{"short", answer}
                                case _: ReceiptMalformed{"short", answer}
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
        case Nil{}: receipt_tabs(query, role, incarnation, cursor, Tx.split_tabs(line), answer)
        case _: ReceiptMalformed{"surplus", answer}

def receipt_decode(+query: String, +role: String, +incarnation: String, +cursor: String, +answer: String) -> ReceiptRead:
  receipt_lines(query, role, incarnation, cursor, answer, Tx.split_lines(answer))

def step_of(read: ReceiptRead) -> ObserverStep:
  match read:
    case ReceiptAbsent{}: ObserverAbsent{"role"}
    case ReceiptPresent{receipt}: ObserverCommitted{receipt}
    case ReceiptMalformed{stage, answer}: ObserverUnreadable{stage, answer}

# The receipt read is a later observation than the commit, and the commit's own answer stays
# unused: only the fixed columns decide whether the commit is observed.
def receipt_after(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +cursor: String) -> IO(ObserverStep):
  do IO<ObserverStep>:
    read : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, receipt_sql(query, role, incarnation))
    match read:
      case Fail{error}:
        match error:
          case (code, detail): IO.pure(ObserverStep, ObserverFailed{code, detail})
      case Done{+answer}: IO.pure(ObserverStep, step_of(receipt_decode(query, role, incarnation, cursor, answer)))

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
  ++ "UPDATE semantic_queries SET state=CASE WHEN " ++ ContextStore.terminal_recorded() ++ " THEN CASE WHEN " ++ terminal_payload_matches(next, resultJson, errorJson) ++ " THEN state ELSE NULL END ELSE " ++ C.q(next) ++ " END,"
  ++ "result_json=CASE WHEN " ++ ContextStore.terminal_recorded() ++ " THEN result_json ELSE " ++ ContextStore.json_or_null(resultJson) ++ " END,"
  ++ "error_json=CASE WHEN " ++ ContextStore.terminal_recorded() ++ " THEN error_json ELSE " ++ ContextStore.json_or_null(errorJson) ++ " END "
  ++ "WHERE id=" ++ C.q(query) ++ ";"
  ++ "UPDATE semantic_roles SET observer_cursor=" ++ ContextRoles.replay_column(expectedCursor, query, role, incarnation, nextCursor, C.q(nextCursor), captureJson, exitEvidenceJson, progressJson, "observer_cursor") ++ ","
  ++ "capture_json=" ++ ContextRoles.replay_column(expectedCursor, query, role, incarnation, nextCursor, ContextStore.json_or_null(captureJson), captureJson, exitEvidenceJson, progressJson, "capture_json") ++ ","
  ++ "exit_evidence_json=" ++ ContextRoles.replay_column(expectedCursor, query, role, incarnation, nextCursor, ContextStore.json_or_null(exitEvidenceJson), captureJson, exitEvidenceJson, progressJson, "exit_evidence_json") ++ " "
  ++ "WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ ";"
  ++ ContextRoles.role_present_guard(query, role, incarnation)
  ++ "UPDATE semantic_queries SET progress_json=" ++ ContextStore.json_or_null(progressJson) ++ " WHERE id=" ++ C.q(query) ++ ";"
  ++ ContextStore.owner_notice_bound_sql(noticeId, owner, noticeBody, query)
  ++ ContextRoles.role_read_sql(query, role, incarnation) ++ "COMMIT;"

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

def claim_run(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expected: String, +next: String, +nextJson: String) -> IO(ReleaseOutcome):
  do IO<ReleaseOutcome>:
    claimed : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, claim_statement(query, role, incarnation, expected, nextJson))
    match claimed:
      case Fail{error}:
        match error:
          case (code, detail): IO.pure(ReleaseOutcome, ReleaseFailed{code, detail})
      case Done{+answer}: claim_verify(db, binding, query, role, incarnation, next)

# The claim-only path: the committed state decides, the caller's complete intent document is
# claimed against it, and the read-back must show the NEW label, so an unchanged old label cannot
# satisfy the claim and a real transition is confirmed rather than refused.
def claim_release(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +nextDelivery: String, +nextJson: String) -> IO(ReleaseOutcome):
  do IO<ReleaseOutcome>:
    read : ReleaseIntent <- intent_read(db, binding, query, role, incarnation, expectedDelivery)
    match read:
      case IntentAdmissible{recorded}: claim_run(db, binding, query, role, incarnation, recorded, nextDelivery, nextJson)
      case IntentMissing{stage}: IO.pure(ReleaseOutcome, ReleaseIntentRefused{"missing", stage})
      case IntentStale{recorded, expected}: IO.pure(ReleaseOutcome, ReleaseIntentRefused{"stale", recorded ++ ":" ++ expected})
      case IntentUnreadable{stage, answer}: IO.pure(ReleaseOutcome, ReleaseIntentRefused{"unreadable", stage ++ ":" ++ answer})

def release_completed_after(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +claim: String, +effect: String, read: ReleaseIntent) -> IO(ReleaseOutcome):
  match read:
    case IntentAdmissible{recorded}: IO.pure(ReleaseOutcome, ReleaseEffectCompleted{claim, effect, document: recorded})
    case IntentMissing{stage}: IO.pure(ReleaseOutcome, ReleaseEffectUnpersisted{claim, effect, "completion:missing:" ++ stage})
    case IntentStale{recorded, expected}: IO.pure(ReleaseOutcome, ReleaseEffectUnpersisted{claim, effect, "completion:unconfirmed:" ++ recorded ++ ":" ++ expected})
    case IntentUnreadable{stage, answer}: IO.pure(ReleaseOutcome, ReleaseEffectUnpersisted{claim, effect, "completion:unreadable:" ++ stage ++ ":" ++ answer})

def release_completion(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +attempt: String, +completion: String, +completionJson: String, +effect: String) -> IO(ReleaseOutcome):
  do IO<ReleaseOutcome>:
    written : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, claim_completion_statement(query, role, incarnation, attempt, completionJson))
    match written:
      case Fail{error}:
        match error:
          case (code, detail): IO.pure(ReleaseOutcome, ReleaseEffectUnpersisted{attempt, effect, U32.show(code) ++ ":" ++ detail})
      case Done{+answer}:
        read : ReleaseIntent <- intent_read(db, binding, query, role, incarnation, completion)
        release_completed_after(db, binding, query, role, incarnation, attempt, effect, read)

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

def release_attempt_claim(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +attempt: String, +attemptJson: String, +completion: String, +completionJson: String, action: Unit -> IO(Result<&1,&1,U32 & String,String>)) -> IO(ReleaseOutcome):
  do IO<ReleaseOutcome>:
    claimed : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, claim_attempt_statement(query, role, incarnation, expectedDelivery, attemptJson))
    match claimed:
      case Fail{error}:
        match error:
          case (code, detail): IO.pure(ReleaseOutcome, ReleaseFailed{code, detail})
      case Done{+answer}: release_attempt_verify(db, binding, query, role, incarnation, attempt, completion, completionJson, action, answer)

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
