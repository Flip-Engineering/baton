import Base

# A gate decision the fixture laws pin.
type Gate is Data:
  Gate{open: Bool}

def admitted() -> Gate:
  Gate{True{}}

def refused() -> Gate:
  Gate{False{}}

# M-1: the admitted gate carries open.
law mini_admitted_gate_is_open:
  {admitted() == Gate{True{}} : Gate}

def mini_admitted_gate_is_open():
  {==}

# M-2: the refused gate is closed.
law mini_refused_gate_is_closed:
  {refused() == Gate{False{}} : Gate}

def mini_refused_gate_is_closed():
  {==}
