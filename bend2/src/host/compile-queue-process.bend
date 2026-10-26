import Base
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
        table_rows(rest,Bool.pick(List<&2,String>,valid,row <> acc,acc))

def table() -> IO(List<&2,String>):
  do IO<List<&2,String>>:
    +names : List<&2,String> <- S.names("/proc")
    table_rows(names,Nil{})

def status_value( +lines: List<&2,String>, +name: String) -> Nat:
  match lines:
    case Nil{}: 0n
    case +line <> rest:
      Bool.pick(Nat,String.starts_with(line,name),S.nat(S.first(S.words(String.drop(line,String.length(name))))),status_value(rest,name))

def memory(+pid: U32) -> IO(Nat):
  do IO<Nat>:
    +text : String <- S.read(proc_base(pid) ++ "/status")
    +lines : List<&2,String> <- IO.pure(List<&2,String>,String.lines(text))
    +anon : Nat <- IO.pure(Nat,status_value(lines,"RssAnon:"))
    +shared : Nat <- IO.pure(Nat,status_value(lines,"RssShmem:"))
    IO.pure(Nat,Bool.pick(Nat,Nat.is_gt(Nat.add(anon,shared),0n),Nat.add(anon,shared),status_value(lines,"VmRSS:")))

def lookup( +rows: List<&2,String>, +pid: U32) -> String:
  match rows:
    case Nil{}: ""
    case +row <> rest: Bool.pick(String,U32.is_eq(S.number(S.field(row,"pid")),pid),row,lookup(rest,pid))

def contains_pid( +seen: List<&2,U32>, +pid: U32) -> Bool:
  match seen:
    case Nil{}: False{}
    case value <> rest: Bool.or(U32.is_eq(value,pid),contains_pid(rest,pid))

@unsafe
def descendant(+rows: List<&2,String>, +pid: U32, +root: U32, +seen: List<&2,U32>) -> Bool:
  Bool.pick(Bool,U32.is_eq(pid,root),True{},
    Bool.pick(Bool,Bool.or(U32.is_eq(pid,0),contains_pid(seen,pid)),False{},
      descendant(rows,S.number(S.field(lookup(rows,pid),"ppid")),root,pid <> seen)))

def measure_rows( +rows: List<&2,String>, +table: List<&2,String>, +root: U32, +tree: Bool, +total: Nat) -> IO(Nat):
  match rows:
    case Nil{}: IO.pure(Nat,total)
    case +row <> rest:
      do IO<Nat>:
        +pid : U32 <- IO.pure(U32,S.number(S.field(row,"pid")))
        +belongs : Bool <- IO.pure(Bool,Bool.pick(Bool,tree,descendant(table,pid,root,Nil{}),U32.is_eq(S.number(S.field(row,"sid")),root)))
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
    IO.pure(String,"total=" ++ Nat.show(total) ++ "\navailable=" ++ Nat.show(available) ++ "\nknown=" ++ Bool.pick(String,Nat.is_gt(total,0n),"1","0") ++ "\n")

def cmdline( +pid: U32) -> IO(Result<&1,&1,U32 & String,String>):
  T.Text.read(proc_base(pid) ++ "/cmdline")

def attempt_args( +args: List<&2,String>) -> String:
  match args:
    case verb <> attempt <> Nil{}: Bool.pick(String,String.eq(verb,"__supervise"),attempt,"")
    case verb <> attempt <> old <> start <> queued <> Nil{}: Bool.pick(String,String.eq(verb,"__takeover"),attempt,"")
    case value <> rest: attempt_args(rest)
    case Nil{}: ""

def attempt( +pid: U32) -> IO(String):
  do IO<String>:
    argv : Result<&1,&1,U32 & String,String> <- cmdline(pid)
    IO.pure(String,attempt_args(S.argv_parts(String.split(S.text_or_empty(argv),Char.from_u32(0)))))

def lock_after_write( +parts: List<&2,String>) -> List<&2,String>:
  match parts:
    case Nil{}: Nil{}
    case +part <> rest: Bool.pick(List<&2,String>,String.eq(part,"WRITE"),rest,lock_after_write(rest))

def lock_pid(+line: String, +inode: String, +waiter: Bool) -> U32:
  +parts = lock_after_write(S.words(line))
  +valid = Bool.and(String.contains(line,"FLOCK"),Bool.and(Bool.not(Bool.xor(String.contains(line,"->"),waiter)),String.eq(S.last(String.split(S.at(parts,1),Char.from_u32(58))),inode)))
  Bool.pick(U32,valid,S.number(S.first(parts)),0)

def lock_rows( +lines: List<&2,String>, +inode: String, +waiter: Bool) -> List<&2,U32>:
  match lines:
    case Nil{}: Nil{}
    case line <> rest:
      +pid = lock_pid(line,inode,waiter)
      Bool.pick(List<&2,U32>,U32.is_gt(pid,0),pid <> lock_rows(rest,inode,waiter),lock_rows(rest,inode,waiter))

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
      Bool.pick(String,String.starts_with(value,prefix),String.drop(value,String.length(prefix)),env_field(rest,name))

def env_present(values: List<&2,String>, +name: String) -> Bool:
  match values:
    case Nil{}: False{}
    case value <> rest: Bool.or(String.starts_with(value,name ++ "="),env_present(rest,name))

def environ( +pid: U32, +name: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +bytes : String <- IO.try(String,T.Text.read(proc_base(pid) ++ "/environ"))
    +values = String.split(bytes,Char.from_u32(0))
    IO.pure(Result<&1,&1,U32 & String,String>,Bool.pick(Result<&1,&1,U32 & String,String>,env_present(values,name),Done{env_field(values,name)},Fail{(2,"process environment variable is absent")}))

def hidden(+pid: U32) -> IO(Bool):
  do IO<Bool>:
    observed : Result<&1,&1,U32 & String,String> <- F.Files.lstat(proc_base(pid))
    match observed:
      case Done{record}: IO.pure(Bool,False{})
      case Fail{(code,message)}:
        Bool.pick(IO(Bool),U32.is_eq(code,2),
          do IO<Bool>:
            signaled : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.signal_pid(pid,0)
            match signaled:
              case Done{unit}: IO.pure(Bool,True{})
              case Fail{(number,message)}: IO.pure(Bool,U32.is_eq(number,1)),
          IO.pure(Bool,False{}))
