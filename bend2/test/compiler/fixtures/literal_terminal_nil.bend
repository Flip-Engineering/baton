import Base

type Option is Data:
  Field{name: String, value: String}

def options(args: List<String>, +found: List<&2,Option>) -> Result<&1,&1,U32 & String,List<&2,Option>>:
  match args:
    case Nil{}: Done{found}
    case +flag <> value <> rest: options(rest,Con{Field{flag,value},found})
    case other: Fail{(2,"Each option needs a value.")}

def source_options(args: List<String>) -> Result<&1,&1,U32 & String,List<&2,Option>>:
  match args:
    case "--stdin" <> rest: options(rest,[Field{"--source","-"}])
    case source <> rest: options(rest,[Field{"--source",source}])
    case Nil{}: Fail{(2,"Supply source.")}

def count(options: List<&2,Option>) -> U32:
  match options:
    case Nil{}: 0
    case +option <> rest: U32.add(1,count(rest))

def result(result: Result<&1,&1,U32 & String,List<&2,Option>>) -> U32:
  match result:
    case Done{options}: count(options)
    case Fail{error}: 0

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    IO.print(U32.show(result(source_options(args))))
