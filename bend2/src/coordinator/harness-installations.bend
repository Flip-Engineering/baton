import Base
import ./harness-process.bend as P
import ./subscription-fallback.bend as Subs
import ../host/choice.bend as Choice
import ../host/compile-queue-files.bend as Directory
import ../host/control.bend as Host
import ../host/files.bend as F
import ../host/posix.bend as Posix
import ../host/text.bend as Text
import ../git/text.bend as Tx

def binary(harness: String) -> String:
  match harness:
    case "claude-code": "claude"
    case other: other

def name(path: String) -> String:
  Directory.first(List.reverse(&2,String,String.split(path,Char.from_u32(47))))

def is_digits(text: String) -> Bool:
  match text:
    case SNil{}: True{}
    case SCon{head,rest}: Bool.and(Char.is_digit(head),is_digits(rest))

def nonempty_digits(+text: String) -> Bool:
  Bool.and(Bool.not(String.is_empty(text)),is_digits(text))

def is_word(text: String) -> Bool:
  match text:
    case SNil{}: True{}
    case SCon{+head,rest}: Bool.and(Bool.or(Char.is_alpha(head),Bool.or(Char.is_digit(head),U32.is_eq(Char.to_u32(head),95))),is_word(rest))

def release_version(parts: List<&2,String>) -> Bool:
  match parts:
    case major <> minor <> patch <> Nil{}: Bool.and(nonempty_digits(major),Bool.and(nonempty_digits(minor),nonempty_digits(patch)))
    case other: False{}

def omp_release(parts: List<&2,String>) -> Bool:
  match parts:
    case "omp" <> version <> "linux" <> +arch <> Nil{}:
      Bool.and(release_version(String.split(version,Char.from_u32(46))),Bool.and(Bool.not(String.is_empty(arch)),is_word(arch)))
    case other: False{}

def omp_paths(+root: String, entries: List<&2,String>) -> List<&2,String>:
  match entries:
    case Nil{}: Nil{}
    case +entry <> rest:
      +tail = omp_paths(root,rest)
      Bool.pick(List<&2,String>,omp_release(String.split(entry,Char.from_u32(45))),
        (root ++ "/" ++ entry ++ "/omp") <> tail,tail)

@unsafe
def include_executable(~again_installed: (@+paths: List<&2,String> -> IO(List<&2,String>)), found: Result<&1,&1,U32 & String,Unit>, path: String, +rest: List<&2,String>) -> IO(List<&2,String>):
  match found:
    case Fail{error}: again_installed(rest)
    case Done{unit}: do IO<List<&2,String>>:
      tail : List<&2,String> <- again_installed(rest)
      IO.pure(List<&2,String>,path <> tail)

@unsafe
def installed(+paths: List<&2,String>) -> IO(List<&2,String>):
  match paths:
    case Nil{}: IO.pure(List<&2,String>,Nil{})
    case +path <> rest: do IO<List<&2,String>>:
      found : Result<&1,&1,U32 & String,Unit> <- F.Files.executable(path)
      include_executable(installed,found,path,rest)

def candidates(+home: String, +harness: String) -> IO(List<&2,String>):
  +default = home ++ "/.local/bin/" ++ binary(harness)
  +root = home ++ "/.local/share/baton-native-clients"
  Choice.choose(IO(List<&2,String>),String.eq(harness,"omp"), _update_unit => do IO<List<&2,String>>:
    entries : Result<&1,&1,U32 & String,String> <- Directory.list_dir(root)
    installed(default <> omp_paths(root,String.split(P.value_or(entries,""),Char.from_u32(0)))),
    _update_unit => installed([default]))

def home() -> IO(String):
  do IO<String>:
    env : Result<&1,&1,U32 & String,String> <- IO.get_env("HOME")
    +path : String = P.value_or(env,"")
    resolved : Result<&1,&1,U32 & String,String> <- F.Files.realpath(path)
    IO.pure(String,P.value_or(resolved,path))

def paths(home: String, harness: String) -> IO(List<&2,String>):
  do IO<List<&2,String>>:
    platform : Result<&1,&1,U32 & String,String> <- Posix.HostPosix.platform()
    Choice.choose(IO(List<&2,String>),String.eq(P.value_or(platform,""),"linux"), _update_unit => candidates(home,harness), _update_unit => IO.pure(List<&2,String>,Nil{}))

# These tokens are inspected as text. Wrapper substitutions and commands are never evaluated.
def emit_token(token: String, +words: List<&2,String>) -> List<&2,String>:
  match token:
    case SNil{}: words
    case SCon{c,rest}: Tx.str_rev(SCon{c,rest}) <> words

def wrapper_words(line: String, +quote: U32, +escaped: Bool, +token: String, +words: List<&2,String>) -> List<&2,String>:
  match line:
    case SNil{}: Bool.pick(List<&2,String>,Bool.or(escaped,Bool.not(U32.is_eq(quote,0))),Nil{},List.reverse(&2,String,emit_token(token,words)))
    case SCon{+c,+rest}:
      +code = Char.to_u32(c)
      +plain = U32.is_eq(quote,0)
      Choice.choose(List<&2,String>,escaped, _word_unit => wrapper_words(rest,quote,False{},SCon{c,token},words), _word_unit =>
        Choice.choose(List<&2,String>,Bool.and(U32.is_eq(code,92),Bool.not(U32.is_eq(quote,39))), _word_unit => wrapper_words(rest,quote,True{},token,words), _word_unit =>
          Choice.choose(List<&2,String>,Bool.and(plain,U32.is_eq(code,35)), _word_unit => List.reverse(&2,String,emit_token(token,words)), _word_unit =>
            Choice.choose(List<&2,String>,Bool.and(plain,Char.is_space(c)), _word_unit => wrapper_words(rest,0,False{},"",emit_token(token,words)), _word_unit =>
              Choice.choose(List<&2,String>,U32.is_eq(quote,code), _word_unit => wrapper_words(rest,0,False{},token,words), _word_unit =>
                Choice.choose(List<&2,String>,Bool.and(plain,Bool.or(U32.is_eq(code,39),U32.is_eq(code,34))), _word_unit => wrapper_words(rest,code,False{},token,words), _word_unit =>
                  wrapper_words(rest,quote,False{},SCon{c,token},words)))))))

def wrapper_exec(lines: List<&2,String>) -> String:
  match lines:
    case Nil{}: ""
    case line <> rest:
      match wrapper_words(line,0,False{},"",Nil{}):
        case "exec" <> target <> "$@" <> Nil{}: target
        case other: wrapper_exec(rest)

def wrapper_target(+home: String, +harness: String, +given: String) -> IO(String):
  Choice.choose(IO(String),Bool.and(String.eq(harness,"omp"),String.eq(given,home ++ "/.local/libexec/omp-batonci-env")),
    _update_unit => do IO<String>:
      text : Result<&1,&1,U32 & String,String> <- Text.Text.read(given)
      IO.pure(String,wrapper_exec(String.lines(P.value_or(text,"")))),
    _update_unit => IO.pure(String,""))

def same_file(+left: String, +right: String) -> Bool:
  +a = String.split(left,Char.from_u32(9))
  +b = String.split(right,Char.from_u32(9))
  Bool.and(Bool.not(String.is_empty(left)),Bool.and(Bool.not(String.is_empty(right)),
    Bool.and(String.eq(Directory.at(a,2),Directory.at(b,2)),String.eq(Directory.at(a,3),Directory.at(b,3)))))

type Route is Data:
  Route{alias: String, command: String}

def legacy(+home: String, +harness: String, +given: String) -> Bool:
  +parent = Subs.directory_of(given)
  +release = Bool.pick(String,String.eq(name(parent),"bin"),Subs.directory_of(parent),parent)
  match harness:
    case "codex": Bool.and(String.eq(name(given),"codex"),String.eq(Subs.directory_of(release),home ++ "/.codex/packages/standalone/releases"))
    case "claude-code": String.eq(parent,home ++ "/.local/share/claude/versions")
    case other: False{}

@unsafe
def select_path(+paths: List<&2,String>, +fallback: Route, +given: String, +stat: String, +wrapper: String, +command: String) -> IO(Route):
  match paths:
    case Nil{}: IO.pure(Route,fallback)
    case +path <> rest:
      Choice.choose(IO(Route),String.eq(wrapper,path), _select_unit => IO.pure(Route,Route{path,command}), _select_unit => do IO<Route>:
        observed : Result<&1,&1,U32 & String,String> <- F.Files.stat(path)
        Choice.choose(IO(Route),Bool.or(String.eq(given,path),same_file(stat,P.value_or(observed,""))),
          _select_unit => IO.pure(Route,Route{path,path}), _select_unit => select_path(rest,fallback,given,stat,wrapper,command)))

def route_given(+paths: List<&2,String>, +home: String, +harness: String, +given: String, +command: String) -> IO(Route):
  do IO<Route>:
    wrapper : String <- wrapper_target(home,harness,given)
    stat : Result<&1,&1,U32 & String,String> <- F.Files.stat(given)
    +first : String = Directory.first(paths)
    fallback : Route = Bool.pick(Route,Bool.and(Bool.not(String.is_empty(first)),legacy(home,harness,given)),Route{first,first},Route{"",command})
    select_path(paths,fallback,given,P.value_or(stat,""),wrapper,command)

def route(+home: String, +harness: String, +command: String, +paths: List<&2,String>) -> IO(Route):
  Choice.choose(IO(Route),Bool.or(String.starts_with(command,"/"),Bool.not(String.contains(command,"/"))), _select_unit => do IO<Route>:
    given : Result<&1,&1,U32 & String,String> <- Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.starts_with(command,"/"),Host.Control.output(command),Host.Control.command(command))
    route_given(paths,home,harness,P.value_or(given,command),command),
    _select_unit => IO.pure(Route,Route{"",command}))
