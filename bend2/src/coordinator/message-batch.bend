import Base
import ../coordinator/commands.bend as C
import ./store.bend as Store
import ./wake.bend as Wake
import ./agent-input.bend as AgentInput
import ../host/sqlite.bend as DB
import ../context/raw.bend as Raw
import ../context/request.bend as Req
import ../git/text.bend as Tx
import ../json/canonical.bend as J

def fail_json(+condition: String) -> String:
  "{\"error\":\"message-batch-input\",\"condition\":" ++ J.string_literal(condition) ++ "}"

def invalid(+condition: String) -> IO(String):
  IO.die(String,2,fail_json(condition))

def raw_value(read: Raw.RawRead) -> IO(String):
  match read:
    case Raw.RawText{value}: IO.pure(String,value)
    case Raw.RawInvalidUtf8{offset}: invalid("invalidUtf8 byte " ++ offset)
    case Raw.RawNul{offset}: invalid("embeddedNul byte " ++ offset)
    case Raw.RawBom{}: invalid("leadingBom")

def raw_result(result: Result<&1,&1,U32 & String,Raw.RawRead>) -> IO(String):
  match result:
    case Fail{(code,detail)}: IO.die(String,code,detail)
    case Done{read}: raw_value(read)

def read_input(+path: String) -> IO(String):
  do IO<String>:
    result : Result<&1,&1,U32 & String,Raw.RawRead> <- Raw.Raw.read_utf8(path)
    raw_result(result)

def duplicate_sql(+text: String) -> String:
  "WITH raw(t) AS (SELECT " ++ Req.sql_quote(text) ++ ") SELECT (SELECT count(*) FROM json_tree(t) c WHERE c.parent IS NOT NULL AND EXISTS (SELECT 1 FROM json_tree(t) p WHERE p.id=c.parent AND p.type='object') AND EXISTS (SELECT 1 FROM json_tree(t) s WHERE s.parent=c.parent AND s.key=c.key AND s.rowid<>c.rowid)) FROM raw;"

def root_type_sql(+text: String) -> String:
  "WITH raw(t) AS (SELECT " ++ Req.sql_quote(text) ++ ") SELECT json_type(t) FROM raw;"

def validate_duplicates(+db: String, +text: String, valid: Bool) -> IO(String):
  match valid:
    case False{}: invalid("invalidJson")
    case True{}: do IO<String>:
      duplicates : String <- IO.try(String,DB.Sql.read(db,duplicate_sql(text)))
      Bool.pick(IO(String),String.eq(Tx.trim_nl(duplicates),"0"),IO.pure(String,text),invalid("duplicateKey"))

def validate_root(+db: String, +text: String, kind: String) -> IO(String):
  do IO<String>:
    root : String <- IO.try(String,DB.Sql.read(db,root_type_sql(text)))
    Bool.pick(IO(String),String.eq(Tx.trim_nl(root),kind),IO.pure(String,text),invalid("rootNotArray"))

def validate(+db: String, +text: String) -> IO(String):
  do IO<String>:
    valid : String <- IO.try(String,DB.Sql.read(db,Req.validity_sql(text)))
    unique : String <- validate_duplicates(db,text,String.eq(valid,"1\n"))
    validate_root(db,unique,"array")

def decoded(+hex: String) -> String:
  Req.scalar_value(Req.decode_scalar_utf8(Tx.hex_decode(hex)))

def decoded_reason(+field: String, +hex: String) -> String:
  +reason = Req.scalar_reason(Req.decode_scalar_utf8(Tx.hex_decode(hex)))
  Bool.pick(String,String.is_empty(reason),"",field ++ ":" ++ reason)

def first_reason(+left: String, +right: String) -> String:
  Bool.pick(String,String.is_empty(left),right,left)

def detail_read(+id: String) -> String:
  "[\"delivery\"," ++ J.string_literal(id) ++ "]"

def item_prefix(+index: String, +id: String) -> String:
  "{\"index\":" ++ index ++ ",\"id\":" ++ J.string_literal(id)

def error_tail(+code: U32, +cause: String) -> String:
  "\"code\":" ++ U32.show(code) ++ ",\"cause\":" ++ J.string_literal(cause)

def read_absent(+index: String, +id: String) -> String:
  item_prefix(index,id) ++ ",\"status\":\"absent\",\"cause\":\"No matching stored message.\",\"detailRead\":" ++ detail_read(id) ++ "}"

def read_found(+index: String, +id: String, +delivery: String, +receipt: String) -> String:
  item_prefix(index,id) ++ ",\"status\":\"found\",\"receiptStatus\":" ++ J.string_literal(receipt) ++ ",\"delivery\":" ++ delivery ++ ",\"detailRead\":" ++ detail_read(id) ++ "}"

def read_failed(+index: String, +id: String, +code: U32, +cause: String) -> String:
  item_prefix(index,id) ++ ",\"status\":\"refused\"," ++ error_tail(code,cause) ++ ",\"detailRead\":" ++ detail_read(id) ++ "}"

def snapshot_fields(fields: List<String>) -> Result<&1,&1,U32 & String,String & String>:
  match fields:
    case receipt_hex <> delivery_hex <> Nil{}: Done{(decoded(receipt_hex),decoded(delivery_hex))}
    case other: Fail{(1,"Stored delivery snapshot has an invalid shape.")}

def snapshot_value(+value: String) -> Result<&1,&1,U32 & String,String & String>:
  Bool.pick(Result<&1,&1,U32 & String,String & String>,String.is_empty(value),Done{("","")},snapshot_fields(Tx.split_tabs(Tx.trim_nl(value))))

def snapshot_result(result: Result<&1,&1,U32 & String,String>) -> Result<&1,&1,U32 & String,String & String>:
  match result:
    case Fail{error}: Fail{error}
    case Done{value}: snapshot_value(value)

def snapshot_sql(+id: String) -> String:
  "SELECT hex(CAST(CASE WHEN " ++ C.read_sql("m") ++ " THEN 'read' ELSE 'pending' END AS TEXT)) || char(9) || hex(CAST(" ++ C.delivery_row() ++ " AS TEXT)) FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.id=" ++ C.q(id) ++ ";"

def snapshot(+db: String, +id: String) -> IO(Result<&1,&1,U32 & String,String & String>):
  do IO<Result<&1,&1,U32 & String,String & String>>:
    value : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,snapshot_sql(id))
    IO.pure(Result<&1,&1,U32 & String,String & String>,snapshot_result(value))

def read_result(+index: String, +id: String, result: Result<&1,&1,U32 & String,String & String>) -> String:
  match result:
    case Fail{(code,cause)}: read_failed(index,id,code,cause)
    case Done{(receipt,+message)}:
      Bool.pick(String,String.is_empty(message),read_absent(index,id),read_found(index,id,message,receipt))

def read_one(+db: String, +index: String, +id: String) -> IO(String):
  do IO<String>:
    state : Result<&1,&1,U32 & String,String & String> <- snapshot(db,id)
    IO.pure(String,read_result(index,id,state))

def malformed_read(+index: String, +id: String, +cause: String) -> String:
  item_prefix(index,id) ++ ",\"status\":\"refused\",\"cause\":" ++ J.string_literal("batchItem:" ++ cause) ++ ",\"detailRead\":" ++ detail_read(id) ++ "}"

def read_row(+db: String, fields: List<String>) -> IO(String):
  match fields:
    case index_hex <> +id_hex <> cause_hex <> "78" <> Nil{}:
      +index = decoded(index_hex)
      +id = decoded(id_hex)
      +cause = first_reason(decoded(cause_hex),decoded_reason("id",id_hex))
      Bool.pick(IO(String),String.is_empty(cause),read_one(db,index,id),IO.pure(String,malformed_read(index,id,cause)))
    case other: invalid("malformedReadRows")

def rows_tail(+db: String, rows: List<String>) -> IO(String):
  match rows:
    case Nil{}: IO.pure(String,"]")
    case line <> rest: do IO<String>:
      item : String <- read_row(db,Tx.split_tabs(line))
      tail : String <- rows_tail(db,rest)
      IO.pure(String,"," ++ item ++ tail)

def rows_json(+db: String, rows: List<String>) -> IO(String):
  match rows:
    case Nil{}: IO.pure(String,"[]")
    case line <> rest: do IO<String>:
      item : String <- read_row(db,Tx.split_tabs(line))
      tail : String <- rows_tail(db,rest)
      IO.pure(String,"[" ++ item ++ tail)

def read_items_sql(+text: String) -> String:
  "WITH raw(t) AS (SELECT " ++ Req.sql_quote(text) ++ ") SELECT hex(CAST(j.key AS TEXT)),hex(CAST(CASE WHEN j.type='text' THEN j.value ELSE '' END AS TEXT)),hex(CAST(CASE WHEN j.type<>'text' THEN 'idNotString' WHEN length(j.value)=0 THEN 'idEmpty' WHEN instr(j.value,char(0))>0 THEN 'embeddedNul' ELSE '' END AS TEXT)),hex('x') FROM raw,json_each(raw.t) j ORDER BY CAST(j.key AS INTEGER);"

def read_text(+db: String, +text: String) -> IO(Unit):
  do IO<Unit>:
    input : String <- validate(db,text)
    rows : String <- IO.try(String,DB.Sql.read(db,read_items_sql(input)))
    answer : String <- rows_json(db,Tx.split_lines(rows))
    AgentInput.batch_output(db,answer)

def read_file(+db: String, +path: String) -> IO(Unit):
  do IO<Unit>:
    text : String <- read_input(path)
    read_text(db,text)

def message_prefix(+index: String, +id: String, +sender: String, +recipient: String, +kind: String) -> String:
  item_prefix(index,id) ++ ",\"sender\":" ++ J.string_literal(sender) ++ ",\"recipient\":" ++ J.string_literal(recipient) ++ ",\"kind\":" ++ J.string_literal(kind)

def send_refused(+index: String, +id: String, +sender: String, +recipient: String, +kind: String, +code: U32, +cause: String) -> String:
  message_prefix(index,id,sender,recipient,kind) ++ ",\"status\":\"refused\",\"admission\":{\"status\":\"refused\"," ++ error_tail(code,cause) ++ "},\"detailRead\":" ++ detail_read(id) ++ "}"

def send_malformed(+index: String, +id: String, +sender: String, +recipient: String, +kind: String, +cause: String) -> String:
  message_prefix(index,id,sender,recipient,kind) ++ ",\"status\":\"refused\",\"admission\":{\"status\":\"refused\",\"cause\":" ++ J.string_literal("batchItem:" ++ cause) ++ "},\"detailRead\":" ++ detail_read(id) ++ "}"

def wake_parts(wake: Result<&1,&1,U32 & String,Unit>) -> Bool & String:
  match wake:
    case Fail{(code,cause)}: (True{}, "{\"status\":\"refused\"," ++ error_tail(code,cause) ++ "}")
    case Done{unit}: (False{}, "{\"status\":\"accepted\"}")

def admitted_status(+read: String, refused: Bool) -> String:
  match refused:
    case True{}: Bool.pick(String,String.eq(read,"read"),"read","pending")
    case False{}: Bool.pick(String,String.eq(read,"read"),"read","admitted")

def admitted_present(+index: String, +id: String, +sender: String, +recipient: String, +kind: String, +saved: String, +receipt: String, +message: String, +refused: Bool, +wake_text: String) -> String:
  message_prefix(index,id,sender,recipient,kind) ++ ",\"status\":" ++ J.string_literal(admitted_status(receipt,refused)) ++ ",\"admission\":{\"status\":\"admitted\",\"message\":" ++ Tx.trim_nl(saved) ++ "},\"wake\":" ++ wake_text ++ ",\"receiptStatus\":" ++ J.string_literal(receipt) ++ ",\"delivery\":" ++ message ++ ",\"detailRead\":" ++ detail_read(id) ++ "}"

def admitted_snapshot_parts(+index: String, +id: String, +sender: String, +recipient: String, +kind: String, +saved: String, parts: Bool & String, state: Result<&1,&1,U32 & String,String & String>) -> String:
  (+refused,+wake_text) = parts
  match state:
    case Fail{(code,cause)}:
      message_prefix(index,id,sender,recipient,kind) ++ ",\"status\":\"pending\",\"admission\":{\"status\":\"admitted\",\"message\":" ++ Tx.trim_nl(saved) ++ "},\"wake\":" ++ wake_text ++ ",\"snapshot\":{\"status\":\"refused\"," ++ error_tail(code,cause) ++ "},\"detailRead\":" ++ detail_read(id) ++ "}"
    case Done{(receipt,+message)}:
      Bool.pick(String,String.is_empty(message),
        message_prefix(index,id,sender,recipient,kind) ++ ",\"status\":\"pending\",\"admission\":{\"status\":\"admitted\",\"message\":" ++ Tx.trim_nl(saved) ++ "},\"wake\":" ++ wake_text ++ ",\"snapshot\":{\"status\":\"absent\"},\"detailRead\":" ++ detail_read(id) ++ "}",
        admitted_present(index,id,sender,recipient,kind,saved,receipt,message,refused,wake_text))

def admitted_snapshot(+index: String, +id: String, +sender: String, +recipient: String, +kind: String, +saved: String, wake: Result<&1,&1,U32 & String,Unit>, state: Result<&1,&1,U32 & String,String & String>) -> String:
  admitted_snapshot_parts(index,id,sender,recipient,kind,saved,wake_parts(wake),state)

def admitted(+db: String, +index: String, +id: String, +sender: String, +recipient: String, +kind: String, +saved: String, +command: C.Command) -> IO(String):
  do IO<String>:
    wake : Result<&1,&1,U32 & String,Unit> <- Wake.drive_command(db,command,Done{saved})
    state : Result<&1,&1,U32 & String,String & String> <- snapshot(db,id)
    IO.pure(String,admitted_snapshot(index,id,sender,recipient,kind,saved,wake,state))

def admission_result(+db: String, +index: String, +id: String, +sender: String, +recipient: String, +kind: String, command: C.Command, result: Result<&1,&1,U32 & String,String>) -> IO(String):
  match result:
    case Fail{(code,cause)}: IO.pure(String,send_refused(index,id,sender,recipient,kind,code,cause))
    case Done{saved}: admitted(db,index,id,sender,recipient,kind,saved,command)

def send_one(+db: String, +index: String, +id: String, +sender: String, +recipient: String, +kind: String, +body: String) -> IO(String):
  do IO<String>:
    result : Result<&1,&1,U32 & String,String> <- Store.apply(db,C.Message{id,sender,recipient,kind,body})
    admission_result(db,index,id,sender,recipient,kind,C.Message{id,sender,recipient,kind,body},result)

def send_row(+db: String, +sender: String, fields: List<String>) -> IO(String):
  match fields:
    case index_hex <> +id_hex <> +recipient_hex <> +kind_hex <> +body_hex <> cause_hex <> "78" <> Nil{}:
      +index = decoded(index_hex)
      +id = decoded(id_hex)
      +recipient = decoded(recipient_hex)
      +kind = decoded(kind_hex)
      +body = decoded(body_hex)
      +field_cause = first_reason(decoded_reason("id",id_hex),first_reason(decoded_reason("recipient",recipient_hex),first_reason(decoded_reason("kind",kind_hex),decoded_reason("body",body_hex))))
      +cause = first_reason(decoded(cause_hex),field_cause)
      Bool.pick(IO(String),String.is_empty(cause),send_one(db,index,id,sender,recipient,kind,body),IO.pure(String,send_malformed(index,id,sender,recipient,kind,cause)))
    case other: invalid("malformedMessageRows")

def send_rows_tail(+db: String, +sender: String, rows: List<String>) -> IO(String):
  match rows:
    case Nil{}: IO.pure(String,"]")
    case line <> rest: do IO<String>:
      item : String <- send_row(db,sender,Tx.split_tabs(line))
      tail : String <- send_rows_tail(db,sender,rest)
      IO.pure(String,"," ++ item ++ tail)

def send_rows_json(+db: String, +sender: String, rows: List<String>) -> IO(String):
  match rows:
    case Nil{}: IO.pure(String,"[]")
    case line <> rest: do IO<String>:
      item : String <- send_row(db,sender,Tx.split_tabs(line))
      tail : String <- send_rows_tail(db,sender,rest)
      IO.pure(String,"[" ++ item ++ tail)

def send_items_sql(+text: String) -> String:
  "WITH raw(t) AS (SELECT " ++ Req.sql_quote(text) ++ ") SELECT hex(CAST(j.key AS TEXT)),hex(CAST(CASE WHEN j.type='object' THEN coalesce(json_extract(j.value,'$.id'),'') ELSE '' END AS TEXT)),hex(CAST(CASE WHEN j.type='object' THEN coalesce(json_extract(j.value,'$.recipient'),'') ELSE '' END AS TEXT)),hex(CAST(CASE WHEN j.type='object' THEN coalesce(json_extract(j.value,'$.kind'),'') ELSE '' END AS TEXT)),hex(CAST(CASE WHEN j.type='object' THEN coalesce(json_extract(j.value,'$.body'),'') ELSE '' END AS TEXT)),hex(CAST(CASE WHEN j.type<>'object' THEN 'itemNotObject' WHEN EXISTS(SELECT 1 FROM json_each(j.value) f WHERE f.key NOT IN('id','recipient','kind','body')) THEN 'unknownField' WHEN (SELECT count(*) FROM json_each(j.value) f WHERE f.key IN('id','recipient','kind','body'))<>4 THEN 'missingField' WHEN json_type(j.value,'$.id')<>'text' OR json_type(j.value,'$.recipient')<>'text' OR json_type(j.value,'$.kind')<>'text' OR json_type(j.value,'$.body')<>'text' THEN 'fieldNotString' WHEN length(json_extract(j.value,'$.id'))=0 THEN 'idEmpty' WHEN length(json_extract(j.value,'$.recipient'))=0 THEN 'recipientEmpty' WHEN length(json_extract(j.value,'$.kind'))=0 THEN 'kindEmpty' WHEN instr(json_extract(j.value,'$.id'),char(0))>0 OR instr(json_extract(j.value,'$.recipient'),char(0))>0 OR instr(json_extract(j.value,'$.kind'),char(0))>0 OR instr(json_extract(j.value,'$.body'),char(0))>0 THEN 'embeddedNul' ELSE '' END AS TEXT)),hex('x') FROM raw,json_each(raw.t) j ORDER BY CAST(j.key AS INTEGER);"

def send_text(+db: String, +sender: String, +text: String) -> IO(Unit):
  do IO<Unit>:
    input : String <- validate(db,text)
    rows : String <- IO.try(String,DB.Sql.read(db,send_items_sql(input)))
    answer : String <- send_rows_json(db,sender,Tx.split_lines(rows))
    IO.write(answer)

def send_file(+db: String, +sender: String, +path: String) -> IO(Unit):
  do IO<Unit>:
    text : String <- read_input(path)
    send_text(db,sender,text)
