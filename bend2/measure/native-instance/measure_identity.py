#!/usr/bin/env python3
"""Resolve the measurement identity inputs for one run.

A new run must name its inputs. The retained laptop baseline paths are reachable
only through the explicit historical mode, and every tool records which mode it
used in its output. No tool substitutes a path that the caller did not supply.

Environment:
  BATON2_MEASURE_IDENTITY  set to `historical-fca7af87-laptop` to reproduce the
                           retained laptop baseline; any other value stops the run
  BATON2_RELEASE           the release bin/baton2 for this run
  BATON2_GIT_SERIES        that release's libexec/baton2/git-series.mjs
  BATON2_GIT_REGISTRY      the series registry for this run
  BATON2_MEASURE_MODEL     the exact model key for the route under measurement

Call `identity()` once at the top of a tool and write the returned mapping into
the tool's output document.
"""
import os

HISTORICAL_MODE = "historical-fca7af87-laptop"
HISTORICAL = {
    "release": "/Users/wahargis/.local/share/baton2/releases/1.1.0-fca7af876c8260c32d17f95f3e19bc68ee1bf561/bin/baton2",
    "registry": "/Users/wahargis/.config/baton/github-apps/series.json",
    "model": "deepseek/deepseek-flash",
}


def mode():
    """Return the historical mode name, or None for a caller-supplied run."""
    configured = os.environ.get("BATON2_MEASURE_IDENTITY")
    if configured is None or configured == "":
        return None
    if configured != HISTORICAL_MODE:
        raise SystemExit(
            "BATON2_MEASURE_IDENTITY is set to an unknown mode: %s. Leave it unset for a "
            "caller-supplied run, or set it to %s to reproduce the retained laptop baseline."
            % (configured, HISTORICAL_MODE))
    return configured


def _missing(env_name):
    return SystemExit(
        "%s is not set. A new run must name its inputs: set %s, or set "
        "BATON2_MEASURE_IDENTITY=%s to reproduce the retained laptop baseline."
        % (env_name, env_name, HISTORICAL_MODE))


def executable(env_name, historical_key, mode_name):
    configured = os.environ.get(env_name)
    if configured:
        if not os.path.isfile(configured) or not os.access(configured, os.X_OK):
            raise SystemExit("%s is set but is not an executable file: %s" % (env_name, configured))
        return configured
    if mode_name and HISTORICAL.get(historical_key):
        return HISTORICAL[historical_key]
    raise _missing(env_name)


def path(env_name, historical_key, mode_name):
    configured = os.environ.get(env_name)
    if configured:
        if not os.path.exists(configured):
            raise SystemExit("%s is set but does not exist: %s" % (env_name, configured))
        return configured
    if mode_name and HISTORICAL.get(historical_key):
        return HISTORICAL[historical_key]
    raise _missing(env_name)


def value(env_name, historical_key, mode_name):
    configured = os.environ.get(env_name)
    if configured:
        return configured
    if mode_name and HISTORICAL.get(historical_key):
        return HISTORICAL[historical_key]
    raise _missing(env_name)


def identity():
    """Resolve every input once and return the record a tool writes out.

    In a caller-supplied run every input must be named: a missing
    `BATON2_GIT_SERIES` stops the run even when the release prefix contains a
    helper. The helper is derived from the release only in the explicit
    historical mode, where that derivation is part of the retained baseline.
    """
    mode_name = mode()
    release = executable("BATON2_RELEASE", "release", mode_name)
    helper = os.environ.get("BATON2_GIT_SERIES")
    if helper:
        if not os.path.isfile(helper):
            raise SystemExit("BATON2_GIT_SERIES is set but is not a file: %s" % helper)
    elif mode_name:
        derived = os.path.join(os.path.dirname(os.path.dirname(release)), "libexec/baton2/git-series.mjs")
        if not os.path.isfile(derived):
            raise SystemExit(
                "BATON2_GIT_SERIES is not set and the historical baseline's release prefix holds no "
                "helper at %s." % derived)
        helper = derived
    else:
        raise _missing("BATON2_GIT_SERIES")
    return {
        "identity_mode": mode_name or "caller-supplied",
        "historical_mode": HISTORICAL_MODE,
        "release": release,
        "helper": helper,
        "registry": path("BATON2_GIT_REGISTRY", "registry", mode_name),
        "model": value("BATON2_MEASURE_MODEL", "model", mode_name),
    }
