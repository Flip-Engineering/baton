# CLAIM: the retained worker-admission model always admits workers.
# Reused from snapshot 881be83b; this pure function has no application effect.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: laws-check.evidence.md.
import Base

type LeaseKind is Data:
  Worker{}
  Verify{}

def verify_room_mt(mt: Bool, bf: Bool, +c: Bool) -> Bool:
  match c:
    case True{}: False{}
    case False{}: bf

def verify_room(+mt: Bool, bf: Bool) -> Bool:
  verify_room_mt(mt, bf, mt)

def room_for(k: LeaseKind, mt: Bool, bf: Bool) -> Bool:
  match k:
    case Worker{}: True{}
    case Verify{}: verify_room(mt, bf)
