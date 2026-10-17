import Base
import ../../examples/laws-no-park.bend as P
import ./g2.bend as G

# The orchestrator is a woken party in revision 10. A work decision need not acquire
# a resource or authority. Encoding that existing decision as Bookkeeping exposes
# the classification question in G2.
def main() -> List<Bool>:
  [P.woken(P.Orchestrator{}), G.allowed(G.Bookkeeping{})]
