import Base
import ../../examples/laws-orchestrator-authority.bend as M

# A second dispatch check can deny an act after its lawful grant.
def dispatch(grant: Bool, additional_permission: Bool) -> Bool:
  match grant:
    case False{}: False{}
    case True{}: additional_permission

def main() -> List<Bool>:
  [M.granted(M.Leads{}, M.Stop{}),
   dispatch(M.granted(M.Leads{}, M.Stop{}), False{})]
