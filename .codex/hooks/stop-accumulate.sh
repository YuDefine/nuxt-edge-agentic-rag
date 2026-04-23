#!/usr/bin/env bash
# Compatibility shim for the current Claude session.
# The Stop hook config was removed, but already-running sessions may still have
# the old Stop command cached. Exit successfully until the session is restarted.

exit 0
