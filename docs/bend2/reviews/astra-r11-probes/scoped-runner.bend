import Base

def use_runner(-O: Data, run: Unit -> O, inspect: O -> Bool) -> Bool:
  inspect(run(Unit{}))

def runner() -> Bool:
  use_runner(Bool, u => True{}, b => b)

def main() -> Bool:
  runner()
