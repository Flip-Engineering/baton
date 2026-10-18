# CLAIM: a stalled player and its wake are derivable from the recorded database
# alone. A player is stalled when it holds unacknowledged input, its recorded
# attempt phase is not exited, and its stored endpoint names a runnable route.
# The wake reuses the existing driver, addressed by the oldest owed message, so
# there is one wake route and no second one.
#
# No clock is consulted and none is reported: the database records no instant,
# and the runtime clock's unit is not established anywhere this module can cite,
# so an observedAt field would be a fact the module cannot support.
# Serves: docs/pure-bend2/pending-stall-bend2.md.
# Fixture: bend2/src/coordinator/stall-laws.bend.
import Base
import ../coordinator/commands.bend as C
import ../json/canonical.bend as J
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx
import ./wake.bend as Wake

# The endpoint predicate the coordinator already uses for a runnable route.
def endpoint_present_expr(+column: String) -> String:
  "CASE WHEN json_valid(" ++ column ++ ") THEN json_type(" ++ column ++ ")='array' AND json_array_length(" ++ column ++ ")>0 ELSE 0 END"

# The owed-input count for one session.
def owed_expr(+session: String) -> String:
  "(SELECT count(*) FROM messages m WHERE m.recipient=" ++ session ++ " AND m.receipt IS NULL)"

# One line per stalled player: session, pending count, attempt id, attempt phase,
# endpoint presence, and the oldest owed message the wake addresses. Tabs between
# fields, so the row transport is the coordinator's existing one.
def stalled_rows_sql() -> String:
  "SELECT s.id||char(9)||"
  ++ "CAST(" ++ owed_expr("s.id") ++ " AS TEXT)||char(9)||"
  ++ "coalesce(e.id,'')||char(9)||coalesce(e.phase,'')||char(9)||"
  ++ "CAST(" ++ endpoint_present_expr("s.endpoint") ++ " AS TEXT)||char(9)||"
  ++ "coalesce((SELECT m.id FROM messages m WHERE m.recipient=s.id AND m.receipt IS NULL ORDER BY m.seq LIMIT 1),'')"
  ++ " FROM sessions s JOIN executions e ON e.session=s.id"
  ++ " WHERE e.phase<>'exited'"
  ++ " AND " ++ owed_expr("s.id") ++ ">0"
  ++ " AND " ++ endpoint_present_expr("s.endpoint") ++ "=1"
  ++ " ORDER BY s.id;"

# The row's JSON object, over fields the caller has already split: a match
# cannot scrutinise a computed value, so the split happens in the caller.
def row_fields(fields: List<String>) -> String:
  match fields:
    case session <> pending <> attempt <> phase <> present <> owed <> Nil{}:
      "{\"id\":" ++ J.string_literal(session)
      ++ ",\"pending\":" ++ pending
      ++ ",\"attempt\":{\"id\":" ++ J.string_literal(attempt)
      ++ ",\"phase\":" ++ J.string_literal(phase) ++ "}"
      ++ ",\"endpointPresent\":" ++ present
      ++ ",\"owedMessage\":" ++ J.string_literal(owed) ++ "}"
    case other: ""

# A line that does not carry six fields is not a row and is skipped rather than
# reported as an empty one.
def row_json(+line: String) -> String:
  row_fields(Tx.split_tabs(line))

# The rendered rows are an accumulator, so each step consumes the tail once.
# The row is rendered once; a line whose rendered row is empty (an empty line
# or a malformed row) is skipped and keeps the first flag, and a rendered row
# takes the comma prefix only when a row already precedes it.
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
  "{\"stalled\":[" ++ rows ++ "]}"

# The report: facts only, and an empty array when nothing is stalled.
def report(db: String) -> IO(Unit):
  do IO<Unit>:
    found : String <- IO.try(String,DB.Sql.query(db,stalled_rows_sql()))
    IO.print(report_text(rows_json(Tx.split_lines(Tx.trim_nl(found)), True{})))

def owed_fields(fields: List<String>) -> List<String>:
  match fields:
    case session <> pending <> attempt <> phase <> present <> +owed <> Nil{}:
      Bool.pick(List<String>, String.is_empty(owed), Nil{}, [owed])
    case other: Nil{}

def owed_of(+line: String) -> List<String>:
  owed_fields(Tx.split_tabs(line))

# The wake side: one call per stalled session, addressed by its oldest owed
# message, through the existing driver. A session with no owed id is skipped, and
# a repeated invocation re-drives the same message, which the driver already
# treats idempotently because the cursor is the message's own position.
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
    found : String <- IO.try(String,DB.Sql.query(db,stalled_rows_sql()))
    wake_each(db, wake_rows(Tx.split_lines(Tx.trim_nl(found))))
