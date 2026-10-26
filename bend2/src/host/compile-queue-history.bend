import Base
import ./compile-queue-state.bend as S
import ./compile-queue-files.bend as QF
import ../host/files.bend as F
import ./posix.bend as P

def maybe_peak(+text: String) -> Maybe<Nat>:
  Nat.read(S.field(text,"peak_kb"))

def raise_value(+path: String, +peak: Nat) -> IO(Unit):
  do IO<Unit>:
    +old : String <- S.read(path)
    Bool.pick(IO(Unit),Nat.is_gt(peak,S.nat(S.field(old,"peak_kb"))),S.write(path,"peak_kb=" ++ Nat.show(peak) ++ "\n"),IO.pure(Unit,Unit{}))

def tier_paths(+state: String, +group: String, +shape: String, +entry: String, +mode: String, +compiler: String, +kind: String) -> List<&2,String>:
  +base = state ++ "/peaks/"
  +entry_id = S.entry_key(entry)
  Bool.pick(String,Bool.and(Bool.not(String.is_empty(kind)),Bool.not(String.is_empty(entry_id))),base ++ "en." ++ kind ++ "." ++ entry_id,"")
  <> Bool.pick(String,Bool.and(Bool.not(String.is_empty(kind)),Bool.and(Bool.not(String.is_empty(entry_id)),Bool.not(String.is_empty(mode)))),base ++ "em." ++ kind ++ "." ++ entry_id ++ "." ++ mode,"")
  <> Bool.pick(String,Bool.not(String.is_empty(group)),base ++ group,"")
  <> Bool.pick(String,Bool.and(Bool.not(String.is_empty(kind)),Bool.not(String.is_empty(shape))),base ++ "sh." ++ kind ++ "." ++ shape,"")
  <> Bool.pick(String,Bool.and(Bool.not(String.is_empty(kind)),Bool.not(String.is_empty(compiler))),base ++ "kc." ++ kind ++ "." ++ compiler,"")
  <> Bool.pick(String,Bool.not(String.is_empty(kind)),base ++ "k." ++ kind,"") <> Nil{}

def raise_paths( +paths: List<&2,String>, +peak: Nat) -> IO(Unit):
  match paths:
    case Nil{}: IO.pure(Unit,Unit{})
    case +path <> rest:
      do IO<Unit>:
        raised : Unit <- Bool.pick(IO(Unit),String.is_empty(path),IO.pure(Unit,Unit{}),raise_value(path,peak))
        raise_paths(rest,peak)

def raise_attempt(+attempt: String, +peak: Nat, +failed: Bool) -> IO(Unit):
  do IO<Unit>:
    +meta : String <- S.read(attempt ++ "/meta")
    +group : String <- S.read(attempt ++ "/group")
    +shape : String <- S.shape(attempt)
    +mode : String <- S.mode(attempt)
    own : Unit <- raise_value(S.keydir(attempt) ++ "/peak",peak)
    Bool.pick(IO(Unit),failed,IO.pure(Unit,Unit{}),
      raise_paths(tier_paths(S.state(attempt),S.field(group,"group"),shape,S.field(meta,"entry"),mode,S.field(group,"compiler"),S.field(meta,"kind")),peak))

def expected_result(result: Maybe<Nat>, rest: List<&2,String>) -> IO(Maybe<Nat>):
  match result:
    case Some{peak}: IO.pure(Maybe<Nat>,Some{peak})
    case None{}: expected_paths(rest)

def expected_paths( +paths: List<&2,String>) -> IO(Maybe<Nat>):
  match paths:
    case Nil{}: IO.pure(Maybe<Nat>,None{})
    case +path <> rest:
      do IO<Maybe<Nat>>:
        +text : String <- Bool.pick(IO(String),String.is_empty(path),IO.pure(String,""),S.read(path))
        expected_result(maybe_peak(text),rest)

def expected(+state: String, +ticket: String) -> IO(Maybe<Nat>):
  +base = state ++ "/peaks/"
  +kind = S.field(ticket,"kind")
  +entry = S.entry_key(S.field(ticket,"entry"))
  +mode = S.field(ticket,"mode")
  +shape = S.field(ticket,"shape")
  +group = S.field(ticket,"group")
  +compiler = S.field(ticket,"compiler")
  +paths = (state ++ "/keys/" ++ S.field(ticket,"key") ++ "/peak")
    <> Bool.pick(String,String.is_empty(group),"",base ++ group)
    <> Bool.pick(String,Bool.or(String.is_empty(kind),String.is_empty(shape)),"",base ++ "sh." ++ kind ++ "." ++ shape)
    <> Bool.pick(String,Bool.or(String.is_empty(kind),Bool.or(String.is_empty(entry),String.is_empty(mode))),"",base ++ "em." ++ kind ++ "." ++ entry ++ "." ++ mode)
    <> Bool.pick(String,Bool.or(String.is_empty(kind),String.is_empty(entry)),"",base ++ "en." ++ kind ++ "." ++ entry)
    <> Bool.pick(String,Bool.or(String.is_empty(kind),String.is_empty(compiler)),"",base ++ "kc." ++ kind ++ "." ++ compiler)
    <> Bool.pick(String,String.is_empty(kind),"",base ++ "k." ++ kind) <> Nil{}
  expected_paths(paths)

# The lock is acquired by the caller after admission directories are checked.

def record_match_1(+attempt: String, +peak: Nat, +failed: Bool, locked: Result<&1,&1,U32 & String,U32>) -> IO(Unit):
  match locked:
    case Fail{error}: IO.pure(Unit,Unit{})
    case Done{fd}:
      do IO<Unit>:
        raised : Unit <- raise_attempt(attempt,peak,failed)
        closed : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.lock_release(fd)
        IO.pure(Unit,Unit{})

def record(+attempt: String, +peak: Nat, +failed: Bool) -> IO(Unit):
  Bool.pick(IO(Unit),Nat.is_gt(peak,0n),
    do IO<Unit>:
      saved : Unit <- S.write(attempt ++ "/peak","peak_kb=" ++ Nat.show(peak) ++ "\n")
      locked : Result<&1,&1,U32 & String,U32> <- P.HostPosix.lock_acquire(S.state(attempt) ++ "/admission/lock")
      record_match_1(attempt, peak, failed, locked),
    IO.pure(Unit,Unit{}))

def clear_paths( +names: List<&2,String>, +directory: String) -> IO(Unit):
  match names:
    case Nil{}: IO.pure(Unit,Unit{})
    case name <> rest:
      do IO<Unit>:
        removed : Unit <- S.remove(directory ++ "/" ++ name)
        clear_paths(rest,directory)

def backfill_runs( +names: List<&2,String>, +directory: String, +count: Nat) -> IO(Nat):
  match names:
    case Nil{}: IO.pure(Nat,count)
    case name <> rest:
      do IO<Nat>:
        +attempt : String <- IO.pure(String,directory ++ "/" ++ name)
        +text : String <- S.read(attempt ++ "/peak")
        +peak : Nat <- IO.pure(Nat,S.nat(S.field(text,"peak_kb")))
        +result : String <- S.read(attempt ++ "/result")
        raised : Unit <- Bool.pick(IO(Unit),Nat.is_gt(peak,0n),raise_attempt(attempt,peak,Bool.not(String.eq(S.field(result,"status"),"completed"))),IO.pure(Unit,Unit{}))
        backfill_runs(rest,directory,Bool.pick(Nat,Nat.is_gt(peak,0n),Nat.add(count,1n),count))

def backfill_keys( +names: List<&2,String>, +directory: String, +count: Nat) -> IO(Nat):
  match names:
    case Nil{}: IO.pure(Nat,count)
    case name <> rest:
      do IO<Nat>:
        +runs : String <- IO.pure(String,directory ++ "/" ++ name ++ "/runs")
        +children : List<&2,String> <- S.names(runs)
        +next : Nat <- backfill_runs(S.visible(children),runs,count)
        backfill_keys(rest,directory,next)

def backfill_locked(+state: String) -> IO(String):
  do IO<String>:
    +peaks : List<&2,String> <- S.names(state ++ "/peaks")
    cleared : Unit <- clear_paths(S.visible(peaks),state ++ "/peaks")
    +keys : List<&2,String> <- S.names(state ++ "/keys")
    +count : Nat <- backfill_keys(S.visible(keys),state ++ "/keys",0n)
    IO.pure(String,"backfilled runs=" ++ Nat.show(count) ++ "\n")
