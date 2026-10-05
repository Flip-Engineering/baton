# CLAIM: the role rows, the observer cursor transaction and the release-intent claim
# of the managed semantic context. One transaction validates the recorded
# role/incarnation identity and the expected cursor, commits the progress and the
# owed ordinary notice, and advances the consumed cursor; a repeated identical event
# keeps the original notice body, and a different event under the same identity
# aborts the transaction instead of overwriting custody.
#
# The signal-attempt claim moves a pending release intent to attempted before the
# syscall, and a later admission cannot downgrade an explicit SIGKILL intent to
# SIGTERM. Every abort uses a NULL assignment to a NOT NULL column, so a conflicting
# write rolls the whole transaction back rather than partially applying.
import Base
import ../coordinator/commands.bend as C
import ../json/canonical.bend as J
import ./store.bend as ContextStore

def role_record_guard() -> String:
  " ON CONFLICT(query_id,role,incarnation) DO UPDATE SET query_id=CASE WHEN semantic_roles.keeper_path=excluded.keeper_path AND semantic_roles.guard_key=excluded.guard_key AND semantic_roles.guard_identity_json=excluded.guard_identity_json AND semantic_roles.database_binding_json=excluded.database_binding_json THEN semantic_roles.query_id ELSE NULL END;"

def role_read_sql(+query: String, +role: String, +incarnation: String) -> String:
  "SELECT json_object('query',query_id,'role',role,'incarnation',incarnation,'keeperPath',keeper_path,'guardAnchor',guard_anchor,'guardKey',guard_key,'guardIdentity',json(guard_identity_json),'recoveryArgv',json(recovery_argv_json),'databaseBinding',json(database_binding_json),'phase',phase,'observerIdentity',CASE WHEN observer_identity_json IS NULL THEN NULL ELSE json(observer_identity_json) END,'observerCursor',observer_cursor,'exitEvidence',CASE WHEN exit_evidence_json IS NULL THEN NULL ELSE json(exit_evidence_json) END,'capture',CASE WHEN capture_json IS NULL THEN NULL ELSE json(capture_json) END,'releaseIntent',CASE WHEN release_intent_json IS NULL THEN NULL ELSE json(release_intent_json) END,'cleanupPhase',cleanup_phase) FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ ";"

# One recorded role. The full identity, the guard key, the expected database binding
# and the recovery argv are recorded before the role may perform an effect; a
# repeated identity with different content aborts.
def role_row_sql(+query: String, +role: String, +incarnation: String, +keeperPath: String, +anchor: String, +key: String, +identityJson: String, +recoveryArgvJson: String, +bindingJson: String, +phase: String, +cleanupPhase: String) -> String:
  "INSERT INTO semantic_roles(query_id,role,incarnation,keeper_path,guard_anchor,guard_key,guard_identity_json,recovery_argv_json,database_binding_json,phase,observer_cursor,cleanup_phase) VALUES("
  ++ C.q(query) ++ "," ++ C.q(role) ++ "," ++ C.q(incarnation) ++ "," ++ C.q(keeperPath) ++ "," ++ C.q(anchor) ++ "," ++ C.q(key) ++ "," ++ C.q(identityJson) ++ "," ++ C.q(recoveryArgvJson) ++ "," ++ C.q(bindingJson) ++ "," ++ C.q(phase) ++ ",''," ++ C.q(cleanupPhase) ++ ")"
  ++ role_record_guard() ++ role_read_sql(query, role, incarnation)

# The cursor guard admits the next event exactly once: the recorded cursor is either
# the expected one or already the next one, which makes an identical replay
# idempotent while a foreign or out-of-order event aborts.
def cursor_guard(expected: String, next: String) -> String:
  "(observer_cursor=" ++ C.q(expected) ++ " OR observer_cursor=" ++ C.q(next) ++ ")"

def cursor_expected(expected: String) -> String:
  "observer_cursor=" ++ C.q(expected)

def cursor_seen(next: String) -> String:
  "observer_cursor=" ++ C.q(next)

# An identical replay: the recorded cursor is already the next one and the supplied
# evidence and progress reproduce the recorded bytes exactly. Anything else that
# reaches this branch aborts the transaction instead of overwriting custody evidence
# or progress.
def replay_guard(expected: String, next: String, +captureJson: String, +exitEvidenceJson: String, +progressJson: String) -> String:
  cursor_seen(next) ++ " AND coalesce(capture_json,'')=" ++ C.q(captureJson) ++ " AND coalesce(exit_evidence_json,'')=" ++ C.q(exitEvidenceJson) ++ " AND coalesce(progress_json,'')=" ++ C.q(progressJson)

def admitted(expected: String, next: String, +captureJson: String, +exitEvidenceJson: String, +progressJson: String) -> String:
  "(" ++ cursor_expected(expected) ++ " OR (" ++ replay_guard(expected, next, captureJson, exitEvidenceJson, progressJson) ++ "))"

# The first delivery writes the supplied value; an identical replay keeps the
# recorded bytes; anything else assigns NULL to the NOT NULL cursor column and aborts
# the whole transaction.
def replay_column(expected: String, next: String, value: String, +captureJson: String, +exitEvidenceJson: String, +progressJson: String, recorded: String) -> String:
  "CASE WHEN " ++ cursor_expected(expected) ++ " THEN " ++ value ++ " WHEN " ++ replay_guard(expected, next, captureJson, exitEvidenceJson, progressJson) ++ " THEN " ++ recorded ++ " ELSE NULL END"

# One committed observation event. Progress and the owed notice belong to the same
# transaction as the cursor advance, so a recovered observer reads committed
# progress and a notice that was never lost.
def event_commit_sql(+query: String, +role: String, +incarnation: String, +owner: String, +expectedCursor: String, +nextCursor: String, +progressJson: String, +noticeId: String, +noticeBody: String, +captureJson: String, +exitEvidenceJson: String) -> String:
  "BEGIN IMMEDIATE;" ++ ContextStore.schema()
  ++ "UPDATE semantic_roles SET observer_cursor=" ++ replay_column(expectedCursor, nextCursor, C.q(nextCursor), captureJson, exitEvidenceJson, progressJson, "observer_cursor") ++ ","
  ++ "capture_json=" ++ replay_column(expectedCursor, nextCursor, ContextStore.json_or_null(captureJson), captureJson, exitEvidenceJson, progressJson, "coalesce(capture_json,'')") ++ ","
  ++ "exit_evidence_json=" ++ replay_column(expectedCursor, nextCursor, ContextStore.json_or_null(exitEvidenceJson), captureJson, exitEvidenceJson, progressJson, "coalesce(exit_evidence_json,'')") ++ " "
  ++ "WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ ";"
  ++ role_present_guard(query, role, incarnation)
  ++ ContextStore.progress_guarded_sql(admitted(expectedCursor, nextCursor, captureJson, exitEvidenceJson, progressJson), query, owner, progressJson, noticeId, noticeBody)
  ++ role_read_sql(query, role, incarnation) ++ "COMMIT;"

# The signal-attempt claim. Only a pending intent, or the recorded signal itself,
# admits the attempt; the second assignment is the abort sentinel because the
# release intent column is nullable.
def release_claim_sql(+query: String, +role: String, +incarnation: String, +expectedDelivery: String, +nextJson: String) -> String:
  "BEGIN IMMEDIATE;" ++ ContextStore.schema()
  ++ "UPDATE semantic_roles SET release_intent_json=CASE WHEN json_extract(release_intent_json,'$.delivery')=" ++ C.q(expectedDelivery) ++ " THEN " ++ ContextStore.json_or_null(nextJson) ++ " ELSE release_intent_json END,"
  ++ "observer_cursor=CASE WHEN json_extract(release_intent_json,'$.delivery')=" ++ C.q(expectedDelivery) ++ " THEN observer_cursor ELSE NULL END "
  ++ "WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ ";"
  ++ role_present_guard(query, role, incarnation)
  ++ role_read_sql(query, role, incarnation) ++ "COMMIT;"

# The companion's read: one row answering whether this role still has a live or
# unsettled duty. A role with a pending, attempted or unknown release intent, an
# unsettled cleanup phase, or a query-level cleanup or recovery intent keeps the
# companion reading.
def intent_read_sql(+query: String, +role: String, +incarnation: String) -> String:
  "SELECT CASE WHEN EXISTS(SELECT 1 FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ " AND (cleanup_phase IN ('pending','unavailable') OR (release_intent_json IS NOT NULL AND json_extract(release_intent_json,'$.delivery') IN ('pending','attempted','unknown')))) OR EXISTS(SELECT 1 FROM semantic_queries WHERE id=" ++ C.q(query) ++ " AND (cleanup_intent_json IS NOT NULL OR recovery_intent_json IS NOT NULL)) THEN 1 ELSE 0 END;"

# A recovery intent is a request to resume the existing duty. The observer clears it
# in the same transaction that records its observation, so a later reader sees the
# observation rather than a stale request.
def recovery_observed_sql(+query: String, controlQuery: String) -> String:
  "BEGIN IMMEDIATE;" ++ ContextStore.schema()
  ++ "UPDATE semantic_queries SET recovery_intent_json=NULL WHERE id=" ++ C.q(query) ++ " AND json_extract(recovery_intent_json,'$.controlQuery')=" ++ C.q(controlQuery) ++ ";"
  ++ ContextStore.envelope_sql(query) ++ "COMMIT;"

# Owed notice identities derive from the retained query or role/event identity, so a
# replayed event preserves the original message and a query-terminal notice uses the
# query identity even when the runtime ID is null.
def progress_notice_id(query: String, role: String, incarnation: String, sequence: String) -> String:
  J.json_text(J.Jarr{J.Jstr{"context-progress"},
    J.Jarr{J.Jstr{query}, J.Jarr{J.Jstr{role}, J.Jarr{J.Jstr{incarnation}, J.Jarr{J.Jstr{sequence}, J.Jnil{}}}}}})

def terminal_notice_id(query: String) -> String:
  J.json_text(J.Jarr{J.Jstr{"context-terminal"}, J.Jarr{J.Jstr{query}, J.Jnil{}}})
