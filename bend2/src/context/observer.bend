# CLAIM: the observer consumer of the selected artifact's managed binding and original
# keeper. It commits one observed event, commits the completed result coherently with its
# notice and cursor, and releases one target from its committed intent.
#
# The physical per-call file binding says which file this call observes. It is not custody:
# the keeper and its admitted custody arrive as a supplied value, and no handle, Boolean
# authority or signal success is fabricated when that value is absent.
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

# One observer step. A failed step keeps the host or validation code and detail.
type ObserverStep is Data:
  ObserverCommitted{document: String}
  ObserverFailed{code: U32, detail: String}

# One release outcome. Missing custody is its own answer, and so is a custody held under a
# different binding.
type ReleaseOutcome is Data:
  ReleaseClaimed{document: String}
  ReleaseMissingCustody{need: String}
  ReleaseCustodyMismatch{binding: String, custodyBinding: String}
  ReleaseFailed{code: U32, detail: String}
  ReleaseUnreadable{stage: String, answer: String}

# One event commit: the same statement the role observer already uses, whose guards keep the
# cursor, the capture and the exit evidence replay-safe and whose notice is bound to the query.
def commit_event_sql(+query: String, +role: String, +incarnation: String, +owner: String, +expectedCursor: String, +nextCursor: String, +progressJson: String, +noticeId: String, +noticeBody: String, +captureJson: String, +exitEvidenceJson: String) -> String:
  ContextRoles.event_commit_sql(query, role, incarnation, owner, expectedCursor, nextCursor, progressJson, noticeId, noticeBody, captureJson, exitEvidenceJson)

# The result commit the event commit lacks: the terminal guard the publish path uses decides
# whether this commit records the result or aborts, the role cursor guard keeps the expected
# cursor, and the notice is bound to the query. Both guards are composed from the same
# expressions the publish and event paths use rather than restated.
def commit_result_sql(+query: String, +role: String, +incarnation: String, +owner: String, +expectedCursor: String, +nextCursor: String, +next: String, +resultJson: String, +errorJson: String, +progressJson: String, +noticeId: String, +noticeBody: String, +captureJson: String, +exitEvidenceJson: String) -> String:
  "BEGIN IMMEDIATE;" ++ ContextStore.schema()
  ++ "UPDATE semantic_queries SET state=CASE WHEN " ++ ContextStore.terminal_recorded() ++ " THEN CASE WHEN state=" ++ C.q(next) ++ " THEN state ELSE NULL END ELSE " ++ C.q(next) ++ " END,"
  ++ "result_json=CASE WHEN " ++ ContextStore.terminal_recorded() ++ " THEN result_json ELSE " ++ ContextStore.json_or_null(resultJson) ++ " END,"
  ++ "error_json=CASE WHEN " ++ ContextStore.terminal_recorded() ++ " THEN error_json ELSE " ++ ContextStore.json_or_null(errorJson) ++ " END "
  ++ "WHERE id=" ++ C.q(query) ++ ";"
  ++ "UPDATE semantic_roles SET observer_cursor=" ++ ContextRoles.replay_column(expectedCursor, query, role, incarnation, nextCursor, C.q(nextCursor), captureJson, exitEvidenceJson, progressJson, "observer_cursor") ++ " "
  ++ "WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ ";"
  ++ ContextRoles.role_present_guard(query, role, incarnation)
  ++ "UPDATE semantic_queries SET progress_json=" ++ ContextStore.json_or_null(progressJson) ++ " WHERE id=" ++ C.q(query) ++ ";"
  ++ ContextStore.owner_notice_bound_sql(noticeId, owner, noticeBody, query)
  ++ ContextRoles.role_read_sql(query, role, incarnation) ++ "COMMIT;"
def step_after(result: Result<&1,&1,U32 & String,String>) -> ObserverStep:
  match result:
    case Done{+document}: ObserverCommitted{document}
    case Fail{error}:
      match error:
        case (code, detail): ObserverFailed{code, detail}
def failure_schema(+failureJson: String) -> Maybe<String>:
  Bool.pick(Maybe<String>, String.is_empty(failureJson), None{}, Some{failureJson})

# The validated outcome decides what is recorded: a validated document publishes complete, and
# a failed validation publishes failed with the caller's rendered error document. A failed
# validation with no rendered error document records nothing and reports the failure, because
# the error document schema belongs to the notification contract rather than to this module.
def custody_check(+binding: String, +custodyBinding: String) -> CustodyCheck:
  Bool.pick(CustodyCheck, String.eq(custodyBinding, binding), CustodyAdmitted{binding}, CustodyMismatch{binding, custodyBinding})

# One release: the committed target intent and the original keeper under admitted custody. The
# claim completes the release state and leaves the query's evaluation state alone, so it
# completes while evaluation remains pending. Custody is a supplied value; when it is absent
# the answer names the missing operand instead of a fabricated handle.
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
def commit_result(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +owner: String, +expectedCursor: String, +nextCursor: String, verdict: Result<&1,&1,U32 & String,String>, +failureJson: String, +progressJson: String, +noticeId: String, +noticeBody: String, +captureJson: String, +exitEvidenceJson: String) -> IO(ObserverStep):
  match verdict:
    case Done{+document}:
      do IO<ObserverStep>:
        committed : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, commit_result_sql(query, role, incarnation, owner, expectedCursor, nextCursor, "complete", document, "", progressJson, noticeId, noticeBody, captureJson, exitEvidenceJson))
        IO.pure(ObserverStep, step_after(committed))
    case Fail{error}:
      match error:
        case (code, detail): commit_failed(db, binding, query, role, incarnation, owner, expectedCursor, nextCursor, failureJson, progressJson, noticeId, noticeBody, captureJson, exitEvidenceJson, code, detail)
def commit_event(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +owner: String, +expectedCursor: String, +nextCursor: String, +progressJson: String, +noticeId: String, +noticeBody: String, +captureJson: String, +exitEvidenceJson: String) -> IO(ObserverStep):
  do IO<ObserverStep>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, commit_event_sql(query, role, incarnation, owner, expectedCursor, nextCursor, progressJson, noticeId, noticeBody, captureJson, exitEvidenceJson))
    IO.pure(ObserverStep, step_after(result))

# A rendered error document, when the caller supplied one. The empty case is its own value so
# the commit below branches on a parameter rather than on a computed condition.
def release_checked_after(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +nextJson: String, check: CustodyCheck) -> IO(ReleaseOutcome):
  match check:
    case CustodyMismatch{binding, custodyBinding}: IO.pure(ReleaseOutcome, ReleaseCustodyMismatch{binding, custodyBinding})
    case CustodyAdmitted{binding}:
      do IO<ReleaseOutcome>:
        claimed : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextRoles.release_claim_sql(query, role, incarnation, expectedDelivery, nextJson))
        match claimed:
          case Done{+document}: IO.pure(ReleaseOutcome, ReleaseClaimed{document})
          case Fail{error}:
            match error:
              case (code, detail): IO.pure(ReleaseOutcome, ReleaseFailed{code, detail})
def release_checked(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +nextJson: String, +admitted: String) -> IO(ReleaseOutcome):
  do IO<ReleaseOutcome>:
    check : CustodyCheck <- IO.pure(CustodyCheck, custody_check(binding, admitted))
    release_checked_after(db, binding, query, role, incarnation, expectedDelivery, nextJson, check)
def release_target(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, +expectedDelivery: String, +nextJson: String, custody: Maybe<Custody>) -> IO(ReleaseOutcome):
  match custody:
    case None{}: IO.pure(ReleaseOutcome, ReleaseMissingCustody{"keeper under admitted custody"})
    case Some{+held}:
      match held:
        case Custody{keeper, admitted, holder}: release_checked(db, binding, query, role, incarnation, expectedDelivery, nextJson, admitted)
