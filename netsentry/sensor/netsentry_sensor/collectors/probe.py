"""Probe role (plan §18.2): what the network sees, measured from this machine.

`probe.router`  finds the home/office router over UPnP (SSDP) and reads its
                port forwards and public address — no password, read-only.
`probe.apps`    asks the apps on this machine the questions the app catalogue
                lists (e.g. Jellyfin's public system info) with plain,
                unauthenticated GET requests, and records whether each app is up.

Safety (never negotiable here):
  - only GET requests, never a login, never a guessed password (plan D8);
  - app probes only reach addresses of THIS machine (loopback or its own IPs);
    probing other machines needs a confirmed scan scope (P2);
  - router URLs are followed only to private / link-local addresses.
"""

from __future__ import annotations

import http.client
import ipaddress
import json
import re
import socket
import time
import urllib.parse
from xml.etree import ElementTree as ET

from ..util import SYSTEM, powershell_json, read_text, run
from .base import Collector, Unavailable

SSDP_ADDR = ("239.255.255.250", 1900)
IGD_TYPES = ("urn:schemas-upnp-org:device:InternetGatewayDevice:1", "urn:schemas-upnp-org:device:InternetGatewayDevice:2")
WAN_SERVICES = ("urn:schemas-upnp-org:service:WANIPConnection:1", "urn:schemas-upnp-org:service:WANIPConnection:2",
                "urn:schemas-upnp-org:service:WANPPPConnection:1")


# ------------------------------------------------------------- own addresses

def parse_fib_trie(text: str) -> set[str]:
    """Linux /proc/net/fib_trie → this machine's IPv4 addresses (the '/32 host LOCAL' entries)."""
    ips, last = set(), None
    for line in text.splitlines():
        m = re.match(r"\s*\|--\s+(\d+\.\d+\.\d+\.\d+)", line)
        if m:
            last = m.group(1)
        elif "/32 host LOCAL" in line and last:
            ips.add(last)
    return ips


def primary_ip() -> str:
    """The address this machine uses on its main network (the default route); '' if none."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("192.0.2.1", 9))  # TEST-NET: nothing is sent, the OS only picks the route
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return ""


def local_ips() -> set[str]:
    ips = {"127.0.0.1", "::1"}
    if SYSTEM == "linux":
        ips |= parse_fib_trie(read_text("/proc/net/fib_trie") or "")
    elif SYSTEM == "windows":
        for a in (powershell_json("Get-NetIPAddress | Select-Object IPAddress | ConvertTo-Json") or []):
            if isinstance(a, dict) and a.get("IPAddress"):
                ips.add(str(a["IPAddress"]).split("%")[0])
    else:
        code, out = run(["ifconfig"])
        ips |= set(re.findall(r"inet (\d+\.\d+\.\d+\.\d+)", out)) if code == 0 else set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(SSDP_ADDR)
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return ips


def is_private(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_private or ip.is_link_local


# ------------------------------------------------------------------- router

def parse_ssdp(reply: str) -> dict:
    headers = {}
    for line in reply.split("\r\n")[1:]:
        k, _, v = line.partition(":")
        if k:
            headers[k.strip().lower()] = v.strip()
    return headers


def ssdp_search(timeout: float = 3.0) -> list[str]:
    """M-SEARCH for an Internet Gateway Device; returns LOCATION URLs (deduplicated)."""
    msg = ("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\n"
           f"ST: {IGD_TYPES[0]}\r\n\r\n").encode()
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
    s.settimeout(0.5)
    found = []
    try:
        s.sendto(msg, SSDP_ADDR)
        end = time.time() + timeout
        while time.time() < end:
            try:
                data, _ = s.recvfrom(4096)
            except socket.timeout:
                continue
            loc = parse_ssdp(data.decode("utf-8", "replace")).get("location")
            if loc and loc not in found:
                found.append(loc)
    finally:
        s.close()
    return found


def _http(method: str, url: str, body: bytes | None = None, headers: dict | None = None, timeout: int = 5) -> tuple[int, bytes, dict]:
    u = urllib.parse.urlparse(url)
    if u.scheme == "https":
        # Apps on this network use their own certificates: this reads an app's answer about
        # itself, it never sends anything secret, so the certificate is not checked.
        import ssl
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        c = http.client.HTTPSConnection(u.hostname, u.port or 443, timeout=timeout, context=ctx)
    else:
        c = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=timeout)
    try:
        c.request(method, u.path + (("?" + u.query) if u.query else ""), body=body, headers=headers or {})
        r = c.getresponse()
        return r.status, r.read(512 * 1024), {k.lower(): v for k, v in r.getheaders()}
    finally:
        c.close()


def _strip_ns(root: ET.Element) -> ET.Element:
    for el in root.iter():
        if "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
    return root


def parse_device(xml_text: str, base_url: str) -> dict:
    """UPnP root description → router identity + WAN connection control URL."""
    root = _strip_ns(ET.fromstring(xml_text))
    dev = root.find("device")
    info = {k: (dev.findtext(k) or "").strip() if dev is not None else "" for k in ("friendlyName", "manufacturer", "modelName", "modelNumber", "UDN")}
    control = service = ""
    for svc in root.iter("service"):
        if (svc.findtext("serviceType") or "").strip() in WAN_SERVICES:
            service = svc.findtext("serviceType").strip()
            control = urllib.parse.urljoin(base_url, (svc.findtext("controlURL") or "").strip())
            break
    return {"identity": info, "service": service, "control_url": control}


def soap_call(control_url: str, service: str, action: str, args: dict | None = None) -> tuple[int, str]:
    inner = "".join(f"<{k}>{v}</{k}>" for k, v in (args or {}).items())
    body = (f'<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" '
            f's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>'
            f'<u:{action} xmlns:u="{service}">{inner}</u:{action}></s:Body></s:Envelope>').encode()
    status, data, _ = _http("POST", control_url, body, {"Content-Type": 'text/xml; charset="utf-8"', "SOAPAction": f'"{service}#{action}"'})
    return status, data.decode("utf-8", "replace")


def soap_value(xml_text: str, name: str) -> str:
    m = re.search(rf"<{name}>([^<]*)</{name}>", xml_text)
    return m.group(1) if m else ""


def parse_mapping(xml_text: str) -> dict:
    return {
        "external_port": int(soap_value(xml_text, "NewExternalPort") or 0),
        "proto": soap_value(xml_text, "NewProtocol").upper(),
        "internal_client": soap_value(xml_text, "NewInternalClient"),
        "internal_port": int(soap_value(xml_text, "NewInternalPort") or 0),
        "description": soap_value(xml_text, "NewPortMappingDescription")[:120],
        "enabled": soap_value(xml_text, "NewEnabled") in ("1", "true"),
        "remote_host": soap_value(xml_text, "NewRemoteHost"),
    }


class Router(Collector):
    id = "probe.router"

    def collect(self) -> dict:
        locations = [l for l in ssdp_search() if is_private(urllib.parse.urlparse(l).hostname or "")]
        if not locations:
            raise Unavailable("no router answered UPnP discovery (UPnP may be off — port forwards are then checked from outside only)")
        obs = []
        for loc in locations[:3]:
            status, body, _ = _http("GET", loc)
            if status != 200:
                continue
            dev = parse_device(body.decode("utf-8", "replace"), loc)
            if not dev["control_url"] or not is_private(urllib.parse.urlparse(dev["control_url"]).hostname or ""):
                continue
            ident = dev["identity"]
            _, ext = soap_call(dev["control_url"], dev["service"], "GetExternalIPAddress")
            router_id = ident.get("UDN") or loc
            obs.append({"kind": "router.igd", "subject": router_id, "data": {
                "manufacturer": ident.get("manufacturer"), "model": ident.get("modelName"), "name": ident.get("friendlyName"),
                "address": urllib.parse.urlparse(loc).hostname, "external_ip": soap_value(ext, "NewExternalIPAddress")}})
            for i in range(256):
                st, xml = soap_call(dev["control_url"], dev["service"], "GetGenericPortMappingEntry", {"NewPortMappingIndex": i})
                if st != 200:
                    break  # 713 SpecifiedArrayIndexInvalid = end of the list
                m = parse_mapping(xml)
                obs.append({"kind": "router.port_mapping", "subject": f"{router_id}|{m['proto']}/{m['external_port']}", "data": dict(m, router=router_id)})
        if not obs:
            raise Unavailable("a UPnP device answered but it is not a router we can read")
        return {"observations": obs}


# --------------------------------------------------------------------- apps

MAX_JSON_KEYS = 40
# Apps sometimes hand out secrets to anyone who asks (e.g. a fresh Sonarr's API key in /initialize.json).
# NetSentry records THAT a secret was exposed, never the secret itself.
SECRET_KEY = re.compile(r"(api[_-]?key|token|secret|passw(or)?d|pass|auth[_-]?key|private)", re.I)
SECRET_VALUE = re.compile(r'("[A-Za-z_]*(?:api[_-]?key|token|secret|passw(?:or)?d|private)[A-Za-z_]*"\s*:\s*)"[^"]*"', re.I)


MAX_FIND = 8


def _scalar(k: str, v):
    if SECRET_KEY.search(str(k)):
        return "[exposed]" if v not in (None, "") else ""
    return v if isinstance(v, (bool, int, float)) or v is None else str(v)[:200]


def summarise_body(body: bytes, content_type: str, want: str, find: list | None = None, keys: list | None = None) -> dict:
    """Keep what the catalogue asked for, small: JSON top-level scalars (or only the named
    `keys`, dotted for nested ones), a text excerpt, the page title, or (want "find") only
    whether each of a few catalogue phrases is on the page."""
    text = body.decode("utf-8", "replace")
    if want == "find":
        m = re.search(r"<title[^>]*>([^<]*)</title>", text, re.I)
        return {"title": m.group(1).strip()[:120] if m else "",
                "found": {str(f)[:80]: str(f)[:80] in text for f in (find or [])[:MAX_FIND]}}
    if want == "json":
        try:
            data = json.loads(text)
        except ValueError:
            return {"json": None}
        if isinstance(data, dict) and keys:
            out = {}
            for key in keys[:MAX_JSON_KEYS]:
                v = data
                for part in str(key).split("."):
                    v = v.get(part) if isinstance(v, dict) else None
                if not isinstance(v, (dict, list)):
                    out[str(key)] = _scalar(str(key).split(".")[-1], v)
            return {"json": out}
        if isinstance(data, dict):
            out = {}
            for k, v in list(data.items())[:MAX_JSON_KEYS]:
                if isinstance(v, (dict, list)):
                    continue
                if SECRET_KEY.search(str(k)):
                    out[k] = "[exposed]" if v not in (None, "") else ""
                else:
                    out[k] = v if isinstance(v, (bool, int, float)) or v is None else str(v)[:200]
            return {"json": out}
        return {"json": None}
    if want == "text":
        return {"text": SECRET_VALUE.sub(r'\1"[exposed]"', text[:400])}
    if want == "title":
        m = re.search(r"<title[^>]*>([^<]*)</title>", text, re.I)
        return {"title": m.group(1).strip()[:120] if m else ""}
    return {}


# The only raw TCP questions the monitor asks (the console can't make it send anything else).
TCP_QUESTIONS = {"", "PING", "hex:0000000804d2162f"}


def tcp_answer(host: str, port: int, send: str = "", timeout: int = 5) -> dict:
    """A raw TCP question for services that don't speak HTTP (Redis, databases): open the
    connection, optionally send one harmless line (e.g. PING) or a few bytes given as
    "hex:…" (e.g. Postgres' SSL question), read the first reply. Never a login.
    Replies are cut short and masked."""
    if send not in TCP_QUESTIONS:
        raise OSError("not a question this monitor asks")
    with socket.create_connection((host, port), timeout=timeout) as s:
        if send.startswith("hex:"):
            s.sendall(bytes.fromhex(send[4:])[:40])
        elif send:
            s.sendall(send.encode("ascii", "ignore")[:40] + b"\r\n")
        s.settimeout(3)
        try:
            data = s.recv(512)
        except socket.timeout:
            data = b""
    return {"status": "open", "banner": SECRET_VALUE.sub(r'\1"[exposed]"', data.decode("latin-1")[:200])}


class Apps(Collector):
    id = "probe.apps"

    def collect(self) -> dict:
        targets = self.config.get("probe_targets") or []
        if not targets:
            return {"observations": [], "note": "no apps to probe yet"}
        mine = local_ips()

        def allowed(host: str) -> bool:
            # v4: this server's own apps only
            return host in mine

        seen = self.state.setdefault("up", {})
        obs, skipped = [], 0
        for t in targets:
            host, port = str(t.get("host", "")), int(t.get("port") or 0)
            if not allowed(host) or not (0 < port < 65536):
                skipped += 1
                continue
            endpoint = f"{host}:{port}"
            up, first_status = False, None
            for p in t.get("paths") or [{"path": "/", "want": "status"}]:
                if p.get("want") == "tcp":
                    try:
                        data = tcp_answer(host, port, str(p.get("send") or ""))
                    except OSError as e:
                        data = {"error": type(e).__name__}
                    up = up or "error" not in data
                    obs.append({"kind": "app.http", "subject": f"{endpoint}{p['path']}", "data": data})
                    continue
                try:
                    status, body, headers = _http("GET", f"{'https' if p.get('tls') else 'http'}://{endpoint}{p['path']}", timeout=5)
                except OSError as e:
                    obs.append({"kind": "app.http", "subject": f"{endpoint}{p['path']}", "data": {"error": type(e).__name__}})
                    continue
                up = True
                first_status = first_status or status
                data = {"status": status, "server": headers.get("server", "")[:80], "content_type": headers.get("content-type", "")[:80],
                        "location": headers.get("location", "")[:200]}
                data.update(summarise_body(body, headers.get("content-type", ""), p.get("want", "status"), p.get("find"), p.get("keys")))
                obs.append({"kind": "app.http", "subject": f"{endpoint}{p['path']}", "data": data})
            # up/down with the time it last changed: the observation only changes when it flips
            prev = seen.get(endpoint)
            if not prev or prev["up"] != up:
                prev = {"up": up, "since": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
                seen[endpoint] = prev
            obs.append({"kind": "endpoint.status", "subject": endpoint, "data": dict(prev)})
        note = f"skipped {skipped} target(s) outside this server and the confirmed networks" if skipped else ""
        return {"observations": obs, "note": note}
