import Base
import ./g2.bend as G

type Act is Data:
  AcquireSocket{}
  RewriteCensus{}

def classify(act: Act) -> G.Need:
  match act:
    case AcquireSocket{}: G.Resource{}
    case RewriteCensus{}: G.Resource{}

law all_requirements_allowed:
  for act: Act
  {G.allowed(classify(act)) == True{} : Bool}

def all_requirements_allowed(act):
  match act:
    case AcquireSocket{}: {==}
    case RewriteCensus{}: {==}

def main() -> G.Need:
  classify(RewriteCensus{})
