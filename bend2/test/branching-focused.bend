# Focused fixture for the Branching Ensemble packet. It drives the production
# branching-model, branching-workspace and branching command modules over a
# temporary coordination database and real Git repositories.
#
# Covered behavior:
#   - snapshot isolation: the source checkout keeps its HEAD and index, and the
#     snapshot commit is a child of the source HEAD
#   - forked candidate isolation: two worktrees created from one snapshot keep
#     separate files and branches, and neither changes the source checkout
#   - lineage: each candidate commit descends from the snapshot commit, and the
#     candidate records keep distinct sessions, workspaces and branches
#   - winner/flush: automatic selection retains the best accepted evaluation of
#     the round and stop_children flushes every candidate through the native
#     command path
#
# usage: branching-focused DB ROOT
# The same binary answers the child invocation [DB agent-native-input] by
# recording one flush event and exiting 0.
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/branching.bend as B
import ../src/coordinator/branching-model.bend as M
import ../src/coordinator/branching-workspace.bend as W
import ../src/host/sqlite.bend as DB
import ../src/host/files.bend as F
import ../src/git/process.bend as Git
import ../src/git/create-worktree.bend as CW
import ../src/git/types.bend as G
import ../src/git/text.bend as Tx

def expect(+label: String, ok: Bool) -> IO(Unit):
  Bool.pick(IO(Unit),ok,IO.print("fixture-branching " ++ label ++ ": ok"),IO.die(Unit,1,"fixture-branching " ++ label ++ ": refused"))

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

def git_result(result: G.GitOut) -> IO(String):
  match result:
    case G.GRun{+code,+out}: do IO<String>:
      +shown : String <- IO.pure(String,out)
      ok : Unit <- expect("git-" ++ Tx.trim_nl(shown),U32.is_eq(code,0))
      IO.pure(String,shown)
    case G.GBroken{detail}: IO.die(String,2,detail)

def git_code_result(result: G.GitOut) -> IO(U32):
  match result:
    case G.GRun{code,out}: IO.pure(U32,code)
    case G.GBroken{detail}: IO.die(U32,2,detail)

def git_output(dir: String, args: List<String>) -> IO(String):
  do IO<String>:
    result : G.GitOut <- Git.runGit(dir,args)
    git_result(result)

def git_code(dir: String, args: List<String>) -> IO(U32):
  do IO<U32>:
    result : G.GitOut <- Git.runGit(dir,args)
    git_code_result(result)

def write_file(dir: String, name: String, text: String) -> IO(Unit):
  IO.try(Unit,F.Files.write_private(dir ++ "/" ++ name,text))

def require_worktree(result: Result<&1,&1,G.GitFail,G.WorktreeCreated>, label: String) -> IO(Unit):
  match result:
    case Done{commit}: IO.pure(Unit,Unit{})
    case Fail{error}: IO.die(Unit,2,label)

def setup(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    schema : String <- IO.try(String,DB.Sql.query(db,C.schema()))
    ensured : Unit <- M.ensure(db)
    made : Unit <- IO.try(Unit,F.Files.mkdir(root))
    events : Unit <- query(db,"CREATE TABLE IF NOT EXISTS flush_events(id INTEGER PRIMARY KEY AUTOINCREMENT);")
    conductor : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,observed_harness,observed_model,observed_effort,endpoint,workspace,branch,base) VALUES('root',NULL,'omp','fixture','high','native-root','','','','/bin/true','','','');")
    ensemble : Unit <- query(db,"INSERT INTO ensembles(id,owner,coupling) VALUES('fixture-ensemble','root','tight');")
    IO.pure(Unit,Unit{})

def source_repo(+db: String, +root: String) -> IO(String):
  do IO<String>:
    +src : String = root ++ "/source"
    made : Unit <- IO.try(Unit,F.Files.mkdir(src))
    init : String <- git_output(src,["init","-q"])
    email : String <- git_output(src,["config","user.email","fixture@example.com"])
    name : String <- git_output(src,["config","user.name","Baton Fixture"])
    base : Unit <- write_file(src,"base.txt","base\n")
    added : String <- git_output(src,["add","-A"])
    committed : String <- git_output(src,["commit","-q","-m","fixture base"])
    +head : String <- git_output(src,["rev-parse","--verify","HEAD"])
    inserted : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,observed_harness,observed_model,observed_effort,endpoint,workspace,branch,base) VALUES('source','root','omp','fixture','high','native-source','','','','/bin/true'," ++ C.q(src) ++ ",'','');")
    IO.pure(String,src)

def snapshot_case(+db: String, +src: String, +root: String) -> IO(String):
  do IO<String>:
    +before : String <- git_output(src,["rev-parse","--verify","HEAD"])
    +snapshot : String <- W.snapshot(db,src,"round-iso","[]")
    +after : String <- git_output(src,["rev-parse","--verify","HEAD"])
    +clean : String <- git_output(src,["status","--porcelain"])
    expect("snapshot-preserves-source-head",String.eq(before,after))
    expect("snapshot-leaves-source-index-clean",String.is_empty(Tx.trim_nl(clean)))
    +parent : String <- git_output(src,["rev-parse","--verify",snapshot ++ "^"])
    expect("snapshot-child-of-source-head",String.eq(Tx.trim_nl(parent),Tx.trim_nl(before)))
    IO.pure(String,snapshot)

def candidate_case(+db: String, +src: String, +root: String, +snapshot: String) -> IO(Unit):
  do IO<Unit>:
    +path_a : String = root ++ "/candidate-a"
    +path_b : String = root ++ "/candidate-b"
    made_a : Result<&1,&1,G.GitFail,G.WorktreeCreated> <- CW.createWorktree(src,"baton/fixture-a",path_a,snapshot)
    made_b : Result<&1,&1,G.GitFail,G.WorktreeCreated> <- CW.createWorktree(src,"baton/fixture-b",path_b,snapshot)
    ready_a : Unit <- require_worktree(made_a,"candidate-a worktree refused")
    ready_b : Unit <- require_worktree(made_b,"candidate-b worktree refused")
    alpha : Unit <- write_file(path_a,"candidate.txt","alpha\n")
    beta : Unit <- write_file(path_b,"candidate.txt","beta\n")
    add_a : String <- git_output(path_a,["add","-A"])
    add_b : String <- git_output(path_b,["add","-A"])
    commit_a : String <- git_output(path_a,["commit","-q","-m","candidate alpha"])
    commit_b : String <- git_output(path_b,["commit","-q","-m","candidate beta"])
    +shown_a : String <- git_output(path_a,["show","HEAD:candidate.txt"])
    +shown_b : String <- git_output(path_b,["show","HEAD:candidate.txt"])
    expect("candidate-a-keeps-alpha",String.eq(shown_a,"alpha\n"))
    expect("candidate-b-keeps-beta",String.eq(shown_b,"beta\n"))
    expect("candidates-keep-separate-content",Bool.not(String.eq(shown_a,shown_b)))
    absent_code : U32 <- git_code(src,["cat-file","-e","HEAD:candidate.txt"])
    expect("candidate-change-absent-from-source",Bool.not(U32.is_eq(absent_code,0)))
    +branch_a : String <- git_output(path_a,["symbolic-ref","--short","HEAD"])
    +branch_b : String <- git_output(path_b,["symbolic-ref","--short","HEAD"])
    expect("candidate-branches-distinct",Bool.not(String.eq(Tx.trim_nl(branch_a),Tx.trim_nl(branch_b))))
    +count_a : String <- git_output(path_a,["rev-list","--count",snapshot ++ "..HEAD"])
    +count_b : String <- git_output(path_b,["rev-list","--count",snapshot ++ "..HEAD"])
    expect("candidate-a-lineage-single-commit",String.eq(Tx.trim_nl(count_a),"1"))
    expect("candidate-b-lineage-single-commit",String.eq(Tx.trim_nl(count_b),"1"))
    ancestor_a : U32 <- git_code(path_a,["merge-base","--is-ancestor",snapshot,"HEAD"])
    ancestor_b : U32 <- git_code(path_b,["merge-base","--is-ancestor",snapshot,"HEAD"])
    expect("candidate-a-descends-from-snapshot",U32.is_eq(ancestor_a,0))
    expect("candidate-b-descends-from-snapshot",U32.is_eq(ancestor_b,0))
    IO.pure(Unit,Unit{})

def isolation_records(+db: String, +src: String, +root: String, +snapshot: String) -> IO(Unit):
  do IO<Unit>:
    round : Unit <- query(db,"INSERT INTO branch_rounds(id,ensemble,owner,source,ancestor,workspace,branch_count,snapshot,task,inputs,knowledge,includes,evaluator,direction,harness,model,effort,command) VALUES('round-iso','fixture-ensemble','root','source',NULL," ++ C.q(src) ++ ",2," ++ C.q(snapshot) ++ ",'fixture task','[]','[]','[]','[\"/bin/true\"]','max','omp','fixture','high','/bin/true');")
    prepared : Unit <- B.prepare_candidates(db,"round-iso",root,2)
    expect_read(db,"SELECT count(*) FROM branch_candidates WHERE round='round-iso';","2\n","candidate-records-count")
    expect_read(db,"SELECT count(DISTINCT session) FROM branch_candidates WHERE round='round-iso';","2\n","candidate-sessions-distinct")
    expect_read(db,"SELECT count(DISTINCT workspace) FROM branch_candidates WHERE round='round-iso';","2\n","candidate-workspaces-distinct")
    expect_read(db,"SELECT count(DISTINCT branch) FROM branch_candidates WHERE round='round-iso';","2\n","candidate-branch-labels-distinct")
    IO.pure(Unit,Unit{})

def winner_cases(+db: String, +src: String, +root: String, +snapshot: String) -> IO(Unit):
  do IO<Unit>:
    +path_a : String = root ++ "/candidate-a"
    +path_b : String = root ++ "/candidate-b"
    round : Unit <- query(db,"INSERT INTO branch_rounds(id,ensemble,owner,source,ancestor,workspace,branch_count,snapshot,task,inputs,knowledge,includes,evaluator,direction,harness,model,effort,command) VALUES('round-win','fixture-ensemble','root','source',NULL," ++ C.q(src) ++ ",2," ++ C.q(snapshot) ++ ",'fixture winner task','[]','[]','[]','[\"/bin/true\"]','max','omp','fixture','high','/bin/true');")
    candidates : Unit <- query(db,"INSERT INTO branch_candidates(round,ordinal,session,workspace,branch) VALUES('round-win',0,'cand-a'," ++ C.q(path_a) ++ ",'baton/fixture-a'),('round-win',1,'cand-b'," ++ C.q(path_b) ++ ",'baton/fixture-b');")
    session_a : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,observed_harness,observed_model,observed_effort,endpoint,workspace,branch,base) VALUES('cand-a','root','omp','fixture','high','native-a','','','','/bin/true'," ++ C.q(path_a) ++ ",'baton/fixture-a'," ++ C.q(snapshot) ++ ");")
    session_b : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,observed_harness,observed_model,observed_effort,endpoint,workspace,branch,base) VALUES('cand-b','root','omp','fixture','high','native-b','','','','/bin/true'," ++ C.q(path_b) ++ ",'baton/fixture-b'," ++ C.q(snapshot) ++ ");")
    execution_a : Unit <- query(db,"INSERT INTO executions(session,id,mode,directory,phase,status) VALUES('cand-a','exec-a','managed'," ++ C.q(path_a) ++ ",'exited','exit 0');")
    execution_b : Unit <- query(db,"INSERT INTO executions(session,id,mode,directory,phase,status) VALUES('cand-b','exec-b','managed'," ++ C.q(path_b) ++ ",'exited','exit 0');")
    evaluation_a : Unit <- query(db,"INSERT INTO branch_evaluations(id,round,session,snapshot,workspace,argv,native,attempt,phase,native_status,result,accepted,score) VALUES('eval-a','round-win','cand-a'," ++ C.q(snapshot) ++ "," ++ C.q(path_a) ++ ",'[\"/bin/true\"]','native-a'," ++ C.q(path_a) ++ ",'exited','exit 0',NULL,1,0.9);")
    evaluation_b : Unit <- query(db,"INSERT INTO branch_evaluations(id,round,session,snapshot,workspace,argv,native,attempt,phase,native_status,result,accepted,score) VALUES('eval-b','round-win','cand-b'," ++ C.q(snapshot) ++ "," ++ C.q(path_b) ++ ",'[\"/bin/true\"]','native-b'," ++ C.q(path_b) ++ ",'exited','exit 0',NULL,1,0.4);")
    selected : Unit <- B.select(db,"root","round-win",Nil{})
    expect_read(db,"SELECT session FROM branch_selections WHERE round='round-win';","cand-a\n","winner-best-accepted-score")
    flushed : Unit <- B.stop_children(db,"round-win","fixture flush",Con{"63616e642d61",Con{"63616e642d62",Nil{}}})
    expect_read(db,"SELECT count(*) FROM flush_events;","2\n","flush-reaches-every-candidate")
    expect_read(db,"SELECT count(*) FROM branch_operations WHERE round='round-win' AND operation='stop' AND json_extract(result,'$.status')='completed';","2\n","flush-operations-completed")
    expect_read(db,"SELECT session FROM branch_selections WHERE round='round-win';","cand-a\n","winner-retained-after-flush")
    IO.pure(Unit,Unit{})

def fixture(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    setup(db,root)
    +src : String <- source_repo(db,root)
    +snapshot : String <- snapshot_case(db,src,root)
    candidate_case(db,src,root,snapshot)
    isolation_records(db,src,root,snapshot)
    winner_cases(db,src,root,snapshot)
    IO.print("fixture-branching-ok")

def child(+db: String) -> IO(Unit):
  do IO<Unit>:
    event : Unit <- query(db,"INSERT INTO flush_events DEFAULT VALUES;")
    IO.pure(Unit,Unit{})

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case +db <> "agent-native-input" <> Nil{}: child(db)
    case +db <> +root <> Nil{}: fixture(db,root)
    case other: IO.die(Unit,2,"usage: branching-focused DB ROOT")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
