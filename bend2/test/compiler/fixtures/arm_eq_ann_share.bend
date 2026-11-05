# A literal prefix, a 2-token fallback and a catch-all. The list-column
# lowering defers the literal column to String.eq guards on a shared reusable
# binder, so the emitter no longer receives per-column copies of one row the
# way the old character decision tree did. The sharing tests extract checked
# arms from this fixture and assert arm equality itself: base arm_eq ignores
# Ann.T and shares a copy after the annotation type changes; a total equality
# keeps the changed copy apart.
import Base

@unsafe
def dispatch(args: List<String>, +marker: Bool) -> IO(Unit):
  match args:
    case "--host-process-keeper" <> +a <> +b <> Nil{}:
      IO.write("host")
    case +a <> +b <> Nil{}:
      IO.write("two")
    case other:
      IO.write("other")

@unsafe
def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    dispatch(args,True{})
