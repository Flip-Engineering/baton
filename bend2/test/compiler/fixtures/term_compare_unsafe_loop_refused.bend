# A law that compares an @unsafe loop called with two different arguments.
import Base

def spin_again(result: Result<&1,&1,U32 & String,String>, again: Unit -> IO(Unit)) -> IO(Unit):
  match result:
    case Fail{error}: again(Unit{})
    case Done{value}: IO.pure(Unit,Unit{})

@unsafe
def spin(+name: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,String> <- IO.get_env(name)
    spin_again(result,unit => spin(name))

law different_names_are_not_one_loop:
  for +left: String
  for +right: String
  {spin(left) == spin(right) : IO(Unit)}

def different_names_are_not_one_loop(left,right):
  {==}

def main() -> U32:
  0
