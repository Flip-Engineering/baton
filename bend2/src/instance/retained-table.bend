import Base
import ../instance/event-registry.bend as Registry

# Instance-owned retained keyed destination table: the actual associative
# state for retained destinations and their registrations, threaded by the
# hosted owner loop. Every operation is a checked transition over this
# explicit table value: lookup by full correlation, capacity-checked
# reference acquisition that preserves the stored entry on refusal, keyed
# release with explicit dispositions, and registration storage and release.
# The table holds no synchronization; the hosted owner loop calls these
# operations while holding the Controls-owned event-state lock, and it owns
# process-level hosting through the pending owner entry. This module
# performs no IO.

type TableEntry is Data:
  TableEntry{destination: Registry.Destination, registrations: List<Registry.Registration>}

type Table is Data:
  Table{entries: List<TableEntry>}

# Outcomes of one table transition, each preserving the authoritative table
# it leaves behind.
type TableResolution is Data:
  StoredRetained{table: Table, lease: Registry.DestinationLease}
  StoredAtCapacity{table: Table}
  StoredCreated{table: Table, lease: Registry.DestinationLease}

type TableRegistration is Data:
  Stored{table: Table}
  Absent{table: Table}

type TableRelease is Data:
  ReferenceReleased{table: Table}
  ReferenceAlreadyReleased{table: Table}
  ReferenceAbsent{table: Table}

def table_empty() -> Table:
  Table{Nil{}}

def table_entries_of(table: Table) -> List<TableEntry>:
  match table:
    case Table{entries}: entries

def entry_destination_of(entry: TableEntry) -> Registry.Destination:
  match entry:
    case TableEntry{destination,registrations}: destination

def entry_registrations_of(entry: TableEntry) -> List<Registry.Registration>:
  match entry:
    case TableEntry{destination,registrations}: registrations

def entry_matches(+entry: TableEntry, +database: String, +owner: String, +request: String, +session: String) -> Bool:
  Registry.correlation_is(entry_destination_of(entry),database,owner,request,session)

def table_find(+entries: List<TableEntry>, +database: String, +owner: String, +request: String, +session: String) -> Maybe<TableEntry>:
  match entries:
    case Nil{}: None{}
    case first <> rest:
      match entry_matches(first,database,owner,request,session):
        case True{}: Some{first}
        case other: table_find(rest,database,owner,request,session)

def entries_with_destination(+entries: List<TableEntry>, +database: String, +owner: String, +request: String, +session: String, +updated: Registry.Destination) -> List<TableEntry>:
  match entries:
    case Nil{}: Nil{}
    case first <> rest:
      match entry_matches(first,database,owner,request,session):
        case True{}: TableEntry{updated,entry_registrations_of(first)} <> entries_with_destination(rest,database,owner,request,session,updated)
        case other: first <> entries_with_destination(rest,database,owner,request,session,updated)

def resolve_entries(+entries: List<TableEntry>, +database: String, +owner: String, +request: String, +session: String, capacity: U32, found: Maybe<TableEntry>) -> TableResolution:
  match found:
    case Some{+entry}:
      Bool.pick(TableResolution,U32.is_lt(Registry.dest_references_of(entry_destination_of(entry)),capacity),StoredRetained{Table{entries_with_destination(entries,database,owner,request,session,Registry.Destination{dest_database_of(entry_destination_of(entry)),dest_owner_of(entry_destination_of(entry)),dest_request_of(entry_destination_of(entry)),dest_session_of(entry_destination_of(entry)),U32.add(Registry.dest_references_of(entry_destination_of(entry)),1),Registry.dest_tasks_of(entry_destination_of(entry)))}},Registry.DestinationLease{Registry.Destination{dest_database_of(entry_destination_of(entry)),dest_owner_of(entry_destination_of(entry)),dest_request_of(entry_destination_of(entry)),dest_session_of(entry_destination_of(entry)),U32.add(Registry.dest_references_of(entry_destination_of(entry)),1),Registry.dest_tasks_of(entry_destination_of(entry))},True{}}},StoredAtCapacity{Table{entries}})
    case None{}:
      StoredCreated{Table{List.append(&1,TableEntry,entries,TableEntry{Registry.Destination{database,owner,request,session,1,0},Nil{}})},Registry.DestinationLease{Registry.Destination{database,owner,request,session,1,0},True{}}}

# Capacity-checked reference acquisition over the stored table: a matching
# entry below capacity gains one reference and the updated table is
# returned; a match at capacity returns the unchanged table as an explicit
# refusal; a new correlation appends exactly one fresh entry and returns
# the extended table with its lease.
def table_resolve(+table: Table, +database: String, +owner: String, +request: String, +session: String, capacity: U32) -> TableResolution:
  resolve_entries(table_entries_of(table),database,owner,request,session,capacity,table_find(table_entries_of(table),database,owner,request,session))

def entries_with_release(+entries: List<TableEntry>, +database: String, +owner: String, +request: String, +session: String) -> List<TableEntry>:
  match entries:
    case Nil{}: Nil{}
    case first <> rest:
      match entry_matches(first,database,owner,request,session):
        case True{}: TableEntry{Registry.Destination{dest_database_of(entry_destination_of(first)),dest_owner_of(entry_destination_of(first)),dest_request_of(entry_destination_of(first)),dest_session_of(entry_destination_of(first)),U32.sub(Registry.dest_references_of(entry_destination_of(first)),1),Registry.dest_tasks_of(entry_destination_of(first))},entry_registrations_of(first)} <> entries_with_release(rest,database,owner,request,session)
        case other: first <> entries_with_release(rest,database,owner,request,session)

# Keyed reference release over the stored table: a matching entry with a
# positive count is decremented; a match already at zero is an explicit
# already-released outcome preserving the table; no match is absent. The
# hosted table validates the original holder identity for this release.
def table_release_reference(+table: Table, +database: String, +owner: String, +request: String, +session: String) -> TableRelease:
  release_entries(table_entries_of(table),database,owner,request,session,table_find(table_entries_of(table),database,owner,request,session))

def release_entries(+entries: List<TableEntry>, +database: String, +owner: String, +request: String, +session: String, found: Maybe<TableEntry>) -> TableRelease:
  match found:
    case Some{+entry}:
      Bool.pick(TableRelease,U32.is_lt(0,Registry.dest_references_of(entry_destination_of(entry))),ReferenceReleased{Table{entries_with_release(entries,database,owner,request,session)}},ReferenceAlreadyReleased{Table{entries}})
    case None{}: ReferenceAbsent{Table{entries}}

def entries_with_registration(+entries: List<TableEntry>, +registration: Registry.Registration) -> List<TableEntry>:
  match entries:
    case Nil{}: Nil{}
    case first <> rest:
      match entry_matches(first,Registry.reg_database_of(registration),Registry.reg_owner_of(registration),Registry.reg_request_of(registration),Registry.reg_session_of(registration)):
        case True{}: TableEntry{entry_destination_of(first),List.append(&1,Registry.Registration,entry_registrations_of(first),registration)} <> entries_with_registration(rest,registration)
        case other: first <> entries_with_registration(rest,registration)

# Storing a registration attaches it to the retained entry for its bound
# correlation; with no retained entry for that correlation the store is
# refused and the table is returned unchanged.
def table_put_registration(+table: Table, +registration: Registry.Registration) -> TableRegistration:
  put_entries(table_entries_of(table),registration,table_find(table_entries_of(table),Registry.reg_database_of(registration),Registry.reg_owner_of(registration),Registry.reg_request_of(registration),Registry.reg_session_of(registration)))

def put_entries(+entries: List<TableEntry>, +registration: Registry.Registration, found: Maybe<TableEntry>) -> TableRegistration:
  match found:
    case Some{+entry}:
      Stored{Table{entries_with_registration(entries,registration)}}
    case None{}: Absent{Table{entries}}

# --- laws -------------------------------------------------------------------

law retain_on_an_empty_table_stores_one_referenced_entry:
  for +database: String
  for +owner: String
  for +request: String
  for +session: String
  {table_resolve(table_empty(),database,owner,request,session,1) == StoredCreated{Table{TableEntry{Registry.Destination{database,owner,request,session,1,0},Nil{}} <> Nil{}},Registry.DestinationLease{Registry.Destination{database,owner,request,session,1,0},True{}}} : TableResolution}

def retain_on_an_empty_table_stores_one_referenced_entry(database,owner,request,session):
  {==}

# Capacity bounds matched acquisitions only: first creation for an absent
# correlation proceeds even at zero capacity and stores one referenced
# entry.
law creation_for_an_absent_correlation_applies_even_at_zero_capacity:
  for +database: String
  for +owner: String
  for +request: String
  for +session: String
  {table_resolve(table_empty(),database,owner,request,session,0) == StoredCreated{Table{TableEntry{Registry.Destination{database,owner,request,session,1,0},Nil{}} <> Nil{}},Registry.DestinationLease{Registry.Destination{database,owner,request,session,1,0},True{}}} : TableResolution}

def creation_for_an_absent_correlation_applies_even_at_zero_capacity(database,owner,request,session):
  {==}
