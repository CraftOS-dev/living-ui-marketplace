# NetSentry

**A security console that watches what you expose to the internet, explains
what it finds, and lets your agent help you fix it.**

Add a domain or a public IP. NetSentry discovers the addresses and subdomains
behind it, checks them against public sources, and turns problems into
findings with plain-language explanations and fix steps. It keeps watching:
findings resolve on their own when the problem goes away and reopen if it
comes back.

## What it checks (this release)

| Area | Checks |
|---|---|
| Exposure | Sensitive services reachable from the internet (RDP, databases, Docker API, SSH…), known CVEs on exposed services (critical when on CISA's actively-exploited list), new ports since the baseline |
| DNS | Record changes (NS/MX flagged higher), dangling CNAMEs that allow subdomain takeover |
| Email | Missing SPF, missing or non-enforcing DMARC |
| Certificates | Certificates from a new CA, new names appearing in certificates, newest certificate about to expire |
| Registration | Domain registration expiring |
| Reputation | Your IPs or names on Spamhaus DROP, abuse.ch Feodo Tracker or URLhaus |
| Hosts (Sensor) | Services listening on all interfaces, Docker ports bypassing the firewall, SSH passwords/root login, new users/admins/keys, pending security updates, login brute force and break-ins, autostart and critical-file changes, disk encryption / firewall / antivirus off, sensor gone silent |
| Network (Sensor) | Contact with known-malicious addresses/domains, DNS tunnelling / generated domains, mining-pool and Tor ports, new programs on the network, IDS alerts |
| Cloud (Sensor on a VM) | Security group / firewall open to the internet, who changed it, GuardDuty findings or GuardDuty off, unencrypted disk, IMDSv1 |

## Incidents, alerts and your agent

- **Incidents.** High and critical findings on the same domain, and everything
  discovered from it, are grouped into one incident with a timeline, an owner and
  a status. An incident is marked mitigated automatically when its findings go away.
- **Alerts that don't depend on an AI.** New incidents and failing data sources go
  straight to your Slack, Discord or ntfy webhook (or any JSON endpoint), or by
  email when NetSentry runs inside CraftBot.
- **Heartbeat.** NetSentry pings a heartbeat URL (e.g. Healthchecks.io) every few
  minutes, so you hear about it if NetSentry or its server goes down.
- **Daily digest.** Sent at the hour you choose.
- **Agent triage.** A connected agent is asked to triage each incident. It reads a
  bounded evidence bundle, where internet-sourced data is marked untrusted, and
  writes a plain-language assessment. It can never change alert destinations,
  rules, roles or settings.

## Inside your machines: the Sensor

Run the small NetSentry Sensor (Python, no dependencies) on a server, home server
or laptop. NetSentry then also watches:
- Listening ports, users and admins, SSH hardening and keys.
- Login brute-force, including a successful login right after a burst.
- Autostart entries and changes to critical files.
- Pending security updates, disk encryption, firewall and antivirus, and Docker ports.

It is read-only, redacts secrets on the host, and NetSentry alerts you if it goes
silent. See `sensor/README.md`.

## How it works

- **Passive and keyless.** NetSentry never scans or probes your targets. It
  reads public data: DNS over HTTPS (Cloudflare), Shodan InternetDB, certificate
  transparency (crt.sh / CertSpotter), RDAP, CISA KEV, FIRST EPSS and public
  blocklists. No API keys, no accounts.
- **Deterministic.** Every finding comes from a documented rule. Explaining a
  finding needs no AI.
- **Built for teams.** The first account is the admin. Members are viewers,
  analysts or admins, enforced on the server. Every change is recorded in a
  tamper-evident (hash-chained) audit log.
- **Agent-operable.** A connected agent can add assets, rescan, read posture and
  triage findings through declared operations. It can never change roles,
  settings or rules, and everything it does is attributed to "agent" in the
  audit log.

## What data leaves your machine

- **Console:** lookups of the names and addresses you add (and those discovered
  from them) to the public services listed above; one daily HTTPS request to each
  of your own domains/subdomains (website checks); and alerts/digests to the
  destinations *you* configure.
- **Sensor:** reports to your own console only. Opt-in extras: on a cloud VM,
  read-only calls to that cloud's own API with the VM's identity; with
  `NETSENTRY_CODE_PATHS` set, dependency names + versions (nothing else) to
  OSV.dev; with a Pi-hole configured, requests to your Pi-hole.
- Secrets found in code, file contents, command-line passwords and raw log lines
  never leave the host.

## Honest limits

- InternetDB is refreshed by Shodan about weekly, so exposure data is not real-time.
- crt.sh is often overloaded; NetSentry retries and falls back to CertSpotter.
- Sensors on other machines need the console published over HTTPS (a reverse
  proxy — see `docs/DEPLOYMENT.md`); there is no built-in fleet enrolment yet.
- Cloud checks cover the VM each sensor runs on, not a whole cloud account or
  organisation.
- The AWS / GCP / Azure checks are built and tested against the providers'
  documented responses but have not yet been run against a live account.
- NetSentry monitors and advises. It does not make anyone "completely secure".

## Roadmap

Done: attack surface, incidents and alerts, the Sensor, network monitoring, fixes
applied by your agent and verified by NetSentry, and cloud checks for a VM on
AWS / GCP / Azure, website and code checks, sensors on other machines over
HTTPS, and an exportable, offline-verifiable audit log (see `docs/DEPLOYMENT.md`).
Next: whole-organisation cloud monitoring, identity (MFA / sign-ins through your
connected accounts) and lookalike domains. See `docs/PLAN.md`.

## Development

```bash
node --test tests/*.test.js          # 69 unit tests (recorded real fixtures)
cd sensor && python -m unittest discover -s tests   # 49 sensor tests
```

Architecture and how to add a check or collector: `docs/ARCHITECTURE.md`.
