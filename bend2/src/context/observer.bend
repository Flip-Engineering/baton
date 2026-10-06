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

def line_count_ok(lines: List<String>) -> Bool:
  match lines:
    case Nil{}: True{}
    case +line <> +rest:
      match rest:
        case Nil{}: Bool.not(String.is_empty(line))
        case _: False{}

# The rows are bound before they are inspected, so the scrutinee is a parameter.
def single_line(+row: String) -> Bool:
  line_count_ok(Tx.split_lines(row))

def row_shaped(+answer: String) -> Bool:
  Bool.and(single_line(answer), String.starts_with(answer, "{"))

def row_read(+answer: String) -> RowRead:
  Bool.pick(RowRead, String.is_empty(answer), RowAbsent{},
  Bool.pick(RowRead, row_shaped(answer), RowDocument{answer}, RowMalformed{answer}))

def step_of(read: RowRead) -> ObserverStep:
  match read:
    case RowAbsent{}: ObserverAbsent{"role row"}
    case RowDocument{document}: ObserverCommitted{document}
    case RowMalformed{answer}: ObserverUnreadable{"row", answer}

def step_after(result: Result<&1,&1,U32 & String,String>) -> ObserverStep:
  match result:
    case Done{+answer}: step_of(row_read(answer))
    case Fail{error}:
      match error:
        case (code, detail): ObserverFailed{code, detail}

def release_of(+effect: String, read: RowRead) -> ReleaseOutcome:
  match read:
    case RowAbsent{}: ReleaseUnreadable{"row", ""}
    case RowDocument{document}: ReleaseEffectCompleted{effect, document}
    case RowMalformed{answer}: ReleaseUnreadable{"row", answer}

def release_row(+effect: String, result: Result<&1,&1,U32 & String,String>) -> ReleaseOutcome:
  match result:
    case Done{+answer}: release_of(effect, row_read(answer))
    case Fail{error}:
      match error:
        case (code, detail): ReleaseFailed{code, detail}

def claim_of(read: RowRead) -> ReleaseOutcome:
  match read:
    case RowAbsent{}: ReleaseUnreadable{"row", ""}
    case RowDocument{document}: ReleaseClaimOnly{document}
    case RowMalformed{answer}: ReleaseUnreadable{"row", answer}

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
                case _: IntentMissing{"shape"}
            case _: IntentMissing{"short"}
        case _: IntentMissing{"short"}
    case _: IntentMissing{"short"}
def intent_fields(+expected: String, +row: String, lines: List<String>) -> ReleaseIntent:
  match lines:
    case Nil{}: IntentMissing{"empty"}
    case +line <> +rest:
      match rest:
        case Nil{}: intent_tabs(expected, row, Tx.split_tabs(line))
        case _: IntentMissing{"surplus"}
def intent_decode(+expected: String, +row: String) -> ReleaseIntent:
  intent_fields(expected, row, Tx.split_lines(row))
def intent_after(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expected: String, result: Result<&1,&1,U32 & String,String>) -> IO(ReleaseIntent):
  match result:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(ReleaseIntent, IntentMissing{"host:" ++ U32.show(code) ++ ":" ++ detail})
    case Done{+rows}: IO.pure(ReleaseIntent, intent_decode(expected, rows))

def intent_read(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expected: String) -> IO(ReleaseIntent):
  do IO<ReleaseIntent>:
    read : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, intent_sql(query, role, incarnation))
    intent_after(db, binding, query, role, incarnation, expected, read)

# A rendered error document, when the caller supplied one. The empty case is its own value so
# the commit below branches on a parameter rather than on a computed condition. This checks
# non-empty text only: it is not schema validation, which remains the caller's operand.
def failure_schema(+failureJson: String) -> Maybe<String>:
  Bool.pick(Maybe<String>, String.is_empty(failureJson), None{}, Some{failureJson})

# The terminal payload identity: a repeated terminal state is admitted only when the stored
# result and error are the same documents as the supplied ones under the same rendering the
# write uses. A changed document assigns NULL to the not-null state column, which aborts the
# whole transaction before any progress or notice is applied. This is deliberately stricter
# than the publish path, whose text stays untouched.
def terminal_payload_matches(+next: String, +resultJson: String, +errorJson: String) -> String:
  "state=" ++ C.q(next) ++ " AND result_json IS " ++ ContextStore.json_or_null(resultJson) ++ " AND error_json IS " ++ ContextStore.json_or_null(errorJson)

# One event commit: the same statement the role observer already uses, whose guards keep the
# cursor, the capture and the exit evidence replay-safe and whose notice is bound to the query.
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
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, commit_event_sql(query, role, incarnation, owner, expectedCursor, nextCursor, progressJson, noticeId, noticeBody, captureJson, exitEvidenceJson))
    IO.pure(ObserverStep, step_after(result))

# The database claim alone: it records the committed intent's delivery state and completes the
# release state while the query's evaluation state stays untouched. It proves no keeper
# release and is not a substitute for the effect.











def release_claim_state(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +delivery: String, result: Result<&1,&1,U32 & String,String>) -> IO(ReleaseOutcome):
  match result:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(ReleaseOutcome, ReleaseFailed{code, detail})
    case Done{+answer}: IO.pure(ReleaseOutcome, ReleaseClaimOnly{delivery})

# The completion stage: the effect already ran, so a failed or unverified completion keeps the
# effect observation rather than losing it behind the failure.

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

def claim_release(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +nextJson: String) -> IO(ReleaseOutcome):
  do IO<ReleaseOutcome>:
    read : ReleaseIntent <- intent_read(db, binding, query, role, incarnation, expectedDelivery)
    claim_release_after(db, binding, query, role, incarnation, expectedDelivery, nextJson, read)

def release_refusal_check(+binding: String, +keeper: String, +expectedKeeper: String, +admitted: String) -> Maybe<ReleaseOutcome>:
  match custody_check(binding, admitted, keeper, expectedKeeper):
    case CustodyMismatch{binding, custodyBinding}: Some{ReleaseCustodyMismatch{binding, custodyBinding}}
    case CustodyForeignKeeper{keeper, expectedKeeper}: Some{ReleaseForeignKeeper{keeper, expectedKeeper}}
    case CustodyAdmitted{binding}: None{}

def release_refusal(+binding: String, +expectedKeeper: String, custody: Maybe<Custody>) -> Maybe<ReleaseOutcome>:
  match custody:
    case None{}: Some{ReleaseMissingCustody{"keeper under admitted custody"}}
    case Some{+held}:
      match held:
        case Custody{keeper, admitted, holder}: release_refusal_check(binding, keeper, expectedKeeper, admitted)





def intent_refusal_text(read: ReleaseIntent) -> String:
  match read:
    case IntentAdmissible{delivery}: ""
    case IntentMissing{stage}: "missing:" ++ stage
    case IntentStale{recorded, expected}: "stale:" ++ recorded ++ ":" ++ expected

def release_completed_after(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +claim: String, +effect: String, +delivery: String, read: ReleaseIntent) -> IO(ReleaseOutcome):
  match read:
    case IntentAdmissible{recorded}: IO.pure(ReleaseOutcome, ReleaseEffectCompleted{claim, effect, document: recorded})
    case IntentMissing{stage}: IO.pure(ReleaseOutcome, ReleaseEffectUnpersisted{claim, effect, "completion:missing:" ++ stage})
    case IntentStale{recorded, expected}: IO.pure(ReleaseOutcome, ReleaseEffectUnpersisted{claim, effect, "completion:stale:" ++ recorded ++ ":" ++ expected})

def release_completion(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +completionDelivery: String, +completionJson: String, +claim: String, +effect: String) -> IO(ReleaseOutcome):
  do IO<ReleaseOutcome>:
    written : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextRoles.release_claim_sql(query, role, incarnation, expectedDelivery, completionJson))
    match written:
      case Fail{error}:
        match error:
          case (code, detail): IO.pure(ReleaseOutcome, ReleaseEffectUnpersisted{claim, effect, U32.show(code) ++ ":" ++ detail})
      case Done{+answer}:
        read : ReleaseIntent <- intent_read(db, binding, query, role, incarnation, completionDelivery)
        release_completed_after(db, binding, query, role, incarnation, claim, effect, completionDelivery, read)

def release_effect_after(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +completionDelivery: String, +completionJson: String, +claim: String, result: Result<&1,&1,U32 & String,String>) -> IO(ReleaseOutcome):
  match result:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(ReleaseOutcome, ReleaseFailed{code, detail})
    case Done{+effect}: release_completion(db, binding, query, role, incarnation, expectedDelivery, completionDelivery, completionJson, claim, effect)

# Stage two: the intent was claimed, so the effect may run. Its answer is kept either way.
def release_effect_run(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +completionDelivery: String, +completionJson: String, +claim: String, action: Unit -> IO(Result<&1,&1,U32 & String,String>)) -> IO(ReleaseOutcome):
  do IO<ReleaseOutcome>:
    acted : Result<&1,&1,U32 & String,String> <- action(Unit{})
    release_effect_after(db, binding, query, role, incarnation, expectedDelivery, completionDelivery, completionJson, claim, acted)

# Stage one: the retained intent decides, then the attempt claim records it. Only a recorded
# claim lets the effect run, so a missing or stale intent can no longer reach the keeper.
def release_claim_run(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +completionDelivery: String, +completionJson: String, +claim: String, action: Unit -> IO(Result<&1,&1,U32 & String,String>)) -> IO(ReleaseOutcome):
  do IO<ReleaseOutcome>:
    claimed : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextRoles.release_claim_sql(query, role, incarnation, expectedDelivery, claim))
    match claimed:
      case Fail{error}:
        match error:
          case (code, detail): IO.pure(ReleaseOutcome, ReleaseFailed{code, detail})
      case Done{+answer}: release_effect_run(db, binding, query, role, incarnation, expectedDelivery, completionDelivery, completionJson, claim, action)

def release_claim_after(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +completionDelivery: String, +completionJson: String, action: Unit -> IO(Result<&1,&1,U32 & String,String>), read: ReleaseIntent) -> IO(ReleaseOutcome):
  match read:
    case IntentAdmissible{delivery}: release_claim_run(db, binding, query, role, incarnation, expectedDelivery, completionDelivery, completionJson, delivery, action)
    case IntentMissing{stage}: IO.pure(ReleaseOutcome, ReleaseIntentRefused{"missing", stage})
    case IntentStale{recorded, expected}: IO.pure(ReleaseOutcome, ReleaseIntentRefused{"stale", recorded ++ ":" ++ expected})

def release_intent_after(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +completionDelivery: String, +completionJson: String, action: Unit -> IO(Result<&1,&1,U32 & String,String>), read: ReleaseIntent) -> IO(ReleaseOutcome):
  release_claim_after(db, binding, query, role, incarnation, expectedDelivery, completionDelivery, completionJson, action, read)

# The release: custody refusal first, then the retained intent, then the claim, then the effect,
# then the completion read-back. Each stage is distinct, and the effect's observation survives a
# later persistence failure.
def release_intent_read(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +completionDelivery: String, +completionJson: String, action: Unit -> IO(Result<&1,&1,U32 & String,String>)) -> IO(ReleaseOutcome):
  do IO<ReleaseOutcome>:
    read : ReleaseIntent <- intent_read(db, binding, query, role, incarnation, expectedDelivery)
    release_intent_after(db, binding, query, role, incarnation, expectedDelivery, completionDelivery, completionJson, action, read)

def release_intent_start(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +completionDelivery: String, +completionJson: String, +expectedKeeper: String, action: Unit -> IO(Result<&1,&1,U32 & String,String>), refusal: Maybe<ReleaseOutcome>) -> IO(ReleaseOutcome):
  match refusal:
    case Some{+outcome}: IO.pure(ReleaseOutcome, outcome)
    case None{}: release_intent_read(db, binding, query, role, incarnation, expectedDelivery, completionDelivery, completionJson, action)

def release_target(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +completionDelivery: String, +completionJson: String, +expectedKeeper: String, action: Unit -> IO(Result<&1,&1,U32 & String,String>), custody: Maybe<Custody>) -> IO(ReleaseOutcome):
  release_intent_start(db, binding, query, role, incarnation, expectedDelivery, completionDelivery, completionJson, expectedKeeper, action, release_refusal(binding, expectedKeeper, custody))

def release_unavailable(+keeper: String, +holder: String, +need: String) -> ReleaseOutcome:
  ReleaseEffectUnavailable{keeper, holder, need}

def commit_failed_schema(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +owner: String, +expectedCursor: String, +nextCursor: String, +progressJson: String, +noticeId: String, +noticeBody: String, +captureJson: String, +exitEvidenceJson: String, +code: U32, +detail: String, schema: Maybe<String>) -> IO(ObserverStep):
  match schema:
    case None{}: IO.pure(ObserverStep, ObserverFailed{code, detail})
    case Some{+rendered}:
      do IO<ObserverStep>:
        committed : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, commit_result_sql(query, role, incarnation, owner, expectedCursor, nextCursor, "failed", "", rendered, progressJson, noticeId, noticeBody, captureJson, exitEvidenceJson))
        IO.pure(ObserverStep, step_after(committed))

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
        committed : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, commit_result_sql(query, role, incarnation, owner, expectedCursor, nextCursor, "complete", document, "", progressJson, noticeId, noticeBody, captureJson, exitEvidenceJson))
        IO.pure(ObserverStep, step_after(committed))
    case Fail{error}:
      match error:
        case (code, detail): commit_failed(db, binding, query, role, incarnation, owner, expectedCursor, nextCursor, failureJson, progressJson, noticeId, noticeBody, captureJson, exitEvidenceJson, code, detail)
