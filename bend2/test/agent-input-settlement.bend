# Focused settlement fixture. It calls the production AgentInput function over a private database.
import Base
import ../src/coordinator/agent-input.bend as AgentInput
import ../src/coordinator/message-status.bend as Status
import ../src/coordinator/store.bend as Store
import ../src/host/sqlite.bend as DB
import ../src/host/instance.bend as Custody

def expect(+name: String, ok: Bool) -> IO(Unit):
  Bool.pick(IO(Unit),ok,IO.pure(Unit,Unit{}),IO.die(Unit,1,"fixture-agent-input-settlement " ++ name ++ ": failed"))
def query(+db: String, +sql: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,DB.Sql.query(db,sql))
    IO.pure(Unit,Unit{})
def expect_read(+db: String, +sql: String, +expected: String, +name: String) -> IO(Unit):
  do IO<Unit>:
    value : String <- IO.try(String,DB.Sql.read(db,sql))
    expect(name,String.eq(value,expected))

def seed(+db: String) -> IO(Unit):
  do IO<Unit>:
    ensured : Unit <- Store.ensure_before_begin(db)
    inserted : Unit <- query(db,"BEGIN IMMEDIATE;"
      ++ "INSERT INTO sessions(id,parent,harness,model,effort,native) VALUES"
      ++ "('root',NULL,'omp','','',''),"
      ++ "('success',NULL,'omp','','','native-success'),"
      ++ "('native-mismatch',NULL,'omp','','','native-new'),"
      ++ "('running-attempt',NULL,'omp','','','native-running'),"
      ++ "('stopped-session',NULL,'omp','','','native-stopped'),('report-case',NULL,'omp','','','native-report');"
      ++ "INSERT INTO executions(session,id,mode,directory,phase,status) VALUES"
      ++ "('success','attempt-success','receive','/fixture/success','exited','exit 0'),"
      ++ "('native-mismatch','attempt-native-mismatch','receive','/fixture/native-mismatch','exited','exit 0'),"
      ++ "('running-attempt','attempt-running','receive','/fixture/running','running',''),"
      ++ "('stopped-session','attempt-stopped','receive','/fixture/stopped','exited','exit 0'),('report-case','attempt-report','receive','/fixture/report','exited','exit 0');"
      ++ "INSERT INTO messages(seq,id,sender,recipient,kind,body,receipt) VALUES"
      ++ "(1,'prior','root','success','task','prior prompt','prior-receipt'),"
      ++ "(2,'prompt','root','success','task','initial prompt',NULL),"
      ++ "(3,'guidance-1','root','success','guidance','forwarded guidance one',NULL),"
      ++ "(4,'recovery-between','root','success','recovery','non-guidance inside delivered range',NULL),"
      ++ "(5,'guidance-2','root','success','guidance','forwarded guidance two',NULL),"
      ++ "(6,'guidance-later','root','success','guidance','not yet forwarded',NULL),"
      ++ "(7,'task-later','root','success','task','later task',NULL),"
      ++ "(20,'mismatch-prompt','root','native-mismatch','task','prompt',NULL),"
      ++ "(21,'mismatch-guidance','root','native-mismatch','guidance','guidance',NULL),"
      ++ "(30,'running-prompt','root','running-attempt','task','prompt',NULL),"
      ++ "(31,'running-guidance','root','running-attempt','guidance','guidance',NULL),"
      ++ "(40,'stopped-prompt','root','stopped-session','task','prompt',NULL),"
      ++ "(41,'stopped-guidance','root','stopped-session','guidance','guidance',NULL),(50,'summary-report','root','report-case','report','full report body retained outside the prompt',NULL),(51,'read-report','root','report-case','report','complete report body already read',NULL);"
      ++ "INSERT INTO message_reads(attempt,message,recipient,native,identity) VALUES"
      ++ "('attempt-success','prior','success','native-success','fixture'),"
      ++ "('attempt-success','prompt','success','native-success','fixture'),"
      ++ "('attempt-success','guidance-1','success','native-success','fixture'),"
      ++ "('attempt-success','recovery-between','success','native-success','fixture'),"
      ++ "('attempt-success','guidance-later','success','native-success','fixture'),"
      ++ "('attempt-success','task-later','success','native-success','fixture'),"
      ++ "('attempt-native-mismatch','mismatch-prompt','native-mismatch','native-original','fixture'),"
      ++ "('attempt-native-mismatch','mismatch-guidance','native-mismatch','native-original','fixture'),"
      ++ "('attempt-running','running-prompt','running-attempt','native-running','fixture'),"
      ++ "('attempt-running','running-guidance','running-attempt','native-running','fixture'),"
      ++ "('attempt-stopped','stopped-prompt','stopped-session','native-stopped','fixture'),"
      ++ "('attempt-stopped','stopped-guidance','stopped-session','native-stopped','fixture'),('attempt-report','read-report','report-case','native-report','full-read-action');"
      ++ "UPDATE message_reads SET handled='prior-handled' WHERE attempt='attempt-success' AND message='guidance-1';"
      ++ "INSERT INTO session_stops(session,id,reason,outcome) VALUES('stopped-session','stop-fixture','fixture stop','requested');"
      ++ "COMMIT;")
    IO.pure(Unit,Unit{})

def success_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    settled : Unit <- AgentInput.consume_delivered(db,"success","attempt-success","native-success","2","5")
    settled_again : Unit <- AgentInput.consume_delivered(db,"success","attempt-success","native-success","2","5")
    prior_receipt : Unit <- expect_read(db,"SELECT coalesce(receipt,'<null>') FROM messages WHERE id='prior';","prior-receipt\n","existing-receipt-preserved")
    prompt_receipt : Unit <- expect_read(db,"SELECT coalesce(receipt,'<null>') FROM messages WHERE id='prompt';","native-turn:attempt-success\n","initial-prompt-consumed")
    first_receipt : Unit <- expect_read(db,"SELECT coalesce(receipt,'<null>') FROM messages WHERE id='guidance-1';","native-turn:attempt-success\n","first-guidance-consumed")
    prior_handled : Unit <- expect_read(db,"SELECT coalesce(handled,'<null>') FROM message_reads WHERE message='guidance-1';","prior-handled\n","existing-handled-preserved")
    between_receipt : Unit <- expect_read(db,"SELECT coalesce(receipt,'<null>') FROM messages WHERE id='recovery-between';","<null>\n","non-guidance-between-cursors-preserved")
    second_receipt : Unit <- expect_read(db,"SELECT coalesce(receipt,'<null>') FROM messages WHERE id='guidance-2';","native-turn:attempt-success\n","last-forwarded-guidance-consumed")
    later_guidance : Unit <- expect_read(db,"SELECT coalesce(receipt,'<null>') FROM messages WHERE id='guidance-later';","<null>\n","later-guidance-preserved")
    later_task : Unit <- expect_read(db,"SELECT coalesce(receipt,'<null>') FROM messages WHERE id='task-later';","<null>\n","later-task-preserved")
    prompt_read : Unit <- expect_read(db,"SELECT coalesce(handled,'<null>') FROM message_reads WHERE message='prompt';","native-turn:attempt-success\n","initial-read-handled")
    guide_read : Unit <- expect_read(db,"SELECT count(*) FROM message_reads WHERE message='guidance-2' AND attempt='attempt-success' AND native='native-success';","0\n","forwarded-guidance-without-read-row-still-settles")
    between_read : Unit <- expect_read(db,"SELECT coalesce(handled,'<null>') FROM message_reads WHERE message='recovery-between';","<null>\n","non-guidance-read-unhandled")
    later_read : Unit <- expect_read(db,"SELECT coalesce(handled,'<null>') FROM message_reads WHERE message='guidance-later';","<null>\n","later-guidance-read-unhandled")
    IO.pure(Unit,Unit{})

def report_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    descriptor : String <- IO.pure(String,"{\"session\":\"report-case\",\"attempt\":\"attempt-report\",\"direct\":false,\"cursor\":51,\"inputMessages\":[\"summary-report\",\"read-report\"],\"prompt\":\"Message (report) from root [id: summary-report] retained 44 bytes; read the complete body with baton read summary-report.\\nMessage (report) from root [id: read-report] retained 33 bytes; read the complete body with baton read read-report.\"}")
    summary_record : String <- IO.try(String,Store.transact_sql(db,Status.prompt_record_sql("report-case","attempt-report","native-report","summary-descriptor",descriptor)))
    summary_read : Unit <- expect_read(db,"SELECT count(*) FROM message_reads WHERE message='summary-report' AND attempt='attempt-report';","0\n","summary-is-not-a-full-body-read")
    settled : Unit <- AgentInput.consume_delivered(db,"report-case","attempt-report","native-report","51","51")
    summary_receipt : Unit <- expect_read(db,"SELECT coalesce(receipt,'<null>') FROM messages WHERE id='summary-report';","<null>\n","unread-summary-report-remains-owed")
    full_receipt : Unit <- expect_read(db,"SELECT coalesce(receipt,'<null>') FROM messages WHERE id='read-report';","native-turn:attempt-report\n","fully-read-report-settles")
    full_handled : Unit <- expect_read(db,"SELECT coalesce(handled,'<null>') FROM message_reads WHERE message='read-report';","native-turn:attempt-report\n","fully-read-report-handled")
    IO.pure(Unit,Unit{})

def refusal_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    native_call : Unit <- AgentInput.consume_delivered(db,"native-mismatch","attempt-native-mismatch","native-original","20","21")
    native_receipt : Unit <- expect_read(db,"SELECT coalesce(receipt,'<null>') FROM messages WHERE id='mismatch-prompt';","<null>\n","changed-native-keeps-prompt-owed")
    native_read : Unit <- expect_read(db,"SELECT coalesce(handled,'<null>') FROM message_reads WHERE message='mismatch-guidance';","<null>\n","changed-native-keeps-read-unhandled")
    running_call : Unit <- AgentInput.consume_delivered(db,"running-attempt","attempt-running","native-running","30","31")
    running_receipt : Unit <- expect_read(db,"SELECT coalesce(receipt,'<null>') FROM messages WHERE id='running-prompt';","<null>\n","running-attempt-keeps-prompt-owed")
    running_read : Unit <- expect_read(db,"SELECT coalesce(handled,'<null>') FROM message_reads WHERE message='running-guidance';","<null>\n","running-attempt-keeps-read-unhandled")
    stopped_call : Unit <- AgentInput.consume_delivered(db,"stopped-session","attempt-stopped","native-stopped","40","41")
    stopped_receipt : Unit <- expect_read(db,"SELECT coalesce(receipt,'<null>') FROM messages WHERE id='stopped-prompt';","<null>\n","stopped-session-keeps-prompt-owed")
    stopped_read : Unit <- expect_read(db,"SELECT coalesce(handled,'<null>') FROM message_reads WHERE message='stopped-guidance';","<null>\n","stopped-session-keeps-read-unhandled")
    IO.pure(Unit,Unit{})

# Store commits publish to the database owner. The focused fixture starts one
# for its private database so the production settlement transaction completes.
def owner_started(+db: String) -> IO(Unit):
  do IO<Unit>:
    ensured : Unit <- Store.ensure_before_begin(db)
    +witness : String <- IO.try(String,Custody.Instance.ensure_owner_witness(db))
    IO.pure(Unit,Unit{})
def owner_stopped(+db: String) -> IO(Unit):
  do IO<Unit>:
    +stopped : Unit <- IO.try(Unit,Custody.Instance.shutdown(db))
    IO.pure(Unit,Unit{})
def run(+db: String) -> IO(Unit):
  do IO<Unit>:
    owner : Unit <- owner_started(db)
    prepared : Unit <- seed(db)
    success : Unit <- success_case(db)
    report : Unit <- report_case(db)
    refused : Unit <- refusal_cases(db)
    stopped : Unit <- owner_stopped(db)
    IO.print("fixture-agent-input-settlement-ok")
def main_args(args: List<String>) -> IO(Unit):
  match args:
    case "--instance-owner" <> +db <> Nil{}: IO.try(Unit,Custody.Instance.owner(db))
    case +db <> Nil{}: run(db)
    case other: IO.die(Unit,2,"usage: agent-input-settlement DB")
def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
