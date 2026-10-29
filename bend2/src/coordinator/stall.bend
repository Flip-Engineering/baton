# CLAIM: a pending-input candidate is classified from recorded database state.
# A candidate is active while its recorded attempt is not exited. An exited
# attempt with a present endpoint is stalled; an exited attempt without one is
# blocked. A candidate with no recorded attempt is blocked conservatively. The
# report keeps an explicit stop or existing wake claim in its recorded state. A
# stalled candidate is woken through the existing Wake.drive_id route, addressed
# by its oldest owed message.
#
# The module classifies from recorded database state; the database carries no
# clock value, so no observed instant is reported.
# Serves: docs/pure-bend2/pending-stall-bend2.md.
# Fixture: bend2/src/coordinator/stall-laws.bend.
import Base
import ../json/canonical.bend as J
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx
import ../coordinator/commands.bend as C
import ./wake.bend as Wake

# The endpoint predicate the coordinator already uses for a runnable route.
def endpoint_present_expr(+column: String) -> String:
  "CASE WHEN json_valid(" ++ column ++ ") THEN json_type(" ++ column ++ ")='array' AND json_array_length(" ++ column ++ ")>0 ELSE 0 END"

# The owed-input count for one session. A completed assignment admits no new
# native attempt, so its owed input is not a wake obligation.
def owed_expr(+session: String) -> String:
  "(SELECT count(*) FROM messages m WHERE m.recipient=" ++ session ++ " AND " ++ C.owed_sql("m") ++ " AND NOT " ++ C.task_closed_sql(session) ++ ")"

# An explicit stop resolves the session's wake obligation.
def stopped_expr(+session: String) -> String:
  "EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ session ++ ")"

# The claim state the coordinator records for one session. A database without
# the claim table reports an empty state and classifies no candidate as claimed.
def claim_state_expr(+session: String, +present: Bool) -> String:
  Bool.pick(String, present, "coalesce((SELECT state FROM wake_claims WHERE session=" ++ session ++ "),'')", "''")

# The candidate classification. The recorded attempt phase separates a live
# attempt from a finished one; the endpoint decides whether a finished attempt
# can be woken; the stop and claim checks take precedence over both. A session
# with no recorded attempt has an empty phase and is blocked conservatively:
# there is no attempt to wake.
def state_expr(+session: String, +phase: String, +endpoint: String, +present: Bool) -> String:
  "CASE WHEN " ++ stopped_expr(session) ++ " THEN 'stopped'"
  ++ " WHEN " ++ claim_state_expr(session,present) ++ "='claimed' THEN 'claimed'"
  ++ " WHEN coalesce(" ++ phase ++ ",'')='' THEN 'blocked'"
  ++ " WHEN " ++ phase ++ "='exited' AND (" ++ endpoint_present_expr(endpoint) ++ ")=0 THEN 'blocked'"
  ++ " WHEN " ++ phase ++ "='exited' THEN 'stalled'"
  ++ " ELSE 'active' END"

# One line per pending-input candidate: session, pending count, attempt id,
# attempt phase, endpoint presence, the oldest owed message, stopped flag,
# claim state, and classification. Tabs between fields, so the row transport is
# the coordinator's existing one. The executions.session primary key makes the
# left join add at most one attempt row, so a pending session with no attempt
# appears once with an empty attempt id and phase.
def stalled_rows_sql(+present: Bool) -> String:
  "SELECT s.id||char(9)||"
  ++ "CAST(" ++ owed_expr("s.id") ++ " AS TEXT)||char(9)||"
  ++ "coalesce(e.id,'')||char(9)||coalesce(e.phase,'')||char(9)||"
  ++ "CAST(" ++ endpoint_present_expr("s.endpoint") ++ " AS TEXT)||char(9)||"
  ++ "coalesce((SELECT m.id FROM messages m WHERE m.recipient=s.id AND " ++ C.owed_sql("m") ++ " ORDER BY m.seq LIMIT 1),'')||char(9)||"
  ++ "CAST(" ++ stopped_expr("s.id") ++ " AS TEXT)||char(9)||"
  ++ claim_state_expr("s.id",present) ++ "||char(9)||"
  ++ state_expr("s.id","e.phase","s.endpoint",present)
  ++ " FROM sessions s LEFT JOIN executions e ON e.session=s.id"
  ++ " WHERE " ++ owed_expr("s.id") ++ ">0"
  ++ " ORDER BY s.id;"

def claim_table_present_sql() -> String:
  "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='wake_claims';"

def claim_table_present(db: String) -> IO(Bool):
  do IO<Bool>:
    value : String <- IO.try(String,DB.Sql.query(db,claim_table_present_sql()))
    IO.pure(Bool,Bool.not(String.eq(Tx.trim_nl(value),"0")))

# The row's JSON object, over fields the caller has already split: a match
# cannot scrutinise a computed value, so the split happens in the caller.
def row_fields(fields: List<String>) -> String:
  match fields:
    case session <> pending <> attempt <> phase <> present <> owed <> stopped <> claim <> state <> Nil{}:
      "{\"id\":" ++ J.string_literal(session)
      ++ ",\"pending\":" ++ pending
      ++ ",\"attempt\":{\"id\":" ++ J.string_literal(attempt)
      ++ ",\"phase\":" ++ J.string_literal(phase) ++ "}"
      ++ ",\"endpointPresent\":" ++ present
      ++ ",\"owedMessage\":" ++ J.string_literal(owed)
      ++ ",\"stopped\":" ++ stopped
      ++ ",\"claim\":" ++ J.string_literal(claim)
      ++ ",\"state\":" ++ J.string_literal(state) ++ "}"
    case other: ""

# A line that does not carry nine fields is not a candidate and is skipped.
def row_json(+line: String) -> String:
  row_fields(Tx.split_tabs(line))

# The rendered rows are an accumulator, so each step consumes the tail once.
# The row is rendered once; a line whose rendered row is empty is skipped and
# keeps the first flag, and a rendered row takes the comma prefix only when a
# row already precedes it.
def rows_json_go(lines: List<String>, +first: Bool, acc: String) -> String:
  match lines:
    case Nil{}: acc
    case head <> rest:
      +row = row_json(head)
      +empty = String.is_empty(row)
      +prefix = Bool.pick(String, empty, "",
        Bool.pick(String, first, row, "," ++ row))
      next_first = Bool.pick(Bool, empty, first, False{})
      rows_json_go(rest, next_first, acc ++ prefix)

def rows_json(lines: List<String>, +first: Bool) -> String:
  rows_json_go(lines, first, "")

def report_text(+rows: String) -> String:
  "{\"candidates\":[" ++ rows ++ "]}"

# The report: every pending-input candidate with its recorded classification.
def report(+db: String) -> IO(Unit):
  do IO<Unit>:
    present : Bool <- claim_table_present(db)
    found : String <- IO.try(String,DB.Sql.query(db,stalled_rows_sql(present)))
    IO.print(report_text(rows_json(Tx.split_lines(Tx.trim_nl(found)), True{})))

def owed_fields(fields: List<String>) -> List<String>:
  match fields:
    case session <> pending <> attempt <> phase <> present <> +owed <> stopped <> claim <> +state <> Nil{}:
      +stalled = String.eq(state,"stalled")
      +claimed_exited = Bool.and(String.eq(claim,"claimed"),Bool.and(String.eq(phase,"exited"),Bool.and(String.eq(present,"1"),String.eq(stopped,"0"))))
      Bool.pick(List<String>, Bool.and(Bool.or(stalled,claimed_exited),Bool.not(String.is_empty(owed))), [owed], Nil{})
    case other: Nil{}

def owed_of(+line: String) -> List<String>:
  owed_fields(Tx.split_tabs(line))

# The wake side drives stalled candidates and exited sessions with a claim and
# a runnable endpoint. The existing driver checks claim custody under the
# session lock before it launches the oldest owed message.
def wake_rows(lines: List<String>) -> List<String>:
  match lines:
    case Nil{}: Nil{}
    case head <> rest: List.append(&1, String, owed_of(head), wake_rows(rest))

def wake_each(+db: String, ids: List<String>) -> IO(Unit):
  match ids:
    case Nil{}: IO.pure(Unit, Unit{})
    case head <> rest: do IO<Unit>:
      driven : Unit <- IO.try(Unit,Wake.drive_id(db,head))
      wake_each(db, rest)

def wake_stalled(+db: String) -> IO(Unit):
  do IO<Unit>:
    present : Bool <- claim_table_present(db)
    found : String <- IO.try(String,DB.Sql.query(db,stalled_rows_sql(present)))
    wake_each(db, wake_rows(Tx.split_lines(Tx.trim_nl(found))))
