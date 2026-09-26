import Base
import ./commands.bend as C
import ./store.bend as Store
import ../host/sqlite.bend as DB
import ../git/create-worktree.bend as CW
import ../git/status.bend as WS
import ../git/process.bend as Git
import ../git/types.bend as G
import ../git/text.bend as Tx
import ../json/canonical.bend as J

# SQLite text output has one terminating newline.
def line_tail(rest: String, original: String, newline: Bool) -> String:
  match newline:
    case True{}: Tx.str_rev(rest)
    case False{}: original

def line_reversed(s: String, original: String) -> String:
  match s:
    case SNil{}: original
    case SCon{c,rest}: line_tail(rest,original,Char.is_eq(c,Char.from_u32(10)))

def line(+s: String) -> String:
  line_reversed(Tx.str_rev(s),s)

def absolute(repo: String, path: String, rooted: Bool) -> String:
  match rooted:
    case True{}: path
    case False{}: repo ++ "/" ++ path

def git_status(code: U32, out: String, success: Bool) -> IO(String):
  match success:
    case True{}: IO.pure(String,out)
    case False{}: IO.die(String,code,out)

def git_output(result: G.GitOut) -> IO(String):
  match result:
    case G.GBroken{detail}: IO.die(String,1,detail)
    case G.GRun{+code,out}: git_status(code,out,U32.is_eq(code,0))

def require_parent(found: Bool) -> IO(Unit):
  match found:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: IO.die(Unit,2,"The parent session is not registered.")

def register(db: String, id: String, parent: String, harness: String, model: String, effort: String, made: Result<&1,&1,G.GitFail,G.WorktreeCreated>) -> IO(Unit):
  match made:
    case Fail{error}: IO.die(Unit,1,G.fail_text(error))
    case Done{G.WCreated{branch,path,base}}:
      do IO<Unit>:
        saved : String <- IO.try(String,Store.apply(db,C.Worker{id,parent,harness,model,effort,path,branch,base}))
        IO.write(saved)

def create(+db: String,id: String,parent: String,harness: String,model: String,effort: String,repo: String,branch: String,path: String,base: String,exists: Bool) -> IO(Unit):
  match exists:
    case True{}: register(db,id,parent,harness,model,effort,Done{G.WCreated{branch,path,base}})
    case False{}:
      do IO<Unit>:
        made : Result<&1,&1,G.GitFail,G.WorktreeCreated> <- CW.createWorktree(repo,branch,path,base)
        register(db,id,parent,harness,model,effort,made)

def recruit(+db: String,+id: String,+parent: String,harness: String,model: String,effort: String,+repo: String,branch: String,+path: String,base: String) -> IO(Unit):
  do IO<Unit>:
    parent_row : String <- IO.try(String,Store.apply(db,C.Session{parent}))
    present : Unit <- require_parent(Bool.not(String.is_empty(parent_row)))
    root_result : G.GitOut <- Git.runGit(repo,["rev-parse","--show-toplevel"])
    root : String <- git_output(root_result)
    base_result : G.GitOut <- Git.runGit(repo,["rev-parse","--verify","--end-of-options",base ++ "^{commit}"])
    commit : String <- git_output(base_result)
    existing : String <- IO.try(String,Store.apply(db,C.Session{id}))
    create(db,id,parent,harness,model,effort,repo,branch,absolute(root,path,Tx.starts_with(path,"/")),commit,Bool.not(String.is_empty(existing)))

def show_status(id: String,path: String,result: Result<&1,&1,G.GitFail,G.WtStatus>) -> IO(Unit):
  match result:
    case Fail{error}: IO.die(Unit,1,G.fail_text(error))
    case Done{G.Wt{branch,commit,dirty}}:
      IO.print("{\"id\":" ++ J.string_literal(id) ++ ",\"workspace\":" ++ J.string_literal(path) ++ ",\"branch\":" ++ J.string_literal(branch) ++ ",\"commit\":" ++ J.string_literal(commit) ++ ",\"dirty\":" ++ Bool.pick(String,dirty,"true","false") ++ "}")

def inspect_path(id: String,+path: String,missing: Bool) -> IO(Unit):
  match missing:
    case True{}: IO.die(Unit,2,"The worker has no recorded workspace.")
    case False{}:
      do IO<Unit>:
        status : Result<&1,&1,G.GitFail,G.WtStatus> <- WS.worktreeStatus(path)
        show_status(id,path,status)

def inspect(+db: String,+id: String) -> IO(Unit):
  do IO<Unit>:
    ready : String <- IO.try(String,Store.apply(db,C.Session{id}))
    +path : String <- IO.try(String,DB.Sql.query(db,"SELECT workspace FROM sessions WHERE id=" ++ C.q(id) ++ ";"))
    inspect_path(id,line(path),String.is_empty(ready))
