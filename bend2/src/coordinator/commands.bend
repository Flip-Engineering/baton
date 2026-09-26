import Base

type Command is Data:
  RunTurn{worker: String, id: String, cmd: String, model: String, effort: String, cwd: String, task: String, log: String, session: String}
  Attach{id: String, harness: String, native: String, endpoint: String}
  Worker{id: String, parent: String, harness: String, model: String, effort: String, workspace: String, branch: String, base: String}
  Connect{id: String, native: String, endpoint: String}
  Bind{id: String, native: String, harness: String, model: String, effort: String}
  Message{id: String, sender: String, recipient: String, kind: String, body: String}
  MessageFile{id: String, sender: String, recipient: String, kind: String, path: String}
  Observe{id: String, worker: String, event: String}
  ObserveFile{id: String, worker: String, path: String}
  ReportFile{id: String, sender: String, path: String}
  Report{id: String, sender: String, body: String}
  Ack{id: String, recipient: String, receipt: String}
  Session{id: String}
  Delivery{id: String}
  Pending{}
  Inbox{id: String}
  Status{}
  Invalid{}

def escaped(s: String) -> String:
  match s:
    case SNil{}: ""
    case SCon{+h, tail}:
      Bool.pick(String, Char.is_eq(h, Char.from_u32(39)), "''", SCon{h, SNil{}}) ++ escaped(tail)

def q(s: String) -> String:
  "'" ++ escaped(s) ++ "'"

def schema() -> String:
  "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY NOT NULL, parent TEXT REFERENCES sessions(id), harness TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', effort TEXT NOT NULL DEFAULT '', native TEXT NOT NULL DEFAULT '', observed_harness TEXT NOT NULL DEFAULT '', observed_model TEXT NOT NULL DEFAULT '', observed_effort TEXT NOT NULL DEFAULT '', endpoint TEXT NOT NULL DEFAULT '', workspace TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '', base TEXT NOT NULL DEFAULT '');"
  ++ "CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, sender TEXT NOT NULL REFERENCES sessions(id), recipient TEXT NOT NULL REFERENCES sessions(id), kind TEXT NOT NULL, body TEXT NOT NULL, receipt TEXT);"
  ++ "CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY NOT NULL REFERENCES messages(id), worker TEXT NOT NULL REFERENCES sessions(id), event TEXT NOT NULL);"

def session_result(id: String) -> String:
  "SELECT json_object('id',id,'parent',parent,'harness',harness,'model',model,'effort',effort,'native',native,'observedHarness',observed_harness,'observedModel',observed_model,'observedEffort',observed_effort,'endpoint',endpoint,'workspace',workspace,'branch',branch,'base',base) FROM sessions WHERE id=" ++ q(id) ++ ";"

def message_result(id: String) -> String:
  "SELECT json_object('id',id,'sender',sender,'recipient',recipient,'kind',kind,'body',body,'receipt',receipt) FROM messages WHERE id=" ++ q(id) ++ ";"

# A repeated ID returns its first result. Reusing it for different input fails the transaction.
def message_upsert() -> String:
  " ON CONFLICT(id) DO UPDATE SET id=CASE WHEN messages.sender=excluded.sender AND messages.recipient=excluded.recipient AND messages.kind=excluded.kind AND messages.body=excluded.body THEN messages.id ELSE NULL END;"

def delivery_row() -> String:
  "json_object('id',m.id,'sender',m.sender,'recipient',m.recipient,'kind',m.kind,'body',m.body,'receipt',m.receipt,'harness',s.harness,'native',s.native,'endpoint',s.endpoint)"

def terminal(+event: String) -> String:
  "(json_extract(" ++ q(event) ++ ",'$.type')='result' OR (json_extract(" ++ q(event) ++ ",'$.type')='agent_end' AND coalesce(json_extract(" ++ q(event) ++ ",'$.isTerminal'),1)=1))"

def observe_sql(+id: String, +worker: String, +event: String) -> String:
  "UPDATE sessions SET native=coalesce(json_extract(" ++ q(event) ++ ",'$.session_id'),CASE WHEN json_extract(" ++ q(event) ++ ",'$.type')='session' THEN json_extract(" ++ q(event) ++ ",'$.id') END,native),observed_model=coalesce(CASE WHEN json_extract(" ++ q(event) ++ ",'$.message.provider') IS NOT NULL AND json_extract(" ++ q(event) ++ ",'$.message.model') IS NOT NULL THEN json_extract(" ++ q(event) ++ ",'$.message.provider') || '/' || json_extract(" ++ q(event) ++ ",'$.message.model') END,json_extract(" ++ q(event) ++ ",'$.message.model'),json_extract(" ++ q(event) ++ ",'$.model'),observed_model) WHERE id=" ++ q(worker) ++ ";"
  ++ "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ q(id) ++ ",id,parent,'report',CASE WHEN json_extract(" ++ q(event) ++ ",'$.is_error')=1 THEN " ++ q(event) ++ " ELSE coalesce(json_extract(" ++ q(event) ++ ",'$.result'),(SELECT group_concat(json_extract(c.value,'$.text'),char(10)) FROM json_each((SELECT m.value FROM json_each(" ++ q(event) ++ ",'$.messages') m WHERE json_extract(m.value,'$.role')='assistant' ORDER BY m.key DESC LIMIT 1),'$.content') c WHERE json_extract(c.value,'$.type')='text')," ++ q(event) ++ ") END FROM sessions WHERE id=" ++ q(worker) ++ " AND " ++ terminal(event) ++ message_upsert()
  ++ "INSERT INTO turns(id,worker,event) SELECT " ++ q(id) ++ "," ++ q(worker) ++ "," ++ q(event) ++ " WHERE " ++ terminal(event) ++ " ON CONFLICT(id) DO UPDATE SET id=CASE WHEN turns.worker=excluded.worker AND turns.event=excluded.event THEN turns.id ELSE NULL END;"
  ++ "SELECT json_object('worker',id,'native',native,'eventType',json_extract(" ++ q(event) ++ ",'$.type'),'reportId',CASE WHEN " ++ terminal(event) ++ " THEN " ++ q(id) ++ " ELSE NULL END) FROM sessions WHERE id=" ++ q(worker) ++ ";"

def sql(command: Command) -> String:
  match command:
    case Observe{id,worker,event}: observe_sql(id,worker,event)
    case Attach{+id, harness, native, endpoint}:
      "INSERT INTO sessions(id,harness,native,endpoint) VALUES(" ++ q(id) ++ "," ++ q(harness) ++ "," ++ q(native) ++ "," ++ q(endpoint) ++ ") ON CONFLICT(id) DO UPDATE SET id=CASE WHEN sessions.parent IS NULL THEN sessions.id ELSE NULL END,harness=excluded.harness,native=excluded.native,endpoint=excluded.endpoint;" ++ session_result(id)
    case Worker{+id, parent, harness, model, effort, workspace, branch, base}:
      "INSERT INTO sessions(id,parent,harness,model,effort,workspace,branch,base) VALUES(" ++ q(id) ++ "," ++ q(parent) ++ "," ++ q(harness) ++ "," ++ q(model) ++ "," ++ q(effort) ++ "," ++ q(workspace) ++ "," ++ q(branch) ++ "," ++ q(base) ++ ") ON CONFLICT(id) DO UPDATE SET id=CASE WHEN sessions.parent=excluded.parent AND sessions.harness=excluded.harness AND sessions.model=excluded.model AND sessions.effort=excluded.effort AND sessions.workspace=excluded.workspace AND sessions.branch=excluded.branch AND sessions.base=excluded.base THEN sessions.id ELSE NULL END;" ++ session_result(id)
    case Connect{+id,native,endpoint}:
      "UPDATE sessions SET native=" ++ q(native) ++ ",endpoint=" ++ q(endpoint) ++ " WHERE id=" ++ q(id) ++ ";" ++ session_result(id)
    case Bind{+id, native, harness, model, effort}:
      "UPDATE sessions SET native=" ++ q(native) ++ ",observed_harness=" ++ q(harness) ++ ",observed_model=" ++ q(model) ++ ",observed_effort=" ++ q(effort) ++ " WHERE id=" ++ q(id) ++ ";" ++ session_result(id)
    case Message{+id, sender, recipient, kind, body}:
      "INSERT INTO messages(id,sender,recipient,kind,body) VALUES(" ++ q(id) ++ "," ++ q(sender) ++ "," ++ q(recipient) ++ "," ++ q(kind) ++ "," ++ q(body) ++ ")" ++ message_upsert() ++ message_result(id)
    case Report{+id, +sender, body}:
      "INSERT INTO messages(id,sender,recipient,kind,body) VALUES(" ++ q(id) ++ "," ++ q(sender) ++ ",(SELECT parent FROM sessions WHERE id=" ++ q(sender) ++ "),'report'," ++ q(body) ++ ")" ++ message_upsert() ++ message_result(id)
    case Ack{+id, +recipient, receipt}:
      "UPDATE messages SET receipt=coalesce(receipt," ++ q(receipt) ++ ") WHERE id=" ++ q(id) ++ " AND recipient=" ++ q(recipient) ++ ";SELECT json_object('id',id,'receipt',receipt) FROM messages WHERE id=" ++ q(id) ++ " AND recipient=" ++ q(recipient) ++ ";"
    case Session{id}: session_result(id)
    case Delivery{id}:
      "SELECT " ++ delivery_row() ++ " FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.id=" ++ q(id) ++ ";"
    case Pending{}:
      "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ delivery_row() ++ " AS item FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.receipt IS NULL ORDER BY m.seq);"
    case Inbox{id}:
      "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_object('id',id,'sender',sender,'recipient',recipient,'kind',kind,'body',body) AS item FROM messages WHERE recipient=" ++ q(id) ++ " AND receipt IS NULL ORDER BY seq);"
    case Status{}:
      "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_object('id',id,'parent',parent,'harness',harness,'model',model,'effort',effort,'native',native,'observedHarness',observed_harness,'observedModel',observed_model,'observedEffort',observed_effort,'endpoint',endpoint,'workspace',workspace,'branch',branch,'base',base,'pending',(SELECT count(*) FROM messages WHERE recipient=sessions.id AND receipt IS NULL)) AS item FROM sessions ORDER BY id);"
    case ObserveFile{id,worker,path}: ""
    case MessageFile{id,sender,recipient,kind,path}: ""
    case ReportFile{id,sender,path}: ""
    case RunTurn{worker,id,cmd,model,effort,cwd,task,log,session}: ""
    case Invalid{}: ""

def parse(args: List<String>) -> Command:
  match args:
    case +verb <> Nil{}:
      Bool.pick(Command, String.eq(verb,"status"),Status{},
      Bool.pick(Command, String.eq(verb,"pending"),Pending{},Invalid{}))
    case +verb <> +id <> Nil{}:
      Bool.pick(Command, String.eq(verb,"inbox"),Inbox{id},
      Bool.pick(Command, String.eq(verb,"session"),Session{id},
      Bool.pick(Command, String.eq(verb,"delivery"),Delivery{id},Invalid{})))
    case +verb <> +id <> +one <> +two <> Nil{}:
      Bool.pick(Command, String.eq(verb,"report"),Report{id,one,two},
      Bool.pick(Command, String.eq(verb,"ack"),Ack{id,one,two},
      Bool.pick(Command, String.eq(verb,"report-file"),ReportFile{id,one,two},
      Bool.pick(Command, String.eq(verb,"observe"),Observe{id,one,two},
      Bool.pick(Command, String.eq(verb,"observe-file"),ObserveFile{id,one,two},
      Bool.pick(Command, String.eq(verb,"connect"),Connect{id,one,two},Invalid{}))))))
    case +verb <> +id <> +one <> +two <> +three <> Nil{}:
      Bool.pick(Command, String.eq(verb,"attach"),Attach{id,one,two,three},Invalid{})
    case +verb <> +id <> +one <> +two <> +three <> +four <> Nil{}:
      Bool.pick(Command, String.eq(verb,"bind"),Bind{id,one,two,three,four},
      Bool.pick(Command, String.eq(verb,"message"),Message{id,one,two,three,four},
      Bool.pick(Command, String.eq(verb,"message-file"),MessageFile{id,one,two,three,four},Invalid{})))
    case +verb <> id <> parent <> harness <> model <> effort <> workspace <> branch <> base <> Nil{}:
      Bool.pick(Command, String.eq(verb,"worker"),Worker{id,parent,harness,model,effort,workspace,branch,base},Invalid{})
    case +verb <> worker <> id <> cmd <> model <> effort <> cwd <> task <> log <> session <> Nil{}:
      Bool.pick(Command,String.eq(verb,"turn"),RunTurn{worker,id,cmd,model,effort,cwd,task,log,session},Invalid{})
    case _: Invalid{}
