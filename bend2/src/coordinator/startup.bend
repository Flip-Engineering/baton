import Base

# The initial executable exposes a refusal. Work acceptance needs a store.
type Result is Data:
  Unavailable{}

def start() -> Result:
  Unavailable{}

def explain(result: Result) -> String:
  match result:
    case Unavailable{}:
      "Bend2 v2: work acceptance is unavailable; the session store is not implemented."
