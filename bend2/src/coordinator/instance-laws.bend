import Base
import ./commands.bend as C
import ./instance.bend as Instance

# The serve snapshot replays every session holding actionable pending input:
# unacknowledged messages on live sessions of a supported harness, excluding
# terminally stopped sessions, in recipient order. Each row already marks its
# serving route: Codex and OMP sessions with a recorded receiver endpoint run
# through receive, every other actionable session refuses with its own route.
law dirty_snapshot_marks_the_serving_route:
  {Instance.dirty_session_sql() == "SELECT DISTINCT m.recipient || '|' || s.harness || '|' || CASE WHEN s.harness IN ('codex','omp') AND s.endpoint <> '' THEN 'serve' ELSE 'refuse' END FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.receipt IS NULL AND m.recipient <> '' AND NOT " ++ C.stopped_session_sql("m.recipient") ++ " AND s.harness IN ('codex','omp','muse','claude-code') ORDER BY m.recipient;" : String}

def dirty_snapshot_marks_the_serving_route():
  {==}

law parse_split_routes_receivable_sessions:
  {Instance.member(Instance.sessions_of(Instance.serve_part(Instance.parse_split(Con{"w1|codex|serve", Con{"m1|muse|refuse", Con{"w3|omp|serve", Nil{}}}}))), "w1") == True{} : Bool}

def parse_split_routes_receivable_sessions():
  {==}

law parse_split_refuses_turn_route_sessions:
  {Instance.member(Instance.sessions_of(Instance.refuse_part(Instance.parse_split(Con{"w1|codex|serve", Con{"m1|muse|refuse", Con{"w3|omp|serve", Nil{}}}}))), "m1") == True{} : Bool}

def parse_split_refuses_turn_route_sessions():
  {==}

law parse_split_refuses_unparsable_rows:
  {Instance.member(Instance.sessions_of(Instance.refuse_part(Instance.parse_split(Con{"zzz", Nil{}}))), "zzz") == True{} : Bool}

def parse_split_refuses_unparsable_rows():
  {==}

law refusal_names_the_turn_route:
  {Instance.refusal_text("m1", "muse") == "serve-refused m1 muse: this loop serves Codex and OMP sessions with recorded receivers through receive; serve muse sessions with dispatch-turn.\n" : String}

def refusal_names_the_turn_route():
  {==}

law refusal_names_receiver_registration:
  {Instance.refusal_text("w1", "codex") == "serve-refused w1 codex: this loop serves Codex and OMP sessions with recorded receivers through receive; register a receiver for w1 before it can run.\n" : String}

def refusal_names_receiver_registration():
  {==}

law member_finds_a_held_session:
  {Instance.member(Con{"a", Con{"b", Nil{}}}, "b") == True{} : Bool}

def member_finds_a_held_session():
  {==}

law without_id_drops_the_completed_session:
  {Instance.member(Instance.without_id(Con{"a", Con{"b", Nil{}}}, "a"), "a") == False{} : Bool}

def without_id_drops_the_completed_session():
  {==}

law strip_known_removes_in_flight_sessions:
  {Instance.member(Instance.sessions_of(Instance.stripped_fresh(Instance.strip_known(Con{"n1", Nil{}}, Con{("n1", "codex"), Con{("n3", "omp"), Nil{}}}))), "n1") == False{} : Bool}

def strip_known_removes_in_flight_sessions():
  {==}

law strip_known_returns_the_known_set:
  {Instance.member(Instance.stripped_kept(Instance.strip_known(Con{"n1", Nil{}}, Con{("n1", "codex"), Con{("n3", "omp"), Nil{}}}))), "n1") == True{} : Bool}

def strip_known_returns_the_known_set():
  {==}

law without_session_drops_the_named_pair:
  {Instance.member(Instance.sessions_of(Instance.without_session(Con{("n1", "codex"), Con{("n2", "muse"), Nil{}}}, "n1")), "n1") == False{} : Bool}

def without_session_drops_the_named_pair():
  {==}
