import Base
import ./commands.bend as C
import ./instance.bend as Instance

# The serve snapshot replays every session holding actionable pending input:
# unacknowledged messages that are not execution input to a terminally stopped
# session, on live Codex or OMP sessions, in recipient order.
law dirty_snapshot_replays_receivable_pending:
  {Instance.dirty_session_sql() == "SELECT DISTINCT m.recipient FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.receipt IS NULL AND NOT (" ++ C.stopped_session_sql("m.recipient") ++ " AND " ++ C.execution_input_sql("m.kind") ++ ") AND s.harness IN ('codex','omp') ORDER BY m.recipient;" : String}

def dirty_snapshot_replays_receivable_pending():
  {==}
