import Base

# Foreign effects return through IO before their Result is inspected.
def Checked(-A: Type) -> Type:
  IO(Result<&1,&1,U32 & String,A>)

def Checked.pure(-A: Type, value: A) -> Checked(A):
  IO.pure(Result<&1,&1,U32 & String,A>,Done{value})

def Checked.fail(-A: Type, code: U32, cause: String) -> Checked(A):
  IO.pure(Result<&1,&1,U32 & String,A>,Fail{(code,cause)})

def Checked.from_result(-A: Type, result: Result<&1,&1,U32 & String,A>) -> Checked(A):
  IO.pure(Result<&1,&1,U32 & String,A>,result)

def Checked.continue(-A: Type, -B: Type, result: Result<&1,&1,U32 & String,A>, next: A -> Checked(B)) -> Checked(B):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,B>,Fail{error})
    case Done{value}: next(value)

def Checked.bind(-A: Type, -B: Type, action: Checked(A), next: A -> Checked(B)) -> Checked(B):
  do IO<Result<&1,&1,U32 & String,B>>:
    result : Result<&1,&1,U32 & String,A> <- action
    Checked.continue(A,B,result,next)

def Checked.lift(-A: Type, action: IO(A)) -> Checked(A):
  do IO<Result<&1,&1,U32 & String,A>>:
    value : A <- action
    Checked.pure(A,value)
