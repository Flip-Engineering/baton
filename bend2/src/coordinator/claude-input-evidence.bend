# Claude Code reports admitted input in API request frames and Read tool results.
import Base
import ../coordinator/commands.bend as C
import ./input-hook.bend as InputHook
import ../coordinator/message-status.bend as Status
import ./native-input.bend as NativeInput
import ../host/instance.bend as Custody
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx

def text(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Done{value}: Tx.trim_nl(value)
    case Fail{error}: ""

def kept_line(empty: Bool, line: String, kept: List<String>) -> List<String>:
  match empty:
    case True{}: kept
    case False{}: Con{line,kept}

def nonempty_lines(lines: List<String>) -> List<String>:
  match lines:
    case Nil{}: Nil{}
    case +line <> rest: kept_line(String.is_empty(line),line,nonempty_lines(rest))

def transcript_json(transcript: String) -> String:
  "[" ++ Tx.join(",",nonempty_lines(Tx.split_lines(transcript))) ++ "]"

def rendered(+row: String) -> String:
  Status.complete_message_sql(row ++ ".id",row ++ ".kind",row ++ ".sender",row ++ ".body")

def selection_sql(+session: String, +directory: String, +event: String, +transcript: String) -> String:
  "WITH RECURSIVE event(value) AS (SELECT " ++ C.q(event) ++ "), frames(key,value) AS (SELECT key,value FROM json_each(" ++ C.q(transcript_json(transcript)) ++ ")), prompted_frames(key,prompt_id) AS (SELECT frame.key,coalesce(json_extract(frame.value,'$.promptId'),(SELECT json_extract(previous.value,'$.promptId') FROM frames previous WHERE previous.key<=frame.key AND json_extract(previous.value,'$.type')='user' AND json_extract(previous.value,'$.sessionId')=json_extract((SELECT value FROM event),'$.session_id') AND json_type(previous.value,'$.promptId')='text' ORDER BY previous.key DESC LIMIT 1)) FROM frames frame), "
  ++ "native_scope(native) AS (SELECT s.native FROM executions e JOIN sessions s ON s.id=e.session WHERE e.session=" ++ C.q(session) ++ " AND e.directory=" ++ C.q(directory) ++ " AND e.phase='running' AND s.native<>'' AND s.native=json_extract((SELECT value FROM event),'$.session_id') AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ "), "
  ++ "prompt_scope(start) AS (SELECT min(frame.key) FROM frames frame JOIN prompted_frames prompt ON prompt.key=frame.key WHERE json_extract(frame.value,'$.type')='user' AND json_extract(frame.value,'$.sessionId')=(SELECT native FROM native_scope) AND prompt.prompt_id=json_extract((SELECT value FROM event),'$.prompt_id')), "
  ++ "api_context(content) AS (SELECT json_extract(frame.value,'$.message.content') FROM frames frame JOIN prompted_frames prompt ON prompt.key=frame.key WHERE frame.key>=(SELECT start FROM prompt_scope) AND prompt.prompt_id=json_extract((SELECT value FROM event),'$.prompt_id') AND json_extract(frame.value,'$.type')='api-request-blob' AND json_extract(frame.value,'$.sessionId')=(SELECT native FROM native_scope) AND json_extract(frame.value,'$.message.role')='system'), "
  ++ "api_text(content) AS (SELECT json_extract(block.value,'$.text') FROM api_context context,json_each(context.content) block WHERE json_extract(block.value,'$.type')='text'), "
  ++ "read_calls(id,path) AS (SELECT json_extract(block.value,'$.id'),json_extract(block.value,'$.input.file_path') FROM frames frame JOIN prompted_frames prompt ON prompt.key=frame.key,json_each(CASE WHEN json_type(frame.value,'$.message.content')='array' THEN json_extract(frame.value,'$.message.content') ELSE '[]' END) block WHERE json_extract(frame.value,'$.type')='assistant' AND json_extract(frame.value,'$.sessionId')=(SELECT native FROM native_scope) AND prompt.prompt_id=json_extract((SELECT value FROM event),'$.prompt_id') AND json_extract(block.value,'$.type')='tool_use' AND json_extract(block.value,'$.name')='Read'), "
  ++ "read_results(id,content) AS (SELECT json_extract(block.value,'$.tool_use_id'),json_extract(block.value,'$.content') FROM frames frame JOIN prompted_frames prompt ON prompt.key=frame.key,json_each(CASE WHEN json_type(frame.value,'$.message.content')='array' THEN json_extract(frame.value,'$.message.content') ELSE '[]' END) block WHERE json_extract(frame.value,'$.type')='user' AND json_extract(frame.value,'$.sessionId')=(SELECT native FROM native_scope) AND prompt.prompt_id=json_extract((SELECT value FROM event),'$.prompt_id') AND json_extract(block.value,'$.type')='tool_result' AND json_type(block.value,'$.content')='text'), "
  ++ "matched_reads(id,path,content) AS (SELECT call.id,call.path,result.content FROM read_calls call JOIN read_results result ON result.id=call.id), "
  ++ "read_lines(id,path,line_no,line,rest) AS (SELECT id,path,1,substr(content||char(10),1,instr(content||char(10),char(10))-1),substr(content||char(10),instr(content||char(10),char(10))+1) FROM matched_reads UNION ALL SELECT id,path,line_no+1,substr(rest,1,instr(rest,char(10))-1),substr(rest,instr(rest,char(10))+1) FROM read_lines WHERE instr(rest,char(10))>0), "
  ++ "normalized_reads(id,path,content) AS (SELECT id,path,(SELECT group_concat(line,char(10)) FROM (SELECT CASE WHEN instr(line,char(9))>0 THEN substr(line,instr(line,char(9))+1) ELSE line END AS line FROM read_lines numbered WHERE numbered.id=read_lines.id AND numbered.path=read_lines.path ORDER BY line_no)) FROM read_lines GROUP BY id,path), "
  ++ "pending AS (SELECT m.id,m.recipient,m.kind,m.sender,m.body," ++ rendered("m") ++ " AS complete FROM messages m WHERE m.recipient=" ++ C.q(session) ++ " AND " ++ Status.owed_sql("m") ++ " AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ " AND EXISTS(SELECT 1 FROM native_scope)) "
  ++ "SELECT coalesce(json_group_array(json(item)),'[]') FROM (SELECT DISTINCT json_object('id',m.id,'recipient',m.recipient,'body',m.body) AS item FROM pending m WHERE EXISTS(SELECT 1 FROM api_text context WHERE instr(context.content,'PostToolUse:')>0 AND instr(context.content,'hook additional context:')>0 AND instr(context.content,m.complete)>instr(context.content,'hook additional context:')) OR EXISTS(SELECT 1 FROM normalized_reads result WHERE instr(result.content,m.complete)>0) ORDER BY m.id);"

def selected(+db: String, +session: String, +directory: String, +witness: String, result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{error}: IO.pure(Unit,Unit{})
    case Done{+saved}: do IO<Unit>:
      count_result : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,"SELECT json_array_length(" ++ C.q(Tx.trim_nl(saved)) ++ ");")
      count : String <- IO.pure(String,text(count_result))
      Bool.pick(IO(Unit),String.eq(count,"0"),IO.pure(Unit,Unit{}),
        (do IO<Unit>:
          scope : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,"SELECT hex(e.id)||char(9)||hex(s.native)||char(9)||hex(json_extract(" ++ C.q(witness) ++ ",'$.identity')) FROM executions e JOIN sessions s ON s.id=e.session WHERE e.session=" ++ C.q(session) ++ " AND e.directory=" ++ C.q(directory) ++ " AND e.phase='running' AND s.native<>'' AND json_extract(" ++ C.q(witness) ++ ",'$.live')=1 AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ ";")
          InputHook.recorded(db,session,directory,Tx.trim_nl(saved),Tx.split_tabs(text(scope)))))

def selected_with_witness(+db: String, +session: String, +directory: String, result: Result<&1,&1,U32 & String,String>, witness: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match witness:
    case Fail{error}: IO.pure(Unit,Unit{})
    case Done{+bound}: selected(db,session,directory,Tx.trim_nl(bound),result)

def loaded(+db: String, +session: String, +directory: String, +event: String, transcript: Result<&1,&1,U32 & String,String>, witness: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match transcript:
    case Fail{error}: IO.pure(Unit,Unit{})
    case Done{+source}: do IO<Unit>:
      selected_result : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,selection_sql(session,directory,event,Tx.trim_nl(source)))
      selected_with_witness(db,session,directory,selected_result,witness)

def transcript_path(+db: String, +event: String) -> IO(String):
  do IO<String>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,"SELECT CASE WHEN json_valid(" ++ C.q(event) ++ ") THEN coalesce(json_extract(" ++ C.q(event) ++ ",'$.transcript_path'),'') ELSE '' END;")
    IO.pure(String,text(result))

# Native transcript evidence and the admitted custody witness derive read rows.
def run(+db: String, +session: String, +directory: String, +event: String) -> IO(Unit):
  do IO<Unit>:
    +path : String <- transcript_path(db,event)
    Bool.pick(IO(Unit),String.is_empty(path),IO.pure(Unit,Unit{}),
      (do IO<Unit>:
        transcript : Result<&1,&1,U32 & String,String> <- NativeInput.text_value(path)
        witness : Result<&1,&1,U32 & String,String> <- Custody.Instance.input_witness(db,directory)
        loaded(db,session,directory,event,transcript,witness)))
