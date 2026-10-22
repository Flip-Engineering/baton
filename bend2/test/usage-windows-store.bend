# Store and gate fixture for the #797 usage-window module. It drives the real
# record_cause, observe, refresh, query and gate functions over a temporary
# coordination database. The gate holds only exhausted windows: a partial
# provider report with a future reset is admitted and visible; exhaustion is a
# provider limit message or a used fraction at or above 1; multiple windows are
# evaluated per window; a named window's limit message without a reset holds to
# its window bound; an unnamed one holds to the re-probe instant; a successful
# attempt clears refusals recorded before it started; an unknown observation
# recorded after a future reset keeps that hold until an actual reset observation.
#
# usage: usage-windows-store DB HARNESS_SCRIPT
# HARNESS_SCRIPT is an executable that prints the OMP usage report JSON and
# ignores its arguments.
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/usage-windows.bend as UW
import ../src/json/canonical.bend as J
import ../src/host/sqlite.bend as DB
import ../src/git/text.bend as Tx

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
    case UW.GateHeld{window,resets_at,source,receipt}: "held"
    case UW.GateElapsed{window,resets_at,source,receipt}: "elapsed"

def expect_gate(+db: String, +session: String, +account: String, +expected: String, +label: String) -> IO(Unit):
  do IO<Unit>:
    gate : UW.Gate <- UW.window_gate(db,session,account)
    expect(label,String.eq(gate_class(gate),expected))

def state_sql(+window: String, +account: String) -> String:
  "SELECT CASE WHEN NOT ((used_fraction IS NOT NULL AND used_fraction >= 1) OR reset_source='provider-message') THEN 'open' WHEN coalesce(resets_at,recorded_at+3600000) > CAST(strftime('%s','now') AS INTEGER)*1000 THEN 'held' ELSE 'elapsed' END FROM usage_windows WHERE account=" ++ C.q(account) ++ " AND window=" ++ C.q(window) ++ " ORDER BY recorded_at DESC, id DESC LIMIT 1;"

def kimi_cause() -> String:
  "You've reached your 5-hour usage limit. Your quota will reset when the current 5-hour window ends."

def setup(+db: String) -> IO(Unit):
  do IO<Unit>:
    made : String <- IO.try(String,DB.Sql.query(db,C.schema()))
    root : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES('root',NULL,'omp','','','','');")
    leaf : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES('leaf','root','omp','kimi-code/kimi-for-coding','high','','');")
    IO.pure(Unit,Unit{})

def session(+db: String, id: String) -> IO(Unit):
  query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES(" ++ C.q(id) ++ ",'root','omp','kimi-code/kimi-for-coding','high','','');")

def observe_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    printed_unknown : Unit <- expect("operator-observation-json-null",String.eq(UW.observe_json("leaf","5-hour","NULL"),"{\"schema\":\"baton2-usage-window-observation-v1\",\"session\":\"leaf\",\"window\":\"5-hour\",\"resetsAt\":null}"))
    UW.record_cause(db,"leaf","m-leaf","",kimi_cause())
    reset_z : String <- UW.observe_reset_value(db,"2026-10-17T03:41:00Z")
    expect("operator-reset-explicit-z",String.eq(reset_z,"1792208460000"))
    reset_positive : String <- UW.observe_reset_value(db,"2026-10-17T03:41:00+05:30")
    expect("operator-reset-positive-offset",String.eq(reset_positive,"1792188660000"))
    reset_negative : String <- UW.observe_reset_value(db,"2026-10-17T03:41:00-07:00")
    expect("operator-reset-negative-offset",String.eq(reset_negative,"1792233660000"))
    expect("operator-reset-rejects-date-only",Bool.not(UW.operator_reset_token("2026-10-17")))
    expect("operator-reset-rejects-offsetless",Bool.not(UW.operator_reset_token("2026-10-17T03:41:00")))
    expect("operator-reset-rejects-short-offset",Bool.not(UW.operator_reset_token("2026-10-17T03:41:00+05")))
    expect("operator-reset-rejects-empty-fraction",Bool.not(UW.operator_reset_token("2026-10-17T03:41:00.Z")))
    expect("operator-reset-accepts-fraction",UW.operator_reset_token("2026-10-17T03:41:00.125Z"))
    expect("operator-reset-rejects-sqlite-keyword",Bool.not(UW.operator_reset_token("now")))
    expect("operator-reset-rejects-localtime-modifier",Bool.not(UW.operator_reset_token("localtime")))
    expect("operator-reset-rejects-utc-modifier",Bool.not(UW.operator_reset_token("utc")))
    expect("provider-date-only-parser-preserved",UW.iso_token("2026-10-17"))
    expect("provider-offsetless-parser-preserved",UW.iso_token("2026-10-17T03:41:00"))
    observed_unknown : Unit <- UW.observe(db,"leaf","5-hour","unknown","kimi console shows none","")
    expect_gate(db,"leaf","","held","limit-then-operator-unknown-keeps-window-bound")
    observed_held : Unit <- UW.observe(db,"leaf","5-hour","2999-01-01T00:00:00Z","kimi console web ui","")
    expect_gate(db,"leaf","","held","operator-observed-reset-holds")
    observed_unknown_after_hold : Unit <- UW.observe(db,"leaf","5-hour","unknown","kimi console shows none","")
    expect_gate(db,"leaf","","held","unknown-observation-keeps-observed-hold")
    held_row : Unit <- expect_read(db,"SELECT (SELECT count(*) FROM usage_windows WHERE window='5-hour' AND reset_source='operator-observation' AND resets_at IS NOT NULL)||':'||(SELECT count(*) FROM usage_windows WHERE window='5-hour' AND reset_source='operator-observation' AND resets_at IS NULL);","1:2\n","unknown-observation-retained-without-replacing-reset")
    observed_elapsed : Unit <- UW.observe(db,"leaf","5-hour","2020-01-01T00:00:00Z","kimi console web ui","")
    expect_gate(db,"leaf","","elapsed","operator-observed-reset-elapsed")
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
    admitted : Unit <- expect_gate(db,"leaf","","none","partial-report-not-held")
    visible : Unit <- expect_read(db,state_sql("5-hour",""),"open\n","partial-report-visible-open")
    IO.pure(Unit,Unit{})

def multiwindow_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    created : Unit <- session(db,"multi")
    five : Unit <- query(db,"INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) VALUES(CAST(strftime('%s','now') AS INTEGER)*1000,'omp','kimi-code/kimi-for-coding','kimi-code','multi','5-hour',CAST(strftime('%s','now') AS INTEGER)*1000+3600000,'provider-message',NULL,'a 5-hour message','');")
    seven : Unit <- query(db,"INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) VALUES(CAST(strftime('%s','now') AS INTEGER)*1000,'omp','kimi-code/kimi-for-coding','kimi-code','multi','7-day',CAST(strftime('%s','now') AS INTEGER)*1000+7200000,'provider-report',0.5,'a 7-day report','');")
    thirty : Unit <- query(db,"INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) VALUES(CAST(strftime('%s','now') AS INTEGER)*1000,'omp','kimi-code/kimi-for-coding','kimi-code','multi','30-day',CAST(strftime('%s','now') AS INTEGER)*1000+86400000,'provider-report',0.2,'a 30-day report','');")
    held : Unit <- expect_gate(db,"multi","multi","held","multiwindow-held-by-5-hour")
    held_window : Unit <- expect_read(db,"SELECT window FROM (SELECT * FROM usage_windows WHERE account='multi' AND resets_at > CAST(strftime('%s','now') AS INTEGER)*1000 AND ((used_fraction IS NOT NULL AND used_fraction >= 1) OR reset_source='provider-message') ORDER BY resets_at ASC LIMIT 1);","5-hour\n","held-window-is-5-hour")
    passed : Unit <- query(db,"UPDATE usage_windows SET resets_at=CAST(strftime('%s','now') AS INTEGER)*1000-1000 WHERE account='multi' AND window='5-hour';")
    elapsed : Unit <- expect_gate(db,"multi","multi","elapsed","multiwindow-elapsed-after-5-hour")
    seven_open : Unit <- expect_read(db,"SELECT CASE WHEN ((used_fraction IS NOT NULL AND used_fraction >= 1) OR reset_source='provider-message') THEN 'exhausted' ELSE 'open' END FROM usage_windows WHERE account='multi' AND window='7-day';","open\n","partial-window-not-exhausted")
    IO.pure(Unit,Unit{})

def limit_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    created : Unit <- session(db,"limit")
    UW.record_cause(db,"limit","m-limit","limit",kimi_cause())
    bounded : Unit <- expect_gate(db,"limit","limit","held","limit-without-reset-holds-to-window-bound")
    visible : Unit <- expect_read(db,state_sql("5-hour","limit"),"held\n","limit-row-visible-held")
    bound_text : Unit <- expect_read(db,"SELECT CASE WHEN resets_at-recorded_at BETWEEN 18000000 AND 18000000 THEN 'five-hours' ELSE 'other' END FROM usage_windows WHERE account='limit' ORDER BY id DESC LIMIT 1;","five-hours\n","limit-bound-is-five-hours")
    IO.pure(Unit,Unit{})

# A refusal with no named window and no provider reset has no bound. The gate holds it
# to the re-probe instant, one hour after the refusal. A success recorded for an
# attempt that started after the refusal clears it. A refusal recorded inside the
# attempt keeps its hold.
def probe_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    created : Unit <- session(db,"probe")
    UW.record_cause(db,"probe","m-probe","probe","provider-reported usage exhaustion: 402 Insufficient Balance")
    no_reset : Unit <- expect_read(db,"SELECT CASE WHEN resets_at IS NULL THEN 'null' ELSE 'bounded' END FROM usage_windows WHERE account='probe' ORDER BY id DESC LIMIT 1;","null\n","unnamed-refusal-stores-no-reset")
    probe_held : Unit <- expect_gate(db,"probe","probe","held","unnamed-refusal-held-to-reprobe")
    reprobe_at : Unit <- expect_read(db,"SELECT CASE WHEN (SELECT recorded_at FROM usage_windows WHERE account='probe' ORDER BY id DESC LIMIT 1)+3600000 > CAST(strftime('%s','now') AS INTEGER)*1000 THEN 'later' ELSE 'passed' END;","later\n","reprobe-instant-is-one-hour-after-refusal")
    started_ahead : String <- read(db,"SELECT CAST(strftime('%s','now') AS INTEGER)*1000+1000;")
    cleared : Unit <- UW.record_success(db,"probe","probe",Tx.trim_nl(started_ahead),"att-after-refusal")
    expect_gate(db,"probe","probe","none","success-after-refusal-clears")
    refused : Unit <- UW.record_cause(db,"probe","m-probe-2","probe","provider-reported usage exhaustion: 402 Insufficient Balance")
    started_before : String <- read(db,"SELECT CAST(strftime('%s','now') AS INTEGER)*1000-1000;")
    inside : Unit <- UW.record_success(db,"probe","probe",Tx.trim_nl(started_before),"att-inside-refusal")
    expect_gate(db,"probe","probe","held","refusal-inside-attempt-keeps-hold")
    IO.pure(Unit,Unit{})

def projection_field(+db: String, +session: String, +account: String, +window: String, +path: String) -> IO(String):
  do IO<String>:
    answer : String <- read(db,UW.query_answer_sql(session,"omp","kimi-code",account))
    read(db,"SELECT json_extract(j.value," ++ C.q(path) ++ ") FROM json_each(json_extract(" ++ C.q(Tx.trim_nl(answer)) ++ ",'$.windows')) j WHERE json_extract(j.value,'$.window')=" ++ C.q(window) ++ ";")

def expect_projection(+db: String, +session: String, +account: String, +window: String, +path: String, +expected: String, +label: String) -> IO(Unit):
  do IO<Unit>:
    value : String <- projection_field(db,session,account,window,path)
    expect(label,String.eq(value,expected))

def projection_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    created : Unit <- session(db,"proj")
    UW.record_cause(db,"proj","m-proj","proj",kimi_cause())
    observed : Unit <- UW.observe(db,"proj","5-hour","2999-01-01T00:00:00Z","kimi console web ui","proj")
    held : Unit <- expect_gate(db,"proj","proj","held","projection-operator-future-held")
    held_state : Unit <- expect_projection(db,"proj","proj","5-hour","$.state","held\n","projection-state-matches-gate")
    held_source : Unit <- expect_projection(db,"proj","proj","5-hour","$.source","operator-observation\n","projection-reset-source-visible")
    held_exhausted : Unit <- expect_projection(db,"proj","proj","5-hour","$.exhausted","1\n","projection-exhausted-from-provider")
    held_provider : Unit <- expect_projection(db,"proj","proj","5-hour","$.exhaustionSource","provider-message\n","projection-exhaustion-source-visible")
    elapsed : Unit <- UW.observe(db,"proj","5-hour","2020-01-01T00:00:00Z","kimi console web ui","proj")
    elapsed_gate : Unit <- expect_gate(db,"proj","proj","elapsed","projection-operator-elapsed-gate")
    elapsed_state : Unit <- expect_projection(db,"proj","proj","5-hour","$.state","elapsed\n","projection-elapsed-matches-gate")
    IO.pure(Unit,Unit{})

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case +path <> script <> Nil{}: do IO<Unit>:
      setup(path)
      limit_case(path)
      probe_cases(path)
      observe_cases(path)
      report_cases(path)
      refresh_cases(path,script)
      multiwindow_cases(path)
      projection_cases(path)
      IO.print("fixture-windows-store-ok")
    case other: IO.die(Unit,2,"usage: usage-windows-store DB HARNESS_SCRIPT")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
