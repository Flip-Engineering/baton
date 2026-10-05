# CLAIM: the role rows, the observer cursor transaction and the release-intent claim
# of the managed semantic context. One transaction validates the recorded
# role/incarnation identity against the observer's expected cursor, commits the
# progress and the owed ordinary notice, and advances the consumed cursor.
#
# A first delivery writes the supplied capture, exit evidence and progress. An
# identical replay keeps the recorded bytes. A repeated event whose bytes differ
# aborts the whole transaction, because the cursor column is NOT NULL and the rule
# assigns NULL to it. A commit whose role row or query row is missing writes no
# notice at all; the caller's read of the role row is the detection point.
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

def cursor_expected(expected: String) -> String:
  "observer_cursor=" ++ C.q(expected)

def cursor_seen(next: String) -> String:
  "observer_cursor=" ++ C.q(next)

# The recorded progress of the query this role belongs to, read by its identity. A
# role row has no progress column of its own.
def recorded_progress(query: String) -> String:
  "(SELECT coalesce(progress_json,'') FROM semantic_queries WHERE id=" ++ C.q(query) ++ ")"

# An identical replay: the recorded cursor is already the next one, the supplied
# capture and exit evidence reproduce the recorded bytes, and the supplied progress
# reproduces the query's recorded progress. Anything else aborts.
def replay_guard(query: String, role: String, incarnation: String, next: String, +captureJson: String, +exitEvidenceJson: String, +progressJson: String) -> String:
  cursor_seen(next) ++ " AND coalesce(capture_json,'')=" ++ C.q(captureJson) ++ " AND coalesce(exit_evidence_json,'')=" ++ C.q(exitEvidenceJson) ++ " AND " ++ recorded_progress(query) ++ "=" ++ C.q(progressJson)

def admitted(expected: String, query: String, role: String, incarnation: String, next: String, +captureJson: String, +exitEvidenceJson: String, +progressJson: String) -> String:
  "(" ++ cursor_expected(expected) ++ " OR (" ++ replay_guard(query, role, incarnation, next, captureJson, exitEvidenceJson, progressJson) ++ "))"

# A first delivery writes the supplied value, an identical replay keeps the recorded
# value, and anything else assigns NULL to the NOT NULL cursor column. The recorded
# value is the column itself, so a retained NULL stays NULL and never becomes an
# empty string that the json_valid checks would refuse.
def replay_column(expected: String, query: String, role: String, incarnation: String, next: String, value: String, +captureJson: String, +exitEvidenceJson: String, +progressJson: String, recorded: String) -> String:
  "CASE WHEN " ++ cursor_expected(expected) ++ " THEN " ++ value ++ " WHEN " ++ replay_guard(query, role, incarnation, next, captureJson, exitEvidenceJson, progressJson) ++ " THEN " ++ recorded ++ " ELSE NULL END"

# A missing role row aborts the transaction, because the cursor column is NOT NULL.
# When the query row itself is missing the update matches no row, so nothing is
# written and the caller's role read returns no row.
def role_present_guard(query: String, role: String, incarnation: String) -> String:
  "UPDATE semantic_roles SET observer_cursor=CASE WHEN EXISTS(SELECT 1 FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ ") THEN observer_cursor ELSE NULL END WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ ";"

# One committed observation event. The role update carries the cursor rule; the
# progress write then runs in the same transaction, so a refused replay rolls both
# back, and the owed notice is inserted only while both the query row and the owner
# session exist.
def event_commit_sql(+query: String, +role: String, +incarnation: String, +owner: String, +expectedCursor: String, +nextCursor: String, +progressJson: String, +noticeId: String, +noticeBody: String, +captureJson: String, +exitEvidenceJson: String) -> String:
  "BEGIN IMMEDIATE;" ++ ContextStore.schema()
  ++ "UPDATE semantic_roles SET observer_cursor=" ++ replay_column(expectedCursor, query, role, incarnation, nextCursor, C.q(nextCursor), captureJson, exitEvidenceJson, progressJson, "observer_cursor") ++ ","
  ++ "capture_json=" ++ replay_column(expectedCursor, query, role, incarnation, nextCursor, ContextStore.json_or_null(captureJson), captureJson, exitEvidenceJson, progressJson, "capture_json") ++ ","
  ++ "exit_evidence_json=" ++ replay_column(expectedCursor, query, role, incarnation, nextCursor, ContextStore.json_or_null(exitEvidenceJson), captureJson, exitEvidenceJson, progressJson, "exit_evidence_json") ++ " "
  ++ "WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ ";"
  ++ role_present_guard(query, role, incarnation)
  ++ "UPDATE semantic_queries SET progress_json=" ++ ContextStore.json_or_null(progressJson) ++ " WHERE id=" ++ C.q(query) ++ ";"
  ++ ContextStore.owner_notice_bound_sql(noticeId, owner, noticeBody, query)
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

# The companion's read: one row naming whether this role's custody is missing, still
# owes a duty, or is settled. A missing role or query row is reported as `missing`
# rather than as a settled role, and an owed notice for this query keeps the answer
# unsettled.
def role_present(query: String, role: String, incarnation: String) -> String:
  "(EXISTS(SELECT 1 FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ ") AND EXISTS(SELECT 1 FROM semantic_queries WHERE id=" ++ C.q(query) ++ "))"

def intent_open(query: String, role: String, incarnation: String) -> String:
  "EXISTS(SELECT 1 FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ " AND (cleanup_phase IN ('pending','unavailable') OR (release_intent_json IS NOT NULL AND json_extract(release_intent_json,'$.delivery') IN ('pending','attempted','unknown')))) OR EXISTS(SELECT 1 FROM semantic_queries WHERE id=" ++ C.q(query) ++ " AND (cleanup_intent_json IS NOT NULL OR recovery_intent_json IS NOT NULL)) OR EXISTS(SELECT 1 FROM messages m WHERE m.receipt IS NULL AND substr(m.id,1,10)='[\"context-' AND instr(m.id," ++ C.q(query) ++ ")>0)"

# A recovery intent is a request to resume the existing duty. The observer clears it
# in the same transaction that records its observation, so a later reader sees the
# observation rather than a stale request.
def intent_read_sql(+query: String, role: String, incarnation: String) -> String:
  "SELECT CASE WHEN NOT (" ++ role_present(query, role, incarnation) ++ ") THEN 'missing' WHEN " ++ intent_open(query, role, incarnation) ++ " THEN '1' ELSE '0' END;"

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
