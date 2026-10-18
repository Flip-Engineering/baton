import Base
import ../src/context/request.bend as Request
import ../src/context/text.bend as ContextText
import ../src/coordinator/checkpoint-codec.bend as Codec
import ../src/host/text.bend as Text
import ../src/git/text.bend as Tx

# Test-only copy of the pre-fusion decoder. Production uses CheckpointCodec.
def baseline_decode_byte(state: Request.DState, +byte: U32) -> Request.DState:
  match state:
    case Request.DStart{+acc}:
      Bool.pick(Request.DState,U32.is_eq(byte,0),Request.DStart{SCon{Char.from_u32(0),acc}},Request.step_state(Request.DStart{acc},byte))
    case other: Request.step_state(other,byte)

def baseline_decode_bytes(bytes: String, +state: Request.DState) -> Request.DState:
  match bytes:
    case SNil{}: state
    case SCon{+head,+tail}: baseline_decode_bytes(tail,baseline_decode_byte(state,Char.to_u32(head)))

def scalar_text(scalar: Request.Scalar) -> IO(String):
  match scalar:
    case Request.ScalarText{value}: IO.pure(String,value)
    case other: IO.die(String,3,"Native observer checkpoint field decode failed: " ++ Request.scalar_reason(other))

def baseline_decode_field(hex: String) -> IO(String):
  scalar_text(Request.state_scalar(baseline_decode_bytes(ContextText.hex_decode(hex),Request.DStart{SNil{}})))

def report_length(+value: String) -> IO(Unit):
  IO.print(U32.show(Request.length(value)))

def report_both(+baseline: String, +fused: String) -> IO(Unit):
  Bool.pick(IO(Unit),String.eq(baseline,fused),
    IO.print("equal:" ++ U32.show(Request.length(fused))),
    IO.die(Unit,1,"baseline and fused checkpoint decoders differ"))

def run_mode(mode: String, hex: String) -> IO(Unit):
  match mode:
    case "both": do IO<Unit>:
      baseline : String <- baseline_decode_field(hex)
      fused : String <- Codec.decode_field(hex)
      report_both(baseline,fused)
    case "baseline": do IO<Unit>:
      value : String <- baseline_decode_field(hex)
      report_length(value)
    case "fused": do IO<Unit>:
      value : String <- Codec.decode_field(hex)
      report_length(value)
    case "raw-baseline": do IO<Unit>:
      value : String <- baseline_decode_field(hex)
      report_length(value)
    case "raw-fused": do IO<Unit>:
      value : String <- Codec.decode_field(hex)
      report_length(value)
    case "raw-both": do IO<Unit>:
      baseline : String <- baseline_decode_field(hex)
      fused : String <- Codec.decode_field(hex)
      report_both(baseline,fused)
    case other: IO.die(Unit,2,"mode must be baseline, fused, both, raw-baseline, raw-fused, or raw-both")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    match args:
      case mode <> Nil{}:
        encoded : String <- IO.try(String,Text.Text.read("-"))
        run_mode(mode,Tx.trim_nl(encoded))
      case other: IO.die(Unit,2,"usage: checkpoint-codec MODE < hex-input")
