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

# One release outcome. Claim-only and effect-completed are distinct answers, missing custody is
# its own answer, an unavailable keeper action names the missing primitive, and a custody held
# under a different binding answers with both bindings.
type ReleaseOutcome is Data:
  ReleaseEffectCompleted{effect: String, document: String}
  ReleaseClaimOnly{document: String}
  ReleaseEffectUnavailable{keeper: String, holder: String, need: String}
  ReleaseMissingCustody{need: String}
  ReleaseCustodyMismatch{binding: String, custodyBinding: String}
  ReleaseFailed{code: U32, detail: String}
  ReleaseUnreadable{stage: String, answer: String}

def single_line(+row: String) -> Bool:
  match Tx.split_lines(row):
    case Nil{}: True{}
    case +line <> +rest:
      match rest:
        case Nil{}: Bool.not(String.is_empty(line))
        case _: False{}

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

def custody_check(+binding: String, +custodyBinding: String) -> CustodyCheck:
  Bool.pick(CustodyCheck, String.eq(custodyBinding, binding), CustodyAdmitted{binding}, CustodyMismatch{binding, custodyBinding})

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
def claim_release(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +nextJson: String) -> IO(ReleaseOutcome):
  do IO<ReleaseOutcome>:
    claimed : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextRoles.release_claim_sql(query, role, incarnation, expectedDelivery, nextJson))
    match claimed:
      case Done{+answer}: IO.pure(ReleaseOutcome, claim_of(row_read(answer)))
      case Fail{error}:
        match error:
          case (code, detail): IO.pure(ReleaseOutcome, ReleaseFailed{code, detail})











def release_unavailable(+keeper: String, +holder: String, +need: String) -> ReleaseOutcome:
  ReleaseEffectUnavailable{keeper, holder, need}

# One release: the committed target intent and the original keeper under admitted custody. The
# supplied keeper action runs first; only when it answers does the database claim follow, so a
# completed release carries the effect's own answer beside the claim's read-back. Missing
# custody and a custody held under another binding are answered before any effect.

def release_refusal_check(+binding: String, +admitted: String) -> Maybe<ReleaseOutcome>:
  match custody_check(binding, admitted):
    case CustodyMismatch{binding, custodyBinding}: Some{ReleaseCustodyMismatch{binding, custodyBinding}}
    case CustodyAdmitted{binding}: None{}

def release_refusal(+binding: String, custody: Maybe<Custody>) -> Maybe<ReleaseOutcome>:
  match custody:
    case None{}: Some{ReleaseMissingCustody{"keeper under admitted custody"}}
    case Some{+held}:
      match held:
        case Custody{keeper, admitted, holder}: release_refusal_check(binding, admitted)



def release_claimed(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +nextJson: String, +evidence: String) -> IO(ReleaseOutcome):
  do IO<ReleaseOutcome>:
    claimed : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextRoles.release_claim_sql(query, role, incarnation, expectedDelivery, nextJson))
    IO.pure(ReleaseOutcome, release_row(evidence, claimed))

# The pre-effect refusal, as a pure decision so it can be law-tested: missing custody, a
# custody held under another binding, or nothing when the effect may run.

def release_effect(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +nextJson: String, action: Unit -> IO(Result<&1,&1,U32 & String,String>)) -> IO(ReleaseOutcome):
  do IO<ReleaseOutcome>:
    effected : Result<&1,&1,U32 & String,String> <- action(Unit{})
    match effected:
      case Fail{error}:
        match error:
          case (code, detail): IO.pure(ReleaseOutcome, ReleaseFailed{code, detail})
      case Done{+evidence}: release_claimed(db, binding, query, role, incarnation, expectedDelivery, nextJson, evidence)

def release_start(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +nextJson: String, action: Unit -> IO(Result<&1,&1,U32 & String,String>), refusal: Maybe<ReleaseOutcome>) -> IO(ReleaseOutcome):
  match refusal:
    case Some{+outcome}: IO.pure(ReleaseOutcome, outcome)
    case None{}: release_effect(db, binding, query, role, incarnation, expectedDelivery, nextJson, action)

def release_target(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +nextJson: String, action: Unit -> IO(Result<&1,&1,U32 & String,String>), custody: Maybe<Custody>) -> IO(ReleaseOutcome):
  release_start(db, binding, query, role, incarnation, expectedDelivery, nextJson, action, release_refusal(binding, custody))

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
