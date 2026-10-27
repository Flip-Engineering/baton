# Focused fixture for #1025: provider refusal text, a window length and an
# operator-entered reset row do not hold a seat. On 2026-10-23 a z.ai 429 named a
# UTC+8 reset clock; Baton stored it and held four GLM seats about 8 hours after a
# live read showed 3% of the 5-hour window used. The fixture records that refusal and
# a Kimi refusal that names only its 5-hour window through the real evidence path, and
# an operator-observation row with a future reset, then reads each seat's gate. With
# no live read recorded, the gate does not hold.
#
# usage: usage-hold-error-text DB
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/usage-windows.bend as UW
import ../src/host/sqlite.bend as DB
import ../src/git/text.bend as Tx

def expect(+label: String, is_ok: Bool) -> IO(Unit):
  Bool.pick(IO(Unit),is_ok,IO.print("fixture-usage-hold-error-text " ++ label ++ ": ok"),IO.die(Unit,1,"fixture-usage-hold-error-text " ++ label ++ ": refused"))

def query(+db: String, +text: String) -> IO(Unit):
  do IO<Unit>:
    ignore : String <- IO.try(String,DB.Sql.query(db,text))
    IO.pure(Unit,Unit{})

def gate_class(gate: UW.Gate) -> String:
  match gate:
    case UW.GateHeld{window,resets_at,source,receipt}: "held"
    case other: "not-held"

def expect_gate(+db: String, +session: String, +expected: String, +label: String) -> IO(Unit):
  do IO<Unit>:
    gate : UW.Gate <- UW.window_gate(db,session,"")
    expect(label,String.eq(gate_class(gate),expected))

# The z.ai refusal text with its reset clock written in UTC+8 eight hours ahead of now.
def zai_cause(+clock: String) -> String:
  "provider-reported usage exhaustion: Usage limit reached for 5 hour. Your limit will reset at " ++ clock

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case +db <> Nil{}: do IO<Unit>:
      made : Unit <- query(db,C.schema())
      sessions : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES('root',NULL,'omp','','','',''),('film-glm','root','omp','zai/glm-5.3','high','',''),('kimi-seat','root','omp','kimi-code/kimi-for-coding','high','','');")
      +clock : String <- IO.try(String,DB.Sql.read(db,"SELECT strftime('%Y-%m-%d %H:%M:%S','now','+16 hours');"))
      recorded : Unit <- UW.record_cause(db,"film-glm","attempt-1","",zai_cause(Tx.trim_nl(clock)))
      evidence : String <- IO.try(String,DB.Sql.read(db,"SELECT count(*) FROM usage_windows WHERE provider='zai' AND reset_source='provider-message';"))
      kept : Unit <- expect("refusal-evidence-recorded",String.eq(evidence,"1\n"))
      refused : Unit <- expect_gate(db,"film-glm","not-held","refusal-text-reset-does-not-hold")
      kimi : Unit <- UW.record_cause(db,"kimi-seat","attempt-2","","provider-reported usage exhaustion: You've reached your 5-hour usage limit. Your quota will reset when the current 5-hour window ends.")
      bounded : Unit <- expect_gate(db,"kimi-seat","not-held","window-length-does-not-hold")
      observed : Unit <- query(db,"INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) VALUES(CAST(strftime('%s','now') AS INTEGER)*1000,'omp','kimi-code/kimi-for-coding','kimi-code','','5-hour',CAST(strftime('%s','now') AS INTEGER)*1000+3600000,'operator-observation',NULL,'operator-observation: console','');")
      operator : Unit <- expect_gate(db,"kimi-seat","not-held","operator-reset-does-not-hold")
      IO.print("fixture-usage-hold-error-text-ok")
    case other: IO.die(Unit,2,"usage: usage-hold-error-text DB")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
