import Base
import ../src/coordinator/accounts.bend as Accounts
import ../src/git/process.bend as Proc
import ../src/git/types.bend as T
import ../src/harness/claude-player.bend as Claude

# Runs the retained Claude argv for one api_key binding. The binding must be the
# native resolver followed by the secret reference; the stub command receives
# every Claude argument after the resolver removes the inherited credential
# variables.
def run_result(run: T.RunRes) -> IO(Unit):
  match run:
    case T.RRun{T.SExit{+code},out}: Bool.pick(IO(Unit),U32.is_eq(code,0),IO.print(out),IO.die(Unit,2,"retained argv exited " ++ U32.show(code)))
    case T.RRun{T.SSignal{num},out}: IO.die(Unit,2,"retained argv received signal " ++ U32.show(num))
    case T.RSpawn{detail}: IO.die(Unit,2,"retained argv could not start: " ++ detail)

def run_binding(binding: Maybe<List<String>>, +stub: String, +model: String, +effort: String) -> IO(Unit):
  match binding:
    case None{}: IO.die(Unit,2,"api-key launch binding is absent")
    case Some{values}: do IO<Unit>:
      argv : List<String> <- IO.pure(List<String>,Claude.bound_arguments(values,stub,model,effort,"",True{}))
      run : T.RunRes <- Proc.runFull(argv,".")
      run_result(run)

def main_arguments(arguments: List<String>) -> IO(Unit):
  match arguments:
    case +helper <> +secret_ref <> +stub <> +model <> +effort <> Nil{}:
      run_binding(Accounts.launch_binding("claude-code","api_key",secret_ref,Some{helper}),stub,model,effort)
    case other: IO.die(Unit,2,"expected HELPER SECRET_REF STUB MODEL EFFORT")

def main() -> IO(Unit):
  do IO<Unit>:
    arguments : List<String> <- IO.args()
    main_arguments(arguments)
