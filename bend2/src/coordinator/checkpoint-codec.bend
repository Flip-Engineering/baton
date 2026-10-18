import Base
import ../context/text.bend as ContextText
import ../context/request.bend as Request

# Decode the byte pairs produced by SQLite's hex() projection directly into the
# existing UTF-8 state machine. This keeps checkpoint NUL code points, which
# are valid in the serialized checkpoint fields.
def decode_byte(state: Request.DState, +byte: U32) -> Request.DState:
  match state:
    case Request.DStart{+acc}:
      Bool.pick(Request.DState,U32.is_eq(byte,0),Request.DStart{SCon{Char.from_u32(0),acc}},Request.step_state(Request.DStart{acc},byte))
    case other: Request.step_state(other,byte)

def decode_hex_state(hex: String, +state: Request.DState) -> Request.DState:
  match hex:
    case SNil{}: state
    case SCon{+high,+tail}:
      match tail:
        # ContextText.hex_decode ignores a final unpaired nibble.
        case SNil{}: state
        case SCon{+low,+rest}:
          +byte = U32.add(U32.mul(ContextText.hex_val(high),16),ContextText.hex_val(low))
          decode_hex_state(rest,decode_byte(state,byte))

def decode_scalar(scalar: Request.Scalar) -> IO(String):
  match scalar:
    case Request.ScalarText{value}: IO.pure(String,value)
    case other: IO.die(String,3,"Native observer checkpoint field decode failed: " ++ Request.scalar_reason(other))

def decode_field(hex: String) -> IO(String):
  decode_scalar(Request.state_scalar(decode_hex_state(hex,Request.DStart{SNil{}})))
