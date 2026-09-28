import Base
import ./commands.bend as C
import ./store.bend as Store
import ./root.bend as Root
import ../host/session-lock.bend as Lock
import ./guidance.bend as Guidance
import ../host/sqlite.bend as DB
import ../host/text.bend as T
import ../host/process.bend as P
import ../git/text.bend as Tx
import ../harness/claude-worker.bend as Claude
import ../harness/omp-worker.bend as Omp
import ../harness/muse-worker.bend as Muse
import ../harness/codex-worker.bend as Codex
import ../git/process.bend as GitProc
import ../git/types.bend as G

type Outcome is Data:
  Ended{status: String, event: String, error: String}

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
    saved : String <- IO.try(String,Store.commit(db,C.Report{id,worker,body}))
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

def failed(+status: String, +event: String, error: String) -> Bool:
  Bool.or(Bool.not(String.eq(status,"exit 0")),Bool.or(String.is_empty(event),Bool.not(String.is_empty(error))))

def combine(first: Result<&1,&1,U32 & String,Unit>, second: Result<&1,&1,U32 & String,Unit>) -> Result<&1,&1,U32 & String,Unit>:
  match first:
    case Fail{error}: Fail{error}
    case Done{unit}: second

def delivery_result(+error: String) -> Result<&1,&1,U32 & String,Unit>:
  Bool.pick(Result<&1,&1,U32 & String,Unit>,String.is_empty(error),Done{Unit{}},Fail{(1,error)})

def prepare_finished(+db: String, +worker: String, +id: String, log: String, +error: String, +status: String) -> IO(Unit):
  do IO<Unit>:
    result : String <- IO.try(String,DB.Sql.query(db,"SELECT count(*) FROM turns WHERE id=" ++ C.q(id) ++ ";"))
    noted : Unit <- diagnostic(db,worker,id,error,String.is_empty(error))
    missing : Unit <- result_missing(db,worker,id,log,status,String.eq(result,"1\n"))
    exit_failure(db,worker,id,status,String.eq(status,"exit 0"))

def prepare_worker(db: String, worker: String, id: String, log: String, error: String, status: String, early: Bool) -> IO(Unit):
  match early:
    case False{}: prepare_finished(db,worker,id,log,error,status)
    case True{}: report(db,worker,id,error)

def prepare_parent(db: String, worker: String, id: String, log: String, outcome: Outcome, parent: Bool) -> IO(Unit):
  match outcome:
    case Ended{+status,event,error}:
      match parent:
        case False{}: IO.pure(Unit,Unit{})
        case True{}: prepare_worker(db,worker,id,log,error,status,Bool.or(String.eq(status,"start failed"),String.eq(status,"input failed")))

# Failure reports are committed while this invocation still owns the session.
def prepare(+db: String, +worker: String, id: String, log: String, outcome: Outcome) -> IO(Unit):
  do IO<Unit>:
    parent : String <- IO.try(String,DB.Sql.query(db,"SELECT parent IS NOT NULL FROM sessions WHERE id=" ++ C.q(worker) ++ ";"))
    prepare_parent(db,worker,id,log,outcome,String.eq(parent,"1\n"))

def worker_finished(+db: String, +id: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +saved : String <- IO.try(String,Store.commit(db,C.Delivery{id}))
    diagnostic_delivery : Result<&1,&1,U32 & String,String> <- Root.deliver(db,id ++ ":observation","1","")
    delivered : Result<&1,&1,U32 & String,String> <- Root.deliver(db,id,"1",saved)
    exit_delivery : Result<&1,&1,U32 & String,String> <- Root.deliver(db,id ++ ":exit","1","")
    written : Unit <- IO.write(saved)
    IO.pure(Result<&1,&1,U32 & String,Unit>,delivery_result(remember(remember(remember("",diagnostic_delivery),delivered),exit_delivery)))

def finish_parent(db: String, worker: String, id: String, log: String, outcome: Outcome, parent: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match outcome:
    case Ended{+status,+event,error}:
      match parent:
        case True{}: worker_finished(db,id)
        case False{}: do IO<Result<&1,&1,U32 & String,Unit>>:
          output : String <- IO.try(String,DB.Sql.query(db,"SELECT json_object('session'," ++ C.q(worker) ++ ",'status'," ++ C.q(status) ++ ",'event',CASE WHEN " ++ C.q(event) ++ "='' THEN NULL ELSE json(" ++ C.q(event) ++ ") END,'error'," ++ C.q(error) ++ ");"))
          written : Unit <- IO.write(output)
          IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})

def finish(+db: String, +worker: String, id: String, log: String, outcome: Outcome) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    parent : String <- IO.try(String,DB.Sql.query(db,"SELECT parent IS NOT NULL FROM sessions WHERE id=" ++ C.q(worker) ++ ";"))
    finish_parent(db,worker,id,log,outcome,String.eq(parent,"1\n"))

def status_text(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Fail{error}: "wait failed: " ++ error_text(error)
    case Done{status}: status

def send_result(first: Result<&1,&1,U32 & String,Unit>, closed: Result<&1,&1,U32 & String,Unit>) -> Result<&1,&1,U32 & String,Unit>:
  match first:
    case Fail{error}: Fail{error}
    case Done{unit}: closed

def input(+handle: U32, +prompt: String, +harness: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  Bool.pick(IO(Result<&1,&1,U32 & String,Unit>), String.eq(harness,"omp\n"),
    Omp.input(handle,prompt),
  Bool.pick(IO(Result<&1,&1,U32 & String,Unit>), String.eq(harness,"muse\n"),
    Muse.input(handle,prompt),
  Bool.pick(IO(Result<&1,&1,U32 & String,Unit>), String.eq(harness,"codex\n"),
    Codex.input(handle,prompt),
    Claude.input(handle,prompt))))

def close_input(handle: U32, open: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match open:
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case False{}: P.ProcessChild.close_stdin(handle)

def send_prompt(+handle: U32,prompt: String,+harness: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    sent : Result<&1,&1,U32 & String,Unit> <- input(handle,prompt,harness)
    closed : Result<&1,&1,U32 & String,Unit> <- close_input(handle,String.eq(harness,"omp\n"))
    IO.pure(Result<&1,&1,U32 & String,Unit>,send_result(sent,closed))

def codex_report(db: String, worker: String, id: String, event: String, empty: Bool) -> IO(Unit):
  match empty:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: do IO<Unit>:
      saved : String <- IO.try(String,Store.commit(db,C.Observe{id,worker,event}))
      IO.pure(Unit,Unit{})

def codex_result_sql(source: String) -> String:
  +events = "'[' || replace(trim(" ++ C.q(source) ++ ",char(10)),char(10),',') || ']'"
  "SELECT json_object('type','result','is_error',json_extract(e.value,'$.type')='turn.failed','nativeEvent',json(e.value),'result',CASE WHEN json_extract(e.value,'$.type')='turn.failed' THEN json_extract(e.value,'$.error.message') ELSE (SELECT json_extract(m.value,'$.item.text') FROM json_each(" ++ events ++ ") m WHERE m.key<e.key AND json_extract(m.value,'$.type')='item.completed' AND json_extract(m.value,'$.item.type')='agent_message' ORDER BY m.key DESC LIMIT 1) END) FROM json_each(" ++ events ++ ") e WHERE json_extract(e.value,'$.type') IN ('turn.completed','turn.failed') ORDER BY e.key DESC LIMIT 1;"

# Keep this invocation's latest Codex assistant message and terminal event.
def codex_finished(+db: String, worker: String, id: String, source: String, previous: String, codex: Bool) -> IO(String):
  match codex:
    case False{}: IO.pure(String,previous)
    case True{}: do IO<String>:
      +event : String <- IO.try(String,DB.Sql.query(db,codex_result_sql(source)))
      saved : Unit <- codex_report(db,worker,id,event,String.is_empty(event))
      IO.pure(String,event)

# The live issue-608-reclaim turn emitted its report in message_end, then an
# agent_end with messages=[] and messageCount=352. Keep the latest assistant
# message in this reader and use it when the terminal envelope omits messages.
# The native log keeps both original frames.
def omp_message(db: String, +event: String, previous: String, enabled: Bool) -> IO(String):
  match enabled:
    case False{}: IO.pure(String,previous)
    case True{}: do IO<String>:
      message : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN json_extract(" ++ C.q(event) ++ ",'$.type')='message_end' AND json_extract(" ++ C.q(event) ++ ",'$.message.role')='assistant' THEN json_extract(" ++ C.q(event) ++ ",'$.message') ELSE " ++ C.q(previous) ++ " END;"))
      IO.pure(String,Tx.trim_nl(message))

def omp_terminal(db: String, +event: String, +message: String, enabled: Bool) -> IO(String):
  match enabled:
    case False{}: IO.pure(String,event)
    case True{}: do IO<String>:
      normalized : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN json_extract(" ++ C.q(event) ++ ",'$.type')='agent_end' AND coalesce(json_extract(" ++ C.q(event) ++ ",'$.isTerminal'),1)=1 AND coalesce(json_array_length(" ++ C.q(event) ++ ",'$.messages'),0)=0 AND " ++ C.q(message) ++ "<>'' THEN json_set(" ++ C.q(event) ++ ",'$.messages',json_array(json(" ++ C.q(message) ++ "))) ELSE " ++ C.q(event) ++ " END;"))
      IO.pure(String,Tx.trim_nl(normalized))

def observe_event(db: String, worker: String, id: String, line: String, relevant: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match relevant:
    case True{}: Store.commit(db,C.Observe{id,worker,line})
    case False{}: IO.pure(Result<&1,&1,U32 & String,String>,Done{""})

def append_frame(log: String, line: String, keep: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match keep:
    case True{}: T.Text.append(log,line ++ "\n")
    case False{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})

# Read the OMP frame type once for log retention and event observation.
def frame_kind(db: String, line: String, omp: Bool) -> IO(String):
  match omp:
    case False{}: IO.pure(String,"")
    case True{}: IO.try(String,DB.Sql.query(db,"WITH frame(value) AS (VALUES(" ++ C.q(line) ++ ")) SELECT CASE WHEN json_valid(value) THEN CASE json_extract(value,'$.type') WHEN 'message_update' THEN 'message_update' WHEN 'response' THEN 'response' WHEN 'message_end' THEN 'message_end' WHEN 'tool_execution_start' THEN 'tool_execution_start' WHEN 'tool_execution_end' THEN 'tool_execution_end' WHEN 'agent_end' THEN 'agent_end' ELSE '' END ELSE '' END FROM frame;"))

# The live #379 trial filled the disk with OMP's cumulative message_update
# snapshots. message_end supplies the complete message; keep every other frame.
def record_frame(log: String, line: String, kind: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  append_frame(log,line,Bool.not(String.eq(kind,"message_update\n")))

def terminal_event(db: String, +event: String, +previous: String, relevant: Bool) -> IO(String):
  match relevant:
    case False{}: IO.pure(String,previous)
    case True{}: do IO<String>:
      selected : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN json_valid(" ++ C.q(event) ++ ") THEN CASE WHEN " ++ C.terminal(event) ++ " THEN " ++ C.q(event) ++ " ELSE " ++ C.q(previous) ++ " END ELSE " ++ C.q(previous) ++ " END;"))
      IO.pure(String,Tx.trim_nl(selected))

def codex_frames(db: String, +previous: String, +line: String, codex: Bool) -> IO(String):
  match codex:
    case False{}: IO.pure(String,previous)
    case True{}: do IO<String>:
      value : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN json_valid(" ++ C.q(line) ++ ") THEN CASE WHEN json_extract(" ++ C.q(line) ++ ",'$.type')='item.completed' AND json_extract(" ++ C.q(line) ++ ",'$.item.type')='agent_message' THEN " ++ C.q(line) ++ " WHEN json_extract(" ++ C.q(line) ++ ",'$.type') IN ('turn.completed','turn.failed') THEN " ++ C.q(previous) ++ " || char(10) || " ++ C.q(line) ++ " ELSE " ++ C.q(previous) ++ " END ELSE " ++ C.q(previous) ++ " END;"))
      IO.pure(String,Tx.trim_nl(value))

@unsafe
def consume(+db: String, +worker: String, +id: String, +log: String, +handle: U32, +harness: String, cursor: String, last_message: String, terminal: String, codex_log: String, first_error: String, sender: Chan(Result<&1,&1,U32 & String,Unit>), result: Result<&1,&1,U32 & String,Maybe<String>>) -> IO(Outcome):
  match result:
    case Fail{error}: do IO<Outcome>:
      closed : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.close_stdin(handle)
      sent : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,sender)
      waited : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
      IO.pure(Outcome,Ended{status_text(waited),terminal,"Native output read failed: " ++ error_text(error)})
    case Done{None{}}:
      do IO<Outcome>:
        sent : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,sender)
        status : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
        event : String <- codex_finished(db,worker,id,codex_log,terminal,String.eq(harness,"codex\n"))
        IO.pure(Outcome,Ended{status_text(status),event,remember_write(first_error,sent)})
    case Done{Some{+line}}:
      do IO<Outcome>:
        +kind : String <- frame_kind(db,line,String.eq(harness,"omp\n"))
        written : Result<&1,&1,U32 & String,Unit> <- record_frame(log,line,kind)
        +relevant : Bool <- IO.pure(Bool,Guidance.relevant(kind,String.eq(harness,"omp\n")))
        next_cursor : String <- Guidance.observe(db,worker,handle,line,cursor,Bool.and(String.eq(harness,"omp\n"),relevant))
        +message : String <- omp_message(db,line,last_message,Bool.and(String.eq(harness,"omp\n"),relevant))
        +event : String <- omp_terminal(db,line,message,Bool.and(String.eq(harness,"omp\n"),relevant))
        observed : Result<&1,&1,U32 & String,String> <- observe_event(db,worker,id,event,relevant)
        ended : String <- terminal_event(db,event,terminal,relevant)
        codex_state : String <- codex_frames(db,codex_log,line,String.eq(harness,"codex\n"))
        next : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.read_line(handle)
        consume(db,worker,id,log,handle,harness,next_cursor,message,ended,codex_state,remember(remember_write(first_error,written),observed),sender,next)

def started(+db: String, +worker: String, +id: String, +log: String, prompt: String, +harness: String, result: Result<&1,&1,U32 & String,U32>) -> IO(Outcome):
  match result:
    case Fail{error}: IO.pure(Outcome,Ended{"start failed","","Worker process could not start: " ++ error_text(error)})
    case Done{+handle}:
      do IO<Outcome>:
        sender : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,send_prompt(handle,prompt,harness))
        first : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.read_line(handle)
        consume(db,worker,id,log,handle,harness,"0\n","","","","",sender,first)

# The retained process sends its initial input once. Reattachment reads the same
# attempt from its first frame so native completion can be reconstructed.
def retained_output(db: String, worker: String, id: String, log: String, +harness: String, +handle: U32) -> IO(Outcome):
  do IO<Outcome>:
    sender : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}))
    first : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.read_line(handle)
    consume(db,worker,id,log,handle,harness,"0\n","","","","",sender,first)

def retained(+db: String, +worker: String, directory: String, +cmd: String, +model: String, +effort: String, cwd: String, +log: String, +session: String, +harness: String, +sessions: String, +prompt: String, lock: U32, recovery: String) -> IO(Result<&1,&1,U32 & String,P.RetainedStart>):
  do IO<Result<&1,&1,U32 & String,P.RetainedStart>>:
    alternate : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN " ++ C.q(sessions) ++ "=" ++ C.q(db ++ ".sessions") ++ " THEN CASE WHEN parent IS NULL THEN " ++ C.q(db ++ ".root-sessions") ++ " ELSE " ++ C.q(db ++ ".session-") ++ " || lower(hex(id)) END ELSE " ++ C.q(db ++ ".sessions") ++ " END FROM sessions WHERE id=" ++ C.q(worker) ++ ";"))
    +native : String <- Omp.resume_file(sessions,Tx.trim_nl(alternate),session,Bool.and(String.eq(harness,"omp\n"),Bool.not(String.is_empty(session))))
    args : String <- IO.pure(String,Bool.pick(String,String.eq(harness,"omp\n"),Omp.argv(cmd,model,effort,sessions,native,String.is_empty(native)),Codex.argv(cmd,model,effort,native,String.is_empty(native))))
    input : String <- IO.pure(String,Bool.pick(String,String.eq(harness,"omp\n"),Omp.prompt(prompt),prompt))
    P.ProcessChild.retain(directory,args,cwd,log ++ ".stderr",input,Bool.pick(U32,String.eq(harness,"omp\n"),1,0),lock,recovery)

def claude_launch(cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String, fresh: Bool) -> IO(Result<&1,&1,U32 & String,U32>):
  match fresh:
    case True{}: Claude.start_worker(cmd,model,effort,cwd,stderr)
    case False{}: Claude.resume_worker(cmd,model,effort,cwd,stderr,session)

def muse_launch(cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String, task: String, fresh: Bool) -> IO(Result<&1,&1,U32 & String,U32>):
  match fresh:
    case True{}: Muse.start_worker(cmd,model,effort,cwd,stderr,task)
    case False{}: Muse.resume_worker(cmd,model,effort,cwd,stderr,session,task)

def launch(sessions: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, +session: String, +harness: String, task: String) -> IO(Result<&1,&1,U32 & String,U32>):
  Bool.pick(IO(Result<&1,&1,U32 & String,U32>), String.eq(harness,"omp\n"),
    Omp.start_worker(cmd,model,effort,cwd,log,sessions,session,String.is_empty(session)),
  Bool.pick(IO(Result<&1,&1,U32 & String,U32>), String.eq(harness,"muse\n"),
    muse_launch(cmd,model,effort,cwd,log ++ ".stderr",session,task,String.is_empty(session)),
  Bool.pick(IO(Result<&1,&1,U32 & String,U32>), String.eq(harness,"codex\n"),
    Codex.start_worker(cmd,model,effort,cwd,log ++ ".stderr",session,String.is_empty(session)),
    claude_launch(cmd,model,effort,cwd,log ++ ".stderr",session,String.is_empty(session)))))

# The state the workspace holds when a turn restarts: the work an interrupted
# turn had already written.
def state_note_go(g: G.GitOut, +cwd: String) -> String:
  match g:
    case G.GRun{code, out}:
      +o2 = out
      Bool.pick(String, Tx.non_empty(o2),
        "The workspace at " ++ cwd ++ " holds uncommitted changes:\n" ++ Tx.trim_nl(o2),
        "The workspace at " ++ cwd ++ " holds no uncommitted changes.")
    case G.GBroken{detail}: "The workspace at " ++ cwd ++ " could not be read for its changes: " ++ detail

def state_note(cwd: String) -> IO(String):
  +c2 = cwd
  do IO<String>:
    g : G.GitOut <- GitProc.runGit(c2, ["status", "--porcelain"])
    IO.pure(String, state_note_go(g, c2))

# The prompt a restarted turn delivers: the pending input plus the state the
# interrupted turn left, so the work continues instead of repeating.
def refused_note(cwd: String, prompt: String) -> IO(String):
  do IO<String>:
    note : String <- state_note(cwd)
    IO.pure(String, prompt ++ "\n\nThe conversation this session had before was not saved, so this is a fresh conversation. " ++ note ++ "\nContinue the task and keep the work the workspace already holds.")

# A resume value this host no longer holds: the harness refuses the identity
# before any turn runs, and its stderr says so.
def refusal_body(resumable: Bool, event: String, text: String) -> Bool:
  Bool.and(resumable,
    Bool.and(String.is_empty(event), Tx.starts_with(Tx.trim_nl(text), "Error: Session")))

def refusal_read(resumable: Bool, event: String, text: Result<&1,&1,U32 & String,String>) -> IO(Bool):
  match text:
    case Fail{error}: IO.pure(Bool,False{})
    case Done{value}: IO.pure(Bool,refusal_body(resumable,event,value))

def refusal(+log: String, resumable: Bool, +outcome: Outcome) -> IO(Bool):
  match outcome:
    case Ended{status,event,error}:
      do IO<Bool>:
        text : Result<&1,&1,U32 & String,String> <- T.Text.read(log ++ ".stderr")
        refusal_read(resumable,event,text)

# The refused conversation is gone, so the pending input runs fresh and names
# the state the workspace holds; the fresh turn records its own identity.
def restart(+db: String, +worker: String, +id: String, +log: String, +note: String, +harness: String, child: Result<&1,&1,U32 & String,U32>) -> IO(Outcome):
  do IO<Outcome>:
    noted : Unit <- report(db,worker,id ++ ":recovery","The recorded conversation could not be resumed; the turn restarted in a fresh conversation that names the workspace's current state.")
    started(db,worker,id,log,note,harness,child)

def supervise_gone(+db: String, +worker: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +harness: String, +sessions: String, +prompt: String, +first: Outcome, gone: Bool) -> IO(Outcome):
  match gone:
    case False{}: IO.pure(Outcome,first)
    case True{}: do IO<Outcome>:
      note : String <- refused_note(cwd,prompt)
      child : Result<&1,&1,U32 & String,U32> <- launch(sessions,cmd,model,effort,cwd,log,"",harness,task)
      restart(db,worker,id,log,note,harness,child)

def supervise_retry(+db: String, +worker: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +harness: String, +sessions: String, +native: String, +prompt: String, +first: Outcome) -> IO(Outcome):
  do IO<Outcome>:
    resumable : Bool <- IO.pure(Bool, Bool.not(String.is_empty(native)))
    gone : Bool <- refusal(log,resumable,first)
    supervise_gone(db,worker,id,cmd,model,effort,cwd,task,log,harness,sessions,prompt,first,gone)

def supervise(+db: String, +worker: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +session: String, +harness: String, +sessions: String, +prompt: String) -> IO(Outcome):
  do IO<Outcome>:
    alternate : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN " ++ C.q(sessions) ++ "=" ++ C.q(db ++ ".sessions") ++ " THEN CASE WHEN parent IS NULL THEN " ++ C.q(db ++ ".root-sessions") ++ " ELSE " ++ C.q(db ++ ".session-") ++ " || lower(hex(id)) END ELSE " ++ C.q(db ++ ".sessions") ++ " END FROM sessions WHERE id=" ++ C.q(worker) ++ ";"))
    +native : String <- Omp.resume_file(sessions,Tx.trim_nl(alternate),session,Bool.and(String.eq(harness,"omp\n"),Bool.not(String.is_empty(session))))
    child : Result<&1,&1,U32 & String,U32> <- launch(sessions,cmd,model,effort,cwd,log,native,harness,task)
    first : Outcome <- started(db,worker,id,log,prompt,harness,child)
    supervise_retry(db,worker,id,cmd,model,effort,cwd,task,log,harness,sessions,native,prompt,first)

def task_read(db: String, worker: String, id: String, cmd: String, model: String, effort: String, cwd: String, task: String, log: String, session: String, harness: String, sessions: String, result: Result<&1,&1,U32 & String,String>) -> IO(Outcome):
  match result:
    case Fail{error}: IO.pure(Outcome,Ended{"input failed","","Worker task could not be read: " ++ error_text(error)})
    case Done{prompt}: supervise(db,worker,id,cmd,model,effort,cwd,task,log,session,harness,sessions,prompt)

def choose(+db: String, worker: String, +id: String, cmd: String, model: String, effort: String, cwd: String, +task: String, log: String, session: String, harness: String, replay: Bool) -> IO(Maybe<Outcome>):
  match replay:
    case True{}:
      do IO<Maybe<Outcome>>:
        +saved : String <- IO.try(String,Store.commit(db,C.Delivery{id}))
        written : Unit <- IO.write(saved)
        IO.pure(Maybe<Outcome>,None{})
    case False{}: do IO<Maybe<Outcome>>:
      prompt : Result<&1,&1,U32 & String,String> <- T.Text.read(task)
      result : Outcome <- task_read(db,worker,id,cmd,model,effort,cwd,task,log,session,harness,db ++ ".sessions",prompt)
      IO.pure(Maybe<Outcome>,Some{result})

def supported_harness(supported: Bool) -> IO(Unit):
  match supported:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: IO.die(Unit,2,"No turn adapter for the worker's recorded harness.")

def matching_turn(matches: Bool) -> IO(Unit):
  match matches:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: IO.die(Unit,2,"The turn ID already belongs to a different worker or message kind.")

# The turn identity is admitted only when the message it names was sent by this
# worker as a report: the count is zero for every other sender or kind.
def id_owner_sql(id: String, worker: String) -> String:
  "SELECT count(*) FROM messages WHERE id=" ++ C.q(id) ++ " AND (sender<>" ++ C.q(worker) ++ " OR kind<>'report');"

# The turn identity is admitted only when the store already holds that message.
def turn_present_sql(id: String) -> String:
  "SELECT count(*) FROM messages WHERE id=" ++ C.q(id) ++ ";"

def worker_checked(+db: String, +worker: String, +id: String, cmd: String, model: String, effort: String, cwd: String, task: String, log: String, session: String, +harness: String, missing: Bool) -> IO(Maybe<Outcome>):
  match missing:
    case True{}: IO.die(Maybe<Outcome>,2,"Worker has no recorded parent and workspace; register it before starting a turn.")
    case False{}:
      do IO<Maybe<Outcome>>:
        supported : Unit <- supported_harness(Bool.or(String.eq(harness,"omp\n"),Bool.or(String.eq(harness,"codex\n"),Bool.or(String.eq(harness,"claude-code\n"),String.eq(harness,"muse\n")))))
        foreign : String <- IO.try(String,DB.Sql.query(db,id_owner_sql(id,worker)))
        identity : Unit <- matching_turn(String.eq(foreign,"0\n"))
        found : String <- IO.try(String,DB.Sql.query(db,turn_present_sql(id)))
        choose(db,worker,id,cmd,model,effort,cwd,task,log,session,harness,String.eq(found,"1\n"))

def complete_locked(+db: String, +worker: String, +id: String, +log: String, lock: U32, result: Maybe<Outcome>) -> IO(Unit):
  match result:
    case None{}: do IO<Unit>:
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      IO.try(Unit,Root.wake_pending(db,worker,"0"))
    case Some{+outcome}: do IO<Unit>:
      prepared : Unit <- prepare(db,worker,id,log,outcome)
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      delivery_task : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,finish(db,worker,id,log,outcome))
      wake : Result<&1,&1,U32 & String,Unit> <- Root.wake_pending(db,worker,"0")
      finished : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,delivery_task)
      IO.pass(Unit,combine(finished,wake))

def acquired(+db: String, +worker: String, +id: String, cmd: String, model: String, effort: String, cwd: String, task: String, +log: String, session: String, missing: Bool, lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.die(Unit,2,"Session already has an active native turn; send a message to queue input.")
    case Some{handle}: do IO<Unit>:
      harness : String <- IO.try(String,DB.Sql.query(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(worker) ++ ";"))
      result : Maybe<Outcome> <- worker_checked(db,worker,id,cmd,model,effort,cwd,task,log,session,harness,missing)
      complete_locked(db,worker,id,log,handle,result)

def run(+db: String, +worker: String, id: String, cmd: String, model: String, effort: String, cwd: String, task: String, log: String, session: String) -> IO(Unit):
  do IO<Unit>:
    recorded : String <- IO.try(String,Store.commit(db,C.Session{worker}))
    +database : String <- IO.try(String,Lock.SessionLock.canonical(db))
    lock : Maybe<U32> <- IO.try(Maybe<U32>,Lock.SessionLock.try_acquire(database,worker))
    acquired(database,worker,id,cmd,model,effort,cwd,task,log,session,String.is_empty(recorded),lock)
