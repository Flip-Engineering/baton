import Base
import ../harness/api-key-exec.bend as API

# Test-only entry for the resolver's existing secret-file, keychain and child
# environment boundary tests. Production dispatch remains held in API.main.
def dispatch(arguments: List<String>) -> IO(Unit):
  match arguments:
    case +reference <> +command <> rest: API.run(reference,command,rest)
    case other: IO.die(Unit,2,"expected SECRET_REF COMMAND [ARG...]")

def main() -> IO(Unit):
  do IO<Unit>:
    arguments : List<String> <- IO.args()
    dispatch(arguments)
