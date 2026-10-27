import Base
import ./codex-inbox-result.bend as Outcome
import ../coordinator/commands.bend as C
import ./store.bend as Store
import ./wake.bend as Wake
import ./agent-guidance.bend as Guidance
import ./native-initial-input.bend as InitialInput
import ./codex-inbox-store.bend as Inbox
import ./codex-inbox-proxy.bend as Proxy
import ../host/codex-proxy.bend as Native
import ../host/instance.bend as Custody
import ../host/sqlite.bend as DB
import ../host/session-lock.bend as Lock
import ../json/canonical.bend as J
import ../git/process.bend as Process
import ../git/text.bend as Tx

# The live reducer is reconstructed from the provider and committed inbox after
# restart. Complete items remain until the corresponding terminal report commits.
type State is Data:
  State{pending: Proxy.Pending, items: String, reported: String, observed: String}

type Notice is Data:
  Managed{executable: String, database: String, session: String, thread: String, token: String}
  Pointer{database: String, session: String, thread: String, token: String, notice: String, suffix: String}
  Literal{text: String}

def initial(+pending: Proxy.Pending) -> State:
  State{pending,"[]","[]","[]"}

def state_pending(+state: State) -> Proxy.Pending:
  match state:
    case State{value,items,reported,observed}: value

def items(+state: State) -> String:
  match state:
    case State{pending,value,reported,observed}: value

def reported(+state: State) -> String:
  match state:
    case State{pending,items,value,observed}: value

def observed(+state: State) -> String:
  match state:
    case State{pending,items,reported,value}: value

def replace_pending(+state: State, +pending: Proxy.Pending) -> State:
  match state:
    case State{old,items,reported,observed}: State{pending,items,reported,observed}

def synced(+state: State, +thread: String) -> Outcome.Checked(State):
  do Outcome.Checked<State>:
    +queue : String = Proxy.frames(state_pending(state))
    +updated : String <- Proxy.json("SELECT coalesce(json_group_array(turn),'[]') FROM (SELECT value AS turn FROM json_each(" ++ C.q(observed(state)) ++ ") UNION SELECT coalesce(json_extract(value,'$.params.turn.id'),json_extract(value,'$.params.turnId')) AS turn FROM json_each(" ++ C.q(queue) ++ ") WHERE json_extract(value,'$.params.threadId')=" ++ C.q(thread) ++ " AND json_extract(value,'$.method') IN ('item/completed','turn/completed','turn/started')) WHERE turn IS NOT NULL AND turn NOT IN (SELECT value FROM json_each(" ++ C.q(reported(state)) ++ "));")
    Outcome.Checked.pure(State,State{state_pending(state),items(state),reported(state),updated})

def request_result(result: Proxy.Pending & String, +state: State, +thread: String) -> Outcome.Checked(State & String):
  match result:
    case (pending,response): do Outcome.Checked<State & String>:
      +next : State <- synced(replace_pending(state,pending),thread)
      Outcome.Checked.pure(State & String,(next,response))

def request(+link: Proxy.Link, +state: State, +thread: String, +method: String, +params: String) -> Outcome.Checked(State & String):
  do Outcome.Checked<State & String>:
    result : Proxy.Pending & String <- Proxy.rpc(link,state_pending(state),method,params)
    request_result(result,state,thread)

type Admission is Type:
  Accepted{state: State}
  Refused{state: State, code: U32, cause: String}

def admission_response(+state: State, result: Result<&1,&1,U32 & String,String>, next: State -> String -> Outcome.Checked(Admission)) -> Outcome.Checked(Admission):
  match result:
    case Fail{(code,cause)}: Outcome.Checked.pure(Admission,Refused{state,code,cause})
    case Done{response}: next(state,response)

def admission_received(+state: State, +thread: String, result: Proxy.Pending & Result<&1,&1,U32 & String,String>, next: State -> String -> Outcome.Checked(Admission)) -> Outcome.Checked(Admission):
  match result:
    case (pending,result): do Outcome.Checked<Admission>:
      +updated : State <- synced(replace_pending(state,pending),thread)
      admission_response(updated,result,next)

def admission_rpc(+link: Proxy.Link, +state: State, +thread: String, +method: String, +params: String, next: State -> String -> Outcome.Checked(Admission)) -> Outcome.Checked(Admission):
  do Outcome.Checked<Admission>:
    result : Proxy.Pending & Result<&1,&1,U32 & String,String> <- Proxy.rpc_result(link,state_pending(state),method,params)
    admission_received(state,thread,result,next)

def thread_params(+thread: String) -> String:
  "{\"threadId\":" ++ J.string_literal(thread) ++ ",\"includeTurns\":false}"

def turn_params(+thread: String, +cursor: String) -> String:
  "{\"threadId\":" ++ J.string_literal(thread) ++ ",\"sortDirection\":\"desc\",\"itemsView\":\"notLoaded\""
  ++ Bool.pick(String,String.is_empty(cursor),"",",\"cursor\":" ++ J.string_literal(cursor)) ++ "}"

def turn_page_selected(+link: Proxy.Link, +state: State, +thread: String, +page: String, +turn: String, +cursor: String, +found: Bool, again: State -> String -> Outcome.Checked(State & String)) -> Outcome.Checked(State & String):
  match found:
    case True{}: Outcome.Checked.pure(State & String,(state,turn))
    case False{}: Bool.pick(Outcome.Checked(State & String),String.is_empty(cursor),Outcome.Checked.fail(State & String,1,"Public Codex active thread " ++ thread ++ " returned no in-progress turn identity after cursor exhaustion: " ++ page),again(state,cursor))

def turn_page(+link: Proxy.Link, +thread: String, result: State & String, again: State -> String -> Outcome.Checked(State & String)) -> Outcome.Checked(State & String):
  match result:
    case (state,+page): do Outcome.Checked<State & String>:
      +turn : String <- Proxy.json("SELECT coalesce((SELECT value FROM json_each(" ++ C.q(page) ++ ",'$.data') WHERE json_extract(value,'$.status')='inProgress' LIMIT 1),'null');")
      +cursor : String <- Proxy.text(page,"$.nextCursor")
      turn_page_selected(link,state,thread,page,turn,cursor,Bool.not(String.eq(turn,"null")),again)

@unsafe
def current_turn(+link: Proxy.Link, +state: State, +thread: String, +cursor: String) -> Outcome.Checked(State & String):
  do Outcome.Checked<State & String>:
    result : State & String <- request(link,state,thread,"thread/turns/list",turn_params(thread,cursor))
    turn_page(link,thread,result,next => more => current_turn(link,next,thread,more))

def refreshed_fields(fields: List<String>, +executable: String, +db: String, +session: String) -> Outcome.Checked(String & String):
  match fields:
    case token <> rest: do Outcome.Checked<String & String>:
      +row : Inbox.Snapshot <- Inbox.row_fields(rest)
      prompt : String <- InitialInput.managed(db,session,Inbox.native(row),Inbox.input_seq(row),Inbox.pointer(executable,db,session,row))
      Outcome.Checked.pure(String & String,(token,prompt))
    case Nil{}: Outcome.Checked.pure(String & String,("",""))

def refreshed_managed(+current: String, +executable: String, +db: String, +session: String, +empty: Bool) -> Outcome.Checked(String & String):
  match empty:
    case True{}: Outcome.Checked.pure(String & String,("",""))
    case False{}: refreshed_fields(Tx.split_tabs(current),executable,db,session)

def refreshed_pointer(fields: List<String>, +db: String, +session: String, +notice: String, +suffix: String) -> Outcome.Checked(String & String):
  match fields:
    case token <> rest: do Outcome.Checked<String & String>:
      +row : Inbox.Snapshot <- Inbox.row_fields(rest)
      prompt : String <- InitialInput.managed(db,session,Inbox.native(row),Inbox.input_seq(row),Guidance.pending() ++ suffix)
      Outcome.Checked.pure(String & String,(token,prompt))
    case Nil{}: Outcome.Checked.pure(String & String,("",""))

def refreshed_pointer_present(+current: String, +db: String, +session: String, +notice: String, +suffix: String, +empty: Bool) -> Outcome.Checked(String & String):
  match empty:
    case True{}: Outcome.Checked.pure(String & String,("",""))
    case False{}: refreshed_pointer(Tx.split_tabs(current),db,session,notice,suffix)

def refresh(+notice: Notice, +status: String) -> Outcome.Checked(String & String):
  match notice:
    case Literal{text}: Outcome.Checked.pure(String & String,("",text))
    case Managed{executable,+db,+session,thread,token}: do Outcome.Checked<String & String>:
      +current : String <- Inbox.refresh(db,session,thread,token,status)
      refreshed_managed(current,executable,db,session,String.is_empty(current))
    case Pointer{+db,+session,thread,token,notice,suffix}: do Outcome.Checked<String & String>:
      +current : String <- Inbox.refresh(db,session,thread,token,status)
      refreshed_pointer_present(current,db,session,notice,suffix,String.is_empty(current))

def admission_stored(+notice: Notice, +token: String, +turn: String) -> Outcome.Checked(Unit):
  match notice:
    case Literal{text}: Outcome.Checked.pure(Unit,Unit{})
    case Managed{executable,db,session,thread,saved}: Inbox.admitted(db,session,thread,token,turn)
    case Pointer{db,session,thread,saved,document,suffix}: Inbox.admitted(db,session,thread,token,turn)

def observed_add(+state: State, +turn: String) -> Outcome.Checked(State):
  do Outcome.Checked<State>:
    +next : String <- Proxy.json("SELECT json_group_array(value) FROM (SELECT value FROM json_each(" ++ C.q(observed(state)) ++ ") UNION SELECT " ++ C.q(turn) ++ ") WHERE value<>'' AND value NOT IN (SELECT value FROM json_each(" ++ C.q(reported(state)) ++ "));")
    Outcome.Checked.pure(State,State{state_pending(state),items(state),reported(state),next})

def admission_result(+notice: Notice, +token: String, +thread: String, +method: String, +state: State, +response: String) -> Outcome.Checked(Admission):
  do Outcome.Checked<Admission>:
    recorded : Unit <- Proxy.record("{\"type\":\"codexInboxAdmission\",\"threadId\":" ++ J.string_literal(thread) ++ ",\"method\":" ++ J.string_literal(method) ++ ",\"result\":" ++ response ++ "}")
    +turn : String <- Proxy.text(response,"$.turnId")
    +nested : String <- Proxy.text(response,"$.turn.id")
    +id : String = Bool.pick(String,String.is_empty(turn),nested,turn)
    stored : Unit <- admission_stored(notice,token,id)
    next : State <- observed_add(state,id)
    Outcome.Checked.pure(Admission,Accepted{next})

def coalesced_row(+session: String, +thread: String, +row: Inbox.Snapshot) -> Outcome.Checked(Unit):
  Proxy.record("{\"type\":\"codexInboxCoalesced\",\"session\":" ++ J.string_literal(session) ++ ",\"threadId\":" ++ J.string_literal(thread) ++ ",\"stopped\":" ++ Bool.pick(String,Inbox.stopped(row),"true","false") ++ ",\"pendingCount\":" ++ Inbox.pending(row) ++ "}")

def coalesced(+notice: Notice) -> Outcome.Checked(Unit):
  match notice:
    case Literal{text}: Outcome.Checked.pure(Unit,Unit{})
    case Managed{executable,+db,+session,+thread,token}: do Outcome.Checked<Unit>:
      row : Inbox.Snapshot <- Inbox.read(db,session,thread)
      coalesced_row(session,thread,row)
    case Pointer{+db,+session,+thread,token,document,suffix}: do Outcome.Checked<Unit>:
      row : Inbox.Snapshot <- Inbox.read(db,session,thread)
      coalesced_row(session,thread,row)

def send_refreshed(+link: Proxy.Link, +state: State, +thread: String, +method: String, +turn: String, +notice: Notice, +token: String, +pointer: String, +empty: Bool) -> Outcome.Checked(Admission):
  match empty:
    case True{}: do Outcome.Checked<Admission>:
      logged : Unit <- coalesced(notice)
      Outcome.Checked.pure(Admission,Accepted{state})
    case False{}:
      admission_rpc(link,state,thread,method,"{\"threadId\":" ++ J.string_literal(thread) ++ ",\"input\":[{\"type\":\"text\",\"text\":" ++ J.string_literal(pointer) ++ "}]" ++ Bool.pick(String,String.is_empty(turn),"",",\"expectedTurnId\":" ++ J.string_literal(turn)) ++ "}",next => response => admission_result(notice,token,thread,method,next,response))

def send_admission(+link: Proxy.Link, +state: State, +thread: String, +method: String, +turn: String, +notice: Notice, refreshed: String & String) -> Outcome.Checked(Admission):
  match refreshed:
    case (token,+pointer): send_refreshed(link,state,thread,method,turn,notice,token,pointer,String.is_empty(pointer))

def queue_receipt_accepted(+link: Proxy.Link, +state: State, +thread: String, +output: String, accepted: Bool) -> Outcome.Checked(Admission):
  match accepted:
    case True{}: do Outcome.Checked<Admission>:
      recorded : Unit <- Proxy.record("{\"type\":\"codexInboxAdmission\",\"threadId\":" ++ J.string_literal(thread) ++ ",\"method\":\"codex queue\",\"result\":{\"receipt\":" ++ J.string_literal(output) ++ "}}")
      Outcome.Checked.pure(Admission,Accepted{state})
    case False{}: Outcome.Checked.pure(Admission,Refused{state,1,"Codex queue returned no matching admission receipt: " ++ output})

def queue_receipt(+link: Proxy.Link, +state: State, +thread: String, result: Result<&1,&1,U32 & String,String>) -> Outcome.Checked(Admission):
  match result:
    case Fail{(code,cause)}: Outcome.Checked.pure(Admission,Refused{state,code,cause})
    case Done{+output}: queue_receipt_accepted(link,state,thread,output,Bool.and(String.contains(output,"Queued message "),String.contains(output," for thread " ++ thread ++ ".")))

def queue_refreshed(+link: Proxy.Link, +state: State, +thread: String, +token: String, +pointer: String, +empty: Bool) -> Outcome.Checked(Admission):
  match empty:
    case True{}: do Outcome.Checked<Admission>:
      logged : Unit <- Proxy.record("{\"type\":\"codexInboxCoalesced\",\"threadId\":" ++ J.string_literal(thread) ++ ",\"pendingCount\":0}")
      Outcome.Checked.pure(Admission,Accepted{state})
    case False{}:
      do Outcome.Checked<Admission>:
        result : Result<&1,&1,U32 & String,String> <- Outcome.Checked.lift(Result<&1,&1,U32 & String,String>,Process.Process.run(Tx.enc_argv(["codex","queue","--thread",thread,"--message",pointer]),"."))
        queue_receipt(link,state,thread,result)

def queue_refreshed_result(+link: Proxy.Link, +state: State, +thread: String, refreshed: String & String) -> Outcome.Checked(Admission):
  match refreshed:
    case (token,+pointer): queue_refreshed(link,state,thread,token,pointer,String.is_empty(pointer))

def queue_for_live_tui(+link: Proxy.Link, +state: State, +thread: String, +notice: Notice, +status: String) -> Outcome.Checked(Admission):
  do Outcome.Checked<Admission>:
    refreshed : String & String <- refresh(notice,status)
    queue_refreshed_result(link,state,thread,refreshed)

def deliver_resumed(+link: Proxy.Link, +thread: String, +notice: Notice, result: Admission) -> Outcome.Checked(Admission):
  match result:
    case Accepted{state}: Outcome.Checked.pure(Admission,Accepted{state})
    case Refused{+state,code,+cause}:
      Bool.pick(Outcome.Checked(Admission),String.contains(cause,"already has an active writer"),
        queue_for_live_tui(link,state,thread,notice,"notLoaded"),
        Outcome.Checked.pure(Admission,Refused{state,code,cause}))

def steer_selected(+link: Proxy.Link, +thread: String, +notice: Notice, +state: State, +page: String, +turn: String, +cursor: String, +found: Bool, again: State -> String -> Outcome.Checked(Admission)) -> Outcome.Checked(Admission):
  match found:
    case True{}: do Outcome.Checked<Admission>:
      +id : String <- Proxy.text(turn,"$.id")
      refreshed : String & String <- refresh(notice,"active")
      send_admission(link,state,thread,"turn/steer",id,notice,refreshed)
    case False{}:
      Bool.pick(Outcome.Checked(Admission),String.is_empty(cursor),Outcome.Checked.pure(Admission,Refused{state,1,"Public Codex active thread " ++ thread ++ " returned no in-progress turn identity after cursor exhaustion: " ++ page}),again(state,cursor))

def steer_page(+link: Proxy.Link, +thread: String, +notice: Notice, +state: State, +page: String, again: State -> String -> Outcome.Checked(Admission)) -> Outcome.Checked(Admission):
  do Outcome.Checked<Admission>:
    +turn : String <- Proxy.json("SELECT coalesce((SELECT value FROM json_each(" ++ C.q(page) ++ ",'$.data') WHERE json_extract(value,'$.status')='inProgress' LIMIT 1),'null');")
    +cursor : String <- Proxy.text(page,"$.nextCursor")
    steer_selected(link,thread,notice,state,page,turn,cursor,Bool.not(String.eq(turn,"null")),again)

@unsafe
def steer_current(+link: Proxy.Link, +thread: String, +notice: Notice, +state: State, +cursor: String) -> Outcome.Checked(Admission):
  admission_rpc(link,state,thread,"thread/turns/list",turn_params(thread,cursor),next => page => steer_page(link,thread,notice,next,page,later => cursor => steer_current(link,thread,notice,later,cursor)))

def deliver_status(+link: Proxy.Link, +state: State, +thread: String, +notice: Notice, +status: String, +active: Bool) -> Outcome.Checked(Admission):
  match active:
    case True{}: steer_current(link,thread,notice,state,"")
    case False{}: do Outcome.Checked<Admission>:
      refreshed : String & String <- refresh(notice,status)
      send_admission(link,state,thread,"turn/start","",notice,refreshed)

def deliver_read(+link: Proxy.Link, +thread: String, +notice: Notice, +state: State, +response: String) -> Outcome.Checked(Admission):
  do Outcome.Checked<Admission>:
    +status : String <- Proxy.text(response,"$.thread.status.type")
    deliver_status(link,state,thread,notice,status,String.eq(status,"active"))

def deliver_loaded(+link: Proxy.Link, +thread: String, +notice: Notice, +state: State, +response: String, +unloaded: Bool) -> Outcome.Checked(Admission):
  match unloaded:
    case True{}: do Outcome.Checked<Admission>:
      result : Admission <- admission_rpc(link,state,thread,"thread/resume",thread_params(thread),next => resumed => deliver_read(link,thread,notice,next,resumed))
      deliver_resumed(link,thread,notice,result)
    case False{}: deliver_read(link,thread,notice,state,response)

def deliver_started(+link: Proxy.Link, +thread: String, +notice: Notice, +state: State, +response: String) -> Outcome.Checked(Admission):
  do Outcome.Checked<Admission>:
    +unloaded : Bool <- Proxy.truth(response,"json_extract(value,'$.thread.status.type')='notLoaded'")
    deliver_loaded(link,thread,notice,state,response,unloaded)

def deliver_notice(+link: Proxy.Link, +state: State, +thread: String, +notice: Notice) -> Outcome.Checked(Admission):
  admission_rpc(link,state,thread,"thread/read",thread_params(thread),next => response => deliver_started(link,thread,notice,next,response))

def membership(+values: String, +value: String) -> Outcome.Checked(Bool):
  Proxy.truth(values,"EXISTS(SELECT 1 FROM json_each(item.value) j WHERE j.value=" ++ C.q(value) ++ ")")

def report(+db: String, +session: String, +id: String, +body: String) -> Outcome.Checked(String):
  do Outcome.Checked<String>:
    +command : C.Command = C.Report{id,session,body}
    +saved : String <- Store.apply(db,command)
    woken : Unit <- Wake.drive_command(db,command,Done{saved})
    Outcome.Checked.pure(String,saved)

def terminal_marked(+state: State, +turn: String) -> Outcome.Checked(State):
  do Outcome.Checked<State>:
    +reports : String <- Proxy.json("SELECT json_group_array(value) FROM (SELECT value FROM json_each(" ++ C.q(reported(state)) ++ ") UNION SELECT " ++ C.q(turn) ++ ");")
    +remaining : String <- Proxy.json("SELECT coalesce(json_group_array(value),'[]') FROM json_each(" ++ C.q(observed(state)) ++ ") WHERE value<>" ++ C.q(turn) ++ ";")
    +completed : String <- Proxy.json("SELECT coalesce(json_group_array(json(value)),'[]') FROM json_each(" ++ C.q(items(state)) ++ ") WHERE json_extract(value,'$.turnId')<>" ++ C.q(turn) ++ ";")
    Outcome.Checked.pure(State,State{state_pending(state),completed,reports,remaining})

def turn_retained(+session: String, +thread: String, +turn: String) -> Outcome.Checked(Unit):
  Proxy.record("{\"type\":\"codexInboxTurnRetained\",\"session\":" ++ J.string_literal(session) ++ ",\"threadId\":" ++ J.string_literal(thread) ++ ",\"turn\":" ++ turn ++ "}")

def terminal_body(+db: String, +session: String, +thread: String, +turn: String, +id: String, +body: String) -> Outcome.Checked(String):
  do Outcome.Checked<String>:
    +stored : String <- DB.Sql.read(db,"SELECT hex(body) FROM messages WHERE id=" ++ C.q(id) ++ " AND sender=" ++ C.q(session) ++ " AND kind='report' AND CASE WHEN json_valid(body) THEN json_extract(body,'$.type')='codex-inbox-turn-settled' AND json_extract(body,'$.session')=" ++ C.q(session) ++ " AND json_extract(body,'$.threadId')=" ++ C.q(thread) ++ " AND json_extract(body,'$.turn.id')=" ++ C.q(turn) ++ " ELSE 0 END;")
    Bool.pick(Outcome.Checked(String),String.is_empty(stored),Outcome.Checked.pure(String,body),Inbox.text(Tx.trim_nl(stored)))

def terminal_report(+db: String, +session: String, +thread: String, +state: State, +turn: String, +turn_id: String, +status: String, +already: Bool) -> Outcome.Checked(State):
  match already:
    case True{}: terminal_marked(state,turn_id)
    case False{}: do Outcome.Checked<State>:
      +completed : String <- Proxy.json("SELECT coalesce(json_group_array(json(json_extract(value,'$.item'))),'[]') FROM json_each(" ++ C.q(items(state)) ++ ") WHERE json_extract(value,'$.turnId')=" ++ C.q(turn_id) ++ ";")
      +id : String = "codex-inbox-turn:" ++ session ++ ":" ++ thread ++ ":" ++ turn_id
      +candidate : String = "{\"type\":\"codex-inbox-turn-settled\",\"session\":" ++ J.string_literal(session) ++ ",\"threadId\":" ++ J.string_literal(thread) ++ ",\"turn\":" ++ turn ++ ",\"completedItems\":" ++ completed ++ "}"
      +body : String <- terminal_body(db,session,thread,turn_id,id,candidate)
      +saved : String <- report(db,session,id,body)
      logged : Unit <- Proxy.record("{\"type\":\"codexInboxTurnReport\",\"id\":" ++ J.string_literal(id) ++ ",\"session\":" ++ J.string_literal(session) ++ ",\"threadId\":" ++ J.string_literal(thread) ++ ",\"code\":0,\"signal\":null,\"output\":" ++ J.string_literal(saved) ++ "}")
      kept : Unit <- Bool.pick(Outcome.Checked(Unit),String.eq(status,"completed"),Outcome.Checked.pure(Unit,Unit{}),turn_retained(session,thread,turn))
      terminal_marked(state,turn_id)

def terminal(+db: String, +session: String, +thread: String, +state: State, +frame: String) -> Outcome.Checked(State):
  do Outcome.Checked<State>:
    +turn : String <- Proxy.value(frame,"$.params.turn")
    +id : String <- Proxy.text(turn,"$.id")
    +status : String <- Proxy.text(turn,"$.status")
    logged : Unit <- Proxy.record("{\"type\":\"codexInboxTurnSettled\",\"session\":" ++ J.string_literal(session) ++ ",\"threadId\":" ++ J.string_literal(thread) ++ ",\"turnId\":" ++ J.string_literal(id) ++ ",\"status\":" ++ J.string_literal(status) ++ ",\"turn\":" ++ turn ++ "}")
    +row : Inbox.Snapshot <- Inbox.read(db,session,thread)
    retained : Unit <- Bool.pick(Outcome.Checked(Unit),String.eq(status,"completed"),Outcome.Checked.pure(Unit,Unit{}),Inbox.failed(db,session,thread,Inbox.input_seq(row),turn,id))
    +done : Bool <- membership(reported(state),id)
    terminal_report(db,session,thread,state,turn,id,status,done)

def completed_item(+session: String, +state: State, +frame: String) -> Outcome.Checked(State):
  do Outcome.Checked<State>:
    +turn : String <- Proxy.text(frame,"$.params.turnId")
    +item : String <- Proxy.value(frame,"$.params.item")
    +id : String <- Proxy.text(item,"$.id")
    +updated : String <- Proxy.json("SELECT json_insert(coalesce(json_group_array(json(value)),'[]'),'$[#]',json_object('turnId'," ++ C.q(turn) ++ ",'item',json(" ++ C.q(item) ++ "))) FROM json_each(" ++ C.q(items(state)) ++ ") WHERE NOT(json_extract(value,'$.turnId')=" ++ C.q(turn) ++ " AND json_extract(value,'$.item.id')=" ++ C.q(id) ++ ");")
    +params : String <- Proxy.value(frame,"$.params")
    +logged_frame : String <- Proxy.json("SELECT json_set(" ++ C.q(params) ++ ",'$.type','codexInboxItemCompleted','$.session'," ++ C.q(session) ++ ");")
    logged : Unit <- Proxy.record(logged_frame)
    observed_add(State{state_pending(state),updated,reported(state),observed(state)},turn)

def notification_method(+db: String, +session: String, +thread: String, +state: State, +frame: String, +method: String) -> Outcome.Checked(State):
  match method:
    case "turn/completed": terminal(db,session,thread,state,frame)
    case "item/completed": completed_item(session,state,frame)
    case "turn/started": do Outcome.Checked<State>:
      +turn : String <- Proxy.text(frame,"$.params.turn.id")
      observed_add(state,turn)
    case other: Outcome.Checked.pure(State,state)

def notification_selected(+db: String, +session: String, +thread: String, +state: State, +frame: String, +method: String, +selected: Bool) -> Outcome.Checked(State):
  match selected:
    case False{}: Outcome.Checked.pure(State,state)
    case True{}: notification_method(db,session,thread,state,frame,method)

def notification_error(+db: String, +session: String, +thread: String, +state: State, +frame: String, +failed: Bool) -> Outcome.Checked(State):
  match failed:
    case True{}: Outcome.Checked.fail(State,1,"Public Codex notification failed: " ++ frame)
    case False{}: do Outcome.Checked<State>:
      +method : String <- Proxy.text(frame,"$.method")
      +source : String <- Proxy.text(frame,"$.params.threadId")
      notification_selected(db,session,thread,state,frame,method,String.eq(source,thread))

def notification(+db: String, +session: String, +thread: String, +state: State, +frame: String) -> Outcome.Checked(State):
  do Outcome.Checked<State>:
    failed : Bool <- Proxy.truth(frame,"json_type(value,'$.error') IS NOT NULL AND json_type(value,'$.error')<>'null'")
    notification_error(db,session,thread,state,frame,failed)

def released(+session: String, +thread: String, +row: Inbox.Snapshot) -> Outcome.Checked(Unit):
  Proxy.record("{\"type\":\"codexInboxReleased\",\"session\":" ++ J.string_literal(session) ++ ",\"threadId\":" ++ J.string_literal(thread) ++ ",\"stopped\":" ++ Bool.pick(String,Inbox.stopped(row),"true","false") ++ ",\"pendingCount\":" ++ Inbox.pending(row) ++ "}")

def notify_failure(+db: String, +session: String, +thread: String, +cause: String) -> Outcome.Checked(Unit):
  do Outcome.Checked<Unit>:
    +nonce : String <- Proxy.json("SELECT lower(hex(randomblob(16)));")
    +id : String = "codex-inbox-failure:" ++ session ++ ":" ++ nonce
    +body : String = "{\"type\":\"codex-inbox-continuation-failed\",\"session\":" ++ J.string_literal(session) ++ ",\"threadId\":" ++ J.string_literal(thread) ++ ",\"cause\":" ++ J.string_literal(cause) ++ "}"
    +output : String <- report(db,session,id,body)
    Proxy.record("{\"type\":\"codexInboxFailureReport\",\"id\":" ++ J.string_literal(id) ++ ",\"session\":" ++ J.string_literal(session) ++ ",\"threadId\":" ++ J.string_literal(thread) ++ ",\"code\":0,\"signal\":null,\"output\":" ++ J.string_literal(output) ++ "}")

def retained_failure(+db: String, +session: String, +thread: String, +cause: String) -> Outcome.Checked(Unit):
  do Outcome.Checked<Unit>:
    +row : Inbox.Snapshot <- Inbox.read(db,session,thread)
    Inbox.failed(db,session,thread,Inbox.input_seq(row),cause,"")

def admission_caught(+db: String, +session: String, +thread: String, result: Admission) -> Outcome.Checked(State):
  match result:
    case Accepted{state}: Outcome.Checked.pure(State,state)
    case Refused{state,code,+cause}: do Outcome.Checked<State>:
      retained : Unit <- retained_failure(db,session,thread,cause)
      notified : Unit <- notify_failure(db,session,thread,cause)
      Outcome.Checked.pure(State,state)

def admission_claimed(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State, +token: String, +empty: Bool) -> Outcome.Checked(Admission):
  match empty:
    case True{}: Outcome.Checked.pure(Admission,Accepted{state})
    case False{}: deliver_notice(link,state,thread,Managed{executable,db,session,thread,token})

def admit_current(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State, +ready: Bool) -> Outcome.Checked(Admission):
  match ready:
    case False{}: Outcome.Checked.pure(Admission,Accepted{state})
    case True{}: do Outcome.Checked<Admission>:
      +token : String <- Inbox.claim(db,session,thread)
      admission_claimed(link,executable,db,session,thread,state,token,String.is_empty(token))

def admit_row(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State, +row: Inbox.Snapshot, +claimed: Bool) -> Outcome.Checked(Admission):
  admit_current(link,executable,db,session,thread,state,Bool.and(Bool.not(Inbox.stopped(row)),Bool.and(Inbox.has_pending(row),Bool.not(claimed))))

def admit(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State) -> Outcome.Checked(State):
  do Outcome.Checked<State>:
    +row : Inbox.Snapshot <- Inbox.read(db,session,thread)
    +claimed : Bool <- Inbox.claimed(db,session,thread)
    admission : Admission <- admit_row(link,executable,db,session,thread,state,row,claimed)
    admission_caught(db,session,thread,admission)

type Step is Type:
  Finished{}
  Waiting{state: State, row: Inbox.Snapshot}

def active_turn(result: State & String) -> Outcome.Checked(State):
  match result:
    case (next,turn): do Outcome.Checked<State>:
      id : String <- Proxy.text(turn,"$.id")
      observed_add(next,id)

def active_observed(link: Proxy.Link, thread: String, state: State, needed: Bool) -> Outcome.Checked(State):
  match needed:
    case False{}: Outcome.Checked.pure(State,state)
    case True{}: do Outcome.Checked<State>:
      result : State & String <- current_turn(link,state,thread,"")
      active_turn(result)

def continue_admission(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State, +row: Inbox.Snapshot, +status: String, +allowed: Bool) -> Outcome.Checked(Step):
  match allowed:
    case True{}: do Outcome.Checked<Step>:
      +next : State <- admit(link,executable,db,session,thread,state)
      Outcome.Checked.pure(Step,Waiting{next,row})
    case False{}:
      Bool.pick(Outcome.Checked(Step),Bool.or(String.eq(status,"systemError"),String.eq(status,"notLoaded")),Outcome.Checked.fail(Step,1,"Managed Codex inbox continuation cannot run: " ++ status),Outcome.Checked.pure(Step,Waiting{state,row}))

def retained_turn_page(+session: String, +thread: String, result: State & String) -> Outcome.Checked(State):
  match result:
    case (state,page): do Outcome.Checked<State>:
      turn : String <- Proxy.value(page,"$.data[0]")
      logged : Unit <- turn_retained(session,thread,turn)
      Outcome.Checked.pure(State,state)

def retain_existing(+link: Proxy.Link, +session: String, +thread: String, +state: State, +needed: Bool) -> Outcome.Checked(State):
  match needed:
    case False{}: Outcome.Checked.pure(State,state)
    case True{}: do Outcome.Checked<State>:
      result : State & String <- request(link,state,thread,"thread/turns/list",turn_params(thread,""))
      retained_turn_page(session,thread,result)

def continue_open(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State, +row: Inbox.Snapshot, +previous: Inbox.Snapshot, +status: String) -> Outcome.Checked(Step):
  do Outcome.Checked<Step>:
    +claimed : Bool <- Inbox.claimed(db,session,thread)
    +progress : Bool = Bool.not(String.eq(Inbox.reads(row),Inbox.reads(previous)))
    +control : Bool = Bool.not(String.eq(Inbox.control_seq(row),Inbox.control_seq(previous)))
    +next : State <- retain_existing(link,session,thread,state,Bool.and(claimed,Bool.and(String.eq(status,"idle"),Inbox.has_pending(row))))
    continue_admission(link,executable,db,session,thread,next,row,status,Bool.and(Inbox.has_pending(row),Bool.or(progress,Bool.or(control,Bool.and(String.eq(status,"idle"),Bool.not(claimed))))))

def continue_status(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State, +row: Inbox.Snapshot, +previous: Inbox.Snapshot, +status: String, +done: Bool) -> Outcome.Checked(Step):
  match done:
    case True{}: do Outcome.Checked<Step>:
      logged : Unit <- released(session,thread,row)
      Outcome.Checked.pure(Step,Finished{})
    case False{}: continue_open(link,executable,db,session,thread,state,row,previous,status)

def continue_observed(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State, +row: Inbox.Snapshot, +previous: Inbox.Snapshot, +status: String) -> Outcome.Checked(Step):
  do Outcome.Checked<Step>:
    +empty : Bool <- Proxy.truth(observed(state),"json_array_length(value)=0")
    continue_status(link,executable,db,session,thread,state,row,previous,status,Bool.and(Bool.not(Inbox.has_pending(row)),Bool.and(Bool.not(String.eq(status,"active")),empty)))

def continue_read(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +row: Inbox.Snapshot, +previous: Inbox.Snapshot, result: State & String) -> Outcome.Checked(Step):
  match result:
    case (+state,+response): do Outcome.Checked<Step>:
      +status : String <- Proxy.text(response,"$.thread.status.type")
      +empty : Bool <- Proxy.truth(observed(state),"json_array_length(value)=0")
      +next : State <- active_observed(link,thread,state,Bool.and(String.eq(status,"active"),empty))
      continue_observed(link,executable,db,session,thread,next,row,previous,status)

def step_open(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State, +row: Inbox.Snapshot, +previous: Inbox.Snapshot, +stopped: Bool) -> Outcome.Checked(Step):
  match stopped:
    case True{}: do Outcome.Checked<Step>:
      logged : Unit <- released(session,thread,row)
      Outcome.Checked.pure(Step,Finished{})
    case False{}: do Outcome.Checked<Step>:
      result : State & String <- request(link,state,thread,"thread/read",thread_params(thread))
      continue_read(link,executable,db,session,thread,row,previous,result)

def step(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State, +previous: Inbox.Snapshot, +frame: String) -> Outcome.Checked(Step):
  do Outcome.Checked<Step>:
    +next : State <- notification(db,session,thread,state,frame)
    +row : Inbox.Snapshot <- Inbox.read(db,session,thread)
    step_open(link,executable,db,session,thread,next,row,previous,Inbox.stopped(row))

def loop_incoming(state: State, row: Inbox.Snapshot, incoming: Proxy.Pending & String, again: State -> Inbox.Snapshot -> String -> Outcome.Checked(Unit)) -> Outcome.Checked(Unit):
  match incoming:
    case (pending,frame): again(replace_pending(state,pending),row,frame)

def loop_next(link: Proxy.Link, result: Step, again: State -> Inbox.Snapshot -> String -> Outcome.Checked(Unit)) -> Outcome.Checked(Unit):
  match result:
    case Finished{}: Outcome.Checked.pure(Unit,Unit{})
    case Waiting{+state,row}: do Outcome.Checked<Unit>:
      incoming : Proxy.Pending & String <- Proxy.next(link,state_pending(state))
      loop_incoming(state,row,incoming,again)

@unsafe
def follow_loop(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State, +row: Inbox.Snapshot, +frame: String) -> Outcome.Checked(Unit):
  do Outcome.Checked<Unit>:
    result : Step <- step(link,executable,db,session,thread,state,row,frame)
    loop_next(link,result,next => previous => event => follow_loop(link,executable,db,session,thread,next,previous,event))

def following(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +row: Inbox.Snapshot, result: State & String) -> Outcome.Checked(Unit):
  match result:
    case (next,resumed): do Outcome.Checked<Unit>:
      logged : Unit <- Proxy.record("{\"type\":\"codexInboxSubscribed\",\"session\":" ++ J.string_literal(session) ++ ",\"threadId\":" ++ J.string_literal(thread) ++ "}")
      follow_loop(link,executable,db,session,thread,next,row,"{\"initial\":true}")

def observed_live_read(+session: String, +thread: String, +message: String, +row: Inbox.Snapshot) -> Outcome.Checked(Unit):
  do Outcome.Checked<Unit>:
    recorded : Unit <- Proxy.record("{\"type\":\"codexInboxMessageRead\",\"session\":" ++ J.string_literal(session) ++ ",\"threadId\":" ++ J.string_literal(thread) ++ ",\"messageId\":" ++ J.string_literal(message) ++ "}")
    released(session,thread,row)

def live_tui_observed(+link: Proxy.Link, +db: String, +session: String, +thread: String, +state: State, +target: String, +row: Inbox.Snapshot, stopped: Bool, +read: Bool, again: Proxy.Link -> String -> String -> String -> State -> String -> Outcome.Checked(Unit)) -> Outcome.Checked(Unit):
  match stopped:
    case True{}: released(session,thread,row)
    case False{}:
      Bool.pick(Outcome.Checked(Unit),read,
        observed_live_read(session,thread,target,row),
        Bool.pick(Outcome.Checked(Unit),String.is_empty(target),released(session,thread,row),
          again(link,db,session,thread,state,target)))

def live_tui_snapshot(+link: Proxy.Link, +db: String, +session: String, +thread: String, +state: State, +target: String, again: Proxy.Link -> String -> String -> String -> State -> String -> Outcome.Checked(Unit)) -> Outcome.Checked(Unit):
  do Outcome.Checked<Unit>:
    +row : Inbox.Snapshot <- Inbox.read(db,session,thread)
    +read : Bool <- Inbox.message_read(db,session,thread,target)
    +stopped : Bool = Inbox.stopped(row)
    live_tui_observed(link,db,session,thread,state,target,row,stopped,read,again)

def live_tui_next(+link: Proxy.Link, +db: String, +session: String, +thread: String, +state: State, +target: String, result: Proxy.Pending & String, again: Proxy.Link -> String -> String -> String -> State -> String -> Outcome.Checked(Unit)) -> Outcome.Checked(Unit):
  match result:
    case (pending,frame): live_tui_snapshot(link,db,session,thread,replace_pending(state,pending),target,again)

@unsafe
def live_tui_wait(+link: Proxy.Link, +db: String, +session: String, +thread: String, +state: State, +target: String) -> Outcome.Checked(Unit):
  do Outcome.Checked<Unit>:
    incoming : Proxy.Pending & String <- Proxy.next(link,state_pending(state))
    live_tui_next(link,db,session,thread,state,target,incoming,
      next_link => next_db => next_session => next_thread => next_state => next_target =>
        live_tui_wait(next_link,next_db,next_session,next_thread,next_state,next_target))

def resumed_or_live_tui(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State, +row: Inbox.Snapshot, result: Proxy.Pending & Result<&1,&1,U32 & String,String>) -> Outcome.Checked(Unit):
  match result:
    case (pending,Done{+response}): do Outcome.Checked<Unit>:
      +next : State <- synced(replace_pending(state,pending),thread)
      following(link,executable,db,session,thread,row,(next,response))
    case (pending,Fail{(code,+cause)}): do Outcome.Checked<Unit>:
      +next : State <- synced(replace_pending(state,pending),thread)
      Bool.pick(Outcome.Checked(Unit),String.contains(cause,"already has an active writer"),
        live_tui_snapshot(link,db,session,thread,next,Inbox.message(row),
          next_link => next_db => next_session => next_thread => next_state => next_target =>
            live_tui_wait(next_link,next_db,next_session,next_thread,next_state,next_target)),
        Outcome.Checked.fail(Unit,code,cause))

def follow_loaded(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State, +row: Inbox.Snapshot, +stopped: Bool) -> Outcome.Checked(Unit):
  match stopped:
    case True{}: released(session,thread,row)
    case False{}: do Outcome.Checked<Unit>:
      result : Proxy.Pending & Result<&1,&1,U32 & String,String> <- Proxy.rpc_result(link,state_pending(state),"thread/resume","{\"threadId\":" ++ J.string_literal(thread) ++ "}")
      resumed_or_live_tui(link,executable,db,session,thread,state,row,result)

def follow_run(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +pending: Proxy.Pending) -> Outcome.Checked(Unit):
  do Outcome.Checked<Unit>:
    +row : Inbox.Snapshot <- Inbox.read(db,session,thread)
    follow_loaded(link,executable,db,session,thread,initial(pending),row,Inbox.stopped(row))

def cleanup_status(+status: String, stdout: Bool) -> Outcome.Checked(Unit):
  do Outcome.Checked<Unit>:
    +event : String <- Proxy.json("SELECT json_object('type','codexProxyExit','code',CASE WHEN " ++ C.q(status) ++ " LIKE 'exit %' THEN CAST(substr(" ++ C.q(status) ++ ",6) AS INTEGER) END,'signal',CASE WHEN " ++ C.q(status) ++ " LIKE 'signal %' THEN CAST(substr(" ++ C.q(status) ++ ",8) AS INTEGER) END,'status'," ++ C.q(status) ++ ");")
    logged : Unit <- Bool.pick(Outcome.Checked(Unit),stdout,Proxy.record(event),Outcome.Checked.lift(Unit,IO.print_err(event)))
    Bool.pick(Outcome.Checked(Unit),String.eq(status,"exit 0"),Outcome.Checked.pure(Unit,Unit{}),Outcome.Checked.fail(Unit,1,"Public Codex proxy exit: " ++ status))

def combined_failed(code: U32, +cause: String, cleaned: Result<&1,&1,U32 & String,Unit>) -> Result<&1,&1,U32 & String,Unit>:
  match cleaned:
    case Done{value}: Fail{(code,cause)}
    case Fail{(cleanup_code,detail)}: Fail{(code,cause ++ "\nCodex proxy cleanup: " ++ detail)}

def combined(result: Result<&1,&1,U32 & String,Unit>, cleaned: Result<&1,&1,U32 & String,Unit>) -> Result<&1,&1,U32 & String,Unit>:
  match result:
    case Done{value}: cleaned
    case Fail{(code,+cause)}: combined_failed(code,cause,cleaned)

def cleanup_closed(result: Result<&1,&1,U32 & String,String>, stdout: Bool) -> Outcome.Checked(Unit):
  match result:
    case Fail{error}: Outcome.Checked.from_result(Unit,Fail{error})
    case Done{status}: cleanup_status(status,stdout)

def unsubscribe(+subscription: U32) -> Outcome.Checked(Unit):
  Bool.pick(Outcome.Checked(Unit),U32.is_eq(subscription,0),Outcome.Checked.pure(Unit,Unit{}),Custody.Instance.unsubscribe(subscription))

def cleanup(+link: Proxy.Link, stdout: Bool) -> Outcome.Checked(Unit):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    closed : Unit <- Chan.close(Proxy.CodexEvent,Proxy.events(link))
    removed : Result<&1,&1,U32 & String,Unit> <- unsubscribe(Proxy.subscription(link))
    status : Result<&1,&1,U32 & String,String> <- Native.CodexProxy.close(Proxy.proxy(link))
    cleaned : Result<&1,&1,U32 & String,Unit> <- cleanup_closed(status,stdout)
    IO.pure(Result<&1,&1,U32 & String,Unit>,combined(removed,cleaned))

def finished(+link: Proxy.Link, stdout: Bool, result: Result<&1,&1,U32 & String,Unit>) -> Outcome.Checked(Unit):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    cleaned : Result<&1,&1,U32 & String,Unit> <- cleanup(link,stdout)
    IO.pure(Result<&1,&1,U32 & String,Unit>,combined(result,cleaned))

def failure_retained_cause(+db: String, +session: String, +thread: String, +cause: String, retained: Result<&1,&1,U32 & String,Unit>) -> Outcome.Checked(Unit):
  match retained:
    case Done{value}: notify_failure(db,session,thread,cause)
    case Fail{(retention_code,detail)}: notify_failure(db,session,thread,cause ++ "\nAdmission failure custody could not be updated: " ++ detail)

def failure_retained(+db: String, +session: String, +thread: String, original: U32 & String, retained: Result<&1,&1,U32 & String,Unit>) -> Outcome.Checked(Unit):
  match original:
    case (code,+cause): failure_retained_cause(db,session,thread,cause,retained)

def follow_failed(+db: String, +session: String, +thread: String, result: Result<&1,&1,U32 & String,Unit>) -> Outcome.Checked(Unit):
  match result:
    case Done{value}: Outcome.Checked.pure(Unit,value)
    case Fail{(+code,+cause)}: do IO<Result<&1,&1,U32 & String,Unit>>:
      retained : Result<&1,&1,U32 & String,Unit> <- retained_failure(db,session,thread,cause)
      notified : Result<&1,&1,U32 & String,Unit> <- failure_retained(db,session,thread,(code,cause),retained)
      IO.pure(Result<&1,&1,U32 & String,Unit>,combined(Fail{(code,cause)},notified))

def initialized_run(+link: Proxy.Link, action: Proxy.Pending -> Outcome.Checked(Unit)) -> Outcome.Checked(Unit):
  do Outcome.Checked<Unit>:
    +pending : Proxy.Pending <- Proxy.initialize(link)
    action(pending)

def opened(+link: Proxy.Link, stdout: Bool, action: Proxy.Pending -> Outcome.Checked(Unit)) -> Outcome.Checked(Unit):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    armed : Unit <- Proxy.arm_native(link)
    notices : Unit <- Proxy.arm_notice(link,Bool.not(U32.is_eq(Proxy.subscription(link),0)))
    result : Result<&1,&1,U32 & String,Unit> <- initialized_run(link,action)
    finished(link,stdout,result)

def opened_native(+subscription: U32, action: Proxy.Link -> Outcome.Checked(Unit), result: Result<&1,&1,U32 & String,U32>) -> Outcome.Checked(Unit):
  match result:
    case Fail{error}: do IO<Result<&1,&1,U32 & String,Unit>>:
      removed : Result<&1,&1,U32 & String,Unit> <- unsubscribe(subscription)
      IO.pure(Result<&1,&1,U32 & String,Unit>,combined(Fail{error},removed))
    case Done{handle}: do IO<Result<&1,&1,U32 & String,Unit>>:
      events : Chan(Proxy.CodexEvent) <- Chan.new(Proxy.CodexEvent,1024)
      action(Proxy.Link{handle,subscription,events})

def open(+subscription: U32, action: Proxy.Link -> Outcome.Checked(Unit)) -> Outcome.Checked(Unit):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    result : Result<&1,&1,U32 & String,U32> <- Native.CodexProxy.open()
    opened_native(subscription,action,result)

def followed(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String) -> Outcome.Checked(Unit):
  opened(link,True{},pending => follow_run(link,executable,db,session,thread,pending))

def follow_subscribed(+executable: String, +db: String, +session: String, +thread: String, subscribed: U32 & String) -> Outcome.Checked(Unit):
  match subscribed:
    case (subscription,readiness): do IO<Result<&1,&1,U32 & String,Unit>>:
      result : Result<&1,&1,U32 & String,Unit> <- open(subscription,link => followed(link,executable,db,session,thread))
      follow_failed(db,session,thread,result)

def follow(+db: String, +session: String, +thread: String) -> Outcome.Checked(Unit):
  do Outcome.Checked<Unit>:
    +executable : String <- Lock.SessionLock.executable()
    subscribed : U32 & String <- Custody.Instance.subscribe(db,"0","0")
    follow_subscribed(executable,db,session,thread,subscribed)

def delivery_finished(result: Admission) -> Outcome.Checked(Unit):
  match result:
    case Accepted{state}: Outcome.Checked.pure(Unit,Unit{})
    case Refused{state,code,cause}: Outcome.Checked.fail(Unit,code,cause)

def delivery_run(+link: Proxy.Link, +thread: String, +notice: Notice, +pending: Proxy.Pending) -> Outcome.Checked(Unit):
  do Outcome.Checked<Unit>:
    result : Admission <- deliver_notice(link,initial(pending),thread,notice)
    delivery_finished(result)

def retained(+session: String, +thread: String, +row: Inbox.Snapshot) -> Outcome.Checked(Unit):
  Proxy.record("{\"type\":\"codexInboxRetained\",\"session\":" ++ J.string_literal(session) ++ ",\"threadId\":" ++ J.string_literal(thread) ++ ",\"stopped\":" ++ Bool.pick(String,Inbox.stopped(row),"true","false") ++ ",\"pendingCount\":" ++ Inbox.pending(row) ++ "}")

def session_row(+executable: String, +db: String, +session: String, +thread: String, +message: String, +token: String, +row: Inbox.Snapshot, +waiting: Bool) -> Outcome.Checked(Unit):
  match waiting:
    case False{}: retained(session,thread,row)
    case True{}: open(0,+link => opened(link,True{},pending => delivery_run(link,thread,Managed{executable,db,session,thread,token},pending)))

def session(+db: String, +session: String, +thread: String, +message: String, +token: String) -> Outcome.Checked(Unit):
  do Outcome.Checked<Unit>:
    +executable : String <- Lock.SessionLock.executable()
    +row : Inbox.Snapshot <- Inbox.read(db,session,thread)
    session_row(executable,db,session,thread,message,token,row,Bool.and(Bool.not(Inbox.stopped(row)),Inbox.has_pending(row)))

def suffix_text(parts: List<String>) -> String:
  match parts:
    case Nil{}: ""
    case head <> rest: "\n" ++ Tx.join("\n",Con{head,rest})

def pointer_document(thread: String, parts: List<String>) -> Outcome.Checked(Notice):
  match parts:
    case +notice <> suffix: do Outcome.Checked<Notice>:
      db : String <- Proxy.text(notice,"$.database")
      session : String <- Proxy.text(notice,"$.recipient")
      token : String <- Proxy.text(notice,"$.claimToken")
      Outcome.Checked.pure(Notice,Pointer{db,session,thread,token,notice,suffix_text(suffix)})
    case Nil{}: Outcome.Checked.fail(Notice,2,"The Codex inbox pointer has no JSON notice.")

def pointer_lines(thread: String, parts: List<String>) -> Outcome.Checked(Notice):
  match parts:
    case prefix <> rest: pointer_document(thread,rest)
    case Nil{}: Outcome.Checked.fail(Notice,2,"The Codex inbox pointer is empty.")

def pointer_segments(parts: List<&2,String>) -> List<String>:
  match parts:
    case Nil{}: Nil{}
    case head <> rest: Con{head,pointer_segments(rest)}

def pointer_parts(thread: String, pointer: String, managed: Bool) -> Outcome.Checked(Notice):
  match managed:
    case True{}: pointer_lines(thread,pointer_segments(String.split(pointer,Char.from_u32(10))))
    case False{}: Outcome.Checked.pure(Notice,Literal{pointer})

def pointer_notice(+thread: String, +pointer: String) -> Outcome.Checked(Notice):
  pointer_parts(thread,pointer,Tx.starts_with(pointer,"Baton input is pending.\n"))

def deliver(+db: String, +thread: String, +pointer: String) -> Outcome.Checked(Unit):
  do Outcome.Checked<Unit>:
    notice : Notice <- pointer_notice(thread,pointer)
    open(0,+link => opened(link,True{},pending => delivery_run(link,thread,notice,pending)))

def witnessed(+thread: String, +active: Bool, result: State & String) -> Outcome.Checked(Unit):
  match result:
    case (state,turn): do Outcome.Checked<Unit>:
      +id : String <- Proxy.value(turn,"$.id")
      Outcome.Checked.lift(Unit,IO.write("{\"threadId\":" ++ J.string_literal(thread) ++ ",\"turnId\":" ++ id ++ ",\"active\":" ++ Bool.pick(String,active,"true","false") ++ "}\n"))

def witness_read(+link: Proxy.Link, +thread: String, result: State & String) -> Outcome.Checked(Unit):
  match result:
    case (+state,+response): do Outcome.Checked<Unit>:
      +active : Bool <- Proxy.truth(response,"json_extract(value,'$.thread.status.type')='active'")
      turn : State & String <- Bool.pick(Outcome.Checked(State & String),active,current_turn(link,state,thread,""),Outcome.Checked.pure(State & String,(state,"null")))
      witnessed(thread,active,turn)

def witness_run(+link: Proxy.Link, +thread: String, +pending: Proxy.Pending) -> Outcome.Checked(Unit):
  do Outcome.Checked<Unit>:
    result : State & String <- request(link,initial(pending),thread,"thread/read",thread_params(thread))
    witness_read(link,thread,result)

def witness(+db: String, +thread: String) -> Outcome.Checked(Unit):
  open(0,+link => opened(link,False{},pending => witness_run(link,thread,pending)))
