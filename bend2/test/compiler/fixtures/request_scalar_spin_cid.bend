import Base
import ../../../src/context/request.bend as Request
import ../../../src/git/text.bend as Tx

def scalar_text(value: Request.Scalar) -> String:
  match value:
    case Request.ScalarText{text}: text
    case Request.ScalarBadUtf8{}: "invalidUtf8"
    case Request.ScalarSurrogate{}: "surrogate"
    case Request.ScalarNul{}: "nulInString"

def input(args: List<String>) -> String:
  match args:
    case Nil{}: ""
    case head <> tail: head

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    IO.print(scalar_text(Request.decode_scalar_utf8(Tx.hex_decode(input(args)))))
