import Base
import ./commands.bend as C
import ./store.bend as Store
import ../host/sqlite.bend as DB
import ../host/text.bend as T
import ../host/process.bend as P
import ../harness/claude-worker.bend as Claude

def error_text(error: U32 & String) -> String:
  (code,text)=error
  U32.show(code) ++ ": " ++ text

def remember(+previous: String, result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Fail{error}: Bool.pick(String,String.is_empty(previous),error_text(error),previous)
    case Done{value}: previous

def remember_write(previous: String, result: Result<&1,&1,U32 & String,Unit>) -> String:
  match result:
    case Fail{error}: remember(previous,Fail{error})
    case Done{unit}: previous

def report(db: String, worker: String, id: String, body: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,Store.apply(db,C.Report{id,worker,body}))
    IO.write(saved)

def diagnostic(db: String, worker: String, id: String, text: String, empty: Bool) -> IO(Unit):
  match empty:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: report(db,worker,id ++ ":observation","Native output observation failed: " ++ text)

def result_missing(db: String, worker: String, id: String, +log: String, status: String, found: Bool) -> IO(Unit):
  match found:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: report(db,worker,id,"Worker process ended without a native result (" ++ status ++ "). Output: " ++ log ++ ". Stderr: " ++ log ++ ".stderr")

def exit_failure(db: String, worker: String, id: String, status: String, success: Bool) -> IO(Unit):
  match success:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: report(db,worker,id ++ ":exit","Worker process ended with " ++ status)

def finished(+db: String, +worker: String, +id: String, log: String, +first_error: String, +status: String) -> IO(Unit):
  do IO<Unit>:
    result : String <- IO.try(String,DB.Sql.query(db,"SELECT count(*) FROM turns WHERE id=" ++ C.q(id) ++ ";"))
    noted : Unit <- diagnostic(db,worker,id,first_error,String.is_empty(first_error))
    missing : Unit <- result_missing(db,worker,id,log,status,String.eq(result,"1\n"))
    exit_note : Unit <- exit_failure(db,worker,id,status,String.eq(status,"exit 0"))
    result_report : String <- IO.try(String,Store.apply(db,C.Delivery{id}))
    IO.write(result_report)

def waited(db: String, worker: String, id: String, log: String, first_error: String, result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{error}: finished(db,worker,id,log,first_error,"wait failed: " ++ error_text(error))
    case Done{status}: finished(db,worker,id,log,first_error,status)

def send_result(first: Result<&1,&1,U32 & String,Unit>, closed: Result<&1,&1,U32 & String,Unit>) -> Result<&1,&1,U32 & String,Unit>:
  match first:
    case Fail{error}: Fail{error}
    case Done{unit}: closed

def send_prompt(+handle: U32,prompt: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    sent : Result<&1,&1,U32 & String,Unit> <- Claude.input(handle,prompt)
    closed : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.close_stdin(handle)
    IO.pure(Result<&1,&1,U32 & String,Unit>,send_result(sent,closed))

@unsafe
def consume(+db: String, +worker: String, +id: String, +log: String, +handle: U32, first_error: String, sender: Chan(Result<&1,&1,U32 & String,Unit>), result: Result<&1,&1,U32 & String,Maybe<String>>) -> IO(Unit):
  match result:
    case Fail{error}:
      report(db,worker,id ++ ":read","Native output read failed: " ++ error_text(error) ++ "; output retained at " ++ log)
    case Done{None{}}:
      do IO<Unit>:
        sent : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,sender)
        status : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
        waited(db,worker,id,log,remember_write(first_error,sent),status)
    case Done{Some{+line}}:
      do IO<Unit>:
        written : Result<&1,&1,U32 & String,Unit> <- T.Text.append(log,line ++ "\n")
        observed : Result<&1,&1,U32 & String,String> <- Store.apply(db,C.Observe{id,worker,line})
        next : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.read_line(handle)
        consume(db,worker,id,log,handle,remember(remember_write(first_error,written),observed),sender,next)

def started(+db: String, +worker: String, +id: String, +log: String, prompt: String, result: Result<&1,&1,U32 & String,U32>) -> IO(Unit):
  match result:
    case Fail{error}: report(db,worker,id,"Worker process could not start: " ++ error_text(error))
    case Done{+handle}:
      do IO<Unit>:
        sender : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,send_prompt(handle,prompt))
        first : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.read_line(handle)
        consume(db,worker,id,log,handle,"",sender,first)

def launch(cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String, fresh: Bool) -> IO(Result<&1,&1,U32 & String,U32>):
  match fresh:
    case True{}: Claude.start_worker(cmd,model,effort,cwd,stderr)
    case False{}: Claude.resume_worker(cmd,model,effort,cwd,stderr,session)

def prompt_read(db: String, worker: String, id: String, cmd: String, model: String, effort: String, cwd: String, +log: String, +session: String, result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{error}: report(db,worker,id,"Worker task could not be read: " ++ error_text(error))
    case Done{prompt}:
      do IO<Unit>:
        child : Result<&1,&1,U32 & String,U32> <- launch(cmd,model,effort,cwd,log ++ ".stderr",session,String.is_empty(session))
        started(db,worker,id,log,prompt,child)

def fresh(db: String, worker: String, id: String, cmd: String, model: String, effort: String, cwd: String, task: String, log: String, session: String) -> IO(Unit):
  do IO<Unit>:
    prompt : Result<&1,&1,U32 & String,String> <- T.Text.read(task)
    prompt_read(db,worker,id,cmd,model,effort,cwd,log,session,prompt)

def choose(+db: String, worker: String, +id: String, cmd: String, model: String, effort: String, cwd: String, task: String, log: String, session: String, replay: Bool) -> IO(Unit):
  match replay:
    case True{}:
      do IO<Unit>:
        saved : String <- IO.try(String,Store.apply(db,C.Delivery{id}))
        IO.write(saved)
    case False{}: fresh(db,worker,id,cmd,model,effort,cwd,task,log,session)

def worker_checked(+db: String, +worker: String, +id: String, cmd: String, model: String, effort: String, cwd: String, task: String, log: String, session: String, missing: Bool) -> IO(Unit):
  match missing:
    case True{}: IO.die(Unit,2,"Worker has no recorded parent and workspace; register it before starting a turn.")
    case False{}:
      do IO<Unit>:
        found : String <- IO.try(String,DB.Sql.query(db,"SELECT count(*) FROM messages WHERE id=" ++ C.q(id) ++ ";"))
        choose(db,worker,id,cmd,model,effort,cwd,task,log,session,String.eq(found,"1\n"))

def run(+db: String, +worker: String, id: String, cmd: String, model: String, effort: String, cwd: String, task: String, log: String, session: String) -> IO(Unit):
  do IO<Unit>:
    recorded : String <- IO.try(String,Store.apply(db,C.Session{worker}))
    worker_checked(db,worker,id,cmd,model,effort,cwd,task,log,session,String.is_empty(recorded))
