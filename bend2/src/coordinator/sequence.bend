import Base

# Coordination sequences are canonical nonnegative signed-64-bit decimal text.
# Text comparison preserves values above the exact-integer range of JSON numbers.
def digits(text: String) -> Bool:
  match text:
    case SNil{}: True{}
    case SCon{head,tail}:
      +code = Char.to_u32(head)
      Bool.and(U32.is_lt(47,code),Bool.and(U32.is_lt(code,58),digits(tail)))

def first_code(text: String) -> U32:
  match text:
    case SNil{}: 0
    case SCon{head,tail}: Char.to_u32(head)

def remaining_text(text: String) -> String:
  match text:
    case SNil{}: SNil{}
    case SCon{head,tail}: tail

def width_le(left: String, +right: String) -> Bool:
  match left:
    case SNil{}: True{}
    case SCon{head,tail}:
      Bool.and(Bool.not(String.is_empty(right)),width_le(tail,remaining_text(right)))

def lexical_le(left: String, +right: String) -> Bool:
  match left:
    case SNil{}: True{}
    case SCon{head,tail}:
      +a = Char.to_u32(head)
      +b = first_code(right)
      Bool.and(Bool.not(String.is_empty(right)),
        Bool.or(U32.is_lt(a,b),Bool.and(U32.is_eq(a,b),lexical_le(tail,remaining_text(right)))))

def decimal_le(+left: String, +right: String) -> Bool:
  Bool.and(width_le(left,right),
    Bool.or(Bool.not(width_le(right,left)),lexical_le(left,right)))

def valid(+text: String) -> Bool:
  match text:
    case SNil{}: False{}
    case SCon{+head,+tail}:
      Bool.and(Bool.or(Bool.not(Char.is_eq(head,'0')),String.is_empty(tail)),
        Bool.and(digits(SCon{head,tail}),decimal_le(SCon{head,tail},"9223372036854775807")))
