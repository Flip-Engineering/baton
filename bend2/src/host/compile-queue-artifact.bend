import Base
import ./choice.bend as Choice
import ../host/files.bend as F
import ../host/storage.bend as S
import ./digest.bend as D
import ./compile-queue-files.bend as Q

def kind_of( +record: String) -> String:
  +value = Q.observation_kind(record)
  Choice.choose(String,String.eq(value,"dir"), _choice_unit => "directory", _choice_unit =>
    Choice.choose(String,String.eq(value,"file"), _choice_unit => "file", _choice_unit => "other"))

def kind_result(result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match result:
    case Done{record}: IO.pure(Result<&1,&1,U32 & String,String>,Done{kind_of(record)})
    case Fail{(code,message)}:
      IO.pure(Result<&1,&1,U32 & String,String>,Done{Choice.choose(String,U32.is_eq(code,2), _choice_unit => "missing", _choice_unit => "other")})

def kind_resolved(result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match result:
    case Fail{error}: kind_result(Fail{error})
    case Done{path}:
      do IO<Result<&1,&1,U32 & String,String>>:
        record : Result<&1,&1,U32 & String,String> <- F.Files.lstat(path)
        kind_result(record)

def CompileQueueArtifact.kind( +path: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    resolved : Result<&1,&1,U32 & String,String> <- F.Files.realpath(path)
    kind_resolved(resolved)

def field( +lines: List<&2,String>, +name: String) -> String:
  match lines:
    case Nil{}: ""
    case +line <> rest:
      +prefix = name ++ "="
      Choice.choose(String,String.starts_with(line,prefix), _choice_unit =>
        String.drop(line,String.length(prefix)), _choice_unit => field(rest,name))

def CompileQueueArtifact.c_source_kind( +path: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +record : String <- IO.try(String,F.Files.byte_properties(path))
    +lines : List<&2,String> <- IO.pure(List<&2,String>,String.lines(record))
    +binary : Bool <- IO.pure(Bool,Bool.or(String.eq(field(lines,"bytes"),"0"),
      Bool.or(String.eq(field(lines,"zeros"),"1"),String.eq(field(lines,"prefix"),"7f454c46"))))
    IO.pure(Result<&1,&1,U32 & String,String>,Done{Choice.choose(String,binary, _choice_unit => "binary", _choice_unit => "text")})

def append( +left: List<&2,String>, +right: List<&2,String>) -> List<&2,String>:
  match left:
    case Nil{}: right
    case value <> rest: value <> append(rest,right)

def insert( +value: String, +sorted: List<&2,String>) -> List<&2,String>:
  match sorted:
    case Nil{}: [value]
    case +head <> +rest:
      Choice.choose(List<&2,String>,String.is_lt(value,head), _choice_unit => value <> head <> rest, _choice_unit => head <> insert(value,rest))

def sorted( +values: List<&2,String>) -> List<&2,String>:
  match values:
    case Nil{}: Nil{}
    case value <> rest: insert(value,sorted(rest))

@unsafe
def collect_kind(~again_collect: (@+root: String -> @+relative: String -> IO(Result<&1,&1,U32 & String,List<&2,String>>)), kind: String, root: String, relative: String) -> IO(Result<&1,&1,U32 & String,List<&2,String>>):
  match kind:
    case "file": IO.pure(Result<&1,&1,U32 & String,List<&2,String>>,Done{[relative]})
    case "dir": again_collect(root,relative)
    case other: IO.pure(Result<&1,&1,U32 & String,List<&2,String>>,Done{Nil{}})

@unsafe
def collect_observed(~again_collect: (@+root: String -> @+relative: String -> IO(Result<&1,&1,U32 & String,List<&2,String>>)), observed: Result<&1,&1,U32 & String,String>, +root: String, +relative: String) -> IO(Result<&1,&1,U32 & String,List<&2,String>>):
  match observed:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,List<&2,String>>,Fail{error})
    case Done{record}: collect_kind(again_collect, Q.observation_kind(record),root,relative)

def combine_collected(first: Result<&1,&1,U32 & String,List<&2,String>>, second: Result<&1,&1,U32 & String,List<&2,String>>) -> Result<&1,&1,U32 & String,List<&2,String>>:
  match first:
    case Fail{error}: Fail{error}
    case Done{left}:
      match second:
        case Fail{error}: Fail{error}
        case Done{right}: Done{append(left,right)}

@unsafe
def collect_names(~again_collect: (@+root: String -> @+relative: String -> IO(Result<&1,&1,U32 & String,List<&2,String>>)),  +names: List<&2,String>, +root: String, +relative: String) -> IO(Result<&1,&1,U32 & String,List<&2,String>>):
  match names:
    case Nil{}: IO.pure(Result<&1,&1,U32 & String,List<&2,String>>,Done{Nil{}})
    case SNil{} <> rest: collect_names(again_collect, rest,root,relative)
    case name <> rest:
      +child = relative ++ "/" ++ name
      do IO<Result<&1,&1,U32 & String,List<&2,String>>>:
        observed : Result<&1,&1,U32 & String,String> <- F.Files.lstat(root ++ "/" ++ child)
        found : Result<&1,&1,U32 & String,List<&2,String>> <- collect_observed(again_collect, observed,root,child)
        remaining : Result<&1,&1,U32 & String,List<&2,String>> <- collect_names(again_collect, rest,root,relative)
        IO.pure(Result<&1,&1,U32 & String,List<&2,String>>,combine_collected(found,remaining))

@unsafe
def collect_listing(~again_collect: (@+root: String -> @+relative: String -> IO(Result<&1,&1,U32 & String,List<&2,String>>)), result: Result<&1,&1,U32 & String,String>, +root: String, +relative: String) -> IO(Result<&1,&1,U32 & String,List<&2,String>>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,List<&2,String>>,Fail{error})
    case Done{listing}: collect_names(again_collect, String.split(listing,Char.from_u32(0)),root,relative)

@unsafe
def collect( +root: String, +relative: String) -> IO(Result<&1,&1,U32 & String,List<&2,String>>):
  do IO<Result<&1,&1,U32 & String,List<&2,String>>>:
    listing : Result<&1,&1,U32 & String,String> <- Q.list_dir(root ++ "/" ++ relative)
    collect_listing(collect, listing,root,relative)

def digest_rows( +names: List<&2,String>, +root: String) -> IO(Result<&1,&1,U32 & String,String>):
  match names:
    case Nil{}: IO.pure(Result<&1,&1,U32 & String,String>,Done{""})
    case +name <> rest:
      do IO<Result<&1,&1,U32 & String,String>>:
        +hash : String <- IO.try(String,D.HostDigest.file(root ++ "/" ++ name))
        +tail : String <- IO.try(String,digest_rows(rest,root))
        IO.pure(Result<&1,&1,U32 & String,String>,Done{name ++ " " ++ hash ++ "\n" ++ tail})

def digest_collected(collected: Result<&1,&1,U32 & String,List<&2,String>>, +resolved: String) -> IO(Result<&1,&1,U32 & String,String>):
  match collected:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{names}: digest_rows(sorted(names),resolved)

def CompileQueueArtifact.digest( +path: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +resolved : String <- IO.try(String,F.Files.realpath(path))
    +observed : String <- IO.try(String,F.Files.lstat(resolved))
    Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.eq(Q.observation_kind(observed),"dir"),
      do IO<Result<&1,&1,U32 & String,String>>:
        collected : Result<&1,&1,U32 & String,List<&2,String>> <- collect(resolved,".")
        +rows : String <- IO.try(String,digest_collected(collected,resolved))
        D.HostDigest.text(rows),
      D.HostDigest.file(resolved))

@unsafe
def remove_children(~again_CompileQueueArtifact_remove: (@+path: String -> IO(Result<&1,&1,U32 & String,Unit>)),  +names: List<&2,String>, +path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match names:
    case Nil{}: F.Files.rmdir(path)
    case SNil{} <> rest: remove_children(again_CompileQueueArtifact_remove, rest,path)
    case name <> rest:
      do IO<Result<&1,&1,U32 & String,Unit>>:
        removed : Unit <- IO.try(Unit,again_CompileQueueArtifact_remove(path ++ "/" ++ name))
        remove_children(again_CompileQueueArtifact_remove, rest,path)

@unsafe
def remove_observed(~again_CompileQueueArtifact_remove: (@+path: String -> IO(Result<&1,&1,U32 & String,Unit>)), observed: Result<&1,&1,U32 & String,String>, +path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match observed:
    case Fail{(+code,message)}:
      Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),U32.is_eq(code,2),
        IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),
        IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(code,message)}))
    case Done{record}:
      Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),String.eq(Q.observation_kind(record),"dir"),
        do IO<Result<&1,&1,U32 & String,Unit>>:
          +names : String <- IO.try(String,Q.list_dir(path))
          remove_children(again_CompileQueueArtifact_remove, String.split(names,Char.from_u32(0)),path),
        F.Files.remove(path))

@unsafe
def CompileQueueArtifact.remove( +path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    observed : Result<&1,&1,U32 & String,String> <- F.Files.lstat(path)
    remove_observed(CompileQueueArtifact.remove, observed,path)

@unsafe
def copy_children(~again_CompileQueueArtifact_copy: (@+source: String -> @+staging: String -> IO(Result<&1,&1,U32 & String,Unit>)),  +names: List<&2,String>, +source: String, +destination: String, +mode: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  match names:
    case Nil{}: F.Files.chmod(destination,mode)
    case SNil{} <> rest: copy_children(again_CompileQueueArtifact_copy, rest,source,destination,mode)
    case +name <> rest:
      do IO<Result<&1,&1,U32 & String,Unit>>:
        copied : Unit <- IO.try(Unit,again_CompileQueueArtifact_copy(source ++ "/" ++ name,destination ++ "/" ++ name))
        copy_children(again_CompileQueueArtifact_copy, rest,source,destination,mode)

def created_directory(created: Result<&1,&1,U32 & String,Unit>, +destination: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match created:
    case Done{unit}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case Fail{(+code,message)}:
      Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),U32.is_eq(code,17),
        do IO<Result<&1,&1,U32 & String,Unit>>:
          observed : Result<&1,&1,U32 & String,String> <- F.Files.lstat(destination)
          Q.check_directory(observed,False{}),
        IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(code,message)}))

@unsafe
def copy_kind(~again_CompileQueueArtifact_copy: (@+source: String -> @+staging: String -> IO(Result<&1,&1,U32 & String,Unit>)), kind: String, +mode: U32, +source: String, +destination: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match kind:
    case "file": F.Files.copy_file(source,destination)
    case "dir":
      do IO<Result<&1,&1,U32 & String,Unit>>:
        made : Result<&1,&1,U32 & String,Unit> <- F.Files.mkdir_mode(destination,mode)
        checked : Unit <- IO.try(Unit,created_directory(made,destination))
        +names : String <- IO.try(String,Q.list_dir(source))
        copy_children(again_CompileQueueArtifact_copy, String.split(names,Char.from_u32(0)),source,destination,mode)
    case "symlink":
      do IO<Result<&1,&1,U32 & String,Unit>>:
        +target : String <- IO.try(String,F.Files.readlink(source))
        F.Files.symlink(target,destination)
    case other: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(22,"unsupported artifact kind")})

@unsafe
def copy_observed(~again_CompileQueueArtifact_copy: (@+source: String -> @+staging: String -> IO(Result<&1,&1,U32 & String,Unit>)), +record: String, source: String, destination: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  copy_kind(again_CompileQueueArtifact_copy, Q.observation_kind(record),U32.mod(Q.number(Q.at(String.split(record,Char.from_u32(9)),1)),512),source,destination)

@unsafe
def CompileQueueArtifact.copy( +source: String, +staging: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +observed : String <- IO.try(String,F.Files.lstat(source))
    copy_observed(CompileQueueArtifact.copy, observed,source,staging)

def publish_after_backup(moved: Result<&1,&1,U32 & String,Unit>, +staging: String, +destination: String, +backup: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match moved:
    case Fail{error}:
      do IO<Result<&1,&1,U32 & String,Unit>>:
        restored : Result<&1,&1,U32 & String,Unit> <- F.Files.move(backup,destination)
        IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{unit}:
      do IO<Result<&1,&1,U32 & String,Unit>>:
        removed : Result<&1,&1,U32 & String,Unit> <- CompileQueueArtifact.remove(backup)
        IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})

def publish_staging(present: Result<&1,&1,U32 & String,String>, +directory: Bool, +staging: String, +destination: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match present:
    case Fail{error}: F.Files.move(staging,destination)
    case Done{record}:
      Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),directory,
        do IO<Result<&1,&1,U32 & String,Unit>>:
          +backup : String <- IO.pure(String,staging ++ ".previous")
          removed : Unit <- IO.try(Unit,CompileQueueArtifact.remove(backup))
          moved_old : Unit <- IO.try(Unit,F.Files.move(destination,backup))
          moved : Result<&1,&1,U32 & String,Unit> <- F.Files.move(staging,destination)
          publish_after_backup(moved,staging,destination,backup),
        F.Files.move(staging,destination))

def install_absent(existing: Result<&1,&1,U32 & String,String>, +source: String, +destination: String, +staging: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match existing:
    case Done{record}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(17,"staging path exists")})
    case Fail{error}:
      do IO<Result<&1,&1,U32 & String,Unit>>:
        +observed : String <- IO.try(String,F.Files.lstat(source))
        copied : Unit <- IO.try(Unit,copy_observed(CompileQueueArtifact.copy, observed,source,staging))
        present : Result<&1,&1,U32 & String,String> <- F.Files.lstat(destination)
        publish_staging(present,String.eq(Q.observation_kind(observed),"dir"),staging,destination)

def CompileQueueArtifact.install( +source: String, +destination: String, +staging: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    existing : Result<&1,&1,U32 & String,String> <- F.Files.lstat(staging)
    install_absent(existing,source,destination,staging)
