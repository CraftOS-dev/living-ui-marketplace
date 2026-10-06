"""Collector contract. A collector reports the COMPLETE current state of the
kinds it owns (so the console can tell what disappeared), or marks the result
partial when it could not see everything (e.g. unreadable home directories).

collect() returns a dict:
  observations: [{kind, subject, data}]   state (diffed by the console)
  signals:      [{kind, key, window_start, count, data}]   events, pre-aggregated
  complete:     bool (default True)
  note:         str
Raise Unavailable(reason) when the collector cannot run on this host at all.
"""

from __future__ import annotations


class Unavailable(Exception):
    """This collector cannot run here (platform, missing tool, needs admin)."""


class Collector:
    id: str = ""
    platforms: tuple[str, ...] = ("linux", "windows", "darwin")

    def __init__(self, state: dict, config: dict):
        self.state = state  # persisted between runs (cursors, offsets)
        self.config = config  # from the console check-in

    def collect(self) -> dict:  # pragma: no cover - interface
        raise NotImplementedError
