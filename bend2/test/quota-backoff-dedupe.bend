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
    operator : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES('operator',NULL,'operator','','','','');")
    wonder : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint,workspace,branch,base) VALUES('wonder',NULL,'muse','muse-wonder-1.0','high','01a1549a-4b05-78c1-982a-ebda86e8b067','','/wonder','wonder-branch','base-sha');")
    attempt_accounts : Unit <- query(db,"INSERT INTO account_attempts(attempt,session,turn,account,funding,secret_ref) VALUES('attempt-one','wonder','attempt-one','acct-a','subscription','/profiles/a'),('attempt-two','wonder','attempt-two','acct-a','subscription','/profiles/a'),('attempt-account','wonder','attempt-account','acct-b','subscription','/profiles/b');")
    wonder2 : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint,workspace,branch,base) VALUES('wonder2',NULL,'muse','muse-wonder-1.0','high','01a1549a-4b05-78c1-982a-ebda86e8b068','','/wonder2','wonder2-branch','base-sha');")
    wonder_first : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint,workspace,branch,base) VALUES('wonder-first',NULL,'muse-first','muse-wonder-1.0','high','01a1549a-4b05-78c1-982a-ebda86e8b069','','/wonder-first','wonder-first-branch','base-sha');")
    wonder_gate : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint,workspace,branch,base) VALUES('wonder-gate',NULL,'muse','muse-wonder-1.0','high','01a1549a-4b05-78c1-982a-ebda86e8b070','','/wonder-gate','wonder-gate-branch','base-sha');")
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
    second_session : Bool <- Subs.report_all_refused(db,"wonder2","attempt-w2","muse","",second_cause)
    cross_count : Unit <- expect_read(db,"SELECT count(*) FROM messages WHERE id LIKE '%:profile-exhausted';","2\n","cross-session-profile-not-suppressed")
    cross_distinct : Unit <- expect_read(db,"SELECT count(DISTINCT id) FROM messages WHERE id LIKE '%:profile-exhausted';","2\n","cross-session-profile-ids-distinct")
    +exit_w2 : String <- Subs.exit_report_id(db,"wonder2","attempt-w2",quota_event("second-request"))
    expect("cross-session-exit-id",Bool.not(String.eq(exit_one,exit_w2)))
    IO.pure(Unit,Unit{})
