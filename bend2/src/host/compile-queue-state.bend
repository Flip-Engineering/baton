import Base
import ./choice.bend as Choice
import ../host/text.bend as T
import ./compile-queue-files.bend as QF

def field_lines(+lines: List<&2,String>, +name: String) -> String:
  match lines:
    case Nil{}: ""
    case +line <> rest:
      +prefix = name ++ "="
      Choice.choose(String,String.starts_with(line,prefix), _choice_unit => String.drop(line,String.length(prefix)), _choice_unit => field_lines(rest,name))

def field(+text: String, +name: String) -> String:
  field_lines(String.lines(text),name)

def decimal(text: String, acc: Nat) -> Nat:
  match text:
    case SNil{}: acc
    case SCon{+char,rest}:
      Choice.choose(Nat,Char.is_digit(char), _choice_unit => decimal(rest,Nat.add(Nat.mul(acc,10n),U32.to_nat(U32.sub(Char.to_u32(char),48)))), _choice_unit => 0n)

def nat(text: String) -> Nat:
  decimal(text,0n)

def number(+text: String) -> U32:
  QF.number(text)

def first(+parts: List<&2,String>) -> String:
  QF.first(parts)

def at(+parts: List<&2,String>, +index: U32) -> String:
  QF.at(parts,index)

def last(+parts: List<&2,String>) -> String:
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
    case +part <> next <> rest: dirname_parts(next <> rest,Choice.choose(String,first, _choice_unit => part, _choice_unit => acc ++ "/" ++ part),False{})

def dirname(path: String) -> String:
  dirname_parts(String.split(path,Char.from_u32(47)),"",True{})

def text_or_empty(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Done{value}: value
    case Fail{error}: ""

def read(+path: String) -> IO(String):
  do IO<String>:
    result : Result<&1,&1,U32 & String,String> <- T.Text.read(path)
    IO.pure(String,text_or_empty(result))

def words_go(+text: String, +acc: String, +out: List<&2,String>) -> List<&2,String>:
  match text:
    case SNil{}: List.reverse(&2,String,Choice.choose(List<&2,String>,String.is_empty(acc), _choice_unit => out, _choice_unit => acc <> out))
    case SCon{+char,+rest}:
      Choice.choose(List<&2,String>,Char.is_space(char), _choice_unit =>
        words_go(rest,"",Choice.choose(List<&2,String>,String.is_empty(acc), _choice_unit => out, _choice_unit => acc <> out)), _choice_unit =>
        words_go(rest,acc ++ Char.show(char),out))

def words(+text: String) -> List<&2,String>:
  words_go(text,"",Nil{})
