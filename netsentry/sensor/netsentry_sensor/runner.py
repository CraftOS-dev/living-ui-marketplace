"""The sensor loop: check in, run collectors on their intervals, report."""

from __future__ import annotations

import json
import os
import threading
import time
import traceback

from . import __version__, environment
from .client import Client, ConsoleError
from .collectors import ALL
from .collectors.base import Unavailable
from . import executor
from .util import SYSTEM, is_admin


class Runner:
    def __init__(self, client: Client | None, state_dir: str, log=print):
        self.client = client
        self.state_dir = state_dir
        self.log = log
        self.state_path = os.path.join(state_dir, "state.json")
        self.state = self._load_state()
        self.env = environment.describe()
        self.config: dict = {"intervals": {c.id: 300 for c in ALL}, "disabled": [], "fim_paths": [], "checkin_seconds": 60}
        self.next_due: dict[str, float] = {}
        # Fixing is switched on HERE (environment), never by the console; the console only sees whether it is.
        on = executor.enabled()
        from . import files, terminal
        files.STATE_DIR = state_dir  # never shown, read or changed through Files
        caps = self.state.setdefault("capabilities", {})
        caps["executor"] = {
            "available": on, "reason": "" if on else "fixing is off on this server (set NETSENTRY_EXECUTOR=on for the monitor to allow it)",
            "actions": executor.available_actions() if on else []}
        # The terminal (and commands) are switched on here too (v4 §6): the console only sees whether they are.
        caps["terminal"] = terminal.capability()
        from . import reads
        caps["reads"] = {"available": True, "kinds": sorted(reads.KINDS)}
        self.executor = executor.Executor(client, self.state, log, state_dir) if client else None
        # What people asked to see: queued here and answered by up to READ_WORKERS threads at once — the
        # console hands each request out once, so none may be dropped (v4 §17: a refresh asked while the
        # disk was being measured was thrown away, and the page gave up after 40 s).
        self._read_queue: list = []
        self._read_lock = threading.Lock()
        self._read_workers = 0
        self.last_checkin = 0.0
        self._terminals: dict = {}
        # A change (a 2 GB pull, a backup) runs on its own thread so check-ins, logs and readings keep going.
        self._job: threading.Thread | None = None
        self._job_finished = False
        self._save_lock = threading.Lock()
        # v4 §16: live numbers while someone looks, and Docker events that make the monitor report at once.
        self._urgent: list[str] = []  # checks a Docker event asked for: run at once on their own thread
        self._urgent_thread: threading.Thread | None = None
        self._urgent_lock = threading.Lock()
        self._locks: dict[str, threading.Lock] = {}  # one run of a check at a time (main loop or urgent thread)
        self._report_lock = threading.Lock()
        self._checkins_running = False  # forever(): check-ins run on their own thread
        self._revoked = False
        from . import live
        self.live = live.Live(client, self.poke, log) if client else None

    URGENT = ("host.containers", "probe.apps", "host.container_stats")

    # An app that just started answers a moment later (Docker sets its port up, the app boots): ask again
    # whether it answers, often at first (v4 §16 walk — a probe 0.4 s after the start still found it down
    # and kept "stopped" on Home until the next regular probe). Local requests: cheap.
    FOLLOW_UP = (1.0, 2.0, 3.0, 5.0, 8.0, 13.0, 20.0)

    def poke(self, action: str = "") -> None:
        """An app started, stopped or changed health: report containers (and their numbers) now — on a
        thread of their own, so a slow check already running (updates, disks) never holds them up."""
        if action in ("start", "restart", "unpause"):
            for delay in self.FOLLOW_UP:
                t = threading.Timer(delay, self._enqueue, args=(("probe.apps",),))
                t.daemon = True
                t.start()
        self._enqueue(self.URGENT)

    def _enqueue(self, ids) -> None:
        with self._urgent_lock:
            for cid in ids:
                if cid not in self._urgent:
                    self._urgent.append(cid)
            if self._urgent_thread is None:
                self._urgent_thread = threading.Thread(target=self._run_urgent, name="netsentry-urgent", daemon=True)
                self._urgent_thread.start()

    def _run_urgent(self) -> None:
        by_id = {c.id: c for c in ALL}
        while True:
            with self._urgent_lock:
                if not self._urgent:
                    self._urgent_thread = None  # a poke from now on starts a new one
                    return
                cid = self._urgent.pop(0)
            cls = by_id.get(cid)
            if not cls or cid in self.config.get("disabled", []):
                continue
            try:
                self._run_and_report(cls)
            except Exception as e:  # a refused or unreachable console: the main loop reports later
                self.log(f"[{cid}] urgent run: {e}")

    def _lock(self, cid: str) -> threading.Lock:
        return self._locks.setdefault(cid, threading.Lock())

    def _load_state(self) -> dict:
        try:
            with open(self.state_path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def _save_state(self) -> None:
        with self._save_lock:
            for _ in range(5):
                try:
                    text = json.dumps(self.state)
                    break
                except RuntimeError:  # the change thread added to it mid-copy: try again
                    time.sleep(0.05)
            else:
                return
            tmp = self.state_path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(text)
            os.replace(tmp, self.state_path)

    def _run_jobs(self, jobs: list) -> None:
        try:
            self.executor.run(jobs)
        finally:
            self._save_state()
            self._job_finished = True

    def job_running(self) -> bool:
        return bool(self._job and self._job.is_alive())

    def wait_for_change(self) -> None:
        """Before the process exits (--once): let a running change finish rather than cut it off half-way."""
        if self._job:
            self._job.join()

    def info(self) -> dict:
        return {
            "hostname": environment.hostname(),
            "platform": SYSTEM,
            "os": environment.os_label(),
            "version": __version__,
            "is_admin": is_admin(),
            "environment": self.env,
            "capabilities": self.state.get("capabilities", {}),
        }

    def checkin(self) -> None:
        cfg = self.client.call("sensors.checkin", {"info": json.dumps(self.info())})
        self.client.asset_id = str(cfg.get("asset_id") or self.client.asset_id)
        # app_config / probe_targets: what the app catalogue asks this machine to read and probe
        self.config.update({k: cfg[k] for k in ("intervals", "disabled", "fim_paths", "checkin_seconds", "app_config", "probe_targets", "app_accounts") if k in cfg})
        if self.live:
            self.live.watch(bool(cfg.get("live")))
        if isinstance(cfg.get("protect"), list):
            from . import files
            files.PROTECT = [str(p) for p in cfg["protect"][:10]]
        # "Check now" in NetSentry: a newer request than the last one handled runs every check at once.
        if self._job_finished:
            self._job_finished = False
            self.next_due.clear()  # after a change, report everything again so NetSentry can check it
        if self.executor and self.executor.state.get("outbox") and not self.job_running():
            self.executor.flush_outbox()  # reports NetSentry couldn't take earlier (a change's progress)
            self._save_state()
        if self.executor and cfg.get("fix_jobs") and not self.job_running():
            # one change at a time; the console offers the next one at a later check-in
            self._job = threading.Thread(target=self._run_jobs, args=(cfg["fix_jobs"],), name="netsentry-change", daemon=True)
            self._job.start()
        # v3 §9: logs a person asked for — read now, secrets hidden here, sent straight back.
        for req in (cfg.get("log_requests") or [])[:5]:
            # on its own thread: a big log mustn't hold the next check-in up
            threading.Thread(target=self._answer_log, args=(req,), name="netsentry-logs", daemon=True).start()
        # v4: what a person asked to see (files, disk, programs, firewall…) — answered on its own thread
        # so check-ins and readings keep going while a big folder is measured.
        reads = (cfg.get("read_requests") or [])[:5]
        if reads:
            self._queue_reads(reads)
        # v4 §6: terminal sessions an admin opened (each runs on its own thread until it closes)
        from . import terminal
        for s in (cfg.get("terminal_sessions") or [])[:3]:
            sid = str(s.get("id", ""))
            if sid and sid not in self._terminals and terminal.enabled() and terminal.capability().get("available"):
                t = terminal.Session(sid, self.client, s.get("cols") or 100, s.get("rows") or 30, self.log, on_end=lambda x: self._terminals.pop(x, None))
                self._terminals[sid] = t
                t.start()
        if self.executor and not self.job_running() and time.time() - self.state.get("housekept", 0) > 86400:
            self.state["housekept"] = time.time()
            try:
                self.executor.housekeeping()
            except Exception as e:
                self.log(f"[fix] housekeeping: {e}")
        requested = str(cfg.get("run_requested") or "")
        if requested and requested != self.state.get("run_handled"):
            self.state["run_handled"] = requested
            self.next_due.clear()
            self._save_state()

    def _answer_log(self, req: dict) -> None:
        from . import logs
        lines, error = logs.read(req)
        try:
            self.client.call("sensors.logs-reply", {"request_id": req.get("id", ""), "lines": json.dumps(lines), "error": error})
        except (ConsoleError, OSError) as e:
            self.log(f"[logs] the console didn't take the answer: {e}")

    READ_WORKERS = 3

    def _queue_reads(self, requests: list) -> None:
        with self._read_lock:
            self._read_queue.extend(requests)
            start = min(self.READ_WORKERS - self._read_workers, len(self._read_queue))
            self._read_workers += max(0, start)
        for _ in range(max(0, start)):
            threading.Thread(target=self._read_worker, name="netsentry-reads", daemon=True).start()

    def _read_worker(self) -> None:
        while True:
            with self._read_lock:
                if not self._read_queue:
                    self._read_workers -= 1
                    return
                req = self._read_queue.pop(0)
            self._answer_reads([req])

    def _answer_reads(self, requests: list) -> None:
        from . import reads
        for req in requests:
            result, error = reads.answer(req, self.client)
            try:
                self.client.call("sensors.read-reply", {"request_id": req.get("id", ""), "result": json.dumps(result) if result is not None else "", "error": error})
            except ConsoleError as e:
                self.log(f"[reads] the console refused the answer: {e}")
            except OSError as e:
                self.log(f"[reads] console unreachable: {e}")

    def run_collector(self, cls) -> dict:
        """Run one collector; always returns a report payload (result, unavailable or error)."""
        caps = self.state.setdefault("capabilities", {})
        cfg = dict(self.config)
        cfg["_cloud"] = self.env.get("cloud")
        cfg["_container"] = self.env.get("container")
        collector = cls(self.state.setdefault("collectors", {}).setdefault(cls.id, {}), cfg)
        try:
            result = collector.collect()
            caps[cls.id] = {"available": True}
            payload = {"collector": cls.id, "complete": result.get("complete", True), "note": result.get("note", "")}
            if "observations" in result:
                payload["observations"] = result["observations"]
            if "signals" in result:
                payload["signals"] = result["signals"]
            return payload
        except Unavailable as e:
            caps[cls.id] = {"available": False, "reason": str(e)}
            return {"collector": cls.id, "unavailable": str(e)}
        except Exception as e:  # a collector bug must not stop the sensor
            caps[cls.id] = {"available": False, "reason": f"error: {e}"}
            return {"collector": cls.id, "error": f"{type(e).__name__}: {e}\n{traceback.format_exc(limit=3)}"[:900]}
        finally:
            self._save_state()

    def _run_and_report(self, cls) -> dict:
        """Run one check (never two runs of it at once) and send its result to the console."""
        with self._lock(cls.id):
            self.next_due[cls.id] = time.time() + max(60, int(self.config.get("intervals", {}).get(cls.id, 300)))
            payload = self.run_collector(cls)
            if self.client:
                try:
                    with self._report_lock:
                        r = self.client.report(payload)
                except ConsoleError as e:
                    if e.status in (401, 403):
                        raise  # revoked / bad token: the caller stops
                    self.log(f"[{cls.id}] rejected by the console: {e}")  # keep going with the other collectors
                    return payload
                summary = (
                    "spooled (console unreachable)" if r is None
                    else payload.get("unavailable") and f"unavailable: {payload['unavailable']}"
                    or payload.get("error") and "error"
                    or f"{r.get('status')} | {r.get('observations', 0)} obs | {r.get('changes', 0)} changes | +{r.get('opened', 0)} findings"
                )
                self.log(f"[{cls.id}] {summary}")
            return payload

    def run_once(self, only_due: bool = False) -> list[dict]:
        now = time.time()
        payloads = []
        for cls in ALL:
            if cls.id in self.config.get("disabled", []):
                continue
            if only_due and self.next_due.get(cls.id, 0) > now:
                continue
            payloads.append(self._run_and_report(cls))
            self._checkin_if_due()  # all checks at once (after a change) can take a while: keep answering
        return payloads

    def _checkin_if_due(self) -> None:
        if not self.client or self._checkins_running:
            return  # running forever: check-ins have their own thread
        try:
            every = max(1, int(self.config.get("checkin_seconds", 60)))
        except (TypeError, ValueError):
            every = 60
        if time.time() - self.last_checkin >= every:
            self.last_checkin = time.time()
            self.checkin()
            self.client.flush_spool()

    def _pause(self) -> int:
        """Fast while someone watches this machine (the console says 2 s); otherwise every 5 s."""
        try:
            return max(1, min(5, int(self.config.get("checkin_seconds", 60))))
        except (TypeError, ValueError):
            return 5

    def _checkin_loop(self) -> None:
        """Check-ins on their own thread (v4 §17 walk): a slow check (Windows updates, autostart entries…)
        held them up to 20 s, so a file listing, the terminal or a confirmed change waited that long to be
        seen. Now they come every 2 s while someone watches, whatever the checks are doing."""
        while not self._revoked:
            try:
                self.last_checkin = time.time()
                self.checkin()
            except ConsoleError as e:
                self.log(f"console refused the check-in: {e}")
                if e.status in (401, 403):
                    self._revoked = True
                    return
            except OSError as e:
                self.log(f"console unreachable ({e}); trying again")
            except Exception as e:  # a bug in handling one answer must not stop check-ins
                self.log(f"[checkin] {type(e).__name__}: {e}")
            time.sleep(self._pause())

    def forever(self) -> None:
        if self.live:
            self.live.start_events()
        if self.client:
            self._checkins_running = True
            threading.Thread(target=self._checkin_loop, name="netsentry-checkin", daemon=True).start()
        while True:
            if self._revoked:
                self.log("The token was rejected or the sensor was revoked. Stopping.")
                return
            try:
                self.run_once(only_due=True)
                if self.client:
                    self.client.flush_spool(budget=2.0)  # a backlog goes out a little at a time, never blocking check-ins
            except ConsoleError as e:
                self.log(f"console refused: {e}")
                if e.status in (401, 403):
                    self.log("The token was rejected or the sensor was revoked. Stopping.")
                    return
            except OSError as e:
                self.log(f"console unreachable ({e}); reports are spooled and retried")
            # Fast while someone watches this machine (the console says 2 s); otherwise every 5 s.
            try:
                pause = max(1, min(5, int(self.config.get("checkin_seconds", 60))))
            except (TypeError, ValueError):
                pause = 5
            time.sleep(pause)
