import Base

# Coordination sequences are canonical nonnegative signed-64-bit decimal text.
# Text comparison preserves values above the exact-integer range of JSON numbers.
def digits(text: String, +budget: U32) -> Bool:
  match text:
    case SNil{}: True{}
    case SCon{head,tail}:
      +code = Char.to_u32(head)
      match budget:
        case 0: False{}
        case remaining: Bool.and(U32.is_lt(47,code),Bool.and(U32.is_lt(code,58),digits(tail,U32.sub(remaining,1))))

def width(text: String) -> U32:
  match text:
    case SNil{}: 0
    case SCon{head,tail}: U32.add(1,width(tail))

def lexical_le(left: String, right: String) -> Bool:
  match left:
    case SNil{}: True{}
    case SCon{head,tail}:
      match right:
        case SNil{}: False{}
        case SCon{other,rest}:
          +a = Char.to_u32(head)
          +b = Char.to_u32(other)
          Bool.or(U32.is_lt(a,b),Bool.and(U32.is_eq(a,b),lexical_le(tail,rest)))

def decimal_le(+left: String, +right: String) -> Bool:
  +a = width(left)
  +b = width(right)
  Bool.or(U32.is_lt(a,b),Bool.and(U32.is_eq(a,b),lexical_le(left,right)))

def valid(+text: String) -> Bool:
  match text:
    case SNil{}: False{}
    case SCon{+head,+tail}:
      Bool.and(Bool.or(Bool.not(Char.is_eq(head,'0')),String.is_empty(tail)),
        Bool.and(digits(SCon{head,tail},19),decimal_le(SCon{head,tail},"9223372036854775807")))
