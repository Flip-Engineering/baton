import Base
import ../host/text.bend as T
import ../host/files.bend as F
import ./compile-queue-files.bend as QF
import ./posix.bend as P
import ./wide.bend as W

def field_lines( +lines: List<&2,String>, +name: String) -> String:
  match lines:
    case Nil{}: ""
    case +line <> rest:
      +prefix = name ++ "="
      Bool.pick(String,String.starts_with(line,prefix),String.drop(line,String.length(prefix)),field_lines(rest,name))

def field(+text: String, +name: String) -> String:
  field_lines(String.lines(text),name)

def decimal(text: String, acc: Nat) -> Nat:
  match text:
    case SNil{}: acc
    case SCon{+char,rest}:
      Bool.pick(Nat,Char.is_digit(char),decimal(rest,Nat.add(Nat.mul(acc,10n),U32.to_nat(U32.sub(Char.to_u32(char),48)))),0n)

def nat(text: String) -> Nat:
  decimal(text,0n)

def number( +text: String) -> U32:
  QF.number(text)

def first( +parts: List<&2,String>) -> String:
  QF.first(parts)

def at( +parts: List<&2,String>, +index: U32) -> String:
  QF.at(parts,index)

def last( +parts: List<&2,String>) -> String:
  match parts:
    case Nil{}: ""
    case value <> Nil{}: value
    case value <> rest: last(rest)

def basename(+path: String) -> String:
  last(String.split(path,Char.from_u32(47)))

def dirname_parts(parts: List<&2,String>, +acc: String, first: Bool) -> String:
  match parts:
    case Nil{}: acc
    case part <> Nil{}: acc
    case +part <> next <> rest: dirname_parts(next <> rest,Bool.pick(String,first,part,acc ++ "/" ++ part),False{})

def dirname(path: String) -> String:
  dirname_parts(String.split(path,Char.from_u32(47)),"",True{})

def state(attempt: String) -> String:
  dirname(dirname(dirname(dirname(attempt))))

def keydir(attempt: String) -> String:
  dirname(dirname(attempt))

def key( +attempt: String) -> String:
  basename(keydir(attempt))

def text_or_empty(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Done{value}: value
    case Fail{error}: ""

def read( +path: String) -> IO(String):
  do IO<String>:
    result : Result<&1,&1,U32 & String,String> <- T.Text.read(path)
    IO.pure(String,text_or_empty(result))

def names( +path: String) -> IO(List<&2,String>):
  do IO<List<&2,String>>:
    result : Result<&1,&1,U32 & String,String> <- QF.list_dir(path)
    IO.pure(List<&2,String>,QF.nonempty(String.lines(text_or_empty(result))))

def remove( +path: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,Unit> <- F.Files.remove(path)
    IO.pure(Unit,Unit{})

def write( +path: String, +bytes: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,Unit> <- F.Files.write_shared(path,bytes)
    IO.pure(Unit,Unit{})

def words_go( +text: String, +acc: String, +out: List<&2,String>) -> List<&2,String>:
  match text:
    case SNil{}: List.reverse(&2,String,Bool.pick(List<&2,String>,String.is_empty(acc),out,acc <> out))
    case SCon{+char,+rest}:
      Bool.pick(List<&2,String>,Char.is_space(char),
        words_go(rest,"",Bool.pick(List<&2,String>,String.is_empty(acc),out,acc <> out)),
        words_go(rest,acc ++ Char.show(char),out))

def words( +text: String) -> List<&2,String>:
  words_go(text,"",Nil{})

@unsafe
def pad(+text: String, +width: Nat) -> String:
  Bool.pick(String,Nat.is_ge(String.length(text),width),text,pad("0" ++ text,width))

def id( +queued: String, +pid: U32) -> String:
  pad(queued,20n) ++ "-" ++ pad(U32.show(pid),10n)

# FNV-1a preserves the names of the existing history records. Each Unicode
# character is encoded to UTF-8 before the byte recurrence is applied.
def fnv_byte(hash: W.Wide64, byte: U32) -> W.Wide64:
  W.fnv_step(hash,byte)

def fnv_char(+code: U32, +hash: W.Wide64) -> W.Wide64:
  Bool.pick(W.Wide64,U32.is_lt(code,128),fnv_byte(hash,code),
    Bool.pick(W.Wide64,U32.is_lt(code,2048),
      fnv_byte(fnv_byte(hash,U32.add(192,U32.div(code,64))),U32.add(128,U32.mod(code,64))),
      Bool.pick(W.Wide64,U32.is_lt(code,65536),
        fnv_byte(fnv_byte(fnv_byte(hash,U32.add(224,U32.div(code,4096))),U32.add(128,U32.mod(U32.div(code,64),64))),U32.add(128,U32.mod(code,64))),
        fnv_byte(fnv_byte(fnv_byte(fnv_byte(hash,U32.add(240,U32.div(code,262144))),U32.add(128,U32.mod(U32.div(code,4096),64))),U32.add(128,U32.mod(U32.div(code,64),64))),U32.add(128,U32.mod(code,64))))))

def fnv( +text: String, +hash: W.Wide64) -> W.Wide64:
  match text:
    case SNil{}: hash
    case SCon{char,rest}: fnv(rest,fnv_char(Char.to_u32(char),hash))

def hash(text: String) -> String:
  W.hex(fnv(text,W.Wide64{3421674724,2216829733}))

def entry_key(+entry: String) -> String:
  Bool.pick(String,String.is_empty(entry),"",hash(Bool.pick(String,String.starts_with(entry,"/"),basename(entry),entry)))

def shape_token(+token: String) -> String:
  Bool.pick(String,Bool.and(String.starts_with(token,"/"),
    Bool.not(Bool.or(String.contains(token," "),Bool.or(String.contains(token,"\n"),String.contains(token,"\t"))))),basename(token),token)

def shape_tokens( +tokens: List<&2,String>, +hash: W.Wide64) -> W.Wide64:
  match tokens:
    case Nil{}: hash
    case token <> rest: shape_tokens(rest,fnv(shape_token(token) ++ "\n",hash))

def argv_parts(parts: List<&2,String>) -> List<&2,String>:
  match parts:
    case SNil{} <> Nil{}: Nil{}
    case value <> rest: value <> argv_parts(rest)
    case Nil{}: Nil{}

def shape_argv(result: Result<&1,&1,U32 & String,String>, +attempt: String) -> IO(List<&2,String>):
  match result:
    case Done{bytes}: IO.pure(List<&2,String>,argv_parts(String.split(bytes,Char.from_u32(0))))
    case Fail{error}:
      do IO<List<&2,String>>:
        +bytes : String <- read(attempt ++ "/command")
        IO.pure(List<&2,String>,QF.nonempty(String.lines(bytes)))

def shape(+attempt: String) -> IO(String):
  do IO<String>:
    +meta : String <- read(attempt ++ "/meta")
    argv : Result<&1,&1,U32 & String,String> <- T.Text.read(attempt ++ "/argv")
    +tokens : List<&2,String> <- shape_argv(argv,attempt)
    +entry : String <- IO.pure(String,field(meta,"entry"))
    +head : String <- IO.pure(String,"kind=" ++ field(meta,"kind") ++ "\nentry=" ++ Bool.pick(String,String.starts_with(entry,"/"),basename(entry),entry) ++ "\n")
    IO.pure(String,W.hex(shape_tokens(tokens,fnv(head,W.Wide64{3421674724,2216829733}))))

def mode(+attempt: String) -> IO(String):
  do IO<String>:
    argv : Result<&1,&1,U32 & String,String> <- T.Text.read(attempt ++ "/argv")
    +tokens : List<&2,String> <- shape_argv(argv,attempt)
    IO.pure(String,Bool.pick(String,String.contains(String.concat(tokens),"--check-only"),"check","full"))

def name_char(+char: Char) -> Bool:
  Bool.or(Char.is_alpha(char),Bool.or(Char.is_digit(char),String.contains("._-",Char.show(char))))

def path_char(+char: Char) -> Bool:
  Bool.or(name_char(char),String.contains("/@",Char.show(char)))

def starts_name( +text: String) -> Bool:
  match text:
    case SNil{}: False{}
    case SCon{char,rest}: name_char(char)

def root_length( +roots: List<&2,String>, +text: String, +best: Nat) -> Nat:
  match roots:
    case Nil{}: best
    case +root <> rest:
      +size = String.length(root)
      +fits = Bool.and(String.starts_with(root,"/"),Bool.and(Nat.is_gt(size,1n),
        Bool.and(String.starts_with(text,root),Bool.not(starts_name(String.drop(text,size))))))
      root_length(rest,text,Bool.pick(Nat,fits,Nat.max(best,size),best))

@unsafe
def replace_roots(+text: String, +roots: List<&2,String>) -> String:
  match text:
    case SNil{}: ""
    case SCon{char,rest}:
      +size = root_length(roots,text,0n)
      Bool.pick(String,Nat.is_gt(size,0n),"@root" ++ replace_roots(String.drop(text,size),roots),Char.show(char) ++ replace_roots(rest,roots))

def name_length( +text: String) -> Nat:
  match text:
    case SNil{}: 0n
    case SCon{char,rest}: Bool.pick(Nat,name_char(char),Nat.add(1n,name_length(rest)),0n)

def hex_length( +text: String) -> Nat:
  match text:
    case SNil{}: 0n
    case SCon{char,rest}: Bool.pick(Nat,String.contains("0123456789abcdef",Char.show(char)),Nat.add(1n,hex_length(rest)),0n)

def trim_path( +text: String) -> String:
  match text:
    case SNil{}: ""
    case SCon{+char,+rest}: Bool.pick(String,path_char(char),trim_path(rest),SCon{char,rest})

def pattern_length(+text: String, +attempts: Bool) -> Nat:
  match attempts:
    case False{}:
      Bool.pick(Nat,String.starts_with(text,"/worktrees/"),Nat.add(11n,name_length(String.drop(text,11n))),0n)
    case True{}:
      Bool.pick(Nat,Bool.and(String.starts_with(text,"/keys/"),
        Bool.and(Nat.is_eq(hex_length(String.drop(text,6n)),64n),String.starts_with(String.drop(text,70n),"/runs/"))),
        Nat.add(76n,name_length(String.drop(text,76n))),0n)

@unsafe
def replace_pattern(+text: String, +attempts: Bool, +acc: String) -> String:
  match text:
    case SNil{}: String.reverse(acc)
    case SCon{char,rest}:
      +size = pattern_length(text,attempts)
      Bool.pick(String,Nat.is_gt(size,0n),
        replace_pattern(String.drop(text,size),attempts,String.reverse(Bool.pick(String,attempts,"@attempt","@worktree")) ++ trim_path(acc)),
        replace_pattern(rest,attempts,SCon{char,acc}))

def group_text( +text: String, +roots: String) -> String:
  replace_pattern(replace_pattern(replace_roots(text,String.lines(roots)),False{},""),True{},"")

def without( +lines: List<&2,String>, +name: String) -> String:
  match lines:
    case Nil{}: ""
    case +line <> rest: Bool.pick(String,Bool.or(String.starts_with(line,name ++ "="),String.is_empty(line)),"",line ++ "\n") ++ without(rest,name)

def put( +text: String, +name: String, +value: String) -> String:
  name ++ "=" ++ value ++ "\n" ++ without(String.lines(text),name)
