# Store and gate fixture for the #797 usage-window module. It drives the real
# record_cause, observe, refresh, query and gate functions over a temporary
# coordination database, so the extraction, the SQL store, the binding match
# and the held/elapsed/unknown gate are exercised without a coordinator Main
# generation.
#
# usage: usage-windows-store DB HARNESS_SCRIPT
# HARNESS_SCRIPT is an executable that prints the OMP usage report JSON and
# ignores its arguments.
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/usage-windows.bend as UW
import ../src/json/canonical.bend as J
import ../src/host/sqlite.bend as DB

def expect(+label: String, is_ok: Bool) -> IO(Unit):
  Bool.pick(IO(Unit),is_ok,IO.print("fixture-window-store " ++ label ++ ": ok"),IO.die(Unit,1,"fixture-window-store " ++ label ++ ": refused"))

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

def gate_class(gate: UW.Gate) -> String:
  match gate:
    case UW.GateNone{}: "none"
    case UW.GateUnknown{window,source,receipt}: "unknown"
    case UW.GateHeld{window,resets_at,source,receipt}: "held"
    case UW.GateElapsed{window,resets_at,source,receipt}: "elapsed"

def expect_gate(+db: String, +session: String, +account: String, +expected: String, +label: String) -> IO(Unit):
  do IO<Unit>:
    gate : UW.Gate <- UW.window_gate(db,session,account)
    expect(label,String.eq(gate_class(gate),expected))

def kimi_cause() -> String:
  "You've reached your 5-hour usage limit. Your quota will reset when the current 5-hour window ends."

def setup(+db: String) -> IO(Unit):
  do IO<Unit>:
    made : String <- IO.try(String,DB.Sql.query(db,C.schema()))
    root : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES('root',NULL,'omp','','','','');")
    leaf : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES('leaf','root','omp','kimi-code/kimi-for-coding','high','','');")
    IO.pure(Unit,Unit{})

def observe_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    observed_unknown : Unit <- UW.observe(db,"leaf","5-hour","unknown","kimi console shows none","")
    expect_gate(db,"leaf","","unknown","unknown-reset-gate")
    observed_held : Unit <- UW.observe(db,"leaf","5-hour","2999-01-01T00:00:00Z","kimi console web ui","")
    expect_gate(db,"leaf","","held","future-reset-gate")
    held_row : Unit <- expect_read(db,"SELECT window || ':' || reset_source || ':' || (resets_at IS NOT NULL) FROM usage_windows ORDER BY id DESC LIMIT 1;","5-hour:operator-observation:1\n","operator-observation-row")
    observed_elapsed : Unit <- UW.observe(db,"leaf","5-hour","2020-01-01T00:00:00Z","kimi console web ui","")
    expect_gate(db,"leaf","","elapsed","past-reset-gate")
    IO.pure(Unit,Unit{})

def report_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    observed_held : Unit <- UW.observe(db,"leaf","5-hour","2999-01-01T00:00:00Z","kimi console web ui","")
    gate : UW.Gate <- UW.window_gate(db,"leaf","")
    held_reported : Unit <- UW.report_held(db,"leaf","m1",gate)
    held_guidance : Unit <- expect_read(db,"SELECT count(*) FROM messages WHERE id='m1:usage-window-held';","1\n","held-guidance-once")
    held_report : Unit <- expect_read(db,"SELECT count(*) FROM messages WHERE id='m1:usage-window-held-report';","1\n","held-report-once")
    observed_elapsed : Unit <- UW.observe(db,"leaf","5-hour","2020-01-01T00:00:00Z","kimi console web ui","")
    +restored_gate : UW.Gate <- UW.window_gate(db,"leaf","")
    restored : Unit <- UW.report_restored(db,"leaf","m1",restored_gate)
    restored_guidance : Unit <- expect_read(db,"SELECT count(*) FROM messages WHERE id='m1:usage-window-restored';","1\n","restored-guidance-once")
    restored_report : Unit <- expect_read(db,"SELECT count(*) FROM messages WHERE id='m1:usage-window-restored-report';","1\n","restored-report-once")
    retried : Unit <- UW.report_restored(db,"leaf","m1",restored_gate)
    restored_still : Unit <- expect_read(db,"SELECT count(*) FROM messages WHERE id='m1:usage-window-restored';","1\n","restored-retry-idempotent")
    IO.pure(Unit,Unit{})

def endpoint_json(+script: String) -> String:
  "[" ++ J.string_literal("a") ++ "," ++ J.string_literal("b") ++ "," ++ J.string_literal("c") ++ "," ++ J.string_literal("d") ++ "," ++ J.string_literal(script) ++ "," ++ J.string_literal("f") ++ "," ++ J.string_literal("g") ++ "," ++ J.string_literal("h") ++ "," ++ J.string_literal("i") ++ "]"

def refresh_cases(+db: String, script: String) -> IO(Unit):
  do IO<Unit>:
    connected : Unit <- query(db,"UPDATE sessions SET endpoint=" ++ C.q(endpoint_json(script)) ++ " WHERE id='leaf';")
    refreshed : Unit <- UW.refresh(db,"leaf","")
    reported : Unit <- expect_read(db,"SELECT count(*) FROM usage_windows WHERE reset_source='provider-report';","1\n","provider-report-recorded")
    window : Unit <- expect_read(db,"SELECT window FROM usage_windows WHERE reset_source='provider-report';","5-hour\n","provider-report-window")
    reset : Unit <- expect_read(db,"SELECT CAST(resets_at AS TEXT) FROM usage_windows WHERE reset_source='provider-report';","1893456000000\n","provider-report-reset")
    fraction : Unit <- expect_read(db,"SELECT CAST(used_fraction AS TEXT) FROM usage_windows WHERE reset_source='provider-report';","0.42\n","provider-report-fraction")
    expect_gate(db,"leaf","","held","provider-report-gate")

def cause_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    UW.record_cause(db,"leaf","m2","",kimi_cause())
    kimi_row : Unit <- expect_read(db,"SELECT window || ':' || provider || ':' || reset_source || ':' || coalesce(CAST(resets_at AS TEXT),'NULL') FROM usage_windows WHERE message='m2';","5-hour:kimi-code:provider-message:NULL\n","kimi-cause-row")
    expect_gate(db,"leaf","","unknown","kimi-cause-gate")

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case +path <> script <> Nil{}: do IO<Unit>:
      setup(path)
      cause_case(path)
      observe_cases(path)
      report_cases(path)
      refresh_cases(path,script)
      IO.print("fixture-windows-store-ok")
    case other: IO.die(Unit,2,"usage: usage-windows-store DB HARNESS_SCRIPT")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
