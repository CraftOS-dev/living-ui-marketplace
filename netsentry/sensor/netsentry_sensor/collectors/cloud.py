"""Cloud collector — the instance looks at its own cloud configuration using
the instance's identity (AWS instance role / GCP service account / Azure
managed identity). No keys are ever configured; without a role only the
metadata (instance id, public IP, security-group names) is reported and the
rest is marked unavailable with the exact permission to attach.

Standard library only: AWS requests are signed with SigV4 implemented below.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from .base import Collector, Unavailable

WATCHED_EVENTS = {
    "AuthorizeSecurityGroupIngress", "RevokeSecurityGroupIngress", "ModifySecurityGroupRules",
    "AuthorizeSecurityGroupEgress", "CreateSecurityGroup", "DeleteSecurityGroup", "ModifyInstanceAttribute",
}


# ------------------------------------------------------------------ HTTP


def http(method: str, url: str, headers: dict | None = None, body: bytes | None = None, timeout: int = 5) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 — fixed metadata / cloud API endpoints
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except (urllib.error.URLError, OSError, TimeoutError):
        return 0, b""


# ----------------------------------------------------------------- SigV4


def _uri(s: str) -> str:
    return urllib.parse.quote(s, safe="-_.~")


def sigv4_headers(method: str, url: str, region: str, service: str, creds: dict, body: bytes = b"",
                  extra: dict | None = None, now: dt.datetime | None = None) -> dict:
    """AWS Signature Version 4. creds: {access_key, secret_key, token?}."""
    now = now or dt.datetime.now(dt.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date = now.strftime("%Y%m%d")
    u = urllib.parse.urlsplit(url)
    headers = {k.lower(): str(v).strip() for k, v in (extra or {}).items()}
    headers["host"] = u.netloc
    headers["x-amz-date"] = amz_date
    if creds.get("token"):
        headers["x-amz-security-token"] = creds["token"]
    q = urllib.parse.parse_qsl(u.query, keep_blank_values=True)
    canonical_query = "&".join(f"{_uri(k)}={_uri(v)}" for k, v in sorted(q))
    signed = sorted(headers)
    canonical_headers = "".join(f"{k}:{headers[k]}\n" for k in signed)
    payload_hash = hashlib.sha256(body).hexdigest()
    canonical = "\n".join([method, u.path or "/", canonical_query, canonical_headers, ";".join(signed), payload_hash])
    scope = f"{date}/{region}/{service}/aws4_request"
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()])

    def h(key: bytes, msg: str) -> bytes:
        return hmac.new(key, msg.encode(), hashlib.sha256).digest()

    k = h(h(h(h(("AWS4" + creds["secret_key"]).encode(), date), region), service), "aws4_request")
    signature = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
    out = {name: value for name, value in headers.items() if name != "host"}
    out["authorization"] = f"AWS4-HMAC-SHA256 Credential={creds['access_key']}/{scope}, SignedHeaders={';'.join(signed)}, Signature={signature}"
    return out


# ------------------------------------------------------------- parsers


def _strip_ns(root: ET.Element) -> ET.Element:
    for el in root.iter():
        if "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
    return root


def parse_describe_security_groups(xml_text: str) -> list[dict]:
    """EC2 DescribeSecurityGroups XML → ingress rules."""
    root = _strip_ns(ET.fromstring(xml_text))
    rules = []
    for g in root.iterfind(".//securityGroupInfo/item"):
        gid, gname = g.findtext("groupId", ""), g.findtext("groupName", "")
        for p in g.iterfind("ipPermissions/item"):
            proto = p.findtext("ipProtocol", "")
            lo, hi = p.findtext("fromPort"), p.findtext("toPort")
            sources = [r.findtext("cidrIp", "") for r in p.iterfind("ipRanges/item")] + [r.findtext("cidrIpv6", "") for r in p.iterfind("ipv6Ranges/item")]
            sources += ["sg:" + r.findtext("groupId", "") for r in p.iterfind("groups/item")]
            for src in sources:
                rules.append({"group": gid, "group_name": gname, "direction": "ingress", "proto": "all" if proto == "-1" else proto,
                              "from_port": int(lo) if lo not in (None, "") else 0, "to_port": int(hi) if hi not in (None, "") else 65535, "source": src})
    return rules


def parse_describe_instance(xml_text: str) -> dict:
    """EC2 DescribeInstances XML (one instance) → where it sits (VPC, subnet, addresses, security
    groups), metadata options and EBS volume ids."""
    root = _strip_ns(ET.fromstring(xml_text))
    inst = root.find(".//instancesSet/item")
    if inst is None:
        return {}
    return {
        "vpc": inst.findtext("vpcId", ""),
        "subnet": inst.findtext("subnetId", ""),
        "private_ip": inst.findtext("privateIpAddress", ""),
        "public_ip": inst.findtext("ipAddress", "") or None,
        "security_group_ids": [g.findtext("groupId", "") for g in inst.iterfind("groupSet/item")],
        "imds_tokens": inst.findtext("metadataOptions/httpTokens", ""),
        "imds_endpoint": inst.findtext("metadataOptions/httpEndpoint", ""),
        "volumes": [v.findtext("ebs/volumeId", "") for v in inst.iterfind("blockDeviceMapping/item") if v.findtext("ebs/volumeId")],
    }


def _port_range(el) -> tuple[int, int]:
    lo, hi = el.findtext("portRange/from"), el.findtext("portRange/to")
    return (int(lo) if lo not in (None, "") else 0, int(hi) if hi not in (None, "") else 65535)


PROTOCOLS = {"-1": "all", "6": "tcp", "17": "udp", "1": "icmp"}


def parse_describe_network_acls(xml_text: str) -> list[dict]:
    """EC2 DescribeNetworkAcls XML → entries (rule number order decides; the first match wins)."""
    root = _strip_ns(ET.fromstring(xml_text))
    out = []
    for acl in root.iterfind(".//networkAclSet/item"):
        aid = acl.findtext("networkAclId", "")
        for e in acl.iterfind("entrySet/item"):
            lo, hi = _port_range(e)
            proto = e.findtext("protocol", "-1")
            out.append({"acl": aid, "rule": int(e.findtext("ruleNumber") or 32767), "egress": e.findtext("egress", "") == "true",
                        "proto": PROTOCOLS.get(proto, proto), "action": e.findtext("ruleAction", ""),
                        "cidr": e.findtext("cidrBlock", "") or e.findtext("ipv6CidrBlock", ""), "from_port": lo, "to_port": hi})
    return out


def parse_describe_route_tables(xml_text: str) -> list[dict]:
    """EC2 DescribeRouteTables XML → routes: where each destination goes (igw-… = the internet)."""
    root = _strip_ns(ET.fromstring(xml_text))
    out = []
    for rt in root.iterfind(".//routeTableSet/item"):
        rid = rt.findtext("routeTableId", "")
        for r in rt.iterfind("routeSet/item"):
            target = (r.findtext("gatewayId") or r.findtext("natGatewayId") or r.findtext("transitGatewayId")
                      or r.findtext("networkInterfaceId") or r.findtext("vpcPeeringConnectionId") or "")
            out.append({"table": rid, "destination": r.findtext("destinationCidrBlock", "") or r.findtext("destinationIpv6CidrBlock", ""),
                        "target": target, "state": r.findtext("state", "active")})
    return out


def parse_describe_snapshots(xml_text: str) -> list[dict]:
    root = _strip_ns(ET.fromstring(xml_text))
    return [{"id": s.findtext("snapshotId", ""), "volume": s.findtext("volumeId", ""), "started": s.findtext("startTime", ""),
             "state": s.findtext("status", "")} for s in root.iterfind(".//snapshotSet/item")]


def parse_describe_volumes(xml_text: str) -> list[dict]:
    root = _strip_ns(ET.fromstring(xml_text))
    return [{"id": v.findtext("volumeId", ""), "encrypted": v.findtext("encrypted", "") == "true", "size_gb": int(v.findtext("size") or 0),
             "type": v.findtext("volumeType", "")} for v in root.iterfind(".//volumeSet/item")]


def parse_gcp_firewalls(data: dict, network: str, tags: list[str]) -> list[dict]:
    rules = []
    for fw in data.get("items", []):
        if fw.get("disabled") or fw.get("direction", "INGRESS") != "INGRESS":
            continue
        if not str(fw.get("network", "")).endswith(network.split("/")[-1]):
            continue
        targets = fw.get("targetTags")
        if targets and not set(targets) & set(tags):
            continue
        for allow in fw.get("allowed", []):
            ports = allow.get("ports") or ["0-65535"]
            for pr in ports:
                lo, _, hi = str(pr).partition("-")
                for src in fw.get("sourceRanges", []):
                    rules.append({"group": fw.get("name", ""), "group_name": fw.get("name", ""), "direction": "ingress", "proto": allow.get("IPProtocol", "all"),
                                  "from_port": int(lo or 0), "to_port": int(hi or lo or 65535), "source": src})
    return rules


def parse_azure_nsg(nsg: dict) -> list[dict]:
    rules = []
    for r in nsg.get("properties", {}).get("securityRules", []):
        p = r.get("properties", {})
        if p.get("direction") != "Inbound" or p.get("access") != "Allow":
            continue
        ranges = p.get("destinationPortRanges") or [p.get("destinationPortRange", "*")]
        sources = p.get("sourceAddressPrefixes") or [p.get("sourceAddressPrefix", "*")]
        for pr in ranges:
            lo, _, hi = ("0-65535" if pr == "*" else str(pr)).partition("-")
            for src in sources:
                rules.append({"group": nsg.get("name", ""), "group_name": r.get("name", ""), "direction": "ingress", "proto": str(p.get("protocol", "*")).lower().replace("*", "all"),
                              "from_port": int(lo or 0), "to_port": int(hi or lo or 65535), "source": "0.0.0.0/0" if src in ("*", "Internet", "Any") else src})
    return rules


def parse_guardduty(data: dict, instance_id: str) -> list[dict]:
    out = []
    for f in data.get("findings", []):
        iid = (((f.get("resource") or {}).get("instanceDetails") or {}).get("instanceId")) or ""
        if instance_id and iid and iid != instance_id:
            continue
        sev = float(f.get("severity") or 0)
        level = "critical" if sev >= 9 else "high" if sev >= 7 else "medium" if sev >= 4 else "low"
        out.append({"id": f.get("id", ""), "type": f.get("type", ""), "title": str(f.get("title", ""))[:200], "severity": level, "score": sev, "provider": "aws-guardduty"})
    return out


def parse_cloudtrail(data: dict) -> list[dict]:
    out = []
    for e in data.get("Events", []):
        name = e.get("EventName", "")
        if name not in WATCHED_EVENTS:
            continue
        try:
            detail = json.loads(e.get("CloudTrailEvent") or "{}")
        except ValueError:
            detail = {}
        ident = detail.get("userIdentity", {})
        actor = ident.get("arn") or e.get("Username") or "unknown"
        req = detail.get("requestParameters") or {}
        perms = []
        for item in ((req.get("ipPermissions") or {}).get("items") or []):
            cidrs = [r.get("cidrIp") for r in ((item.get("ipRanges") or {}).get("items") or [])]
            perms.append({"proto": item.get("ipProtocol"), "from_port": item.get("fromPort"), "to_port": item.get("toPort"), "sources": cidrs})
        t = e.get("EventTime")
        when = dt.datetime.fromtimestamp(float(t), dt.timezone.utc) if isinstance(t, (int, float)) else dt.datetime.now(dt.timezone.utc)
        out.append({"event": name, "actor": actor, "group": req.get("groupId", ""), "source_ip": detail.get("sourceIPAddress", ""),
                    "permissions": perms, "time": when.isoformat().replace("+00:00", "Z")})
    return out


def rule_observations(rules: list[dict]) -> list[dict]:
    seen, out = set(), []
    for r in rules:
        subject = f"{r['group']}:{r['proto']}:{r['from_port']}-{r['to_port']}:{r['source']}"
        if subject in seen:
            continue
        seen.add(subject)
        out.append({"kind": "cloud.firewall_rule", "subject": subject, "data": r})
    return out


# ------------------------------------------------------------ providers


class Aws:
    # Lab only: NETSENTRY_AWS_IMDS / NETSENTRY_AWS_ENDPOINT point the monitor at an emulated instance
    # metadata service and AWS API (tests/lab: LocalStack). Never needed on a real instance.
    IMDS = os.environ.get("NETSENTRY_AWS_IMDS", "http://169.254.169.254/latest")
    ENDPOINT = os.environ.get("NETSENTRY_AWS_ENDPOINT", "")

    def url(self, service: str, region: str, path: str = "/") -> str:
        return (self.ENDPOINT.rstrip("/") if self.ENDPOINT else f"https://{service}.{region}.amazonaws.com") + path

    def __init__(self):
        s, token = http("PUT", self.IMDS + "/api/token", {"X-aws-ec2-metadata-token-ttl-seconds": "300"})
        if s != 200:
            raise Unavailable("not on AWS (instance metadata not reachable)")
        self.h = {"X-aws-ec2-metadata-token": token.decode()}

    def md(self, path: str) -> str:
        s, b = http("GET", f"{self.IMDS}/meta-data/{path}", self.h)
        return b.decode() if s == 200 else ""

    def creds(self) -> dict | None:
        role = self.md("iam/security-credentials/").strip().splitlines()
        if not role:
            return None
        c = json.loads(self.md("iam/security-credentials/" + role[0]) or "{}")
        return {"access_key": c.get("AccessKeyId"), "secret_key": c.get("SecretAccessKey"), "token": c.get("Token"), "role": role[0]} if c.get("AccessKeyId") else None

    def call(self, method, service, region, url, creds, body=b"", headers=None) -> tuple[int, bytes]:
        signed = sigv4_headers(method, url, region, service, creds, body, headers)
        return http(method, url, signed, body or None, timeout=20)

    def collect(self, state: dict) -> dict:
        iid = self.md("instance-id")
        region = self.md("placement/region")
        mac = self.md("mac")
        sg_ids = self.md(f"network/interfaces/macs/{mac}/security-group-ids").split()
        instance = {"provider": "aws", "id": iid, "region": region, "public_ip": self.md("public-ipv4") or None,
                    "security_groups": self.md("security-groups").split(), "security_group_ids": sg_ids}
        obs = [{"kind": "cloud.instance", "subject": "instance", "data": instance}]
        creds = self.creds()
        if not creds:
            return {"observations": obs, "complete": False,
                    "note": "No IAM role on this instance: attach a read-only role (see docs/DEPLOYMENT.md) to check security-group rules, GuardDuty and CloudTrail."}
        instance["role"] = creds["role"]
        notes, signals, complete = [], [], True
        body = urllib.parse.urlencode([("Action", "DescribeSecurityGroups"), ("Version", "2016-11-15")] + [(f"GroupId.{i + 1}", g) for i, g in enumerate(sg_ids)]).encode()
        s, b = self.call("POST", "ec2", region, self.url("ec2", region), creds, body, {"content-type": "application/x-www-form-urlencoded; charset=utf-8"})
        if s == 200:
            obs += rule_observations(parse_describe_security_groups(b.decode()))
        else:
            complete = False
            notes.append(f"security groups: HTTP {s} (needs ec2:DescribeSecurityGroups)")
        ec2 = lambda action, params: self.call(
            "POST", "ec2", region, self.url("ec2", region), creds,
            urllib.parse.urlencode([("Action", action), ("Version", "2016-11-15")] + params).encode(),
            {"content-type": "application/x-www-form-urlencoded; charset=utf-8"})
        perms = {"ec2:DescribeSecurityGroups": s == 200}
        s, b = ec2("DescribeInstances", [("InstanceId.1", iid)])
        perms["ec2:DescribeInstances"] = s == 200
        if s == 200:
            d = parse_describe_instance(b.decode())
            for k in ("vpc", "subnet", "private_ip"):
                instance[k] = d.get(k, "")
            if d.get("public_ip") and not instance.get("public_ip"):
                instance["public_ip"] = d["public_ip"]
            obs.append({"kind": "cloud.instance_config", "subject": "metadata",
                        "data": {"imds_tokens": d.get("imds_tokens"), "imds_endpoint": d.get("imds_endpoint")}})
            obs += self.network(ec2, d, perms, notes)
            if d.get("volumes"):
                s, b = ec2("DescribeSnapshots", [("Owner.1", "self")] + [(f"Filter.1.Value.{i + 1}", v) for i, v in enumerate(d["volumes"])] + [("Filter.1.Name", "volume-id")])
                perms["ec2:DescribeSnapshots"] = s == 200
                if s == 200:
                    for snap in parse_describe_snapshots(b.decode()):
                        obs.append({"kind": "cloud.snapshot", "subject": snap["id"], "data": snap})
                else:
                    notes.append(f"snapshots: HTTP {s} (needs ec2:DescribeSnapshots)")
            if d.get("volumes"):
                s, b = ec2("DescribeVolumes", [(f"VolumeId.{i + 1}", v) for i, v in enumerate(d["volumes"])])
                perms["ec2:DescribeVolumes"] = s == 200
                if s == 200:
                    for v in parse_describe_volumes(b.decode()):
                        obs.append({"kind": "cloud.volume", "subject": v["id"], "data": v})
                else:
                    complete = False
                    notes.append(f"volumes: HTTP {s} (needs ec2:DescribeVolumes)")
        else:
            complete = False
            notes.append(f"instance details: HTTP {s} (needs ec2:DescribeInstances)")
        s, b = self.call("GET", "guardduty", region, self.url("guardduty", region, "/detector"), creds)
        perms["guardduty:ListDetectors"] = s == 200
        detectors = json.loads(b or b"{}").get("detectorIds", []) if s == 200 else []
        if s != 200:
            complete = False
            notes.append(f"GuardDuty: HTTP {s} (needs guardduty:ListDetectors, ListFindings, GetFindings)")
        else:
            obs.append({"kind": "cloud.detection", "subject": "aws-guardduty", "data": {"service": "GuardDuty", "region": region, "enabled": bool(detectors)}})
        for d in detectors[:1]:
            q = json.dumps({"findingCriteria": {"criterion": {"service.archived": {"eq": ["false"]}}}, "maxResults": 50}).encode()
            s, b = self.call("POST", "guardduty", region, self.url("guardduty", region, f"/detector/{d}/findings"), creds, q, {"content-type": "application/json"})
            ids = json.loads(b or b"{}").get("findingIds", []) if s == 200 else []
            if ids and s == 200:
                s, b = self.call("POST", "guardduty", region, self.url("guardduty", region, f"/detector/{d}/findings/get"), creds,
                                 json.dumps({"findingIds": ids}).encode(), {"content-type": "application/json"})
            if s != 200:
                complete = False
                notes.append(f"GuardDuty findings: HTTP {s}")
                continue
            if ids:
                for f in parse_guardduty(json.loads(b), iid):
                    obs.append({"kind": "cloud.threat_finding", "subject": f["id"], "data": f})
        since = float(state.get("trail_since") or (time.time() - 3600))
        for g in sg_ids:
            q = json.dumps({"LookupAttributes": [{"AttributeKey": "ResourceName", "AttributeValue": g}], "StartTime": since, "MaxResults": 50}).encode()
            s, b = self.call("POST", "cloudtrail", region, self.url("cloudtrail", region), creds, q,
                             {"content-type": "application/x-amz-json-1.1", "x-amz-target": "com.amazonaws.cloudtrail.v20131101.CloudTrail_20131101.LookupEvents"})
            if s != 200:
                notes.append(f"CloudTrail: HTTP {s} (needs cloudtrail:LookupEvents)")
                break
            for e in parse_cloudtrail(json.loads(b or b"{}")):
                minute = e["time"][:17] + "00Z"
                signals.append({"kind": "cloud.audit_event", "key": e["actor"], "window_start": minute, "count": 1, "data": e})
            time.sleep(0.6)  # LookupEvents allows 2 requests/second
        state["trail_since"] = time.time() - 60
        # Least privilege: could this role CHANGE security groups? A dry run asks AWS without changing anything
        # (a documentation-range address, port 1). "DryRunOperation" = it would have been allowed.
        write_allowed = None
        if sg_ids:
            s, b = ec2("AuthorizeSecurityGroupIngress", [("GroupId", sg_ids[0]), ("DryRun", "true"), ("IpPermissions.1.IpProtocol", "tcp"),
                                                          ("IpPermissions.1.FromPort", "1"), ("IpPermissions.1.ToPort", "1"), ("IpPermissions.1.IpRanges.1.CidrIp", "192.0.2.1/32")])
            text = b.decode("utf-8", "replace")
            write_allowed = True if "DryRunOperation" in text else False if ("UnauthorizedOperation" in text or s == 403) else None
        from .. import executor
        obs.append({"kind": "cloud.permissions", "subject": "aws", "data": {"role": creds.get("role", ""), "checked": perms,
                                                                            "write_allowed": write_allowed, "executor_on": executor.enabled()}})
        return {"observations": obs, "signals": signals, "complete": complete, "note": "; ".join(notes)}

    def network(self, ec2, d: dict, perms: dict, notes: list) -> list[dict]:
        """The subnet's network ACL and route table: whether the internet can reach the instance at all."""
        obs = []
        subnet, vpc = d.get("subnet", ""), d.get("vpc", "")
        if not subnet:
            return obs
        s, b = ec2("DescribeNetworkAcls", [("Filter.1.Name", "association.subnet-id"), ("Filter.1.Value.1", subnet)])
        perms["ec2:DescribeNetworkAcls"] = s == 200
        if s == 200:
            for e in parse_describe_network_acls(b.decode()):
                obs.append({"kind": "cloud.nacl_entry", "subject": f"{e['acl']}:{'out' if e['egress'] else 'in'}:{e['rule']}", "data": e})
        else:
            notes.append(f"network ACLs: HTTP {s} (needs ec2:DescribeNetworkAcls)")
        s, b = ec2("DescribeRouteTables", [("Filter.1.Name", "association.subnet-id"), ("Filter.1.Value.1", subnet)])
        routes = parse_describe_route_tables(b.decode()) if s == 200 else []
        if s == 200 and not routes and vpc:  # no explicit association: the VPC's main route table applies
            s, b = ec2("DescribeRouteTables", [("Filter.1.Name", "vpc-id"), ("Filter.1.Value.1", vpc), ("Filter.2.Name", "association.main"), ("Filter.2.Value.1", "true")])
            routes = parse_describe_route_tables(b.decode()) if s == 200 else []
        perms["ec2:DescribeRouteTables"] = s == 200
        if s == 200:
            for r in routes:
                obs.append({"kind": "cloud.route", "subject": f"{r['table']}:{r['destination']}", "data": r})
        else:
            notes.append(f"route tables: HTTP {s} (needs ec2:DescribeRouteTables)")
        return obs


class Gcp:
    MD = "http://metadata.google.internal/computeMetadata/v1"
    H = {"Metadata-Flavor": "Google"}

    def __init__(self):
        s, _ = http("GET", self.MD + "/instance/id", self.H, timeout=1)
        if s != 200:
            raise Unavailable("not on GCP")

    def md(self, path: str) -> str:
        s, b = http("GET", f"{self.MD}/{path}", self.H)
        return b.decode() if s == 200 else ""

    def collect(self, state: dict) -> dict:
        project = self.md("project/project-id")
        network = self.md("instance/network-interfaces/0/network")
        tags = json.loads(self.md("instance/tags") or "[]")
        instance = {"provider": "gcp", "id": self.md("instance/id"), "region": self.md("instance/zone").split("/")[-1],
                    "public_ip": self.md("instance/network-interfaces/0/access-configs/0/external-ip") or None, "network": network, "tags": tags}
        obs = [{"kind": "cloud.instance", "subject": "instance", "data": instance}]
        tok = json.loads(self.md("instance/service-accounts/default/token") or "{}").get("access_token")
        if not tok:
            return {"observations": obs, "complete": False, "note": "No service account on this VM: attach one with roles/compute.securityAdmin viewer rights (see docs/DEPLOYMENT.md)."}
        s, b = http("GET", f"https://compute.googleapis.com/compute/v1/projects/{project}/global/firewalls", {"Authorization": "Bearer " + tok}, timeout=20)
        obs.append({"kind": "cloud.permissions", "subject": "gcp", "data": {"role": "default service account", "checked": {"compute.firewalls.list": s == 200}}})
        if s != 200:
            return {"observations": obs, "complete": False, "note": f"firewall rules: HTTP {s} (the VM's service account needs compute.firewalls.list)"}
        obs += rule_observations(parse_gcp_firewalls(json.loads(b), network, tags))
        return {"observations": obs}


class Azure:
    IMDS = "http://169.254.169.254/metadata"
    H = {"Metadata": "true"}

    def __init__(self):
        s, b = http("GET", self.IMDS + "/instance?api-version=2021-02-01", self.H, timeout=1)
        if s != 200:
            raise Unavailable("not on Azure")
        self.meta = json.loads(b)

    def collect(self, state: dict) -> dict:
        c = self.meta.get("compute", {})
        ip = (((self.meta.get("network", {}).get("interface") or [{}])[0].get("ipv4", {}).get("ipAddress") or [{}])[0]).get("publicIpAddress")
        instance = {"provider": "azure", "id": c.get("vmId"), "region": c.get("location"), "public_ip": ip or None, "name": c.get("name"), "resource_group": c.get("resourceGroupName")}
        obs = [{"kind": "cloud.instance", "subject": "instance", "data": instance}]
        s, b = http("GET", self.IMDS + "/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/", self.H)
        tok = json.loads(b or b"{}").get("access_token") if s == 200 else None
        if not tok:
            return {"observations": obs, "complete": False, "note": "No managed identity on this VM: enable one and grant it Reader (see docs/DEPLOYMENT.md)."}
        auth = {"Authorization": "Bearer " + tok}
        arm = "https://management.azure.com"
        vm_url = f"{arm}/subscriptions/{c.get('subscriptionId')}/resourceGroups/{c.get('resourceGroupName')}/providers/Microsoft.Compute/virtualMachines/{c.get('name')}?api-version=2023-03-01"
        s, b = http("GET", vm_url, auth, timeout=20)
        checked = {"Microsoft.Compute/virtualMachines/read": s == 200}
        if s != 200:
            obs.append({"kind": "cloud.permissions", "subject": "azure", "data": {"role": "managed identity", "checked": checked}})
            return {"observations": obs, "complete": False, "note": f"VM details: HTTP {s} (the managed identity needs Reader)"}
        for nic in json.loads(b).get("properties", {}).get("networkProfile", {}).get("networkInterfaces", []):
            s, nb = http("GET", f"{arm}{nic['id']}?api-version=2023-05-01", auth, timeout=20)
            nsg_id = (json.loads(nb or b"{}").get("properties", {}).get("networkSecurityGroup") or {}).get("id") if s == 200 else None
            if nsg_id:
                s, gb = http("GET", f"{arm}{nsg_id}?api-version=2023-05-01", auth, timeout=20)
                checked["Microsoft.Network/networkSecurityGroups/read"] = s == 200
                if s == 200:
                    obs += rule_observations(parse_azure_nsg(json.loads(gb)))
        obs.append({"kind": "cloud.permissions", "subject": "azure", "data": {"role": "managed identity", "checked": checked}})
        return {"observations": obs}


class Cloud(Collector):
    id = "host.cloud"

    def collect(self) -> dict:
        cloud = self.config.get("_cloud")
        if not cloud:
            raise Unavailable("not running on AWS, GCP or Azure")
        provider = {"aws": Aws, "gcp": Gcp, "azure": Azure}[cloud]()
        return provider.collect(self.state)
