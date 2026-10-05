import Base
import ./event-registry.bend as Registry
import ./retained-table.bend as Table

# The Instance owner-service entry contract for the shared native owner.
# Interfaces proposes the dispatch `baton2 DATABASE --owner-serve`; this
# module owns the service states and the explicit failure record for every
# primitive that is not yet an operative export. The retained keyed table
# (`retained-table.bend`) and the registry decisions (`event-registry.bend`)
# are implemented here-adjacent pure transitions; the effects they require
# from other owners are named precisely below and are not satisfied by any
# record in this module.

# Exact missing operative primitives, each naming its owning region and the
# operation it blocks. Startup refuses with the first missing stage so no
# partial authority is claimed.
type MissingPrimitive is Data:
  LifecycleBinding{stage: String, operation: String, blocks: String}
  ControlsReader{stage: String, operation: String, blocks: String}
  ControlsSynchronization{stage: String, operation: String, blocks: String}
  ControlsPreparation{stage: String, operation: String, blocks: String}
  ReceiveTaskEntry{stage: String, operation: String, blocks: String}

# Terminal ownership. `OwnerStopped` is authorized terminal settlement or a
# qualified transfer only; it is never startup readiness, an empty queue or
# a disconnected client.
type OwnerStopped is Data:
  OwnerStopped{detail: String}

# Startup/return failure: the exact stage, the missing primitive, the
# binding identity under qualification, the cleanup state, and the
# unresolved duty references the staged work already accumulated.
type OwnerFailure is Data:
  OwnerFailure{stage: String, missing: Maybe<MissingPrimitive>, binding: String, cleanup: String, unresolved: String}

# The service entry Interfaces will dispatch. Stages, in order:
# 1. database binding qualification and owner exclusion through
#    Lifecycle's bound-SQL capability (missing:
#    LifecycleBinding{query_bound is per-call, no atomic admission or
#    unknown-commit readback});
# 2. retained table and queue initialization (owned here, via
#    Table.table_empty and the registry transitions);
# 3. historical and wake duty reconstruction through the enumeration
#    interface and Controls reader leases (missing: ControlsReader);
# 4. readiness advertising atomically with retained acceptance under the
#    shared event synchronization (missing: ControlsSynchronization);
# 5. task adoption with the per-child environment snapshots (missing:
#    ControlsPreparation, two immutable snapshots);
# 6. task execution through the Receive task entry (missing:
#    ReceiveTaskEntry, the result-valued task entry and sink).
# Every stage returns OwnerFailure naming its missing primitive and the
# unresolved duties it already accumulated; none of them fabricates a task
# outcome, a seal, a parent wake or an ACK.
def serve(selected_database: String) -> IO(Result<&1,&1,OwnerFailure,OwnerStopped>):
  IO.pure(Result<&1,&1,OwnerFailure,OwnerStopped>,Fail{OwnerFailure{stage: "database-binding",missing: Some{MissingPrimitive.LifecycleBinding{"database-binding","atomic bound-SQL admission with unknown-commit readback","table initialization and every admission"}},binding: selected_database,cleanup: "nothing staged",unresolved: "no duty accepted"}})

law startup_refuses_at_the_first_missing_stage_without_authority:
  {serve("any-database") == Fail{OwnerFailure{stage: "database-binding",missing: Some{MissingPrimitive.LifecycleBinding{"database-binding","atomic bound-SQL admission with unknown-commit readback","table initialization and every admission"}},binding: "any-database",cleanup: "nothing staged",unresolved: "no duty accepted"}} : Result<&1,&1,OwnerFailure,OwnerStopped>}

def startup_refuses_at_the_first_missing_stage_without_authority():
  {==}