import Base
import ../../src/context/retained-read.bend as R

def show(value: Result<&2,&2,R.OffsetFault,R.ByteOffset>) -> String:
  match value:
    case Fail{R.OffsetOverflow{}}: "overflow"
    case Done{R.ByteOffset{high,low}}: U32.show(high) ++ ":" ++ U32.show(low)

def examples() -> IO(Unit):
  IO.print(
    show(R.offset_sum(R.ByteOffset{0,4294967295},R.ByteOffset{0,1})) ++ "\n" ++
    show(R.offset_sum(R.ByteOffset{4294967295,0},R.ByteOffset{1,0})) ++ "\n" ++
    show(R.offset_sum(R.ByteOffset{4294967295,4294967295},R.ByteOffset{0,1})) ++ "\n" ++
    show(R.offset_sum(R.ByteOffset{4,12},R.ByteOffset{0,0})))

def parsed_low(high: U32, low: Maybe<&2,U32>) -> Maybe<&2,R.ByteOffset>:
  match low:
    case None{}: None{}
    case Some{low_word}: Some{R.ByteOffset{high,low_word}}

def parsed_offset(high: Maybe<&2,U32>, low: Maybe<&2,U32>) -> Maybe<&2,R.ByteOffset>:
  match high:
    case None{}: None{}
    case Some{high_word}: parsed_low(high_word,low)

def parsed_right(left: R.ByteOffset, right: Maybe<&2,R.ByteOffset>) -> IO(Unit):
  match right:
    case None{}: IO.die(Unit,2,"Invalid unsigned offset word.")
    case Some{right_offset}: IO.print(show(R.offset_sum(left,right_offset)))

def parsed_sum(left: Maybe<&2,R.ByteOffset>, right: Maybe<&2,R.ByteOffset>) -> IO(Unit):
  match left:
    case None{}: IO.die(Unit,2,"Invalid unsigned offset word.")
    case Some{left_offset}: parsed_right(left_offset,right)

def cli(args: List<String>) -> IO(Unit):
  match args:
    case Nil{}: examples()
    case Con{high,Con{low,Con{other_high,Con{other_low,Nil{}}}}}:
      parsed_sum(parsed_offset(U32.read(high),U32.read(low)),parsed_offset(U32.read(other_high),U32.read(other_low)))
    case other: IO.die(Unit,2,"Expected two unsigned offsets as four U32 words.")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args
    cli(args)
