import Base
import ../git/text.bend as Tx
import ./agent-domain.bend as Domain

type Body is Data:
  Missing{}
  Text{value: String}
  File{path: String}
  Bad{cause: String}

type Message is Data:
  Item{recipient: String, id: String, kind: String, body: Body}

type Action is Type:
  Inbox{}
  Read{ids: List<String>}
  Send{items: List<&2,Message>}
  CompletionRequest{id: String, body: Body}
  CompletionConfirmed{recipient: String, request: String, id: String}
  Session{id: String}
  Player{id: String}
  Players{}
  Assignment{id: String}
  Native{items: List<&2,Domain.Operation>}
  Repl{args: List<String>}
  Help{action: String}
  Invalid{cause: String}

type Verb is Data:
  ReadVerb{}
  SendVerb{}
  SessionVerb{}
  PlayerVerb{}
  AssignmentVerb{}
  CompletionRequestVerb{}
  CompletionConfirmedVerb{}
  GuideVerb{}
  UnknownVerb{}

def reverse_ids(ids: List<String>, tail: List<String>) -> List<String>:
  match ids:
    case Nil{}: tail
    case id <> rest: reverse_ids(rest,Con{id,tail})

def reverse_items(items: List<&2,Message>, tail: List<&2,Message>) -> List<&2,Message>:
  match items:
    case Nil{}: tail
    case item <> rest: reverse_items(rest,Con{item,tail})

def body_option(body: Body, value: Body) -> Body:
  match body:
    case Missing{}: value
    case Bad{cause}: Bad{cause}
    case other: Bad{"send accepts exactly one --text TEXT or --file PATH per message."}

def send_done(+recipient: String, id: String, +kind: String, body: Body,
              items: List<&2,Message>) -> Action:
  match body:
    case Missing{}: Invalid{"send requires --text TEXT or --file PATH."}
    case Bad{cause}: Invalid{cause}
    case value:
      Bool.pick(Action,Bool.or(String.is_empty(recipient),String.is_empty(kind)),
        Invalid{"send requires a recipient and --kind KIND for each message."},
        Send{reverse_items(Con{Item{recipient,id,kind,value},items},Nil{})})

def send_options(args: List<String>, +recipient: String, +id: String,
                 +kind: String, body: Body, items: List<&2,Message>) -> Action:
  match args:
    case "--id" <> +value <> rest:
      Bool.pick(Action,Bool.or(Bool.not(String.is_empty(id)),String.is_empty(value)),
        Invalid{"send accepts one nonempty --id ID per message."},
        send_options(rest,recipient,value,kind,body,items))
    case "--kind" <> +value <> rest:
      Bool.pick(Action,Bool.or(Bool.not(String.is_empty(kind)),String.is_empty(value)),
        Invalid{"send accepts one nonempty --kind KIND per message."},
        send_options(rest,recipient,id,value,body,items))
    case "--text" <> value <> rest:
      send_options(rest,recipient,id,kind,body_option(body,Text{value}),items)
    case "--file" <> path <> rest:
      send_options(rest,recipient,id,kind,body_option(body,File{path}),items)
    case "and" <> target <> rest:
      match body:
        case Missing{}: Invalid{"send requires --text TEXT or --file PATH."}
        case Bad{cause}: Invalid{cause}
        case value:
          Bool.pick(Action,Bool.or(String.is_empty(recipient),String.is_empty(kind)),
            Invalid{"send requires a recipient and --kind KIND for each message."},
            send_options(rest,target,"","",Missing{},Con{Item{recipient,id,kind,value},items}))
    case "and" <> Nil{}: Invalid{"send requires a recipient after and."}
    case "--and" <> target <> rest:
      match body:
        case Missing{}: Invalid{"send requires --text TEXT or --file PATH."}
        case Bad{cause}: Invalid{cause}
        case value:
          Bool.pick(Action,Bool.or(String.is_empty(recipient),String.is_empty(kind)),
            Invalid{"send requires a recipient and --kind KIND for each message."},
            send_options(rest,target,"","",Missing{},Con{Item{recipient,id,kind,value},items}))
    case "--and" <> Nil{}: Invalid{"send requires a recipient after --and."}
    case Nil{}: send_done(recipient,id,kind,body,items)
    case other: Invalid{"send expects --kind KIND, --text TEXT or --file PATH, optional --id ID, and optional and RECIPIENT."}


def read_ids(args: List<String>, ids: List<String>) -> Action:
  match args:
    case Nil{}:
      match ids:
        case Nil{}: Invalid{"read requires one or more message IDs."}
        case collected: Read{reverse_ids(collected,Nil{})}
    case +id <> rest:
      Bool.pick(Action,Bool.or(String.is_empty(id),Tx.starts_with(id,"--")),
        Invalid{"read expects message IDs; use read --help for usage."},
        read_ids(rest,Con{id,ids}))

def completion_request_options(args: List<String>, +id: String, body: Body) -> Action:
  match args:
    case "--id" <> +value <> rest:
      Bool.pick(Action,Bool.or(Bool.not(String.is_empty(id)),String.is_empty(value)),
        Invalid{"completion-request accepts one nonempty --id ID."},
        completion_request_options(rest,value,body))
    case "--text" <> value <> rest:
      completion_request_options(rest,id,body_option(body,Text{value}))
    case "--file" <> path <> rest:
      completion_request_options(rest,id,body_option(body,File{path}))
    case Nil{}:
      match body:
        case Missing{}: Invalid{"completion-request requires --text TEXT or --file PATH."}
        case Bad{cause}: Invalid{cause}
        case value: CompletionRequest{id,value}
    case other: Invalid{"completion-request accepts --text TEXT or --file PATH and optional --id ID; use help completion-request."}

def inspect_id(action: String, args: List<String>) -> Action:
  match args:
    case Nil{}: Bool.pick(Action,String.eq(action,"session"),Session{""},Assignment{""})
    case +id <> Nil{}:
      Bool.pick(Action,String.is_empty(id),Invalid{"inspection expects a nonempty session ID."},
        Bool.pick(Action,String.eq(action,"session"),Session{id},Assignment{id}))
    case other: Invalid{"inspection accepts at most one session ID; use help ACTION for usage."}

def decision_options(+action: String, kind: String, +recipient: String,
                     +id: String, body: Body) -> Action:
  match body:
    case Missing{}: Invalid{action ++ " requires --text TEXT or --file PATH."}
    case Bad{cause}: Invalid{cause}
    case value:
      Bool.pick(Action,String.is_empty(recipient),
        Invalid{action ++ " requires --to SESSION."},
        Send{Con{Item{recipient,id,kind,value},Nil{}}})

def decision_args(+action: String, +kind: String, args: List<String>,
                  +recipient: String, +request: String, +id: String, body: Body) -> Action:
  match args:
    case "--to" <> +value <> rest:
      Bool.pick(Action,Bool.or(Bool.not(String.is_empty(recipient)),String.is_empty(value)),
        Invalid{action ++ " accepts one nonempty --to SESSION."},
        decision_args(action,kind,rest,value,request,id,body))
    case "--request" <> +value <> rest:
      Bool.pick(Action,Bool.or(Bool.not(String.eq(action,"completion-confirmed")),
                               Bool.or(Bool.not(String.is_empty(request)),String.is_empty(value))),
        Invalid{"--request is accepted once with a nonempty ID by completion-confirmed."},
        decision_args(action,kind,rest,recipient,value,id,body))
    case "--id" <> +value <> rest:
      Bool.pick(Action,Bool.or(Bool.not(String.is_empty(id)),String.is_empty(value)),
        Invalid{action ++ " accepts one nonempty --id ID."},
        decision_args(action,kind,rest,recipient,request,value,body))
    case "--text" <> value <> rest:
      Bool.pick(Action,String.eq(action,"completion-confirmed"),
        Invalid{"completion-confirmed body is the request ID."},
        decision_args(action,kind,rest,recipient,request,id,body_option(body,Text{value})))
    case "--file" <> path <> rest:
      Bool.pick(Action,String.eq(action,"completion-confirmed"),
        Invalid{"completion-confirmed body is the request ID."},
        decision_args(action,kind,rest,recipient,request,id,body_option(body,File{path})))
    case Nil{}:
      decision_options(action,kind,recipient,id,body)
    case other:
      Invalid{action ++ " expects --to SESSION and its documented named arguments; use help " ++ action ++ "."}

def confirmation_args(args: List<String>, +recipient: String, +request: String,
                      +id: String) -> Action:
  match args:
    case "--to" <> +value <> rest:
      Bool.pick(Action,Bool.or(Bool.not(String.is_empty(recipient)),String.is_empty(value)),
        Invalid{"completion-confirmed accepts one nonempty --to PLAYER."},
        confirmation_args(rest,value,request,id))
    case "--request" <> +value <> rest:
      Bool.pick(Action,Bool.or(Bool.not(String.is_empty(request)),String.is_empty(value)),
        Invalid{"completion-confirmed requires one nonempty --request REQUEST_ID."},
        confirmation_args(rest,recipient,value,id))
    case "--id" <> +value <> rest:
      Bool.pick(Action,Bool.or(Bool.not(String.is_empty(id)),String.is_empty(value)),
        Invalid{"completion-confirmed accepts one nonempty --id ID."},
        confirmation_args(rest,recipient,request,value))
    case Nil{}: CompletionConfirmed{recipient,request,id}
    case other:
      Invalid{"completion-confirmed accepts --request REQUEST_ID, optional --to PLAYER, and optional --id ID."}

def player_args(args: List<String>) -> Action:
  match args:
    case +id <> Nil{}:
      Bool.pick(Action,String.is_empty(id),Invalid{"player requires a nonempty session ID."},Player{id})
    case other: Invalid{"player requires exactly one session ID; use help player for usage."}

def parse_action(action: Verb, args: List<String>) -> Action:
  match action:
    case ReadVerb{}: read_ids(args,Nil{})
    case SendVerb{}:
      match args:
        case recipient <> rest: send_options(rest,recipient,"","",Missing{},Nil{})
        case Nil{}: Invalid{"Choose inbox, read, session, player, players, assignment, send, completion-request, completion-confirmed or guide; use help ACTION for usage."}
    case SessionVerb{}: inspect_id("session",args)
    case PlayerVerb{}: player_args(args)
    case AssignmentVerb{}: inspect_id("assignment",args)
    case CompletionRequestVerb{}: completion_request_options(args,"",Missing{})
    case CompletionConfirmedVerb{}: confirmation_args(args,"","","")
    case GuideVerb{}: decision_args("guide","guidance",args,"","","",Missing{})
    case UnknownVerb{}: Invalid{"Choose inbox, read, session, player, players, assignment, send, completion-request, completion-confirmed or guide; use help ACTION for usage."}

def classify_verb(+verb: String) -> Verb:
  Bool.pick(Verb,String.eq(verb,"read"),ReadVerb{},
    Bool.pick(Verb,String.eq(verb,"send"),SendVerb{},
      Bool.pick(Verb,String.eq(verb,"session"),SessionVerb{},
        Bool.pick(Verb,String.eq(verb,"player"),PlayerVerb{},
          Bool.pick(Verb,String.eq(verb,"assignment"),AssignmentVerb{},
            Bool.pick(Verb,String.eq(verb,"completion-request"),CompletionRequestVerb{},
              Bool.pick(Verb,String.eq(verb,"completion-confirmed"),CompletionConfirmedVerb{},
                Bool.pick(Verb,String.eq(verb,"guide"),GuideVerb{},UnknownVerb{}))))))))

def domain_action(parsed: Domain.Parsed) -> Action:
  match parsed:
    case Domain.Calls{items}: Native{items}
    case Domain.Error{cause}: Invalid{cause}

def batch_tokens(args: List<&2,String>, value: Bool) -> Bool:
  match args:
    case Nil{}: False{}
    case +head <> rest:
      match value:
        case True{}: batch_tokens(rest,False{})
        case False{}:
          Bool.or(Domain.member(head,["and","--and"]),
            batch_tokens(rest,Bool.and(Tx.starts_with(head,"--"),
              Bool.not(Domain.member(head,["--lift-stop","--index","--recursive","--pretty"])))))

def named_inspection(args: List<&2,String>) -> Bool:
  match args:
    case head <> rest: Domain.member(head,["--session","--id","--pretty"])
    case Nil{}: False{}

def inspection_single(args: List<&2,String>) -> Bool:
  match args:
    case Nil{}: True{}
    case id <> Nil{}: True{}
    case other: False{}

def original_form(+verb: String, +args: List<&2,String>) -> Bool:
  Bool.and(Domain.member(verb,["session","player","players","assignment","completion-request","completion-confirmed","guide"]),
    Bool.or(Bool.and(Domain.member(verb,["session","player","assignment"]),
      Bool.and(inspection_single(args),Bool.not(named_inspection(args)))),
      Bool.and(Bool.not(batch_tokens(args,False{})),
        Bool.not(Bool.and(Domain.member(verb,["session","player","players","assignment"]),named_inspection(args))))))

def parse_verb_selected(selected: Bool, verb: String, args: List<&2,String>) -> Action:
  match selected:
    case True{}: domain_action(Domain.parse(Con{verb,Domain.affine_strings(args)}))
    case False{}: parse_action(classify_verb(verb),Domain.affine_strings(args))

def parse_verb_shared(+verb: String, +args: List<&2,String>) -> Action:
  Bool.pick(Action,String.eq(verb,"repl"),Repl{Domain.affine_strings(args)},
    parse_verb_selected(Bool.and(Domain.known(verb),Bool.not(original_form(verb,args))),verb,args))

def parse_verb(verb: String, args: List<String>) -> Action:
  parse_verb_shared(verb,Domain.shared_strings(args))

def parse_one(+verb: String) -> Action:
  Bool.pick(Action,Bool.or(String.eq(verb,"help"),Bool.or(String.eq(verb,"--help"),String.eq(verb,"-h"))),
    Help{""},Bool.pick(Action,String.eq(verb,"inbox"),Inbox{},
      Bool.pick(Action,String.eq(verb,"players"),Players{},parse_verb(verb,Nil{}))))

def parse_two(+verb: String, arg: String, help: Bool) -> Action:
  match help:
    case True{}: Bool.pick(Action,String.eq(verb,"help"),Help{arg},Help{verb})
    case False{}: parse_verb(verb,Con{arg,Nil{}})

def compound_help(+verb: String, +sub: String, args: List<String>, help: Bool) -> Action:
  match help:
    case True{}: Help{Domain.subverb(verb,sub)}
    case False{}: parse_verb(verb,Con{sub,args})

def parse_args(+verb: String, args: List<String>) -> Action:
  match args:
    case Nil{}: parse_one(verb)
    case +arg <> Nil{}:
      parse_two(verb,arg,Bool.or(String.eq(verb,"help"),Bool.or(String.eq(arg,"--help"),String.eq(arg,"-h"))))
    case +sub <> +flag <> Nil{}:
      compound_help(verb,sub,Con{flag,Nil{}},Bool.and(Bool.not(String.is_empty(Domain.subverb(verb,sub))),Bool.or(String.eq(flag,"--help"),String.eq(flag,"-h"))))
    case arg <> rest: parse_verb(verb,Con{arg,rest})

def parse(args: List<String>) -> Action:
  match args:
    case Nil{}: Invalid{"Choose inbox, read, session, player, players, assignment, send, completion-request, completion-confirmed or guide; use help ACTION for usage."}
    case +verb <> rest: parse_args(verb,rest)

def help(action: String) -> String:
  match action:
    case "inbox": "inbox\nRead every pending message for the current agent with complete bodies. Pending means delivered but not yet read.\n"
    case "read": "read ID...\nRead complete stored messages in argument order; the read is recorded as a real read event. Already read messages remain readable.\n"
    case "session": "session [SESSION]\nRead the complete registered session record. Omitted SESSION selects the current agent.\n" ++ Domain.help("session")
    case "player": "player SESSION\nRead the complete registered Player record.\n" ++ Domain.help("player")
    case "players": "players\nRead the current Players projection.\n" ++ Domain.help("players")
    case "assignment": "assignment [SESSION]\nRead the registered session record, including its assignment and task-completion state. Omitted SESSION selects the current agent.\n" ++ Domain.help("assignment")
    case "completion-request": "completion-request (--text TEXT | --file PATH) [--id ID]\nSend the request to the current session's recorded immediate parent. The message body carries the completion report. A parentless session receives a structured refusal. Each mixed --and item retains its actual process result and complete admission result in stdout.\n"
    case "completion-confirmed": "completion-confirmed [--to PLAYER] [--request REQUEST_ID] [--id ID]\nResolve the selected Player's current completion request. Omitted --to selects the sole current request addressed to this coordinator. Baton generates the action identity and links the exact retained request. Explicit selectors retain their native authority checks. Supports mixed and or --and batches.\n"
    case "guide": "guide --to PLAYER (--text TEXT | --file PATH) [--id ID]\nSend guidance to a Player through the ordinary message admission path. Supports mixed and or --and batches.\n"
    case "send": "send RECIPIENT --kind KIND (--text TEXT | --file PATH) [--id ID] [and RECIPIENT ...]\nEach clause supplies its own recipient, kind, body and optional ID. Omitted IDs are generated and returned. Explicit IDs retain existing exact-retry behavior. Each message reports admission, wake and receipt. PATH - reads stdin.\n"
    case +other:
      +domain = Domain.help(other)
      Bool.pick(String,String.is_empty(domain),"usage: baton ACTION ARGS\n       baton --project PATH ACTION ARGS\n       baton as SESSION ACTION ARGS\n       baton DATABASE as SESSION ACTION ARGS\nActions: inbox, read, session, player, players, assignment, send, completion-request, completion-confirmed, guide, status, pending, orchestra, role, ensemble, ensemble-member, section, section-member, attempt, attempts, outbox, receiver, configure, resume, stop, force-stop, recover-observer, continue-task, turn, receive, profile-bind, connect, bind, report, ask, native-reply, dispatch, recruit, join, worktree, land, push, remote-tip, knowledge, project, context, models, observed-usage, logs, harness-inventory, repl.\nBaton reads its registered project database and records complete reads internally.\n","usage: baton ACTION ARGS")
