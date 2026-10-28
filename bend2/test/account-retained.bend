# Focused retained composition fixture for a supported account binding. It
# drives the real retained_prepare_checked for claude-code with one subscription
# account, proving the single captured account selection yields the argv and the
# attempt record. The owner mode lets Store.transact_sql publish normally.
import Base
import ../src/coordinator/turn.bend as Turn
import ../src/coordinator/accounts.bend as Accounts
import ../src/coordinator/commands.bend as C
import ../src/host/instance.bend as Custody
import ../src/host/sqlite.bend as DB
import ../src/git/text.bend as Tx

def print_arg_list(+label: String, xs: List<String>) -> IO(Unit):
  match xs:
    case Nil{}: IO.pure(Unit,Unit{})
    case head <> rest: do IO<Unit>:
      IO.print(label ++ "\t" ++ head)
      print_arg_list(label,rest)

def print_launch(launch: Turn.RetainedLaunch) -> IO(Unit):
  match launch:
    case Turn.Prepared{+arguments,+input,+initial,+keep_stdin,file_input}: do IO<Unit>:
      print_arg_list("arg",Tx.split_nul(arguments))
      IO.print("input\t" ++ input)
      IO.print("keep\t" ++ U32.show(keep_stdin))
      IO.print("file\t" ++ Bool.pick(String,file_input,"true","false"))

def prepared(result: Result<&1,&1,U32 & String,Turn.RetainedLaunch>) -> IO(Unit):
  match result:
    case Fail{(code,detail)}: IO.die(Unit,2,"retained prepare failed: " ++ detail)
    case Done{+launch}: print_launch(launch)

def setup(+db: String, +directory: String) -> IO(Unit):
  do IO<Unit>:
    ensured : Unit <- Accounts.ensure(db)
    made : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,"BEGIN;" ++ C.schema() ++ "COMMIT;")
    seated : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,"INSERT INTO sessions(id,parent,harness,model,effort,workspace) VALUES('account-fixture',NULL,'claude-code','deepseek-flash','high','/fixture/workspace');INSERT INTO executions(session,id,mode,directory,phase,status) VALUES('account-fixture','receive:account-fixture:1','retained'," ++ C.q(directory) ++ ",'starting','');")
    account : Unit <- Accounts.record(db,"claude-sub","anthropic","claude-code","subscription","/fixture/store")
    bound : Unit <- Accounts.bind(db,"claude-sub","account-fixture")
    IO.pure(Unit,Unit{})

def prepare(+db: String, +directory: String) -> IO(Unit):
  do IO<Unit>:
    setup(db,directory)
    result : Result<&1,&1,U32 & String,Turn.RetainedLaunch> <- Turn.retained_prepare_checked(db,"account-fixture",directory,"/bin/true","deepseek-flash","high","","claude-code\n",db ++ ".sessions","fixture prompt","default",False{},"",Done{Unit{}})
    prepared(result)
    attempt : String <- IO.try(String,DB.Sql.read(db,"SELECT account || '\t' || funding || '\t' || secret_ref FROM account_attempts WHERE attempt=" ++ C.q(directory) ++ ";"))
    IO.print("attempt\t" ++ Tx.trim_nl(attempt))

def print_witness(witness: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match witness:
    case Fail{error}: IO.die(Unit,2,"owner witness failed")
    case Done{value}: IO.print(value)

def run(args: List<String>) -> IO(Unit):
  match args:
    case "--instance-owner" <> +db <> Nil{}: IO.try(Unit,Custody.Instance.owner(db))
    case "--instance-shutdown" <> +db <> Nil{}: IO.try(Unit,Custody.Instance.shutdown(db))
    case "--instance-witness" <> +db <> Nil{}: do IO<Unit>:
      witness : Result<&1,&1,U32 & String,String> <- Custody.Instance.owner_witness(db)
      print_witness(witness)
    case +db <> +directory <> Nil{}: prepare(db,directory)
    case other: IO.die(Unit,2,"usage: account-retained DB DIRECTORY | --instance-owner DB | --instance-shutdown DB")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
