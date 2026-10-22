# Route-change identity fixture for #1023. It runs the sequence that resumed a
# retained attempt with the previous harness's conversation id: configure to a new
# route, bind --native '', then replay the attempt's frames. A replayed frame of the
# previous harness must not write sessions.native or observed_model. A frame of the
# configured harness still records its conversation id.
#
# usage: route-change-identity DB
import Base
import ../src/coordinator/commands.bend as C
import ../src/host/sqlite.bend as DB

def expect(+label: String, is_ok: Bool) -> IO(Unit):
  Bool.pick(IO(Unit),is_ok,IO.print("fixture-route-change-identity " ++ label ++ ": ok"),IO.die(Unit,1,"fixture-route-change-identity " ++ label ++ ": refused"))

def query(+db: String, +text: String) -> IO(Unit):
  do IO<Unit>:
    ignore : String <- IO.try(String,DB.Sql.query(db,text))
    IO.pure(Unit,Unit{})

def read(+db: String, +text: String) -> IO(String):
  IO.try(String,DB.Sql.read(db,text))

def expect_read(+db: String, +text: String, +expected: String, +label: String) -> IO(Unit):
  do IO<Unit>:
    value : String <- read(db,text)
    expect(label,String.eq(value,expected))

def setup(+db: String) -> IO(Unit):
  do IO<Unit>:
    made : String <- IO.try(String,DB.Sql.query(db,C.schema()))
    root : Unit <- query(db,"INSERT OR IGNORE INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES('root',NULL,'operator','','','','');")
    IO.pure(Unit,Unit{})

# A seat registered on an earlier route, with the conversation id of that route.
def seat(+db: String, +id: String, +harness: String, +model: String, +native: String) -> IO(Unit):
  query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES(" ++ C.q(id) ++ ",'root'," ++ C.q(harness) ++ "," ++ C.q(model) ++ ",'high'," ++ C.q(native) ++ ",'');")

# The operator route change: configure with the expected previous route, then bind --native ''.
def route_change(+db: String, +id: String, +harness: String, +model: String, +previous_harness: String, +previous_model: String) -> IO(Unit):
  do IO<Unit>:
    configured : Unit <- query(db,"BEGIN IMMEDIATE;" ++ C.configure_sql(id,harness,model,"high","",previous_harness,previous_model,"high") ++ "COMMIT;")
    bound : Unit <- query(db,C.sql(C.Bind{id,"",harness,model,"high"}))
    IO.pure(Unit,Unit{})

# One replayed frame of a retained attempt, observed under the attempt's own harness.
def replay(+db: String, +id: String, +attempt: String, +attempt_harness: String, +event: String) -> IO(Unit):
  query(db,C.observe_sql(attempt,id,event,False{},attempt_harness))

# The previous omp route replays its get_state frame after the route moves to codex.
def omp_to_codex(+db: String) -> IO(Unit):
  do IO<Unit>:
    made : Unit <- seat(db,"film","omp","kimi-code/kimi-for-coding","OLD-OMP-ID")
    moved : Unit <- route_change(db,"film","codex","gpt-6.1-sol","omp","kimi-code/kimi-for-coding")
    stale : Unit <- replay(db,"film","attempt-omp","omp","{\"type\":\"response\",\"command\":\"get_state\",\"success\":true,\"data\":{\"sessionId\":\"OLD-OMP-ID\",\"model\":{\"provider\":\"kimi-code\",\"id\":\"kimi-for-coding\"}}}")
    none : Unit <- expect_read(db,"SELECT '[' || native || ']' FROM sessions WHERE id='film';","[]\n","omp-replay-leaves-native-empty")
    model : Unit <- expect_read(db,"SELECT '[' || observed_model || ']' FROM sessions WHERE id='film';","[gpt-6.1-sol]\n","omp-replay-leaves-observed-model")
    current : Unit <- replay(db,"film","attempt-codex","codex","{\"type\":\"thread.started\",\"thread_id\":\"NEW-THREAD-ID\"}")
    recorded : Unit <- expect_read(db,"SELECT '[' || native || ']' FROM sessions WHERE id='film';","[NEW-THREAD-ID]\n","codex-frame-records-native")
    IO.pure(Unit,Unit{})

# The previous codex route replays its thread.started frame after the route moves to claude-code.
def codex_to_claude(+db: String) -> IO(Unit):
  do IO<Unit>:
    made : Unit <- seat(db,"seat-b","codex","gpt-6.1-sol","OLD-THREAD-ID")
    moved : Unit <- route_change(db,"seat-b","claude-code","claude-sonnet-5-5","codex","gpt-6.1-sol")
    stale : Unit <- replay(db,"seat-b","attempt-codex","codex","{\"type\":\"thread.started\",\"thread_id\":\"OLD-THREAD-ID\"}")
    none : Unit <- expect_read(db,"SELECT '[' || native || ']' FROM sessions WHERE id='seat-b';","[]\n","codex-replay-leaves-native-empty")
    IO.pure(Unit,Unit{})

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case +db <> Nil{}: do IO<Unit>:
      setup(db)
      omp_to_codex(db)
      codex_to_claude(db)
      IO.print("fixture-route-change-identity-ok")
    case other: IO.die(Unit,2,"usage")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
