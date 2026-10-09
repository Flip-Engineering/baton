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

# The retained admission association lives in its own keyed relation. A database created
# before any association existed gains it from the same create-if-missing schema text,
# which is the only way an existing table can gain it: a column cannot be added to a table
# that is already there. The plan rendering is stored as JSON text and is checked, so a
# malformed rendering cannot be committed.
def association_schema() -> String:
  "CREATE TABLE IF NOT EXISTS semantic_admissions (query_id TEXT PRIMARY KEY NOT NULL REFERENCES semantic_queries(id),plan_value TEXT NOT NULL,plan_identity TEXT NOT NULL,result_schema TEXT NOT NULL,origin_attempt TEXT,CHECK(json_valid(plan_value)));"

# The resolved answers the admission resolved, in their own additive relation. A database
# whose association table already exists cannot gain a column by create-if-missing, so this
# value lives in a second relation created the same way and appears only through this schema
# text: a row admitted before the answers existed has no row here, which reads as absent and
# is never backfilled. The answers are a JSON document, so an empty column means absent
# rather than a recorded empty answer set.
def answers_schema() -> String:
  "CREATE TABLE IF NOT EXISTS semantic_admission_answers (query_id TEXT PRIMARY KEY NOT NULL REFERENCES semantic_queries(id),answers_text TEXT NOT NULL,CHECK(json_valid(answers_text)));"

def answers_present(id: String) -> String:
  "EXISTS(SELECT 1 FROM semantic_admission_answers WHERE query_id=" ++ C.q(id) ++ ")"

# Guarded like the association insert: `changes()` refers to the insert immediately before
# it, which inserted one row in the transaction that created the query row and zero rows on
# a replay, so the answers are written only by the run that created the row.
def answers_insert_sql(+id: String, +answersText: String) -> String:
  "INSERT INTO semantic_admission_answers(query_id,answers_text) SELECT " ++ C.q(id) ++ "," ++ C.q(answersText) ++ " WHERE changes()=1 AND NOT EXISTS(SELECT 1 FROM semantic_admission_answers WHERE query_id=" ++ C.q(id) ++ ");"

def association_present(id: String) -> String:
  "EXISTS(SELECT 1 FROM semantic_admissions WHERE query_id=" ++ C.q(id) ++ ")"

# The stored association as five columns: a marker, then the complete rendering, the
# identity over the deciding members, the result schema and the resolved answers, each as
# hex, because a
# rendering is arbitrary JSON text and a tab or a newline inside it would otherwise split
# the tab-separated answer row. A row with no association answers the absent marker with
# four empty values, and a row whose association predates the answers column carries an
# empty answers value rather than a recorded one.
def association_row_sql(+id: String) -> String:
  "SELECT CASE WHEN " ++ association_present(id) ++ " THEN 'present' ELSE 'absent' END," ++ "coalesce((SELECT hex(plan_value) FROM semantic_admissions WHERE query_id=" ++ C.q(id) ++ "),'')," ++ "coalesce((SELECT hex(plan_identity) FROM semantic_admissions WHERE query_id=" ++ C.q(id) ++ "),'')," ++ "coalesce((SELECT hex(result_schema) FROM semantic_admissions WHERE query_id=" ++ C.q(id) ++ "),'')," ++ "coalesce((SELECT hex(answers_text) FROM semantic_admission_answers WHERE query_id=" ++ C.q(id) ++ "),'');"

def schema() -> String:
  "CREATE TABLE IF NOT EXISTS semantic_queries (id TEXT PRIMARY KEY NOT NULL,owner TEXT NOT NULL REFERENCES sessions(id),request_json TEXT NOT NULL,admission_decision TEXT NOT NULL CHECK(admission_decision IN ('accepted','rejected')),prepared_keeper_path TEXT,cwd TEXT NOT NULL,origin_attempt TEXT,state TEXT NOT NULL CHECK(state IN ('accepted','running','complete','failed','interrupted','refused')),result_json TEXT,error_json TEXT,progress_json TEXT,cleanup_intent_json TEXT,recovery_intent_json TEXT,runtime_id TEXT,artifact_path TEXT NOT NULL,CHECK(json_valid(request_json)),CHECK(result_json IS NULL OR json_valid(result_json)),CHECK(error_json IS NULL OR json_valid(error_json)),CHECK(progress_json IS NULL OR json_valid(progress_json)),CHECK(cleanup_intent_json IS NULL OR json_valid(cleanup_intent_json)),CHECK(recovery_intent_json IS NULL OR json_valid(recovery_intent_json)));"
  ++ "CREATE TABLE IF NOT EXISTS semantic_runtimes (id TEXT PRIMARY KEY NOT NULL,owner TEXT NOT NULL REFERENCES sessions(id),origin_attempt TEXT,launch_query TEXT NOT NULL UNIQUE,adapter_id TEXT NOT NULL,state TEXT NOT NULL," ++ runtime_epoch_column() ++ ",pending_query TEXT,outcome_json TEXT,CHECK(outcome_json IS NULL OR json_valid(outcome_json)));"
  ++ "CREATE TABLE IF NOT EXISTS semantic_roles (query_id TEXT NOT NULL REFERENCES semantic_queries(id),role TEXT NOT NULL CHECK(role IN ('starter','target','adapter')),incarnation TEXT NOT NULL,keeper_path TEXT NOT NULL UNIQUE,guard_anchor TEXT NOT NULL,guard_key TEXT NOT NULL,guard_identity_json TEXT NOT NULL,recovery_argv_json TEXT NOT NULL,database_binding_json TEXT NOT NULL,phase TEXT NOT NULL,observer_identity_json TEXT,observer_cursor TEXT NOT NULL,exit_evidence_json TEXT,capture_json TEXT,release_intent_json TEXT,cleanup_phase TEXT NOT NULL,PRIMARY KEY(query_id,role,incarnation),CHECK(json_valid(guard_identity_json)),CHECK(json_valid(recovery_argv_json)),CHECK(json_valid(database_binding_json)),CHECK(observer_identity_json IS NULL OR json_valid(observer_identity_json)),CHECK(exit_evidence_json IS NULL OR json_valid(exit_evidence_json)),CHECK(capture_json IS NULL OR json_valid(capture_json)),CHECK(release_intent_json IS NULL OR json_valid(release_intent_json)));"
  ++ "CREATE INDEX IF NOT EXISTS semantic_queries_owner ON semantic_queries(owner);"
  ++ "CREATE INDEX IF NOT EXISTS semantic_roles_keeper ON semantic_roles(guard_key);" ++ association_schema() ++ answers_schema()

# The runtime epoch is a canonical unsigned decimal counter of arbitrary length; it
# is stored and inserted as text so no SQLite numeric conversion can coerce it.
def ref_result(query: String) -> String:
  "coalesce((SELECT result_json FROM semantic_queries WHERE id=" ++ C.q(query) ++ "),'null')"

# The retained per-ref association of one stored result is scanned by exact ref identity
# inside the query's stored refs. Nothing here supplies the operation names the selector
# was originally admitted under, because no retained column records them; absent
# provenance refuses.

# The refs container is the result object's single `refs` member, and it must be an
# array. A result that is not an object, repeats the member or carries another type
# there fails the container test, and that failure is reported as unreadable rather than
# as an empty set.
def ref_container_ok(query: String) -> String:
  "(json_type(" ++ ref_result(query) ++ ")='object' AND (SELECT count(*) FROM json_each(" ++ ref_result(query) ++ ") AS member WHERE member.key='refs')=1 AND json_type(" ++ ref_result(query) ++ ",'$.refs')='array')"

# The exact identity match of one entry. The element's own json_each type fact decides
# whether the element may be read as an object, so a text element is never reparsed as
# JSON and can never match.
def ref_id_match(+refId: String) -> String:
  "(CASE WHEN entry.type='object' THEN json_extract(entry.value,'$.id') ELSE NULL END)=" ++ C.q(refId)

# One member of an object occurs exactly once and carries the required JSON type.
def ref_member_once(alias: String, member: String, kind: String) -> String:
  "(SELECT count(*) FROM json_each(" ++ alias ++ ") AS member WHERE member.key=" ++ C.q(member) ++ ")=1 AND json_type(" ++ alias ++ ",'$." ++ member ++ "')=" ++ C.q(kind)

# The same check for one member of a named nested object, reached by its path.
def ref_nested_once(alias: String, path: String, member: String, kind: String) -> String:
  "(SELECT count(*) FROM json_each(" ++ alias ++ ",'$." ++ path ++ "') AS member WHERE member.key=" ++ C.q(member) ++ ")=1 AND json_type(" ++ alias ++ ",'$." ++ path ++ "." ++ member ++ "')=" ++ C.q(kind)

def ref_text_nonempty(alias: String, path: String) -> String:
  "coalesce(json_extract(" ++ alias ++ ",'$." ++ path ++ "'),'')<>''"

# Every declared entry check as one 1/0 expression over an entry already established to be
# an object: the five declared names occur once each with their types, the identity
# members are nonempty, the subject is an object with a single nonempty text kind, and the
# projections are a nonempty array of nonempty strings. The kind vocabulary beyond that
# belongs to the producer contract, so nothing per-kind is invented here.
def ref_entry_shape(alias: String) -> String:
  "(CASE WHEN " ++ ref_member_once(alias, "id", "text") ++ " AND " ++ ref_text_nonempty(alias, "id") ++ " AND " ++ ref_member_once(alias, "engine", "text") ++ " AND " ++ ref_text_nonempty(alias, "engine") ++ " AND " ++ ref_member_once(alias, "snapshotId", "text") ++ " AND " ++ ref_text_nonempty(alias, "snapshotId") ++ " AND " ++ ref_member_once(alias, "subject", "object") ++ " AND " ++ ref_member_once(alias, "projections", "array") ++ " AND (CASE WHEN json_type(" ++ alias ++ ",'$.subject')='object' THEN (CASE WHEN " ++ ref_nested_once(alias, "subject", "kind", "text") ++ " AND " ++ ref_text_nonempty(alias, "subject.kind") ++ " THEN 1 ELSE 0 END) ELSE 0 END)=1 AND (CASE WHEN json_type(" ++ alias ++ ",'$.projections')='array' THEN (CASE WHEN json_array_length(" ++ alias ++ ",'$.projections')>0 AND NOT EXISTS(SELECT 1 FROM json_each(" ++ alias ++ ",'$.projections') AS projection WHERE projection.type<>'text' OR projection.value='') THEN 1 ELSE 0 END) ELSE 0 END)=1 AND NOT EXISTS(SELECT 1 FROM json_each(" ++ alias ++ ") AS declared WHERE declared.key NOT IN ('id','engine','subject','snapshotId','projections')) THEN 1 ELSE 0 END)"

# The element type fact gates the object parse: the entry text reaches a JSON parser only
# in the branch where json_each already reported an object, so a scalar or text element is
# never parsed as JSON.
def ref_entry_gate(kind: String, alias: String) -> String:
  "(CASE WHEN " ++ kind ++ "='object' THEN " ++ ref_entry_shape(alias) ++ " ELSE 0 END)"

# Every entry of the refs array must be an intact object before any absence decision, so a
# completed result whose element is a number, a string, null or an incomplete object is
# unreadable instead of an empty set. Absence is a zero match count over an intact array,
# whether that array is empty or holds intact entries with other identities.
def ref_all_intact(query: String) -> String:
  "NOT EXISTS(SELECT 1 FROM json_each(" ++ ref_result(query) ++ ",'$.refs') AS entry WHERE " ++ ref_entry_gate("entry.type", "entry.value") ++ "=0)"

# One retained association. `RefOpen` means the referenced query's result is not retained
# yet; `RefAbsent` and `RefAmbiguous` come from the match count over an intact array; and
# `RefUnreadable` covers a container, entry, state, result, count or shape failure. No
# constructor carries operation names, because no retained column holds them.
def ref_state(query: String) -> String:
  "coalesce((SELECT state FROM semantic_queries WHERE id=" ++ C.q(query) ++ "),'')"

# Whether the query's retained result exists, as its own fact, so a failed or refused query
# keeps its authoritative state even when no result was retained.
def ref_result_present(query: String) -> String:
  "CASE WHEN NOT EXISTS(SELECT 1 FROM semantic_queries WHERE id=" ++ C.q(query) ++ ") THEN 'absent' WHEN (SELECT result_json FROM semantic_queries WHERE id=" ++ C.q(query) ++ ") IS NULL THEN 'null' ELSE 'present' END"

def ref_match_count(query: String, refId: String) -> String:
  "(SELECT count(*) FROM json_each(" ++ ref_result(query) ++ ",'$.refs') AS entry WHERE " ++ ref_id_match(refId) ++ ")"

def ref_first_entry(query: String, refId: String) -> String:
  "(SELECT entry.value FROM json_each(" ++ ref_result(query) ++ ",'$.refs') AS entry WHERE " ++ ref_id_match(refId) ++ ")"

def ref_shape_ok(query: String, refId: String) -> String:
  "(SELECT " ++ ref_entry_gate("entry.type", "entry.value") ++ " FROM json_each(" ++ ref_result(query) ++ ",'$.refs') AS entry WHERE " ++ ref_id_match(refId) ++ ")"

# One row of five columns, none of which echoes a caller string: the recorded state of the
# requested query, whether its result is retained, the match count or the marker for a
# container or entry integrity failure, the matching entry's stored text as hex, and
# whether that entry has the exact declared shape. The requested identity is supplied to
# the decoder instead of travelling through the tab-separated row.
def ref_count_column(query: String, refId: String) -> String:
  "CASE WHEN NOT (" ++ ref_container_ok(query) ++ ") THEN 'container' WHEN NOT (" ++ ref_all_intact(query) ++ ") THEN 'entry' ELSE " ++ ref_match_count(query, refId) ++ " END"

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
    case Request.ScalarText{+value}: RefFound{query, refId, state, value}
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
  Bool.pick(RefLookup, String.eq(count, "container"), RefUnreadable{"container", answer},
  Bool.pick(RefLookup, String.eq(count, "entry"), RefUnreadable{"entry", answer},
  Bool.pick(RefLookup, Bool.not(ref_count_ok(count)), RefUnreadable{"count", answer},
  Bool.pick(RefLookup, Bool.not(ref_flag_ok(shape)), RefUnreadable{"shape", answer},
  Bool.pick(RefLookup, String.eq(count, "0"), RefAbsent{query, refId},
  Bool.pick(RefLookup, Bool.not(String.eq(count, "1")), RefAmbiguous{query, refId, count},
  Bool.pick(RefLookup, Bool.not(String.eq(shape, "1")), RefUnreadable{"shape", answer},
    ref_entry_answer(query, refId, state, hexEntry, answer))))))))))))))

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

# The association insert is guarded by `changes()`, which still refers to the insert of
# the query row because that insert is the statement immediately before it. So it runs
# only in the transaction that created that row, and a replay writes nothing: a caller
# that replays an old row cannot attach its own plan to a row admitted without one. The
# complete rendering and the identity over the deciding members are both stored: the
# rendering is the carrier, and the identity is what a replay compares without parsing.
def association_insert_sql(+id: String, +planValue: String, +planIdentity: String, +resultSchema: String, +originAttempt: String) -> String:
  "INSERT INTO semantic_admissions(query_id,plan_value,plan_identity,result_schema,origin_attempt) SELECT " ++ C.q(id) ++ "," ++ C.q(planValue) ++ "," ++ C.q(planIdentity) ++ "," ++ C.q(resultSchema) ++ "," ++ text_or_null(originAttempt) ++ " WHERE changes()=1 AND NOT EXISTS(SELECT 1 FROM semantic_admissions WHERE query_id=" ++ C.q(id) ++ ");"

# The repeated-ID rule of the store: the same ID, owner and canonical request text
# replay the stored row; any other reuse aborts the transaction through the NOT NULL
# primary key instead of replacing a committed decision.
def replay_guard() -> String:
  " ON CONFLICT(id) DO UPDATE SET id=CASE WHEN semantic_queries.owner=excluded.owner AND semantic_queries.request_json=excluded.request_json THEN semantic_queries.id ELSE NULL END;"

# The closed answer envelope of one retained query. A missing ID returns no row.
def envelope_body_sql(+id: String) -> String:
  "SELECT json_object('version',1,'query',id,'owner',owner,'state',state,'result',CASE WHEN result_json IS NULL THEN NULL ELSE json(result_json) END,'error',CASE WHEN error_json IS NULL THEN NULL ELSE json(error_json) END,'progress',CASE WHEN progress_json IS NULL THEN NULL ELSE json(progress_json) END) FROM semantic_queries WHERE id=" ++ C.q(id)

# The terminated envelope statement: the body plus its terminator, byte-identical for every
# existing caller and for the law that pins the publish statement text.
def envelope_sql(+id: String) -> String:
  envelope_body_sql(id) ++ ";"

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
