import Base
import ../host/sqlite.bend as DB
import ../coordinator/commands.bend as C
import ../git/text.bend as Tx

# The durable observation record is the replay input for a retained attempt:
# the newest cumulative payload per identity plus every non-cumulative frame in
# arrival order. The raw spool keeps native lineage; this module reads only the
# projection the public log received.
def has_rows_sql(+session: String, +attempt: String) -> String:
  "SELECT CASE WHEN EXISTS(SELECT 1 FROM observations WHERE session=" ++ C.q(session) ++ " AND attempt=" ++ C.q(attempt) ++ ") THEN 1 ELSE 0 END;"

def has_rows(db: String, session: String, attempt: String) -> IO(Bool):
  do IO<Bool>:
    found : String <- IO.try(String,DB.Sql.query(db,has_rows_sql(session,attempt)))
    IO.pure(Bool,String.eq(Tx.trim_nl(found),"1"))

# Rows leave in durable observation order. A live observer still holds its open
# prefixes, so the rebuild includes only rows the projection already wrote and
# leaves the open held set to its normal close or flush. After the EOF flush
# the held set is empty, so the rebuild includes the open prefixes that flush
# wrote. Diagnostic stores every frame, and quiet already stored an empty
# projection for the frames its level dropped.
def projected_sql(+session: String, +attempt: String, finished: Bool) -> String:
  +closed = "EXISTS(SELECT 1 FROM observations closed WHERE closed.session=observations.session AND closed.attempt=observations.attempt AND closed.is_prefix=0 AND closed.kind='message_end' AND closed.frame_id=observations.frame_id)"
  +codex_closed = "EXISTS(SELECT 1 FROM observations closed WHERE closed.session=observations.session AND closed.attempt=observations.attempt AND closed.is_prefix=0 AND closed.kind='codex_command_end' AND closed.frame_id=observations.frame_id)"
  +tool_closed = "EXISTS(SELECT 1 FROM observations closed WHERE closed.session=observations.session AND closed.attempt=observations.attempt AND closed.is_prefix=0 AND closed.kind='tool_execution_end' AND closed.frame_id=observations.frame_id)"
  +finished_rows = "level='diagnostic' OR (projected<>'' AND (kind='tool_execution_update' OR (is_prefix=0 AND NOT (kind='message_start' AND frame_id<>'' AND " ++ closed ++ ") AND NOT (kind='codex_command_start' AND frame_id<>'' AND " ++ codex_closed ++ ")) OR (is_prefix=1 AND NOT (" ++ closed ++ "))))"
  +live_rows = "level='diagnostic' OR (projected<>'' AND ((is_prefix=0 AND NOT (kind='message_start' AND frame_id<>'') AND NOT (kind='codex_command_start' AND frame_id<>'')) OR (kind='tool_execution_update' AND " ++ tool_closed ++ ")))"
  +included = Bool.pick(String,finished,finished_rows,live_rows)
  "SELECT coalesce((SELECT group_concat(projected,char(10)) FROM (SELECT projected FROM observations WHERE session=" ++ C.q(session) ++ " AND attempt=" ++ C.q(attempt) ++ " AND (" ++ included ++ ") ORDER BY id)),'');"

def projected_rows(db: String, session: String, attempt: String, finished: Bool) -> IO(List<String>):
  do IO<List<String>>:
    rows : String <- IO.try(String,DB.Sql.query(db,projected_sql(session,attempt,finished)))
    +lines : String <- IO.pure(String,Tx.trim_nl(rows))
    IO.pure(List<String>,Tx.split_lines(lines))
