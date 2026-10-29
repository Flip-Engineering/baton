import Base
import ./laws.bend as M

def Done(b: Bool) -> Bool:
  False{}

def M.keeps():
  {==}

def unpack(value: Result<&1, &1, Unit, Bool>) -> Bool:
  match value:
    case Done{value}: value
    case Fail{error}: False{}

law constructor_kept:
  {unpack(Done{True{}}) == True{} : Bool}

def constructor_kept():
  {==}

law alias_kept:
  {M.Done(True{}) == True{} : Bool}

def alias_kept():
  {==}

def apply(f: Bool -> Bool, value: Bool) -> Bool:
  f(value)

law reference_kept:
  {apply(M.Done, True{}) == True{} : Bool}

def reference_kept():
  {==}

def local(Done: Bool -> Bool, value: Bool) -> Bool:
  Done(value)

law binder_kept:
  {local(value => value, True{}) == True{} : Bool}

def binder_kept():
  {==}
