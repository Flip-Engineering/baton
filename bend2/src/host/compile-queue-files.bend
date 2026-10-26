import Base
import ../host/files.bend as F
import ../host/text.bend as T
import ../host/storage.bend as S
import ../git/text.bend as Tx

def first( +values: List<&2,String>) -> String:
  match values:
    case value <> rest: value
    case Nil{}: ""

def at( +values: List<&2,String>, +index: U32) -> String:
  match values:
    case Nil{}: ""
    case value <> rest: Bool.pick(String, U32.is_eq(index,0), value, at(rest,U32.sub(index,1)))

def number( +value: String) -> U32:
  match U32.read(value):
    case Some{found}: found
    case None{}: 0

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
    case Done{record}:
      Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),String.eq(observation_kind(record),"dir"),
        Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),Bool.or(Bool.not(leaf),mode_valid(record)),
          IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),
          IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(13,"shared directory mode")})),
        IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(20,"directory required")}))

def after_create(created: Result<&1,&1,U32 & String,Unit>, +path: String, +leaf: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match created:
    case Fail{(code,message)}:
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
    case Fail{(code,message)}:
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

def mkdir_parts( +parts: List<&2,String>, +prefix: String, +absolute: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match parts:
    case Nil{}: ensure(Bool.pick(String,absolute,"/",prefix),True{})
    case part <> rest:
      +path = Bool.pick(String,Bool.and(String.is_empty(prefix),Bool.not(absolute)),part,prefix ++ "/" ++ part)
      match rest:
        case Nil{}: ensure(path,True{})
        case next <> tail:
          do IO<Result<&1,&1,U32 & String,Unit>>:
            made : Unit <- IO.try(Unit,ensure(path,False{}))
            mkdir_parts(next <> tail,path,False{})

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
      Bool.pick(String,String.is_empty(name),"",name ++ "\n") ++ directory_names(rest)

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
      IO.pure(Result<&1,&1,U32 & String,String>,Done{Bool.pick(String,String.eq(prefix,"#!"),"1","0")})
    case Fail{(code,message)}:
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

def resolve_found(found: Result<&1,&1,U32 & String,Unit>, +candidate: String, +rest: List<&2,String>, +command: String) -> IO(Result<&1,&1,U32 & String,String>):
  match found:
    case Done{unit}: resolve_path(candidate)
    case Fail{error}: resolve_search(rest,command)

def resolve_search( +parts: List<&2,String>, +command: String) -> IO(Result<&1,&1,U32 & String,String>):
  match parts:
    case Nil{}: IO.pure(Result<&1,&1,U32 & String,String>,Done{command})
    case directory <> rest:
      +candidate = Bool.pick(String,String.is_empty(directory),".",directory) ++ "/" ++ command
      do IO<Result<&1,&1,U32 & String,String>>:
        found : Result<&1,&1,U32 & String,Unit> <- F.Files.executable(candidate)
        resolve_found(found,candidate,rest,command)

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

def include_target( +line: String) -> String:
  +trimmed = String.trim_start(line)
  Bool.pick(String,String.starts_with(trimmed,"#include \""),
    first(String.split(String.drop(trimmed,10n),Char.from_u32(34))),"")

def include_lines( +lines: List<&2,String>) -> String:
  match lines:
    case Nil{}: ""
    case line <> rest:
      +target = include_target(line)
      Bool.pick(String,String.is_empty(target),"",target ++ "\n") ++ include_lines(rest)

@unsafe
def include_chunks( +path: String, +position: String, +collected: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    chunk : String & String <- IO.try(String & String,F.Files.text_chunk(path,position))
    (text,next) = chunk
    Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.is_empty(text),
      IO.pure(Result<&1,&1,U32 & String,String>,Done{collected}),
      include_chunks(path,next,collected ++ include_lines(String.lines(text))))

def c_includes( +path: String) -> IO(Result<&1,&1,U32 & String,String>):
  include_chunks(path,"0","")
