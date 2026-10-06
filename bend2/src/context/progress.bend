# CLAIM: the closed progress envelope of one managed semantic query and the cleanup
# aggregation over its required roles. Progress is the closed object
# {phase,waitingFor,control,cleanup}; waitingFor is an array of named required
# events whose empty set is [], never null; a query without managed roles stores
# SQL null instead of a fragment.
#
# The acceptance state and its spelling come from the canonical contract module,
# which this module consumes rather than restating. The recorder decides the phase
# and the state from observed evidence; this module carries those decisions, the
# terminal-immutability guard and the role aggregation, and it never infers
# completion from a missing role row.
import Base
import ../json/canonical.bend as J
import ./contracts.bend as Context

# `phase` names the branch the query's own observers have reached.
type Phase is Data:
  PhasePreparing{}
  PhaseRunning{}
  PhaseWaiting{}
  PhaseCleaning{}
  PhaseSettled{}

# `control` distinguishes a successful identity-bound keeper observation from an
# absent or failed one and from a role that was never attached.
type Control is Data:
  ControlAvailable{}
  ControlUnavailable{}
  ControlUnobserved{}

# `cleanup` carries the query-wide duty. An unknown role state is `unavailable`,
# which preserves responsibility; `notRequested` precedes any committed cleanup
# intent.
type Cleanup is Data:
  CleanupNotRequested{}
  CleanupPending{}
  CleanupComplete{}
  CleanupUnavailable{}

# One required event a query is waiting for. Occupied roles name their role and
# incarnation; a clangd document names its URI and its admitted document version;
# a provider response and an owed notice name their own subject.
type Waiting is Data:
  WaitingProviderResponse{}
  WaitingDiagnostics{uri: String, version: U32}
  WaitingChildExit{role: String, incarnation: String}
  WaitingKeeperControl{role: String, incarnation: String}
  WaitingNoticeDelivery{message: String}

def phase_text(p: Phase) -> String:
  match p:
    case PhasePreparing{}: "preparing"
    case PhaseRunning{}: "running"
    case PhaseWaiting{}: "waiting"
    case PhaseCleaning{}: "cleaning"
    case PhaseSettled{}: "settled"

def control_text(c: Control) -> String:
  match c:
    case ControlAvailable{}: "available"
    case ControlUnavailable{}: "unavailable"
    case ControlUnobserved{}: "unobserved"

def cleanup_text(c: Cleanup) -> String:
  match c:
    case CleanupNotRequested{}: "notRequested"
    case CleanupPending{}: "pending"
    case CleanupComplete{}: "complete"
    case CleanupUnavailable{}: "unavailable"

# The states whose first committed value is immutable for publication.
def terminal(+s: Context.QueryState) -> Bool:
  match s:
    case Context.QsAccepted{}: False{}
    case Context.QsRunning{}: False{}
    case Context.QsComplete{}: True{}
    case Context.QsFailed{}: True{}
    case Context.QsInterrupted{}: True{}
    case Context.QsRefused{}: True{}

# A state publication is admitted only while the recorded state is non-terminal.
# Ordinary transitions (accepted to running, running to a terminal outcome) are the
# recorder's decision and pass this guard; a late provider event over a committed
# terminal state does not, so it can advance cleanup or deliver an owed notice but
# cannot replace the committed state.
def state_replace_admitted(recorded: Context.QueryState, next: Context.QueryState) -> Bool:
  Bool.not(terminal(recorded))

def state_after(+recorded: Context.QueryState, +next: Context.QueryState) -> Context.QueryState:
  Bool.pick(Context.QueryState, state_replace_admitted(recorded, next), next, recorded)

# The query-wide cleanup value aggregates the role plan. `unavailable` when any
# required role lacks the evidence to reconcile its cleanup, `pending` while any
# required role is unsettled, `complete` only after every required role qualified
# completion, and `notRequested` before any query cleanup intent.
def cleanup_of(intent: Bool, unreconciled: U32, unresolved: U32) -> Cleanup:
  Bool.pick(Cleanup, Bool.not(intent), CleanupNotRequested{},
  Bool.pick(Cleanup, U32.is_lt(0, unreconciled), CleanupUnavailable{},
  Bool.pick(Cleanup, U32.is_lt(0, unresolved), CleanupPending{}, CleanupComplete{})))

def cleanup_settled(c: Cleanup) -> Bool:
  match c:
    case CleanupNotRequested{}: True{}
    case CleanupPending{}: False{}
    case CleanupComplete{}: True{}
    case CleanupUnavailable{}: False{}

def cleanup_open(c: Cleanup) -> Bool:
  match c:
    case CleanupNotRequested{}: False{}
    case CleanupPending{}: True{}
    case CleanupComplete{}: False{}
    case CleanupUnavailable{}: True{}

# `settled` requires the settlement of the query's own duties, not just an absent
# computation: a pending or unreconciled cleanup and an owed notice keep the query
# unsettled. The recorder supplies the owed-notice count from retained identities;
# no missing role row supplies it.
def settled_duties(cleanup: Cleanup, owed: U32) -> Bool:
  Bool.and(cleanup_settled(cleanup), U32.is_eq(owed, 0))

def phase_admitted(phase: Phase, cleanup: Cleanup, owed: U32) -> Bool:
  match phase:
    case PhaseSettled{}: settled_duties(cleanup, owed)
    case PhasePreparing{}: True{}
    case PhaseRunning{}: True{}
    case PhaseWaiting{}: True{}
    case PhaseCleaning{}: True{}

# The stored `progress_json` is the same closed object the envelope returns, and a
# query with no managed roles stores SQL null rather than an empty fragment.

def waiting_item(w: Waiting) -> J.Json:
  match w:
    case WaitingProviderResponse{}:
      J.Jobj{J.Jpair{"kind", J.Jstr{"providerResponse"}, J.Jnil{}}}
    case WaitingDiagnostics{uri, version}:
      J.Jobj{J.Jpair{"kind", J.Jstr{"clangdDiagnostics"},
        J.Jpair{"reason", J.Jstr{"diagnosticsUnobserved"},
        J.Jpair{"uri", J.Jstr{uri},
        J.Jpair{"version", J.Jint{version}, J.Jnil{}}}}}}
    case WaitingChildExit{role, incarnation}:
      role_event("childExit", role, incarnation)
    case WaitingKeeperControl{role, incarnation}:
      role_event("keeperControl", role, incarnation)
    case WaitingNoticeDelivery{message}:
      J.Jobj{J.Jpair{"kind", J.Jstr{"noticeDelivery"},
        J.Jpair{"message", J.Jstr{message}, J.Jnil{}}}}


def waiting_chain(waiting: List<Waiting>) -> J.Json:
  match waiting:
    case Nil{}: J.Jnil{}
    case h <> t: J.Jarr{waiting_item(h), waiting_chain(t)}

def waiting_json(waiting: List<Waiting>) -> J.Json:
  match waiting:
    case Nil{}: J.Jarr{J.Jnil{}, J.Jnil{}}
    case h <> t: J.Jarr{waiting_item(h), waiting_chain(t)}

def progress_document(+phase: Phase, +waiting: List<Waiting>, +control: Control, +cleanup: Cleanup) -> String:
  J.json_text(J.Jobj{J.Jpair{"cleanup", J.Jstr{cleanup_text(cleanup)},
    J.Jpair{"control", J.Jstr{control_text(control)},
    J.Jpair{"phase", J.Jstr{phase_text(phase)},
    J.Jpair{"waitingFor", waiting_json(waiting), J.Jnil{}}}}}})

# The waitingFor value is already the complete array: the empty set is the empty
# array, and a nonempty list is the element chain the shared encoder walks.
def progress_json(has_roles: Bool, +phase: Phase, waiting: List<Waiting>, control: Control, cleanup: Cleanup) -> String:
  Bool.pick(String, has_roles, progress_document(phase, waiting, control, cleanup), "null")

def role_event(+kind: String, +role: String, +incarnation: String) -> J.Json:
  J.Jobj{J.Jpair{"incarnation", J.Jstr{incarnation},
    J.Jpair{"kind", J.Jstr{kind},
    J.Jpair{"role", J.Jstr{role}, J.Jnil{}}}}}
