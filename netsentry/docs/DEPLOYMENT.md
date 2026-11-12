# Deploying NetSentry

NetSentry is two pieces:

- **the Console** — this app (PocketBase + web UI). It keeps the data, runs the
  checks, sends alerts and talks to your agent. It listens on `127.0.0.1` only,
  on the port CraftBot assigned (shown in the sensor command; 8471 when run with
  the Agent App CLI in development).
- **the Sensor** (the monitor) — a small Python program (standard library only,
  Python 3.9+) that reports what it sees on the server it runs on and applies the
  changes a person confirms. NetSentry needs it: it looks after the server
  through it.

The Sensor runs on the same machine as the Console: NetSentry looks after the one
server it runs on (see "Sensors on other machines" below).

## Anywhere: home server, VPS, workstation

1. Install NetSentry from the CraftBot marketplace, or run it with the Agent App
   CLI: `agent-app <path-to-netsentry> serve`.
2. Open it, create the first account (it becomes the admin).
3. **Setup** (*Let NetSentry look after this server*) opens by itself: **Install the
   monitor on this server → Show me the command**, and run the command on the
   server (Linux: a terminal; Windows: PowerShell as Administrator). It installs the
   Sensor as a systemd service (Windows: a startup task); Setup waits until it reports.
4. **Who should reach your apps → Answer for each app**: one question per app.
5. **Settings → Alerts**: add a Slack/Discord/ntfy webhook and a heartbeat URL
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

NetSentry looks after the one server it runs on, and nothing else: its Sensor runs
on that same machine and reports to the Console at the machine's own loopback
address (e.g. `http://127.0.0.1:<console-port>`), which Setup saves for it. There
is no list of machines. To look after a second server, a NAS or another VM, run
NetSentry there too, with its own Sensor.

The install script uses only that saved address, never the one a request happened
to arrive on. If the Sensor stops reporting, Home → **Reconnect the monitor** shows
the command again (with a new one-time key). Keep the console port unpublished:
people reach the UI through an SSH tunnel, a VPN or CraftBot's share link (above).

## A separate security VM

Not possible: NetSentry looks after the one server it runs on, so it runs on each
server it watches, and an attacker who takes over that server can reach the
Console, the audit log and the alert settings too. Keep the heartbeat on and the
evidence off the box (below). Cloud checks are per VM: each Sensor on a cloud VM
checks that VM with that VM's own identity, so give each monitored VM the
read-only permissions from [PERMISSIONS.md](PERMISSIONS.md). Scanning a whole
cloud account or organisation from one place is not supported yet.

## Keeping the audit log off the machine

The audit log is hash-chained: changing or deleting any entry breaks every hash
after it. To make that useful against someone with full control of the machine,
keep evidence elsewhere:

- every **daily digest** ends with an *Audit checkpoint* (entry number + hash) —
  send the digest to a webhook or email that lives off the box;
- **Settings → More settings → Audit log → Download** exports the whole chain (JSON Lines);
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

## v2: putting the monitor on the server

- **Join token** (in the command Setup, Settings → Monitor or Home → Reconnect the monitor
  shows): it works once, for one day, and is stored hashed. `install.sh` (served by the console)
  installs the monitor's own code to `/opt/netsentry/sensor`, enrols with the token (swapped for
  the machine's own key, kept in `/var/lib/netsentry-sensor/token`, mode 600) and starts a
  systemd service.
- The monitor talks to the console on the same machine; it refuses plain http to anything but
  its own machine.
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

The monitor runs on the same server as NetSentry, whatever the kind of machine (see "Sensors on
other machines" above).
