import Base
import ./startup.bend as Startup

# M-1: the executable cannot acknowledge work at this stage.
law startup_refuses:
  {Startup.start() == Startup.Unavailable{} : Startup.Result}

def startup_refuses():
  {==}

# M-14: the actual startup response names its unavailable capability and cause.
law startup_explains:
  {Startup.explain(Startup.start()) == "Bend2 v2: work acceptance is unavailable; the session store is not implemented." : String}

def startup_explains():
  {==}
