"""Apply the engine hair fibre BSDF to a person build, homelab-side.

The pinned person build exports the physically based hair fibre material
(videos/web/lib/fx/hair/material/engine.js: Marschner/Chiang far-field lobes,
the cast's own eumelanin/pheomelanin, cuticle tilt, weathering and grey
fibres) but no engine code path calls it: the engine's scalp/fringe keep
shade.js's card shader while Cycles already uses hairmat7.py.  This module
patches a *copy* of the person build at job time, so the integration-owned
videos/web/lib/fx/person/build.js is not edited:

    groom = st.Hm.groomHero(...)
    + applyFibreEngine(h.group, { ...castFromName(e.name),
    +                             melanin: hair.melanin, grey: hair.grey })

It is opt-out (`opts.hairmatEngine === false`) and skipped for a Cycles export
(`opts.cycles`), where hairmat7.py already dresses the fibres.  The patch is
idempotent and fails closed if the anchor is missing or not unique.

No render is launched here.  The caller serves the prepared workspace and the
lead's existing farm GPU admission remains the only render gate.
"""
from __future__ import annotations

import hashlib
import shutil
from pathlib import Path

VERSION = "hair-engine-context-v1"
MARKER = "ISSUE87_HAIRMAT_ENGINE"
BUILD_PATH = Path("lib/fx/person/build.js")
ANCHOR = (
    "      groom = st.Hm.groomHero(h, ho); order.push('hair'); "
    "R.hair = { style: ho.style, form: ho.form, beard: ho.beard, melanin: ho.melanin }; "
    "} catch (err) { R.seams.push('hair: ' + (err.message || err)); } tm('hair', t); }"
)
PATCH = """
  // ISSUE87_HAIRMAT_ENGINE: the engine hair's fibre BSDF (hair/material/engine.js)
  // with the cast's own pigment; no engine code path applied it before.  Cycles
  // keeps hairmat7.py, so an export build skips this.  opts.hairmatEngine false
  // is the diagnosis A/B.
  if (groom && h.group && !opts.cycles && opts.hairmatEngine !== false) {
    try {
      const HE = await import('../hair/material/engine.js');
      const reps = HE.applyFibreEngine(h.group, { ...HE.castFromName(e.name), melanin: hair.melanin, grey: hair.grey });
      if (R.hair) R.hair.matEngine = reps;
    } catch (err) { R.seams.push('hair engine: ' + (err.message || err)); }
  }"""


def eligible(source: str) -> bool:
    """True when the source is the pinned person build with the one anchor."""
    return isinstance(source, str) and source.count(ANCHOR) == 1


def prepare_build_source(source: str) -> str:
    """Return the build source with the fibre-BSDF call inserted once."""
    if not isinstance(source, str):
        raise ValueError("build source must be text")
    if MARKER in source:
        return source
    count = source.count(ANCHOR)
    if count != 1:
        raise ValueError("unqualified person build: expected one hair anchor, found " + str(count))
    return source.replace(ANCHOR, ANCHOR + PATCH, 1)


def source_sha256(source: str) -> str:
    return hashlib.sha256(source.encode()).hexdigest()


def prepare_workspace(web_root, destination):
    """Copy the pipeline's lib tree and return the patched person build.

    The caller serves `destination` as the web root (or copies its lib back into
    an isolated job workspace); node_modules is symlinked when present.
    """
    web_root = Path(web_root).resolve()
    destination = Path(destination).resolve()
    if destination.exists() and any(destination.iterdir()):
        raise ValueError("destination is not empty: " + str(destination))
    destination.mkdir(parents=True, exist_ok=True)
    source = web_root / "lib"
    if not source.is_dir():
        raise ValueError("web root has no lib/: " + str(web_root))
    shutil.copytree(
        source,
        destination / "lib",
        ignore=shutil.ignore_patterns("node_modules", "__pycache__", "*.pyc"),
    )
    for name in ("package.json", "package-lock.json"):
        if (web_root / name).is_file():
            shutil.copy2(web_root / name, destination / name)
    modules = web_root / "node_modules"
    if modules.is_dir() and not (destination / "node_modules").exists():
        (destination / "node_modules").symlink_to(modules, target_is_directory=True)
    build = destination / BUILD_PATH
    build.write_text(prepare_build_source(build.read_text()))
    return {
        "root": str(destination),
        "build": str(build),
        "build_sha256": source_sha256(build.read_text()),
        "version": VERSION,
    }
