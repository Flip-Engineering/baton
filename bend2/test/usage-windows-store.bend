# Store, decision and query fixture for the #1025 usage hold. It drives the real
# refusal evidence path, hold decision, command answer and refresh over a temporary
# coordination database.
#
# Refusal text is recorded as evidence with the window kind it names, the model's
# provider and the account label, and with no reset time; it does not hold. A live
# read with an exhausted window holds, and a window at 100 percent used is exhausted
# without the provider's flag. A read with every window partly used is open. A read
# with several exhausted windows holds on the window with the latest provider reset,
# and an exhausted window without a reported reset is the held window. The
# usage-windows answer reports the gate's hold, the reads newest first and the
# refusal evidence. usage-window-refresh with no usage-read helper records an
# unreadable read and the hold stays.
#
# usage: usage-windows-store DB
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/usage-windows.bend as UW
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
    case UW.GateUnknown{source,reason,receipt}: "unknown"

def gate_window(gate: UW.Gate) -> String:
  match gate:
    case UW.GateHeld{window,resets_at,source,receipt}: window ++ "|" ++ resets_at
    case other: ""

def expect_state(+db: String, +session: String, +account: String, +expected: String, +label: String) -> IO(Unit):
  do IO<Unit>:
    gate : UW.Gate <- UW.window_state(db,session,account)
    expect(label,String.eq(gate_class(gate),expected))

def expect_window(+db: String, +session: String, +account: String, +expected: String, +label: String) -> IO(Unit):
  do IO<Unit>:
    gate : UW.Gate <- UW.window_state(db,session,account)
    expect(label,String.eq(gate_window(gate),expected))

def now_plus(+ms: String) -> String:
  "CAST(strftime('%s','now') AS INTEGER)*1000+" ++ ms

def window_sql(+name: String, +percent: String, +resets: String, +exhausted: String) -> String:
  "json_object('window'," ++ C.q(name) ++ ",'usedPercent'," ++ percent ++ ",'resetsAt'," ++ resets ++ ",'exhausted',json(" ++ C.q(exhausted) ++ "))"

# One readable live read for a provider and account; windows is a SQL json_array.
def read_row_sql(+provider: String, +account: String, +windows: String) -> String:
  "INSERT INTO usage_reads(observed_at,provider,account,session,trigger,state,source,reason,document) VALUES(" ++ now_plus("0") ++ "," ++ C.q(provider) ++ "," ++ C.q(account) ++ ",'','fixture','read','fixture',''," ++ "json_object('schema','baton2-usage-read-v1','provider'," ++ C.q(provider) ++ ",'source','fixture','observedAt',1,'state','read','windows'," ++ windows ++ "));"

def kimi_cause() -> String:
  "provider-reported usage exhaustion: You've reached your 5-hour usage limit. Your quota will reset when the current 5-hour window ends."

def zai_cause(+clock: String) -> String:
  "provider-reported usage exhaustion: 429 Usage limit reached for 5 hour. Your limit will reset at " ++ clock ++ " (type=1308)"

def setup(+db: String) -> IO(Unit):
  do IO<Unit>:
    made : Unit <- query(db,C.schema())
    sessions : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES('root',NULL,'omp','','','',''),('kimi','root','omp','kimi-code/kimi-for-coding','high','',''),('zai','root','omp','zai/glm-5.3','high','',''),('claude','root','claude-code','claude-opus-4','high','','');")
    IO.pure(Unit,Unit{})

def evidence_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    +clock : String <- read(db,"SELECT strftime('%Y-%m-%d %H:%M:%S','now','+10 hours');")
    kimi : Unit <- UW.record_cause(db,"kimi","m-kimi","acct-k",kimi_cause())
    zai : Unit <- UW.record_cause(db,"zai","m-zai","acct-z",zai_cause(Tx.trim_nl(clock)))
    weekly : Unit <- UW.record_cause(db,"claude","m-week","acct-c","provider-reported usage exhaustion: You've hit your weekly limit")
    monthly : Unit <- UW.record_cause(db,"claude","m-month","acct-c","provider-reported usage exhaustion: usage limit reached for monthly billing cycle")
    unnamed : Unit <- UW.record_cause(db,"claude","m-other","acct-c","provider-reported usage exhaustion: rate limit exceeded")
    rows : Unit <- expect_read(db,"SELECT group_concat(row,',') FROM (SELECT message||':'||provider||':'||account||':'||window||':'||coalesce(CAST(resets_at AS TEXT),'null')||':'||reset_source AS row FROM usage_windows ORDER BY id);","m-kimi:kimi-code:acct-k:5-hour:null:provider-message,m-zai:zai:acct-z:5-hour:null:provider-message,m-week::acct-c:7-day:null:provider-message,m-month::acct-c:monthly:null:provider-message,m-other::acct-c::null:provider-message\n","refusal-evidence-keeps-window-and-no-reset")
    kimi_open : Unit <- expect_state(db,"kimi","acct-k","none","kimi-refusal-text-does-not-hold")
    zai_open : Unit <- expect_state(db,"zai","acct-z","none","zai-refusal-reset-clock-does-not-hold")
    expect_read(db,"SELECT count(*) FROM usage_reads;","0\n","refusal-evidence-records-no-read")

def hold_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    +reset : String <- read(db,"SELECT CAST(" ++ now_plus("3600000") ++ " AS TEXT);")
    multi : Unit <- query(db,read_row_sql("kimi-code","acct-k","json_array(" ++ window_sql("5-hour","100",Tx.trim_nl(reset),"true") ++ "," ++ window_sql("7-day","50",now_plus("86400000"),"false") ++ "," ++ window_sql("monthly","20",now_plus("172800000"),"false") ++ ")"))
    held : Unit <- expect_state(db,"kimi","acct-k","held","exhausted-window-holds")
    window : Unit <- expect_window(db,"kimi","acct-k","5-hour|" ++ Tx.trim_nl(reset),"held-window-and-provider-reset")
    percent : Unit <- query(db,read_row_sql("zai","acct-z","json_array(" ++ window_sql("5-hour","100",now_plus("3600000"),"false") ++ ")"))
    used : Unit <- expect_state(db,"zai","acct-z","held","used-100-percent-holds-without-flag")
    partial : Unit <- query(db,read_row_sql("claude","acct-c","json_array(" ++ window_sql("5-hour","42",now_plus("3600000"),"false") ++ "," ++ window_sql("7-day","90",now_plus("86400000"),"false") ++ ")"))
    open : Unit <- expect_state(db,"claude","acct-c","none","partial-read-open")
    +later : String <- read(db,"SELECT CAST(" ++ now_plus("86400000") ++ " AS TEXT);")
    two : Unit <- query(db,read_row_sql("kimi-code","acct-two","json_array(" ++ window_sql("5-hour","100",now_plus("3600000"),"true") ++ "," ++ window_sql("7-day","100",Tx.trim_nl(later),"true") ++ ")"))
    latest : Unit <- expect_window(db,"kimi","acct-two","7-day|" ++ Tx.trim_nl(later),"two-exhausted-windows-hold-to-the-later-reset")
    unreported : Unit <- query(db,read_row_sql("kimi-code","acct-null","json_array(" ++ window_sql("5-hour","100",now_plus("3600000"),"true") ++ "," ++ window_sql("monthly","NULL","NULL","true") ++ ")"))
    expect_window(db,"kimi","acct-null","monthly|","window-without-reset-is-the-held-window")

def answer_field(+answer: String, +path: String) -> String:
  "SELECT json_extract(" ++ C.q(answer) ++ "," ++ C.q(path) ++ ");"

def query_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    gate : UW.Gate <- UW.window_state(db,"kimi","acct-k")
    +text : String <- read(db,UW.query_answer_sql("kimi","kimi-code","acct-k",UW.hold_name(gate)))
    +answer : String <- IO.pure(String,Tx.trim_nl(text))
    schema : Unit <- expect_read(db,answer_field(answer,"$.schema"),"baton2-usage-windows-v2\n","answer-schema")
    scope : Unit <- expect_read(db,"SELECT json_extract(" ++ C.q(answer) ++ ",'$.provider')||'|'||json_extract(" ++ C.q(answer) ++ ",'$.account');","kimi-code|acct-k\n","answer-provider-and-account")
    hold : Unit <- expect_read(db,answer_field(answer,"$.hold"),"held\n","answer-hold-matches-gate")
    reads : Unit <- expect_read(db,"SELECT json_array_length(" ++ C.q(answer) ++ ",'$.reads')||'|'||json_extract(" ++ C.q(answer) ++ ",'$.reads[0].state')||'|'||json_extract(" ++ C.q(answer) ++ ",'$.reads[0].windows[0].window');","1|read|5-hour\n","answer-lists-the-read")
    expect_read(db,"SELECT json_array_length(" ++ C.q(answer) ++ ",'$.refusals')||'|'||json_extract(" ++ C.q(answer) ++ ",'$.refusals[0].window')||'|'||json_extract(" ++ C.q(answer) ++ ",'$.refusals[0].source')||'|'||json_extract(" ++ C.q(answer) ++ ",'$.refusals[0].message');","1|5-hour|provider-message|m-kimi\n","answer-lists-refusal-evidence")

def refresh_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    refreshed : Unit <- UW.refresh_with(db,"kimi","acct-k","")
    recorded : Unit <- expect_read(db,"SELECT provider||'|'||account||'|'||session||'|'||trigger||'|'||state||'|'||reason FROM usage_reads ORDER BY id DESC LIMIT 1;","kimi-code|acct-k|kimi|usage-window-refresh|unreadable|no usage-read helper is installed beside the runtime identity helper\n","refresh-without-helper-records-unreadable-read")
    expect_state(db,"kimi","acct-k","held","unreadable-refresh-keeps-hold")

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case +path <> Nil{}: do IO<Unit>:
      ready : Unit <- setup(path)
      evidence : Unit <- evidence_cases(path)
      holds : Unit <- hold_cases(path)
      answers : Unit <- query_cases(path)
      refreshed : Unit <- refresh_cases(path)
      IO.print("fixture-windows-store-ok")
    case other: IO.die(Unit,2,"usage: usage-windows-store DB")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
