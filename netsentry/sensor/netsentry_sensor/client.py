"""Talks to the NetSentry console: sign in with the sensor token, call the two
sensor operations, and spool reports to disk while the console is unreachable."""

from __future__ import annotations

import ipaddress
import json
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

EMAIL_DOMAIN = "sensor.netsentry.invalid"


class ConsoleError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status


def parse_token(token: str) -> tuple[str, str]:
    """'ns1.<local>.<password>' → (email, password)."""
    parts = token.strip().split(".", 2)
    if len(parts) != 3 or parts[0] != "ns1" or not parts[1] or not parts[2]:
        raise ValueError("That is not a NetSentry sensor token (expected ns1.<id>.<secret>).")
    return f"{parts[1]}@{EMAIL_DOMAIN}", parts[2]


def check_console_url(url: str) -> str:
    """The sensor token travels to this URL: plain http only to this machine."""
    u = urllib.parse.urlsplit(url.strip())
    if u.scheme not in ("http", "https") or not u.hostname:
        raise ValueError("The console URL must look like https://netsentry.example.com or http://127.0.0.1:8471")
    if u.scheme == "http":
        host = u.hostname
        try:
            loopback = ipaddress.ip_address(host).is_loopback
        except ValueError:
            loopback = host == "localhost"
        if not loopback:
            raise ValueError("A console on another server must use https:// — the sensor token would otherwise travel in clear text.")
    return url.strip().rstrip("/")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow redirects: urllib would re-send the Authorization header to the new location."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, f"console redirected to {newurl} — use that URL directly", headers, fp)


class Client:
    def __init__(self, console: str, token: str, spool_dir: str, ca_file: str | None = None):
        self.console = check_console_url(console)
        ctx = ssl.create_default_context(cafile=ca_file) if ca_file else ssl.create_default_context()
        self._opener = urllib.request.build_opener(_NoRedirect(), urllib.request.HTTPSHandler(context=ctx))
        self.email, self.password = parse_token(token)
        self.jwt: str | None = None
        self.spool_dir = spool_dir
        os.makedirs(spool_dir, exist_ok=True)

    def _post(self, path: str, body: dict, auth: bool = True) -> dict:
        data = json.dumps(body).encode()
        headers = {"content-type": "application/json", "user-agent": "netsentry-sensor"}
        if auth and self.jwt:
            headers["authorization"] = self.jwt
        req = urllib.request.Request(self.console + path, data=data, headers=headers, method="POST")
        try:
            with self._opener.open(req, timeout=60) as r:  # admin-configured console URL (checked above)
                return json.loads(r.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read().decode()).get("message") or e.reason
            except Exception:
                msg = e.reason
            finally:
                e.close()
            raise ConsoleError(e.code, str(msg)) from None

    def login(self) -> None:
        r = self._post("/api/collections/sensors/auth-with-password", {"identity": self.email, "password": self.password}, auth=False)
        self.jwt = r.get("token")
        if not self.jwt:
            raise ConsoleError(401, "sign-in returned no token")

    BUSY_WAITS = (1, 2, 4, 8)  # "too many requests": the console refused before doing anything — wait and ask again

    def _send(self, path: str, body: dict) -> dict:
        for wait in self.BUSY_WAITS + (None,):
            try:
                return self._post(path, body)
            except ConsoleError as e:
                if e.status != 429 or wait is None:
                    raise
                time.sleep(wait)
        raise AssertionError("unreachable")

    def call(self, op: str, params: dict) -> dict:
        if not self.jwt:
            self.login()
        path = "/api/ops/" + op.replace(".", "-")
        try:
            return self._send(path, params)
        except ConsoleError as e:
            if e.status != 401:
                raise
            self.login()  # token expired or rotated
            return self._send(path, params)

    def post(self, path: str, body: dict) -> dict:
        """A call on one of NetSentry's own routes (the terminal's live stream), signed in like call()."""
        if not self.jwt:
            self.login()
        try:
            return self._send(path, body)
        except ConsoleError as e:
            if e.status != 401:
                raise
            self.login()
            return self._send(path, body)

    # ------------------------------------------------------------- files (v4 §7.1)
    # A file a person moves to or from this server travels as a file, through NetSentry's own
    # collection (N-B11): never inside a report, never through the agent.

    asset_id = ""  # this server's record in NetSentry (from the check-in)

    def _raw(self, method: str, path: str, data: bytes | None = None, headers: dict | None = None) -> bytes:
        if not self.jwt:
            self.login()
        h = {"user-agent": "netsentry-sensor", "authorization": self.jwt or ""}
        h.update(headers or {})
        req = urllib.request.Request(self.console + path, data=data, headers=h, method=method)
        try:
            with self._opener.open(req, timeout=300) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read().decode()).get("message") or e.reason
            except Exception:
                msg = e.reason
            finally:
                e.close()
            raise ConsoleError(e.code, str(msg)) from None

    def fetch_transfer(self, transfer_id: str) -> bytes:
        """A file a person uploaded for this server."""
        if not transfer_id.isalnum():
            raise ConsoleError(400, "not a transfer id")
        for attempt in range(3):  # a connection reset mid-way (seen in the lab) shouldn't fail the change
            try:
                rec = json.loads(self._raw("GET", f"/api/collections/file_transfers/records/{transfer_id}") or b"{}")
                token = json.loads(self._raw("POST", "/api/files/token") or b"{}").get("token", "")
                name = urllib.parse.quote(str(rec.get("file") or ""))
                return self._raw("GET", f"/api/files/file_transfers/{transfer_id}/{name}?token={urllib.parse.quote(token)}")
            except (urllib.error.URLError, OSError):
                if attempt == 2:
                    raise
                time.sleep(1 + attempt)
        return b""

    def send_transfer(self, name: str, data: bytes, request_id: str) -> str:
        """A file from this server, answering the download a person asked for (request_id) — returns its id."""
        import hashlib
        import uuid as _uuid
        boundary = "----netsentry" + _uuid.uuid4().hex
        fields = {"request_id": request_id, "name": name[:255], "sha256": hashlib.sha256(data).hexdigest()}
        parts = []
        crlf = "\r\n"
        for k, v in fields.items():
            parts.append(f'--{boundary}{crlf}Content-Disposition: form-data; name="{k}"{crlf}{crlf}{v}{crlf}'.encode())
        safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in name)[:120] or "file"
        head = f'--{boundary}{crlf}Content-Disposition: form-data; name="file"; filename="{safe}"{crlf}Content-Type: application/octet-stream{crlf}{crlf}'
        parts.append(head.encode() + data + crlf.encode())
        parts.append(f"--{boundary}--{crlf}".encode())
        out = json.loads(self._raw("POST", "/api/ops/sensors-transfer-put", b"".join(parts), {"content-type": f"multipart/form-data; boundary={boundary}"}) or b"{}")
        return str(out.get("transfer_id", ""))

    # ------------------------------------------------------------- spool

    def report(self, payload: dict) -> dict | None:
        """Send a report; on network failure keep it on disk and retry later."""
        try:
            return self.call("sensors.report", {"payload": json.dumps(payload)})
        except (urllib.error.URLError, OSError, TimeoutError):
            name = os.path.join(self.spool_dir, f"{time.time():.6f}-{payload.get('collector', 'x')}.json")
            with open(name, "w", encoding="utf-8") as f:
                json.dump(payload, f)
            return None

    SPOOL_MAX_AGE = 3600  # older than this, a snapshot would show the server as it WAS: dropped, not replayed

    def flush_spool(self, limit: int = 50, budget: float | None = None) -> int:
        """Send reports kept while NetSentry was away, oldest first — at most `limit`, and for at most
        `budget` seconds, so a long backlog never holds anything else up (v4 §17: a backlog of days held
        check-ins 14 s apart)."""
        sent = 0
        started = time.time()
        for name in sorted(os.listdir(self.spool_dir))[:limit]:
            if budget is not None and time.time() - started > budget:
                break
            path = os.path.join(self.spool_dir, name)
            try:
                if time.time() - os.path.getmtime(path) > self.SPOOL_MAX_AGE:
                    os.remove(path)
                    continue
            except OSError:
                continue
            try:
                with open(path, encoding="utf-8") as f:
                    payload = json.load(f)
                self.call("sensors.report", {"payload": json.dumps(payload)})
            except (urllib.error.URLError, OSError, TimeoutError):
                break  # still offline
            except (ConsoleError, ValueError):
                pass  # rejected or corrupt: drop it rather than retry forever
            os.remove(path)
            sent += 1
        return sent


def enrol(console: str, join_token: str, name: str, ca_file: str | None = None) -> dict:
    """Swap a join token (nsj1.<id>.<secret>) for this machine's own sensor token.
    The join token is sent once, to the console only, and not kept."""
    console = check_console_url(console)
    if not join_token.strip().startswith("nsj1."):
        raise ValueError("That is not a NetSentry join token (expected nsj1.<id>.<secret>).")
    ctx = ssl.create_default_context(cafile=ca_file) if ca_file else ssl.create_default_context()
    opener = urllib.request.build_opener(_NoRedirect(), urllib.request.HTTPSHandler(context=ctx))
    req = urllib.request.Request(console + "/api/netsentry/join", method="POST",
                                 data=json.dumps({"join": join_token.strip(), "name": name[:70]}).encode(),
                                 headers={"content-type": "application/json", "user-agent": "netsentry-sensor"})
    try:
        with opener.open(req, timeout=30) as r:
            out = json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode()).get("message") or e.reason
        except Exception:
            msg = e.reason
        finally:
            e.close()
        raise ConsoleError(e.code, str(msg)) from None
    parse_token(out.get("token", ""))  # must be a real sensor token
    return out


