# Focused fixture for the #1025 hold and release core. It drives the real read
# recording, hold decision, announcements and release over a temporary database,
# with HELPER standing in for the usage-read helper. Each account's credential
# reference is file:PATH and the fixture writes the next read document to PATH.
#
# It covers refusal reads, admission reads, unreadable reads, scoped windows,
# observation ordering, account serialization, insert failure, announcement insert
# failure, release launch failure, account changes and provider reset continuations.
#
# usage: usage-live-reads DB HELPER
#        usage-live-reads --case NAME DB HELPER     (one case named in regression)
#        usage-live-reads --wake-message DB MESSAGE   (the release wake records a mark)
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/usage-windows.bend as UW
import ../src/coordinator/usage-reads.bend as UR
import ../src/coordinator/codex-rate-limits.bend as Codex
import ../src/host/sqlite.bend as DB
import ../src/host/session-lock.bend as Lock
import ../src/git/text.bend as Tx
import ../src/git/process.bend as Proc
import ../src/git/types.bend as T

def expect(+label: String, is_ok: Bool) -> IO(Unit):
  Bool.pick(IO(Unit),is_ok,IO.print("fixture-usage-live-reads " ++ label ++ ": ok"),IO.die(Unit,1,"fixture-usage-live-reads " ++ label ++ ": refused"))

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
    case UW.GateHeld{window,resets_at,source,receipt}: "held"
    case UW.GateUnknown{source,reason,receipt}: "unknown"
    case UW.GateNone{}: "none"

def gate_detail(gate: UW.Gate) -> String:
  match gate:
    case UW.GateHeld{window,resets_at,source,receipt}: window ++ "|" ++ resets_at ++ "|" ++ receipt
    case UW.GateUnknown{source,reason,receipt}: reason ++ "|" ++ receipt
    case UW.GateNone{}: ""

def zai_source() -> String:
  "GET https://api.z.ai/api/monitor/usage/quota/limit"

# A z.ai read with the 5-hour window at the given percent and reset.
def zai_doc(+percent: String, +resets: String, +exhausted: String) -> String:
  "{\"schema\":\"baton2-usage-read-v1\",\"provider\":\"zai\",\"source\":\"" ++ zai_source() ++ "\",\"observedAt\":1,\"state\":\"read\",\"windows\":[{\"window\":\"5-hour\",\"usedPercent\":" ++ percent ++ ",\"resetsAt\":" ++ resets ++ ",\"exhausted\":" ++ exhausted ++ "},{\"window\":\"7-day\",\"usedPercent\":20,\"resetsAt\":1793386764984,\"exhausted\":false}]}"

def run_ok(outcome: T.RunRes) -> Bool:
  match outcome:
    case T.RRun{T.SExit{0},out}: True{}
    case _: False{}

def run_text(outcome: T.RunRes) -> String:
  match outcome:
    case T.RRun{status,out}: out
    case T.RSpawn{detail}: detail

def wait_mark(+db: String, +message: String) -> IO(Unit):
  do IO<Unit>:
    ran : Result<&1,&1,U32 & String,String> <- Proc.Process.run(Tx.enc_argv(["/bin/sh","-c","IFS= read -r frame < \"$1\" && [ \"$frame\" = \"$2\" ]","sh",db ++ ".wake-complete",message]),".")
    expect("release-wake-completes",run_ok(Tx.run_res(ran)))

def answer(+path: String, +document: String) -> IO(Unit):
  do IO<Unit>:
    ran : Result<&1,&1,U32 & String,String> <- Proc.Process.run(Tx.enc_argv(["/bin/sh","-c","printf '%s' \"$1\" > \"$2\"","sh",document,path]),".")
    IO.pure(Unit,Unit{})

def setup(+db: String, +answer_path: String) -> IO(Unit):
  do IO<Unit>:
    made : Unit <- query(db,C.schema())
    sessions : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES('root',NULL,'omp','','','',''),('coord','root','omp','','','',''),('a','coord','omp','zai/glm-5.3','high','',''),('b','coord','omp','zai/glm-5.3','high','',''),('k','coord','codex','gpt-6-astra','high','',''),('opus','coord','claude-code','claude-opus-5-5','high','',''),('sonnet','coord','claude-code','claude-sonnet-5-5','high','','');")
    accounts : Unit <- query(db,"CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY NOT NULL,provider TEXT NOT NULL,harness TEXT NOT NULL,funding TEXT NOT NULL,secret_ref TEXT NOT NULL,organization TEXT NOT NULL DEFAULT '',verified_at TEXT NOT NULL DEFAULT '');INSERT INTO accounts(id,provider,harness,funding,secret_ref) VALUES('acct-zai','zai','omp','api_key'," ++ C.q("file:" ++ answer_path) ++ "),('acct-codex','codex','codex','api_key'," ++ C.q("file:" ++ answer_path) ++ "),('acct-claude','claude','claude-code','api_key'," ++ C.q("file:" ++ answer_path) ++ ");")
    owed : Unit <- query(db,"INSERT INTO messages(id,sender,recipient,kind,body) VALUES('m-b','coord','b','guidance','owed input for b');")
    marks : Unit <- query(db,"CREATE TABLE IF NOT EXISTS wake_marks(message TEXT NOT NULL);")
    signal : Result<&1,&1,U32 & String,String> <- Proc.Process.run(Tx.enc_argv(["/usr/bin/mkfifo",db ++ ".wake-complete"]),".")
    ready : Unit <- expect("wake-completion-channel-created",run_ok(Tx.run_res(signal)))
    IO.pure(Unit,Unit{})

def state_of(+db: String, +seat: String, +account: String) -> IO(UW.Gate):
  UW.window_state(db,seat,account)

def open_refusal_case(+db: String, +helper: String, +path: String) -> IO(Unit):
  do IO<Unit>:
    written : Unit <- answer(path,zai_doc("3","1792820715847","false"))
    refused : Unit <- UW.read_refused_with(db,"a","acct-zai","att-1",helper)
    gate : UW.Gate <- state_of(db,"a","acct-zai")
    open : Unit <- expect("refusal-with-open-read-not-held",String.eq(gate_class(gate),"none"))
    recorded : Unit <- expect_read(db,"SELECT state||'|'||trigger||'|'||source FROM usage_reads WHERE id=1;","read|provider-refusal:att-1|" ++ zai_source() ++ "\n","open-read-recorded")
    expect_read(db,"SELECT count(*) FROM messages WHERE id GLOB 'usage-read:*';","0\n","open-read-announces-nothing")

def exhausted_case(+db: String, +helper: String, +path: String, +future: String) -> IO(Unit):
  do IO<Unit>:
    +document : String <- read(db,UR.read_document_sql("zai",zai_source(),"1","SELECT json_array(json_object('window','5-hour','usedPercent',100,'resetsAt',CAST(" ++ C.q(future) ++ " AS INTEGER),'exhausted',json('true')),json_object('window','7-day','usedPercent',40,'resetsAt',1793386764984,'exhausted',json('false')))"))
    written : Unit <- answer(path,Tx.trim_nl(document))
    refused : Unit <- UW.read_refused_with(db,"a","acct-zai","att-2",helper)
    +gate : UW.Gate <- state_of(db,"a","acct-zai")
    held : Unit <- expect("exhausted-read-holds",String.eq(gate_class(gate),"held"))
    detail : Unit <- expect("hold-carries-provider-reset",String.eq(gate_detail(gate),"5-hour|" ++ future ++ "|usage-read:2"))
    sole : Unit <- expect_read(db,"SELECT count(*) FROM usage_reads;","2\n","one-read-per-event")
    orchestrator : Unit <- expect_read(db,"SELECT recipient||'|'||kind FROM messages WHERE id='usage-read:2:hold:a';","coord|report\n","hold-announced-to-orchestrator")
    root : Unit <- expect_read(db,"SELECT recipient FROM messages WHERE id='usage-read:2:hold:a:root';","root\n","hold-announced-to-root")
    body : Unit <- expect_read(db,"SELECT instr(body,'5-hour 100% used') > 0 FROM messages WHERE id='usage-read:2:hold:a';","1\n","hold-body-names-the-read")
    again : UW.Gate <- state_of(db,"a","acct-zai")
    expect_read(db,"SELECT count(*) FROM messages WHERE id GLOB 'usage-read:2:hold:a*';","2\n","repeated-gate-no-second-hold")

def held_input_case(+db: String, +helper: String) -> IO(Unit):
  do IO<Unit>:
    gate : UW.Gate <- UW.window_gate_with(db,"b","acct-zai",helper)
    held : Unit <- expect("input-to-held-seat-still-held",String.eq(gate_class(gate),"held"))
    reread : Unit <- expect_read(db,"SELECT count(*)||'|'||(SELECT trigger||'|'||session FROM usage_reads ORDER BY id DESC LIMIT 1) FROM usage_reads;","3|admission|b\n","held-account-read-at-admission")
    expect_read(db,"SELECT recipient FROM messages WHERE id='usage-read:2:hold:b';","coord\n","second-seat-hold-announced")

def unreadable_held_case(+db: String, +helper: String, +path: String) -> IO(Unit):
  do IO<Unit>:
    written : Unit <- answer(path,UR.unreadable_document("zai",zai_source(),"1","HTTP 503 from the provider"))
    gate : UW.Gate <- UW.window_gate_with(db,"a","acct-zai",helper)
    held : Unit <- expect("unreadable-read-keeps-hold",String.eq(gate_class(gate),"held"))
    reason : Unit <- expect_read(db,"SELECT state||'|'||reason FROM usage_reads WHERE id=4;","unreadable|HTTP 503 from the provider\n","unreadable-reason-recorded")
    expect_read(db,"SELECT recipient FROM messages WHERE id='usage-read:4:unreadable:a';","coord\n","unreadable-announced")

def passed_reset_case(+db: String, +helper: String, +path: String, +past: String, +future: String) -> IO(Unit):
  do IO<Unit>:
    written : Unit <- answer(path,zai_doc("100",past,"true"))
    gate : UW.Gate <- UW.window_gate_with(db,"a","acct-zai",helper)
    held : Unit <- expect("passed-reset-still-exhausted-holds",String.eq(gate_class(gate),"held"))
    recorded : UW.Gate <- state_of(db,"a","acct-zai")
    kept : Unit <- expect("hold-does-not-expire-without-read",String.eq(gate_class(recorded),"held"))
    passed : Unit <- expect_read(db,UW.schedule_delay_sql(past),"\n","passed-reset-has-no-continuation")
    +far_delay : String <- read(db,UW.schedule_delay_sql(future))
    far : Unit <- expect_read(db,"SELECT CAST(" ++ C.q(Tx.trim_nl(far_delay)) ++ " AS INTEGER)>60;","1\n","far-reset-continuation-waits-until-reset")
    unknown : Unit <- expect_read(db,UW.schedule_delay_sql(""),"\n","unreported-reset-has-no-continuation")
    +near : String <- read(db,"SELECT CAST(CAST(strftime('%s','now') AS INTEGER)*1000+10000 AS TEXT);")
    +delay : String <- read(db,UW.schedule_delay_sql(Tx.trim_nl(near)))
    expect_read(db,"SELECT CAST(" ++ C.q(Tx.trim_nl(delay)) ++ " AS INTEGER) BETWEEN 9 AND 11;","1\n","near-reset-continuation-ends-at-reset")

def release_case(+db: String, +helper: String, +path: String) -> IO(Unit):
  do IO<Unit>:
    written : Unit <- answer(path,zai_doc("3","1792820715847","false"))
    gate : UW.Gate <- UW.window_gate_with(db,"a","acct-zai",helper)
    open : Unit <- expect("open-read-releases",String.eq(gate_class(gate),"none"))
    released : Unit <- expect_read(db,"SELECT group_concat(id||'>'||recipient,',') FROM (SELECT id,recipient FROM messages WHERE id GLOB 'usage-read:2:release:*' ORDER BY id);","usage-read:2:release:a>coord,usage-read:2:release:a:root>root,usage-read:2:release:b>coord,usage-read:2:release:b:root>root\n","release-announced-for-each-held-seat")
    waited : Unit <- wait_mark(db,"m-b")
    woke : Unit <- expect_read(db,"SELECT group_concat(message) FROM wake_marks;","m-b\n","other-seat-owed-input-woken")
    b_gate : UW.Gate <- state_of(db,"b","acct-zai")
    b_open : Unit <- expect("released-seat-open",String.eq(gate_class(b_gate),"none"))
    again : UW.Gate <- state_of(db,"a","acct-zai")
    expect_read(db,"SELECT count(*) FROM messages WHERE id GLOB 'usage-read:*:release:*';","4\n","repeated-gate-no-second-release")

def unknown_case(+db: String, +helper: String, +path: String) -> IO(Unit):
  do IO<Unit>:
    written : Unit <- answer(path,UR.unreadable_document("codex","account/rateLimits/read","1","no usage reader for provider codex in this fixture"))
    refused : Unit <- UW.read_refused_with(db,"k","acct-codex","att-k",helper)
    +gate : UW.Gate <- state_of(db,"k","acct-codex")
    unknown : Unit <- expect("unreadable-provider-is-unknown",String.eq(gate_class(gate),"unknown"))
    reason : Unit <- expect("unknown-carries-reason",Tx.starts_with(gate_detail(gate),"no usage reader for provider codex in this fixture|usage-read:"))
    no_hold : Unit <- expect_read(db,"SELECT count(*) FROM messages WHERE id GLOB 'usage-read:*:hold:k*';","0\n","unknown-does-not-hold")
    expect_read(db,"SELECT count(*) FROM messages WHERE id GLOB 'usage-read:*:unreadable:k';","1\n","unknown-announced")

# A window named WINDOW:SCOPE holds only seats whose model contains SCOPE: an exhausted
# Opus weekly window holds the Opus seat and leaves the Sonnet seat on the same account
# open.
def model_scope_case(+db: String, +helper: String, +path: String) -> IO(Unit):
  do IO<Unit>:
    written : Unit <- answer(path,"{\"schema\":\"baton2-usage-read-v1\",\"provider\":\"claude\",\"source\":\"GET https://api.anthropic.com/api/oauth/usage\",\"observedAt\":1,\"state\":\"read\",\"windows\":[{\"window\":\"5-hour\",\"usedPercent\":10,\"resetsAt\":1792820715847,\"exhausted\":false},{\"window\":\"7-day:opus\",\"usedPercent\":100,\"resetsAt\":1793386764984,\"exhausted\":true}]}")
    refused : Unit <- UW.read_refused_with(db,"opus","acct-claude","att-opus",helper)
    +opus : UW.Gate <- state_of(db,"opus","acct-claude")
    held : Unit <- expect("scoped-window-holds-its-model",String.eq(gate_class(opus),"held"))
    named : Unit <- expect("scoped-hold-names-the-window",Tx.starts_with(gate_detail(opus),"7-day:opus|1793386764984|"))
    sonnet : UW.Gate <- state_of(db,"sonnet","acct-claude")
    open : Unit <- expect("scoped-window-leaves-other-model-open",String.eq(gate_class(sonnet),"none"))
    expect_read(db,"SELECT count(*) FROM messages WHERE id GLOB 'usage-read:*:hold:sonnet*';","0\n","other-model-not-announced")

def last_reason(+db: String) -> IO(String):
  do IO<String>:
    +reason : String <- read(db,"SELECT state||'|'||reason FROM usage_reads ORDER BY id DESC LIMIT 1;")
    IO.pure(String,Tx.trim_nl(reason))

def malformed_case(+db: String, +helper: String, +path: String) -> IO(Unit):
  do IO<Unit>:
    written : Unit <- answer(path,"not a document")
    malformed : Unit <- UW.read_refused_with(db,"k","acct-codex","att-m",helper)
    +first : String <- last_reason(db)
    one : Unit <- expect("malformed-answer-unreadable",String.eq(first,"unreadable|the usage-read helper printed no read document"))
    absent : Unit <- UW.read_refused_with(db,"k","acct-codex","att-n","")
    +second : String <- last_reason(db)
    two : Unit <- expect("missing-helper-unreadable",String.eq(second,"unreadable|no usage-read helper is installed beside the runtime identity helper"))
    other : Unit <- answer(path,zai_doc("3","1792820715847","false"))
    mismatch : Unit <- UW.read_refused_with(db,"k","acct-codex","att-o",helper)
    +third : String <- last_reason(db)
    expect("provider-mismatch-unreadable",String.eq(third,"unreadable|the usage-read document is not a baton2-usage-read-v1 read for provider codex"))

# The sample clock is supplied by the reader and may precede insertion order.
def sample(+db: String, +account: String, +observed: String, +exhausted: String) -> IO(Unit):
  do IO<Unit>:
    +doc : String <- read(db,"SELECT json_set(" ++ C.q(zai_doc(Bool.pick(String,String.eq(exhausted,"true"),"100","3"),"null",exhausted)) ++ ",'$.observedAt',CAST(" ++ C.q(observed) ++ " AS INTEGER));")
    UW.record_pair(db,"a","zai",account,"fixture",Tx.trim_nl(doc),"")

def ordering_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    newer : Unit <- sample(db,"clock","200","true")
    older : Unit <- sample(db,"clock","100","false")
    +gate : UW.Gate <- state_of(db,"a","clock")
    held : Unit <- expect("older-open-response-keeps-newer-exhaustion",String.eq(gate_class(gate),"held"))
    clock : Unit <- expect_read(db,"SELECT observed_at FROM usage_reads WHERE account='clock' ORDER BY id;","200\n100\n","reader-observation-clock-recorded")
    opened : Unit <- sample(db,"clock","300","false")
    stale : Unit <- sample(db,"clock","250","true")
    open_gate : UW.Gate <- state_of(db,"a","clock")
    open : Unit <- expect("older-exhaustion-keeps-newer-open",String.eq(gate_class(open_gate),"none"))
    again : Unit <- sample(db,"clock","400","true")
    +episode : UW.Gate <- state_of(db,"a","clock")
    expect("episode-follows-observation-order",String.eq(gate_detail(episode),"5-hour||usage-read:5"))

# Two processes start reads together. The helper records overlapping requests.
def serialization_case(+db: String, +helper: String) -> IO(Unit):
  do IO<Unit>:
    +self : String <- IO.try(String,Lock.SessionLock.executable())
    +dir : String <- IO.pure(String,db ++ ".serial")
    made : Result<&1,&1,U32 & String,String> <- Proc.Process.run(Tx.enc_argv(["/bin/mkdir",dir]),".")
    written : Unit <- answer(dir ++ "/answer",zai_doc("100","null","true"))
    account : Unit <- query(db,"INSERT INTO accounts(id,provider,harness,funding,secret_ref) VALUES('serial','zai','omp','api_key'," ++ C.q("serial:" ++ dir) ++ ");")
    ran : Result<&1,&1,U32 & String,String> <- Proc.Process.run(Tx.enc_argv(["/bin/sh","-c","\"$1\" --read-account \"$2\" \"$3\" serial & first=$!; \"$1\" --read-account \"$2\" \"$3\" serial & second=$!; wait \"$first\"; a=$?; wait \"$second\"; b=$?; [ \"$a$b\" = 00 ] && [ ! -e \"$4/overlap\" ]","sh",self,db,helper,dir]),".")
    clean : Unit <- expect("same-account-requests-serialized",run_ok(Tx.run_res(ran)))
    expect_read(db,"SELECT count(*) FROM usage_reads WHERE account='serial';","2\n","serialized-requests-both-recorded")

def persistence_case(+db: String, +helper: String, +path: String) -> IO(Unit):
  do IO<Unit>:
    old : Unit <- sample(db,"acct-zai","1","false")
    reject : Unit <- query(db,"CREATE TRIGGER reject_read BEFORE INSERT ON usage_reads BEGIN SELECT RAISE(FAIL,'fixture exhausted read insert failed'); END;")
    written : Unit <- answer(path,zai_doc("100","null","true"))
    +self : String <- IO.try(String,Lock.SessionLock.executable())
    ran : Result<&1,&1,U32 & String,String> <- Proc.Process.run(Tx.enc_argv(["/bin/sh","-c","exec \"$@\" 2>&1","sh",self,"--read-account",db,helper,"acct-zai"]),".")
    +outcome : T.RunRes <- IO.pure(T.RunRes,Tx.run_res(ran))
    failed : Unit <- expect("read-insert-failure-propagated",Bool.not(run_ok(outcome)))
    cause : Unit <- expect("read-insert-failure-cause-retained",UW.has_sub("fixture exhausted read insert failed",run_text(outcome)))
    expect_read(db,"SELECT count(*) FROM usage_reads;","1\n","failed-read-keeps-recorded-evidence")

def release_retry_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    held : Unit <- sample(db,"retry","1","true")
    gate : UW.Gate <- state_of(db,"b","retry")
    opened : Unit <- sample(db,"retry","2","false")
    +self : String <- IO.try(String,Lock.SessionLock.executable())
    failed : Unit <- UW.release_open(db,"/missing/usage-release-fixture",db,"b","zai","retry")
    pending : Unit <- expect_read(db,UW.held_seats_sql("zai","retry","a"),"b\n","failed-release-wake-remains-eligible")
    unannounced : Unit <- expect_read(db,"SELECT count(*) FROM messages WHERE id GLOB 'usage-read:*:release:b*';","0\n","failed-launch-keeps-release-pending")
    retry : Unit <- UW.release_open(db,self,db,"b","zai","retry")
    waited : Unit <- wait_mark(db,"m-b")
    woke : Unit <- expect_read(db,"SELECT message FROM wake_marks;","m-b\n","retried-release-launches-owed-input")
    expect_read(db,UW.held_seats_sql("zai","retry","a"),"","successful-release-finishes-eligibility")

def account_switch_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    held : Unit <- sample(db,"account-a","1","true")
    gate : UW.Gate <- state_of(db,"a","account-a")
    opened : Unit <- sample(db,"account-b","2","false")
    other : UW.Gate <- state_of(db,"a","account-b")
    pending : Unit <- expect_read(db,UW.held_seats_sql("zai","account-a","k"),"a\n","account-switch-keeps-old-account-release-eligible")
    kept : Unit <- expect_read(db,"SELECT count(*) FROM messages WHERE id GLOB 'usage-read:*:release:a*';","0\n","open-account-does-not-release-other-account")
    previous : UW.Gate <- state_of(db,"a","account-a")
    expect("previous-account-stays-held",String.eq(gate_class(previous),"held"))

def admission_case(+db: String, +helper: String, +path: String) -> IO(Unit):
  do IO<Unit>:
    old : Unit <- sample(db,"acct-zai","1","true")
    written : Unit <- answer(path,zai_doc("3","null","false"))
    gate : UW.Gate <- UW.window_gate_with(db,"a","acct-zai",helper)
    open : Unit <- expect("admission-reads-fresh-held-account",String.eq(gate_class(gate),"none"))
    next : Unit <- answer(path,zai_doc("100","null","true"))
    held_gate : UW.Gate <- UW.window_gate_with(db,"a","acct-zai",helper)
    held : Unit <- expect("admission-reads-open-account",String.eq(gate_class(held_gate),"held"))
    expect_read(db,"SELECT count(*) FROM usage_reads WHERE account='acct-zai';","3\n","each-admission-reads-account")

def delay_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    absent : Unit <- expect_read(db,UW.schedule_delay_sql(""),"\n","absent-reset-has-no-delay")
    past : Unit <- expect_read(db,UW.schedule_delay_sql("1"),"\n","passed-reset-has-no-delay")
    +future : String <- read(db,"SELECT CAST(CAST(strftime('%s','now') AS INTEGER)*1000+7200000 AS TEXT);")
    +delay : String <- read(db,UW.schedule_delay_sql(Tx.trim_nl(future)))
    expect_read(db,"SELECT CAST(" ++ C.q(Tx.trim_nl(delay)) ++ " AS INTEGER) BETWEEN 7199 AND 7200;","1\n","future-reset-sleeps-to-provider-clock")

def unreadable_episode_case(+db: String, +helper: String, +path: String) -> IO(Unit):
  do IO<Unit>:
    written : Unit <- answer(path,UR.unreadable_document("codex","fixture","1","fixture provider unreadable"))
    first : UW.Gate <- UW.window_gate_with(db,"k","acct-codex",helper)
    first_unknown : Unit <- expect("first-unreadable-admission-is-unknown",String.eq(gate_class(first),"unknown"))
    second : UW.Gate <- UW.window_gate_with(db,"k","acct-codex",helper)
    second_unknown : Unit <- expect("second-unreadable-admission-is-unknown",String.eq(gate_class(second),"unknown"))
    one_pair : Unit <- expect_read(db,"SELECT count(*) FROM messages WHERE id GLOB 'usage-read:*:unreadable:k*';","2\n","unreadable-admissions-report-one-episode-pair")
    +open_doc : String <- read(db,UR.read_document_sql("codex","fixture","2","SELECT json_array()"))
    available : Unit <- answer(path,Tx.trim_nl(open_doc))
    open_gate : UW.Gate <- UW.window_gate_with(db,"k","acct-codex",helper)
    open : Unit <- expect("readable-admission-ends-unreadable-episode",String.eq(gate_class(open_gate),"none"))
    again : Unit <- answer(path,UR.unreadable_document("codex","fixture","3","fixture provider unreadable again"))
    new_gate : UW.Gate <- UW.window_gate_with(db,"k","acct-codex",helper)
    unknown : Unit <- expect("new-unreadable-episode-is-unknown",String.eq(gate_class(new_gate),"unknown"))
    expect_read(db,"SELECT group_concat(id,',') FROM (SELECT id FROM messages WHERE id GLOB 'usage-read:*:unreadable:k*' ORDER BY id);","usage-read:1:unreadable:k,usage-read:1:unreadable:k:root,usage-read:4:unreadable:k,usage-read:4:unreadable:k:root\n","readable-observation-separates-unreadable-episodes")

def record_unreadable(+db: String, +account: String, +observed: String) -> IO(Unit):
  UW.record_pair(db,"b","zai",account,"fixture",UR.unreadable_document("zai",zai_source(),observed,"fixture provider unreadable"),"")

# A trigger rejects the announcement inserts whose id matches pattern. The decision
# process exits with the database cause and records no announcement with that id.
def announce_rejected(+db: String, +label: String, +pattern: String, +account: String) -> IO(Unit):
  do IO<Unit>:
    reject : Unit <- query(db,"CREATE TRIGGER reject_announce BEFORE INSERT ON messages WHEN NEW.id GLOB " ++ C.q(pattern) ++ " BEGIN SELECT RAISE(FAIL,'fixture announcement insert failed'); END;")
    +self : String <- IO.try(String,Lock.SessionLock.executable())
    ran : Result<&1,&1,U32 & String,String> <- Proc.Process.run(Tx.enc_argv(["/bin/sh","-c","exec \"$@\" 2>&1","sh",self,"--window-state",db,"b",account]),".")
    +outcome : T.RunRes <- IO.pure(T.RunRes,Tx.run_res(ran))
    failed : Unit <- expect(label ++ "-insert-failure-propagated",Bool.not(run_ok(outcome)))
    cause : Unit <- expect(label ++ "-insert-failure-cause-retained",UW.has_sub("fixture announcement insert failed",run_text(outcome)))
    absent : Unit <- expect_read(db,"SELECT count(*) FROM messages WHERE id GLOB " ++ C.q(pattern) ++ ";","0\n",label ++ "-rejected-announcement-unrecorded")
    query(db,"DROP TRIGGER reject_announce;")

def announce_failure_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    exhausted : Unit <- sample(db,"announce","1","true")
    hold : Unit <- announce_rejected(db,"hold","usage-read:*:hold:b*","announce")
    held : UW.Gate <- state_of(db,"b","announce")
    recorded : Unit <- expect_read(db,UW.held_seats_sql("zai","announce","a"),"b\n","accepted-hold-wakes-on-release")
    unreadable : Unit <- record_unreadable(db,"announce","2")
    unknown : Unit <- announce_rejected(db,"unreadable","usage-read:*:unreadable:b*","announce")
    opened : Unit <- sample(db,"announce","3","false")
    release : Unit <- announce_rejected(db,"release","usage-read:*:release:b*","announce")
    expect_read(db,UW.held_seats_sql("zai","announce","a"),"b\n","rejected-release-keeps-hold-eligible")

def regression(+name: String, +db: String, +helper: String, +path: String) -> IO(Unit):
  match name:
    case "announce-failure": announce_failure_case(db)
    case "unreadable-episode": unreadable_episode_case(db,helper,path)
    case "ordering": ordering_case(db)
    case "serialization": serialization_case(db,helper)
    case "persistence": persistence_case(db,helper,path)
    case "release-retry": release_retry_case(db)
    case "account-switch": account_switch_case(db)
    case "admission": admission_case(db,helper,path)
    case "delay": delay_case(db)
    case _: IO.die(Unit,2,"unknown usage-read regression")
# The Codex read passes the codex command recorded in a Codex seat's receiver endpoint;
# another seat records none.
def recorded_codex_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    seats : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES('kx','coord','codex','gpt-6-astra','high','','[\"receive\",\"db\",\"kx\",\"x\",\"/opt/codex/0.163.0/codex\",\"\",\"\",\"\",\"log\"]');")
    +codex : String <- UW.read_executable(db,"kx","codex")
    one : Unit <- expect("codex-seat-passes-recorded-command",String.eq(codex,"/opt/codex/0.163.0/codex"))
    +other : String <- UW.read_executable(db,"a","codex")
    two : Unit <- expect("other-harness-records-no-codex-command",String.is_empty(other))
    +zai : String <- UW.read_executable(db,"kx","zai")
    expect("non-codex-read-passes-nothing",String.is_empty(zai))

def codex_snapshot_with_limit(+allowed: String, +used: String, +reached: String) -> String:
  "{\"ordinaryUsageAllowed\":" ++ allowed ++ ",\"rateLimits\":{\"primary\":{\"usedPercent\":" ++ used ++ ",\"windowDurationMins\":300,\"resetsAt\":1793382116},\"secondary\":null,\"rateLimitReachedType\":" ++ reached ++ "}}"

def codex_snapshot(+allowed: String, +used: String) -> String:
  codex_snapshot_with_limit(allowed,used,"null")

# The live helper timestamps each read with its observation clock.
def codex_answer_raw(+db: String, +path: String, +raw: String) -> IO(Unit):
  do IO<Unit>:
    +clock : String <- read(db,"SELECT " ++ UW.now_ms() ++ ";")
    +observed : String = Tx.trim_nl(clock)
    +problem : String <- read(db,Codex.codex_problem_sql(raw))
    +document : String <- read(db,UR.read_document_sql("codex",Codex.codex_source(),observed,Codex.codex_windows_sql(raw)))
    answer(path,Bool.pick(String,String.is_empty(Tx.trim_nl(problem)),Tx.trim_nl(document),UR.unreadable_document("codex",Codex.codex_source(),observed,Tx.trim_nl(problem))))

def codex_answer(+db: String, +path: String, +allowed: String, +used: String) -> IO(Unit):
  codex_answer_raw(db,path,codex_snapshot(allowed,used))

def codex_limit_type_case(+db: String, +helper: String, +path: String) -> IO(Unit):
  do IO<Unit>:
    initial : UW.Gate <- state_of(db,"k","acct-codex")
    unheld : Unit <- expect("codex-reported-limit-starts-unheld",Bool.not(String.eq(gate_class(initial),"held")))
    limited : Unit <- codex_answer_raw(db,path,codex_snapshot_with_limit("null","15","\"rate_limit_reached\""))
    refused : Unit <- UW.read_refused_with(db,"k","acct-codex","att-reported-limit",helper)
    held : UW.Gate <- state_of(db,"k","acct-codex")
    exhausted : Unit <- expect("codex-null-permission-reported-limit-holds",String.eq(gate_class(held),"held"))
    readable : Unit <- expect_read(db,"SELECT state FROM usage_reads ORDER BY id DESC LIMIT 1;","read\n","codex-reported-limit-recorded-readable")
    unknown : Unit <- codex_answer(db,path,"null","15")
    reread : Unit <- UW.read_refused_with(db,"k","acct-codex","att-unknown-after-limit",helper)
    retained : UW.Gate <- state_of(db,"k","acct-codex")
    kept : Unit <- expect("codex-unreported-permission-keeps-reported-limit-hold",String.eq(gate_class(retained),"held"))
    unreadable : Unit <- expect_read(db,"SELECT state FROM usage_reads ORDER BY id DESC LIMIT 1;","unreadable\n","codex-no-limit-permission-recorded-unreadable")
    allowed : Unit <- codex_answer_raw(db,path,codex_snapshot_with_limit("true","100","\"rate_limit_reached\""))
    permitted : Unit <- UW.read_refused_with(db,"k","acct-codex","att-permitted-with-limit",helper)
    released : UW.Gate <- state_of(db,"k","acct-codex")
    expect("codex-affirmative-permission-releases-with-reported-limit",String.eq(gate_class(released),"none"))

def codex_unknown_permission_case(+db: String, +helper: String, +path: String) -> IO(Unit):
  do IO<Unit>:
    denied : Unit <- codex_answer(db,path,"false","15")
    refused : Unit <- UW.read_refused_with(db,"k","acct-codex","att-denied",helper)
    held : UW.Gate <- state_of(db,"k","acct-codex")
    established : Unit <- expect("codex-denied-permission-holds",String.eq(gate_class(held),"held"))
    unknown : Unit <- codex_answer(db,path,"null","15")
    reread : Unit <- UW.read_refused_with(db,"k","acct-codex","att-unknown",helper)
    retained : UW.Gate <- state_of(db,"k","acct-codex")
    kept : Unit <- expect("codex-unknown-permission-keeps-hold",String.eq(gate_class(retained),"held"))
    expect_read(db,"SELECT state FROM usage_reads ORDER BY id DESC LIMIT 1;","unreadable\n","codex-unknown-permission-recorded-unreadable")

def codex_affirmative_permission_case(+db: String, +helper: String, +path: String) -> IO(Unit):
  do IO<Unit>:
    allowed : Unit <- codex_answer(db,path,"true","100")
    reread : Unit <- UW.read_refused_with(db,"k","acct-codex","att-allowed",helper)
    released : UW.Gate <- state_of(db,"k","acct-codex")
    expect("codex-affirmative-permission-releases-at-100",String.eq(gate_class(released),"none"))

def run(+db: String, +helper: String) -> IO(Unit):
  do IO<Unit>:
    +path : String <- IO.pure(String,db ++ ".answer")
    ready : Unit <- setup(db,path)
    +future : String <- read(db,"SELECT CAST(CAST(strftime('%s','now') AS INTEGER)*1000+3600000 AS TEXT);")
    +past : String <- read(db,"SELECT CAST(CAST(strftime('%s','now') AS INTEGER)*1000-60000 AS TEXT);")
    one : Unit <- open_refusal_case(db,helper,path)
    two : Unit <- exhausted_case(db,helper,path,Tx.trim_nl(future))
    three : Unit <- held_input_case(db,helper)
    four : Unit <- unreadable_held_case(db,helper,path)
    five : Unit <- passed_reset_case(db,helper,path,Tx.trim_nl(past),Tx.trim_nl(future))
    six : Unit <- release_case(db,helper,path)
    seven : Unit <- unknown_case(db,helper,path)
    eight : Unit <- malformed_case(db,helper,path)
    nine : Unit <- model_scope_case(db,helper,path)
    ten : Unit <- recorded_codex_case(db)
    unknown_permission : Unit <- codex_unknown_permission_case(db,helper,path)
    affirmative_permission : Unit <- codex_affirmative_permission_case(db,helper,path)
    reported_limit : Unit <- codex_limit_type_case(db,helper,path)
    IO.print("fixture-usage-live-reads-ok")

def complete_mark(+db: String, +message: String) -> IO(Unit):
  do IO<Unit>:
    marked : Unit <- query(db,"INSERT INTO wake_marks(message) VALUES(" ++ C.q(message) ++ ");")
    signaled : Result<&1,&1,U32 & String,String> <- Proc.Process.run(Tx.enc_argv(["/bin/sh","-c","printf '%s\\n' \"$2\" > \"$1\"","sh",db ++ ".wake-complete",message]),".")
    expect("release-wake-signaled",run_ok(Tx.run_res(signaled)))

def codex_permission_case(+db: String, +helper: String, affirmative: Bool) -> IO(Unit):
  do IO<Unit>:
    +path : String = db ++ ".answer"
    ready : Unit <- setup(db,path)
    denied : Unit <- codex_answer(db,path,"false","15")
    held : Unit <- UW.read_refused_with(db,"k","acct-codex","att-initial",helper)
    Bool.pick(IO(Unit),affirmative,codex_affirmative_permission_case(db,helper,path),codex_unknown_permission_case(db,helper,path))

def codex_limit_type_fixture(+db: String, +helper: String) -> IO(Unit):
  do IO<Unit>:
    +path : String = db ++ ".answer"
    ready : Unit <- setup(db,path)
    codex_limit_type_case(db,helper,path)

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case "--codex-limit-type" <> +db <> +helper <> Nil{}: codex_limit_type_fixture(db,helper)
    case "--codex-unknown" <> +db <> +helper <> Nil{}: codex_permission_case(db,helper,False{})
    case "--codex-affirmative" <> +db <> +helper <> Nil{}: codex_permission_case(db,helper,True{})
    case "--case" <> +name <> +db <> +helper <> Nil{}: do IO<Unit>:
      ready : Unit <- setup(db,db ++ ".answer")
      regression(name,db,helper,db ++ ".answer")
    case "--read-account" <> +db <> +helper <> +account <> Nil{}: UW.read_with(db,"a","zai",account,helper,"fixture-child")
    case "--window-state" <> +db <> +seat <> +account <> Nil{}: do IO<Unit>:
      gate : UW.Gate <- state_of(db,seat,account)
      IO.print(gate_class(gate))
    case "--wake-message" <> +db <> +message <> Nil{}: complete_mark(db,message)
    case +db <> +helper <> Nil{}: run(db,helper)
    case other: IO.die(Unit,2,"usage: usage-live-reads DB HELPER")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
