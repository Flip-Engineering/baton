import Base
import ./commands.bend as C
import ./instance.bend as Instance

# The serve snapshot replays every session holding actionable pending input:
# unacknowledged messages on live sessions of a supported harness with a
# registered receiver endpoint, excluding terminally stopped sessions, in
# recipient order. The harness travels with the session so each task keeps
# its native identity down to the route.
law dirty_snapshot_replays_receivable_pending:
  {Instance.dirty_session_sql() == "SELECT DISTINCT m.recipient || '|' || s.harness FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.receipt IS NULL AND m.recipient <> '' AND NOT " ++ C.stopped_session_sql("m.recipient") ++ " AND s.harness IN ('codex','omp','muse','claude-code') AND s.endpoint <> '' ORDER BY m.recipient;" : String}

def dirty_snapshot_replays_receivable_pending():
  {==}

# Only the receive route starts natives from pending input in this loop.
law receivable_admits_codex_and_omp:
  {Instance.receivable("codex") == True{} : Bool}

def receivable_admits_codex_and_omp():
  {==}

law receivable_admits_omp:
  {Instance.receivable("omp") == True{} : Bool}

def receivable_admits_omp():
  {==}

law receivable_refuses_muse:
  {Instance.receivable("muse") == False{} : Bool}

def receivable_refuses_muse():
  {==}

law receivable_refuses_claude_code:
  {Instance.receivable("claude-code") == False{} : Bool}

def receivable_refuses_claude_code():
  {==}

law member_finds_a_held_session:
  {Instance.member(Con{"a", Con{"b", Nil{}}}, "b") == True{} : Bool}

def member_finds_a_held_session():
  {==}

law without_id_drops_the_completed_session:
  {Instance.member(Instance.without_id(Con{"a", Con{"b", Nil{}}}, "a"), "a") == False{} : Bool}

def without_id_drops_the_completed_session():
  {==}

law partition_forks_receivable_sessions:
  {Instance.member(Instance.fork_of(Instance.partition(Con{("n1", "codex"), Con{("n2", "muse"), Con{("n3", "omp"), Nil{}}}})), "n1") == True{} : Bool}

def partition_forks_receivable_sessions():
  {==}

law partition_refuses_turn_route_sessions:
  {Instance.member(Instance.refuse_of(Instance.partition(Con{("n1", "codex"), Con{("n2", "muse"), Con{("n3", "omp"), Nil{}}}})), "n2") == True{} : Bool}

def partition_refuses_turn_route_sessions():
  {==}

law strip_known_removes_in_flight_sessions:
  {Instance.member(Instance.sessions_of(Instance.stripped_fresh(Instance.strip_known(Con{("n1", "codex"), Con{("n3", "omp"), Nil{}}}, Con{"n1", Nil{}}))), "n1") == False{} : Bool}

def strip_known_removes_in_flight_sessions():
  {==}

law strip_known_returns_the_known_set:
  {Instance.member(Instance.stripped_kept(Instance.strip_known(Con{("n1", "codex"), Con{("n3", "omp"), Nil{}}}, Con{"n1", Nil{}})), "n1") == True{} : Bool}

def strip_known_returns_the_known_set():
  {==}

law without_session_drops_the_named_pair:
  {Instance.member(Instance.sessions_of(Instance.without_session(Con{("n1", "codex"), Con{("n2", "muse"), Nil{}}}, "n1")), "n1") == False{} : Bool}

def without_session_drops_the_named_pair():
  {==}
