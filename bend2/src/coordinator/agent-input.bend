import Base
import ./codex-inbox-result.bend as Outcome
import ../coordinator/commands.bend as C
import ../coordinator/message-status.bend as Status
import ./store.bend as Store
import ./codex-route.bend as CodexRoute
import ../context/request.bend as Req
import ../host/sqlite.bend as DB
import ../host/instance.bend as Custody
import ../host/session-lock.bend as Lock
import ../host/text.bend as Text
import ../host/control.bend as Host
import ../git/process.bend as Process
import ../git/types.bend as G
import ../git/text.bend as Tx
import ../json/canonical.bend as J

type HandlingScope is Data:
  Handling{attempt: String, native: String, identity: String, current: String}
  NoHandling{}

def handling_invalid(condition: String) -> IO(HandlingScope):
  IO.die(HandlingScope,2,"{\"error\":\"handling-context\",\"condition\":" ++ J.string_literal(condition) ++ "}")

# Administrative commands leave observations unchanged. The native launch binds
# its database, actor and exact admitted directory in the inherited environment.
def field_decoded(decoded: Req.Scalar) -> IO(String):
  match decoded:
    case Req.ScalarText{value}: IO.pure(String,value)
    case other: IO.die(String,22,"Input status field could not be decoded: " ++ Req.scalar_reason(other))

def field(encoded: String) -> IO(String):
  field_decoded(Req.decode_scalar_utf8(Tx.hex_decode(Tx.trim_nl(encoded))))

def environment_result(result: Result<&1,&1,U32 & String,String>) -> IO(String):
  match result:
    case Done{value}: IO.pure(String,value)
    case Fail{(+code,cause)}:
      Bool.pick(IO(String),U32.is_eq(code,2),IO.pure(String,""),IO.die(String,code,cause))

def environment(name: String) -> IO(String):
  do IO<String>:
    value : Result<&1,&1,U32 & String,String> <- IO.get_env(name)
    environment_result(value)

def context_if(+db: String, selected_db: String, directory: String, same: Bool) -> IO(String):
  match same:
    case False{}: IO.pure(String,"")
    case True{}: do IO<String>:
      absolute_db : String <- IO.try(String,Lock.SessionLock.canonical(db))
      absolute_selected : String <- IO.try(String,Lock.SessionLock.canonical(selected_db))
      IO.pure(String,Bool.pick(String,String.eq(absolute_db,absolute_selected),directory,""))

def context(+db: String, +session: String) -> IO(String):
  do IO<String>:
    +directory : String <- environment("BATON_ATTEMPT_DIRECTORY")
    selected : String <- environment("BATON_SESSION")
    +selected_db : String <- environment("BATON_DATABASE")
    context_if(db,selected_db,directory,Bool.and(Bool.not(String.is_empty(directory)),Bool.and(String.eq(selected,session),Bool.not(String.is_empty(selected_db)))))

def mcp_witness_fields(fields: List<String>, +session: String) -> IO(HandlingScope):
  match fields:
    case attempt_hex <> native_hex <> identity_hex <> endpoint_hex <> Nil{}: do IO<HandlingScope>:
      attempt : String <- field(attempt_hex)
      +native : String <- field(native_hex)
      identity : String <- field(identity_hex)
      endpoint : String <- field(endpoint_hex)
      IO.pure(HandlingScope,Handling{attempt,native,identity,
        "EXISTS(SELECT 1 FROM sessions connected WHERE connected.id=" ++ C.q(session)
        ++ " AND connected.harness='claude-code' AND connected.native=" ++ C.q(native)
        ++ " AND connected.endpoint=" ++ C.q(endpoint) ++ ")"})
    case other: handling_invalid("Handling requires the matching live connected Claude input witness.")

def mcp_witness(+db: String, +session: String, +witness: String) -> IO(HandlingScope):
  do IO<HandlingScope>:
    fields : String <- IO.try(String,DB.Sql.read(db,
      "SELECT CASE WHEN json_valid(" ++ C.q(witness) ++ ") THEN CASE WHEN json_extract(" ++ C.q(witness)
      ++ ",'$.active')=1 AND json_extract(" ++ C.q(witness) ++ ",'$.session')=" ++ C.q(session)
      ++ " AND json_type(" ++ C.q(witness) ++ ",'$.attempt')='text' AND json_type(" ++ C.q(witness)
      ++ ",'$.native')='text' AND json_type(" ++ C.q(witness) ++ ",'$.identity')='text' AND json_type(" ++ C.q(witness)
      ++ ",'$.endpoint')='text' THEN hex(json_extract(" ++ C.q(witness) ++ ",'$.attempt'))||char(9)||hex(json_extract(" ++ C.q(witness)
      ++ ",'$.native'))||char(9)||hex(json_extract(" ++ C.q(witness) ++ ",'$.identity'))||char(9)||hex(json_extract(" ++ C.q(witness)
      ++ ",'$.endpoint')) ELSE '' END ELSE '' END;"))
    mcp_witness_fields(Tx.split_tabs(Tx.trim_nl(fields)),session)

def mcp_witness_result(db: String, session: String, result: G.RunRes) -> IO(HandlingScope):
  match result:
    case G.RRun{G.SExit{+code},+witness}:
      Bool.pick(IO(HandlingScope),U32.is_eq(code,0),mcp_witness(db,session,witness),
        IO.die(HandlingScope,code,"Connected Claude handling witness failed: " ++ witness))
    case G.RRun{G.SSignal{signal},output}: IO.die(HandlingScope,2,"Connected Claude handling witness was interrupted: " ++ output)
    case G.RSpawn{cause}: IO.die(HandlingScope,2,"Connected Claude handling witness could not start: " ++ cause)

def mcp_endpoint_fields(fields: List<String>, +db: String, +session: String, context: String) -> IO(HandlingScope):
  match fields:
    case node_hex <> helper_hex <> Nil{}: do IO<HandlingScope>:
      node : String <- field(node_hex)
      helper : String <- field(helper_hex)
      executable : String <- IO.try(String,Lock.SessionLock.executable())
      witness : G.RunRes <- Process.runFull([node,helper,db,executable,"--session",session,"--input-witness",context],".")
      mcp_witness_result(db,session,witness)
    case other: handling_invalid("Handling requires the current connected Claude endpoint, native conversation and stop state.")

def mcp_handling_owned(owned: Bool, +db: String, +session: String, +context: String) -> IO(HandlingScope):
  match owned:
    case False{}: IO.pure(HandlingScope,NoHandling{})
    case True{}: do IO<HandlingScope>:
      fields : String <- IO.try(String,DB.Sql.read(db,
        "SELECT hex(json_extract(s.endpoint,'$[0]'))||char(9)||hex(json_extract(s.endpoint,'$[1]')) FROM sessions s WHERE s.id=" ++ C.q(session)
        ++ " AND s.harness='claude-code' AND s.native<>'' AND CASE WHEN json_valid(" ++ C.q(context)
        ++ ") THEN json_extract(" ++ C.q(context) ++ ",'$.session')=s.id AND json_extract(" ++ C.q(context)
        ++ ",'$.native')=s.native AND json_extract(" ++ C.q(context) ++ ",'$.endpoint')=s.endpoint ELSE 0 END"
        ++ " AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=s.id);"))
      mcp_endpoint_fields(Tx.split_tabs(Tx.trim_nl(fields)),db,session,context)

def mcp_handling(+db: String, +session: String, context: String) -> IO(HandlingScope):
  do IO<HandlingScope>:
    selected : String <- environment("BATON_SESSION")
    mcp_handling_owned(String.eq(selected,session),db,session,context)

def present(+db: String) -> IO(Bool):
  do IO<Bool>:
    value : String <- IO.try(String,DB.Sql.read(db,Status.present_sql()))
    IO.pure(Bool,String.eq(value,"1\n"))

def decorate_if(+db: String, +saved: String, +read: Bool, known: Bool) -> IO(String):
  do IO<String>:
    value : String <- IO.try(String,DB.Sql.read(db,Status.decorate_observed_sql(saved,read,known)))
    IO.pure(String,Tx.trim_nl(value))

def decorate(+db: String, saved: String, read: Bool) -> IO(String):
  do IO<String>:
    known : Bool <- present(db)
    decorate_if(db,saved,read,known)

def record_fields(+db: String, +session: String, +directory: String, +saved: String, read: Bool, fields: List<String>) -> IO(Unit):
  match fields:
    case attempt_hex <> native_hex <> Nil{}: do IO<Unit>:
      +attempt : String <- field(attempt_hex)
      +native : String <- field(native_hex)
      +witness : String <- IO.try(String,Custody.Instance.input_witness(db,directory))
      live : String <- IO.try(String,DB.Sql.read(db,"SELECT json_extract(" ++ C.q(witness) ++ ",'$.live');"))
      identity : String <- IO.try(String,DB.Sql.read(db,"SELECT hex(json_extract(" ++ C.q(witness) ++ ",'$.identity'));"))
      Bool.pick(IO(Unit),String.eq(live,"1\n"),
        (do IO<Unit>:
          bound : String <- field(Tx.trim_nl(identity))
          stored : String <- IO.try(String,Store.transact_sql(db,Status.record_sql(session,directory,attempt,native,bound,saved,read)))
          IO.pure(Unit,Unit{})),
        IO.die(Unit,2,"The owned input action has no matching live native process birth. Read status remains unrecorded."))
    case other: IO.die(Unit,2,"The owned input action has no matching active execution, native conversation and stop state. Read status remains unrecorded.")

def record(+db: String, +session: String, +directory: String, saved: String, read: Bool) -> IO(Unit):
  do IO<Unit>:
    ensured : Unit <- Store.ensure_before_begin(db)
    fields : String <- IO.try(String,DB.Sql.read(db,Status.current_sql(session,directory)))
    record_fields(db,session,directory,saved,read,Tx.split_tabs(Tx.trim_nl(fields)))

# The read event for one forwarded guidance frame: the running execution's own
# witness binds the native identity. A missing or stale witness skips the
# record; the frame stays owed and forwards again on a later turn.
def forward_read_witness(+db: String, +session: String, +attempt: String, +native: String, +next: String, result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{error}: IO.pure(Unit,Unit{})
    case Done{+witness}: do IO<Unit>:
      live : String <- IO.try(String,DB.Sql.read(db,"SELECT json_extract(" ++ C.q(witness) ++ ",'$.live');"))
      encoded : String <- IO.try(String,DB.Sql.read(db,"SELECT hex(json_extract(" ++ C.q(witness) ++ ",'$.identity'));"))
      identity : String <- field(Tx.trim_nl(encoded))
      Bool.pick(IO(Unit),String.eq(live,"1\n"),
        (do IO<Unit>:
          stored : String <- IO.try(String,Store.transact_sql(db,Status.forwarded_read_sql(session,attempt,native,identity,next)))
          IO.pure(Unit,Unit{})),
        IO.pure(Unit,Unit{}))

def forward_read_fields(+db: String, +session: String, +next: String, fields: List<String>) -> IO(Unit):
  match fields:
    case attempt_hex <> directory_hex <> native_hex <> Nil{}: do IO<Unit>:
      +attempt : String <- field(attempt_hex)
      +directory : String <- field(directory_hex)
      +native : String <- field(native_hex)
      witness : Result<&1,&1,U32 & String,String> <- Custody.Instance.input_witness(db,directory)
      forward_read_witness(db,session,attempt,native,next,witness)
    case other: IO.pure(Unit,Unit{})

def forward_read(+db: String, +session: String, +next: String) -> IO(Unit):
  do IO<Unit>:
    ensured : Unit <- Store.ensure_before_begin(db)
    fields : String <- IO.try(String,DB.Sql.read(db,Status.forward_scope_sql(session)))
    forward_read_fields(db,session,next,Tx.split_tabs(Tx.trim_nl(fields)))

def codex_witness(+db: String, +session: String, +native: String, +saved: String, +read: Bool, +witness: String) -> IO(Unit):
  do IO<Unit>:
    +bound : String <- IO.try(String,DB.Sql.read(db,"SELECT CASE WHEN json_valid(" ++ C.q(witness) ++ ") THEN CASE WHEN json_extract(" ++ C.q(witness) ++ ",'$.threadId')=" ++ C.q(native) ++ " AND json_extract(" ++ C.q(witness) ++ ",'$.active')=1 AND json_type(" ++ C.q(witness) ++ ",'$.turnId')='text' AND json_extract(" ++ C.q(witness) ++ ",'$.turnId')<>'' THEN hex(json_extract(" ++ C.q(witness) ++ ",'$.turnId')) ELSE '' END ELSE '' END;"))
    Bool.pick(IO(Unit),String.is_empty(Tx.trim_nl(bound)),
      IO.die(Unit,2,"The complete input output has no matching active native turn witness. Read status remains unrecorded."),
      (do IO<Unit>:
        turn : String <- field(bound)
        ensured : Unit <- Store.ensure_before_begin(db)
        stored : String <- IO.try(String,Store.transact_sql(db,Status.codex_record_sql(session,native,turn,saved,read)))
        IO.pure(Unit,Unit{})))

def codex_witness_result(db: String, session: String, native: String, saved: String, read: Bool, result: G.RunRes) -> IO(Unit):
  match result:
    case G.RRun{G.SExit{+code},+witness}:
      Bool.pick(IO(Unit),U32.is_eq(code,0),codex_witness(db,session,native,saved,read,witness),IO.die(Unit,code,"Native input witness failed: " ++ witness))
    case G.RRun{G.SSignal{signal},output}: IO.die(Unit,2,"Native input witness was interrupted: " ++ output)
    case G.RSpawn{cause}: IO.die(Unit,2,"Native input witness could not start: " ++ cause)

def codex_record_if(+db: String, +session: String, +native: String, saved: String, read: Bool, owned: Bool) -> IO(Unit):
  match owned:
    case False{}: IO.pure(Unit,Unit{})
    case True{}: do IO<Unit>:
      executable : String <- IO.try(String,Lock.SessionLock.executable())
      args : List<String> <- CodexRoute.command(db,session,[executable,db,"codex-input-witness",native])
      witness : G.RunRes <- Process.runFull(args,".")
      codex_witness_result(db,session,native,saved,read,witness)

def codex_record(+db: String, +session: String, +saved: String, read: Bool) -> IO(Unit):
  do IO<Unit>:
    +native : String <- environment("CODEX_THREAD_ID")
    known : String <- Bool.pick(IO(String),String.is_empty(native),IO.pure(String,"0\n"),IO.try(String,DB.Sql.read(db,Status.codex_context_sql(session,native))))
    codex_record_if(db,session,native,saved,read,String.eq(known,"1\n"))

def mcp_record_scope(scope: HandlingScope, +db: String, +session: String, saved: String, +read: Bool) -> IO(Unit):
  match scope:
    case NoHandling{}: IO.pure(Unit,Unit{})
    case Handling{attempt,native,identity,current}: do IO<Unit>:
      ensured : Unit <- Store.ensure_before_begin(db)
      stored : String <- IO.try(String,Store.transact_sql(db,
        "BEGIN IMMEDIATE;INSERT INTO message_reads(attempt,message,recipient,native,identity) SELECT " ++ C.q(attempt)
        ++ ",m.id,m.recipient," ++ C.q(native) ++ "," ++ C.q(identity) ++ " FROM json_each(" ++ C.q(saved)
        ++ ") j JOIN messages m ON m.id=" ++ Status.exposed(read,"id") ++ " WHERE " ++ Status.found(read)
        ++ " AND m.recipient=" ++ C.q(session) ++ " AND m.recipient=" ++ Status.exposed(read,"recipient")
        ++ " AND m.body=" ++ Status.exposed(read,"body") ++ " AND " ++ current
        ++ " AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ C.q(session)
        ++ ") ON CONFLICT(attempt,identity,message) DO NOTHING;"
        ++ "DELETE FROM wake_claims WHERE session=" ++ C.q(session) ++ " AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.recipient=" ++ C.q(session) ++ " AND " ++ Status.owed_sql("m") ++ ");COMMIT;"))
      IO.pure(Unit,Unit{})

def external_record_if(empty: Bool, +db: String, +session: String, +saved: String, +read: Bool, context: String) -> IO(Unit):
  match empty:
    case True{}: codex_record(db,session,saved,read)
    case False{}: do IO<Unit>:
      scope : HandlingScope <- mcp_handling(db,session,context)
      mcp_record_scope(scope,db,session,saved,read)

def external_record(+db: String, +session: String, +saved: String, +read: Bool) -> IO(Unit):
  do IO<Unit>:
    +context : String <- environment("BATON_MCP_INPUT")
    external_record_if(String.is_empty(context),db,session,saved,read,context)

def cli_read(+db: String, +session: String, +saved: String) -> IO(Unit):
  do IO<Unit>:
    ensured : Unit <- Store.ensure_before_begin(db)
    stored : String <- IO.try(String,Store.transact_sql(db,Status.cli_read_sql(session,saved)))
    IO.pure(Unit,Unit{})

def external_read(+db: String, +session: String, +saved: String, +read: Bool) -> IO(Unit):
  do IO<Unit>:
    external : Unit <- external_record(db,session,saved,read)
    Bool.pick(IO(Unit),read,cli_read(db,session,saved),IO.pure(Unit,Unit{}))

def after_output(+db: String, +session: String, +directory: String, +saved: String, +read: Bool, output: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match output:
    case Fail{error}: IO.pass(Unit,Fail{error})
    case Done{unit}:
      Bool.pick(IO(Unit),String.is_empty(directory),external_read(db,session,saved,read),record(db,session,directory,saved,read))

def output(+db: String, +session: String, +saved: String, +read: Bool) -> IO(Unit):
  do IO<Unit>:
    directory : String <- context(db,session)
    visible : String <- decorate(db,saved,read)
    written : Result<&1,&1,U32 & String,Unit> <- Text.Text.control_output(visible ++ "\n")
    after_output(db,session,directory,saved,read,written)

def command_owned_output(+db: String, +session: String, +saved: String, +observed: String, read: Bool) -> IO(Unit):
  do IO<Unit>:
    directory : String <- context(db,session)
    written : Result<&1,&1,U32 & String,Unit> <- Text.Text.control_output(saved)
    after_output(db,session,directory,observed,read,written)

def command_message_output(+db: String, +saved: String, detail: Bool) -> IO(Unit):
  do IO<Unit>:
    +message : String <- IO.pure(String,Bool.pick(String,detail,"json_extract(" ++ C.q(saved) ++ ",'$.message')",C.q(saved)))
    recipient_hex : String <- IO.try(String,DB.Sql.read(db,"SELECT hex(json_extract(" ++ message ++ ",'$.recipient'));"))
    recipient : String <- field(recipient_hex)
    observed : String <- IO.try(String,DB.Sql.read(db,"SELECT json_array(json_object('status','found','delivery',json(" ++ message ++ ")));"))
    command_owned_output(db,recipient,saved,observed,True{})

def batch_session(+db: String) -> IO(String):
  do IO<String>:
    +selected : String <- environment("BATON_SESSION")
    +directory : String <- context(db,selected)
    +native : String <- environment("CODEX_THREAD_ID")
    connection : String <- environment("BATON_MCP_INPUT")
    selected_hex : String <- Bool.pick(IO(String),String.is_empty(native),IO.pure(String,"\n"),IO.try(String,DB.Sql.read(db,"SELECT CASE WHEN count(*)=1 THEN hex(min(id)) ELSE '' END FROM sessions WHERE native=" ++ C.q(native) ++ " AND harness='codex';")))
    +codex : String <- field(selected_hex)
    fallback : String = Bool.pick(String,String.is_empty(codex),selected,codex)
    IO.pure(String,Bool.pick(String,Bool.and(String.is_empty(directory),String.is_empty(connection)),fallback,selected))

def command_pending_output(+db: String, +saved: String) -> IO(Unit):
  do IO<Unit>:
    session : String <- batch_session(db)
    command_owned_output(db,session,saved,saved,True{})

def command_output_value(+db: String, command: C.Command, +saved: String) -> IO(Unit):
  match command:
    case C.Pretty{inner}: command_output_value(db,inner,saved)
    case C.Delivery{id}: command_message_output(db,saved,False{})
    case C.InputDetail{id}: command_message_output(db,saved,True{})
    case C.Inbox{session}: command_owned_output(db,session,saved,saved,True{})
    case C.Pending{}: command_pending_output(db,saved)
    case other: IO.try(Unit,Text.Text.control_output(saved))

def command_output(+db: String, command: C.Command, +saved: String) -> IO(Unit):
  Bool.pick(IO(Unit),String.is_empty(saved),IO.die(Unit,1,"No matching session or message; inspect status and the requested ID."),command_output_value(db,command,saved))

def batch_output(+db: String, saved: String) -> IO(Unit):
  do IO<Unit>:
    session : String <- batch_session(db)
    output(db,session,saved,True{})

def retained_failure(db: String, session: String, attempt: String, code: U32, cause: String) -> IO(Unit):
  do IO<Unit>:
    retained : String <- IO.try(String,Store.apply(db,C.Report{attempt ++ ":input-status-error",session,"Native input observation failed (" ++ U32.show(code) ++ "): " ++ cause}))
    IO.pure(Unit,Unit{})

def prompt_result(+db: String, +session: String, +attempt: String, +native: String, identity: String, result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{(+code,cause)}:
      Bool.pick(IO(Unit),U32.is_eq(code,2),IO.pure(Unit,Unit{}),retained_failure(db,session,attempt,code,cause))
    case Done{input}: do IO<Unit>:
      recorded : String <- IO.try(String,Store.transact_sql(db,Status.prompt_record_sql(session,attempt,native,identity,input)))
      IO.pure(Unit,Unit{})

def prompt_if(+db: String, +session: String, +attempt: String, +directory: String, +native: String, +witness: String, delivered: Bool) -> IO(Unit):
  match delivered:
    case False{}: IO.pure(Unit,Unit{})
    case True{}: do IO<Unit>:
      raw : String <- IO.try(String,DB.Sql.read(db,"SELECT hex(json_extract(" ++ C.q(witness) ++ ",'$.identity'));"))
      identity : String <- field(raw)
      input : Result<&1,&1,U32 & String,String> <- Custody.Instance.input_prompt(db,directory)
      prompt_result(db,session,attempt,native,identity,input)

# Prompt-carried reads are recorded from the delivery witness alone: the
# initial input was written to the native process. Turn success is a separate
# task lifecycle fact and never gates the read record. The muse witness
# evidences the read only once its complete marker is recorded.
def retained_witness(+db: String, +session: String, +attempt: String, +path: String, +native: String, harness: String, result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{(+code,cause)}:
      Bool.pick(IO(Unit),U32.is_eq(code,2),IO.pure(Unit,Unit{}),retained_failure(db,session,attempt,code,cause))
    case Done{+witness}: do IO<Unit>:
      complete : String <- IO.try(String,DB.Sql.read(db,"SELECT json_extract(" ++ C.q(witness) ++ ",'$.complete');"))
      delivered : String <- IO.try(String,DB.Sql.read(db,"SELECT json_extract(" ++ C.q(witness) ++ ",'$.initialInputDelivered') AND json_extract(" ++ C.q(witness) ++ ",'$.initialInputBytes')<>'0';"))
      exposed : Bool <- IO.pure(Bool,Bool.and(Bool.not(String.is_empty(native)),Bool.pick(Bool,String.eq(harness,"muse"),String.eq(complete,"1\n"),String.eq(delivered,"1\n"))))
      prompt_if(db,session,attempt,path,native,witness,exposed)

def initial_fields(+db: String, +session: String, +attempt: String, fields: List<String>) -> IO(Unit):
  match fields:
    case directory_hex <> native_hex <> harness_hex <> Nil{}: do IO<Unit>:
      +path : String <- field(directory_hex)
      +native : String <- field(native_hex)
      harness : String <- field(harness_hex)
      witness : Result<&1,&1,U32 & String,String> <- Custody.Instance.input_witness(db,path)
      retained_witness(db,session,attempt,path,native,harness,witness)
    case other: IO.pure(Unit,Unit{})

def initial_reads(+db: String, +session: String, +attempt: String, known: Bool) -> IO(Unit):
  match known:
    case False{}: IO.pure(Unit,Unit{})
    case True{}: do IO<Unit>:
      fields : String <- IO.try(String,DB.Sql.read(db,"SELECT hex(e.directory) || char(9) || hex(s.native) || char(9) || hex(s.harness) FROM executions e JOIN sessions s ON s.id=e.session WHERE e.session=" ++ C.q(session) ++ " AND e.id=" ++ C.q(attempt) ++ ";"))
      initial_fields(db,session,attempt,Tx.split_tabs(Tx.trim_nl(fields)))

def record_initial_reads(+db: String, session: String, attempt: String) -> IO(Unit):
  do IO<Unit>:
    known : Bool <- present(db)
    initial_reads(db,session,attempt,known)

def initial_observed(+db: String, +session: String, +attempt: String, +event: String) -> IO(Unit):
  do IO<Unit>:
    identity : String <- IO.try(String,DB.Sql.read(db,"SELECT CASE WHEN json_valid(" ++ C.q(event) ++ ") THEN coalesce(CASE WHEN json_extract(" ++ C.q(event) ++ ",'$.type')='thread.started' THEN json_extract(" ++ C.q(event) ++ ",'$.thread_id') END,json_extract(" ++ C.q(event) ++ ",'$.session_id'),CASE WHEN json_extract(" ++ C.q(event) ++ ",'$.type')='response' AND json_extract(" ++ C.q(event) ++ ",'$.command')='get_state' AND json_extract(" ++ C.q(event) ++ ",'$.success')=1 THEN json_extract(" ++ C.q(event) ++ ",'$.data.sessionId') END,CASE WHEN json_extract(" ++ C.q(event) ++ ",'$.stream.kind')='session' THEN json_extract(" ++ C.q(event) ++ ",'$.stream.id') END,CASE WHEN json_extract(" ++ C.q(event) ++ ",'$.type')='session' THEN json_extract(" ++ C.q(event) ++ ",'$.id') END,'')<>'' ELSE 0 END;"))
    Bool.pick(IO(Unit),String.eq(identity,"1\n"),record_initial_reads(db,session,attempt),IO.pure(Unit,Unit{}))
