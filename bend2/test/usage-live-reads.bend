# Focused fixture for the #1025 hold and release core. It drives the real read
# recording, hold decision, announcements and release over a temporary database,
# with HELPER standing in for the usage-read helper. Each account's credential
# reference is file:PATH and the fixture writes the next read document to PATH.
#
# It proves: a refusal followed by an open read does not hold; an exhausted read
# holds and announces the hold to the orchestrator and the root; a gate on a held seat
# reads again once the read interval has passed; an unreadable read and a passed provider reset do not release; an open
# read releases every seat that announced the hold and drives the other seat's owed
# input through the wake entry; a held account is read again at most once per read
# interval; repeated gates add no second announcement; an unreadable provider is an
# unknown that does not hold; malformed, missing and mismatched helper answers are
# recorded as unreadable with their reasons; and a model-scoped window holds only the
# seats of that model.
#
# usage: usage-live-reads DB HELPER
#        usage-live-reads --wake-message DB MESSAGE   (the release wake records a mark)
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/usage-windows.bend as UW
import ../src/coordinator/usage-reads.bend as UR
import ../src/coordinator/codex-rate-limits.bend as Codex
import ../src/host/sqlite.bend as DB
import ../src/git/text.bend as Tx
import ../src/git/process.bend as Proc

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

# Moves every recorded read one read interval and a second into the past, so the next
# gate finds the held provider account due.
def age_reads(+db: String) -> IO(Unit):
  query(db,"UPDATE usage_reads SET observed_at=observed_at-61000;")

def held_input_case(+db: String, +helper: String) -> IO(Unit):
  do IO<Unit>:
    fresh : UW.Gate <- UW.window_gate_with(db,"b","acct-zai",helper)
    fresh_held : Unit <- expect("fresh-hold-still-held",String.eq(gate_class(fresh),"held"))
    not_due : Unit <- expect_read(db,"SELECT count(*) FROM usage_reads;","2\n","fresh-hold-not-read-again-within-interval")
    aged : Unit <- age_reads(db)
    gate : UW.Gate <- UW.window_gate_with(db,"b","acct-zai",helper)
    held : Unit <- expect("input-to-held-seat-still-held",String.eq(gate_class(gate),"held"))
    reread : Unit <- expect_read(db,"SELECT count(*)||'|'||(SELECT trigger||'|'||session FROM usage_reads ORDER BY id DESC LIMIT 1) FROM usage_reads;","3|held-account-due|b\n","due-held-account-read-again")
    expect_read(db,"SELECT recipient FROM messages WHERE id='usage-read:2:hold:b';","coord\n","second-seat-hold-announced")

def unreadable_held_case(+db: String, +helper: String, +path: String) -> IO(Unit):
  do IO<Unit>:
    written : Unit <- answer(path,UR.unreadable_document("zai",zai_source(),"1","HTTP 503 from the provider"))
    aged : Unit <- age_reads(db)
    gate : UW.Gate <- UW.window_gate_with(db,"a","acct-zai",helper)
    held : Unit <- expect("unreadable-read-keeps-hold",String.eq(gate_class(gate),"held"))
    reason : Unit <- expect_read(db,"SELECT state||'|'||reason FROM usage_reads WHERE id=4;","unreadable|HTTP 503 from the provider\n","unreadable-reason-recorded")
    expect_read(db,"SELECT recipient FROM messages WHERE id='usage-read:4:unreadable:a';","coord\n","unreadable-announced")

def passed_reset_case(+db: String, +helper: String, +path: String, +past: String, +future: String) -> IO(Unit):
  do IO<Unit>:
    written : Unit <- answer(path,zai_doc("100",past,"true"))
    aged : Unit <- age_reads(db)
    gate : UW.Gate <- UW.window_gate_with(db,"a","acct-zai",helper)
    held : Unit <- expect("passed-reset-still-exhausted-holds",String.eq(gate_class(gate),"held"))
    recorded : UW.Gate <- state_of(db,"a","acct-zai")
    kept : Unit <- expect("hold-does-not-expire-without-read",String.eq(gate_class(recorded),"held"))
    passed : Unit <- expect_read(db,UW.schedule_delay_sql(past),"60\n","passed-reset-continuation-waits-one-read-interval")
    far : Unit <- expect_read(db,UW.schedule_delay_sql(future),"60\n","far-reset-continuation-waits-one-read-interval")
    unknown : Unit <- expect_read(db,UW.schedule_delay_sql(""),"60\n","unreported-reset-continuation-waits-one-read-interval")
    +near : String <- read(db,"SELECT CAST(CAST(strftime('%s','now') AS INTEGER)*1000+10000 AS TEXT);")
    +delay : String <- read(db,UW.schedule_delay_sql(Tx.trim_nl(near)))
    expect_read(db,"SELECT CAST(" ++ C.q(Tx.trim_nl(delay)) ++ " AS INTEGER) BETWEEN 9 AND 11;","1\n","near-reset-continuation-ends-at-reset")

def release_case(+db: String, +helper: String, +path: String) -> IO(Unit):
  do IO<Unit>:
    written : Unit <- answer(path,zai_doc("3","1792820715847","false"))
    aged : Unit <- age_reads(db)
    gate : UW.Gate <- UW.window_gate_with(db,"a","acct-zai",helper)
    open : Unit <- expect("open-read-releases",String.eq(gate_class(gate),"none"))
    released : Unit <- expect_read(db,"SELECT group_concat(id||'>'||recipient,',') FROM (SELECT id,recipient FROM messages WHERE id GLOB 'usage-read:2:release:*' ORDER BY id);","usage-read:2:release:a>coord,usage-read:2:release:a:root>root,usage-read:2:release:b>coord,usage-read:2:release:b:root>root\n","release-announced-for-each-held-seat")
    waited : Result<&1,&1,U32 & String,String> <- Proc.Process.run(Tx.enc_argv(["/bin/sh","-c","i=0; while [ $i -lt 50 ]; do [ \"$(sqlite3 \"$1\" 'SELECT count(*) FROM wake_marks;')\" = 1 ] && exit 0; sleep 0.1; i=$((i+1)); done; exit 1","sh",db]),".")
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
    case "--wake-message" <> +db <> +message <> Nil{}: query(db,"INSERT INTO wake_marks(message) VALUES(" ++ C.q(message) ++ ");")
    case +db <> +helper <> Nil{}: run(db,helper)
    case other: IO.die(Unit,2,"usage: usage-live-reads DB HELPER")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
