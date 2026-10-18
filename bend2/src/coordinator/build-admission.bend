import Base

# Native lease and reservation decision for build admission. The host cgroup
# and process effects live outside this module; these laws fix the class rules,
# the exclusive full lease and the aggregate reservation arithmetic.

type LeaseClass is Data:
  Full{}
  Focused{}
  Reuse{}
  Check{}

type Lease is Data:
  Lease{key: String, class: LeaseClass, reservedKib: U32}

type Capacity is Data:
  Capacity{maximumKib: U32, currentKib: U32}

type Summary is Data:
  Summary{reservedKib: U32, full: Bool}

type Decision is Data:
  Admitted{}
  Refused{condition: String}

def is_full(class: LeaseClass) -> Bool:
  match class:
    case Full{}: True{}
    case Focused{}: False{}
    case Reuse{}: False{}
    case Check{}: False{}

def summarize(leases: List<Lease>, acc: U32, full: Bool) -> Summary:
  match leases:
    case Nil{}: Summary{acc, full}
    case Con{Lease{key, class, reservedKib}, rest}:
      summarize(rest, U32.add(acc, reservedKib), Bool.or(full, is_full(class)))

def decide_summary(maximumKib: U32, currentKib: U32, class: LeaseClass,
                   reservedKib: U32, summary: Summary) -> Decision:
  match summary:
    case Summary{already, full}:
      Bool.pick(Decision,
        Bool.and(is_full(class), full),
        Refused{"full-generation-in-flight"},
        Bool.pick(Decision,
          U32.is_le(U32.add(already, reservedKib), maximumKib),
          Admitted{},
          Refused{"capacity-exceeded"}))

def decide_class(capacity: Capacity, leases: List<Lease>,
                 class: LeaseClass, reservedKib: U32) -> Decision:
  match capacity:
    case Capacity{maximumKib, currentKib}:
      decide_summary(maximumKib, currentKib, class, reservedKib,
        summarize(leases, 0, False{}))

def decide(capacity: Capacity, leases: List<Lease>, request: Lease) -> Decision:
  match request:
    case Lease{key, class, reservedKib}:
      decide_class(capacity, leases, class, reservedKib)

law focused_jobs_share_below_budget:
  {decide(Capacity{100, 0}, Con{Lease{"a", Focused{}, 40}, Nil{}}, Lease{"b", Focused{}, 50}) == Admitted{} : Decision}

def focused_jobs_share_below_budget():
  {==}

law over_budget_is_refused:
  {decide(Capacity{100, 0}, Con{Lease{"a", Focused{}, 60}, Nil{}}, Lease{"b", Focused{}, 50}) == Refused{"capacity-exceeded"} : Decision}

def over_budget_is_refused():
  {==}

law full_generation_is_exclusive:
  {decide(Capacity{1000, 0}, Con{Lease{"a", Full{}, 400}, Nil{}}, Lease{"b", Full{}, 400}) == Refused{"full-generation-in-flight"} : Decision}

def full_generation_is_exclusive():
  {==}

law reuse_is_cheap:
  {decide(Capacity{10, 0}, Nil{}, Lease{"r", Reuse{}, 1}) == Admitted{} : Decision}

def reuse_is_cheap():
  {==}
