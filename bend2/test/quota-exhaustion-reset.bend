# Focused fixture for #907: provider hard-quota terminals are classified from
# the structured terminal, the provider reset is recorded against the account
# in force, and the gate keeps the owed input held before that reset. The
# fixture drives the real classification, reset extraction, usage-window store,
# gate, held report and account handoff over a temporary database. It records
# two attempts in one exhaustion episode and proves the second is still held,
# so no retry is admitted before the known reset.
#
# usage: quota-exhaustion-reset DB
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/subscription-fallback.bend as Subs
import ../src/coordinator/usage-windows.bend as UW
import ../src/coordinator/accounts.bend as Accounts
import ../src/host/sqlite.bend as DB
import ../src/host/text.bend as Text
import ../src/git/text.bend as Tx

def expect(+label: String, is_ok: Bool) -> IO(Unit):
  Bool.pick(IO(Unit),is_ok,IO.print("quota-reset " ++ label ++ ": ok"),IO.die(Unit,1,"quota-reset " ++ label ++ ": refused"))

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

def muse_reason() -> String:
  "context compaction failed at the hard threshold; summarizer API 429; Subscription quota exhausted. Your usage window resets at 2026-10-19T06:38:50Z."

def future_reason() -> String:
  "context compaction failed at the hard threshold; summarizer API 429; Subscription quota exhausted. Your usage window resets at 2999-01-01T00:00:00Z."

def muse_frame() -> String:
  "{\"payload_type\":\"run.terminal.failed\",\"payload\":{\"kind\":\"run_terminal\",\"terminal\":\"failed\",\"reason\":\"" ++ muse_reason() ++ "\"}}"

def future_frame() -> String:
  "{\"payload_type\":\"run.terminal.failed\",\"payload\":{\"kind\":\"run_terminal\",\"terminal\":\"failed\",\"reason\":\"" ++ future_reason() ++ "\"}}"

def compaction_without_quota() -> String:
  "{\"payload_type\":\"run.terminal.failed\",\"payload\":{\"kind\":\"run_terminal\",\"terminal\":\"failed\",\"reason\":\"context compaction failed at the hard threshold; summarizer API 429\"}}"

def completed_frame() -> String:
  "{\"payload_type\":\"run.terminal.completed\",\"payload\":{\"kind\":\"run_terminal\",\"terminal\":\"completed\",\"reason\":\"Subscription quota exhausted.\"}}"

def glm_frame() -> String:
  "{\"type\":\"turn.failed\",\"error\":{\"message\":\"provider error 1310: Weekly/Monthly Limit Exhausted. Limit resets at 2026-10-21T05:11:25\"}}"

def kimi_frame() -> String:
  "{\"type\":\"turn.failed\",\"error\":{\"message\":\"You've reached your 5-hour usage limit. Your quota will reset when the current 5-hour window ends.\"}}"

def setup(+db: String) -> IO(Unit):
  do IO<Unit>:
    made : Unit <- query(db,C.schema())
    sessions : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES"
      ++ "('muse',NULL,'muse','muse/muse-wonder-1.0','high','native-muse',''),"
      ++ "('gate',NULL,'muse','muse/muse-wonder-1.0','high','',''),"
      ++ "('bound',NULL,'muse','muse/muse-wonder-1.0','high','native-bound',''),"
      ++ "('elapsed',NULL,'muse','muse/muse-wonder-1.0','high','',''),"
      ++ "('fallback',NULL,'omp','omp/gpt-5','high','native-fallback','');")
    ready : Unit <- Accounts.ensure(db)
    accounts : Unit <- query(db,"INSERT INTO accounts(id,provider,harness,funding,secret_ref,organization,verified_at) VALUES"
      ++ "('acct-a','muse','muse','subscription','/fixture/store-a','',''),"
      ++ "('acct-b','omp','omp','subscription','/fixture/store-b','',''),"
      ++ "('acct-d','omp','omp','subscription','/fixture/store-d','','');")
    IO.pure(Unit,Unit{})

def classification_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    +cause : String <- Subs.exhaustion_cause(db,muse_frame())
    expect("muse-hard-quota-classified",Bool.and(Bool.not(String.is_empty(cause)),String.contains(cause,"provider-reported usage exhaustion: ")))
    expect("muse-reason-retained",String.contains(cause,muse_reason()))
    other : String <- Subs.exhaustion_cause(db,compaction_without_quota())
    expect("compaction-without-quota-not-exhaustion",String.is_empty(other))
    completed : String <- Subs.exhaustion_cause(db,completed_frame())
    expect("completed-quota-words-not-failure",String.is_empty(completed))
    glm : String <- Subs.exhaustion_cause(db,glm_frame())
    expect("glm-limit-exhausted-classified",String.contains(glm,"provider-reported usage exhaustion: "))
    kimi : String <- Subs.exhaustion_cause(db,kimi_frame())
    expect("kimi-window-wording-still-classified",String.contains(kimi,"provider-reported usage exhaustion: "))
    IO.pure(Unit,Unit{})

def reset_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    +muse_reset : String = UW.reset_text_of(muse_reason())
    expect("muse-reset-extracted",String.eq(muse_reset,"2026-10-19T06:38:50Z"))
    trailing : String <- IO.pure(String,UW.reset_text_of("Subscription quota exhausted. Your usage window resets at 2026-10-12T23:25:59Z. (rate_limit_error)"))
    expect("sentence-period-after-reset",String.eq(trailing,"2026-10-12T23:25:59Z"))
    glm_reset : String <- IO.pure(String,UW.reset_text_of("provider error 1310: Weekly/Monthly Limit Exhausted. Limit resets at 2026-10-21T05:11:25"))
    expect("glm-reset-extracted",String.eq(glm_reset,"2026-10-21T05:11:25"))
    unknown_window : String <- IO.pure(String,UW.window_label_of(UW.lower_ascii(muse_reason())))
    expect("muse-window-unknown",String.eq(unknown_window,""))
    five_hour : String <- IO.pure(String,UW.window_label_of(UW.lower_ascii("Subscription quota exhausted for the 5-hour window. Your usage window resets at 2026-10-19T06:38:50Z.")))
    expect("five-hour-window-named",String.eq(five_hour,"5-hour"))
    parsed : String <- IO.pure(String,UW.parsed_reset_sql(muse_reset))
    expect("recorded-reset-parses",Tx.starts_with(parsed,"(SELECT CAST(strftime('%s','2026-10-19T06:38:50Z')"))
    IO.pure(Unit,Unit{})

def held_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    first : Unit <- UW.record_cause(db,"gate","attempt-1","acct-a",future_reason())
    second : Unit <- UW.record_cause(db,"gate","attempt-2","acct-a",future_reason())
    future : String <- read(db,"SELECT CASE WHEN resets_at > CAST(strftime('%s','now') AS INTEGER)*1000 THEN '1' ELSE '0' END FROM usage_windows WHERE message='attempt-1';")
    expect("recorded-reset-is-future",String.eq(future,"1\n"))
    provider_rows : String <- read(db,"SELECT count(*) FROM usage_windows WHERE reset_source='provider-message' AND account='acct-a';")
    expect("two-attempts-recorded",String.eq(provider_rows,"2\n"))
    +held : UW.Gate <- UW.window_gate(db,"gate","acct-a")
    expect("future-reset-holds",String.eq(gate_class(held),"held"))
    reported : Unit <- UW.report_held(db,"gate","message-1",held)
    replayed : Unit <- UW.report_held(db,"gate","message-1",held)
    reports : String <- read(db,"SELECT count(*) FROM messages WHERE id='message-1:usage-window-held';")
    expect("one-held-report-per-message",String.eq(reports,"1\n"))
    after : UW.Gate <- UW.window_gate(db,"gate","acct-a")
    expect("second-attempt-still-held",String.eq(gate_class(after),"held"))
    IO.pure(Unit,Unit{})

def elapsed_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    reason : String <- IO.pure(String,"Subscription quota exhausted for the 5-hour window. Your usage window resets at 2026-10-19T06:38:50Z.")
    recorded : Unit <- UW.record_cause(db,"elapsed","attempt-e","acct-b",reason)
    observed : Unit <- UW.observe(db,"elapsed","5-hour","2020-01-01T00:00:00Z","fixture observation","acct-b")
    gate : UW.Gate <- UW.window_gate(db,"elapsed","acct-b")
    expect("elapsed-reset-admits",String.eq(gate_class(gate),"elapsed"))
    IO.pure(Unit,Unit{})

def handoff_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    path : String <- IO.try(String,DB.Sql.query(db,Accounts.account_record_sql(db,"bound")))
    appended : Result<&1,&1,U32 & String,Unit> <- Text.Text.append(Tx.trim_nl(path),"acct-a\n")
    advanced : Bool <- Accounts.handoff(db,"bound","attempt-bound",future_frame(),"native-bound","muse","/tmp")
    expect("last-account-does-not-advance",Bool.not(advanced))
    label : String <- Accounts.handoff_label_io(db,"bound")
    expect("gate-label-is-bound-account",String.eq(label,"acct-a"))
    expect_read(db,"SELECT account FROM usage_windows WHERE message='attempt-bound';","acct-a\n","handoff-records-refused-account")
    expect_read(db,"SELECT CASE WHEN resets_at = CAST(strftime('%s','2999-01-01T00:00:00Z') AS INTEGER)*1000 THEN '1' ELSE '0' END FROM usage_windows WHERE message='attempt-bound';","1\n","handoff-records-provider-reset")
    held : UW.Gate <- UW.window_gate(db,"bound","acct-a")
    expect("handoff-window-holds",String.eq(gate_class(held),"held"))
    IO.pure(Unit,Unit{})

def fallback_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    path : String <- IO.try(String,DB.Sql.query(db,Accounts.account_record_sql(db,"fallback")))
    appended : Result<&1,&1,U32 & String,Unit> <- Text.Text.append(Tx.trim_nl(path),"acct-b\n")
    advanced : Bool <- Accounts.handoff(db,"fallback","attempt-fallback",future_frame(),"native-fallback","omp","/tmp")
    expect("distinct-fallback-advances",advanced)
    label : String <- Accounts.handoff_label_io(db,"fallback")
    expect("distinct-fallback-rebinds",String.eq(label,"acct-d"))
    gate : UW.Gate <- UW.window_gate(db,"fallback","acct-d")
    expect("healthy-fallback-not-held",String.eq(gate_class(gate),"none"))
    expect_read(db,"SELECT account FROM usage_windows WHERE message='attempt-fallback';","acct-b\n","refused-account-scopes-the-window")
    IO.pure(Unit,Unit{})

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case +path <> Nil{}: do IO<Unit>:
      setup(path)
      classification_cases(path)
      reset_cases(path)
      held_cases(path)
      elapsed_cases(path)
      handoff_cases(path)
      fallback_cases(path)
      IO.print("quota-exhaustion-reset-ok")
    case other: IO.die(Unit,2,"usage: quota-exhaustion-reset DB")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
