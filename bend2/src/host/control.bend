import Base

def Control.workspace(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./control.c"

def Control.output(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./control.c"

def Control.command(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./control.c"

def Control.identity(executable: String) -> IO(Result<&1,&1,U32 & String,String & String>):
  import "./control.c"

# Resolves the DSH worker bridge from this executable's installed package or
# the coordinator source checkout that contains this executable.
def Control.agent_helper(executable: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./control.c"

def Control.launch(argv: String, database: String, id: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./control.c"
