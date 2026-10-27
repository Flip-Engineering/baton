import Base
import ../src/coordinator/accounts.bend as Accounts

# Verify that the production account binding refuses an Anthropic API-key
# account before the retained launcher can start.
def binding_decided(binding: Maybe<List<String>>) -> IO(Unit):
  match binding:
    case None{}: IO.print("credit-admission-refused")
    case Some{values}: IO.die(Unit,3,"unexpected API-key account binding")

def main_arguments(arguments: List<String>) -> IO(Unit):
  match arguments:
    case +helper <> +secret_ref <> +stub <> +model <> +effort <> Nil{}:
      do IO<Unit>:
        binding : Maybe<List<String>> <- IO.pure(Maybe<List<String>>,Accounts.account_binding("claude-code",Some{Accounts.Ac{"fixture-anthropic","anthropic","claude-code","api_key",secret_ref,"org-fixture","2026-10-18"}},Some{helper},""))
        binding_decided(binding)
    case other: IO.die(Unit,2,"expected HELPER SECRET_REF STUB MODEL EFFORT")

def main() -> IO(Unit):
  do IO<Unit>:
    arguments : List<String> <- IO.args()
    main_arguments(arguments)
