"""Render the ☭≡/acc video series.

    python3 videos/make.py            # all
    python3 videos/make.py 01 03      # by prefix
"""
import importlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from engine.render import render  # noqa: E402

SCENES = ["v1_productive_forces", "v4_intelligence_and_spirit",
          "v5_rejuvenation", "v6_own_the_future", "v7_ascended"]

if __name__ == "__main__":
    want = sys.argv[1:]
    for s in SCENES:
        m = importlib.import_module(f"scenes.{s}")
        if want and not any(m.NAME.startswith(w) for w in want):
            continue
        render(m.NAME, m.song(), m.make_draw, os.path.join(HERE, "out"),
               preview_beats=getattr(m, "PREVIEW", (4.5, 18.5, 30.5, 44.5, 50, 58.5, 68)))
