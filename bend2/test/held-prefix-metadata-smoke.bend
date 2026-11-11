import Base
import ../src/coordinator/logs.bend as Logs
import ../src/git/text.bend as Tx

def exactly_one(rows: List<String>, expected: String) -> Bool:
  match rows:
    case Con{head, rest}:
      match rest:
        case Nil{}: String.eq(head, expected)
        case _: False{}
    case Nil{}: False{}

def metadata_payload_case() -> Bool:
  String.eq(
    Tx.join("\n", Logs.held_lines(
      Logs.held_put(
        Logs.held_put(
          Logs.held_put(Nil{}, "message_update", "message-A", "{\"text\":\"old\"}"),
          "message_update", "message-B", "{\"text\":\"other\"}"),
        "message_update", "message-A", "{\"text\":\"left\\tinside\\nright\"}"),
      "message_update", "message-A")),
    "{\"text\":\"left\\tinside\\nright\"}")

def identity_case() -> Bool:
  String.eq(
    Tx.join("\n", Logs.held_lines(
      Logs.held_put(
        Logs.held_put(Nil{}, "message_update", "message-A", "A"),
        "message_update", "message-B", "B"),
      "message_update", "message-B")),
    "B")

def main() -> IO(Unit):
  do IO<Unit>:
    Bool.pick(IO(Unit),metadata_payload_case(),IO.pure(Unit,Unit{}),IO.die(Unit,1,"metadata_payload_case=fail"))
    Bool.pick(IO(Unit),identity_case(),IO.pure(Unit,Unit{}),IO.die(Unit,1,"identity_case=fail"))
    IO.print("held_prefix_metadata_and_identity=pass")
