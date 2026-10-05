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
import ../git/text.bend as Tx
import ./request.bend as Request
import ../host/sqlite.bend as DB

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
def ref_entries(query: String) -> String:
  "(SELECT result_json FROM semantic_queries WHERE id=" ++ C.q(query) ++ ")"

def ref_id_match(+refId: String) -> String:
  "entry.type='object' AND json_extract(entry.value,'$.id')=" ++ C.q(refId)

# The retained per-ref association of one stored result: the referenced query's
# stored refs are scanned by exact ref identity, and the entry's engine, subject,
# snapshotId and projections come back with a presence marker. Nothing here supplies
# the operation names the selector was originally admitted under, because no retained
# column records them; a re-derivation is Core's current check, not retained evidence,
# and absent evidence refuses.
# The retained per-ref association of one stored result, as one row of six
# tab-separated columns: the requested query and ref identity, the query's recorded
# state (empty when the query is absent), the count of entries whose id matches
# exactly, the matching entry's stored text, and whether that entry carries every
# field a selector association needs. The count is read rather than assumed, so a
# duplicate id is visible instead of silently one of several.
def ref_fields_ok(query: String, refId: String) -> String:
  "(SELECT CASE WHEN json_type(value,'$.engine') IS NOT NULL AND json_type(value,'$.subject') IS NOT NULL AND json_type(value,'$.snapshotId') IS NOT NULL AND json_type(value,'$.projections') IS NOT NULL THEN 1 ELSE 0 END FROM json_each(" ++ ref_entries(query) ++ ",'$.refs') WHERE " ++ ref_id_match(refId) ++ ")"

# One retained association. `RefOpen` means the referenced query's result is not
# retained yet, `RefAbsent` and `RefAmbiguous` are read from the match count, and
# `RefMalformed` means the single matching entry lacks a member. No constructor
# carries operation names, because no retained column holds them.
def ref_state(query: String) -> String:
  "coalesce((SELECT state FROM semantic_queries WHERE id=" ++ C.q(query) ++ "),'')"

# The result column of a query that has one, or the marker that it is not retained.
# Whether the query's retained result exists, as its own fact, so a failed or
# refused query keeps its authoritative state even when no result was retained.
def ref_result_present(query: String) -> String:
  "CASE WHEN NOT EXISTS(SELECT 1 FROM semantic_queries WHERE id=" ++ C.q(query) ++ ") THEN 'absent' WHEN (SELECT result_json FROM semantic_queries WHERE id=" ++ C.q(query) ++ ") IS NULL THEN 'null' ELSE 'present' END"

# The refs container must be an array before anything is counted: a completed result
# whose refs member is absent, null or another type is a container failure, not an
# empty set.
def ref_container_kind(query: String) -> String:
  "coalesce(json_type(coalesce((SELECT result_json FROM semantic_queries WHERE id=" ++ C.q(query) ++ "),'null'),'$.refs'),'absent')"

def ref_match_count(query: String, refId: String) -> String:
  "(SELECT count(*) FROM json_each(coalesce((SELECT result_json FROM semantic_queries WHERE id=" ++ C.q(query) ++ "),'null'),'$.refs') AS entry WHERE " ++ ref_id_match(refId) ++ ")"

# Every traversal is guarded: the refs member must be an array and each candidate
# entry an object before any nested JSON function reads it, so a scalar or null
# element is never fed into json_each or json_type as text.
def ref_guarded(query: String, inner: String) -> String:
  "CASE WHEN " ++ ref_container_kind(query) ++ "='array' THEN (" ++ inner ++ ") ELSE '' END"

def ref_first_entry(query: String, refId: String) -> String:
  ref_guarded(query, "SELECT entry.value FROM json_each(coalesce((SELECT result_json FROM semantic_queries WHERE id=" ++ C.q(query) ++ "),'null'),'$.refs') AS entry WHERE json_type(entry.value)='object' AND " ++ ref_id_match(refId))

# One member of the entry occurs exactly once and carries the required JSON type; the
# identity members are additionally nonempty. A JSON null, number, object, wrong
# array element or a duplicated key fails the test.
def ref_member_once(member: String, kind: String) -> String:
  "(SELECT count(*) FROM json_each(entry.value) AS member WHERE member.key=" ++ C.q(member) ++ ")=1 AND json_type(entry.value,'$." ++ member ++ "')=" ++ C.q(kind)

def ref_identity_nonempty(member: String) -> String:
  "coalesce(json_extract(entry.value,'$." ++ member ++ "'),'')<>''"

# The stored selector is the producer's structured object, so the subject member must
# be an object with a nonempty kind; the projection list must be an array of strings.
# The complete kind vocabulary belongs to the producer contract, so this checks the
# shape it can establish here and reports anything else as malformed.
def ref_shape_ok(query: String, refId: String) -> String:
  "CASE WHEN " ++ ref_container_kind(query) ++ "='array' THEN (SELECT CASE WHEN " ++ ref_member_once("engine", "text") ++ " AND " ++ ref_identity_nonempty("engine") ++ " AND " ++ ref_member_once("subject", "object") ++ " AND json_type(entry.value,'$.subject.kind')='text' AND json_extract(entry.value,'$.subject.kind')<>'' AND " ++ ref_member_once("snapshotId", "text") ++ " AND " ++ ref_identity_nonempty("snapshotId") ++ " AND " ++ ref_member_once("projections", "array") ++ " AND json_array_length(entry.value,'$.projections')>0 AND NOT EXISTS(SELECT 1 FROM json_each(entry.value,'$.projections') AS projection WHERE projection.type<>'text' OR projection.value='') THEN 1 ELSE 0 END FROM json_each(coalesce((SELECT result_json FROM semantic_queries WHERE id=" ++ C.q(query) ++ "),'null'),'$.refs') AS entry WHERE json_type(entry.value)='object' AND " ++ ref_id_match(refId) ++ ") ELSE '' END"

# One row of five columns, none of which echoes a caller string: the recorded state of
# the requested query, whether its result is retained, the count of entries whose id
# matches exactly, the matching entry's stored text, and whether that entry has the
# exact selector shape. The requested identity is supplied to the decoder instead of
# travelling through the tab-separated row.
def ref_count_column(query: String, refId: String) -> String:
  "CASE WHEN " ++ ref_container_kind(query) ++ "='array' THEN " ++ ref_match_count(query, refId) ++ " ELSE 'container' END"

def ref_lookup_sql(+query: String, +refId: String) -> String:
  "SELECT " ++ ref_state(query) ++ "," ++ ref_result_present(query) ++ "," ++ ref_count_column(query, refId) ++ ",coalesce(hex(" ++ ref_first_entry(query, refId) ++ "),''),coalesce(" ++ ref_shape_ok(query, refId) ++ ",0);"

type RefLookup is Data:
  RefUnreadable{stage: String, answer: String}
  RefQueryMissing{query: String, refId: String}
  RefUnretained{query: String, refId: String}
  RefOpen{query: String, refId: String, state: String}
  RefFailed{query: String, refId: String, state: String}
  RefAbsent{query: String, refId: String}
  RefAmbiguous{query: String, refId: String, count: String}
  RefMalformed{query: String, refId: String, entry: String}
  RefFound{query: String, refId: String, state: String, entry: String}

def ref_count_ok(count: String) -> Bool:
  runtime_epoch_ok(count)

# The entry column is hex of the stored bytes: the codec's hex framing check and
# scalar decoder convert it exactly once, and any other shape keeps its raw answer.
def ref_entry_scalar(hexText: String) -> Request.Scalar:
  Bool.pick(Request.Scalar, Request.hex_ok(hexText), Request.Context.decode_scalar_utf8(Tx.hex_decode(hexText)), Request.ScalarBadUtf8{})
def ref_flag_ok(flag: String) -> Bool:
  Bool.or(String.eq(flag, "0"), String.eq(flag, "1"))

def ref_open_state(state: String) -> Bool:
  Bool.or(Bool.or(String.eq(state, "accepted"), String.eq(state, "running")), String.eq(state, "cleaning"))

def ref_failed_state(state: String) -> Bool:
  Bool.or(Bool.or(String.eq(state, "failed"), String.eq(state, "interrupted")), String.eq(state, "refused"))

# The state decides first: an unfinished or unretained query is never reported as an
# absent ref, and only a completed result whose retained refs array has no matching
# entry is absent.
def ref_scalar_answer(+query: String, +refId: String, +state: String, +answer: String, +scalar: Request.Scalar) -> RefLookup:
  match scalar:
    case Request.ScalarText{value}: RefFound{query, refId, state, value}
    case Request.ScalarBadUtf8{}: RefUnreadable{"scalar", answer}
    case Request.ScalarSurrogate{}: RefUnreadable{"scalar", answer}
    case Request.ScalarNul{}: RefUnreadable{"scalar", answer}

def ref_entry_answer(+query: String, +refId: String, +state: String, +hexEntry: String, +answer: String) -> RefLookup:
  Bool.pick(RefLookup, Request.hex_ok(hexEntry), ref_scalar_answer(query, refId, state, answer, ref_entry_scalar(hexEntry)), RefUnreadable{"framing", answer})

def ref_decide(+query: String, +refId: String, +state: String, +result: String, +count: String, +hexEntry: String, +shape: String, +answer: String) -> RefLookup:
  Bool.pick(RefLookup, String.is_empty(state), RefQueryMissing{query, refId},
  Bool.pick(RefLookup, ref_failed_state(state), RefFailed{query, refId, state},
  Bool.pick(RefLookup, ref_open_state(state), RefOpen{query, refId, state},
  Bool.pick(RefLookup, Bool.not(String.eq(state, "complete")), RefUnreadable{"state", answer},
  Bool.pick(RefLookup, String.eq(result, "null"), RefUnretained{query, refId},
  Bool.pick(RefLookup, Bool.not(String.eq(result, "present")), RefUnreadable{"result", answer},
  Bool.pick(RefLookup, Bool.not(ref_count_ok(count)), RefUnreadable{"count", answer},
  Bool.pick(RefLookup, Bool.not(ref_flag_ok(shape)), RefUnreadable{"shape", answer},
  Bool.pick(RefLookup, String.eq(count, "0"), RefAbsent{query, refId},
  Bool.pick(RefLookup, Bool.not(String.eq(count, "1")), RefAmbiguous{query, refId, count},
  Bool.pick(RefLookup, Bool.not(String.eq(shape, "1")), RefMalformed{query, refId, "shape"},
    ref_entry_answer(query, refId, state, hexEntry, answer)))))))))))

# Only a qualified found branch reaches here, so the scalar is decoded once and its
# failure keeps the whole raw answer with the stage that failed.
def ref_lookup_tabs(+query: String, +refId: String, +fields: List<String>, +answer: String) -> RefLookup:
  match fields:
    case +state <> more0:
      match more0:
        case +result <> more1:
          match more1:
            case +count <> more2:
              match more2:
                case +entry <> more3:
                  match more3:
                    case +shape <> more4:
                      match more4:
                        case Nil{}: ref_decide(query, refId, state, result, count, entry, shape, answer)
                        case _: RefUnreadable{"surplus", answer}
                    case _: RefUnreadable{"short", answer}
                case _: RefUnreadable{"short", answer}
            case _: RefUnreadable{"short", answer}
        case _: RefUnreadable{"short", answer}
    case _: RefUnreadable{"short", answer}

# Exactly one row of five columns, decoded against the identity the caller requested.
def ref_lookup_decode(+query: String, +refId: String, +row: String) -> RefLookup:
  match Tx.split_lines(row):
    case Nil{}: RefUnreadable{"empty", row}
    case +line <> +rest:
      match rest:
        case Nil{}: ref_lookup_tabs(query, refId, Tx.split_tabs(line), row)
        case _: RefUnreadable{"surplus", row}

def ref_after(+query: String, +refId: String, result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,RefLookup>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,RefLookup>, Fail{error})
    case Done{+rows}: IO.pure(Result<&1,&1,U32 & String,RefLookup>, Done{ref_lookup_decode(query, refId, rows)})

# The bound lookup. A host or binding failure stays a failure rather than a lookup
# answer, so an unavailable binding can never read as an absent ref.
def ref_lookup(+db: String, +binding: String, +query: String, +refId: String) -> IO(Result<&1,&1,U32 & String,RefLookup>):
  do IO<Result<&1,&1,U32 & String,RefLookup>>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ref_lookup_sql(query, refId))
    ref_after(query, refId, result)

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
  ++ "INSERT INTO semantic_runtimes(id,owner,origin_attempt,launch_query,adapter_id,state,epoch) SELECT "
  ++ C.q(id) ++ "," ++ C.q(owner) ++ "," ++ text_or_null(originAttempt) ++ "," ++ C.q(launchQuery) ++ "," ++ C.q(adapterId) ++ "," ++ C.q(state) ++ "," ++ runtime_epoch_value(epoch)
  ++ " WHERE " ++ runtime_epoch_sql_ok(C.q(epoch))
  ++ " ON CONFLICT(id) DO UPDATE SET id=CASE WHEN semantic_runtimes.launch_query=excluded.launch_query AND semantic_runtimes.adapter_id=excluded.adapter_id THEN semantic_runtimes.id ELSE NULL END;"
  ++ "SELECT json_object('id',id,'owner',owner,'launchQuery',launch_query,'adapterId',adapter_id,'state',state,'epoch',epoch,'pendingQuery',pending_query,'outcome',CASE WHEN outcome_json IS NULL THEN NULL ELSE json(outcome_json) END) FROM semantic_runtimes WHERE id=" ++ C.q(id) ++ " AND " ++ runtime_epoch_sql_ok(C.q(epoch)) ++ ";"
