# CLAIM: for a successfully observed harness and credential catalog, the served route set equals
# the complete set that harness and credential state observably supports, less the routes the
# authenticated operator excluded. Discovery derives its routes from the observation; a
# programmer-maintained availability table cannot add a route, restrict discovery, alter an
# observation or suppress serving. Missing or failed discovery is reported with its cause and is
# never asserted to be an empty catalog. This file is the model; ../laws.bend states the laws and
# laws-proof.bend discharges them.
# Status: proposed addition (revision 12b, 2026-09-25), re-encoded from the operator's adopted
# statements in ../reviews/astra-law-review-r11-r12.md. The operator ruling behind it is
# 2026-09-24 ("why do you hardcode things like this when they need to be derived from the
# relevant harness?"). #440 is a test-fixture precedent (it fixes a credential fixture, not
# runtime discovery); #549 is the open instance (direct-harness model catalogs). Not part of the
# approved set.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: laws-derived-catalog.evidence.md.
import Base

# One observation of a harness and credential state. `provided` is the route set that state
# observably supports now. `listed` is a programmer-maintained availability table; no served
# decision may read it.
type Observation is Data:
  Observation{provided: +List<Nat>, listed: +List<Nat>}

# The authenticated operator's route policy.
type Policy is Data:
  Policy{excluded: +List<Nat>}

# The result of observing the catalog. `Missing{}` carries the cause a failed observation
# reported; it is a result, not an empty catalog.
type Discovery is Data:
  Discovered{routes: +List<Nat>}
  Missing{cause: Nat}

# The serving decision: either the routes to serve, or the cause to report.
type Serving is Data:
  Served{routes: +List<Nat>}
  Report{cause: Nat}

def provided_of(o: Observation) -> +List<Nat>:
  match o:
    case Observation{+provided, _}: provided

def listed_of(o: Observation) -> +List<Nat>:
  match o:
    case Observation{_, +listed}: listed

def excluded_of(p: Policy) -> +List<Nat>:
  match p:
    case Policy{+excluded}: excluded

# The same observation with the programmer-maintained table cleared, every observed route kept.
def unlisted(o: Observation) -> Observation:
  match o:
    case Observation{+provided, _}: Observation{provided, []}

def member(+x: Nat, xs: +List<Nat>) -> Bool:
  match xs:
    case Nil{}: False{}
    case h <> t: Bool.or(Nat.is_eq(x, h), member(x, t))

def excluded_from(h: Nat, rest: +List<Nat>, excluded: Bool) -> +List<Nat>:
  match excluded:
    case True{}: rest
    case False{}: h <> rest

# Remove every route the operator excluded.
def remove(+xs: +List<Nat>, +ys: +List<Nat>) -> +List<Nat>:
  match xs:
    case Nil{}: Nil{}
    case h <> t: excluded_from(h, remove(t, ys), member(h, ys))

# The runtime's discovery: the complete observed route set, with no table input.
def discover(o: Observation) -> Discovery:
  Discovered{provided_of(o)}

# The runtime's serving decision for a discovery and the authenticated operator policy.
def serve(discovery: Discovery, p: Policy) -> Serving:
  match discovery:
    case Discovered{+routes}: Served{remove(routes, excluded_of(p))}
    case Missing{+cause}: Report{cause}

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("derived-catalog: the served set follows discovery and operator policy; the laws are checked in laws-proof.bend.")
