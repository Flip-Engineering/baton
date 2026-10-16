import Base
import ../coordinator/commands.bend as C
import ./store.bend as Store
import ./wake.bend as Wake
import ./agent-input.bend as Input
import ./codex-inbox-store.bend as Inbox
import ./codex-inbox-proxy.bend as Proxy
import ../host/codex-proxy.bend as Native
import ../host/instance.bend as Custody
import ../host/sqlite.bend as DB
import ../host/session-lock.bend as Lock
import ../json/canonical.bend as J
import ../git/text.bend as Tx

# The live reducer is reconstructed from the provider and committed inbox after
# restart. Complete items remain until the corresponding terminal report commits.
type State is Data:
  State{pending: Proxy.Pending, items: String, reported: String, observed: String}

type Notice is Data:
  Managed{executable: String, database: String, session: String, thread: String, token: String}
  Pointer{database: String, session: String, thread: String, token: String, notice: String, suffix: String}
  Literal{text: String}

def caught(-A: Type, outcome: IO.OP<Result<&1,&1,U32 & String,A>>) -> Result<&1,&1,U32 & String,A>:
  match outcome:
    case Emit{value}: value
    case Halt{code,message}: Fail{(code,message)}

def attempt(-A: Type, action: IO(A)) -> IO(Result<&1,&1,U32 & String,A>):
  R => k => k(caught(A,action(Result<&1,&1,U32 & String,A>,value => Emit{Done{value}})))

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

def synced(+state: State, +thread: String) -> IO(State):
  do IO<State>:
    +queue : String = Proxy.frames(state_pending(state))
    +updated : String <- Proxy.json("SELECT coalesce(json_group_array(turn),'[]') FROM (SELECT value AS turn FROM json_each(" ++ C.q(observed(state)) ++ ") UNION SELECT coalesce(json_extract(value,'$.params.turn.id'),json_extract(value,'$.params.turnId')) AS turn FROM json_each(" ++ C.q(queue) ++ ") WHERE json_extract(value,'$.params.threadId')=" ++ C.q(thread) ++ " AND json_extract(value,'$.method') IN ('item/completed','turn/completed','turn/started')) WHERE turn IS NOT NULL AND turn NOT IN (SELECT value FROM json_each(" ++ C.q(reported(state)) ++ "));")
    IO.pure(State,State{state_pending(state),items(state),reported(state),updated})

def request_result(result: Proxy.Pending & String, +state: State, +thread: String) -> IO(State & String):
  match result:
    case (pending,response): do IO<State & String>:
      +next : State <- synced(replace_pending(state,pending),thread)
      IO.pure(State & String,(next,response))

def request(+link: Proxy.Link, +state: State, +thread: String, +method: String, +params: String) -> IO(State & String):
  do IO<State & String>:
    result : Proxy.Pending & String <- Proxy.rpc(link,state_pending(state),method,params)
    request_result(result,state,thread)

type Admission is Type:
  Accepted{state: State}
  Refused{state: State, code: U32, cause: String}

def admission_response(+state: State, result: Result<&1,&1,U32 & String,String>, next: State -> String -> IO(Admission)) -> IO(Admission):
  match result:
    case Fail{(code,cause)}: IO.pure(Admission,Refused{state,code,cause})
    case Done{response}: next(state,response)

def admission_received(+state: State, +thread: String, result: Proxy.Pending & Result<&1,&1,U32 & String,String>, next: State -> String -> IO(Admission)) -> IO(Admission):
  match result:
    case (pending,result): do IO<Admission>:
      +updated : State <- synced(replace_pending(state,pending),thread)
      admission_response(updated,result,next)

def admission_rpc(+link: Proxy.Link, +state: State, +thread: String, +method: String, +params: String, next: State -> String -> IO(Admission)) -> IO(Admission):
  do IO<Admission>:
    result : Proxy.Pending & Result<&1,&1,U32 & String,String> <- Proxy.rpc_result(link,state_pending(state),method,params)
    admission_received(state,thread,result,next)

def thread_params(+thread: String) -> String:
  "{\"threadId\":" ++ J.string_literal(thread) ++ ",\"includeTurns\":false}"

def turn_params(+thread: String, +cursor: String) -> String:
  "{\"threadId\":" ++ J.string_literal(thread) ++ ",\"sortDirection\":\"desc\",\"itemsView\":\"notLoaded\""
  ++ Bool.pick(String,String.is_empty(cursor),"",",\"cursor\":" ++ J.string_literal(cursor)) ++ "}"

def turn_page_selected(+link: Proxy.Link, +state: State, +thread: String, +page: String, +turn: String, +cursor: String, +found: Bool, again: State -> String -> IO(State & String)) -> IO(State & String):
  match found:
    case True{}: IO.pure(State & String,(state,turn))
    case False{}: Bool.pick(IO(State & String),String.is_empty(cursor),IO.die(State & String,1,"Public Codex active thread " ++ thread ++ " returned no in-progress turn identity after cursor exhaustion: " ++ page),again(state,cursor))

def turn_page(+link: Proxy.Link, +thread: String, result: State & String, again: State -> String -> IO(State & String)) -> IO(State & String):
  match result:
    case (state,+page): do IO<State & String>:
      +turn : String <- Proxy.json("SELECT coalesce((SELECT value FROM json_each(" ++ C.q(page) ++ ",'$.data') WHERE json_extract(value,'$.status')='inProgress' LIMIT 1),'null');")
      +cursor : String <- Proxy.text(page,"$.nextCursor")
      turn_page_selected(link,state,thread,page,turn,cursor,Bool.not(String.eq(turn,"null")),again)

@unsafe
def current_turn(+link: Proxy.Link, +state: State, +thread: String, +cursor: String) -> IO(State & String):
  do IO<State & String>:
    result : State & String <- request(link,state,thread,"thread/turns/list",turn_params(thread,cursor))
    turn_page(link,thread,result,next => more => current_turn(link,next,thread,more))

def refreshed_fields(fields: List<String>, +executable: String, +db: String, +session: String) -> IO(String & String):
  match fields:
    case token <> rest: do IO<String & String>:
      +row : Inbox.Snapshot <- IO.try(Inbox.Snapshot,Inbox.row_fields(rest))
      IO.pure(String & String,(token,Inbox.pointer(executable,db,session,row)))
    case Nil{}: IO.pure(String & String,("",""))

def refreshed_managed(+current: String, +executable: String, +db: String, +session: String, +empty: Bool) -> IO(String & String):
  match empty:
    case True{}: IO.pure(String & String,("",""))
    case False{}: refreshed_fields(Tx.split_tabs(current),executable,db,session)

def refreshed_pointer(fields: List<String>, +notice: String, +suffix: String) -> IO(String & String):
  match fields:
    case token <> rest: do IO<String & String>:
      +row : Inbox.Snapshot <- IO.try(Inbox.Snapshot,Inbox.row_fields(rest))
      +updated : String <- Proxy.json("SELECT json_remove(json_set(" ++ C.q(notice) ++ ",'$.pendingCount',CAST(" ++ C.q(Inbox.pending(row)) ++ " AS INTEGER)),'$.claimToken');")
      IO.pure(String & String,(token,"Baton input is pending.\n" ++ updated ++ suffix))
    case Nil{}: IO.pure(String & String,("",""))

def refreshed_pointer_present(+current: String, +notice: String, +suffix: String, +empty: Bool) -> IO(String & String):
  match empty:
    case True{}: IO.pure(String & String,("",""))
    case False{}: refreshed_pointer(Tx.split_tabs(current),notice,suffix)

def refresh(+notice: Notice, +status: String) -> IO(String & String):
  match notice:
    case Literal{text}: IO.pure(String & String,("",text))
    case Managed{executable,+db,+session,thread,token}: do IO<String & String>:
      +current : String <- Inbox.refresh(db,session,thread,token,status)
      refreshed_managed(current,executable,db,session,String.is_empty(current))
    case Pointer{db,session,thread,token,notice,suffix}: do IO<String & String>:
      +current : String <- Inbox.refresh(db,session,thread,token,status)
      refreshed_pointer_present(current,notice,suffix,String.is_empty(current))

def admission_stored(+notice: Notice, +token: String, +turn: String) -> IO(Unit):
  match notice:
    case Literal{text}: IO.pure(Unit,Unit{})
    case Managed{executable,db,session,thread,saved}: Inbox.admitted(db,session,thread,token,turn)
    case Pointer{db,session,thread,saved,document,suffix}: Inbox.admitted(db,session,thread,token,turn)

def observed_add(+state: State, +turn: String) -> IO(State):
  do IO<State>:
    +next : String <- Proxy.json("SELECT json_group_array(value) FROM (SELECT value FROM json_each(" ++ C.q(observed(state)) ++ ") UNION SELECT " ++ C.q(turn) ++ ") WHERE value<>'' AND value NOT IN (SELECT value FROM json_each(" ++ C.q(reported(state)) ++ "));")
    IO.pure(State,State{state_pending(state),items(state),reported(state),next})

def admission_result(+notice: Notice, +token: String, +thread: String, +method: String, +state: State, +response: String) -> IO(Admission):
  do IO<Admission>:
    recorded : Unit <- Proxy.record("{\"type\":\"codexInboxAdmission\",\"threadId\":" ++ J.string_literal(thread) ++ ",\"method\":" ++ J.string_literal(method) ++ ",\"result\":" ++ response ++ "}")
    +turn : String <- Proxy.text(response,"$.turnId")
    +nested : String <- Proxy.text(response,"$.turn.id")
    +id : String = Bool.pick(String,String.is_empty(turn),nested,turn)
    stored : Unit <- admission_stored(notice,token,id)
    next : State <- observed_add(state,id)
    IO.pure(Admission,Accepted{next})

def coalesced_row(+session: String, +thread: String, +row: Inbox.Snapshot) -> IO(Unit):
  Proxy.record("{\"type\":\"codexInboxCoalesced\",\"session\":" ++ J.string_literal(session) ++ ",\"threadId\":" ++ J.string_literal(thread) ++ ",\"stopped\":" ++ Bool.pick(String,Inbox.stopped(row),"true","false") ++ ",\"pendingCount\":" ++ Inbox.pending(row) ++ "}")

def coalesced(+notice: Notice) -> IO(Unit):
  match notice:
    case Literal{text}: IO.pure(Unit,Unit{})
    case Managed{executable,+db,+session,+thread,token}: do IO<Unit>:
      row : Inbox.Snapshot <- IO.try(Inbox.Snapshot,Inbox.read(db,session,thread))
      coalesced_row(session,thread,row)
    case Pointer{+db,+session,+thread,token,document,suffix}: do IO<Unit>:
      row : Inbox.Snapshot <- IO.try(Inbox.Snapshot,Inbox.read(db,session,thread))
      coalesced_row(session,thread,row)

def send_refreshed(+link: Proxy.Link, +state: State, +thread: String, +method: String, +turn: String, +notice: Notice, +token: String, +pointer: String, +empty: Bool) -> IO(Admission):
  match empty:
    case True{}: do IO<Admission>:
      logged : Unit <- coalesced(notice)
      IO.pure(Admission,Accepted{state})
    case False{}:
      admission_rpc(link,state,thread,method,"{\"threadId\":" ++ J.string_literal(thread) ++ ",\"input\":[{\"type\":\"text\",\"text\":" ++ J.string_literal(pointer) ++ "}]" ++ Bool.pick(String,String.is_empty(turn),"",",\"expectedTurnId\":" ++ J.string_literal(turn)) ++ "}",next => response => admission_result(notice,token,thread,method,next,response))

def send_admission(+link: Proxy.Link, +state: State, +thread: String, +method: String, +turn: String, +notice: Notice, refreshed: String & String) -> IO(Admission):
  match refreshed:
    case (token,+pointer): send_refreshed(link,state,thread,method,turn,notice,token,pointer,String.is_empty(pointer))

def steer_selected(+link: Proxy.Link, +thread: String, +notice: Notice, +state: State, +page: String, +turn: String, +cursor: String, +found: Bool, again: State -> String -> IO(Admission)) -> IO(Admission):
  match found:
    case True{}: do IO<Admission>:
      +id : String <- Proxy.text(turn,"$.id")
      refreshed : String & String <- refresh(notice,"active")
      send_admission(link,state,thread,"turn/steer",id,notice,refreshed)
    case False{}:
      Bool.pick(IO(Admission),String.is_empty(cursor),IO.pure(Admission,Refused{state,1,"Public Codex active thread " ++ thread ++ " returned no in-progress turn identity after cursor exhaustion: " ++ page}),again(state,cursor))

def steer_page(+link: Proxy.Link, +thread: String, +notice: Notice, +state: State, +page: String, again: State -> String -> IO(Admission)) -> IO(Admission):
  do IO<Admission>:
    +turn : String <- Proxy.json("SELECT coalesce((SELECT value FROM json_each(" ++ C.q(page) ++ ",'$.data') WHERE json_extract(value,'$.status')='inProgress' LIMIT 1),'null');")
    +cursor : String <- Proxy.text(page,"$.nextCursor")
    steer_selected(link,thread,notice,state,page,turn,cursor,Bool.not(String.eq(turn,"null")),again)

@unsafe
def steer_current(+link: Proxy.Link, +thread: String, +notice: Notice, +state: State, +cursor: String) -> IO(Admission):
  admission_rpc(link,state,thread,"thread/turns/list",turn_params(thread,cursor),next => page => steer_page(link,thread,notice,next,page,later => cursor => steer_current(link,thread,notice,later,cursor)))

def deliver_status(+link: Proxy.Link, +state: State, +thread: String, +notice: Notice, +status: String, +active: Bool) -> IO(Admission):
  match active:
    case True{}: steer_current(link,thread,notice,state,"")
    case False{}: do IO<Admission>:
      refreshed : String & String <- refresh(notice,status)
      send_admission(link,state,thread,"turn/start","",notice,refreshed)

def deliver_read(+link: Proxy.Link, +thread: String, +notice: Notice, +state: State, +response: String) -> IO(Admission):
  do IO<Admission>:
    +status : String <- Proxy.text(response,"$.thread.status.type")
    deliver_status(link,state,thread,notice,status,String.eq(status,"active"))

def deliver_loaded(+link: Proxy.Link, +thread: String, +notice: Notice, +state: State, +response: String, +unloaded: Bool) -> IO(Admission):
  match unloaded:
    case True{}: admission_rpc(link,state,thread,"thread/resume",thread_params(thread),next => resumed => deliver_read(link,thread,notice,next,resumed))
    case False{}: deliver_read(link,thread,notice,state,response)

def deliver_started(+link: Proxy.Link, +thread: String, +notice: Notice, +state: State, +response: String) -> IO(Admission):
  do IO<Admission>:
    +unloaded : Bool <- Proxy.truth(response,"json_extract(value,'$.thread.status.type')='notLoaded'")
    deliver_loaded(link,thread,notice,state,response,unloaded)

def deliver_notice(+link: Proxy.Link, +state: State, +thread: String, +notice: Notice) -> IO(Admission):
  admission_rpc(link,state,thread,"thread/read",thread_params(thread),next => response => deliver_started(link,thread,notice,next,response))

def membership(+values: String, +value: String) -> IO(Bool):
  Proxy.truth(values,"EXISTS(SELECT 1 FROM json_each(item.value) j WHERE j.value=" ++ C.q(value) ++ ")")

def report(+db: String, +session: String, +id: String, +body: String) -> IO(String):
  do IO<String>:
    +command : C.Command = C.Report{id,session,body}
    +saved : String <- IO.try(String,Store.apply(db,command))
    woken : Unit <- IO.try(Unit,Wake.drive_command(db,command,Done{saved}))
    IO.pure(String,saved)

def terminal_marked(+state: State, +turn: String) -> IO(State):
  do IO<State>:
    +reports : String <- Proxy.json("SELECT json_group_array(value) FROM (SELECT value FROM json_each(" ++ C.q(reported(state)) ++ ") UNION SELECT " ++ C.q(turn) ++ ");")
    +remaining : String <- Proxy.json("SELECT coalesce(json_group_array(value),'[]') FROM json_each(" ++ C.q(observed(state)) ++ ") WHERE value<>" ++ C.q(turn) ++ ";")
    +completed : String <- Proxy.json("SELECT coalesce(json_group_array(json(value)),'[]') FROM json_each(" ++ C.q(items(state)) ++ ") WHERE json_extract(value,'$.turnId')<>" ++ C.q(turn) ++ ";")
    IO.pure(State,State{state_pending(state),completed,reports,remaining})

def turn_retained(+session: String, +thread: String, +turn: String) -> IO(Unit):
  Proxy.record("{\"type\":\"codexInboxTurnRetained\",\"session\":" ++ J.string_literal(session) ++ ",\"threadId\":" ++ J.string_literal(thread) ++ ",\"turn\":" ++ turn ++ "}")

def terminal_report(+db: String, +session: String, +thread: String, +state: State, +turn: String, +turn_id: String, +status: String, +already: Bool) -> IO(State):
  match already:
    case True{}: terminal_marked(state,turn_id)
    case False{}: do IO<State>:
      +completed : String <- Proxy.json("SELECT coalesce(json_group_array(json(json_extract(value,'$.item'))),'[]') FROM json_each(" ++ C.q(items(state)) ++ ") WHERE json_extract(value,'$.turnId')=" ++ C.q(turn_id) ++ ";")
      +id : String = "codex-inbox-turn:" ++ session ++ ":" ++ thread ++ ":" ++ turn_id
      +body : String = "{\"type\":\"codex-inbox-turn-settled\",\"session\":" ++ J.string_literal(session) ++ ",\"threadId\":" ++ J.string_literal(thread) ++ ",\"turn\":" ++ turn ++ ",\"completedItems\":" ++ completed ++ "}"
      +saved : String <- report(db,session,id,body)
      logged : Unit <- Proxy.record("{\"type\":\"codexInboxTurnReport\",\"id\":" ++ J.string_literal(id) ++ ",\"session\":" ++ J.string_literal(session) ++ ",\"threadId\":" ++ J.string_literal(thread) ++ ",\"code\":0,\"signal\":null,\"output\":" ++ J.string_literal(saved) ++ "}")
      settled : Unit <- Input.settle_codex(db,session,thread,turn_id,status)
      kept : Unit <- Bool.pick(IO(Unit),String.eq(status,"completed"),IO.pure(Unit,Unit{}),turn_retained(session,thread,turn))
      terminal_marked(state,turn_id)

def terminal(+db: String, +session: String, +thread: String, +state: State, +frame: String) -> IO(State):
  do IO<State>:
    +turn : String <- Proxy.value(frame,"$.params.turn")
    +id : String <- Proxy.text(turn,"$.id")
    +status : String <- Proxy.text(turn,"$.status")
    logged : Unit <- Proxy.record("{\"type\":\"codexInboxTurnSettled\",\"session\":" ++ J.string_literal(session) ++ ",\"threadId\":" ++ J.string_literal(thread) ++ ",\"turnId\":" ++ J.string_literal(id) ++ ",\"status\":" ++ J.string_literal(status) ++ ",\"turn\":" ++ turn ++ "}")
    +row : Inbox.Snapshot <- IO.try(Inbox.Snapshot,Inbox.read(db,session,thread))
    retained : Unit <- Bool.pick(IO(Unit),String.eq(status,"completed"),IO.pure(Unit,Unit{}),Inbox.failed(db,session,thread,Inbox.input_seq(row),turn,id))
    +done : Bool <- membership(reported(state),id)
    terminal_report(db,session,thread,state,turn,id,status,done)

def completed_item(+session: String, +state: State, +frame: String) -> IO(State):
  do IO<State>:
    +turn : String <- Proxy.text(frame,"$.params.turnId")
    +item : String <- Proxy.value(frame,"$.params.item")
    +id : String <- Proxy.text(item,"$.id")
    +updated : String <- Proxy.json("SELECT json_insert(coalesce(json_group_array(json(value)),'[]'),'$[#]',json_object('turnId'," ++ C.q(turn) ++ ",'item',json(" ++ C.q(item) ++ "))) FROM json_each(" ++ C.q(items(state)) ++ ") WHERE NOT(json_extract(value,'$.turnId')=" ++ C.q(turn) ++ " AND json_extract(value,'$.item.id')=" ++ C.q(id) ++ ");")
    +params : String <- Proxy.value(frame,"$.params")
    +logged_frame : String <- Proxy.json("SELECT json_set(" ++ C.q(params) ++ ",'$.type','codexInboxItemCompleted','$.session'," ++ C.q(session) ++ ");")
    logged : Unit <- Proxy.record(logged_frame)
    observed_add(State{state_pending(state),updated,reported(state),observed(state)},turn)

def notification_method(+db: String, +session: String, +thread: String, +state: State, +frame: String, +method: String) -> IO(State):
  match method:
    case "turn/completed": terminal(db,session,thread,state,frame)
    case "item/completed": completed_item(session,state,frame)
    case "turn/started": do IO<State>:
      +turn : String <- Proxy.text(frame,"$.params.turn.id")
      observed_add(state,turn)
    case other: IO.pure(State,state)

def notification_selected(+db: String, +session: String, +thread: String, +state: State, +frame: String, +method: String, +selected: Bool) -> IO(State):
  match selected:
    case False{}: IO.pure(State,state)
    case True{}: notification_method(db,session,thread,state,frame,method)

def notification_error(+db: String, +session: String, +thread: String, +state: State, +frame: String, +failed: Bool) -> IO(State):
  match failed:
    case True{}: IO.die(State,1,"Public Codex notification failed: " ++ frame)
    case False{}: do IO<State>:
      +method : String <- Proxy.text(frame,"$.method")
      +source : String <- Proxy.text(frame,"$.params.threadId")
      notification_selected(db,session,thread,state,frame,method,String.eq(source,thread))

def notification(+db: String, +session: String, +thread: String, +state: State, +frame: String) -> IO(State):
  do IO<State>:
    failed : Bool <- Proxy.truth(frame,"json_type(value,'$.error') IS NOT NULL AND json_type(value,'$.error')<>'null'")
    notification_error(db,session,thread,state,frame,failed)

def released(+session: String, +thread: String, +row: Inbox.Snapshot) -> IO(Unit):
  Proxy.record("{\"type\":\"codexInboxReleased\",\"session\":" ++ J.string_literal(session) ++ ",\"threadId\":" ++ J.string_literal(thread) ++ ",\"stopped\":" ++ Bool.pick(String,Inbox.stopped(row),"true","false") ++ ",\"pendingCount\":" ++ Inbox.pending(row) ++ "}")

def notify_failure(+db: String, +session: String, +thread: String, +cause: String) -> IO(Unit):
  do IO<Unit>:
    +nonce : String <- Proxy.json("SELECT lower(hex(randomblob(16)));")
    +id : String = "codex-inbox-failure:" ++ session ++ ":" ++ nonce
    +body : String = "{\"type\":\"codex-inbox-continuation-failed\",\"session\":" ++ J.string_literal(session) ++ ",\"threadId\":" ++ J.string_literal(thread) ++ ",\"cause\":" ++ J.string_literal(cause) ++ "}"
    +output : String <- report(db,session,id,body)
    Proxy.record("{\"type\":\"codexInboxFailureReport\",\"id\":" ++ J.string_literal(id) ++ ",\"session\":" ++ J.string_literal(session) ++ ",\"threadId\":" ++ J.string_literal(thread) ++ ",\"code\":0,\"signal\":null,\"output\":" ++ J.string_literal(output) ++ "}")

def retained_failure(+db: String, +session: String, +thread: String, +cause: String) -> IO(Unit):
  do IO<Unit>:
    +row : Inbox.Snapshot <- IO.try(Inbox.Snapshot,Inbox.read(db,session,thread))
    Inbox.failed(db,session,thread,Inbox.input_seq(row),cause,"")

def admission_caught(+db: String, +session: String, +thread: String, result: Admission) -> IO(State):
  match result:
    case Accepted{state}: IO.pure(State,state)
    case Refused{state,code,+cause}: do IO<State>:
      retained : Unit <- retained_failure(db,session,thread,cause)
      notified : Unit <- notify_failure(db,session,thread,cause)
      IO.pure(State,state)

def admission_claimed(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State, +token: String, +empty: Bool) -> IO(Admission):
  match empty:
    case True{}: IO.pure(Admission,Accepted{state})
    case False{}: deliver_notice(link,state,thread,Managed{executable,db,session,thread,token})

def admit_current(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State, +ready: Bool) -> IO(Admission):
  match ready:
    case False{}: IO.pure(Admission,Accepted{state})
    case True{}: do IO<Admission>:
      +token : String <- Inbox.claim(db,session,thread)
      admission_claimed(link,executable,db,session,thread,state,token,String.is_empty(token))

def admit_row(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State, +row: Inbox.Snapshot, +claimed: Bool) -> IO(Admission):
  admit_current(link,executable,db,session,thread,state,Bool.and(Bool.not(Inbox.stopped(row)),Bool.and(Inbox.has_pending(row),Bool.not(claimed))))

def admit(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State) -> IO(State):
  do IO<State>:
    +row : Inbox.Snapshot <- IO.try(Inbox.Snapshot,Inbox.read(db,session,thread))
    +claimed : Bool <- Inbox.claimed(db,session,thread)
    admission : Admission <- admit_row(link,executable,db,session,thread,state,row,claimed)
    admission_caught(db,session,thread,admission)

type Step is Type:
  Finished{}
  Waiting{state: State, row: Inbox.Snapshot}

def active_turn(result: State & String) -> IO(State):
  match result:
    case (next,turn): do IO<State>:
      id : String <- Proxy.text(turn,"$.id")
      observed_add(next,id)

def active_observed(link: Proxy.Link, thread: String, state: State, needed: Bool) -> IO(State):
  match needed:
    case False{}: IO.pure(State,state)
    case True{}: do IO<State>:
      result : State & String <- current_turn(link,state,thread,"")
      active_turn(result)

def continue_admission(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State, +row: Inbox.Snapshot, +status: String, +allowed: Bool) -> IO(Step):
  match allowed:
    case True{}: do IO<Step>:
      +next : State <- admit(link,executable,db,session,thread,state)
      IO.pure(Step,Waiting{next,row})
    case False{}:
      Bool.pick(IO(Step),Bool.or(String.eq(status,"systemError"),String.eq(status,"notLoaded")),IO.die(Step,1,"Managed Codex inbox continuation cannot run: " ++ status),IO.pure(Step,Waiting{state,row}))

def retained_turn_page(+session: String, +thread: String, result: State & String) -> IO(State):
  match result:
    case (state,page): do IO<State>:
      turn : String <- Proxy.value(page,"$.data[0]")
      logged : Unit <- turn_retained(session,thread,turn)
      IO.pure(State,state)

def retain_existing(+link: Proxy.Link, +session: String, +thread: String, +state: State, +needed: Bool) -> IO(State):
  match needed:
    case False{}: IO.pure(State,state)
    case True{}: do IO<State>:
      result : State & String <- request(link,state,thread,"thread/turns/list",turn_params(thread,""))
      retained_turn_page(session,thread,result)

def continue_open(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State, +row: Inbox.Snapshot, +previous: Inbox.Snapshot, +status: String) -> IO(Step):
  do IO<Step>:
    +claimed : Bool <- Inbox.claimed(db,session,thread)
    +progress : Bool = Bool.not(String.eq(Inbox.handled(row),Inbox.handled(previous)))
    +control : Bool = Bool.not(String.eq(Inbox.control_seq(row),Inbox.control_seq(previous)))
    +next : State <- retain_existing(link,session,thread,state,Bool.and(claimed,Bool.and(String.eq(status,"idle"),Inbox.has_pending(row))))
    continue_admission(link,executable,db,session,thread,next,row,status,Bool.and(Inbox.has_pending(row),Bool.or(progress,Bool.or(control,Bool.and(String.eq(status,"idle"),Bool.not(claimed))))))

def continue_status(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State, +row: Inbox.Snapshot, +previous: Inbox.Snapshot, +status: String, +done: Bool) -> IO(Step):
  match done:
    case True{}: do IO<Step>:
      logged : Unit <- released(session,thread,row)
      IO.pure(Step,Finished{})
    case False{}: continue_open(link,executable,db,session,thread,state,row,previous,status)

def continue_observed(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State, +row: Inbox.Snapshot, +previous: Inbox.Snapshot, +status: String) -> IO(Step):
  do IO<Step>:
    +empty : Bool <- Proxy.truth(observed(state),"json_array_length(value)=0")
    continue_status(link,executable,db,session,thread,state,row,previous,status,Bool.and(Bool.not(Inbox.has_pending(row)),Bool.and(Bool.not(String.eq(status,"active")),empty)))

def continue_read(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +row: Inbox.Snapshot, +previous: Inbox.Snapshot, result: State & String) -> IO(Step):
  match result:
    case (+state,+response): do IO<Step>:
      +status : String <- Proxy.text(response,"$.thread.status.type")
      +empty : Bool <- Proxy.truth(observed(state),"json_array_length(value)=0")
      +next : State <- active_observed(link,thread,state,Bool.and(String.eq(status,"active"),empty))
      continue_observed(link,executable,db,session,thread,next,row,previous,status)

def step_open(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State, +row: Inbox.Snapshot, +previous: Inbox.Snapshot, +stopped: Bool) -> IO(Step):
  match stopped:
    case True{}: do IO<Step>:
      logged : Unit <- released(session,thread,row)
      IO.pure(Step,Finished{})
    case False{}: do IO<Step>:
      result : State & String <- request(link,state,thread,"thread/read",thread_params(thread))
      continue_read(link,executable,db,session,thread,row,previous,result)

def step(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State, +previous: Inbox.Snapshot, +frame: String) -> IO(Step):
  do IO<Step>:
    +next : State <- notification(db,session,thread,state,frame)
    +row : Inbox.Snapshot <- IO.try(Inbox.Snapshot,Inbox.read(db,session,thread))
    step_open(link,executable,db,session,thread,next,row,previous,Inbox.stopped(row))

def loop_incoming(state: State, row: Inbox.Snapshot, incoming: Proxy.Pending & String, again: State -> Inbox.Snapshot -> String -> IO(Unit)) -> IO(Unit):
  match incoming:
    case (pending,frame): again(replace_pending(state,pending),row,frame)

def loop_next(link: Proxy.Link, result: Step, again: State -> Inbox.Snapshot -> String -> IO(Unit)) -> IO(Unit):
  match result:
    case Finished{}: IO.pure(Unit,Unit{})
    case Waiting{+state,row}: do IO<Unit>:
      incoming : Proxy.Pending & String <- Proxy.next(link,state_pending(state))
      loop_incoming(state,row,incoming,again)

@unsafe
def follow_loop(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State, +row: Inbox.Snapshot, +frame: String) -> IO(Unit):
  do IO<Unit>:
    result : Step <- step(link,executable,db,session,thread,state,row,frame)
    loop_next(link,result,next => previous => event => follow_loop(link,executable,db,session,thread,next,previous,event))

def following(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +row: Inbox.Snapshot, result: State & String) -> IO(Unit):
  match result:
    case (next,resumed): do IO<Unit>:
      logged : Unit <- Proxy.record("{\"type\":\"codexInboxSubscribed\",\"session\":" ++ J.string_literal(session) ++ ",\"threadId\":" ++ J.string_literal(thread) ++ "}")
      follow_loop(link,executable,db,session,thread,next,row,"{\"initial\":true}")

def follow_loaded(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +state: State, +row: Inbox.Snapshot, +stopped: Bool) -> IO(Unit):
  match stopped:
    case True{}: released(session,thread,row)
    case False{}: do IO<Unit>:
      result : State & String <- request(link,state,thread,"thread/resume","{\"threadId\":" ++ J.string_literal(thread) ++ "}")
      following(link,executable,db,session,thread,row,result)

def follow_run(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String, +pending: Proxy.Pending) -> IO(Unit):
  do IO<Unit>:
    +row : Inbox.Snapshot <- IO.try(Inbox.Snapshot,Inbox.read(db,session,thread))
    follow_loaded(link,executable,db,session,thread,initial(pending),row,Inbox.stopped(row))

def cleanup_status(+status: String) -> IO(Unit):
  do IO<Unit>:
    +event : String <- Proxy.json("SELECT json_object('type','codexProxyExit','code',CASE WHEN " ++ C.q(status) ++ " LIKE 'exit %' THEN CAST(substr(" ++ C.q(status) ++ ",6) AS INTEGER) END,'signal',CASE WHEN " ++ C.q(status) ++ " LIKE 'signal %' THEN CAST(substr(" ++ C.q(status) ++ ",8) AS INTEGER) END,'status'," ++ C.q(status) ++ ");")
    logged : Unit <- Proxy.record(event)
    Bool.pick(IO(Unit),String.eq(status,"exit 0"),IO.pure(Unit,Unit{}),IO.die(Unit,1,"Public Codex proxy exit: " ++ status))

def cleanup(+link: Proxy.Link) -> IO(Unit):
  do IO<Unit>:
    closed : Unit <- Chan.close(Proxy.CodexEvent,Proxy.events(link))
    removed : Unit <- Bool.pick(IO(Unit),U32.is_eq(Proxy.subscription(link),0),IO.pure(Unit,Unit{}),IO.try(Unit,Custody.Instance.unsubscribe(Proxy.subscription(link))))
    +status : String <- IO.try(String,Native.CodexProxy.close(Proxy.proxy(link)))
    cleanup_status(status)

def combined(result: Result<&1,&1,U32 & String,Unit>, cleaned: Result<&1,&1,U32 & String,Unit>) -> Result<&1,&1,U32 & String,Unit>:
  match result:
    case Done{value}: cleaned
    case Fail{(code,+cause)}:
      match cleaned:
        case Done{value}: Fail{(code,cause)}
        case Fail{(cleanup_code,detail)}: Fail{(code,cause ++ "\nCodex proxy cleanup: " ++ detail)}

def finished(+link: Proxy.Link, result: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    cleaned : Result<&1,&1,U32 & String,Unit> <- attempt(Unit,cleanup(link))
    IO.pure(Result<&1,&1,U32 & String,Unit>,combined(result,cleaned))

def failure_retained(+db: String, +session: String, +thread: String, original: U32 & String, retained: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match original:
    case (code,+cause):
      match retained:
        case Done{value}: notify_failure(db,session,thread,cause)
        case Fail{(retention_code,detail)}: notify_failure(db,session,thread,cause ++ "\nAdmission failure custody could not be updated: " ++ detail)

def follow_failed(+db: String, +session: String, +thread: String, result: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match result:
    case Done{value}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{value})
    case Fail{(+code,+cause)}: do IO<Result<&1,&1,U32 & String,Unit>>:
      retained : Result<&1,&1,U32 & String,Unit> <- attempt(Unit,retained_failure(db,session,thread,cause))
      notified : Result<&1,&1,U32 & String,Unit> <- attempt(Unit,failure_retained(db,session,thread,(code,cause),retained))
      IO.pure(Result<&1,&1,U32 & String,Unit>,combined(Fail{(code,cause)},notified))

def initialized_run(+link: Proxy.Link, action: Proxy.Pending -> IO(Unit)) -> IO(Unit):
  do IO<Unit>:
    +pending : Proxy.Pending <- Proxy.initialize(link)
    action(pending)

def opened(+link: Proxy.Link, action: Proxy.Pending -> IO(Unit)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    armed : Unit <- Proxy.arm_native(link)
    notices : Unit <- Proxy.arm_notice(link,Bool.not(U32.is_eq(Proxy.subscription(link),0)))
    result : Result<&1,&1,U32 & String,Unit> <- attempt(Unit,initialized_run(link,action))
    finished(link,result)

def opened_native(+subscription: U32, action: Proxy.Link -> IO(Result<&1,&1,U32 & String,Unit>), result: Result<&1,&1,U32 & String,U32>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match result:
    case Fail{error}: do IO<Result<&1,&1,U32 & String,Unit>>:
      removed : Unit <- Bool.pick(IO(Unit),U32.is_eq(subscription,0),IO.pure(Unit,Unit{}),IO.try(Unit,Custody.Instance.unsubscribe(subscription)))
      IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{handle}: do IO<Result<&1,&1,U32 & String,Unit>>:
      events : Chan(Proxy.CodexEvent) <- Chan.new(Proxy.CodexEvent,1024)
      action(Proxy.Link{handle,subscription,events})

def open(+subscription: U32, action: Proxy.Link -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    result : Result<&1,&1,U32 & String,U32> <- Native.CodexProxy.open()
    opened_native(subscription,action,result)

def followed(+link: Proxy.Link, +executable: String, +db: String, +session: String, +thread: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  opened(link,pending => follow_run(link,executable,db,session,thread,pending))

def follow_subscribed(+executable: String, +db: String, +session: String, +thread: String, result: Result<&1,&1,U32 & String,U32 & String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{(subscription,readiness)}: do IO<Result<&1,&1,U32 & String,Unit>>:
      result : Result<&1,&1,U32 & String,Unit> <- open(subscription,link => followed(link,executable,db,session,thread))
      follow_failed(db,session,thread,result)

def follow(+db: String, +session: String, +thread: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +executable : String <- IO.try(String,Lock.SessionLock.executable())
    subscription : Result<&1,&1,U32 & String,U32 & String> <- Custody.Instance.subscribe(db,"0","0")
    follow_subscribed(executable,db,session,thread,subscription)

def delivery_finished(result: Admission) -> IO(Unit):
  match result:
    case Accepted{state}: IO.pure(Unit,Unit{})
    case Refused{state,code,cause}: IO.die(Unit,code,cause)

def delivery_run(+link: Proxy.Link, +thread: String, +notice: Notice, +pending: Proxy.Pending) -> IO(Unit):
  do IO<Unit>:
    result : Admission <- deliver_notice(link,initial(pending),thread,notice)
    delivery_finished(result)

def retained(+session: String, +thread: String, +row: Inbox.Snapshot) -> IO(Unit):
  Proxy.record("{\"type\":\"codexInboxRetained\",\"session\":" ++ J.string_literal(session) ++ ",\"threadId\":" ++ J.string_literal(thread) ++ ",\"stopped\":" ++ Bool.pick(String,Inbox.stopped(row),"true","false") ++ ",\"pendingCount\":" ++ Inbox.pending(row) ++ "}")

def session_row(+executable: String, +db: String, +session: String, +thread: String, +message: String, +token: String, +row: Inbox.Snapshot, +waiting: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match waiting:
    case False{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      logged : Unit <- retained(session,thread,row)
      IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case True{}: open(0,+link => opened(link,pending => delivery_run(link,thread,Managed{executable,db,session,thread,token},pending)))

def session(+db: String, +session: String, +thread: String, +message: String, +token: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +executable : String <- IO.try(String,Lock.SessionLock.executable())
    +row : Inbox.Snapshot <- IO.try(Inbox.Snapshot,Inbox.read(db,session,thread))
    session_row(executable,db,session,thread,message,token,row,Bool.and(Bool.not(Inbox.stopped(row)),Inbox.has_pending(row)))

def suffix_text(parts: List<String>) -> String:
  match parts:
    case Nil{}: ""
    case head <> rest: "\n" ++ Tx.join("\n",Con{head,rest})

def pointer_document(thread: String, parts: List<String>) -> IO(Notice):
  match parts:
    case +notice <> suffix: do IO<Notice>:
      db : String <- Proxy.text(notice,"$.database")
      session : String <- Proxy.text(notice,"$.recipient")
      token : String <- Proxy.text(notice,"$.claimToken")
      IO.pure(Notice,Pointer{db,session,thread,token,notice,suffix_text(suffix)})
    case Nil{}: IO.die(Notice,2,"The Codex inbox pointer has no JSON notice.")

def pointer_lines(thread: String, parts: List<String>) -> IO(Notice):
  match parts:
    case prefix <> rest: pointer_document(thread,rest)
    case Nil{}: IO.die(Notice,2,"The Codex inbox pointer is empty.")

def pointer_segments(parts: List<&2,String>) -> List<String>:
  match parts:
    case Nil{}: Nil{}
    case head <> rest: Con{head,pointer_segments(rest)}

def pointer_parts(thread: String, pointer: String, managed: Bool) -> IO(Notice):
  match managed:
    case True{}: pointer_lines(thread,pointer_segments(String.split(pointer,Char.from_u32(10))))
    case False{}: IO.pure(Notice,Literal{pointer})

def pointer_notice(+thread: String, +pointer: String) -> IO(Notice):
  pointer_parts(thread,pointer,Tx.starts_with(pointer,"Baton input is pending.\n"))

def deliver(+db: String, +thread: String, +pointer: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    notice : Notice <- pointer_notice(thread,pointer)
    open(0,+link => opened(link,pending => delivery_run(link,thread,notice,pending)))

def witnessed(+thread: String, +active: Bool, result: State & String) -> IO(Unit):
  match result:
    case (state,turn): do IO<Unit>:
      +id : String <- Proxy.value(turn,"$.id")
      IO.write("{\"threadId\":" ++ J.string_literal(thread) ++ ",\"turnId\":" ++ id ++ ",\"active\":" ++ Bool.pick(String,active,"true","false") ++ "}\n")

def witness_read(+link: Proxy.Link, +thread: String, result: State & String) -> IO(Unit):
  match result:
    case (+state,+response): do IO<Unit>:
      +active : Bool <- Proxy.truth(response,"json_extract(value,'$.thread.status.type')='active'")
      turn : State & String <- Bool.pick(IO(State & String),active,current_turn(link,state,thread,""),IO.pure(State & String,(state,"null")))
      witnessed(thread,active,turn)

def witness_run(+link: Proxy.Link, +thread: String, +pending: Proxy.Pending) -> IO(Unit):
  do IO<Unit>:
    result : State & String <- request(link,initial(pending),thread,"thread/read",thread_params(thread))
    witness_read(link,thread,result)

def witness(+db: String, +thread: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  open(0,+link => opened(link,pending => witness_run(link,thread,pending)))
