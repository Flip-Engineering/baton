# CLAIM: Baton's extracted law model checks at bendlang/bend@a4952426 with bend 2.0.25.
#
# Each LAW-* marker has a source and test trace in laws-trace.md. A declaration marked
# TYPE states the boundary in its input type. The remaining declarations model current
# runtime checks as total functions over closed datatypes.

import Base

# LAW-CLOSED-1 (TYPE): command names, event names, permissions and refusal reasons use
# closed constructors. A request value carries only fields admitted for that command.

type Permission is Data:
  PermissionRead{}
  PermissionCommunicate{}
  PermissionContribute{}
  PermissionReview{}
  PermissionOrganize{}
  PermissionRecruit{}
  PermissionStop{}

type SwarmAction is Data:
  ActionRead{}
  ActionUpdateContribute{}
  ActionUpdateCommunicate{}
  ActionUpdateReview{}
  ActionUpdateOrganize{}
  ActionRecruit{}
  ActionGuide{}
  ActionCaptureOwn{}
  ActionCapturePeer{}
  ActionCheck{}
  ActionIntegrate{}
  ActionStop{}

type UpdateEvent is Data:
  EventGroupUpdated{}
  EventWorkUpdated{}
  EventAssignmentUpdated{}
  EventCouplingUpdated{}
  EventClaimUpdated{}
  EventProposalUpdated{}
  EventHolderReleased{}
  EventPolicyUpdated{}
  EventContextUpdated{}
  EventContributionRecorded{}
  EventContributionReviewed{}
  EventParticipantLeft{}
  EventClosed{}

type RefusalCode is Data:
  RefusalCommandInvalid{}
  RefusalPermissionRequired{}
  RefusalAuthorMismatch{}
  RefusalSelfCheck{}
  RefusalCapacityExceeded{}
  RefusalLedgerUnavailable{}
  RefusalContributionInvalid{}
  RefusalIntegrationUnavailable{}

# A nonempty text value contains its first character in the constructor.
type NonEmptyText is Data:
  Text{head: Char, tail: String}

type UpdateRequest is Data:
  Update{event: UpdateEvent}

# LAW-AUTH-1: every normalized swarm action has one required permission after the
# runtime derives the event and target relationship.
def permission_required(action: SwarmAction) -> Permission:
  match action:
    case ActionRead{}:
      PermissionRead{}
    case ActionUpdateContribute{}:
      PermissionContribute{}
    case ActionUpdateCommunicate{}:
      PermissionCommunicate{}
    case ActionUpdateReview{}:
      PermissionReview{}
    case ActionUpdateOrganize{}:
      PermissionOrganize{}
    case ActionRecruit{}:
      PermissionRecruit{}
    case ActionGuide{}:
      PermissionCommunicate{}
    case ActionCaptureOwn{}:
      PermissionContribute{}
    case ActionCapturePeer{}:
      PermissionReview{}
    case ActionCheck{}:
      PermissionReview{}
    case ActionIntegrate{}:
      PermissionOrganize{}
    case ActionStop{}:
      PermissionStop{}

law auth_update_requires_contribute:
  {permission_required(ActionUpdateContribute{}) == PermissionContribute{} : Permission}

def auth_update_requires_contribute():
  {==}

# LAW-AUTH-2 (TYPE): UpdateRequest carries the event. The authenticated boundary adds the
# caller identity as an affine Principal token.
type Principal is Type:
  PrincipalToken{id: NonEmptyText}

type AuthenticatedUpdate is Type:
  Authenticated{principal: Principal, request: UpdateRequest}

# LAW-CAPTURE-1 (TYPE): capture_owned accepts an affine permit for a path held by the caller.
type OwnedPath is Type:
  PathPermit{path: NonEmptyText}

type CaptureRequest is Type:
  Capture{path: OwnedPath}

type CaptureReceipt is Type:
  Captured{revision: NonEmptyText}

def capture_owned(request: CaptureRequest) -> CaptureReceipt:
  match request:
    case Capture{path}:
      Captured{Text{'0', ""}}

# LAW-CUSTODY-1: cleanup closes a physical checkout only after its last hold is released.
type HolderState is Data:
  HolderLive{}
  HolderReleased{}

type CleanupAction is Data:
  CleanupDetach{}
  CleanupClose{}

def custody_action(holder: HolderState) -> CleanupAction:
  match holder:
    case HolderLive{}:
      CleanupDetach{}
    case HolderReleased{}:
      CleanupClose{}

law custody_live_holder_detaches:
  {custody_action(HolderLive{}) == CleanupDetach{} : CleanupAction}

def custody_live_holder_detaches():
  {==}

law custody_released_holder_closes:
  {custody_action(HolderReleased{}) == CleanupClose{} : CleanupAction}

def custody_released_holder_closes():
  {==}

# LAW-CUSTODY-2 (TYPE): a capture records physical workspace custody. Authorship is carried
# by Principal at the authenticated boundary.
type WorkspaceCustody is Data:
  Custody{physical_owner: NonEmptyText, holders: Nat}

type CapturedRevision is Type:
  Revision{sha: NonEmptyText, custody: WorkspaceCustody}

# LAW-CAPACITY-1 and LAW-CAPACITY-2: worker admission is unconditional at the current
# implementation. Verification admission requires both measured memory and budget room.
type LeaseKind is Data:
  WorkerLease{}
  VerificationLease{}

type CapacityFact is Data:
  CapacityReady{}
  CapacityTight{}

type Admission is Data:
  AdmissionGranted{}
  AdmissionQueued{}

def host_admission(kind: LeaseKind, memory: CapacityFact, budget: CapacityFact) -> Admission:
  match kind:
    case WorkerLease{}:
      AdmissionGranted{}
    case VerificationLease{}:
      match memory:
        case CapacityTight{}:
          AdmissionQueued{}
        case CapacityReady{}:
          match budget:
            case CapacityTight{}:
              AdmissionQueued{}
            case CapacityReady{}:
              AdmissionGranted{}

law capacity_worker_is_admitted:
  for memory: CapacityFact
  for budget: CapacityFact
  {host_admission(WorkerLease{}, memory, budget) == AdmissionGranted{} : Admission}

def capacity_worker_is_admitted(memory, budget):
  {==}

law capacity_verify_needs_memory:
  for budget: CapacityFact
  {host_admission(VerificationLease{}, CapacityTight{}, budget) == AdmissionQueued{} : Admission}

def capacity_verify_needs_memory(budget):
  {==}

law capacity_verify_needs_budget:
  {host_admission(VerificationLease{}, CapacityReady{}, CapacityTight{}) == AdmissionQueued{} : Admission}

def capacity_verify_needs_budget():
  {==}

law capacity_verify_with_room_is_admitted:
  {host_admission(VerificationLease{}, CapacityReady{}, CapacityReady{}) == AdmissionGranted{} : Admission}

def capacity_verify_with_room_is_admitted():
  {==}

# LAW-CAPACITY-3 (TYPE): a materialization consumes the exact affine reservation token
# issued for its resource.
type CapacityReservation is Type:
  Reservation{owner: NonEmptyText, resource: OwnedPath}

type MaterializedWorkspace is Type:
  Materialized{custody: WorkspaceCustody}

def materialize(reservation: CapacityReservation) -> MaterializedWorkspace:
  match reservation:
    case Reservation{owner, resource}:
      Materialized{Custody{owner, 1n}}

# LAW-WAKE-1: the wake vocabulary is closed. TerminalWake carries its next command in its
# constructor. InformationalWake carries its class.
type WakeClass is Data:
  WakeRecruited{}
  WakeLeft{}
  WakeAssigned{}
  WakeWorkUpdated{}
  WakeCouplingUpdated{}
  WakeContextUpdated{}
  WakeContributionRecorded{}
  WakeContributionIntegrated{}
  WakeReviewed{}
  WakeNote{}
  WakeKnowledge{}
  WakeClosed{}
  WakeRefused{}
  WakeQueued{}
  WakeDead{}
  WakeRerouteProposed{}
  WakeResumeDecisionRequired{}
  WakeIncarnationChanged{}
  WakePaused{}
  WakeAttention{}
  WakeGuidanceDelivered{}
  WakeIntegrated{}
  WakeCheckpoint{}
  WakeCapacityPressure{}
  WakeResidentLifecycle{}

type NextCommand is Data:
  NextView{}
  NextRecruit{}
  NextCheck{}
  NextIntegrate{}

type Wake is Data:
  InformationalWake{class: WakeClass}
  TerminalWake{class: WakeClass, next: NextCommand}

# LAW-WAKE-2: a resume cursor advances to the sequence carried by the last observed frame.
def resume_cursor(last_seen: Nat) -> Nat:
  last_seen

law wake_resume_uses_last_seen:
  for last_seen: Nat
  {resume_cursor(last_seen) == last_seen : Nat}

def wake_resume_uses_last_seen(last_seen):
  {==}

# LAW-LEDGER-1 (TYPE): the projection API accepts DurableEvent.
type PendingEvent is Type:
  Pending{kind: UpdateEvent}

type DurableEvent is Type:
  Durable{sequence: Nat, kind: UpdateEvent}

type Projection is Type:
  ProjectionState{head: Nat}

def project(event: DurableEvent) -> Projection:
  match event:
    case Durable{sequence, kind}:
      ProjectionState{sequence}

# LAW-LEDGER-2 (TYPE): every mutation carries its idempotency key next to the pending event.
type IdempotencyKey is Type:
  MutationKey{value: NonEmptyText}

type Mutation is Type:
  MutationRequest{key: IdempotencyKey, event: PendingEvent}

# LAW-LEDGER-3 (TYPE): an atomic batch is nonempty.
type EventBatch is Type:
  LastEvent{event: PendingEvent}
  MoreEvents{event: PendingEvent, rest: EventBatch}

# LAW-LEDGER-4 (TYPE): a ledger read consumes a finite ReadBudget. Each recursive read
# consumes one ReadMore constructor.
type LedgerEntry is Data:
  LedgerEvent{sequence: Nat}

type Ledger is Type:
  LedgerEmpty{}
  LedgerMore{event: LedgerEntry, rest: Ledger}

type ReadBudget is Type:
  ReadNone{}
  ReadMore{rest: ReadBudget}

def prepend_read(event: LedgerEntry, result: Ledger & List<LedgerEntry>) -> Ledger & List<LedgerEntry>:
  (rest, events) = result
  (rest, event <> events)

def read_bounded(budget: ReadBudget, ledger: Ledger) -> Ledger & List<LedgerEntry>:
  match budget:
    case ReadNone{}:
      (ledger, [])
    case ReadMore{remaining_budget}:
      match ledger:
        case LedgerEmpty{}:
          (LedgerEmpty{}, [])
        case LedgerMore{event, remaining_ledger}:
          prepend_read(event, read_bounded(remaining_budget, remaining_ledger))

# LAW-CONTRIBUTION-1 (TYPE): the contribution report has one closed constructor and a
# closed item-status vocabulary. The items collection is nonempty.
type ContributionStatus is Data:
  ContributionDelivered{}
  ContributionPartial{}
  ContributionNotDelivered{}

type ContributionItem is Type:
  Item{id: NonEmptyText, status: ContributionStatus, change: NonEmptyText,
       files: List<NonEmptyText>, test: NonEmptyText, evidence: NonEmptyText}

type ContributionItems is Type:
  LastItem{item: ContributionItem}
  MoreItems{item: ContributionItem, rest: ContributionItems}

type PublishedCommit is Data:
  Commit{sha: NonEmptyText, branch: NonEmptyText}

type CommitChoice is Data:
  NoCommit{}
  HasCommit{commit: PublishedCommit}

type OptionalText is Data:
  NoText{}
  SomeText{value: String}

type Verification is Type:
  VerificationResult{targeted: Bool, gates: List<String>, full_suite: Bool,
                     environment_red: List<String>}

type Contribution is Type:
  ContributionReport{subject: NonEmptyText, observed_head: NonEmptyText,
                     rebased_onto: NonEmptyText, commit: CommitChoice,
                     items: ContributionItems, verification: Verification,
                     carried_forward: List<NonEmptyText>, needs_from_others: List<NonEmptyText>,
                     notes: OptionalText}

# LAW-CONTRIBUTION-2 and LAW-LANDING-1 (TYPE): review and landing consume distinct
# capabilities. The landing API accepts only an accepted contribution.
type AuthorPrincipal is Type:
  Author{principal: Principal}

type ReviewerPrincipal is Type:
  Reviewer{principal: Principal}

type CheckReceipt is Type:
  Checked{revision: CapturedRevision, reviewer: ReviewerPrincipal}

type AcceptanceReceipt is Type:
  UnrevokedAccept{reviewer: ReviewerPrincipal}

type AcceptedContribution is Type:
  Accepted{report: Contribution, acceptance: AcceptanceReceipt}

type LandingReceipt is Type:
  Landed{revision: NonEmptyText}

type GreenGates is Type:
  GatesPassed{evidence: NonEmptyText}

type PreparedLanding is Type:
  Prepared{contribution: AcceptedContribution, merge_base: NonEmptyText, gates: GreenGates}

def land_prepared(landing: PreparedLanding) -> LandingReceipt:
  match landing:
    case Prepared{contribution, merge_base, gates}:
      Landed{Text{'0', ""}}
