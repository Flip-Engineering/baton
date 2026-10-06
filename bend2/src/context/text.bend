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
