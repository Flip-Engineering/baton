import Base
import ../src/context/codec.bend as C

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print(C.tool_input_name("baton2_context_query"))
    IO.print(C.tool_input_name("baton2_context_result"))
    IO.print(C.tool_input_name("baton2_context_engines"))
    IO.print(C.tool_input_name("context-query"))
    IO.print(C.tool_input_name("unknown-tool"))
