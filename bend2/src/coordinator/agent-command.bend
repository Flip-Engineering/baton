import Base
import ./agent-actions.bend as A
import ./agent-route.bend as Route
import ./agent-native.bend as Native
import ./agent-input.bend as AgentInput
import ../coordinator/message-status.bend as MessageStatus
import ./branching.bend as Branching
import ./repl.bend as Repl
import ../coordinator/commands.bend as C
import ./store.bend as Store
import ./message-batch.bend as Batch
import ./project.bend as Project
import ../host/sqlite.bend as DB
import ../host/instance.bend as Custody
import ../context/raw.bend as Raw
import ../context/request.bend as Req
import ../git/text.bend as Tx

type ContextSource is Data:
  Direct{db: String, session: String}
  Registered{path: String, session: String}
  Current{session: String}
  Implicit{path: String, registered: Bool}
  Database{db: String}

type ParsedRequest is Type:
  Parsed{source: ContextSource, action: A.Action}

type PreparedRequest is Type:
  Prepared{db: String, session: String, action: A.Action}

# The recorded identity context of one completion request: the actor's current
# coordinator, the supplied ID when it is that actor's own request to one of its
# coordinators together with the recipient that request recorded, the current
# request after the latest assignment, its body, and any stored message with the
# supplied ID.
type CompletionState is Type:
  State{coordinator: String, supplied: String, suppliedTo: String, current: String, currentBody: String, recorded: String}

def ids_tail(+db: String, +session: String, ids: List<String>, +index: U32) -> IO(String):
  match ids:
    case Nil{}: IO.pure(String,"]")
    case id <> rest: do IO<String>:
      item : String <- Batch.read_one(db,U32.show(index),id)
      tail : String <- ids_tail(db,session,rest,U32.add(index,1))
      IO.pure(String,"," ++ item ++ tail)

def ids_json(+db: String, +session: String, ids: List<String>) -> IO(String):
  match ids:
    case Nil{}: IO.pure(String,"[]")
    case id <> rest: do IO<String>:
      item : String <- Batch.read_one(db,"0",id)
      tail : String <- ids_tail(db,session,rest,1)
      IO.pure(String,"[" ++ item ++ tail)

def generated_id(+session: String, result: Result<&1,&1,U32 & String,String>) -> Result<&1,&1,U32 & String,String>:
  match result:
    case Fail{error}: Fail{error}
    case Done{value}: Done{"message:" ++ session ++ ":" ++ Tx.trim_nl(value)}

def message_id(+db: String, +session: String, +id: String) -> IO(Result<&1,&1,U32 & String,String>):
  Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.is_empty(id),
    (do IO<Result<&1,&1,U32 & String,String>>:
      random : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,"SELECT lower(hex(randomblob(16)));")
      IO.pure(Result<&1,&1,U32 & String,String>,generated_id(session,random))),
    IO.pure(Result<&1,&1,U32 & String,String>,Done{id}))

def raw_body(read: Raw.RawRead) -> Result<&1,&1,U32 & String,String>:
  match read:
    case Raw.RawText{value}: Done{value}
    case Raw.RawInvalidUtf8{offset}: Fail{(2,"invalidUtf8 byte " ++ offset)}
    case Raw.RawNul{offset}: Fail{(2,"embeddedNul byte " ++ offset)}
    case Raw.RawBom{}: Fail{(2,"leadingBom")}

def raw_result(result: Result<&1,&1,U32 & String,Raw.RawRead>) -> Result<&1,&1,U32 & String,String>:
  match result:
    case Fail{error}: Fail{error}
    case Done{value}: raw_body(value)

def body_value(body: A.Body) -> IO(Result<&1,&1,U32 & String,String>):
  match body:
    case A.Text{value}: IO.pure(Result<&1,&1,U32 & String,String>,Done{value})
    case A.File{path}: do IO<Result<&1,&1,U32 & String,String>>:
      read : Result<&1,&1,U32 & String,Raw.RawRead> <- Raw.Raw.read_text_utf8(path)
      IO.pure(Result<&1,&1,U32 & String,String>,raw_result(read))
    case A.Missing{}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"send body is missing.")})
    case A.Bad{cause}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,cause)})

def captured_body_value(stdin: Native.Stdin, body: A.Body) -> IO(Result<&1,&1,U32 & String,String>):
  match stdin:
    case Native.Captured{value}: IO.pure(Result<&1,&1,U32 & String,String>,Done{value})
    case Native.CaptureFailed{code,cause}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(code,"stdin: " ++ cause)})
    case Native.Unused{}: body_value(body)

def captured_body(body: A.Body, stdin: Native.Stdin, wanted: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match wanted:
    case False{}: body_value(body)
    case True{}: captured_body_value(stdin,body)

def stdin_body(body: A.Body) -> Bool:
  match body:
    case A.File{path}: String.eq(path,"-")
    case other: False{}

def send_body(+db: String, +session: String, +index: String, +id: String,
              +recipient: String, +kind: String, result: Result<&1,&1,U32 & String,String>) -> IO(String):
  match result:
    case Fail{(code,cause)}: IO.pure(String,Batch.send_refused(index,id,session,recipient,kind,code,cause))
    case Done{body}: Batch.send_one(db,index,id,session,recipient,kind,body)

def send_id(+db: String, +session: String, +index: String, +recipient: String,
            +kind: String, +body: A.Body, stdin: Native.Stdin, result: Result<&1,&1,U32 & String,String>) -> IO(String):
  match result:
    case Fail{(code,cause)}: IO.pure(String,Batch.send_refused(index,"",session,recipient,kind,code,cause))
    case Done{id}: do IO<String>:
      value : Result<&1,&1,U32 & String,String> <- captured_body(body,stdin,stdin_body(body))
      send_body(db,session,index,id,recipient,kind,value)

def stdin_messages(items: List<&2,A.Message>) -> Bool:
  match items:
    case Nil{}: False{}
    case A.Item{recipient,id,kind,body} <> rest: Bool.or(stdin_body(body),stdin_messages(rest))

def send_item(+db: String, +session: String, index: U32, stdin: Native.Stdin, item: A.Message) -> IO(String):
  match item:
    case A.Item{recipient,id,kind,+body}: do IO<String>:
      actual : Result<&1,&1,U32 & String,String> <- message_id(db,session,id)
      send_id(db,session,U32.show(index),recipient,kind,body,stdin,actual)

def sends_tail(+db: String, +session: String, items: List<&2,A.Message>, +index: U32, +stdin: Native.Stdin) -> IO(String):
  match items:
    case Nil{}: IO.pure(String,"]")
    case item <> rest: do IO<String>:
      saved : String <- send_item(db,session,index,stdin,item)
      tail : String <- sends_tail(db,session,rest,U32.add(index,1),stdin)
      IO.pure(String,"," ++ saved ++ tail)

def sends_json(+db: String, +session: String, items: List<&2,A.Message>) -> IO(String):
  match items:
    case Nil{}: IO.pure(String,"[]")
    case +item <> +rest: do IO<String>:
      +stdin : Native.Stdin <- Native.capture_shared(db,stdin_messages(Con{item,rest}))
      saved : String <- send_item(db,session,0,stdin,item)
      tail : String <- sends_tail(db,session,rest,1,stdin)
      IO.pure(String,"[" ++ saved ++ tail)

def inspection_result(+saved: String) -> IO(Unit):
  Bool.pick(IO(Unit),String.is_empty(saved),
    IO.die(Unit,1,"No matching session or Player; inspect the requested ID."),
    IO.write(saved))

# A completion request named by --id must name the actor's current recorded
# request for its open assignment. An unrecorded, foreign or older identity is
# refused once and stores nothing. Without --id Baton generates the request
# identity; a newer request becomes the current one for the assignment. The
# request goes to the actor's current coordinator, or to the registered operator
# when the actor is a parentless conductor, and a replay goes to the
# recipient the request recorded, so a request addressed to a coordinator that
# has since been succeeded replays as recorded.
def completion_state_sql(+session: String, +id: String) -> String:
  +coordinator = C.report_recipient(C.q(session))
  +current = C.task_request_sql(C.q(session))
  "SELECT hex(CAST('x'||coalesce(" ++ coordinator ++ ",'') AS TEXT))"
  ++ "||char(9)||hex(CAST('x'||coalesce((SELECT id FROM messages WHERE id=" ++ C.q(id) ++ " AND sender=" ++ C.q(session) ++ " AND kind='completion-request' AND " ++ C.task_addressee_sql("messages",C.q(session)) ++ "),'') AS TEXT))"
  ++ "||char(9)||hex(CAST('x'||coalesce((SELECT recipient FROM messages WHERE id=" ++ C.q(id) ++ " AND sender=" ++ C.q(session) ++ " AND kind='completion-request' AND " ++ C.task_addressee_sql("messages",C.q(session)) ++ "),'') AS TEXT))"
  ++ "||char(9)||hex(CAST('x'||coalesce(" ++ current ++ ",'') AS TEXT))"
  ++ "||char(9)||hex(CAST('x'||coalesce((SELECT body FROM messages WHERE id=" ++ current ++ "),'') AS TEXT))"
  ++ "||char(9)||hex(CAST('x'||coalesce((SELECT id FROM messages WHERE id=" ++ C.q(id) ++ "),'') AS TEXT));"

def completion_field_value(+value: String) -> IO(String):
  Bool.pick(IO(String),String.starts_with(value,"x"),
    IO.pure(String,String.drop(value,1n)),
    IO.die(String,2,"The completion-request identity field has no empty-value marker."))

def completion_field(encoded: String) -> IO(String):
  do IO<String>:
    value : String <- AgentInput.field(encoded)
    completion_field_value(value)

def completion_state_fields(fields: List<String>) -> IO(CompletionState):
  match fields:
    case coordinator_hex <> supplied_hex <> to_hex <> current_hex <> body_hex <> recorded_hex <> Nil{}: do IO<CompletionState>:
      +coordinator : String <- completion_field(coordinator_hex)
      +supplied : String <- completion_field(supplied_hex)
      +suppliedTo : String <- completion_field(to_hex)
      +current : String <- completion_field(current_hex)
      +currentBody : String <- completion_field(body_hex)
      +recorded : String <- completion_field(recorded_hex)
      IO.pure(CompletionState,State{coordinator,supplied,suppliedTo,current,currentBody,recorded})
    case other: IO.die(CompletionState,2,"The completion-request identity query returned an incomplete result.")

def completion_state(db: String, session: String, id: String) -> IO(CompletionState):
  do IO<CompletionState>:
    row : String <- IO.try(String,DB.Sql.read(db,completion_state_sql(session,id)))
    completion_state_fields(Tx.split_tabs(Tx.trim_nl(row)))

def completion_refused(+session: String, +recipient: String, +id: String, +cause: String) -> IO(String):
  IO.pure(String,"[" ++ Batch.send_refused("0",id,session,recipient,"completion-request",2,cause) ++ "]")

def completion_request_refused(+db: String, +session: String, +id: String) -> IO(String):
  do IO<String>:
    raw : String <- IO.try(String,DB.Sql.read(db,
      "SELECT coalesce((SELECT parent IS NOT NULL FROM sessions WHERE id=" ++ C.q(session) ++ "),0);"))
    Bool.pick(IO(String),String.eq(Tx.trim_nl(raw),"1"),
      completion_refused(session,"",id,"The current session has no coordinator that is not over and no registered operator to receive the request."),
      completion_refused(session,"",id,"The current session has no recorded immediate parent."))

def completion_sent(db: String, session: String, parent: String, id: String, body: A.Body) -> IO(String):
  do IO<String>:
    item : String <- send_item(db,session,0,Native.Unused{},A.Item{parent,id,"completion-request",body})
    IO.pure(String,"[" ++ item ++ "]")

def completion_replay_result(+db: String, +session: String, +recipient: String, +request: String,
                             +currentBody: String, +id: String,
                             result: Result<&1,&1,U32 & String,String>) -> IO(String):
  match result:
    case Fail{(+code,+cause)}:
      IO.pure(String,"[" ++ Batch.send_refused("0",id,session,recipient,"completion-request",code,cause) ++ "]")
    case Done{+value}:
      Bool.pick(IO(String),String.eq(value,currentBody),
        completion_sent(db,session,recipient,request,A.Text{value}),
        completion_refused(session,recipient,id,
          "Completion request " ++ request ++ " is already recorded with different content. Omit --id to record the new summary as the current request."))

def completion_replayed(+db: String, +session: String, +recipient: String, +request: String,
                        +currentBody: String, body: A.Body, +id: String) -> IO(String):
  do IO<String>:
    resolved : Result<&1,&1,U32 & String,String> <- body_value(body)
    completion_replay_result(db,session,recipient,request,currentBody,id,resolved)

def completion_supplied(+db: String, +session: String, +coordinator: String, +supplied: String,
                        +suppliedTo: String, +current: String, currentBody: String, recorded: String,
                        +id: String, body: A.Body) -> IO(String):
  Bool.pick(IO(String),String.is_empty(supplied),
    completion_refused(session,coordinator,id,
      Bool.pick(String,String.is_empty(recorded),
        "Completion request " ++ id ++ " is not recorded. Omit --id; Baton derives the request identity from the recorded assignment.",
        "The supplied ID " ++ id ++ " is not this actor's completion request to one of its coordinators. Omit --id to request completion for the current assignment.")),
    Bool.pick(IO(String),String.eq(supplied,current),
      completion_replayed(db,session,suppliedTo,current,currentBody,body,id),
      completion_refused(session,coordinator,id,
        "Completion request " ++ id ++ " does not belong to the current assignment. Omit --id to request completion for the current assignment.")))

def completion_request_decided(+db: String, +session: String, +id: String, +body: A.Body, state: CompletionState) -> IO(String):
  match state:
    case State{+coordinator,supplied,suppliedTo,current,currentBody,recorded}:
      Bool.pick(IO(String),String.is_empty(coordinator),
        completion_request_refused(db,session,id),
        Bool.pick(IO(String),String.is_empty(id),
          completion_sent(db,session,coordinator,"",body),
          completion_supplied(db,session,coordinator,supplied,suppliedTo,current,currentBody,recorded,id,body)))

# A parentless Player, and a parentless conductor with no registered operator,
# are refused.
def completion_request(+db: String, +session: String, +id: String, body: A.Body) -> IO(String):
  do IO<String>:
    state : CompletionState <- completion_state(db,session,id)
    completion_request_decided(db,session,id,body,state)

def confirmation_refused(+session: String, +recipient: String, +id: String,
                          +cause: String) -> IO(String):
  IO.pure(String,"[" ++ Batch.send_refused("0",id,session,recipient,
    "completion-confirmed",2,cause) ++ "]")

# Ended is derived from the stored confirmation (C.task_ended_sql), so a
# confirmation without a next assignment is the whole decision. A next
# assignment is read and validated first, then confirmed and recorded in one
# transaction; delivery wakes follow the committed outcome.
def next_refused(+session: String, +target: String, +code: U32, +cause: String) -> IO(String):
  IO.pure(String,"[" ++ Batch.send_refused("1","",session,target,"task",code,cause) ++ "]")

def next_error_cause(+confirmed: String, +assigned: String) -> String:
  Bool.pick(String,Tx.starts_with(confirmed,"{\"error\""),confirmed,assigned)

def next_rows(rows: List<String>, +db: String, +session: String, +target: String, +request: String,
              +id: String, +task_id: String, +task: String) -> IO(String):
  match rows:
    case +confirmed <> +assigned <> Nil{}:
      Bool.pick(IO(String),Bool.or(Tx.starts_with(confirmed,"{\"error\""),Tx.starts_with(assigned,"{\"error\"")),
        next_refused(session,target,2,next_error_cause(confirmed,assigned)),
        (do IO<String>:
          confirmation : String <- Batch.admitted(db,"0",id,session,target,"completion-confirmed",confirmed,
            C.Message{id,session,target,"completion-confirmed",request})
          assignment : String <- Batch.admitted(db,"1",task_id,session,target,"task",assigned,
            C.Message{task_id,session,target,"task",task})
          IO.pure(String,"[" ++ confirmation ++ "," ++ assignment ++ "]")))
    case other: next_refused(session,target,2,"The confirmation and next assignment were not both recorded; read the Player and its messages.")

def next_stored(stored: Result<&1,&1,U32 & String,String>, +db: String, +session: String, +target: String,
                +request: String, +id: String, +task_id: String, +task: String) -> IO(String):
  match stored:
    case Fail{(code,cause)}: IO.pure(String,"[" ++ Batch.send_refused("0",id,session,target,"completion-confirmed",code,cause) ++ "]")
    case Done{saved}: next_rows(Tx.split_lines(saved),db,session,target,request,id,task_id,task)

def next_committed(+db: String, +session: String, +target: String, +request: String,
                   +id: String, +task: String) -> IO(String):
  do IO<String>:
    +task_id : String = id ++ ":next-assignment"
    stored : Result<&1,&1,U32 & String,String> <- Store.apply(db,C.ConfirmNext{id,session,target,request,task_id,task})
    next_stored(stored,db,session,target,request,id,task_id,task)

def next_identified(identified: Result<&1,&1,U32 & String,String>, +db: String, +session: String,
                    +target: String, +request: String, +task: String) -> IO(String):
  match identified:
    case Fail{(code,cause)}: next_refused(session,target,code,cause)
    case Done{id}: next_committed(db,session,target,request,id,task)

def next_loaded(loaded: Result<&1,&1,U32 & String,String>, +db: String, +session: String,
                +target: String, +request: String, +id: String) -> IO(String):
  match loaded:
    case Fail{(code,cause)}: next_refused(session,target,code,cause)
    case Done{+task}:
      Bool.pick(IO(String),String.is_empty(task),
        next_refused(session,target,2,"The next assignment is empty."),
        (do IO<String>:
          identified : Result<&1,&1,U32 & String,String> <- message_id(db,session,id)
          next_identified(identified,db,session,target,request,task)))

def confirmation_next(+db: String, +session: String, +target: String, +request: String,
                      +id: String, next: A.Body) -> IO(String):
  do IO<String>:
    loaded : Result<&1,&1,U32 & String,String> <- body_value(next)
    next_loaded(loaded,db,session,target,request,id)

def confirmation_sent(+db: String, +session: String, +target: String, +request: String,
                      +id: String, next: A.Body) -> IO(String):
  match next:
    case A.Missing{}: do IO<String>:
      item : String <- send_item(db,session,0,Native.Unused{},
        A.Item{target,id,"completion-confirmed",A.Text{request}})
      IO.pure(String,"[" ++ item ++ "]")
    case other: confirmation_next(db,session,target,request,id,other)

def confirmation_target(+db: String, +session: String, +recipient: String,
                        +request: String, +id: String, next: A.Body,
                        +target_hex: String) -> IO(String):
  match target_hex:
    case "": confirmation_refused(session,recipient,id,
      "No retained completion-request has the supplied ID.")
    case "wrong-kind": confirmation_refused(session,recipient,id,
      "The supplied message is not a completion-request.")
    case "wrong-coordinator": confirmation_refused(session,recipient,id,
      "The completion-request is addressed to another coordinator.")
    case "stale-request": confirmation_refused(session,recipient,id,
      "The completion-request belongs to an older assignment; request completion for the current assignment again.")
    case encoded: do IO<String>:
      +target : String = Req.scalar_value(Req.decode_scalar_utf8(Tx.hex_decode(encoded)))
      matches : Bool = Bool.or(String.is_empty(recipient),String.eq(recipient,target))
      Bool.pick(IO(String),Bool.not(matches),
        confirmation_refused(session,recipient,id,
          "--to does not match the author of the completion-request."),
        confirmation_sent(db,session,target,request,id,next))

# The selector query for one exact request: its kind, whether the confirming
# session and the request recipient both hold authority over the author, whether
# it is the author's current request (or the exact decision is already stored),
# and the author when all hold.
def confirmation_selector_sql(+session: String, +request: String, +id: String) -> String:
  "SELECT CASE WHEN req.kind<>'completion-request' THEN 'wrong-kind' WHEN NOT coalesce(" ++ C.coordinator_authority_sql("req.sender",C.q(session)) ++ " AND " ++ C.coordinator_authority_sql("req.sender","req.recipient") ++ ",0) THEN 'wrong-coordinator' WHEN req.id<>coalesce(" ++
  C.task_request_sql("req.sender") ++
  ",'') AND NOT EXISTS(SELECT 1 FROM messages replay WHERE replay.id=" ++ C.q(id) ++ " AND replay.kind='completion-confirmed' AND replay.sender=" ++ C.q(session) ++ " AND replay.recipient=req.sender AND replay.body=" ++ C.q(request) ++ ") THEN 'stale-request' ELSE hex(CAST(req.sender AS TEXT)) END FROM messages req WHERE req.id=" ++
  C.q(request) ++ ";"

# An explicit selector must name the current request for the worker assignment.
# Older requests remain historical and are refused.
def completion_confirmed_exact(+db: String, +session: String, +recipient: String,
                         +request: String, +id: String, next: A.Body) -> IO(String):
  do IO<String>:
    row : String <- IO.try(String,DB.Sql.read(db,confirmation_selector_sql(session,request,id)))
    confirmation_target(db,session,recipient,request,id,next,Tx.trim_nl(row))

def confirmation_requests_sql(+session: String, +recipient: String) -> String:
  "SELECT hex(" ++ C.task_request_sql("worker.id") ++ ") FROM sessions worker WHERE " ++ C.coordinator_authority_sql("worker.id",C.q(session))
  ++ " AND (" ++ C.q(recipient) ++ "='' OR worker.id=" ++ C.q(recipient) ++ ") AND " ++ C.task_request_sql("worker.id") ++ " IS NOT NULL"
  ++ " AND NOT " ++ C.task_confirmed_sql("worker.id") ++ " ORDER BY worker.id;"

def confirmation_inferred(rows: List<String>, +db: String, +session: String, +recipient: String, +id: String, next: A.Body) -> IO(String):
  match rows:
    case encoded <> Nil{}: do IO<String>:
      request : String <- AgentInput.field(encoded)
      completion_confirmed_exact(db,session,recipient,request,id,next)
    case Nil{}: confirmation_refused(session,recipient,id,"No current completion request is addressed to this coordinator for the selected Player.")
    case other: confirmation_refused(session,recipient,id,"Multiple Players have current completion requests. Select the Player with --to.")

def completion_confirmed(+db: String, +session: String, +recipient: String, +request: String, +id: String, +next: A.Body) -> IO(String):
  Bool.pick(IO(String),String.is_empty(request),
    (do IO<String>:
      rows : String <- IO.try(String,DB.Sql.read(db,confirmation_requests_sql(session,recipient)))
      confirmation_inferred(Tx.split_lines(rows),db,session,recipient,id,next)),
    completion_confirmed_exact(db,session,recipient,request,id,next))

def execute(+db: String, +session: String, action: A.Action) -> IO(Unit):
  match action:
    case A.Help{+action}: IO.write(Bool.pick(String,String.eq(action,"repl"),Repl.help(),Bool.pick(String,String.eq(action,"branch"),Branching.help(),A.help(action))))
    case A.Invalid{cause}: IO.die(Unit,2,cause ++ "\n" ++ A.help(""))
    case A.Inbox{}: do IO<Unit>:
      saved : String <- IO.try(String,Store.read(db,C.Inbox{session}))
      AgentInput.output(db,session,saved,True{})
    case A.Read{ids}: do IO<Unit>:
      saved : String <- ids_json(db,session,ids)
      AgentInput.output(db,session,saved,True{})
    case A.CompletionRequest{id,body}: do IO<Unit>:
      saved : String <- completion_request(db,session,id,body)
      IO.write(saved)
    case A.CompletionConfirmed{+recipient,+request,+id,next}: do IO<Unit>:
      saved : String <- completion_confirmed(db,session,recipient,request,id,next)
      IO.write(saved)
    case A.Session{+id}: do IO<Unit>:
      target : String = Bool.pick(String,String.is_empty(id),session,id)
      saved : String <- IO.try(String,Store.read(db,C.Session{target}))
      inspection_result(saved)
    case A.Player{id}: do IO<Unit>:
      saved : String <- IO.try(String,Store.read(db,C.PlayerRead{id}))
      inspection_result(saved)
    case A.Players{}: do IO<Unit>:
      saved : String <- IO.try(String,Store.read(db,C.Players{}))
      IO.write(saved)
    case A.Assignment{+id}: do IO<Unit>:
      target : String = Bool.pick(String,String.is_empty(id),session,id)
      saved : String <- IO.try(String,Store.read(db,C.Session{target}))
      inspection_result(saved)
    case A.Send{items}: do IO<Unit>:
      saved : String <- sends_json(db,session,items)
      IO.write(saved)
    case A.Branch{args}: Branching.execute(db,session,args)
    case A.Repl{args}: Repl.execute(db,session,args)
    case A.Native{items}: do IO<Unit>:
      saved : String <- Native.operations(db,session,items)
      IO.write(saved)

def help() -> String:
  A.help("")

def environment_result(result: Result<&1,&1,U32 & String,String>) -> IO(String):
  match result:
    case Done{value}: IO.pure(String,value)
    case Fail{(+code,detail)}:
      Bool.pick(IO(String),U32.is_eq(code,2),IO.pure(String,""),IO.die(String,code,detail))

def environment(name: String) -> IO(String):
  do IO<String>:
    result : Result<&1,&1,U32 & String,String> <- IO.get_env(name)
    environment_result(result)

def native_rows(rows: List<String>) -> IO(String):
  match rows:
    case id <> Nil{}: Project.field(id)
    case Nil{}: IO.die(String,2,"The current native conversation has no Baton session in this project. Launch the agent through Baton or use as SESSION.\n")
    case other: IO.die(String,2,"The current native conversation matches multiple Baton sessions in this project. Use as SESSION to select one.\n")

def native_session(+db: String, +native: String) -> IO(String):
  Bool.pick(IO(String),String.is_empty(native),
    IO.die(String,2,"No Baton agent context is available. Launch the agent through Baton or use as SESSION.\n"),
    (do IO<String>:
      rows : String <- IO.try(String,DB.Sql.read(db,"SELECT hex(id) FROM sessions WHERE harness='codex' AND native=" ++ C.q(native) ++ ";"))
      native_rows(Tx.split_lines(rows))))

def implicit_session(+db: String) -> IO(String):
  do IO<String>:
    +session : String <- environment("BATON_SESSION")
    Bool.pick(IO(String),String.is_empty(session),
      (do IO<String>:
        native : String <- environment("CODEX_THREAD_ID")
        native_session(db,native)),IO.pure(String,session))

def current_session(+db: String) -> IO(Unit):
  do IO<Unit>:
    session : String <- implicit_session(db)
    +saved : String <- IO.try(String,DB.Sql.read(db,"SELECT json_object('id',id) FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    Bool.pick(IO(Unit),String.is_empty(saved),IO.die(Unit,2,"No recorded session matches the current agent context."),IO.write(saved))

# The host worker bridge uses the existing admitted native birth on each call.
def worker_context_fields(fields: List<String>, +db: String, +session: String, +directory: String) -> IO(Unit):
  match fields:
    case attempt_hex <> native_hex <> Nil{}: do IO<Unit>:
      +attempt : String <- AgentInput.field(attempt_hex)
      +native : String <- AgentInput.field(native_hex)
      witness : String <- IO.try(String,Custody.Instance.input_witness(db,directory))
      +saved : String <- IO.try(String,DB.Sql.read(db,
        "SELECT json_object('session',s.id,'attempt',e.id,'directory',e.directory,'native',s.native,'harness',s.harness,'workspace',s.workspace,'branch',s.branch,'model',s.model) FROM sessions s JOIN executions e ON e.session=s.id WHERE s.id=" ++ C.q(session)
        ++ " AND s.harness='dsh' AND s.native=" ++ C.q(native) ++ " AND e.id=" ++ C.q(attempt)
        ++ " AND e.directory=" ++ C.q(directory) ++ " AND e.phase='running' AND json_extract(" ++ C.q(witness) ++ ",'$.live')=1"
        ++ " AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ ";"))
      Bool.pick(IO(Unit),String.is_empty(saved),IO.die(Unit,2,"Worker operations require the current DSH execution, live native birth and effective stop state."),IO.write(saved))
    case other: IO.die(Unit,2,"Worker operations require the current admitted native execution.")

def worker_context(+db: String) -> IO(Unit):
  do IO<Unit>:
    +session : String <- implicit_session(db)
    +directory : String <- AgentInput.context(db,session)
    Bool.pick(IO(Unit),String.is_empty(directory),
      IO.die(Unit,2,"Worker operations require the recorded database, actor and native attempt directory."),
      (do IO<Unit>:
        fields : String <- IO.try(String,DB.Sql.read(db,MessageStatus.current_sql(session,directory)))
        worker_context_fields(Tx.split_tabs(Tx.trim_nl(fields)),db,session,directory)))

def implicit_database(+path: String, registered: Bool) -> IO(String):
  match registered:
    case True{}: Project.database(path)
    case False{}: do IO<String>:
      +db : String <- environment("BATON_DATABASE")
      Bool.pick(IO(String),String.is_empty(db),Project.database(path),IO.pure(String,db))

def parsed_session_result(source: ContextSource, args: List<String>, cause: String, empty: Bool) -> ParsedRequest:
  match empty:
    case True{}: Parsed{Direct{"",""},A.Invalid{cause}}
    case False{}: Parsed{source,A.parse(args)}

def parsed_session(source: ContextSource, session: String, args: List<String>, cause: String) -> ParsedRequest:
  parsed_session_result(source,args,cause,String.is_empty(session))

def parsed_request(request: Route.Context) -> ParsedRequest:
  match request:
    case Route.Explicit{db,+session,args}: parsed_session(Direct{db,session},session,args,"as requires SESSION; use baton as SESSION help.")
    case Route.Project{path,+session,args}: parsed_session(Registered{path,session},session,args,"as requires SESSION; use baton as SESSION help.")
    case Route.Current{+session,args}: parsed_session(Current{session},session,args,"as requires SESSION; use baton help.")
    case Route.Implicit{path,registered,action}: Parsed{Implicit{path,registered},action}
    case Route.InDatabase{db,action}: Parsed{Database{db},action}

def resolve_source(source: ContextSource) -> IO(String & String):
  match source:
    case Direct{db,session}: IO.pure(String & String,(db,session))
    case Registered{path,session}: do IO<String & String>:
      db : String <- Project.database(path)
      IO.pure(String & String,(db,session))
    case Current{session}: do IO<String & String>:
      db : String <- implicit_database(".",False{})
      IO.pure(String & String,(db,session))
    case Implicit{path,registered}: do IO<String & String>:
      +db : String <- implicit_database(path,registered)
      session : String <- implicit_session(db)
      IO.pure(String & String,(db,session))
    case Database{+db}: do IO<String & String>:
      session : String <- implicit_session(db)
      IO.pure(String & String,(db,session))

def prepared_context(context: String & String, action: A.Action) -> PreparedRequest:
  (db,session)=context
  Prepared{db,session,action}

def prepare_valid(source: ContextSource, action: A.Action) -> IO(PreparedRequest):
  do IO<PreparedRequest>:
    context : String & String <- resolve_source(source)
    IO.pure(PreparedRequest,prepared_context(context,action))

def prepare_parsed(parsed: ParsedRequest) -> IO(PreparedRequest):
  match parsed:
    case Parsed{source,action}:
      match action:
        case A.Help{action}: IO.pure(PreparedRequest,Prepared{"","",A.Help{action}})
        case A.Invalid{cause}: IO.pure(PreparedRequest,Prepared{"","",A.Invalid{cause}})
        case valid: prepare_valid(source,valid)

def prepare_request(request: Route.Context) -> IO(PreparedRequest):
  prepare_parsed(parsed_request(request))

def route_prepared(prepared: PreparedRequest) -> IO(Unit):
  match prepared:
    case Prepared{db,session,action}: execute(db,session,action)

def route(request: Route.Context) -> IO(Unit):
  do IO<Unit>:
    prepared : PreparedRequest <- prepare_request(request)
    route_prepared(prepared)
