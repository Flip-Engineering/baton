"""Run by gpu_job.sh before every Blender job script (`--python gpujob/boot.py --python SCRIPT.py`): puts videos/blender/
on sys.path (so a job script can `import gpujob` and its own sibling modules) and sets up the Cycles devices once."""
import os, sys

_here = os.path.dirname(os.path.abspath(__file__))
_root = os.path.dirname(_here)                   # videos/blender
if _root not in sys.path:
    sys.path.insert(0, _root)

from gpujob import devices                       # noqa: E402

devices.setup()
