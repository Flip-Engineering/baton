# Managed context role identities and keeper directory names. SessionLock uses
# the physical database identity and the physical-role digest to acquire a lock.
import Base
import ../json/canonical.bend as J

type Role is Data:
  RoleStarter{}
  RoleTarget{}
  RoleAdapter{}
  RoleCoordinator{}

type Subject is Data:
  SubjectQuery{id: String}
  SubjectRuntime{id: String}
  SubjectCoordinator{}

def role_text(role: Role) -> String:
  match role:
    case RoleStarter{}: "starter"
    case RoleTarget{}: "target"
    case RoleAdapter{}: "adapter"
    case RoleCoordinator{}: "coordinator"

def subject_kind(subject: Subject) -> String:
  match subject:
    case SubjectQuery{id}: "query"
    case SubjectRuntime{id}: "runtime"
    case SubjectCoordinator{}: "coordinator"

def subject_id(+subject: Subject) -> String:
  match subject:
    case SubjectQuery{id}: id
    case SubjectRuntime{id}: id
    case SubjectCoordinator{}: "fixed"

# The canonical JSON text of the complete role identity. The array order is the
# contract: the fixed tag first, then the database binding, subject kind, subject
# ID, role and incarnation. Strings use the shared canonical encoder, so a
# Unicode query ID or a quoting character in a binding cannot change the digest
# domain or smuggle a member.
def guard_identity(+binding: String, +subject: Subject, +role: Role, +incarnation: String) -> String:
  J.json_text(J.Jarr{J.Jstr{"context-role"},
    J.Jarr{J.Jstr{binding},
    J.Jarr{J.Jstr{subject_kind(subject)},
    J.Jarr{J.Jstr{subject_id(subject)},
    J.Jarr{J.Jstr{role_text(role)},
    J.Jarr{J.Jstr{incarnation}, J.Jnil{}}}}}}})

# The lock filename receives the physical database tuple separately, so the
# role key is independent of the path member in a binding. Hard-link aliases
# of one database therefore contend on the same role lock.
def physical_role_identity(+subject: Subject, +role: Role) -> String:
  J.json_text(J.Jarr{J.Jstr{"physical-db-role"},
    J.Jarr{J.Jstr{subject_kind(subject)},
    J.Jarr{J.Jstr{subject_id(subject)},
    J.Jarr{J.Jstr{role_text(role)}, J.Jnil{}}}}})

# The guard key of one complete identity. The host hashes the identity's exact UTF-8
# bytes; a missing or failed digest is a host failure, never a repaired identity.
def role_guard_key(identity: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./role-digest.c"

def physical_role_key(identity: String) -> IO(Result<&1,&1,U32 & String,String>):
  role_guard_key(identity)

# The keeper directory of one role is the full-identity digest under the recorded
# log directory. A raw ID never becomes a path component.
def role_directory(+log_dir: String, key: String) -> String:
  log_dir ++ "/" ++ key

# The guard anchor path text is the fixed directory `g` beside that log directory.
def guard_anchor(+log_dir: String) -> String:
  log_dir ++ "/g"

# Admission compares the complete identity and the database binding. A digest
# match alone is not the admission decision, and a disagreement never rewrites
# the recorded custody.
def identity_admitted(+expected: String, +recorded: String) -> Bool:
  String.eq(expected, recorded)

def binding_admitted(+expected: String, +recorded: String) -> Bool:
  String.eq(expected, recorded)
