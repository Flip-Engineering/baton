# These obligations bind the landing identity guard (#1358). Native tests in
# bend2/test/land.py exercise the session lookup, checkout path resolution and
# the Git children with a recorded model.
import Base
import ./land.bend as Land
import ./control.bend as Control

# No configured registry means no launcher wraps the command, so the caller
# runs the operation in this process and reports no applied identity.
law absent_identity_registry_wraps_no_command:
  for args: List<String>
  for model: String
  for helper: String
  for repository: String
  {Land.identity_guarded(("",helper),model,repository,args) == Nil{} : List<String>}

def absent_identity_registry_wraps_no_command(args,model,helper,repository):
  {==}

# A configured registry wraps the command and marks the child as applied.
law configured_identity_registry_marks_the_wrapped_command:
  for args: List<String>
  for model: String
  for helper: String
  for repository: String
  {Land.identity_guarded(("registry",helper),model,repository,args) == Con{"/usr/bin/env",Con{"BATON2_GIT_IDENTITY_APPLIED=1",Control.identity_args(args,model,("registry",helper),repository)}} : List<String>}

def configured_identity_registry_marks_the_wrapped_command(args,model,helper,repository):
  {==}

law no_wrapped_command_reports_no_applied_identity:
  {Land.identity_run(Nil{}) == IO.pure(Bool,False{}) : IO(Bool)}

def no_wrapped_command_reports_no_applied_identity():
  {==}
