import Base
import ../git/text.bend as Tx

type Option is Data:
  Field{name: String, value: String}

type Operation is Data:
  Call{verb: String, options: List<&2,Option>}

type NameSet is Data:
  Names{verb: String, flags: String}

type Parsed is Type:
  Calls{items: List<&2,Operation>}
  Error{cause: String}

type Phase is Data:
  ActionHead{}
  CompoundHead{head: String}
  OptionHead{}
  OptionValue{name: String}

type ParseState is Data:
  Active{phase: Phase, verb: String, options: List<&2,Option>, items: List<&2,Operation>}
  Failed{cause: String}

def shared_strings(values: List<String>) -> List<&2,String>:
  match values:
    case Nil{}: Nil{}
    case head <> rest: Con{head,shared_strings(rest)}

def affine_strings(values: List<&2,String>) -> List<String>:
  match values:
    case Nil{}: Nil{}
    case head <> rest: Con{head,affine_strings(rest)}

def member(+value: String, values: List<String>) -> Bool:
  match values:
    case Nil{}: False{}
    case +head <> rest: Bool.or(String.eq(value,head),member(value,rest))

def known(verb: String) -> Bool:
  member(verb,Tx.split_spaces("session player players assignment completion-request completion-confirmed guide status pending orchestra role ensemble ensemble-member section section-member attempt attempts outbox receiver configure account resume stop force-stop clear-stop recover-observer continue-task succeed turn receive profile-bind connect bind report ask native-reply dispatch recruit join worktree land push remote-tip knowledge project context models observed-usage logs harness-inventory"))

def names_lookup(entries: List<NameSet>, +verb: String) -> List<String>:
  match entries:
    case Nil{}: Nil{}
    case Names{key,+flags} <> rest:
      Bool.pick(List<String>,String.eq(verb,key),Tx.split_spaces(flags),names_lookup(rest,verb))

def names(verb: String) -> List<String>:
  names_lookup([
    Names{"session","--session --id --pretty"},
    Names{"player","--session --id --pretty"},
    Names{"players","--pretty"},
    Names{"assignment","--session --id --pretty"},
    Names{"completion-request","--id --text --file"},
    Names{"completion-confirmed","--id --request --to --next --next-file"},
    Names{"guide","--id --to --text --file"},
    Names{"status","--pretty"},
    Names{"pending","--index --pretty --sender --recipient --kind --state --after-seq --through-seq"},
    Names{"orchestra","--pretty"},
    Names{"role","--session --role"},
    Names{"ensemble","--id --owner --coupling"},
    Names{"ensemble-member","--id --owner --player --action"},
    Names{"section","--ensemble --id --owner --capability"},
    Names{"section-member","--ensemble --id --owner --player --action"},
    Names{"attempt","--session --id"},
    Names{"attempts","--session"},
    Names{"outbox","--session"},
    Names{"receiver","--session --command --output-log --cwd"},
    Names{"configure","--session --harness --model --effort --command --output-log --expected-harness --expected-model --expected-effort"},
    Names{"resume","--session --lift-stop --clear-stop"},
    Names{"stop","--session --id --reason --reason-file --clear"},
    Names{"force-stop","--session --id"},
    Names{"clear-stop","--session"},
    Names{"recover-observer","--session --observer"},
    Names{"continue-task","--session --id"},
    Names{"succeed","--session --from"},
    Names{"turn","--session --id --command --model --effort --cwd --file --output-log --native"},
    Names{"receive","--session --command --model --effort --cwd --output-log --message"},
    Names{"profile-bind","--session --harness --profile --store"},
    Names{"account","--session --action --id --provider --harness --funding --secret-ref --organization --detail"},
    Names{"connect","--session --native --endpoint"},
    Names{"bind","--session --native --harness --model --effort"},
    Names{"report","--id --text --file"},
    Names{"ask","--id --text --file"},
    Names{"native-reply","--request --to --text --file"},
    Names{"dispatch","--id --to --kind --text --file"},
    Names{"recruit","--session --parent --harness --model --effort --repo --branch --path --base"},
    Names{"join","--session --parent --harness --model --effort --path"},
    Names{"worktree","--session"},
    Names{"land","--session --repo --target --commit --check --files"},
    Names{"push","--repo --branch --remote"},
    Names{"remote-tip","--repo --branch --remote"},
    Names{"knowledge-read","--id --index --scope --subject"},
    Names{"knowledge-record","--id --kind --claim --claim-file --evidence --evidence-file --limits --limits-file --links --links-file"},
    Names{"knowledge-relate","--id --source --relation --target"},
    Names{"knowledge-promote","--id --from --to --finding --source-kind --destination-kind"},
    Names{"knowledge-search","--scope --subject --query --query-file"},
    Names{"knowledge-traverse","--scope --subject --reference --direction --relation --recursive"},
    Names{"knowledge-relations","--scope --subject"},
    Names{"project-register","--path"},
    Names{"project-sessions","--path"},
    Names{"project-settings","--path"},
    Names{"context-engines","--session"},
    Names{"context-install","--module --path"},
    Names{"context-query","--owner --id --file"},
    Names{"context-eval","--owner --id --session --expression --frame --cwd"},
    Names{"context-result","--id"},
    Names{"models","--session --all"},
    Names{"observed-usage","--session"},
    Names{"harness-inventory",""},
    Names{"logs","--session --level"}
  ],verb)

def value(options: List<&2,Option>, +name: String, +fallback: String) -> String:
  match options:
    case Nil{}: fallback
    case Field{key,+saved} <> rest:
      Bool.pick(String,String.eq(key,name),saved,value(rest,name,fallback))

def present(options: List<&2,Option>, +name: String) -> Bool:
  match options:
    case Nil{}: False{}
    case Field{key,saved} <> rest: Bool.or(String.eq(key,name),present(rest,name))

def required(verb: String) -> List<String>:
  match verb:
    case "guide": Tx.split_spaces("--to")
    case "ensemble": Tx.split_spaces("--id")
    case "ensemble-member": Tx.split_spaces("--id --player --action")
    case "section": Tx.split_spaces("--ensemble --id")
    case "section-member": Tx.split_spaces("--ensemble --id --player --action")
    case "receiver": Tx.split_spaces("--command --output-log")
    case "recover-observer": Tx.split_spaces("--observer")
    case "succeed": Tx.split_spaces("--from")
    case "turn": Tx.split_spaces("--file --command --output-log")
    case "profile-bind": Tx.split_spaces("--profile --store")
    case "account": Tx.split_spaces("--action --id --provider --harness --funding --secret-ref --organization --detail")
    case "bind": Tx.split_spaces("--harness --model --effort")
    case "dispatch": Tx.split_spaces("--to")
    case "recruit": Tx.split_spaces("--session --harness --model --effort --repo --branch --path --base")
    case "join": Tx.split_spaces("--session --harness --model --effort --path")
    case "land": Tx.split_spaces("--repo --target")
    case "push": Tx.split_spaces("--repo --branch --remote")
    case "remote-tip": Tx.split_spaces("--repo --branch --remote")
    case "knowledge-record": Tx.split_spaces("--kind")
    case "knowledge-relate": Tx.split_spaces("--source --relation --target")
    case "knowledge-promote": Tx.split_spaces("--to --finding")
    case "knowledge-traverse": Tx.split_spaces("--reference --direction")
    case "project-register": Tx.split_spaces("--path")
    case "context-install": Tx.split_spaces("--module --path")
    case "context-query": Tx.split_spaces("--file")
    case "context-eval": Tx.split_spaces("--session --expression")
    case other: Nil{}

def missing(+options: List<&2,Option>, fields: List<String>) -> String:
  match fields:
    case Nil{}: ""
    case +name <> rest:
      Bool.pick(String,String.is_empty(value(options,name,"")),name,missing(options,rest))

def pair_cause(+options: List<&2,Option>, +name: String, +file: String, required: Bool) -> String:
  +text = present(options,name)
  +path = present(options,file)
  Bool.pick(String,Bool.and(text,path),"Supply one of " ++ name ++ " or " ++ file ++ ".",
    Bool.pick(String,Bool.and(required,Bool.not(Bool.or(text,path))),
      "Supply " ++ name ++ " TEXT or " ++ file ++ " PATH.",""))

def first(+cause: String, other: String) -> String:
  Bool.pick(String,String.is_empty(cause),other,cause)

def option_cause(+verb: String, +options: List<&2,Option>) -> String:
  +absent = missing(options,required(verb))
  +pairs = first(pair_cause(options,"--claim","--claim-file",String.eq(verb,"knowledge-record")),
    first(pair_cause(options,"--evidence","--evidence-file",False{}),
      first(pair_cause(options,"--limits","--limits-file",False{}),
        first(pair_cause(options,"--links","--links-file",False{}),
          first(pair_cause(options,"--query","--query-file",String.eq(verb,"knowledge-search")),
            pair_cause(options,"--reason","--reason-file",Bool.and(String.eq(verb,"stop"),Bool.not(present(options,"--clear")))))))))
  +land = Bool.pick(String,Bool.and(String.eq(verb,"land"),
    Bool.or(Bool.and(present(options,"--check"),Bool.not(present(options,"--files"))),
      Bool.and(Bool.not(present(options,"--check")),present(options,"--files")))),
    "A checked landing requires both --check and --files.","")
  +read = Bool.pick(String,Bool.and(String.eq(verb,"knowledge-read"),
    Bool.and(present(options,"--id"),present(options,"--index"))),"Choose --id or --index.","")
  +body = first(pair_cause(options,"--text","--file",member(verb,["report","ask","native-reply","dispatch","completion-request","guide"])),
    pair_cause(options,"--next","--next-file",False{}))
  +inspection = Bool.pick(String,Bool.and(member(verb,["session","player","assignment"]),
    Bool.and(present(options,"--session"),present(options,"--id"))),"Choose --session or --id.","")
  +section = Bool.pick(String,Bool.and(String.eq(verb,"section"),Bool.and(present(options,"--owner"),Bool.not(present(options,"--capability")))),"Supply --capability when selecting a Section owner.","")
  +endpoint = Bool.pick(String,Bool.and(String.eq(verb,"connect"),Bool.not(present(options,"--endpoint"))),"Supply --endpoint JSON_ARGV; an empty string disconnects it.","")
  +clear = Bool.pick(String,Bool.and(String.eq(verb,"resume"),Bool.and(present(options,"--clear-stop"),present(options,"--lift-stop"))),"Resume accepts one of --clear-stop or --lift-stop, not both.","")
  +stop_clear = Bool.pick(String,Bool.and(String.eq(verb,"stop"),Bool.and(present(options,"--clear"),Bool.or(present(options,"--reason"),Bool.or(present(options,"--reason-file"),present(options,"--id"))))),"A clear-only stop takes no reason or stop identity; use stop SESSION --clear.","")
  first(clear,first(stop_clear,first(Bool.pick(String,String.is_empty(absent),"","Missing " ++ absent ++ "."),first(pairs,first(body,first(endpoint,first(land,first(read,first(inspection,section)))))))))

def reverse(items: List<&2,Operation>, tail: List<&2,Operation>) -> List<&2,Operation>:
  match items:
    case Nil{}: tail
    case item <> rest: reverse(rest,Con{item,tail})

def subverb(+head: String, +sub: String) -> String:
  Bool.pick(String,String.eq(head,"knowledge"),
    Bool.pick(String,member(sub,Tx.split_spaces("read record relate promote search traverse relations")),"knowledge-" ++ sub,""),
    Bool.pick(String,String.eq(head,"project"),
      Bool.pick(String,member(sub,Tx.split_spaces("register sessions settings")),"project-" ++ sub,""),
      Bool.pick(String,Bool.and(String.eq(head,"context"),member(sub,Tx.split_spaces("engines install query eval result"))),"context-" ++ sub,"")))

def finish_values(+verb: String, +options: List<&2,Option>, items: List<&2,Operation>) -> Parsed:
  +cause = option_cause(verb,options)
  Bool.pick(Parsed,String.is_empty(cause),Calls{reverse(Con{Call{verb,options},items},Nil{})},Error{cause ++ " Use help " ++ verb ++ "."})

def finish(phase: Phase, verb: String, options: List<&2,Option>, +items: List<&2,Operation>) -> Parsed:
  match phase:
    case ActionHead{}: Error{"An action is required after and."}
    case CompoundHead{+head}:
      Bool.pick(Parsed,String.eq(head,"knowledge"),finish_values("knowledge-read",Nil{},items),Error{"Choose a project or context action; use help " ++ head ++ "."})
    case OptionHead{}: finish_values(verb,options,items)
    case OptionValue{name}: Error{"Missing value for " ++ name ++ ". Use help " ++ verb ++ "."}

# The transition preserves complete literal values, including clause separators.
# The parser advances once per argv token and retains the first refusal.
def transition(phase: Phase, +head: String, +verb: String, +options: List<&2,Option>, +items: List<&2,Operation>) -> ParseState:
  match phase:
    case ActionHead{}:
      Bool.pick(ParseState,Bool.or(String.eq(head,"and"),String.eq(head,"--and")),Failed{"An action is required before " ++ head ++ "."},
        Bool.pick(ParseState,member(head,["knowledge","project","context"]),Active{CompoundHead{head},"",Nil{},items},
          Bool.pick(ParseState,known(head),Active{OptionHead{},head,Nil{},items},Failed{"Unknown action " ++ head ++ ". Use help."})))
    case CompoundHead{+compound}:
      +selected = subverb(compound,head)
      Bool.pick(ParseState,Bool.and(String.eq(compound,"knowledge"),Bool.or(member(head,names("knowledge-read")),Bool.or(String.eq(head,"and"),String.eq(head,"--and")))),
        Bool.pick(ParseState,Bool.or(String.eq(head,"and"),String.eq(head,"--and")),
          Active{ActionHead{},"",Nil{},Con{Call{"knowledge-read",Nil{}},items}},
          Bool.pick(ParseState,String.eq(head,"--index"),Active{OptionHead{},"knowledge-read",[Field{head,"true"}],items},
            Active{OptionValue{head},"knowledge-read",Nil{},items})),
        Bool.pick(ParseState,String.is_empty(selected),Failed{"Unknown " ++ compound ++ " action. Use help " ++ compound ++ "."},Active{OptionHead{},selected,Nil{},items}))
    case OptionHead{}:
      +cause = option_cause(verb,options)
      Bool.pick(ParseState,Bool.or(String.eq(head,"and"),String.eq(head,"--and")),
        Bool.pick(ParseState,String.is_empty(cause),Active{ActionHead{},"",Nil{},Con{Call{verb,options},items}},Failed{cause}),
        Bool.pick(ParseState,Bool.and(member(head,names(verb)),Bool.not(present(options,head))),
          Bool.pick(ParseState,member(head,Tx.split_spaces("--lift-stop --clear-stop --clear --index --recursive --pretty")),
            Active{OptionHead{},verb,Con{Field{head,"true"},options},items},
            Active{OptionValue{head},verb,options,items}),
          Failed{"Unknown or repeated argument " ++ head ++ ". Use help " ++ verb ++ "."}))
    case OptionValue{name}: Active{OptionHead{},verb,Con{Field{name,head},options},items}

def finish_state(state: ParseState) -> Parsed:
  match state:
    case Active{phase,verb,options,items}: finish(phase,verb,options,items)
    case Failed{cause}: Error{cause}

def parse_loop(args: List<String>, state: ParseState) -> Parsed:
  match args:
    case Nil{}: finish_state(state)
    case head <> rest:
      match state:
        case Active{phase,verb,options,items}: parse_loop(rest,transition(phase,head,verb,options,items))
        case Failed{cause}: Error{cause}

def parse(args: List<String>) -> Parsed:
  parse_loop(args,Active{ActionHead{},"",Nil{},Nil{}})

def help(action: String) -> String:
  match action:
    case "session": "session [--session SESSION | --id SESSION] [--pretty]\nRead the selected complete session in a named action batch. Omitted target selects the current actor. The single positional form session [SESSION] retains its existing JSON output.\n"
    case "player": "player [--session SESSION | --id SESSION] [--pretty]\nRead the selected complete Player in a named action batch. Omitted target selects the current actor. The single positional form player SESSION retains its existing JSON output.\n"
    case "players": "players [--pretty]\nRead the current Players projection as an independent action in a mixed batch.\n"
    case "assignment": "assignment [--session SESSION | --id SESSION] [--pretty]\nRead the selected session and its retained assignment and task-completion state in a mixed batch. Omitted target selects the current actor.\n"
    case "completion-request": "completion-request (--text TEXT | --file PATH) [--id ID]\nSend the complete request to the current actor's coordinator (its recorded parent while the parent is not over) through the existing contextual completion handler. Baton generates the identity when --id is omitted. An explicit --id must name the actor's current recorded request for its open assignment; an unrecorded or older ID is refused and stores nothing. Supports mixed and or --and batches.\n"
    case "completion-confirmed": "completion-confirmed [--to PLAYER] [--request REQUEST_ID] [--id ID] [--next TEXT | --next-file PATH]\nConfirm the selected Player's current request through the retained-request handler. Baton selects the owned request when omitted; an explicit request must belong to its author and current recipient. The confirmation ends the Player's assignment (taskCompletion.ended); with --next or --next-file the supplied assignment is recorded with the confirmation in one transaction and the assignment continues. Supports mixed batches.\n"
    case "guide": "guide --to PLAYER (--text TEXT | --file PATH) [--id ID]\nAdmit complete guidance as the current actor through the existing contextual handler. Supports mixed batches.\n"
    case "status": "status [--pretty]\nRead the existing database status projection.\n"
    case "pending": "pending [--index] [--pretty] [--sender SESSION] [--recipient SESSION] [--kind KIND] [--state pending|read|all] [--after-seq INTEGER] [--through-seq INTEGER]\nRead complete pending input; --index enables the native metadata filters.\n"
    case "orchestra": "orchestra [--pretty]\nRead the existing Orchestra projection, including Players, operators, Ensembles and Sections.\n"
    case "role": "role [--session SESSION] [--role player|principal-conductor|associate-conductor|operator]\nA Principal Conductor coordinates the whole assignment; an Associate Conductor coordinates a delegated subtask. Players perform work; operators represent human control. Assign an existing session: Principal Conductor and operator require no parent, Associate Conductor requires a parent. Assignment updates the responsibility used by message routing and Conductor operations; parentage, Ensemble ownership, live work and accepted input remain retained. Omit --role to read it; omitted session selects the current actor.\n"
    case "ensemble": "ensemble --id ID [--owner SESSION] [--coupling loose|tight]\nAn Ensemble records a team owner, coupling and member agents. Loose teams use parent-child and Conductor-descendant routes. Tight coupling additionally permits messages between non-operator peers sharing that Ensemble, including the owner and its members when the owner has no membership row. Peers have no ancestor relationship. Operators use the top-level Conductor route. Omit configuration options to read it. --owner ensures it for that owner; --coupling creates or configures coupling. New teams default to loose; omitted configuration owner selects the current actor. The recorded owner manages membership. Use help branch to compare alternatives on a team with either coupling.\n"
    case "ensemble-member": "ensemble-member --id ID --player SESSION --action add|remove [--owner SESSION]\nChange membership through the native recorded-owner operation. Omitted owner selects the current actor.\n"
    case "section": "section --ensemble ID --id SECTION [--capability TEXT] [--owner SESSION]\nA Section records a capability label and a subset of an Ensemble's members for inspection and work organization. Routing, knowledge visibility and branching use Ensemble and session records. Omit --capability to read it; --capability creates or configures it for the recorded Ensemble owner. Omitted owner selects the current actor.\n"
    case "section-member": "section-member --ensemble ID --id SECTION --player SESSION --action add|remove [--owner SESSION]\nChange Section membership through the native Ensemble owner and membership rules. Omitted owner selects the current actor.\n"
    case "attempt": "attempt [--session SESSION] [--id INPUT_ID]\nRead the current session execution, or relate one complete stored input to its attempt and task state.\n"
    case "attempts": "attempts [--session SESSION]\nRead full native turn history for the selected session.\n"
    case "outbox": "outbox [--session SESSION]\nRead complete authored messages and their current recipient read state.\n"
    case "receiver": "receiver --command EXECUTABLE --output-log PATH [--session SESSION] [--cwd PATH]\nRegister the ordinary receiver. Omitted session selects the current actor; omitted cwd preserves the recorded workspace.\n"
    case "configure": "configure [--session SESSION] [--harness NAME] [--model MODEL] [--effort EFFORT] [--command EXECUTABLE] [--output-log PATH] [--expected-harness NAME] [--expected-model MODEL] [--expected-effort EFFORT]\nOmitted route and expected fields use the selected recorded session. Omitted command and log preserve the recorded endpoint. A same-route --command with --output-log rebinds the endpoint; --command without --output-log is refused. Native configure preserves its expected-route and current-attempt rules.\n"
    case "resume": "resume [--session SESSION] [--lift-stop | --clear-stop]\nResume the same recorded conversation. --lift-stop explicitly lifts its current stop and continues it. --clear-stop removes the terminal stop without delivering input, waking the session or starting a native.\n"
    case "stop": "stop [--id STOP_ID] (--reason TEXT | --reason-file PATH) [--session SESSION]\nRetain an explicit stop and complete reason. Baton generates its identity or selects the existing stop for the session; native reason validation applies. stop SESSION --clear removes a terminal stop without continuing the conversation.\n"
    case "force-stop": "force-stop [--id STOP_ID] [--session SESSION]\nBaton selects the session's existing stop when --id is omitted and invokes the native force operation.\n"
    case "clear-stop": "clear-stop [--session SESSION]\nRemove the session's terminal stop only. Native identity, conversation history, workspace and retained input stay unchanged; no input is delivered, no wake runs and no native starts.\n"
    case "recover-observer": "recover-observer --observer PID [--session SESSION]\nUse the existing attempt recovery and observer ownership operation.\n"
    case "continue-task": "continue-task [--id TURN_ID] [--session SESSION]\nExplicitly request continuation of the selected open assignment. Baton generates the continuation identity when omitted.\n"
    case "succeed": "succeed --from PREDECESSOR [--session SUCCESSOR]\nRecord the selected session (omitted: the current actor) as the successor of a conductor that is over: explicitly stopped or completed. The successor must be live and under the predecessor parent or be an ancestor of the predecessor. Baton keeps the predecessor children, their assignments, completion requests and messages as recorded; the successor holds the predecessor's coordinator authority for them, so reports, requests and confirmations reach it. Each unresolved input of the predecessor, including a read but unconfirmed current completion request, is forwarded to the successor as a new forwarded-input message with the complete original text and the original message ID. The original messages keep their recipient and read state. Repeating the action forwards only input that arrived since.\n"
    case "turn": "turn [--id TURN_ID] --command EXECUTABLE --file TASK_PATH --output-log PATH [--session SESSION] [--model MODEL] [--effort EFFORT] [--cwd PATH] [--native ID]\nStart the existing managed direct turn. Omitted route, workspace and native identity use the selected session. PATH - reads stdin.\n"
    case "receive": "receive [--session SESSION] [--command EXECUTABLE] [--output-log PATH] [--model MODEL] [--effort EFFORT] [--cwd PATH] [--message ID]\nUse the recorded receiver and native retained receive operation.\n"
    case "profile-bind": "profile-bind --profile LABEL --store PATH [--session SESSION] [--harness NAME]\nBind the named existing account through the native profile operation. Omitted harness uses the selected session.\n"
    case "account": "account --action record|read|bind|attempts|select|pool|observe|import-credit [--session SESSION] [--id LABEL] [--provider NAME] [--harness NAME] [--funding subscription|api_key] [--secret-ref REFERENCE] [--organization ID] [--detail JSON]\nrecord stores a provider identity, its funding route and a secret-store reference; api_key funding launches only on the claude-code harness, and re-recording a label with different fields is refused. The organization is written only by an observation that verified it. read prints the recorded accounts. bind records the account in force for the session's next attempts. attempts prints the account and funding route recorded for each attempt. select prints the operator-ordered account for a harness and funding route, preferring one whose organization is not recorded credit-unavailable, with the selection's credit eligibility and observation state. pool prints one entry per organization with its accounts, newest readings, conflicts and observation state. observe records a provider organization, usage or cost document with its source and observed time. import-credit records a promotional or purchased credit balance and expiry the operator read from the provider's billing display.\n"
    case "connect": "connect --endpoint JSON_ARGV [--session SESSION] [--native ID]\nRecord the ordinary endpoint through the existing operation. Omitted native ID preserves the selected session's identity. An empty endpoint explicitly disconnects it.\n"
    case "bind": "bind --harness NAME --model MODEL --effort EFFORT [--session SESSION] [--native ID]\nRecord the native route through the existing binding operation. Omitted native ID preserves the selected session's identity.\n"
    case "report": "report TEXT\nreport [--id ID] (--text TEXT | --file PATH)\nSend a complete report to your recorded coordinator. Baton generates the operation identity.\n"
    case "ask": "ask TEXT\nask [--id ID] (--text TEXT | --file PATH)\nSend a complete question to your recorded coordinator.\n"
    case "native-reply": "native-reply (--text JSON | --file PATH) [--to WORKER] [--request ID]\nAnswer the unique pending native request addressed to the current coordinator. --to selects a worker when several requests exist. Baton refuses absent or ambiguous requests.\n"
    case "dispatch": "dispatch [--id ID] --to SESSION (--text TEXT | --file PATH) [--kind KIND]\nAdmit the complete input as the current actor and wake its recorded recipient. Omitted kind is task.\n"
    case "recruit": "recruit --session PLAYER --harness NAME --model MODEL --effort EFFORT --repo PATH --branch BRANCH --path PATH --base COMMIT [--parent SESSION]\nCreate the recorded Player worktree. Omitted parent selects the current actor.\n"
    case "join": "join --session PLAYER --harness NAME --model MODEL --effort EFFORT --path PATH [--parent SESSION]\nJoin the existing workspace under the selected parent, which defaults to the current actor.\n"
    case "worktree": "worktree [--session SESSION]\nInspect the recorded workspace through the existing native worktree operation.\n"
    case "land": "land --repo PATH --target BRANCH [--session SESSION] [--commit COMMIT] [--check EXECUTABLE --files FILES]\nUse native landing, including its owned workspace and selected-check requirements.\n"
    case "push": "push --repo PATH --branch BRANCH --remote REMOTE\nPublish the named branch through the native Git operation. The command uses BATON_SESSION, or the session recorded with PATH, to select the GitHub App identity. A rejection reports the identity state.\n"
    case "remote-tip": "remote-tip --repo PATH --branch BRANCH --remote REMOTE\nRead the actual remote branch advertisement.\n"
    case "knowledge-record": "knowledge record [--id ID] --kind KIND (--claim TEXT | --claim-file PATH) [--evidence TEXT | --evidence-file PATH] [--limits TEXT | --limits-file PATH] [--links JSON | --links-file PATH]\nRecord complete authored fields as the current actor using native typed or linked knowledge. --evidence report selects exactly one report authored to the recorded coordinator after the current assignment. Missing assignments, absent reports and ambiguous reports refuse. Explicit evidence references preserve deliberate selections.\n"
    case "knowledge-relate": "knowledge relate [--id ID] --source ID --relation RELATION --target ID\nRecord an authored native knowledge relation.\n"
    case "knowledge-promote": "knowledge promote [--id ID] --to DESTINATION --finding ID [--from SOURCE] [--source-kind session|group] [--destination-kind session|group]\nPromote the existing holding as the current actor; native ownership and notice delivery apply.\n"
    case "knowledge-search": "knowledge search (--query TEXT | --query-file PATH) [--scope universal|worker|group|all] [--subject ID]\nSearch complete scoped knowledge and retained evidence through the native operation.\n"
    case "knowledge-traverse": "knowledge traverse --reference ID --direction in|out|both [--relation RELATION] [--recursive] [--scope universal|worker|group|all] [--subject ID]\nTraverse the native graph under the current reader's scope.\n"
    case "knowledge-relations": "knowledge relations [--scope universal|worker|group|all] [--subject ID]\nRead the scoped native relation graph.\n"
    case "knowledge-read": "knowledge read [--id ID | --index] [--scope universal|worker|group|all] [--subject ID]\nRead complete native findings or metadata under the current reader.\n"
    case "knowledge": "knowledge [read|record|relate|promote|search|traverse|relations] NAMED_ARGS\nUse help knowledge-read, help knowledge-record, or the corresponding action name. Bare knowledge reads the current actor's visible findings.\n"
    case "project-register": "project register --path PATH\nRegister the current database under the canonical project. Select an existing database with DATABASE as SESSION when registration is absent.\n"
    case "project-sessions": "project sessions [--path PATH]\nRead sessions in the named project; omitted path uses the current session's recorded workspace.\n"
    case "project-settings": "project settings [--path PATH]\nInspect complete saved settings at the canonical project path. Omitted path uses the recorded workspace. Original settings ownership and qualification remain separate.\n"
    case "project": "project register|sessions|settings [--path PATH]\nUse help project-register, help project-sessions or help project-settings.\n"
    case "context-engines": "context engines [--session SESSION]\nInspect selected native context modules and readiness.\n"
    case "context-install": "context install --module ID --path PATH\nInstall an existing built module through the native operation.\n"
    case "context-query": "context query --file PATH [--id QUERY] [--owner SESSION]\nSubmit the complete request file to the existing native context operation.\n"
    case "context-eval": "context eval --session SESSION --expression EXPR [--frame HANDLE] [--id QUERY] [--owner SESSION] [--cwd PATH]\nEvaluate one expression in an already launched runtime session through the existing native runtime operation and retain the complete result. Omitted cwd uses the owner's recorded workspace; an owner with no recorded workspace is refused.\n"
    case "context-result": "context result [--id QUERY]\nRead the latest query owned by the current actor when its ID is omitted, or the explicitly selected retained query.\n"
    case "context": "context engines|install|query|eval|result NAMED_ARGS\nUse help with the corresponding context action name.\n"
    case "models": "models [--session SESSION] [--all]\nRead observed model capability information for the selected session. --all reads every recorded harness route.\n"
    case "harness-inventory": "harness-inventory\nRead recorded harness/model/effort identities across sessions with operator account profiles and limits. Runs no harness command and decides nothing.\n"
    case "observed-usage": "observed-usage [--session SESSION]\nRead the selected session's actual usage observations.\n"
    case "logs": "logs [--session SESSION] [--level LEVEL]\nInspect or configure existing native log capture through its ordinary operation.\n"
    case other: ""
