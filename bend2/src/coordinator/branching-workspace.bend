import Base
import ./branching-model.bend as M
import ./agent-native.bend as Native
import ./agent-domain.bend as D
import ../coordinator/commands.bend as C
import ./recruit.bend as Recruit
import ../git/process.bend as Git
import ../git/types.bend as G
import ../git/text.bend as Tx
import ../host/process.bend as P
import ../host/files.bend as F
import ../host/sqlite.bend as DB
import ../json/canonical.bend as J

# A private index leaves the source checkout's index and HEAD unchanged. The
# snapshot commit includes tracked and nonignored untracked paths. Explicit
# includes add required ignored inputs to the same immutable Git object.
def indexed(+workspace: String, index: String, args: List<String>) -> IO(String):
  do IO<String>:
    result : G.RunRes <- Git.runFull(Con{"env",Con{"GIT_INDEX_FILE=" ++ index,Con{"git",Con{"-C",Con{workspace,args}}}}},".")
    answer : G.GitOut = Git.git_out(result)
    Recruit.git_output("branch workspace snapshot",answer)

def include_paths(+workspace: String, +index: String, paths: List<String>) -> IO(Unit):
  match paths:
    case Nil{}: IO.pure(Unit,Unit{})
    case encoded <> rest: do IO<Unit>:
      added : String <- indexed(workspace,index,["add","--force","--",Native.decoded(encoded)])
      include_paths(workspace,index,rest)

def snapshot(+db: String, +workspace: String, +id: String, includes: String) -> IO(String):
  do IO<String>:
    +index : String = db ++ ".branch-index-" ++ id
    base : G.GitOut <- Git.runGit(workspace,["rev-parse","--verify","HEAD"])
    +parent : String <- Recruit.git_output("branch snapshot HEAD",base)
    loaded : String <- indexed(workspace,index,["read-tree",Tx.trim_nl(parent)])
    added : String <- indexed(workspace,index,["add","--all","--","."])
    paths : String <- IO.try(String,DB.Sql.read(db,"SELECT hex(value) FROM json_each(" ++ C.q(includes) ++ ") ORDER BY CAST(key AS INTEGER);"))
    included : Unit <- include_paths(workspace,index,Tx.split_lines(paths))
    +tree : String <- indexed(workspace,index,["write-tree"])
    result : G.RunRes <- Git.runFull(["env","GIT_AUTHOR_NAME=Baton","GIT_AUTHOR_EMAIL=baton@localhost","GIT_COMMITTER_NAME=Baton","GIT_COMMITTER_EMAIL=baton@localhost","git","-C",workspace,"commit-tree",Tx.trim_nl(tree),"-p",Tx.trim_nl(parent),"-m","Branch workspace snapshot"],".")
    commit : String <- Recruit.git_output("branch snapshot commit",Git.git_out(result))
    removed : Result<&1,&1,U32 & String,Unit> <- F.Files.remove(index)
    IO.pure(String,Tx.trim_nl(commit))

def outcome(result: Result<&1,&1,U32 & String,Native.Outcome>, argv: String) -> String:
  match result:
    case Fail{(code,cause)}:
      "{\"argv\":" ++ argv ++ ",\"stdout\":\"\",\"stderr\":\"\",\"waitStatus\":null,\"cause\":" ++ J.string_literal(U32.show(code) ++ ": " ++ cause) ++ "}"
    case Done{Native.Finished{stdout,stderr,wait,cause}}:
      "{\"argv\":" ++ argv ++ ",\"stdout\":" ++ J.string_literal(stdout) ++ ",\"stderr\":" ++ J.string_literal(stderr) ++ ",\"waitStatus\":" ++ J.string_literal(wait) ++ ",\"cause\":" ++ J.string_literal(cause) ++ "}"

def evaluate_spawned(argv: String, path: String, spawned: Result<&1,&1,U32 & String,U32>) -> IO(String):
  match spawned:
    case Fail{error}: IO.pure(String,outcome(Fail{error},argv))
    case Done{handle}: do IO<String>:
      result : Native.Outcome <- Native.wait_child(handle,path,"")
      IO.pure(String,outcome(Done{result},argv))

def argv_values(rows: List<String>) -> List<String>:
  match rows:
    case Nil{}: Nil{}
    case row <> rest: Con{Native.decoded(row),argv_values(rest)}

# Evaluators receive the declared argv and a separate snapshot checkout as CWD.
# They run with the coordinator user's ordinary filesystem permissions.
def evaluate(+db: String, +workspace: String, +id: String, +argv: String) -> IO(String):
  do IO<String>:
    rows : String <- IO.try(String,DB.Sql.read(db,"SELECT hex(value) FROM json_each(" ++ C.q(argv) ++ ") ORDER BY CAST(key AS INTEGER);"))
    +error : String = db ++ ".branch-evaluator-" ++ id ++ ".stderr"
    spawned : Result<&1,&1,U32 & String,U32> <- P.ProcessChild.spawn(P.argv(argv_values(Tx.split_lines(rows))),workspace,error)
    evaluate_spawned(argv,error,spawned)

def evaluator_valid(+argv: String) -> String:
  "CASE WHEN json_valid(" ++ C.q(argv) ++ ") THEN json_type(" ++ C.q(argv) ++ ")='array' AND json_array_length(" ++ C.q(argv) ++ ")>0 AND NOT EXISTS(SELECT 1 FROM json_each(" ++ C.q(argv) ++ ") WHERE type<>'text' OR instr(value,char(0))>0) AND coalesce(json_extract(" ++ C.q(argv) ++ ",'$[0]'),'')<>'' ELSE 0 END"

def paths_valid(+paths: String) -> String:
  "CASE WHEN json_valid(" ++ C.q(paths) ++ ") THEN json_type(" ++ C.q(paths) ++ ")='array' AND NOT EXISTS(SELECT 1 FROM json_each(" ++ C.q(paths) ++ ") WHERE type<>'text' OR value='' OR substr(value,1,1)='/' OR value IN('.','..','.git') OR value LIKE '../%' OR value LIKE '%/../%' OR value LIKE '%/..' OR value LIKE '.git/%' OR value LIKE '%/.git/%' OR value LIKE '%/.git' OR instr(value,char(0))>0) ELSE 0 END"
