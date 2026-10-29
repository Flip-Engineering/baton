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
  CompletionConfirmed{recipient: String, request: String, id: String, next: Body}
  Session{id: String}
  Player{id: String}
  Players{}
  Assignment{id: String}
  Native{items: List<&2,Domain.Operation>}
  Branch{args: List<String>}
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
  FinishVerb{}
  ConfirmVerb{}
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

def send_kind(+kind: String) -> String:
  Bool.pick(String,String.is_empty(kind),"report",kind)

def send_done(+recipient: String, id: String, +kind: String, body: Body,
              items: List<&2,Message>) -> Action:
  match body:
    case Missing{}: Invalid{"send requires --text TEXT or --file PATH."}
    case Bad{cause}: Invalid{cause}
    case value:
      Bool.pick(Action,String.is_empty(recipient),
        Invalid{"send requires a recipient for each message."},
        Send{reverse_items(Con{Item{recipient,id,send_kind(kind),value},items},Nil{})})

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
          Bool.pick(Action,String.is_empty(recipient),
            Invalid{"send requires a recipient for each message."},
            send_options(rest,target,"","",Missing{},Con{Item{recipient,id,send_kind(kind),value},items}))
    case "and" <> Nil{}: Invalid{"send requires a recipient after and."}
    case "--and" <> target <> rest:
      match body:
        case Missing{}: Invalid{"send requires --text TEXT or --file PATH."}
        case Bad{cause}: Invalid{cause}
        case value:
          Bool.pick(Action,String.is_empty(recipient),
            Invalid{"send requires a recipient for each message."},
            send_options(rest,target,"","",Missing{},Con{Item{recipient,id,send_kind(kind),value},items}))
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

def next_option(next: Body, value: Body) -> Body:
  match next:
    case Missing{}: value
    case Bad{cause}: Bad{cause}
    case other: Bad{"completion-confirmed accepts exactly one --next TEXT or --next-file PATH."}

def confirmation_done(+recipient: String, +request: String, +id: String, next: Body) -> Action:
  match next:
    case Bad{cause}: Invalid{cause}
    case Text{+value}:
      Bool.pick(Action,String.is_empty(value),
        Invalid{"completion-confirmed --next requires nonempty assignment text."},
        CompletionConfirmed{recipient,request,id,Text{value}})
    case other: CompletionConfirmed{recipient,request,id,other}

def confirmation_args(args: List<String>, +recipient: String, +request: String,
                      +id: String, next: Body) -> Action:
  match args:
    case "--to" <> +value <> rest:
      Bool.pick(Action,Bool.or(Bool.not(String.is_empty(recipient)),String.is_empty(value)),
        Invalid{"completion-confirmed accepts one nonempty --to PLAYER."},
        confirmation_args(rest,value,request,id,next))
    case "--request" <> +value <> rest:
      Bool.pick(Action,Bool.or(Bool.not(String.is_empty(request)),String.is_empty(value)),
        Invalid{"completion-confirmed requires one nonempty --request REQUEST_ID."},
        confirmation_args(rest,recipient,value,id,next))
    case "--id" <> +value <> rest:
      Bool.pick(Action,Bool.or(Bool.not(String.is_empty(id)),String.is_empty(value)),
        Invalid{"completion-confirmed accepts one nonempty --id ID."},
        confirmation_args(rest,recipient,request,value,next))
    case "--next" <> value <> rest:
      confirmation_args(rest,recipient,request,id,next_option(next,Text{value}))
    case "--next-file" <> path <> rest:
      confirmation_args(rest,recipient,request,id,next_option(next,File{path}))
    case Nil{}: confirmation_done(recipient,request,id,next)
    case other:
      Invalid{"completion-confirmed accepts --request REQUEST_ID, optional --to PLAYER, optional --id ID, and optional --next TEXT or --next-file PATH."}

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
        case +recipient <> +text <> Nil{}:
          Bool.pick(Action,Tx.starts_with(text,"--"),
            send_options([text],recipient,"","",Missing{},Nil{}),
            send_done(recipient,"","",Text{text},Nil{}))
        case recipient <> rest: send_options(rest,recipient,"","",Missing{},Nil{})
        case Nil{}: Invalid{"Choose inbox, send, report, ask, guide, finish or confirm; use help ACTION for usage."}
    case SessionVerb{}: inspect_id("session",args)
    case PlayerVerb{}: player_args(args)
    case AssignmentVerb{}: inspect_id("assignment",args)
    case CompletionRequestVerb{}: completion_request_options(args,"",Missing{})
    case CompletionConfirmedVerb{}: confirmation_args(args,"","","",Missing{})
    case FinishVerb{}:
      match args:
        case summary <> Nil{}: CompletionRequest{"",Text{summary}}
        case other: Invalid{"finish requires one quoted summary; use finish --help."}
    case ConfirmVerb{}:
      match args:
        case player <> Nil{}: CompletionConfirmed{player,"","",Missing{}}
        case Nil{}: CompletionConfirmed{"","","",Missing{}}
        case other: Invalid{"confirm accepts one Player; use confirm --help."}
    case GuideVerb{}:
      match args:
        case +player <> +text <> Nil{}:
          Bool.pick(Action,Tx.starts_with(player,"--"),
            decision_args("guide","guidance",[player,text],"","","",Missing{}),
            Send{[Item{player,"","guidance",Text{text}}]})
        case other: decision_args("guide","guidance",other,"","","",Missing{})
    case UnknownVerb{}: Invalid{"Choose inbox, send, report, ask, guide, finish or confirm; use help ACTION for usage."}

def classify_verb(verb: String) -> Verb:
  match verb:
    case "read": ReadVerb{}
    case "send": SendVerb{}
    case "session": SessionVerb{}
    case "player": PlayerVerb{}
    case "assignment": AssignmentVerb{}
    case "completion-request": CompletionRequestVerb{}
    case "completion-confirmed": CompletionConfirmedVerb{}
    case "finish": FinishVerb{}
    case "confirm": ConfirmVerb{}
    case "guide": GuideVerb{}
    case other: UnknownVerb{}

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
    Bool.pick(Action,String.eq(verb,"branch"),Branch{Domain.affine_strings(args)},
      parse_verb_selected(Bool.and(Domain.known(verb),Bool.not(original_form(verb,args))),verb,args)))

def parse_verb(+verb: String, args: List<String>) -> Action:
  match args:
    case +text <> Nil{}:
      Bool.pick(Action,Bool.and(Domain.member(verb,["report","ask"]),Bool.not(Tx.starts_with(text,"--"))),
        domain_action(Domain.parse([verb,"--text",text])),
        parse_verb_shared(verb,Domain.shared_strings([text])))
    case +player <> +text <> Nil{}:
      Bool.pick(Action,Bool.and(String.eq(verb,"guide"),Bool.not(Tx.starts_with(player,"--"))),
        parse_action(GuideVerb{},[player,text]),
        parse_verb_shared(verb,Domain.shared_strings([player,text])))
    case other: parse_verb_shared(verb,Domain.shared_strings(other))

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
    case Nil{}: Invalid{"Choose inbox, send, report, ask, guide, finish or confirm; use help ACTION for usage."}
    case +verb <> rest: parse_args(verb,rest)

def help(action: String) -> String:
  match action:
    case "repl": "repl define|eval|bind|read|recover|share|import|interactive [OPTIONS]\nUse help repl for Bend source, notebook, result and interactive operations.\n"
    case "branch": "branch start|evaluate|select|continue|status|recover|stop [--ensemble NAME]\nUse help branch or branch --help for source defaults, workspace, evaluator, selection and continuation arguments.\n"
    case "inbox": "inbox\nRead every pending message for the current agent with complete bodies. Pending means delivered but not yet read.\n"
    case "read": "read ID...\nRead complete stored messages in argument order; the read is recorded as a real read event. Already read messages remain readable. Each ID has its own result.\n"
    case "session": "session [SESSION]\nRead the complete registered session record. Omitted SESSION selects the current agent.\n" ++ Domain.help("session")
    case "player": "player SESSION\nRead the complete registered Player record.\n" ++ Domain.help("player")
    case "players": "players\nRead the current Players projection.\n" ++ Domain.help("players")
    case "assignment": "assignment [SESSION]\nRead the registered session record, including its assignment and task-completion state. Omitted SESSION selects the current agent.\n" ++ Domain.help("assignment")
    case "finish": "finish SUMMARY\nSend the completion summary to your recorded coordinator. Baton selects the assignment and creates the request identity.\n"
    case "confirm": "confirm [PLAYER]\nConfirm the Player's current completion request; the Player's assignment is then ended (taskCompletion.ended). Omitted PLAYER selects the sole current request addressed to you. Use completion-confirmed --next to confirm and dispatch the next assignment in one transaction.\n"
    case "completion-request": "completion-request (--text TEXT | --file PATH) [--id ID]\nSend the request to the current session's coordinator: its recorded parent while the parent is not over, else the parent's successor, the nearest ancestor that is not over, or the registered operator. Baton generates the request identity when --id is omitted. An explicit --id must name the actor's current recorded request for its open assignment; an unrecorded or older ID is refused and stores nothing. The message body carries the completion report. A parentless conductor sends it to the registered operator; a parentless Player, or a conductor with no registered operator, receives a structured refusal. Each mixed --and item retains its actual process result and complete admission result in stdout.\n"
    case "completion-confirmed": "completion-confirmed [--to PLAYER] [--request REQUEST_ID] [--id ID] [--next TEXT | --next-file PATH]\nResolve the selected Player's current completion request. Omitted --to selects the sole current request addressed to this coordinator. Baton generates the action identity and links the exact retained request. Explicit selectors retain their native authority checks. The recorded confirmation ends the Player's assignment (taskCompletion.ended is true). With --next or --next-file, the text or file content is read first, then the confirmation and a task to the Player are recorded in one transaction; the assignment continues and taskCompletion.ended stays false. An explicit stop on the Player refuses both and stays in place. Supports mixed and or --and batches.\n"
    case "guide": "guide PLAYER TEXT\nguide --to PLAYER (--text TEXT | --file PATH) [--id ID]\nSend guidance to a Player through the ordinary message admission path. The named form supports mixed batches.\n"
    case "send": "send PLAYER TEXT\nsend PLAYER [--kind KIND] (--text TEXT | --file PATH) [--id ID] [and PLAYER ...]\nSend a complete report to a Player. The named form selects an explicit kind and supports independent messages. Baton generates omitted identities. PATH - reads stdin.\n"
    case +other:
      +domain = Domain.help(other)
      Bool.pick(String,String.is_empty(domain),"usage: baton ACTION ARGS\nActions: inbox, read, send, report, ask, guide, finish, confirm, dispatch, players, assignment, status, role, ensemble, ensemble-member, section, section-member, orchestra, branch, knowledge, repl, clear-stop.\nBaton resolves your project and session. Baton records delivery and complete reads internally. Use help ACTION for usage and explicit context options. Use help role for responsibilities, help ensemble for team coupling, help section for capability groups, help branch for alternatives, score-based selection and continuation, and help repl for Bend expressions, definitions and saved results.\n",domain)
