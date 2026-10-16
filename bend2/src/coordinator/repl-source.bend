import Base
import ../git/text.bend as Tx

def parent_reversed(path: String) -> String:
  match path:
    case SNil{}: ""
    case SCon{c,+rest}:
      Bool.pick(String,U32.is_eq(Char.to_u32(c),47),Tx.str_rev(rest),parent_reversed(rest))

def compiler(executable: String) -> String:
  parent_reversed(Tx.str_rev(executable)) ++ "/../libexec/baton2/repl/compiler"
