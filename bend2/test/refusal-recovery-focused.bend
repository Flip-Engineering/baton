# Focused fixture for issue #1320 model-refusal recovery. It exercises the
# production classifier, the durable attempt ledger and the exact conductor
# result over a temporary coordination database.
#
# usage: refusal-recovery-focused DB
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/agent-input.bend as A
import ../src/host/sqlite.bend as DB
import ../src/host/instance.bend as I
import ../src/git/text.bend as Tx

def expect(+label: String, ok: Bool) -> IO(Unit):
  Bool.pick(IO(Unit),ok,IO.print("fixture-refusal-recovery " ++ label ++ ": ok"),IO.die(Unit,1,"fixture-refusal-recovery " ++ label ++ ": refused"))

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

def setup_sessions(+db: String) -> IO(Unit):
  do IO<Unit>:
    made : Unit <- query(db,C.schema())
    root : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,observed_harness,observed_model,endpoint,workspace,branch,base) VALUES('root',NULL,'omp','root-model','low','','omp','root-model','','/tmp/refusal-root','','');")
    source : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,observed_harness,observed_model,endpoint,workspace,branch,base) VALUES('source','root','omp','requested-model','high','native-source','omp','observed-model','','/tmp/refusal-source','','');")
    task : Unit <- query(db,"INSERT INTO messages(id,sender,recipient,kind,body) VALUES('task-1','root','source','task','Complete the original task λ with evidence.');")
    IO.pure(Unit,Unit{})

def source_row(+db: String, +id: String) -> IO(Unit):
  query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,observed_harness,observed_model,endpoint,workspace,branch,base) VALUES(" ++ C.q(id) ++ ",'root','omp','requested-model','high','','omp','observed-model','','/tmp/refusal-" ++ id ++ "','','');")

def task_message(+db: String, +id: String, +body: String) -> IO(Unit):
  query(db,"INSERT INTO messages(id,sender,recipient,kind,body) VALUES(" ++ C.q(id ++ "-task") ++ ",'root'," ++ C.q(id) ++ ",'task'," ++ C.q(body) ++ ");")

def classification_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    normal : String <- A.rr_refusal_description(db,"{\"type\":\"result\",\"result\":\"Work completed.\",\"is_error\":false}")
    expect("ordinary-result-not-refusal",String.is_empty(normal))
    provider : String <- A.rr_refusal_description(db,"{\"type\":\"result\",\"result\":\"429 rate limit: I cannot help with that.\",\"is_error\":true}")
    expect("provider-failure-not-refusal",String.is_empty(provider))
    quoted : String <- A.rr_refusal_description(db,"{\"type\":\"result\",\"result\":\"Report: the fixture prints I cannot help with under quota.\",\"is_error\":false}")
    expect("quoted-task-text-not-refusal",String.is_empty(quoted))
    claude : String <- A.rr_refusal_description(db,"{\"type\":\"result\",\"result\":\"I cannot help with that request.\",\"is_error\":false}")
    expect("claude-refusal-detected",String.eq(claude,"I cannot help with that request."))
    omp : String <- A.rr_refusal_description(db,"{\"type\":\"agent_end\",\"isTerminal\":true,\"messages\":[{\"role\":\"assistant\",\"stopReason\":\"stop\",\"content\":[{\"type\":\"text\",\"text\":\"I can't assist with that.\"}]}]}")
    expect("omp-refusal-detected",String.eq(omp,"I can't assist with that."))
    codex : String <- A.rr_refusal_description(db,"{\"type\":\"turn.failed\",\"error\":{\"message\":\"I must decline this instruction.\"}}")
    expect("codex-refusal-detected",String.eq(codex,"I must decline this instruction."))
    muse : String <- A.rr_refusal_description(db,"{\"payload_type\":\"run.terminal.failed\",\"payload\":{\"kind\":\"run_terminal\",\"terminal\":\"failed\",\"text\":\"I won't help with that.\"}}")
    expect("muse-refusal-detected",String.eq(muse,"I won't help with that."))
    explicit : String <- A.rr_refusal_description(db,"{\"type\":\"result\",\"result\":\"Proceed.\",\"baton\":{\"outcome\":\"model-refusal\"},\"refusal_description\":\"Complete explicit refusal λ.\"}")
    model_flag : String <- A.rr_refusal_description(db,"{\"type\":\"result\",\"result\":\"Proceed.\",\"modelRefusal\":1,\"refusal_description\":\"Model flag refusal λ.\"}")
    baton_field : String <- A.rr_refusal_description(db,"{\"type\":\"result\",\"result\":\"Proceed.\",\"baton\":{\"refusal_description\":\"Baton field refusal λ.\"}}")
    expect("explicit-refusal-field",String.eq(explicit,"Complete explicit refusal λ."))
    expect("model-refusal-flag",String.eq(model_flag,"Model flag refusal λ."))
    expect("baton-refusal-field",String.eq(baton_field,"Baton field refusal λ."))
    IO.pure(Unit,Unit{})

def continue_sequence(+db: String) -> IO(Unit):
  do IO<Unit>:
    +event1 : String = "{\"type\":\"result\",\"result\":\"I cannot help with attempt one.\",\"is_error\":false}"
    first : Unit <- A.rr_observe(db,"source","turn-1",event1)
    expect_read(db,"SELECT count(*) FROM refusal_recoveries;","1\n","one-recovery-record")
    expect_read(db,"SELECT status FROM refusal_recoveries;","active\n","recovery-active")
    expect_read(db,"SELECT count(*) FROM refusal_attempts WHERE stage='fork-and-continue' AND status='running';","1\n","continue-one-running")
    expect_read(db,"SELECT count(*) FROM messages WHERE id='refusal-retry:'||(SELECT id FROM refusal_recoveries)||':1';","1\n","continue-one-message")
    expect_read(db,"SELECT body FROM messages WHERE id='refusal-retry:'||(SELECT id FROM refusal_recoveries)||':1';",A.rr_retry_instruction("Complete the original task λ with evidence.","fork-and-continue",1) ++ "\n","continue-one-exact-instruction")
    continuation : Unit <- query(db,C.task_continuation_sql("source","suppressed-by-recovery"))
    expect_read(db,"SELECT count(*) FROM messages WHERE id='suppressed-by-recovery:task-continuation';","0\n","recovery-suppresses-task-continuation")
    duplicate : Unit <- A.rr_observe(db,"source","turn-1",event1)
    expect_read(db,"SELECT count(*) FROM refusal_attempts;","1\n","duplicate-observation-is-idempotent")
    event2 : String = "{\"type\":\"result\",\"result\":\"I can't assist with attempt two. '); DROP TABLE sessions;-- λ\",\"is_error\":false}"
    second : Unit <- A.rr_observe(db,"source","turn-2",event2)
    expect_read(db,"SELECT count(*) FROM refusal_attempts WHERE stage='fork-and-continue';","2\n","continue-two-created")
    expect_read(db,"SELECT status FROM refusal_attempts WHERE ordinal=1;","refused\n","continue-one-refused")
    expect_read(db,"SELECT count(*) FROM refusal_attempts WHERE ordinal=2 AND status='running';","1\n","continue-two-running")
    event3 : String = "{\"type\":\"result\",\"result\":\"I must decline attempt three.\",\"is_error\":false}"
    third : Unit <- A.rr_observe(db,"source","turn-3",event3)
    expect_read(db,"SELECT count(*) FROM refusal_attempts WHERE stage='fork-and-continue';","3\n","continue-three-created")
    expect_read(db,"SELECT count(*) FROM refusal_attempts WHERE ordinal=3 AND status='running';","1\n","continue-three-running")
    event4 : String = "{\"type\":\"result\",\"result\":\"I won't help with attempt three.\",\"is_error\":false}"
    fourth : Unit <- A.rr_observe(db,"source","turn-4",event4)
    expect_read(db,"SELECT count(*) FROM refusal_attempts WHERE stage='fork-and-continue' AND status='refused';","3\n","continue-three-refused")
    expect_read(db,"SELECT count(*) FROM refusal_attempts WHERE stage='fork-and-flush';","0\n","flush-not-started-by-observation")
    IO.pure(Unit,Unit{})

def result_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    flush1 : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,observed_harness,observed_model,endpoint,workspace,branch,base) VALUES('flush-1','root','omp','requested-model','high','','omp','observed-model','','/tmp/refusal-flush-1','','');")
    flush2 : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,observed_harness,observed_model,endpoint,workspace,branch,base) VALUES('flush-2','root','omp','requested-model','high','','omp','observed-model','','/tmp/refusal-flush-2','','');")
    flush3 : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,observed_harness,observed_model,endpoint,workspace,branch,base) VALUES('flush-3','root','omp','requested-model','high','','omp','observed-model','','/tmp/refusal-flush-3','','');")
    attempts : Unit <- query(db,"WITH r AS (SELECT id FROM refusal_recoveries WHERE source='source' LIMIT 1) INSERT INTO refusal_attempts(id,recovery,stage,ordinal,session,instruction,refusal_description,status,turn) SELECT r.id||':fork-and-flush:1',r.id,'fork-and-flush',1,'flush-1','exact flush instruction 1 λ','complete flush refusal 1','refused','flush-turn-1' FROM r UNION ALL SELECT r.id||':fork-and-flush:2',r.id,'fork-and-flush',2,'flush-2','exact flush instruction 2','complete flush refusal 2','refused','flush-turn-2' FROM r UNION ALL SELECT r.id||':fork-and-flush:3',r.id,'fork-and-flush',3,'flush-3','exact flush instruction 3','complete flush refusal 3','refused','flush-turn-3' FROM r;")
    +recovery : String <- do IO<String>:
      value : String <- read(db,"SELECT id FROM refusal_recoveries WHERE source='source' LIMIT 1;")
      IO.pure(String,Tx.trim_nl(value))
    +result : String <- A.rr_result_json(db,recovery)
    expect_read(db,"SELECT json_extract(" ++ C.q(result) ++ ",'$.model-refusal.harness');","omp\n","result-harness")
    expect_read(db,"SELECT json_extract(" ++ C.q(result) ++ ",'$.model-refusal.model');","observed-model\n","result-model")
    expect_read(db,"SELECT json_array_length(" ++ C.q(result) ++ ",'$.model-refusal.attempted_instructions.\"fork-and-continue\"');","3\n","result-continue-count")
    expect_read(db,"SELECT json_array_length(" ++ C.q(result) ++ ",'$.model-refusal.attempted_instructions.\"fork-and-flush\"');","3\n","result-flush-count")
    expect_read(db,"SELECT json_extract(" ++ C.q(result) ++ ",'$.model-refusal.attempted_instructions.\"fork-and-flush\"[2].instruction');","exact flush instruction 3\n","result-exact-instruction")
    expect_read(db,"SELECT json_extract(" ++ C.q(result) ++ ",'$.model-refusal.attempted_instructions.\"fork-and-continue\"[0].refusal_description');","I can't assist with attempt two. '); DROP TABLE sessions;-- λ\n","result-exact-refusal")
    expect_read(db,"SELECT count(*) FROM sqlite_master WHERE type='table' AND name='sessions';","1\n","instruction-text-cannot-drop-schema")
    IO.pure(Unit,Unit{})

def success_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    source : Unit <- source_row(db,"retry-success")
    task : Unit <- task_message(db,"retry-success","Retry success task λ")
    first : Unit <- A.rr_observe(db,"retry-success","success-turn-1","{\"type\":\"result\",\"result\":\"I cannot help with that.\",\"is_error\":false}")
    second : Unit <- A.rr_observe(db,"retry-success","success-turn-2","{\"type\":\"result\",\"result\":\"Work completed.\",\"is_error\":false}")
    expect_read(db,"SELECT status FROM refusal_recoveries WHERE source='retry-success';","succeeded\n","continue-success-recovery")
    expect_read(db,"SELECT status FROM refusal_attempts WHERE recovery=(SELECT id FROM refusal_recoveries WHERE source='retry-success');","succeeded\n","continue-success-attempt")
    IO.pure(Unit,Unit{})

def failure_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    source : Unit <- source_row(db,"retry-failure")
    task : Unit <- task_message(db,"retry-failure","Retry failure task λ")
    first : Unit <- A.rr_observe(db,"retry-failure","failure-turn-1","{\"type\":\"result\",\"result\":\"I cannot help with that.\",\"is_error\":false}")
    second : Unit <- A.rr_observe(db,"retry-failure","failure-turn-2","{\"type\":\"result\",\"result\":\"429 rate limit\",\"is_error\":true}")
    expect_read(db,"SELECT status FROM refusal_recoveries WHERE source='retry-failure';","failed\n","continue-failure-recovery")
    expect_read(db,"SELECT status FROM refusal_attempts WHERE recovery=(SELECT id FROM refusal_recoveries WHERE source='retry-failure');","failed\n","continue-failure-attempt")
    expect_read(db,"SELECT refusal_description FROM refusal_attempts WHERE recovery=(SELECT id FROM refusal_recoveries WHERE source='retry-failure');","\n","failed-attempt-has-no-refusal-description")
    expect_read(db,"SELECT count(*) FROM messages WHERE id='refusal-result:'||(SELECT id FROM refusal_recoveries WHERE source='retry-failure');","1\n","failure-report-written")
    IO.pure(Unit,Unit{})

def ignore_result(result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match result:
    case Fail{error}: IO.pure(Unit,Unit{})
    case Done{unit}: IO.pure(Unit,Unit{})

def fixture(+db: String) -> IO(Unit):
  do IO<Unit>:
    setup_sessions(db)
    owner : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,I.Instance.owner(db))
    classification_cases(db)
    continue_sequence(db)
    success_case(db)
    failure_case(db)
    result_case(db)
    shutdown : Result<&1,&1,U32 & String,Unit> <- I.Instance.shutdown(db)
    stopped : Unit <- ignore_result(shutdown)
    joined : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,owner)
    IO.print("fixture-refusal-recovery-ok")

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case +db <> Nil{}: fixture(db)
    case other: IO.die(Unit,2,"usage: refusal-recovery-focused DB")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
