import Base
import ./choice.bend as Choice
import ./compile-queue-state.bend as S
import ./compile-queue-files.bend as QF
import ../host/files.bend as F
import ../host/text.bend as T
import ./posix.bend as P

def proc_base( +pid: U32) -> String:
  "/proc/" ++ U32.show(pid)

def stat_fields( +text: String) -> List<&2,String>:
  S.words(S.last(String.split(text,Char.from_u32(41))))

def table_rows( +names: List<&2,String>, +acc: List<&2,String>) -> IO(List<&2,String>):
  match names:
    case Nil{}: IO.pure(List<&2,String>,acc)
    case +name <> rest:
      do IO<List<&2,String>>:
        +fields : List<&2,String> <- Bool.pick(IO(List<&2,String>),U32.is_gt(S.number(name),0),
          do IO<List<&2,String>>:
            +text : String <- S.read("/proc/" ++ name ++ "/stat")
            IO.pure(List<&2,String>,stat_fields(text)),IO.pure(List<&2,String>,Nil{}))
        +state : String <- IO.pure(String,S.at(fields,0))
        +valid : Bool <- IO.pure(Bool,Bool.and(Bool.not(String.is_empty(state)),Bool.not(Bool.or(String.eq(state,"Z"),String.eq(state,"X")))))
        +row : String <- IO.pure(String,"pid=" ++ name ++ "\nppid=" ++ S.at(fields,1) ++ "\nsid=" ++ S.at(fields,3) ++ "\n")
        table_rows(rest,Choice.choose(List<&2,String>,valid, _choice_unit => row <> acc, _choice_unit => acc))

def table() -> IO(List<&2,String>):
  do IO<List<&2,String>>:
    +names : List<&2,String> <- S.names("/proc")
    table_rows(names,Nil{})

def status_value( +lines: List<&2,String>, +name: String) -> Nat:
  match lines:
    case Nil{}: 0n
    case +line <> rest:
      Choice.choose(Nat,String.starts_with(line,name), _choice_unit => S.nat(S.first(S.words(String.drop(line,String.length(name))))), _choice_unit => status_value(rest,name))

def memory(+pid: U32) -> IO(Nat):
  do IO<Nat>:
    +text : String <- S.read(proc_base(pid) ++ "/status")
    +lines : List<&2,String> <- IO.pure(List<&2,String>,String.lines(text))
    +anon : Nat <- IO.pure(Nat,status_value(lines,"RssAnon:"))
    +shared : Nat <- IO.pure(Nat,status_value(lines,"RssShmem:"))
    IO.pure(Nat,Choice.choose(Nat,Nat.is_gt(Nat.add(anon,shared),0n), _choice_unit => Nat.add(anon,shared), _choice_unit => status_value(lines,"VmRSS:")))

def lookup( +rows: List<&2,String>, +pid: U32) -> String:
  match rows:
    case Nil{}: ""
    case +row <> rest: Choice.choose(String,U32.is_eq(S.number(S.field(row,"pid")),pid), _choice_unit => row, _choice_unit => lookup(rest,pid))

def contains_pid( +seen: List<&2,U32>, +pid: U32) -> Bool:
  match seen:
    case Nil{}: False{}
    case value <> rest: Bool.or(U32.is_eq(value,pid),contains_pid(rest,pid))

@unsafe

def descendant(+rows: List<&2,String>, +pid: U32, +root: U32, +seen: List<&2,U32>) -> Bool:
  Choice.choose(Bool,U32.is_eq(pid,root), _choice_unit => True{}, _choice_unit =>
    Choice.choose(Bool,Bool.or(U32.is_eq(pid,0),contains_pid(seen,pid)), _choice_unit => False{}, _choice_unit =>
      descendant(rows,S.number(S.field(lookup(rows,pid),"ppid")),root,pid <> seen)))

def measure_rows( +rows: List<&2,String>, +table: List<&2,String>, +root: U32, +tree: Bool, +total: Nat) -> IO(Nat):
  match rows:
    case Nil{}: IO.pure(Nat,total)
    case +row <> rest:
      do IO<Nat>:
        +pid : U32 <- IO.pure(U32,S.number(S.field(row,"pid")))
        +belongs : Bool <- IO.pure(Bool,Choice.choose(Bool,tree, _choice_unit => descendant(table,pid,root,Nil{}), _choice_unit => U32.is_eq(S.number(S.field(row,"sid")),root)))
        +kb : Nat <- Bool.pick(IO(Nat),belongs,memory(pid),IO.pure(Nat,0n))
        measure_rows(rest,table,root,tree,Nat.add(total,kb))

def measure(+rows: List<&2,String>, +root: U32, +tree: Bool) -> IO(Nat):
  measure_rows(rows,rows,root,tree,0n)

def memory_info() -> IO(String):
  do IO<String>:
    +text : String <- S.read("/proc/meminfo")
    +lines : List<&2,String> <- IO.pure(List<&2,String>,String.lines(text))
    +total : Nat <- IO.pure(Nat,status_value(lines,"MemTotal:"))
    +available : Nat <- IO.pure(Nat,status_value(lines,"MemAvailable:"))
    IO.pure(String,"total=" ++ Nat.show(total) ++ "\navailable=" ++ Nat.show(available) ++ "\nknown=" ++ Choice.choose(String,Nat.is_gt(total,0n), _choice_unit => "1", _choice_unit => "0") ++ "\n")

def proc_file(+pid: U32, name: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    platform : String <- IO.try(String,P.HostPosix.platform())
    Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.eq(platform,"linux"),T.Text.read(proc_base(pid) ++ "/" ++ name),IO.pure(Result<&1,&1,U32 & String,String>,Fail{(38,"process file observation requires Linux")}))

def cwd(pid: U32) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    platform : String <- IO.try(String,P.HostPosix.platform())
    Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.eq(platform,"linux"),F.Files.readlink(proc_base(pid) ++ "/cwd"),IO.pure(Result<&1,&1,U32 & String,String>,Fail{(38,"process cwd observation requires Linux")}))

def cmdline( +pid: U32) -> IO(Result<&1,&1,U32 & String,String>):
  proc_file(pid,"cmdline")

def attempt_args(+args: List<&2,String>) -> String:
  match args:
    case Nil{}: ""
    case +verb <> +rest:
      +length = List.length(&2,String,rest)
      Choice.choose(String,Bool.or(Bool.and(String.eq(verb,"__supervise"),Nat.is_eq(length,1n)),
        Bool.and(String.eq(verb,"__takeover"),Nat.is_eq(length,4n))),
        _choice_unit => S.first(rest), _choice_unit => attempt_args(rest))

def attempt( +pid: U32) -> IO(String):
  do IO<String>:
    argv : Result<&1,&1,U32 & String,String> <- cmdline(pid)
    IO.pure(String,attempt_args(S.argv_parts(String.split(S.text_or_empty(argv),Char.from_u32(0)))))

def lock_after_write( +parts: List<&2,String>) -> List<&2,String>:
  match parts:
    case Nil{}: Nil{}
    case +part <> +rest: Choice.choose(List<&2,String>,String.eq(part,"WRITE"), _choice_unit => rest, _choice_unit => lock_after_write(rest))

def lock_pid(+line: String, +inode: String, +waiter: Bool) -> U32:
  +parts = lock_after_write(S.words(line))
  +valid = Bool.and(String.contains(line,"FLOCK"),Bool.and(Bool.not(Bool.xor(String.contains(line,"->"),waiter)),String.eq(S.last(String.split(S.at(parts,1),Char.from_u32(58))),inode)))
  Choice.choose(U32,valid, _choice_unit => S.number(S.first(parts)), _choice_unit => 0)

def lock_rows( +lines: List<&2,String>, +inode: String, +waiter: Bool) -> List<&2,U32>:
  match lines:
    case Nil{}: Nil{}
    case line <> +rest:
      +pid = lock_pid(line,inode,waiter)
      Choice.choose(List<&2,U32>,U32.is_gt(pid,0), _choice_unit => pid <> lock_rows(rest,inode,waiter), _choice_unit => lock_rows(rest,inode,waiter))

def locks(+state: String, +waiter: Bool) -> IO(List<&2,U32>):
  do IO<List<&2,U32>>:
    observed : Result<&1,&1,U32 & String,String> <- F.Files.lstat(state ++ "/heavy.lock")
    +text : String <- S.read("/proc/locks")
    IO.pure(List<&2,U32>,lock_rows(String.lines(text),S.at(String.split(S.text_or_empty(observed),Char.from_u32(9)),3),waiter))

def first_pid( +pids: List<&2,U32>) -> U32:
  match pids:
    case Nil{}: 0
    case pid <> rest: pid

def legacy(+state: String) -> IO(String):
  do IO<String>:
    +pids : List<&2,U32> <- locks(state,False{})
    +pid : U32 <- IO.pure(U32,first_pid(pids))
    +attempt : String <- attempt(pid)
    +meta : String <- S.read(attempt ++ "/meta")
    IO.pure(String,"pid=" ++ U32.show(pid) ++ "\nentry=" ++ S.field(meta,"entry") ++ "\n")

def env_field( +values: List<&2,String>, +name: String) -> String:
  match values:
    case Nil{}: ""
    case +value <> rest:
      +prefix = name ++ "="
      Choice.choose(String,String.starts_with(value,prefix), _choice_unit => String.drop(value,String.length(prefix)), _choice_unit => env_field(rest,name))

def env_present(values: List<&2,String>, +name: String) -> Bool:
  match values:
    case Nil{}: False{}
    case value <> rest: Bool.or(String.starts_with(value,name ++ "="),env_present(rest,name))

def environ( +pid: U32, +name: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +bytes : String <- IO.try(String,proc_file(pid,"environ"))
    +values : List<&2,String> <- IO.pure(List<&2,String>,String.split(bytes,Char.from_u32(0)))
    IO.pure(Result<&1,&1,U32 & String,String>,Choice.choose(Result<&1,&1,U32 & String,String>,env_present(values,name), _choice_unit => Done{env_field(values,name)}, _choice_unit => Fail{(2,"process environment variable is absent")}))

def hidden_match_1(signaled: Result<&1,&1,U32 & String,Unit>) -> IO(Bool):
  match signaled:
    case Done{unit}: IO.pure(Bool,True{})
    case Fail{(number,message)}: IO.pure(Bool,U32.is_eq(number,1))

def hidden_match_2(+pid: U32, observed: Result<&1,&1,U32 & String,String>) -> IO(Bool):
  match observed:
    case Done{record}: IO.pure(Bool,False{})
    case Fail{(code,message)}:
      Bool.pick(IO(Bool),U32.is_eq(code,2),
        do IO<Bool>:
          signaled : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.signal_pid(pid,0)
          hidden_match_1(signaled),
        IO.pure(Bool,False{}))

def hidden(+pid: U32) -> IO(Bool):
  do IO<Bool>:
    observed : Result<&1,&1,U32 & String,String> <- F.Files.lstat(proc_base(pid))
    hidden_match_2(pid, observed)
