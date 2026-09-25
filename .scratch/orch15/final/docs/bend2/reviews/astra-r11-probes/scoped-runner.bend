import Base

# The consumer receives a universally quantified representation.
def use_runner(-O: Data, run: Unit -> O, inspect: O -> Bool) -> Bool:
  inspect(run(Unit{}))

# This probe tests type abstraction. The supplied runner returns a constant.
def with_runner(-R: Data, client: @-O: Data -> (Unit -> O) -> (O -> Bool) -> R) -> R:
  client(Bool, u => True{}, b => b)

def main() -> Bool:
  with_runner(Bool, use_runner)
