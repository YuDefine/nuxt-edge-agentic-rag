#!/usr/bin/env bash
# Compatibility shim for the current Codex session.
# The Stop hook config was removed, but this already-running session still has
# the old Stop command cached. Exit successfully until the session is restarted.

exit 0
