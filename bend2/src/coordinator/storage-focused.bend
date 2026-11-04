# Standalone Bend2 entry for the qualified storage cleanup service.
# usage: storage-clean DATABASE storage-policy
#        storage-clean DATABASE storage-preview SESSION
#        storage-clean DATABASE storage-apply SESSION
#        storage-clean DATABASE storage-collect SESSION
#        storage-clean DATABASE storage-sweep
# Each command is the product administration command and calls the same
# StoragePolicy implementation the complete Baton binary uses, including the
# canonical-root checks, the database-reference admission and the cleanup
# writer leases. The multi-command usage is the storage service contract; the
# complete product exposes the same verbs as `baton DATABASE COMMAND`.
import Base
import ../storage/lifecycle.bend as StoragePolicy

def dispatch(args: List<String>) -> IO(Unit):
  match args:
    case database <> "storage-policy" <> Nil{}: StoragePolicy.run_policy(database)
    case database <> "storage-preview" <> session <> Nil{}: StoragePolicy.run_preview(database, session)
    case database <> "storage-apply" <> session <> Nil{}: StoragePolicy.run_apply(database, session)
    case database <> "storage-collect" <> session <> Nil{}: StoragePolicy.run_collect(database, session)
    case database <> "storage-sweep" <> Nil{}: StoragePolicy.run_sweep(database)
    case other: IO.die(Unit, 2, "usage: storage-clean DATABASE storage-policy | storage-preview SESSION | storage-apply SESSION | storage-collect SESSION | storage-sweep")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    dispatch(args)
