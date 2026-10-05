# CLAIM: the persistent store of the managed semantic context. The three tables,
# the admission insert whose repeated ID replays only an identical canonical
# request and owner, the retained rejection with its owed notice, and the terminal
# publication guard that a late provider event cannot overwrite.
#
# Every statement is one SQL text the store transaction executes; the native caller
# reads the row it stored rather than trusting a computed answer. The schema is
# appended to the shared transaction by the interfaces owner and never replaces the
# coordinator's own tables. JSON documents arrive as canonical text and are stored
# verbatim, so the stored request body is compared exactly on replay.
import Base
import ../coordinator/commands.bend as C

# The three specification tables. JSON columns carry json_valid checks, so a
# malformed retained document cannot be committed. `observer_cursor` and `state`
# are NOT NULL because the event-commit and terminal-publish guards use a null
# assignment to abort a conflicting write.
def runtime_epoch_column() -> String:
  "epoch TEXT NOT NULL"

# The canonical unsigned decimal counter profile: `0`, or a nonzero digit followed by
# digits. The profile is exact text, so a sign, a fraction, an exponent, an empty
# token, a leading zero or any non-digit refuses; length is unbounded.
def head_of(s: String) -> String:
  match s:
    case SNil{}: ""
    case SCon{c, rest}: SCon{c, SNil{}}

def tail_of(s: String) -> String:
  match s:
    case SNil{}: SNil{}
    case SCon{c, rest}: rest

def is_digit(c: Char) -> Bool:
  +code = Char.to_u32(c)
  Bool.and(U32.is_lt(47, code), U32.is_lt(code, 58))

def digits_only(s: String) -> Bool:
  match s:
    case SNil{}: True{}
    case SCon{c, rest}: Bool.and(is_digit(c), digits_only(rest))

def head_char(s: String) -> Char:
  match s:
    case SNil{}: Char.from_u32(0)
    case SCon{c, rest}: c

def nonzero_digit(+c: Char) -> Bool:
  +code = Char.to_u32(c)
  Bool.and(U32.is_lt(48, code), U32.is_lt(code, 58))

def runtime_epoch_ok(+value: String) -> Bool:
  match value:
    case "":
      False{}
    case "0":
      True{}
    case other:
      Bool.and(nonzero_digit(head_char(other)), digits_only(tail_of(other)))

# The same profile as one SQL predicate, so the store text can refuse a malformed
# counter in its own statement instead of storing whatever it was handed.
def runtime_epoch_sql_ok(expr: String) -> String:
  "((" ++ expr ++ ")='0' OR ((" ++ expr ++ ") GLOB '[1-9]*' AND (" ++ expr ++ ") NOT GLOB '*[^0-9]*'))"

def runtime_epoch_value(+epoch: String) -> String:
  C.q(epoch)

def schema() -> String:
  "CREATE TABLE IF NOT EXISTS semantic_queries (id TEXT PRIMARY KEY NOT NULL,owner TEXT NOT NULL REFERENCES sessions(id),request_json TEXT NOT NULL,admission_decision TEXT NOT NULL CHECK(admission_decision IN ('accepted','rejected')),prepared_keeper_path TEXT,cwd TEXT NOT NULL,origin_attempt TEXT,state TEXT NOT NULL CHECK(state IN ('accepted','running','complete','failed','interrupted','refused')),result_json TEXT,error_json TEXT,progress_json TEXT,cleanup_intent_json TEXT,recovery_intent_json TEXT,runtime_id TEXT,artifact_path TEXT NOT NULL,CHECK(json_valid(request_json)),CHECK(result_json IS NULL OR json_valid(result_json)),CHECK(error_json IS NULL OR json_valid(error_json)),CHECK(progress_json IS NULL OR json_valid(progress_json)),CHECK(cleanup_intent_json IS NULL OR json_valid(cleanup_intent_json)),CHECK(recovery_intent_json IS NULL OR json_valid(recovery_intent_json)));"
  ++ "CREATE TABLE IF NOT EXISTS semantic_runtimes (id TEXT PRIMARY KEY NOT NULL,owner TEXT NOT NULL REFERENCES sessions(id),origin_attempt TEXT,launch_query TEXT NOT NULL UNIQUE,adapter_id TEXT NOT NULL,state TEXT NOT NULL," ++ runtime_epoch_column() ++ ",pending_query TEXT,outcome_json TEXT,CHECK(outcome_json IS NULL OR json_valid(outcome_json)));"
  ++ "CREATE TABLE IF NOT EXISTS semantic_roles (query_id TEXT NOT NULL REFERENCES semantic_queries(id),role TEXT NOT NULL CHECK(role IN ('starter','target','adapter')),incarnation TEXT NOT NULL,keeper_path TEXT NOT NULL UNIQUE,guard_anchor TEXT NOT NULL,guard_key TEXT NOT NULL,guard_identity_json TEXT NOT NULL,recovery_argv_json TEXT NOT NULL,database_binding_json TEXT NOT NULL,phase TEXT NOT NULL,observer_identity_json TEXT,observer_cursor TEXT NOT NULL,exit_evidence_json TEXT,capture_json TEXT,release_intent_json TEXT,cleanup_phase TEXT NOT NULL,PRIMARY KEY(query_id,role,incarnation),CHECK(json_valid(guard_identity_json)),CHECK(json_valid(recovery_argv_json)),CHECK(json_valid(database_binding_json)),CHECK(observer_identity_json IS NULL OR json_valid(observer_identity_json)),CHECK(exit_evidence_json IS NULL OR json_valid(exit_evidence_json)),CHECK(capture_json IS NULL OR json_valid(capture_json)),CHECK(release_intent_json IS NULL OR json_valid(release_intent_json)));"
  ++ "CREATE INDEX IF NOT EXISTS semantic_queries_owner ON semantic_queries(owner);"
  ++ "CREATE INDEX IF NOT EXISTS semantic_roles_keeper ON semantic_roles(guard_key);"

# The runtime epoch is a canonical unsigned decimal counter of arbitrary length; it
# is stored and inserted as text so no SQLite numeric conversion can coerce it.
def json_or_null(+value: String) -> String:
  Bool.pick(String, String.is_empty(value), "NULL", "json(" ++ C.q(value) ++ ")")

def text_or_null(+value: String) -> String:
  Bool.pick(String, String.is_empty(value), "NULL", C.q(value))

# The repeated-ID rule of the store: the same ID, owner and canonical request text
# replay the stored row; any other reuse aborts the transaction through the NOT NULL
# primary key instead of replacing a committed decision.
def replay_guard() -> String:
  " ON CONFLICT(id) DO UPDATE SET id=CASE WHEN semantic_queries.owner=excluded.owner AND semantic_queries.request_json=excluded.request_json THEN semantic_queries.id ELSE NULL END;"

# The closed answer envelope of one retained query. A missing ID returns no row.
def envelope_sql(+id: String) -> String:
  "SELECT json_object('version',1,'query',id,'owner',owner,'state',state,'result',CASE WHEN result_json IS NULL THEN NULL ELSE json(result_json) END,'error',CASE WHEN error_json IS NULL THEN NULL ELSE json(error_json) END,'progress',CASE WHEN progress_json IS NULL THEN NULL ELSE json(progress_json) END) FROM semantic_queries WHERE id=" ++ C.q(id) ++ ";"

# One committed admission decision. The row is created before any provider effect;
# `state` is `accepted` and the observers advance it through the guarded publish
# below. A prepared keeper path is recorded but proves no launch.
def accept_sql(+id: String, +owner: String, +requestJson: String, +cwd: String, +originAttempt: String, +keeperPath: String, +artifactPath: String) -> String:
  "INSERT INTO semantic_queries(id,owner,request_json,admission_decision,prepared_keeper_path,cwd,origin_attempt,state,artifact_path) VALUES("
  ++ C.q(id) ++ "," ++ C.q(owner) ++ "," ++ C.q(requestJson) ++ ",'accepted'," ++ text_or_null(keeperPath) ++ "," ++ C.q(cwd) ++ "," ++ text_or_null(originAttempt) ++ ",'accepted'," ++ C.q(artifactPath) ++ ")"
  ++ replay_guard() ++ envelope_sql(id)

# The retained rejection: state refused, its own error object, cleanup pending and
# the owed owner notice, committed in one transaction. A later cleanup change
# preserves the notice by identity.
# The notice insert of the observer path additionally requires the retained query
# row, so a commit for a missing query inserts no notice at all.
def owner_notice_bound_sql(+id: String, +owner: String, +body: String, +query: String) -> String:
  Bool.pick(String, String.is_empty(id), "",
    "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id) ++ ",s.id,s.id,'report'," ++ C.q(body) ++ " FROM sessions s WHERE s.id=" ++ C.q(owner) ++ " AND EXISTS(SELECT 1 FROM semantic_queries WHERE id=" ++ C.q(query) ++ ")" ++ C.message_upsert())

def owner_notice_sql(+id: String, +owner: String, +body: String) -> String:
  Bool.pick(String, String.is_empty(id), "",
    "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id) ++ ",s.id,s.id,'report'," ++ C.q(body) ++ " FROM sessions s WHERE s.id=" ++ C.q(owner) ++ C.message_upsert())

# The first committed terminal computation state is immutable. An identical replay
# keeps it; a different late terminal write assigns NULL to the NOT NULL state
# column and aborts the whole transaction, so no second set of facts is published.
def reject_sql(+id: String, +owner: String, +requestJson: String, +cwd: String, +originAttempt: String, +keeperPath: String, +artifactPath: String, +errorJson: String, +progressJson: String, +noticeId: String, +noticeBody: String) -> String:
  "INSERT INTO semantic_queries(id,owner,request_json,admission_decision,prepared_keeper_path,cwd,origin_attempt,state,error_json,progress_json,artifact_path) VALUES("
  ++ C.q(id) ++ "," ++ C.q(owner) ++ "," ++ C.q(requestJson) ++ ",'rejected'," ++ text_or_null(keeperPath) ++ "," ++ C.q(cwd) ++ "," ++ text_or_null(originAttempt) ++ ",'refused'," ++ json_or_null(errorJson) ++ "," ++ json_or_null(progressJson) ++ "," ++ C.q(artifactPath) ++ ")"
  ++ replay_guard()
  ++ owner_notice_sql(noticeId, owner, noticeBody)
  ++ envelope_sql(id)

# The owed owner notice is an ordinary message from the owner to itself, in the
# shape the recovery input already uses. Delivery routes it to the owner, or to the
# recorded parent when the owner is stopped.
def terminal_recorded() -> String:
  "state IN ('complete','failed','interrupted','refused')"

# Managed progress and its owed notice commit together. The notice keeps its
# original body by identity when the same event is replayed.
def state_publish_sql(+id: String, +next: String, +resultJson: String, +errorJson: String) -> String:
  "BEGIN IMMEDIATE;" ++ schema()
  ++ "UPDATE semantic_queries SET state=CASE WHEN " ++ terminal_recorded() ++ " THEN CASE WHEN state=" ++ C.q(next) ++ " THEN state ELSE NULL END ELSE " ++ C.q(next) ++ " END,"
  ++ "result_json=CASE WHEN " ++ terminal_recorded() ++ " THEN result_json ELSE " ++ json_or_null(resultJson) ++ " END,"
  ++ "error_json=CASE WHEN " ++ terminal_recorded() ++ " THEN error_json ELSE " ++ json_or_null(errorJson) ++ " END "
  ++ "WHERE id=" ++ C.q(id) ++ ";" ++ envelope_sql(id) ++ "COMMIT;"

def progress_body_sql(+id: String, +owner: String, +progressJson: String, +noticeId: String, +noticeBody: String) -> String:
  "UPDATE semantic_queries SET progress_json=" ++ json_or_null(progressJson) ++ " WHERE id=" ++ C.q(id) ++ ";"
  ++ owner_notice_sql(noticeId, owner, noticeBody)

# One runtime row. The launch query is unique, so two runtimes cannot claim one
# launch; the epoch is stored and returned as the admitted canonical decimal text,
# so no finite numeric conversion can lose its identity.
def progress_publish_sql(+id: String, +owner: String, +progressJson: String, +noticeId: String, +noticeBody: String) -> String:
  "BEGIN IMMEDIATE;" ++ schema() ++ progress_body_sql(id, owner, progressJson, noticeId, noticeBody) ++ envelope_sql(id) ++ "COMMIT;"

# The progress and notice statements without a transaction boundary, so a role
# event commit can place them inside its own transaction.
def progress_guarded_sql(+admitted: String, +id: String, +owner: String, +progressJson: String, +noticeId: String, +noticeBody: String) -> String:
  "UPDATE semantic_queries SET progress_json=CASE WHEN coalesce(progress_json,'')=" ++ C.q(progressJson) ++ " OR " ++ admitted ++ " THEN " ++ json_or_null(progressJson) ++ " ELSE NULL END WHERE id=" ++ C.q(id) ++ ";"
  ++ owner_notice_sql(noticeId, owner, noticeBody)

def runtime_row_sql(+id: String, +owner: String, +originAttempt: String, +launchQuery: String, +adapterId: String, +state: String, +epoch: String) -> String:
  "SELECT json_object('error','runtime-epoch-refused','condition','A runtime epoch is a canonical unsigned decimal counter: 0, or a nonzero digit followed by digits.','next','Read the adapter epoch as its exact decimal text; never convert it to a finite number.') WHERE NOT " ++ runtime_epoch_sql_ok(C.q(epoch)) ++ ";"
  ++ "INSERT INTO semantic_runtimes(id,owner,origin_attempt,launch_query,adapter_id,state,epoch) VALUES("
  ++ C.q(id) ++ "," ++ C.q(owner) ++ "," ++ text_or_null(originAttempt) ++ "," ++ C.q(launchQuery) ++ "," ++ C.q(adapterId) ++ "," ++ C.q(state) ++ "," ++ runtime_epoch_value(epoch)
  ++ ") ON CONFLICT(id) DO UPDATE SET id=CASE WHEN semantic_runtimes.launch_query=excluded.launch_query AND semantic_runtimes.adapter_id=excluded.adapter_id THEN semantic_runtimes.id ELSE NULL END;"
  ++ "SELECT json_object('id',id,'owner',owner,'launchQuery',launch_query,'adapterId',adapter_id,'state',state,'epoch',epoch,'pendingQuery',pending_query,'outcome',CASE WHEN outcome_json IS NULL THEN NULL ELSE json(outcome_json) END) FROM semantic_runtimes WHERE id=" ++ C.q(id) ++ ";"
