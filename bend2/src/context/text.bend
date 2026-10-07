# Context row decoding preserves every column, including an empty final column.
import Base

def split_tab_step(hit: Bool, c: Char, head: String, tail: List<String>) -> List<String>:
  match hit:
    case True{}: Con{"", Con{head, tail}}
    case False{}: Con{SCon{c, head}, tail}

def split_tab_cons(+c: Char, fields: List<String>) -> List<String>:
  match fields:
    case Nil{}: Con{SCon{c, SNil{}}, Nil{}}
    case head <> tail: split_tab_step(U32.is_eq(Char.to_u32(c), 9), c, head, tail)

def split_tabs(s: String) -> List<String>:
  match s:
    case SNil{}: Con{"", Nil{}}
    case SCon{head, tail}: split_tab_cons(head, split_tabs(tail))

law trailing_empty_columns_are_preserved:
  {split_tabs("a\t\t") == ["a", "", ""] : List<String>}

def trailing_empty_columns_are_preserved():
  {==}

law an_empty_column_has_one_field:
  {split_tabs("") == [""] : List<String>}

def an_empty_column_has_one_field():
  {==}

def hex_val(+c: Char) -> U32:
  +code = Char.to_u32(c)
  Bool.pick(U32, U32.is_lt(code, 58), U32.sub(code, 48),
    Bool.pick(U32, U32.is_lt(code, 71), U32.sub(code, 55), U32.sub(code, 87)))

def hex_decode(s: String) -> String:
  match s:
    case SNil{}: ""
    case SCon{head, tail}:
      match tail:
        case SNil{}: ""
        case SCon{low, rest}:
          SCon{Char.from_u32(U32.add(U32.mul(hex_val(head), 16), hex_val(low))), hex_decode(rest)}

law hexadecimal_pairs_decode_once:
  {hex_decode("7b2261223a317d") == "{\"a\":1}" : String}

def hexadecimal_pairs_decode_once():
  {==}
