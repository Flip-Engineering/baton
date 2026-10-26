import Base
import ./choice.bend as Choice
import ../host/files.bend as F
import ../host/text.bend as T
import ../host/storage.bend as S
import ../git/text.bend as Tx

type IncludeScan is Data:
  IncludeScan{mode: U32, matched: U32, target: String, output: String}

def first( +values: List<&2,String>) -> String:
  match values:
    case value <> rest: value
    case Nil{}: ""

def at( +values: List<&2,String>, +index: U32) -> String:
  match values:
    case Nil{}: ""
    case value <> rest: Choice.choose(String, U32.is_eq(index,0), _choice_unit =>  value, _choice_unit =>  at(rest,U32.sub(index,1)))

def number_result(result: Maybe<&2,U32>) -> U32:
  match result:
    case Some{found}: found
    case None{}: 0

def number(value: String) -> U32:
  number_result(U32.read(value))

def observation_kind( +record: String) -> String:
  first(String.split(record,Char.from_u32(9)))

def mode_valid( +record: String) -> Bool:
  +mode = number(at(String.split(record,Char.from_u32(9)),1))
  Bool.and(U32.is_eq(U32.mod(U32.div(mode,1024),2),1),
    Bool.and(U32.is_eq(U32.mod(U32.div(mode,16),2),1),
      U32.is_eq(U32.mod(U32.div(mode,2),2),0)))

def check_directory(observed: Result<&1,&1,U32 & String,String>, +leaf: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match observed:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{+record}:
      Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),String.eq(observation_kind(record),"dir"),
        Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),Bool.or(Bool.not(leaf),mode_valid(record)),
          IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),
          IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(13,"shared directory mode")})),
        IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(20,"directory required")}))

def after_create(created: Result<&1,&1,U32 & String,Unit>, +path: String, +leaf: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match created:
    case Fail{(+code,message)}:
      Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),U32.is_eq(code,17),
        do IO<Result<&1,&1,U32 & String,Unit>>:
          observed : Result<&1,&1,U32 & String,String> <- F.Files.lstat(path)
          check_directory(observed,leaf),
        IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(code,message)}))
    case Done{unit}:
      do IO<Result<&1,&1,U32 & String,Unit>>:
        observed : Result<&1,&1,U32 & String,String> <- F.Files.lstat(path)
        check_directory(observed,leaf)

def ensure_observed(observed: Result<&1,&1,U32 & String,String>, +path: String, +leaf: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match observed:
    case Done{record}: check_directory(Done{record},leaf)
    case Fail{(+code,message)}:
      Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),U32.is_eq(code,2),
        do IO<Result<&1,&1,U32 & String,Unit>>:
          created : Result<&1,&1,U32 & String,Unit> <- F.Files.mkdir_shared(path)
          after_create(created,path,leaf),
        IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(code,message)}))

def ensure( +path: String, +leaf: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    observed : Result<&1,&1,U32 & String,String> <- F.Files.lstat(path)
    ensure_observed(observed,path,leaf)

def nonempty( +parts: List<&2,String>) -> List<&2,String>:
  match parts:
    case Nil{}: Nil{}
    case SNil{} <> rest: nonempty(rest)
    case value <> rest: value <> nonempty(rest)

@unsafe
def mkdir_next(~again_mkdir_parts: (@+parts: List<&2,String> -> @+prefix: String -> @+absolute: Bool -> IO(Result<&1,&1,U32 & String,Unit>)), rest: List<&2,String>, +path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match rest:
    case Nil{}: ensure(path,True{})
    case next <> tail:
      do IO<Result<&1,&1,U32 & String,Unit>>:
        made : Unit <- IO.try(Unit,ensure(path,False{}))
        again_mkdir_parts(next <> tail,path,False{})

@unsafe
def mkdir_parts(+parts: List<&2,String>, +prefix: String, +absolute: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match parts:
    case Nil{}: ensure(Choice.choose(String,absolute, _choice_unit => "/", _choice_unit => prefix),True{})
    case +part <> rest:
      mkdir_next(mkdir_parts, rest,Choice.choose(String,Bool.and(String.is_empty(prefix),Bool.not(absolute)), _choice_unit => part, _choice_unit => prefix ++ "/" ++ part))

def mkdir_p( +path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),String.is_empty(path),
    IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(22,"empty directory path")}),
    mkdir_parts(nonempty(String.split(path,Char.from_u32(47))),"",String.starts_with(path,"/")))

def file_size( +path: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +record : String <- IO.try(String,S.StorageHost.observe(path))
    Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.eq(observation_kind(record),"missing"),
      IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"missing file")}),
      IO.pure(Result<&1,&1,U32 & String,String>,Done{at(String.split(record,Char.from_u32(9)),3)}))

def directory_names( +records: List<&2,String>) -> String:
  match records:
    case Nil{}: ""
    case record <> rest:
      +name = at(String.split(record,Char.from_u32(9)),1)
      Choice.choose(String,String.is_empty(name), _choice_unit => "", _choice_unit => name ++ "\n") ++ directory_names(rest)

def directory_entries( +path: String, +record: String) -> IO(Result<&1,&1,U32 & String,String>):
  Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.eq(observation_kind(record),"dir"),
    do IO<Result<&1,&1,U32 & String,String>>:
      +entries : String <- IO.try(String,S.StorageHost.entries(path))
      IO.pure(Result<&1,&1,U32 & String,String>,Done{directory_names(String.split(entries,Char.from_u32(0)))}),
    IO.pure(Result<&1,&1,U32 & String,String>,Fail{(20,"directory required")}))

def list_dir( +path: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +record : String <- IO.try(String,F.Files.lstat(path))
    directory_entries(path,record)

def script_prefix(result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match result:
    case Done{prefix}:
      IO.pure(Result<&1,&1,U32 & String,String>,Done{Choice.choose(String,String.eq(prefix,"#!"), _choice_unit => "1", _choice_unit => "0")})
    case Fail{(+code,message)}:
      Bool.pick(IO(Result<&1,&1,U32 & String,String>),U32.is_eq(code,22),
        IO.pure(Result<&1,&1,U32 & String,String>,Done{"0"}),
        IO.pure(Result<&1,&1,U32 & String,String>,Fail{(code,message)}))

def is_script( +path: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    result : Result<&1,&1,U32 & String,String> <- T.Text.read_span(path,"0","2")
    script_prefix(result)

def resolved_or_path(result: Result<&1,&1,U32 & String,String>, +path: String) -> IO(Result<&1,&1,U32 & String,String>):
  match result:
    case Done{resolved}: IO.pure(Result<&1,&1,U32 & String,String>,Done{resolved})
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Done{path})

def resolve_path( +path: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    resolved : Result<&1,&1,U32 & String,String> <- F.Files.realpath(path)
    resolved_or_path(resolved,path)

@unsafe
def resolve_found(~again_resolve_search: (@+parts: List<&2,String> -> @+command: String -> IO(Result<&1,&1,U32 & String,String>)), found: Result<&1,&1,U32 & String,Unit>, +candidate: String, +rest: List<&2,String>, +command: String) -> IO(Result<&1,&1,U32 & String,String>):
  match found:
    case Done{unit}: resolve_path(candidate)
    case Fail{error}: again_resolve_search(rest,command)

@unsafe
def resolve_search( +parts: List<&2,String>, +command: String) -> IO(Result<&1,&1,U32 & String,String>):
  match parts:
    case Nil{}: IO.pure(Result<&1,&1,U32 & String,String>,Done{command})
    case +directory <> rest:
      +candidate = Choice.choose(String,String.is_empty(directory), _choice_unit => ".", _choice_unit => directory) ++ "/" ++ command
      do IO<Result<&1,&1,U32 & String,String>>:
        found : Result<&1,&1,U32 & String,Unit> <- F.Files.executable(candidate)
        resolve_found(resolve_search, found,candidate,rest,command)

def resolve_environment(value: Result<&1,&1,U32 & String,String>, +command: String) -> IO(Result<&1,&1,U32 & String,String>):
  match value:
    case Done{path}: resolve_search(String.split(path,Char.from_u32(58)),command)
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Done{command})

def resolve_command( +command: String) -> IO(Result<&1,&1,U32 & String,String>):
  Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.contains(command,"/"),
    resolve_path(command),
    do IO<Result<&1,&1,U32 & String,String>>:
      value : Result<&1,&1,U32 & String,String> <- IO.get_env("PATH")
      resolve_environment(value,command))

def include_prefix(index: U32) -> String:
  String.take(String.drop("#include \"",U32.to_nat(index)),1n)

def include_advance(+char: Char, scan: IncludeScan) -> IncludeScan:
  match scan:
    case IncludeScan{+mode,+matched,+target,+output}:
      +newline = U32.is_eq(Char.to_u32(char),10)
      +capture = U32.is_eq(mode,2)
      +quote = U32.is_eq(Char.to_u32(char),34)
      +same = String.eq(Char.show(char),include_prefix(matched))
      Choice.choose(IncludeScan,capture, _choice_unit =>
        Choice.choose(IncludeScan,Bool.or(quote,newline), _choice_unit =>
          IncludeScan{Choice.choose(U32,newline, _choice_unit => 0, _choice_unit => 3),0,"",output ++ Choice.choose(String,String.is_empty(target), _choice_unit => "", _choice_unit => target ++ "\n")}, _choice_unit =>
          IncludeScan{2,matched,target ++ Char.show(char),output}), _choice_unit =>
        Choice.choose(IncludeScan,newline, _choice_unit => IncludeScan{0,0,"",output}, _choice_unit =>
          Choice.choose(IncludeScan,U32.is_eq(mode,3), _choice_unit => IncludeScan{3,0,"",output}, _choice_unit =>
            Choice.choose(IncludeScan,Bool.and(U32.is_eq(mode,0),Char.is_space(char)), _choice_unit => IncludeScan{0,0,"",output}, _choice_unit =>
              Choice.choose(IncludeScan,same, _choice_unit => IncludeScan{Choice.choose(U32,U32.is_eq(matched,9), _choice_unit => 2, _choice_unit => 1),U32.add(matched,1),"",output}, _choice_unit => IncludeScan{3,0,"",output})))))

def include_text(text: String, scan: IncludeScan) -> IncludeScan:
  match text:
    case SNil{}: scan
    case SCon{char,rest}: include_text(rest,include_advance(char,scan))

def include_finish(scan: IncludeScan) -> String:
  match scan:
    case IncludeScan{mode,matched,+target,output}:
      output ++ Choice.choose(String,Bool.and(U32.is_eq(mode,2),Bool.not(String.is_empty(target))), _choice_unit => target ++ "\n", _choice_unit => "")

def chunk_text(chunk: String & String) -> String:
  match chunk:
    case (text,next): text

def chunk_position(chunk: String & String) -> String:
  match chunk:
    case (text,next): next

@unsafe
def include_chunks(+path: String, position: String, +scan: IncludeScan) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +chunk : String & String <- IO.try(String & String,F.Files.text_chunk(path,position))
    +text : String <- IO.pure(String,chunk_text(chunk))
    next : String <- IO.pure(String,chunk_position(chunk))
    Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.is_empty(text),
      IO.pure(Result<&1,&1,U32 & String,String>,Done{include_finish(scan)}),
      include_chunks(path,next,include_text(text,scan)))

def c_includes(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  include_chunks(path,"0",IncludeScan{0,0,"",""})
