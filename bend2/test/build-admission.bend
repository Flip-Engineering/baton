import Base
import ../src/coordinator/build-admission.bend as A

def text(d: A.Decision) -> String:
  match d:
    case A.Admitted{}: "admitted"
    case A.Refused{condition}: "refused:" ++ condition

def main() -> IO(Unit):
  do IO<Unit>:
    a : Unit <- IO.print("focused=" ++ text(A.decide(A.Capacity{100, 0}, Con{A.Lease{"a", A.Focused{}, 40}, Nil{}}, A.Lease{"b", A.Focused{}, 50})))
    b : Unit <- IO.print("over=" ++ text(A.decide(A.Capacity{100, 0}, Con{A.Lease{"a", A.Focused{}, 60}, Nil{}}, A.Lease{"b", A.Focused{}, 50})))
    c : Unit <- IO.print("full=" ++ text(A.decide(A.Capacity{1000, 0}, Con{A.Lease{"a", A.Full{}, 400}, Nil{}}, A.Lease{"b", A.Full{}, 400})))
    IO.print("reuse=" ++ text(A.decide(A.Capacity{10, 0}, Nil{}, A.Lease{"r", A.Reuse{}, 1})))
