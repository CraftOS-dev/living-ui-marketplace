# Deploying NetSentry

NetSentry is two pieces:

- **the Console** — this app (PocketBase + web UI). It keeps the data, runs the
  checks, sends alerts and talks to your agent. It listens on `127.0.0.1` only,
  on the port CraftBot assigned (shown in the sensor command; 8471 when run with
  the Agent App CLI in development).
- **the Sensor** — a small Python program (standard library only, Python 3.9+)
  that reports what it sees on the machine it runs on. Optional: without it you
  still get the outside-in checks of your domains and IPs.

The Sensor usually runs on the same machine as the Console; see "Sensors on
other machines" below for more hosts.

## Anywhere: home server, VPS, workstation

1. Install NetSentry from the CraftBot marketplace, or run it with the Agent App
   CLI: `agent-app <path-to-netsentry> serve`.
2. Open it, create the first account (it becomes the admin).
3. Add your domains and public IPs under **Assets**.
4. **Sources → Sensors → Add sensor** and start the Sensor with the command shown
   (see `sensor/README.md` for a systemd service / Windows scheduled task).
5. **Workspace → Alerts**: add a Slack/Discord/ntfy webhook and a heartbeat URL
   (e.g. healthchecks.io) so you hear when something is wrong — or when NetSentry
   itself stops.

To reach the UI from another machine, use an SSH tunnel
(`ssh -L 8471:127.0.0.1:<port> you@server`) or CraftBot's share link. Do not
expose the console port directly.

## A single EC2 instance monitoring itself

The most common cloud setup: NetSentry and its Sensor on the instance they
protect. No AWS keys are involved.

1. **Launch/prepare the instance** (Amazon Linux 2023 or Ubuntu). Require IMDSv2
   (NetSentry will flag it otherwise — CLD-006).
2. **Attach the read-only instance role** from [PERMISSIONS.md](PERMISSIONS.md).
   Skipping this still works; you get the host checks and instance metadata, and
   the cloud checks show as unavailable with the missing permission.
3. **Enable GuardDuty** in the region (recommended; CLD-004 reminds you). It sees
   the instance from outside, which still works if the instance itself is
   compromised.
4. **Install NetSentry and the Sensor** as in "Anywhere" above. Run the Sensor as
   root for full coverage. The Sensor detects it is on AWS and adds the
   `host.cloud` collector automatically (every 15 minutes).
5. **Security group**: the Console needs **no inbound rule** — reach it through
   an SSH tunnel or AWS Session Manager port forwarding.
6. **Alerts off the box**: set up a webhook and a heartbeat. If the instance goes
   down, the heartbeat service notices the silence — NetSentry cannot tell you
   about its own death.

What you get: exposure of the instance (security groups and what actually
listens), who changed the security groups (CloudTrail), GuardDuty findings, disk
encryption and IMDS settings, plus every host check (SSH, users, updates, logins,
autostart, file integrity, connections, DNS). A firewall change and the exposure
it creates land in **one incident** for the instance.

Honest limits of this setup: an attacker with root on the instance can blind the
Sensor (you would get the "sensor has gone silent" alert and GuardDuty still
sees the traffic). Monitoring a whole AWS organisation from a separate security
account comes later.

## GCP VM / Azure VM

Same as EC2: attach a service account (GCP) or enable a managed identity (Azure)
with the read permissions in [PERMISSIONS.md](PERMISSIONS.md). The Sensor reads
the firewall / network-security-group rules that apply to the VM (CLD-001).

## Sensors on other machines

A sensor can watch another host (a second server, a NAS, a laptop) as long as it
can reach the Console over **HTTPS** — the sensor refuses plain `http://` to
anything but its own machine, and never follows redirects, so its token cannot
leak. Each remote sensor gets its own host asset, checks and incidents.

The least-exposed way is a reverse proxy on the Console machine that publishes
**only the endpoints machines use** — never the app itself. With
[Caddy](https://caddyserver.com) (automatic HTTPS):

```caddyfile
netsentry.example.com {
    @machines path /api/collections/sensors/auth-with-password /api/ops/sensors-checkin /api/ops/sensors-report /api/ops/fixes-monitor-report /api/netsentry/join /api/netsentry/join-aws /api/netsentry/sensor/files /api/netsentry/sensor/install.sh /api/netsentry/hb/*
    handle @machines {
        reverse_proxy 127.0.0.1:<console-port> {
            # arrive as the console's own machine: the app's framework treats forwarded
            # requests as "shared" and would ask them for a share link. Safe ONLY because
            # nothing but these machine endpoints is published — each still needs its own
            # credential (a monitor's key, a join token, AWS's answer, a heartbeat link).
            header_up Host 127.0.0.1:<console-port>
            header_up -X-Forwarded-For
            header_up -X-Forwarded-Host
            header_up -X-Forwarded-Proto
            header_up -Forwarded
        }
    }
    handle {
        respond 404
    }
}
```

Never publish the rest of the app this way: with the forwarding headers stripped,
every page would be treated as local and handed a session. Use CraftBot's share
link (or a VPN) for people.

Then set **NetSentry's address** once — Network → Put a monitor on your servers →
"The address your servers use" = `https://netsentry.example.com` (or
`settings.update console_url`). The install script and keyless enrolment use only
that address, never the one a request happened to arrive on.

Then on the remote host:

```bash
python -m netsentry_sensor run --console https://netsentry.example.com --token ns1.xxxx.yyyy
```

Inside a private network with your own CA, add `--ca-file /path/to/ca.pem`
(or `NETSENTRY_CA_FILE`). Restrict the proxy to your hosts' addresses where you
can (firewall / security group), and revoke a sensor's token from **Sources →
Sensors** the moment a machine is retired or lost.

A sensor token can only check in and report for its own host — it cannot read
anything in NetSentry — so a stolen token lets someone send false reports for
one host, which the "sensor has gone silent" and change history make visible.

## A separate security VM

For more than a few hosts, run NetSentry on its own small VM (1 vCPU / 1 GB is
enough for dozens of sensors) instead of on a machine it watches: an attacker
who takes over a watched host then cannot touch the Console, the audit log or
the alert settings. Put sensors on every host (above) and keep the heartbeat on.
Cloud checks are per VM: each sensor on a cloud VM checks that VM with that VM's
own identity, so give each monitored VM the read-only permissions from
[PERMISSIONS.md](PERMISSIONS.md). Scanning a whole cloud account or organisation
from one place is not supported yet.

## Keeping the audit log off the machine

The audit log is hash-chained: changing or deleting any entry breaks every hash
after it. To make that useful against someone with full control of the machine,
keep evidence elsewhere:

- every **daily digest** ends with an *Audit checkpoint* (entry number + hash) —
  send the digest to a webhook or email that lives off the box;
- **Workspace → Audit log → Download** exports the whole chain (JSON Lines);
  check a copy anywhere with Node.js:

  ```bash
  node scripts/verify-audit-export.cjs netsentry-audit-2026-09-30.jsonl --checkpoint 1203:9f86d081884c7d65
  ```

  It fails if any entry was altered, removed, or if history up to the
  checkpoint from an earlier digest was rewritten.

## Backups

Everything lives in the app's `pb_data/` directory, including
`pb_data/.netsentry_key` (the key that encrypts alert destination URLs). Back up
the whole directory; without the key, alert destinations have to be entered again.

## v2: putting monitors on many machines

- **Join token** (Network → Put a monitor on your servers): time-limited, capped, revocable,
  stored hashed. `install.sh` (served by the console) installs the monitor's own code to
  `/opt/netsentry/sensor`, enrols with the token (swapped for the machine's own key, kept in
  `/var/lib/netsentry-sensor/token`, mode 600) and starts a systemd service. The same command
  works by hand, from the Ansible playbook, or in cloud-init.
- **Keyless on AWS**: allow the instances' role, then `NETSENTRY_KEYLESS=aws` instead of a token
  (docs/PERMISSIONS.md → Keyless enrolment).
- Monitors on other machines talk to the console **only over https** (plain http only to the
  same machine) — put the console behind a TLS proxy (e.g. Caddy) before rolling out.
- Guides per situation: docs/GUIDE-HOME.md, docs/GUIDE-ORGANISATION.md, docs/GUIDE-CLOUD.md.
  What runs and was tested where: docs/PLATFORM-MATRIX.md.

## v3: putting the monitor on every kind of machine

| Machine | How | Changes switch |
|---|---|---|
| Linux (systemd) | `curl -fsSL <NetSentry>/api/netsentry/sensor/install.sh \| sudo NETSENTRY_JOIN=… sh` | asked once; `NETSENTRY_MANAGE=yes\|no` to answer ahead |
| Windows 10/11, Server | administrator PowerShell: `$env:NETSENTRY_JOIN='…'; irm <NetSentry>/api/netsentry/sensor/install.ps1 \| iex` — python.org's embeddable Python (pinned hash) + a startup task running as SYSTEM | asked once; `$env:NETSENTRY_MANAGE` |
| Unraid | `deploy/unraid/netsentry-monitor.xml` (Docker tab → template) | "Allow changes" in the template |
| Synology, TrueNAS SCALE, any Docker host | `deploy/compose/monitor.yaml` (image `ghcr.io/craftos-dev/netsentry-monitor`, built by `.github/workflows/netsentry-monitor-image.yml` on a `netsentry-monitor-v*` tag) | `NETSENTRY_EXECUTOR` in the file |

Running the installer again **updates** the monitor and keeps the machine's identity and its
changes answer. NetSentry never pushes monitor code itself (see PERMISSIONS.md).

Monitors on OTHER machines than NetSentry still need NetSentry's address over https (the reverse
proxy above, publishing only the machine endpoints). A CraftBot "machine channel" that would do
this without a proxy is designed (SYSTEM-V3-PLAN.md §6.1) but not built yet.
