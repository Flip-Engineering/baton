# Focused fixture for the account DB regression: an unqualified Muse model
# records provider='', window='' and account='', and every incoming report woke
# the session into another exhausted attempt. The fixture reproduces that
# durable shape, then proves the gate holds across repeated wake checks, the
# empty-window reset observation is supported, repeated refusal reports share
# one durable identity, and clear-only preserves native identity, owed input and
# the quota hold. It also proves cross-session report separation, the first-attempt
# exit identity before its usage row, and the handoff/direct-start gate.
#
# usage: quota-backoff-dedupe DB
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/accounts.bend as Accounts
import ../src/coordinator/stop.bend as Stop
import ../src/coordinator/subscription-fallback.bend as Subs
import ../src/coordinator/turn.bend as Turn
import ../src/coordinator/usage-windows.bend as UW
import ../src/host/sqlite.bend as DB
import ../src/host/instance.bend as Custody
import ../src/host/text.bend as Text
import ../src/git/text.bend as Tx

def expect(+label: String, is_ok: Bool) -> IO(Unit):
  Bool.pick(IO(Unit),is_ok,IO.print("fixture-quota-backoff " ++ label ++ ": ok"),IO.die(Unit,1,"fixture-quota-backoff " ++ label ++ ": refused"))

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

def messages_state_sql(session: String) -> String:
  "SELECT group_concat(id || ':' || kind || ':' || body || ':' || coalesce(receipt,'-'),'|') FROM (SELECT id,kind,body,receipt FROM messages WHERE recipient="
  ++ C.q(session) ++ " ORDER BY seq);"

def cause(ident: String) -> String:
  "provider-reported usage exhaustion: API error 429 [request_id=" ++ ident ++ "]: Subscription quota exhausted. Your usage window resets at 2026-10-26T00:00:00Z. (rate_limit_error)"

def quota_event(ident: String) -> String:
  "{\"payload_type\":\"run.terminal.failed\",\"payload\":{\"kind\":\"run_terminal\",\"terminal\":\"failed\",\"reason\":\"" ++ cause(ident) ++ "\"}}"

def quota_event_window(ident: String, window: String) -> String:
  "{\"payload_type\":\"run.terminal.failed\",\"payload\":{\"kind\":\"run_terminal\",\"terminal\":\"failed\",\"reason\":\"" ++ cause(ident) ++ " " ++ window ++ "\"}}"

def setup(+db: String) -> IO(Unit):
  do IO<Unit>:
    made : String <- IO.try(String,DB.Sql.query(db,C.schema() ++ Accounts.schema()))
    account_rows : Unit <- query(db,"INSERT INTO accounts(id,provider,harness,funding,secret_ref) VALUES('acct-a','muse','muse','subscription','/profiles/a'),('acct-b','muse','muse','subscription','/profiles/b');")
    fallback_accounts : Unit <- query(db,"INSERT INTO accounts(id,provider,harness,funding,secret_ref) VALUES('route-a','kimi-code','omp','subscription','/profiles/route-a'),('route-b','kimi-code','omp','subscription','/profiles/route-b'),('route-c','kimi-code','omp','subscription','/profiles/route-c');")
    operator : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES('operator',NULL,'operator','','','','');")
    wonder : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint,workspace,branch,base) VALUES('wonder',NULL,'muse','muse-wonder-1.0','high','01a1549a-4b05-78c1-982a-ebda86e8b067','','/wonder','wonder-branch','base-sha');")
    attempt_accounts : Unit <- query(db,"INSERT INTO account_attempts(attempt,session,turn,account,funding,secret_ref) VALUES('attempt-one','wonder','attempt-one','acct-a','subscription','/profiles/a'),('attempt-two','wonder','attempt-two','acct-a','subscription','/profiles/a'),('attempt-account','wonder','attempt-account','acct-b','subscription','/profiles/b');")
    wonder2 : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint,workspace,branch,base) VALUES('wonder2',NULL,'muse','muse-wonder-1.0','high','01a1549a-4b05-78c1-982a-ebda86e8b068','','/wonder2','wonder2-branch','base-sha');")
    wonder_first : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint,workspace,branch,base) VALUES('wonder-first',NULL,'muse-first','muse-wonder-1.0','high','01a1549a-4b05-78c1-982a-ebda86e8b069','','/wonder-first','wonder-first-branch','base-sha');")
    wonder_gate : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint,workspace,branch,base) VALUES('wonder-gate',NULL,'muse','muse-wonder-1.0','high','01a1549a-4b05-78c1-982a-ebda86e8b070','','/wonder-gate','wonder-gate-branch','base-sha');")
    fallback_sessions : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES('route-forward',NULL,'omp','kimi-code/kimi-for-coding','high','native-forward',''),('route-all-held',NULL,'omp','kimi-code/kimi-for-coding','high','native-all-held','');")
    roles : Unit <- query(db,"INSERT INTO session_roles(session,role) VALUES('operator','operator'),('wonder','conductor'),('wonder2','conductor'),('wonder-first','conductor'),('wonder-gate','conductor');")
    attempt : Unit <- query(db,"INSERT INTO executions(session,id,mode,directory,phase,status) VALUES('wonder','attempt-prod','retained','/wonder','exited','exit 1');")
    stop : Unit <- query(db,"INSERT INTO session_stops(session,id,reason,attempt,directory,signal,applied_signal,outcome,native_status,report_id) VALUES('wonder','stop-prod','provider exhaustion retained','attempt-prod','/wonder',15,15,'stopped','exit 1','stop-result:stop-prod');")
    task : Unit <- query(db,"INSERT INTO messages(id,sender,recipient,kind,body) VALUES('task-1','operator','wonder','task','Retained task.');")
    guidance : Unit <- query(db,"INSERT INTO messages(id,sender,recipient,kind,body) VALUES('guidance-1','operator','wonder','guidance','Retained guidance.');")
    report : Unit <- query(db,"INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES('report-1','wonder','operator','report','Prior report.','operator-received');")
    first : Unit <- query(db,"INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) VALUES(1792430349000,'muse','muse-wonder-1.0','','','',1792972800000,'provider-message',NULL,'attempt one','receive:wonder:1');")
    second : Unit <- query(db,"INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) VALUES(1792430367000,'muse','muse-wonder-1.0','','','',1792972800000,'provider-message',NULL,'attempt two','receive:wonder:2');")
    third : Unit <- query(db,"INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) VALUES(1792430388000,'muse','muse-wonder-1.0','','','',1792972800000,'provider-message',NULL,'attempt three','receive:wonder:3');")
    IO.pure(Unit,Unit{})

# A refuses, B has an actual current provider hold, and C has a partial usage
# report. Handoff must reach C. When C also refuses, all remaining holds keep
# the all-accounts-exhausted report and cross-harness route selection available.
def account_fallback_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    bound : Unit <- Accounts.bind(db,"route-a","route-forward")
    held_b : Unit <- UW.record_cause(db,"route-forward","route-b-refusal","route-b",cause("route-b-request"))
    partial_c : Unit <- query(db,"INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) VALUES(CAST(strftime('%s','now') AS INTEGER)*1000,'omp','kimi-code/kimi-for-coding','kimi-code','route-c','',32472144000000,'provider-report',0.4,'partial provider usage','partial-c');")
    advanced : Bool <- Accounts.handoff(db,"route-forward","route-a-refusal",quota_event("route-a-request"),"native-forward","","/route-forward")
    expect("handoff-skips-held-account",advanced)
    +chosen : String <- Accounts.handoff_label_io(db,"route-forward")
    expect("handoff-reaches-partially-used-account",String.eq(chosen,"route-c"))
    +path : String <- Accounts.account_sidecar(db,"route-forward")
    +binding : String <- Accounts.file_text(Tx.trim_nl(path))
    expect("held-account-never-bound",String.eq(binding,"route-a\nroute-c\n"))
    held_stays : Unit <- expect_gate(db,"route-forward","route-b","held","skipped-account-hold-preserved")
    bound_again : Unit <- Accounts.bind(db,"route-a","route-all-held")
    held_c : Unit <- UW.record_cause(db,"route-all-held","route-c-refusal","route-c",cause("route-c-request"))
    exhausted : Bool <- Accounts.handoff(db,"route-all-held","all-held-a-refusal",quota_event("all-held-a-request"),"native-all-held","","/route-all-held")
    expect("all-held-accounts-do-not-continue",Bool.not(exhausted))
    +unchanged : String <- Accounts.handoff_label_io(db,"route-all-held")
    expect("all-held-preserves-original-binding",String.eq(unchanged,"route-a"))
    triggered : Bool <- Subs.route_trigger(db,"route-all-held","all-held-a-refusal",quota_event("all-held-a-request"))
    expect("all-held-retains-alternate-route-trigger",triggered)
    +routes_path : String <- Subs.route_list_path(db)
    configured : Unit <- IO.try(Unit,Text.Text.append(routes_path,"omp kimi-code/kimi-for-coding /not-executed/current\ncodex gpt-6 /not-executed/codex\n"))
    selected : Maybe<&2,Subs.Route> <- Subs.select_route(db,"route-all-held","all-held-a-refusal")
    match selected:
      case None{}: IO.die(Unit,1,"fixture-quota-backoff alternate route was not selected")
      case Some{route}: expect("all-held-selects-configured-alternate-route",String.eq(Subs.route_harness(route),"codex"))
    expect_read(db,"SELECT count(*) FROM executions WHERE session IN ('route-forward','route-all-held');","0\n","account-selection-starts-no-execution")

def gate_attempts(+db: String, +session: String, +account: String, attempts: List<String>) -> IO(Unit):
  match attempts:
    case Nil{}: IO.pure(Unit,Unit{})
    case attempt <> rest: do IO<Unit>:
      expect_gate(db,session,account,"held","repeated-attempt-" ++ attempt)
      gate_attempts(db,session,account,rest)

def gate_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    held : Unit <- expect_gate(db,"wonder","","held","unqualified-provider-message-holds")
    repeated : Unit <- gate_attempts(db,"wonder","",["184737","184742","184753","184759","184765","184771"])
    executions : Unit <- expect_read(db,"SELECT count(*) FROM executions WHERE session='wonder';","1\n","gate-creates-no-execution")
    provider_rows : Unit <- expect_read(db,"SELECT count(*) FROM usage_windows WHERE reset_source='provider-message' AND account='' AND harness='muse';","3\n","provider-exhaustion-durable")
    IO.pure(Unit,Unit{})

def dedupe_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    +first_cause : String = cause("first-request")
    +second_cause : String = cause("second-request")
    profile_usage_one : Unit <- UW.record_cause(db,"wonder","attempt-one","acct-a",first_cause)
    profile_usage_two : Unit <- UW.record_cause(db,"wonder","attempt-two","acct-a",second_cause)
    first_profile : Bool <- Subs.report_all_refused(db,"wonder","attempt-one","muse","",first_cause)
    second_profile : Bool <- Subs.report_all_refused(db,"wonder","attempt-two","muse","",second_cause)
    profile_count : Unit <- expect_read(db,"SELECT count(*) FROM messages WHERE id LIKE '%:profile-exhausted';","1\n","profile-exhausted-deduped")
    +profile_body : String <- read(db,"SELECT body FROM messages WHERE id LIKE '%:profile-exhausted';")
    expect("profile-first-evidence",Bool.and(String.contains(profile_body,first_cause),Bool.not(String.contains(profile_body,second_cause))))
    first_route : Unit <- Subs.report_route_unavailable(db,"wonder","attempt-one","muse",first_cause)
    second_route : Unit <- Subs.report_route_unavailable(db,"wonder","attempt-two","muse",second_cause)
    route_count : Unit <- expect_read(db,"SELECT count(*) FROM messages WHERE id LIKE '%:route-unavailable';","1\n","route-unavailable-deduped")
    +route_body : String <- read(db,"SELECT body FROM messages WHERE id LIKE '%:route-unavailable';")
    expect("route-first-evidence",Bool.and(String.contains(route_body,first_cause),Bool.not(String.contains(route_body,second_cause))))
    +exit_one : String <- Subs.exit_report_id(db,"wonder","attempt-one",quota_event_window("first-request","5-hour"))
    +exit_two : String <- Subs.exit_report_id(db,"wonder","attempt-two",quota_event_window("second-request","5-hour"))
    expect("exit-id-shared",String.eq(exit_one,exit_two))
    expect("exit-id-kind",String.ends_with(exit_one,":exit"))
    +exit_week : String <- Subs.exit_report_id(db,"wonder","attempt-one",quota_event_window("same-request","7-day"))
    expect("exit-window-scope",Bool.not(String.eq(exit_one,exit_week)))
    +exit_other_account : String <- Subs.exit_report_id(db,"wonder","attempt-account",quota_event("same-request"))
    expect("exit-account-scope",Bool.not(String.eq(exit_one,exit_other_account)))
    first_exit : Unit <- Turn.report(db,"wonder",exit_one,"Player process ended with exit 1")
    second_exit : Unit <- Turn.report(db,"wonder",exit_two,"Player process ended with exit 1")
    exit_count : Unit <- expect_read(db,"SELECT count(*) FROM messages WHERE id LIKE '%:exit' AND sender='wonder';","1\n","exit-report-deduped")
    reported : Bool <- Subs.exhausted_reported(db,"wonder","attempt-one")
    expect("exhausted-report-detected",reported)
    account_cause : String <- cause("account-first-request")
    account_usage : Unit <- UW.record_cause(db,"wonder","attempt-account","acct-b",account_cause)
    first_account : Unit <- Subs.report_account_exhausted(db,"wonder","attempt-account","acct-b","accounts exhausted: first provider evidence")
    retry_account_cause : String <- cause("account-retry-request")
    retry_account_usage : Unit <- UW.record_cause(db,"wonder","attempt-account-retry","acct-b",retry_account_cause)
    repeated_account : Unit <- Subs.report_account_exhausted(db,"wonder","attempt-account-retry","acct-b","accounts exhausted: duplicate provider evidence")
    account_count : Unit <- expect_read(db,"SELECT count(*) FROM messages WHERE id LIKE '%:account-exhausted';","1\n","account-exhaustion-deduped-for-same-window")
    +account_body : String <- read(db,"SELECT body FROM messages WHERE id LIKE '%:account-exhausted';")
    expect("account-first-evidence",Bool.and(String.contains(account_body,"first provider evidence"),Bool.not(String.contains(account_body,"duplicate provider evidence"))))
    reported_account : Bool <- Subs.exhausted_reported(db,"wonder","attempt-account")
    expect("account-exhaustion-detected",reported_account)
    other_account_cause : String <- cause("other-account-request")
    other_account_usage : Unit <- UW.record_cause(db,"wonder","attempt-one","acct-a",other_account_cause)
    other_account : Unit <- Subs.report_account_exhausted(db,"wonder","attempt-one","acct-a","accounts exhausted: other account")
    account_scoped : Unit <- expect_read(db,"SELECT count(*) FROM messages WHERE id LIKE '%:account-exhausted';","2\n","account-exhaustion-identity-includes-account")
    account_b_later_cause : String <- cause("account-later-request")
    account_b_later_usage : Unit <- UW.record_cause(db,"wonder","attempt-account-later","acct-b",account_b_later_cause)
    account_b_after_a : Unit <- Subs.report_account_exhausted(db,"wonder","attempt-account-later","acct-b","accounts exhausted: duplicate evidence after another account")
    account_distinct_preserved : Unit <- expect_read(db,"SELECT count(*) FROM messages WHERE id LIKE '%:account-exhausted';","2\n","account-b-report-survives-later-account-observation")
    second_session : Bool <- Subs.report_all_refused(db,"wonder2","attempt-w2","muse","",second_cause)
    cross_count : Unit <- expect_read(db,"SELECT count(*) FROM messages WHERE id LIKE '%:profile-exhausted';","2\n","cross-session-profile-not-suppressed")
    cross_distinct : Unit <- expect_read(db,"SELECT count(DISTINCT id) FROM messages WHERE id LIKE '%:profile-exhausted';","2\n","cross-session-profile-ids-distinct")
    +exit_w2 : String <- Subs.exit_report_id(db,"wonder2","attempt-w2",quota_event("second-request"))
    expect("cross-session-exit-id",Bool.not(String.eq(exit_one,exit_w2)))
    IO.pure(Unit,Unit{})

# The first terminal report is prepared before Accounts.handoff records the
# usage row. Its identity must still match a later report of that refusal.
def first_exit_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    +event : String = quota_event("first-native-request")
    +before : String <- Subs.exit_report_id(db,"wonder-first","first-native",event)
    recorded : Unit <- UW.record_cause(db,"wonder-first","first-native","",cause("first-native-request"))
    +after : String <- Subs.exit_report_id(db,"wonder-first","first-native",event)
    expect("first-exit-id-stable-before-usage-row",String.eq(before,after))

# A refusal with no remaining profile stays retained on its recorded route.
# The direct-start path reads the same provider observation before launch.
def handoff_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    advanced : Bool <- Accounts.handoff(db,"wonder-gate","held-handoff",quota_event("held-request"),"native-gate","","/wonder-gate")
    expect("held-handoff-does-not-continue",Bool.not(advanced))
    gate : UW.Gate <- Turn.direct_window_gate(db,"wonder-gate")
    expect("direct-start-observes-held-window",Turn.direct_gate_held(gate))
    expect("direct-start-retains-provider-cause",String.contains(Turn.direct_gate_refusal(gate),"Provider usage window held"))
    expect_read(db,"SELECT count(*) FROM executions WHERE session='wonder-gate';","0\n","handoff-and-gate-create-no-execution")

def clear_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    +messages_before : String <- read(db,messages_state_sql("wonder"))
    +execution_before : String <- read(db,"SELECT id || ':' || mode || ':' || directory || ':' || phase || ':' || status FROM executions WHERE session='wonder';")
    cleared : Unit <- Stop.clear(db,"wonder")
    gone : Unit <- expect_read(db,"SELECT count(*) FROM session_stops WHERE session='wonder';","0\n","clear-removes-terminal-stop")
    native : Unit <- expect_read(db,"SELECT native || ':' || workspace || ':' || branch || ':' || base FROM sessions WHERE id='wonder';","01a1549a-4b05-78c1-982a-ebda86e8b067:/wonder:wonder-branch:base-sha\n","clear-preserves-native-and-workspace")
    +messages_after : String <- read(db,messages_state_sql("wonder"))
    expect("clear-preserves-owed-input",String.eq(messages_before,messages_after))
    +execution_after : String <- read(db,"SELECT id || ':' || mode || ':' || directory || ':' || phase || ':' || status FROM executions WHERE session='wonder';")
    expect("clear-preserves-execution",String.eq(execution_before,execution_after))
    expect_gate(db,"wonder","","held","clear-preserves-quota-hold")

# Reset observations cover the empty window label carried by the native Muse
# refusal. They preserve provider evidence and create no execution.
def reset_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    +provider_before : String <- read(db,"SELECT count(*) FROM usage_windows WHERE harness='muse' AND provider='' AND account='' AND reset_source='provider-message';")
    +executions_before : String <- read(db,"SELECT count(*) FROM executions;")
    future : Unit <- UW.reset_exhausted(db,"wonder","2999-01-01T00:00:00Z","provider console future reset","")
    held : Unit <- expect_gate(db,"wonder","","held","empty-window-future-reset-held")
    empty : Unit <- expect_read(db,"SELECT count(*) FROM usage_windows WHERE harness='muse' AND provider='' AND account='' AND window='' AND reset_source='operator-observation' AND resets_at IS NOT NULL;","1\n","empty-window-reset-recorded")
    past : Unit <- UW.reset_exhausted(db,"wonder","2020-01-01T00:00:00Z","provider console reset elapsed","")
    elapsed : Unit <- expect_gate(db,"wonder","","elapsed","empty-window-past-reset-selectable")
    +provider_after : String <- read(db,"SELECT count(*) FROM usage_windows WHERE harness='muse' AND provider='' AND account='' AND reset_source='provider-message';")
    expect("reset-retains-provider-evidence",String.eq(provider_before,provider_after))
    +executions_after : String <- read(db,"SELECT count(*) FROM executions;")
    expect("reset-creates-no-execution",String.eq(executions_before,executions_after))

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case "--instance-owner" <> db <> Nil{}: IO.try(Unit,Custody.Instance.owner(db))
    case "--instance-shutdown" <> db <> Nil{}: IO.try(Unit,Custody.Instance.shutdown(db))
    case +path <> Nil{}: do IO<Unit>:
      setup(path)
      gate_cases(path)
      dedupe_cases(path)
      account_fallback_cases(path)
      first_exit_cases(path)
      handoff_cases(path)
      clear_cases(path)
      reset_cases(path)
      IO.print("fixture-quota-backoff-dedupe-ok")
    case other: IO.die(Unit,2,"usage: quota-backoff-dedupe DB")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
