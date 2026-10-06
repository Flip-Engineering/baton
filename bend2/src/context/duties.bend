# CLAIM: the retained coordinator duties of the managed semantic context and their
# enumeration after a child acknowledgment. The enumeration names every unsettled
# record of the context's own tables: a query whose computation is open or whose
# progress still owes cleanup, a role whose cleanup or release intent is unsettled,
# and an owed context notice. A host acknowledgment settles the host's own child
# record; it does not remove a coordinator duty from this enumeration.
#
# Each enumerated record is one row of six tab-separated columns read by a closed
# decoder, so a short, surplus or empty row is not a duty record and a caller can
# tell an empty enumeration from an unreadable one. The enumeration is a bound read:
# a failed or unreadable answer is an error, never a settled state.
import Base
import ../coordinator/commands.bend as C
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx

# One unsettled coordinator duty. `subject` is the query or notice identity; `role`
# and `incarnation` are empty for a query-level or notice duty; `evidence` names the
# recorded signal, delivery state, cleanup phase or notice kind.
type DutyView is Data:
  DutyNone{}
  DutyRows{count: U32, text: String}
  DutyUnreadable{line: String, answer: String}

type DutyRecord is Data:
  DutyRecord{kind: String, subject: String, role: String, incarnation: String, stage: String, evidence: String}

def duty_query_open() -> String:
  "state NOT IN ('complete','failed','interrupted','refused')"

def duty_query_cleanup_open() -> String:
  "json_extract(progress_json,'$.cleanup') IN ('pending','unavailable')"

def duty_query_intent_open() -> String:
  "cleanup_intent_json IS NOT NULL OR recovery_intent_json IS NOT NULL"

def duty_role_open() -> String:
  "cleanup_phase IN ('pending','unavailable') OR release_intent_json IS NOT NULL"

# A context notice identity is the canonical array text of its fixed tag, so the
# enumeration selects the context's own owed notices and leaves ordinary
# conversation messages alone.
def duty_notice_owed() -> String:
  "m.receipt IS NULL AND substr(m.id,1,10)='[\"context-'"

def duty_query_stage() -> String:
  "CASE WHEN cleanup_intent_json IS NOT NULL THEN 'release' WHEN recovery_intent_json IS NOT NULL THEN 'recovery' WHEN " ++ duty_query_open() ++ " THEN 'computationOpen' ELSE 'cleanup' END"

def duty_query_evidence() -> String:
  "CASE WHEN cleanup_intent_json IS NOT NULL THEN coalesce(json_extract(cleanup_intent_json,'$.signal'),'') WHEN recovery_intent_json IS NOT NULL THEN coalesce(json_extract(recovery_intent_json,'$.controlQuery'),'') ELSE coalesce(json_extract(progress_json,'$.cleanup'),'') END"

def duty_role_stage() -> String:
  "CASE WHEN release_intent_json IS NOT NULL THEN 'release' ELSE 'cleanup' END"

def duty_role_evidence() -> String:
  "CASE WHEN release_intent_json IS NOT NULL THEN coalesce(json_extract(release_intent_json,'$.delivery'),'') ELSE cleanup_phase END"

# The enumeration: one row per unsettled record. The union keeps each kind's
# predicate and stage explicit.
def duties_sql() -> String:
  "SELECT 'query',q.id,'',''," ++ duty_query_stage() ++ "," ++ duty_query_evidence() ++ " FROM semantic_queries q WHERE (" ++ duty_query_open() ++ " OR " ++ duty_query_cleanup_open() ++ " OR " ++ duty_query_intent_open() ++ ") UNION ALL SELECT 'role',r.query_id,r.role,r.incarnation," ++ duty_role_stage() ++ "," ++ duty_role_evidence() ++ " FROM semantic_roles r WHERE " ++ duty_role_open() ++ " UNION ALL SELECT 'notice',m.id,'','','notice',m.kind FROM messages m WHERE " ++ duty_notice_owed() ++ ";"

def duty_split(rows: String) -> List<String>:
  Tx.split_lines(rows)

def field_count(xs: List<String>, acc: U32) -> U32:
  match xs:
    case Nil{}: acc
    case h <> t: field_count(t, U32.add(acc, 1))

def duty_kind(record: DutyRecord) -> String:
  match record:
    case DutyRecord{kind, subject, role, incarnation, stage, evidence}: kind

def duty_subject(record: DutyRecord) -> String:
  match record:
    case DutyRecord{kind, subject, role, incarnation, stage, evidence}: subject

# A record needs a nonempty kind, subject and stage; the evidence may be empty when
# the recorded row carries none.
def duty_shaped(+kind: String, +subject: String, +stage: String) -> Bool:
  Bool.and(Bool.not(String.is_empty(kind)), Bool.and(Bool.not(String.is_empty(subject)), Bool.not(String.is_empty(stage))))

def duty_known_kind(+kind: String) -> Bool:
  Bool.or(String.eq(kind, "query"), Bool.or(String.eq(kind, "role"), String.eq(kind, "notice")))

# Exactly six columns, in order.
def duty_fields(fields: List<String>) -> Maybe<&2, DutyRecord>:
  match fields:
    case +kind <> more0:
      match more0:
        case +subject <> more1:
          match more1:
            case +role <> more2:
              match more2:
                case +incarnation <> more3:
                  match more3:
                    case +stage <> more4:
                      match more4:
                        case +evidence <> more5:
                          match more5:
                            case Nil{}: Some{DutyRecord{kind, subject, role, incarnation, stage, evidence}}
                            case _: None{}
                        case _: None{}
                    case _: None{}
                case _: None{}
            case _: None{}
        case _: None{}
    case _: None{}

def duty_checked(record: DutyRecord) -> Maybe<&2, DutyRecord>:
  match record:
    case DutyRecord{kind, subject, role, incarnation, stage, evidence}:
      Bool.pick(Maybe<&2, DutyRecord>, duty_shaped(kind, subject, stage), Some{DutyRecord{kind, subject, role, incarnation, stage, evidence}}, None{})

# One duty row: a short, surplus or empty row is not a record.
def duty_line_record(parsed: Maybe<&2, DutyRecord>) -> Maybe<&2, DutyRecord>:
  match parsed:
    case None{}: None{}
    case Some{record}: duty_checked(record)

def duty_line(+line: String) -> Maybe<&2, DutyRecord>:
  duty_line_record(duty_fields(Tx.split_tabs(line)))

# Every line of the answer must be a known record; a single unreadable line makes the
# enumeration unusable rather than quietly shorter.
def duty_record_known(parsed: Maybe<&2, DutyRecord>) -> Bool:
  match parsed:
    case None{}: False{}
    case Some{record}: duty_known_kind(duty_kind(record))

def duty_record_ok(line: String) -> Bool:
  duty_record_known(duty_line(line))

def duty_wellformed_go(xs: List<String>) -> Bool:
  match xs:
    case Nil{}: True{}
    case h <> t: Bool.and(duty_record_ok(h), duty_wellformed_go(t))

def duty_wellformed(rows: String) -> Bool:
  duty_wellformed_go(duty_split(rows))

# The first line that is not a duty record; its value is read only when the
# validator below reports that some line failed, so an empty offending line cannot
# be confused with success.
def duty_bad_line(xs: List<String>) -> String:
  match xs:
    case Nil{}: ""
    case h <> t: Bool.pick(String, duty_record_ok(h), duty_bad_line(t), h)

def duty_all_valid(xs: List<String>) -> Bool:
  match xs:
    case Nil{}: True{}
    case h <> t: Bool.and(duty_record_ok(h), duty_all_valid(t))

# The exported answer. `DutyRows` exists only for a validated enumeration, and a
# malformed line can therefore surface only as `DutyUnreadable` with the whole
# answer, so no caller can read a shorter set as settled.
def duty_view(rows: String) -> DutyView:
  Bool.pick(DutyView, String.is_empty(rows), DutyNone{},
    Bool.pick(DutyView, duty_all_valid(duty_split(rows)),
      DutyRows{field_count(duty_split(rows), 0), rows},
      DutyUnreadable{duty_bad_line(duty_split(rows)), rows}))

def duty_after(result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,DutyView>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,DutyView>, Fail{error})
    case Done{+rows}: IO.pure(Result<&1,&1,U32 & String,DutyView>, Done{duty_view(rows)})

# Whether the validated enumeration contains this exact duty. It is the obligation a
# caller asserts, so no caller has to infer identity from an aggregate count.
def duty_matches_record(parsed: Maybe<&2, DutyRecord>, +kind: String, +subject: String) -> Bool:
  match parsed:
    case None{}: False{}
    case Some{record}: Bool.and(String.eq(duty_kind(record), kind), String.eq(duty_subject(record), subject))

def duty_matches(line: String, +kind: String, +subject: String) -> Bool:
  duty_matches_record(duty_line(line), kind, subject)

# A safe rendering of the exported view for a caller that only needs the disposition.
def duty_contains_rows(xs: List<String>, +kind: String, +subject: String) -> Bool:
  match xs:
    case Nil{}: False{}
    case h <> t:
      Bool.pick(Bool, duty_matches(h, kind, subject), True{}, duty_contains_rows(t, kind, subject))

def duty_contains(+view: DutyView, +kind: String, +subject: String) -> Bool:
  match view:
    case DutyNone{}: False{}
    case DutyRows{count, text}: duty_contains_rows(duty_split(text), kind, subject)
    case DutyUnreadable{line, answer}: False{}

def duty_text(view: DutyView) -> String:
  match view:
    case DutyNone{}: "none"
    case DutyRows{count, text}: "rows:" ++ U32.show(count)
    case DutyUnreadable{line, answer}: "unreadable:" ++ line

# The bound enumeration. A failed read stays a failure and an unreadable answer is
# never a settled set.
def duties(+db: String, +binding: String) -> IO(Result<&1,&1,U32 & String,DutyView>):
  do IO<Result<&1,&1,U32 & String,DutyView>>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, duties_sql())
    duty_after(result)
