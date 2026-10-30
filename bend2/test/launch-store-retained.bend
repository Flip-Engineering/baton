# Retained-launch regression for the OMP and Muse configured store binding
# (#933) and the Claude Code launch environment (#1338). It drives the real
# retained composition with a profile record and prints the final argv. No
# provider or credential is contacted. An optional fourth argument names the
# recorded native conversation, so the launch resumes it.
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
      IO.print("keep\t" ++ U32.show(keep_stdin))

def prepared(result: Result<&1,&1,U32 & String,Turn.RetainedLaunch>) -> IO(Unit):
  match result:
    case Fail{error}: IO.die(Unit,2,"retained prepare failed")
    case Done{+launch}: print_launch(launch)

def fixture_command(+harness: String) -> String:
  Bool.pick(String,String.eq(harness,"omp"),"/usr/bin/omp",Bool.pick(String,String.eq(harness,"claude-code"),"/usr/bin/claude","/usr/bin/muse"))

def setup(+db: String, +directory: String, +harness: String) -> IO(Unit):
  do IO<Unit>:
    ensured : Unit <- Accounts.ensure(db)
    made : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,"BEGIN;" ++ C.schema() ++ "COMMIT;")
    seated : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,"INSERT INTO sessions(id,parent,harness,model,effort,workspace) VALUES('store-fixture',NULL," ++ C.q(harness) ++ ",'deepseek/deepseek-flash','max','/fixture/workspace');INSERT INTO executions(session,id,mode,directory,phase,status) VALUES('store-fixture','receive:store-fixture:1','retained'," ++ C.q(directory) ++ ",'starting','');")
    IO.pure(Unit,Unit{})

def prepare(+db: String, +directory: String, +harness: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    setup(db,directory,harness)
    result : Result<&1,&1,U32 & String,Turn.RetainedLaunch> <- Turn.retained_prepare(db,"store-fixture",directory,fixture_command(harness),"deepseek/deepseek-flash","max",session,harness ++ "\n",db ++ ".sessions","fixture prompt","default",False{},"")
    prepared(result)

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
    case +db <> +directory <> +harness <> Nil{}: prepare(db,directory,harness,"")
    case +db <> +directory <> +harness <> +session <> Nil{}: prepare(db,directory,harness,session)
    case other: IO.die(Unit,2,"usage: launch-store-retained DB DIRECTORY HARNESS | --instance-owner DB | --instance-shutdown DB")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
