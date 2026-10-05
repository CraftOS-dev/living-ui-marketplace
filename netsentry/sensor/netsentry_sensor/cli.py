"""netsentry-sensor — command line.

  netsentry-sensor check                              # what can this host report? (no network)
  netsentry-sensor run --console URL --token TOKEN    # connect and keep reporting
  netsentry-sensor run --once ...                     # one full cycle, then exit
  netsentry-sensor enrol --console URL --join JOIN    # swap a join token for this machine's own token
                                                      # (kept in the state folder; `run` then needs no --token)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

from . import __version__
from .client import Client, ConsoleError, check_console_url, enrol, parse_token
from .runner import Runner
from .util import SYSTEM


def default_state_dir() -> str:
    if SYSTEM == "windows":
        base = os.environ.get("PROGRAMDATA") if os.access(os.environ.get("PROGRAMDATA", ""), os.W_OK) else os.environ.get("LOCALAPPDATA", ".")
        return os.path.join(base, "NetSentrySensor")
    return "/var/lib/netsentry-sensor" if os.geteuid() == 0 else os.path.expanduser("~/.netsentry-sensor")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="netsentry-sensor", description="Report this host's security state to NetSentry.")
    p.add_argument("--version", action="version", version=__version__)
    sub = p.add_subparsers(dest="cmd", required=True)
    check = sub.add_parser("check", help="Run every collector locally and print a summary (nothing is sent).")
    check.add_argument("--json", action="store_true", help="Print the full payloads.")
    run = sub.add_parser("run", help="Connect to a NetSentry console and report continuously.")
    run.add_argument("--console", default=os.environ.get("NETSENTRY_CONSOLE"), help="Console URL, e.g. http://127.0.0.1:8471")
    run.add_argument("--token", default=os.environ.get("NETSENTRY_TOKEN"), help="Sensor token from Sources → Sensors (or NETSENTRY_TOKEN)")
    run.add_argument("--ca-file", default=os.environ.get("NETSENTRY_CA_FILE"), help="CA certificate to trust for a console with a private/self-signed certificate")
    run.add_argument("--state-dir", default=None)
    run.add_argument("--once", action="store_true", help="One full cycle, then exit.")
    join = sub.add_parser("enrol", help="Enrol this server with a join token.")
    join.add_argument("--console", default=os.environ.get("NETSENTRY_CONSOLE"), help="Console URL")
    join.add_argument("--join", default=os.environ.get("NETSENTRY_JOIN"), help="Join token from NetSentry (or NETSENTRY_JOIN)")
    join.add_argument("--name", default=None, help="Name for this server (default: its hostname)")
    join.add_argument("--ca-file", default=os.environ.get("NETSENTRY_CA_FILE"))
    join.add_argument("--state-dir", default=None)
    join.add_argument("--replace", action="store_true", help="Already enrolled: get a new key with this join token (reconnect).")
    args = p.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows consoles default to a legacy code page
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

    state_dir = getattr(args, "state_dir", None) or default_state_dir()
    if args.cmd in ("run", "enrol"):
        os.makedirs(state_dir, exist_ok=True)
    token_file = os.path.join(state_dir, "token")

    if args.cmd == "enrol":
        from . import environment
        if not args.console or not args.join:
            print("--console and --join are required (or NETSENTRY_CONSOLE / NETSENTRY_JOIN).", file=sys.stderr)
            return 2
        if os.path.exists(token_file) and not args.replace:
            print(f"This server is already enrolled (its token is in {token_file}). Remove that file to enrol again.")
            return 0
        try:
            name = args.name or environment.hostname()
            out = enrol(args.console, args.join, name, ca_file=args.ca_file)
        except ValueError as e:
            print(str(e), file=sys.stderr)
            return 2
        except ConsoleError as e:
            print(f"The console refused to enrol this server: {e}", file=sys.stderr)
            return 1
        except OSError as e:
            print(f"Cannot reach the console at {args.console}: {e}", file=sys.stderr)
            return 1
        fd = os.open(token_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(out["token"])
        print(f"Enrolled as \"{out.get('name', '')}\". Start it with: netsentry-sensor run --console {args.console}")
        return 0

    if args.cmd == "check":
        # Throwaway state: a dry run must not mark destinations/cursors as already reported.
        import tempfile

        runner = Runner(None, tempfile.mkdtemp(prefix="netsentry-check-"))
        for payload in runner.run_once():
            if args.json:
                print(json.dumps(payload, indent=2))
                continue
            cid = payload["collector"]
            if "unavailable" in payload:
                print(f"  -  {cid:<18} unavailable: {payload['unavailable']}")
            elif "error" in payload:
                print(f"  !  {cid:<18} error: {payload['error'].splitlines()[0]}")
            else:
                n = len(payload.get("observations", [])) + len(payload.get("signals", []))
                extra = "" if payload.get("complete", True) else " (partial)"
                print(f"  ok {cid:<18} {n} item(s){extra}{' - ' + payload['note'] if payload.get('note') else ''}")
        return 0

    if not args.token and os.path.exists(token_file):
        with open(token_file, encoding="utf-8") as f:
            args.token = f.read().strip()  # saved by `enrol`
    if not args.console or not args.token:
        print("Both --console and --token are required (or NETSENTRY_CONSOLE / NETSENTRY_TOKEN).", file=sys.stderr)
        return 2
    try:
        parse_token(args.token)
        check_console_url(args.console)
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 2
    client = Client(args.console, args.token, os.path.join(state_dir, "spool"), ca_file=args.ca_file)
    runner = Runner(client, state_dir)
    # Which process is the monitor: the installer stops exactly this one before an update or an uninstall.
    try:
        with open(os.path.join(state_dir, "monitor.pid"), "w", encoding="ascii") as f:
            f.write(str(os.getpid()))
    except OSError:
        pass
    # The server may start the monitor before NetSentry is up (a boot, a console restart): keep trying.
    # Only a refused key ends it — that needs a person (a revoked or replaced monitor).
    wait = 2
    while True:
        try:
            client.login()
            runner.checkin()
            break
        except ConsoleError as e:
            if e.status in (401, 403):
                print(f"The console refused this sensor: {e}", file=sys.stderr)
                return 1
            print(f"The console answered {e} — trying again in {wait} s", file=sys.stderr)
        except OSError as e:
            if args.once:
                print(f"Cannot reach the console at {args.console}: {e}", file=sys.stderr)
                return 1
            print(f"Cannot reach the console at {args.console} yet ({e}) — trying again in {wait} s", file=sys.stderr)
        time.sleep(wait)
        wait = min(60, wait * 2)
    print(f"NetSentry sensor {__version__} connected to {args.console}")
    if args.once:
        runner.run_once()
        runner.checkin()  # publish capabilities learned during the cycle
        runner.wait_for_change()
        return 0
    runner.forever()
    return 1
