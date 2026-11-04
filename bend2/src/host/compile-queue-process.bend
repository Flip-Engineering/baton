import Base
import ./choice.bend as Choice
import ../host/files.bend as F
import ../host/text.bend as T
import ./posix.bend as P

def proc_base(+pid: U32) -> String:
  "/proc/" ++ U32.show(pid)

def proc_file(+pid: U32, name: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    platform : String <- IO.try(String,P.HostPosix.platform())
    Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.eq(platform,"linux"),
      T.Text.read(proc_base(pid) ++ "/" ++ name),
      IO.pure(Result<&1,&1,U32 & String,String>,Fail{(38,"process file observation requires Linux")}))

def cwd(+pid: U32) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    platform : String <- IO.try(String,P.HostPosix.platform())
    Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.eq(platform,"linux"),
      F.Files.readlink(proc_base(pid) ++ "/cwd"),
      IO.pure(Result<&1,&1,U32 & String,String>,Fail{(38,"process cwd observation requires Linux")}))

def cmdline(+pid: U32) -> IO(Result<&1,&1,U32 & String,String>):
  proc_file(pid,"cmdline")

def env_field(+values: List<&2,String>, +name: String) -> String:
  match values:
    case Nil{}: ""
    case +value <> rest:
      +prefix = name ++ "="
      Choice.choose(String,String.starts_with(value,prefix), _choice_unit => String.drop(value,String.length(prefix)), _choice_unit => env_field(rest,name))

def env_present(values: List<&2,String>, +name: String) -> Bool:
  match values:
    case Nil{}: False{}
    case value <> rest: Bool.or(String.starts_with(value,name ++ "="),env_present(rest,name))

def environ(+pid: U32, +name: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +bytes : String <- IO.try(String,proc_file(pid,"environ"))
    +values : List<&2,String> <- IO.pure(List<&2,String>,String.split(bytes,Char.from_u32(0)))
    IO.pure(Result<&1,&1,U32 & String,String>,Choice.choose(Result<&1,&1,U32 & String,String>,env_present(values,name), _choice_unit => Done{env_field(values,name)}, _choice_unit => Fail{(2,"process environment variable is absent")}))
