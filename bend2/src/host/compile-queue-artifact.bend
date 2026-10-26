import Base
import ../host/files.bend as F
import ../host/storage.bend as S
import ./digest.bend as D
import ./compile-queue-files.bend as Q

def kind_of( +record: String) -> String:
  +value = Q.observation_kind(record)
  Bool.pick(String,String.eq(value,"dir"),"directory",
    Bool.pick(String,String.eq(value,"file"),"file","other"))

def kind_result(result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match result:
    case Done{record}: IO.pure(Result<&1,&1,U32 & String,String>,Done{kind_of(record)})
    case Fail{(code,message)}:
      IO.pure(Result<&1,&1,U32 & String,String>,Done{Bool.pick(String,U32.is_eq(code,2),"missing","other")})

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
    case line <> rest:
      +prefix = name ++ "="
      Bool.pick(String,String.starts_with(line,prefix),
        String.drop(line,String.length(prefix)),field(rest,name))

def CompileQueueArtifact.c_source_kind( +path: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +record : String <- IO.try(String,F.Files.byte_properties(path))
    +lines = String.lines(record)
    +binary = Bool.or(String.eq(field(lines,"bytes"),"0"),
      Bool.or(String.eq(field(lines,"zeros"),"1"),String.eq(field(lines,"prefix"),"7f454c46")))
    IO.pure(Result<&1,&1,U32 & String,String>,Done{Bool.pick(String,binary,"binary","text")})

def append( +left: List<&2,String>, +right: List<&2,String>) -> List<&2,String>:
  match left:
    case Nil{}: right
    case value <> rest: value <> append(rest,right)

def insert( +value: String, +sorted: List<&2,String>) -> List<&2,String>:
  match sorted:
    case Nil{}: [value]
    case head <> rest:
      Bool.pick(List<&2,String>,String.is_lt(value,head),value <> head <> rest,head <> insert(value,rest))

def sorted( +values: List<&2,String>) -> List<&2,String>:
  match values:
    case Nil{}: Nil{}
    case value <> rest: insert(value,sorted(rest))

def collect_kind(kind: String, root: String, relative: String) -> IO(List<&2,String>):
  match kind:
    case "file": IO.pure(List<&2,String>,[relative])
    case "dir": collect(root,relative)
    case other: IO.pure(List<&2,String>,Nil{})

def collect_observed(observed: Result<&1,&1,U32 & String,String>, +root: String, +relative: String) -> IO(List<&2,String>):
  match observed:
    case Fail{error}: IO.pure(List<&2,String>,Nil{})
    case Done{record}: collect_kind(Q.observation_kind(record),root,relative)

def collect_names( +names: List<&2,String>, +root: String, +relative: String) -> IO(List<&2,String>):
  match names:
    case Nil{}: IO.pure(List<&2,String>,Nil{})
    case SNil{} <> rest: collect_names(rest,root,relative)
    case name <> rest:
      +child = relative ++ "/" ++ name
      do IO<List<&2,String>>:
        observed : Result<&1,&1,U32 & String,String> <- F.Files.lstat(root ++ "/" ++ child)
        +found : List<&2,String> <- collect_observed(observed,root,child)
        +remaining : List<&2,String> <- collect_names(rest,root,relative)
        IO.pure(List<&2,String>,append(found,remaining))

def collect_listing(result: Result<&1,&1,U32 & String,String>, +root: String, +relative: String) -> IO(List<&2,String>):
  match result:
    case Fail{error}: IO.pure(List<&2,String>,Nil{})
    case Done{listing}: collect_names(String.lines(listing),root,relative)

@unsafe
def collect( +root: String, +relative: String) -> IO(List<&2,String>):
  do IO<List<&2,String>>:
    listing : Result<&1,&1,U32 & String,String> <- Q.list_dir(root ++ "/" ++ relative)
    collect_listing(listing,root,relative)

def digest_rows( +names: List<&2,String>, +root: String) -> IO(Result<&1,&1,U32 & String,String>):
  match names:
    case Nil{}: IO.pure(Result<&1,&1,U32 & String,String>,Done{""})
    case name <> rest:
      do IO<Result<&1,&1,U32 & String,String>>:
        +hash : String <- IO.try(String,D.HostDigest.file(root ++ "/" ++ name))
        +tail : String <- IO.try(String,digest_rows(rest,root))
        IO.pure(Result<&1,&1,U32 & String,String>,Done{name ++ " " ++ hash ++ "\n" ++ tail})

def CompileQueueArtifact.digest( +path: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +resolved : String <- IO.try(String,F.Files.realpath(path))
    +observed : String <- IO.try(String,F.Files.lstat(resolved))
    Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.eq(Q.observation_kind(observed),"dir"),
      do IO<Result<&1,&1,U32 & String,String>>:
        +names : List<&2,String> <- collect(resolved,".")
        +rows : String <- IO.try(String,digest_rows(sorted(names),resolved))
        D.HostDigest.text(rows),
      D.HostDigest.file(resolved))

def remove_children( +names: List<&2,String>, +path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match names:
    case Nil{}: F.Files.rmdir(path)
    case SNil{} <> rest: remove_children(rest,path)
    case name <> rest:
      do IO<Result<&1,&1,U32 & String,Unit>>:
        removed : Unit <- IO.try(Unit,CompileQueueArtifact.remove(path ++ "/" ++ name))
        remove_children(rest,path)

def remove_observed(observed: Result<&1,&1,U32 & String,String>, +path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match observed:
    case Fail{(code,message)}:
      Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),U32.is_eq(code,2),
        IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),
        IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(code,message)}))
    case Done{record}:
      Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),String.eq(Q.observation_kind(record),"dir"),
        do IO<Result<&1,&1,U32 & String,Unit>>:
          +names : String <- IO.try(String,Q.list_dir(path))
          remove_children(String.lines(names),path),
        F.Files.remove(path))

@unsafe
def CompileQueueArtifact.remove( +path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    observed : Result<&1,&1,U32 & String,String> <- F.Files.lstat(path)
    remove_observed(observed,path)

def copy_children( +names: List<&2,String>, +source: String, +destination: String, +mode: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  match names:
    case Nil{}: F.Files.chmod(destination,mode)
    case SNil{} <> rest: copy_children(rest,source,destination,mode)
    case name <> rest:
      do IO<Result<&1,&1,U32 & String,Unit>>:
        copied : Unit <- IO.try(Unit,CompileQueueArtifact.copy(source ++ "/" ++ name,destination ++ "/" ++ name))
        copy_children(rest,source,destination,mode)

def created_directory(created: Result<&1,&1,U32 & String,Unit>, +destination: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match created:
    case Done{unit}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case Fail{(code,message)}:
      Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),U32.is_eq(code,17),
        do IO<Result<&1,&1,U32 & String,Unit>>:
          observed : Result<&1,&1,U32 & String,String> <- F.Files.lstat(destination)
          Q.check_directory(observed,False{}),
        IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(code,message)}))

def copy_kind(kind: String, +mode: U32, +source: String, +destination: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match kind:
    case "file": F.Files.copy_file(source,destination)
    case "dir":
      do IO<Result<&1,&1,U32 & String,Unit>>:
        made : Result<&1,&1,U32 & String,Unit> <- F.Files.mkdir_mode(destination,mode)
        checked : Unit <- IO.try(Unit,created_directory(made,destination))
        +names : String <- IO.try(String,Q.list_dir(source))
        copy_children(String.lines(names),source,destination,mode)
    case "symlink":
      do IO<Result<&1,&1,U32 & String,Unit>>:
        +target : String <- IO.try(String,F.Files.readlink(source))
        F.Files.symlink(target,destination)
    case other: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(22,"unsupported artifact kind")})

def copy_observed(+record: String, source: String, destination: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  copy_kind(Q.observation_kind(record),U32.mod(Q.number(Q.at(String.split(record,Char.from_u32(9)),1)),512),source,destination)

@unsafe
def CompileQueueArtifact.copy( +source: String, +staging: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +observed : String <- IO.try(String,F.Files.lstat(source))
    copy_observed(observed,source,staging)

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
        copied : Unit <- IO.try(Unit,copy_observed(observed,source,staging))
        present : Result<&1,&1,U32 & String,String> <- F.Files.lstat(destination)
        publish_staging(present,String.eq(Q.observation_kind(observed),"dir"),staging,destination)

def CompileQueueArtifact.install( +source: String, +destination: String, +staging: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    existing : Result<&1,&1,U32 & String,String> <- F.Files.lstat(staging)
    install_absent(existing,source,destination,staging)
