import Base
import ../src/coordinator/repl-runtime.bend as Runtime
import ../src/coordinator/repl-model.bend as M
import ../src/coordinator/commands.bend as C
import ../src/host/files.bend as Files
import ../src/host/text.bend as T
import ../src/host/instance.bend as Custody

# F3 focused check, mirroring the two f4c0c53 F3 fixture cases at the
# Runtime.execute boundary: a settled compiler attempt and the native
# release-to-acknowledge window both keep their recorded lane byte-identical.
def ensure(condition: Bool, message: String) -> IO(Unit):
  match condition:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: IO.die(Unit,1,message)

def unchanged(+db: String, +cell: String, +stage: String, +stdout: String) -> IO(Unit):
  do IO<Unit>:
    +found : String <- M.scalar(db,"SELECT CASE WHEN wait_status='exit 0' AND cause='' AND stdout=" ++ C.q(stdout) ++ " THEN 'unchanged' ELSE 'changed' END FROM repl_attempts WHERE cell=" ++ C.q(cell) ++ " AND stage=" ++ C.q(stage))
    ensure(String.eq(found,"unchanged"),"F3 " ++ stage ++ " settled attempt changed: " ++ found)

def write_file(+path: String, +text: String) -> IO(Unit):
  do IO<Unit>:
    created : Unit <- IO.try(Unit,Files.Files.mkdir(path))
    written : String <- IO.try(String,T.Text.write_at(path ++ "/stdout","0",text,1))
    IO.pure(Unit,Unit{})

def cell_sql(+db: String, +cell: String, +source: String) -> IO(Unit):
  M.write(db,"INSERT INTO repl_cells(id,notebook,operation,source,expected_type,label,snapshot) VALUES(" ++ C.q(cell) ++ ",'nb','eval'," ++ C.q(source) ++ ",'','','[]');")

def attempt_sql(+db: String, +cell: String, +stage: String, +directory: String, +stdout: String) -> IO(Unit):
  M.write(db,"INSERT INTO repl_attempts(cell,stage,directory,argv,input,stdout,stderr,wait_status,cause) VALUES(" ++ C.q(cell) ++ "," ++ C.q(stage) ++ "," ++ C.q(directory) ++ ",'[]',''," ++ C.q(stdout) ++ ",'','exit 0','');")

def prepare_state(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    ensured : Unit <- M.ensure(db)
    session : Unit <- M.write(db,"INSERT OR IGNORE INTO sessions(id,harness) VALUES('critic','fixture');")
    notebook : Unit <- M.write(db,"INSERT OR IGNORE INTO repl_notebooks(id,owner,name,workspace,compiler) VALUES('nb','critic','main'," ++ C.q(root) ++ "," ++ C.q(root) ++ ");")
    IO.pure(Unit,Unit{})

def settled_compiler(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    +cell : String = "repl-cell:f3-compiler"
    +stdout : String = "{\"protocol\":1,\"kind\":\"definitions\"}\n"
    +directory : String = db ++ "." ++ cell ++ ".compiler"
    created : Unit <- write_file(directory,stdout)
    inserted : Unit <- cell_sql(db,cell,"def fixture() -> U32:\n  1\n")
    attempt : Unit <- attempt_sql(db,cell,"compiler",directory,stdout)
    recovered : Unit <- Runtime.execute(db,"critic","nb",cell)
    checked : Unit <- unchanged(db,cell,"compiler",stdout)
    IO.pure(Unit,Unit{})

def custody_window(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    +cell : String = "repl-cell:f3-window"
    +compiler_stdout : String = "{\"protocol\":1,\"kind\":\"native\"}\n"
    +native_stdout : String = "{\"protocol\":1,\"kind\":\"native\",\"value\":\"window\"}\n"
    +compiler_dir : String = db ++ "." ++ cell ++ ".compiler"
    +native_dir : String = db ++ "." ++ cell ++ ".native"
    compiler_file : Unit <- write_file(compiler_dir,compiler_stdout)
    native_file : Unit <- write_file(native_dir,native_stdout)
    launched : String <- IO.try(String,T.Text.write_at(native_dir ++ "/launch","0","native\n",1))
    released : String <- IO.try(String,T.Text.write_at(native_dir ++ "/released","0","released\n",1))
    inserted : Unit <- cell_sql(db,cell,"IO.write(\"window\")\n")
    compiler : Unit <- attempt_sql(db,cell,"compiler",compiler_dir,compiler_stdout)
    native : Unit <- attempt_sql(db,cell,"native",native_dir,native_stdout)
    recovered : Unit <- Runtime.execute(db,"critic","nb",cell)
    compiler_check : Unit <- unchanged(db,cell,"compiler",compiler_stdout)
    native_check : Unit <- unchanged(db,cell,"native",native_stdout)
    IO.pure(Unit,Unit{})

def custody_cleanup(+db: String) -> IO(Unit):
  do IO<Unit>:
    +cell : String = "repl-cell:f3-custody"
    +stdout : String = "{\"protocol\":1,\"kind\":\"definitions\"}\n"
    inserted : Unit <- cell_sql(db,cell,"def fixture() -> U32:\n  1\n")
    attempt : Unit <- attempt_sql(db,cell,"compiler","/unused",stdout)
    fresh_failure : Unit <- Runtime.cleanup(db,cell,"compiler",True{},Fail{(3,"release failed")},Done{Unit{}})
    +recorded : String <- M.scalar(db,"(SELECT cause FROM repl_attempts WHERE cell=" ++ C.q(cell) ++ " AND stage='compiler')")
    ensure(String.eq(recorded,"3: release failed"),"F3 fresh custody failure was not recorded: " ++ recorded)
    settled_failure : Unit <- Runtime.cleanup(db,cell,"compiler",False{},Fail{(3,"second failure")},Done{Unit{}})
    +after : String <- M.scalar(db,"(SELECT cause FROM repl_attempts WHERE cell=" ++ C.q(cell) ++ " AND stage='compiler')")
    ensure(String.eq(after,"3: release failed"),"F3 settled custody failure changed the cause: " ++ after)
    IO.pure(Unit,Unit{})

def run(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    prepared : Unit <- prepare_state(db,root)
    compiler : Unit <- settled_compiler(db,root)
    window : Unit <- custody_window(db,root)
    custody : Unit <- custody_cleanup(db)
    stopped : Unit <- IO.try(Unit,Custody.Instance.shutdown(db))
    IO.print("f3-ok")

def cli(args: List<String>) -> IO(Unit):
  match args:
    case "--instance-owner" <> database <> Nil{}: IO.try(Unit,Custody.Instance.owner(database))
    case db <> root <> Nil{}: run(db,root)
    case _: IO.die(Unit,2,"DATABASE ROOT")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    cli(args)
