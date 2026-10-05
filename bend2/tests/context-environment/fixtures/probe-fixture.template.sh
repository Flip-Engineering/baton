#!/bin/sh
# A tool-probe fixture. It writes one marker line before it prints a version,
# so a test observes whether the probe child ran at all.
#
# The row below is substituted by the test driver with the fixture's marker
# root; tools.marker_path(root, name) names the file the marker lands in.
MARKER_ROOT="@MARKER_ROOT@"
NAME="@NAME@"
printf '%s\n' "$0" >> "$MARKER_ROOT/$NAME.marker"
printf 'v25.8.0\n'
