import Base
import ./choice.bend as Choice
import ./compile-queue-state.bend as S
import ./compile-queue-files.bend as QF
import ../host/files.bend as F
import ./posix.bend as P

def maybe_peak(+text: String) -> Maybe<&2,Nat>:
  Nat.read(S.field(text,"peak_kb"))

def raise_value(+path: String, +peak: Nat) -> IO(Unit):
  do IO<Unit>:
    +old : String <- S.read(path)
    Bool.pick(IO(Unit),Nat.is_gt(peak,S.nat(S.field(old,"peak_kb"))),S.write(path,"peak_kb=" ++ Nat.show(peak) ++ "\n"),IO.pure(Unit,Unit{}))

def tier_paths(+state: String, +group: String, +shape: String, +entry: String, +mode: String, +compiler: String, +kind: String) -> List<&2,String>:
  +base = state ++ "/peaks/"
  +entry_id = S.entry_key(entry)
  Choice.choose(String,Bool.and(Bool.not(String.is_empty(kind)),Bool.not(String.is_empty(entry_id))), _choice_unit => base ++ "en." ++ kind ++ "." ++ entry_id, _choice_unit => "")
  <> Choice.choose(String,Bool.and(Bool.not(String.is_empty(kind)),Bool.and(Bool.not(String.is_empty(entry_id)),Bool.not(String.is_empty(mode)))), _choice_unit => base ++ "em." ++ kind ++ "." ++ entry_id ++ "." ++ mode, _choice_unit => "")
  <> Choice.choose(String,Bool.not(String.is_empty(group)), _choice_unit => base ++ group, _choice_unit => "")
  <> Choice.choose(String,Bool.and(Bool.not(String.is_empty(kind)),Bool.not(String.is_empty(shape))), _choice_unit => base ++ "sh." ++ kind ++ "." ++ shape, _choice_unit => "")
  <> Choice.choose(String,Bool.and(Bool.not(String.is_empty(kind)),Bool.not(String.is_empty(compiler))), _choice_unit => base ++ "kc." ++ kind ++ "." ++ compiler, _choice_unit => "")
  <> Choice.choose(String,Bool.not(String.is_empty(kind)), _choice_unit => base ++ "k." ++ kind, _choice_unit => "") <> Nil{}

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

@unsafe
def expected_result(~again_expected_paths: (@+paths: List<&2,String> -> IO(Maybe<&2,Nat>)), result: Maybe<&2,Nat>, rest: List<&2,String>) -> IO(Maybe<&2,Nat>):
  match result:
    case Some{peak}: IO.pure(Maybe<&2,Nat>,Some{peak})
    case None{}: again_expected_paths(rest)

@unsafe
def expected_paths( +paths: List<&2,String>) -> IO(Maybe<&2,Nat>):
  match paths:
    case Nil{}: IO.pure(Maybe<&2,Nat>,None{})
    case +path <> rest:
      do IO<Maybe<&2,Nat>>:
        +text : String <- Bool.pick(IO(String),String.is_empty(path),IO.pure(String,""),S.read(path))
        expected_result(expected_paths, maybe_peak(text),rest)

def expected(+state: String, +ticket: String) -> IO(Maybe<&2,Nat>):
  +base = state ++ "/peaks/"
  +kind = S.field(ticket,"kind")
  +entry = S.entry_key(S.field(ticket,"entry"))
  +mode = S.field(ticket,"mode")
  +shape = S.field(ticket,"shape")
  +group = S.field(ticket,"group")
  +compiler = S.field(ticket,"compiler")
  +paths : List<&2,String> = (state ++ "/keys/" ++ S.field(ticket,"key") ++ "/peak")
    <> Choice.choose(String,String.is_empty(group), _choice_unit => "", _choice_unit => base ++ group)
    <> Choice.choose(String,Bool.or(String.is_empty(kind),String.is_empty(shape)), _choice_unit => "", _choice_unit => base ++ "sh." ++ kind ++ "." ++ shape)
    <> Choice.choose(String,Bool.or(String.is_empty(kind),Bool.or(String.is_empty(entry),String.is_empty(mode))), _choice_unit => "", _choice_unit => base ++ "em." ++ kind ++ "." ++ entry ++ "." ++ mode)
    <> Choice.choose(String,Bool.or(String.is_empty(kind),String.is_empty(entry)), _choice_unit => "", _choice_unit => base ++ "en." ++ kind ++ "." ++ entry)
    <> Choice.choose(String,Bool.or(String.is_empty(kind),String.is_empty(compiler)), _choice_unit => "", _choice_unit => base ++ "kc." ++ kind ++ "." ++ compiler)
    <> Choice.choose(String,String.is_empty(kind), _choice_unit => "", _choice_unit => base ++ "k." ++ kind) <> Nil{}
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
        backfill_runs(rest,directory,Choice.choose(Nat,Nat.is_gt(peak,0n), _choice_unit => Nat.add(count,1n), _choice_unit => count))

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
