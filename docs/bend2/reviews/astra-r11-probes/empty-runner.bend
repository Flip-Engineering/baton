import Base

type Outcome is Data:

def run() -> IO(Outcome):
  import "./opaque-runner.c"
  import "./opaque-runner.js"
