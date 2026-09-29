import Base

type Command is Data:
  Recruit{id: String, parent: String, harness: String, model: String, effort: String, repo: String, branch: String, path: String, base: String}
  Worktree{id: String}
  Receive{session: String, cmd: String, model: String, effort: String, cwd: String, log: String, message: String}
  Stop{session: String, id: String, reason: String}
  ForceStop{session: String, id: String}
  RunTurn{worker: String, id: String, cmd: String, model: String, effort: String, cwd: String, task: String, log: String, session: String}
  Attach{id: String, harness: String, native: String, endpoint: String}
  Worker{id: String, parent: String, harness: String, model: String, effort: String, workspace: String, branch: String, base: String}
  Connect{id: String, native: String, endpoint: String}
  Bind{id: String, native: String, harness: String, model: String, effort: String}
  Message{id: String, sender: String, recipient: String, kind: String, body: String}
  MessageFile{id: String, sender: String, recipient: String, kind: String, path: String}
  Observe{id: String, worker: String, event: String}
  ObserveFile{id: String, worker: String, path: String}
  Report{id: String, sender: String, body: String}
  Ask{id: String, worker: String, body: String}
  AskFile{id: String, worker: String, path: String}
  NativeReply{parent: String, id: String, response: String}
  NativeReplyFile{parent: String, id: String, path: String}
  Ack{id: String, recipient: String, receipt: String}
  Session{id: String}
  Delivery{id: String}
  Pending{}
  Inbox{id: String}
  Land{worker: String, repo: String, target: String}
  LandChecked{worker: String, repo: String, target: String, check: String, files: String}
  Push{repo: String, branch: String, remote: String}
  Status{}
  Workers{}
  Turns{id: String}
  Invalid{}

def escape_char(+head: Char, tail: String, quote: Bool) -> String:
  match quote:
    case True{}: SCon{head,SCon{head,tail}}
    case False{}: SCon{head,tail}

def escaped(s: String) -> String:
  match s:
    case SNil{}: ""
    case SCon{+h, tail}:
      escape_char(h,escaped(tail),Char.is_eq(h,Char.from_u32(39)))

def q(s: String) -> String:
  "'" ++ escaped(s) ++ "'"

def schema() -> String:
  "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY NOT NULL, parent TEXT REFERENCES sessions(id), harness TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', effort TEXT NOT NULL DEFAULT '', native TEXT NOT NULL DEFAULT '', observed_harness TEXT NOT NULL DEFAULT '', observed_model TEXT NOT NULL DEFAULT '', observed_effort TEXT NOT NULL DEFAULT '', endpoint TEXT NOT NULL DEFAULT '', workspace TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '', base TEXT NOT NULL DEFAULT '');"
  ++ "CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, sender TEXT NOT NULL REFERENCES sessions(id), recipient TEXT NOT NULL REFERENCES sessions(id), kind TEXT NOT NULL, body TEXT NOT NULL, receipt TEXT);"
  ++ "CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY NOT NULL REFERENCES messages(id), worker TEXT NOT NULL REFERENCES sessions(id), event TEXT NOT NULL);"
  ++ "CREATE TABLE IF NOT EXISTS executions (session TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id), id TEXT NOT NULL, mode TEXT NOT NULL, directory TEXT NOT NULL, phase TEXT NOT NULL, status TEXT NOT NULL DEFAULT '');"
  ++ "CREATE TABLE IF NOT EXISTS session_stops (session TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id), id TEXT UNIQUE NOT NULL, reason TEXT NOT NULL, attempt TEXT NOT NULL DEFAULT '', directory TEXT NOT NULL DEFAULT '', signal INTEGER NOT NULL DEFAULT 15, applied_signal INTEGER NOT NULL DEFAULT 0, control_error TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL, native_status TEXT NOT NULL DEFAULT '', report_id TEXT NOT NULL DEFAULT '');"

def stopped_session_sql(session: String) -> String:
  "EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ session ++ ")"

def execution_input_sql(kind: String) -> String:
  kind ++ " IN ('task','guidance','recovery')"

def input_state_sql(+row: String) -> String:
  "CASE WHEN " ++ stopped_session_sql(row ++ ".recipient") ++ " THEN json_object('stopId',(SELECT id FROM session_stops WHERE session=" ++ row ++ ".recipient),'executionDisposition',CASE WHEN " ++ row ++ ".receipt IS NOT NULL THEN 'accepted' WHEN " ++ execution_input_sql(row ++ ".kind") ++ " THEN 'stopped' ELSE 'retained-for-stopped-session' END) ELSE json('{}') END"

def session_state_sql(session: String) -> String:
  "coalesce((SELECT json_object('stop',json_object('id',id,'reason',reason,'status',outcome,'attempt',nullif(attempt,''),'requestedSignal',signal,'submittedSignal',nullif(applied_signal,0),'controlError',nullif(control_error,''),'nativeStatus',nullif(native_status,''),'reportId',nullif(report_id,''))) FROM session_stops WHERE session=" ++ session ++ "),json('{}'))"

def session_result(id: String) -> String:
  "SELECT json_patch(json_object('id',id,'parent',parent,'harness',harness,'model',model,'effort',effort,'native',native,'observedHarness',observed_harness,'observedModel',observed_model,'observedEffort',observed_effort,'endpoint',endpoint,'workspace',workspace,'branch',branch,'base',base)," ++ session_state_sql("sessions.id") ++ ") FROM sessions WHERE id=" ++ q(id) ++ ";"

def message_result(id: String) -> String:
  "SELECT json_patch(json_object('id',id,'sender',sender,'recipient',recipient,'kind',kind,'body',body,'receipt',receipt)," ++ input_state_sql("messages") ++ ") FROM messages WHERE id=" ++ q(id) ++ ";"

# A repeated ID returns its first result. Reusing it for different input fails the transaction.
def message_upsert() -> String:
  " ON CONFLICT(id) DO UPDATE SET id=CASE WHEN messages.sender=excluded.sender AND messages.recipient=excluded.recipient AND messages.kind=excluded.kind AND messages.body=excluded.body THEN messages.id ELSE NULL END;"

def delivery_row() -> String:
  "json_patch(json_object('id',m.id,'sender',m.sender,'recipient',m.recipient,'kind',m.kind,'body',m.body,'receipt',m.receipt,'harness',s.harness,'native',s.native,'endpoint',s.endpoint)," ++ input_state_sql("m") ++ ")"

def terminal(+event: String) -> String:
  "(json_extract(" ++ q(event) ++ ",'$.payload.kind')='run_terminal' OR json_extract(" ++ q(event) ++ ",'$.type')='result' OR (json_extract(" ++ q(event) ++ ",'$.type')='agent_end' AND coalesce(json_extract(" ++ q(event) ++ ",'$.isTerminal'),1)=1))"

def observe_sql(+id: String, +worker: String, +event: String) -> String:
  "UPDATE sessions SET native=coalesce(CASE WHEN json_extract(" ++ q(event) ++ ",'$.type')='response' AND json_extract(" ++ q(event) ++ ",'$.command')='get_state' AND json_extract(" ++ q(event) ++ ",'$.success')=1 THEN json_extract(" ++ q(event) ++ ",'$.data.sessionId') END,CASE WHEN json_extract(" ++ q(event) ++ ",'$.type')='thread.started' THEN json_extract(" ++ q(event) ++ ",'$.thread_id') END,json_extract(" ++ q(event) ++ ",'$.session_id'),CASE WHEN json_extract(" ++ q(event) ++ ",'$.type')='session' THEN json_extract(" ++ q(event) ++ ",'$.id') END,CASE WHEN json_extract(" ++ q(event) ++ ",'$.stream.kind')='session' THEN json_extract(" ++ q(event) ++ ",'$.stream.id') END,native),observed_model=coalesce(CASE WHEN json_extract(" ++ q(event) ++ ",'$.type')='response' AND json_extract(" ++ q(event) ++ ",'$.command')='get_state' AND json_extract(" ++ q(event) ++ ",'$.success')=1 THEN json_extract(" ++ q(event) ++ ",'$.data.model.provider') || '/' || json_extract(" ++ q(event) ++ ",'$.data.model.id') END,CASE WHEN json_extract(" ++ q(event) ++ ",'$.payload_type')='run.model.configured' THEN json_extract(" ++ q(event) ++ ",'$.payload.model_id') END,CASE WHEN json_extract(" ++ q(event) ++ ",'$.message.provider') IS NOT NULL AND json_extract(" ++ q(event) ++ ",'$.message.model') IS NOT NULL THEN json_extract(" ++ q(event) ++ ",'$.message.provider') || '/' || json_extract(" ++ q(event) ++ ",'$.message.model') END,json_extract(" ++ q(event) ++ ",'$.message.model'),json_extract(" ++ q(event) ++ ",'$.model'),observed_model) WHERE id=" ++ q(worker) ++ ";"
  ++ "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ q(id) ++ ",id,parent,'report',CASE WHEN json_extract(" ++ q(event) ++ ",'$.is_error')=1 OR (json_extract(" ++ q(event) ++ ",'$.payload.kind')='run_terminal' AND json_extract(" ++ q(event) ++ ",'$.payload.terminal')<>'completed') THEN " ++ q(event) ++ " ELSE coalesce(json_extract(" ++ q(event) ++ ",'$.result'),CASE WHEN json_extract(" ++ q(event) ++ ",'$.payload.kind')='run_terminal' THEN json_extract(" ++ q(event) ++ ",'$.payload.text') END,(SELECT group_concat(json_extract(c.value,'$.text'),char(10)) FROM json_each((SELECT m.value FROM json_each(" ++ q(event) ++ ",'$.messages') m WHERE json_extract(m.value,'$.role')='assistant' ORDER BY m.key DESC LIMIT 1),'$.content') c WHERE json_extract(c.value,'$.type')='text')," ++ q(event) ++ ") END FROM sessions WHERE id=" ++ q(worker) ++ " AND parent IS NOT NULL AND " ++ terminal(event) ++ message_upsert()
  ++ "INSERT INTO turns(id,worker,event) SELECT " ++ q(id) ++ "," ++ q(worker) ++ "," ++ q(event) ++ " WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ q(worker) ++ " AND parent IS NOT NULL) AND " ++ terminal(event) ++ " ON CONFLICT(id) DO UPDATE SET id=CASE WHEN turns.worker=excluded.worker AND turns.event=excluded.event THEN turns.id ELSE NULL END;"
  ++ "SELECT json_object('worker',id,'native',native,'eventType',coalesce(json_extract(" ++ q(event) ++ ",'$.type'),json_extract(" ++ q(event) ++ ",'$.payload_type')),'reportId',CASE WHEN parent IS NOT NULL AND " ++ terminal(event) ++ " THEN " ++ q(id) ++ " ELSE NULL END) FROM sessions WHERE id=" ++ q(worker) ++ ";"

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
    case Message{+id, sender, +recipient, +kind, body}:
      "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ q(id) ++ "," ++ q(sender) ++ "," ++ q(recipient) ++ "," ++ q(kind) ++ "," ++ q(body) ++ " WHERE NOT (" ++ stopped_session_sql(q(recipient)) ++ " AND " ++ execution_input_sql(q(kind)) ++ ") OR EXISTS(SELECT 1 FROM messages WHERE id=" ++ q(id) ++ ")" ++ message_upsert()
      ++ "SELECT json_object('error','session-stopped','session'," ++ q(recipient) ++ ") WHERE NOT EXISTS(SELECT 1 FROM messages WHERE id=" ++ q(id) ++ ") AND " ++ stopped_session_sql(q(recipient)) ++ " AND " ++ execution_input_sql(q(kind)) ++ ";" ++ message_result(id)
    case Report{+id, +sender, body}:
      "INSERT INTO messages(id,sender,recipient,kind,body) VALUES(" ++ q(id) ++ "," ++ q(sender) ++ ",(SELECT parent FROM sessions WHERE id=" ++ q(sender) ++ "),'report'," ++ q(body) ++ ")" ++ message_upsert() ++ message_result(id)
    case Ask{+id, +worker, body}:
      "INSERT INTO messages(id,sender,recipient,kind,body) VALUES(" ++ q(id) ++ "," ++ q(worker) ++ ",(SELECT parent FROM sessions WHERE id=" ++ q(worker) ++ "),'question'," ++ q(body) ++ ")" ++ message_upsert() ++ message_result(id)
    case Ack{+id, +recipient, receipt}:
      "UPDATE messages SET receipt=coalesce(receipt," ++ q(receipt) ++ ") WHERE id=" ++ q(id) ++ " AND recipient=" ++ q(recipient) ++ ";SELECT json_object('id',id,'receipt',receipt) FROM messages WHERE id=" ++ q(id) ++ " AND recipient=" ++ q(recipient) ++ ";"
    case Session{id}: session_result(id)
    case Delivery{id}:
      "SELECT " ++ delivery_row() ++ " FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.id=" ++ q(id) ++ ";"
    case Pending{}:
      "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ delivery_row() ++ " AS item FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.receipt IS NULL ORDER BY m.seq);"
    case Inbox{id}:
      "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_patch(json_object('id',id,'sender',sender,'recipient',recipient,'kind',kind,'body',body)," ++ input_state_sql("messages") ++ ") AS item FROM messages WHERE recipient=" ++ q(id) ++ " AND receipt IS NULL ORDER BY seq);"
    case Status{}:
      "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_patch(json_object('id',id,'parent',parent,'harness',harness,'model',model,'effort',effort,'native',native,'observedHarness',observed_harness,'observedModel',observed_model,'observedEffort',observed_effort,'endpoint',endpoint,'workspace',workspace,'branch',branch,'base',base,'pending',(SELECT count(*) FROM messages WHERE recipient=sessions.id AND receipt IS NULL AND NOT (" ++ stopped_session_sql("sessions.id") ++ " AND " ++ execution_input_sql("messages.kind") ++ ")))," ++ session_state_sql("sessions.id") ++ ") AS item FROM sessions ORDER BY id);"
    case Workers{}:
      "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_patch(json_object('id',s.id,'parent',s.parent,'harness',s.harness,'model',s.model,'effort',s.effort,'workspace',s.workspace,'branch',s.branch,'base',s.base,'native',s.native,'lastTurnId',(SELECT t.id FROM turns t WHERE t.worker=s.id ORDER BY rowid DESC LIMIT 1),'lastTurnEvent',(SELECT coalesce(json_extract(t.event,'$.type'),json_extract(t.event,'$.payload_type')) FROM turns t WHERE t.worker=s.id ORDER BY rowid DESC LIMIT 1),'latestReport',(SELECT m.body FROM messages m WHERE m.sender=s.id AND m.kind='report' ORDER BY m.seq DESC LIMIT 1),'latestReportId',(SELECT m.id FROM messages m WHERE m.sender=s.id AND m.kind='report' ORDER BY m.seq DESC LIMIT 1),'pendingCount',(SELECT count(*) FROM messages WHERE recipient=s.id AND receipt IS NULL AND NOT (" ++ stopped_session_sql("s.id") ++ " AND " ++ execution_input_sql("messages.kind") ++ ")))," ++ session_state_sql("s.id") ++ ") AS item FROM sessions s WHERE s.parent IS NOT NULL ORDER BY s.id);"
    case Turns{id}:
      "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_object('id',t.id,'worker',t.worker,'eventType',coalesce(json_extract(t.event,'$.type'),json_extract(t.event,'$.payload_type')),'reportBody',m.body,'receipt',m.receipt) AS item FROM turns t JOIN messages m ON m.id=t.id WHERE t.worker=" ++ q(id) ++ " ORDER BY m.seq);"
    case ObserveFile{id,worker,path}: ""
    case MessageFile{id,sender,recipient,kind,path}: ""
    case AskFile{id,worker,path}: ""
    case NativeReply{parent,id,response}: ""
    case NativeReplyFile{parent,id,path}: ""
    case Stop{session,id,reason}: ""
    case ForceStop{session,id}: ""
    case RunTurn{worker,id,cmd,model,effort,cwd,task,log,session}: ""
    case Receive{session,cmd,model,effort,cwd,log,message}: ""
    case Land{worker,repo,target}: ""
    case LandChecked{worker,repo,target,check,files}: ""
    case Push{repo,branch,remote}: ""
    case Recruit{id,parent,harness,model,effort,repo,branch,path,base}: ""
    case Worktree{id}: ""
    case Invalid{}: ""

def parse(args: List<String>) -> Command:
  match args:
    case +verb <> Nil{}:
      Bool.pick(Command, String.eq(verb,"status"),Status{},
      Bool.pick(Command, String.eq(verb,"workers"),Workers{},
      Bool.pick(Command, String.eq(verb,"pending"),Pending{},Invalid{})))
    case +verb <> +id <> Nil{}:
      Bool.pick(Command, String.eq(verb,"inbox"),Inbox{id},
      Bool.pick(Command, String.eq(verb,"session"),Session{id},
      Bool.pick(Command, String.eq(verb,"delivery"),Delivery{id},
      Bool.pick(Command, String.eq(verb,"worktree"),Worktree{id},
      Bool.pick(Command, String.eq(verb,"turns"),Turns{id},Invalid{})))))
    case +verb <> session <> id <> Nil{}:
      Bool.pick(Command,String.eq(verb,"force-stop"),ForceStop{session,id},Invalid{})
    case +verb <> +id <> +one <> +two <> Nil{}:
      Bool.pick(Command, String.eq(verb,"native-reply"),NativeReply{id,one,two},
      Bool.pick(Command, String.eq(verb,"native-reply-file"),NativeReplyFile{id,one,two},
      Bool.pick(Command, String.eq(verb,"stop"),Stop{id,one,two},
      Bool.pick(Command, String.eq(verb,"report"),Report{id,one,two},
      Bool.pick(Command, String.eq(verb,"ack"),Ack{id,one,two},
      Bool.pick(Command, String.eq(verb,"observe-file"),ObserveFile{id,one,two},
      Bool.pick(Command, String.eq(verb,"connect"),Connect{id,one,two},
      Bool.pick(Command, String.eq(verb,"land"),Land{id,one,two},
      Bool.pick(Command, String.eq(verb,"push"),Push{id,one,two},
      Bool.pick(Command, String.eq(verb,"ask"),Ask{id,one,two},
      Bool.pick(Command, String.eq(verb,"ask-file"),AskFile{id,one,two},Invalid{})))))))))))
    case +verb <> +id <> +one <> +two <> +three <> Nil{}:
      Bool.pick(Command, String.eq(verb,"attach"),Attach{id,one,two,three},Invalid{})
    case +verb <> +id <> +one <> +two <> +three <> +four <> Nil{}:
      Bool.pick(Command, String.eq(verb,"land-checked"),LandChecked{id,one,two,three,four},
      Bool.pick(Command, String.eq(verb,"bind"),Bind{id,one,two,three,four},
      Bool.pick(Command, String.eq(verb,"message"),Message{id,one,two,three,four},
      Bool.pick(Command, String.eq(verb,"message-file"),MessageFile{id,one,two,three,four},Invalid{}))))
    case +verb <> session <> cmd <> model <> effort <> cwd <> log <> message <> Nil{}:
      Bool.pick(Command,String.eq(verb,"receive"),Receive{session,cmd,model,effort,cwd,log,message},Invalid{})
    case +verb <> +worker <> +id <> +cmd <> +model <> +effort <> +cwd <> +task <> +log <> +session <> Nil{}:
      Bool.pick(Command,String.eq(verb,"turn"),RunTurn{worker,id,cmd,model,effort,cwd,task,log,session},
      Bool.pick(Command,String.eq(verb,"recruit"),Recruit{worker,id,cmd,model,effort,cwd,task,log,session},Invalid{}))
    case _: Invalid{}
