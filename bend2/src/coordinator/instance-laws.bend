import Base
import ./instance.bend as Instance

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
  {Instance.member(Instance.stripped_kept(Instance.strip_known(Con{"n1", Nil{}}, Con{("n1", "codex"), Con{("n3", "omp"), Nil{}}})), "n1") == True{} : Bool}

def strip_known_returns_the_known_set():
  {==}

law without_session_drops_the_named_pair:
  {Instance.member(Instance.sessions_of(Instance.without_session(Con{("n1", "codex"), Con{("n2", "muse"), Nil{}}}, "n1")), "n1") == False{} : Bool}

def without_session_drops_the_named_pair():
  {==}
