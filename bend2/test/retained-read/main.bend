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

def cli(args: List<String>) -> IO(Unit):
  match args:
    case Nil{}: examples()
    case Con{high,Con{low,Con{other_high,Con{other_low,Nil{}}}}}:
      IO.print(show(R.offset_sum(R.ByteOffset{U32.read(high),U32.read(low)},R.ByteOffset{U32.read(other_high),U32.read(other_low)})))
    case other: IO.die(Unit,2,"Expected two unsigned offsets as four U32 words.")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args
    cli(args)
