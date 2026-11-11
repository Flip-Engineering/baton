import Base
import ../../examples/laws-orchestrator-authority.bend as M

# A caller can claim this relation. The model does not resolve identity.
def main() -> List<Bool>:
  [M.granted(M.Other{}, M.Stop{}), M.granted(M.Leads{}, M.Stop{}),
   M.granted(M.Itself{}, M.Integrate{}), M.granted(M.Itself{}, M.Recruit{})]
