# Cloud permissions

NetSentry never asks for cloud keys. The Sensor on a cloud VM uses **the VM's own
identity** — an EC2 instance role, a GCP VM service account, or an Azure managed
identity — and only **reads**. Without an identity it still reports what the
instance metadata service tells it (instance id, public IP, security-group names)
and says exactly which permission is missing.

NetSentry holds no write access to anything. Fixes are carried out by your agent,
with its own access, after a person approves the exact plan.

## AWS — instance role

Attach an IAM role to the instance (EC2 → Actions → Security → Modify IAM role)
with this policy. Everything is read-only; `Resource: "*"` is required because
these Describe/List calls do not support resource-level restrictions.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "NetSentryRead",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeInstances",
        "ec2:DescribeVolumes",
        "ec2:DescribeNetworkAcls",
        "ec2:DescribeRouteTables",
        "ec2:DescribeSnapshots",
        "guardduty:ListDetectors",
        "guardduty:ListFindings",
        "guardduty:GetFindings",
        "cloudtrail:LookupEvents"
      ],
      "Resource": "*"
    }
  ]
}
```

| Permission | Used for | Check |
|---|---|---|
| `ec2:DescribeSecurityGroups` | inbound rules of this instance's security groups | CLD-ADMIN-PORT-OPEN |
| `ec2:DescribeInstances` | IMDSv1/v2 setting, attached volumes (this instance only) | CLD-IMDS-V1 |
| `ec2:DescribeVolumes` | encryption of this instance's disks | CLD-VOLUME-UNENCRYPTED |
| `ec2:DescribeNetworkAcls`, `ec2:DescribeRouteTables` | whether the internet can reach the instance at all (subnet ACL, route to an internet gateway) — v2 cloud reachability | REACH-BEYOND-INTENT, CLD-ADMIN-PORT-OPEN |
| `ec2:DescribeSnapshots` | whether this instance's disks are snapshotted (backups) | CLD-NO-SNAPSHOT |
| `guardduty:List*/GetFindings` | threat findings about this instance; whether GuardDuty is on | CLD-002, CLD-004 |
| `cloudtrail:LookupEvents` | who changed this instance's security groups (last 90 days of management events are recorded by default — no trail needed) | CLD-003 |

Any permission you leave out makes that part **unavailable** (shown on the
source with the reason); the other checks keep working.

**IMDS hop limit.** If the Sensor runs inside a container on the instance, set the
metadata hop limit to 2 (`aws ec2 modify-instance-metadata-options --instance-id <id> --http-put-response-hop-limit 2`).

The AWS-managed **SecurityAudit** policy covers all of the above (and more read-only
calls) — the simplest choice. NS-CLOUD-ACCESS names any permission that is missing.

**Least privilege, checked (NS-IDENTITY-TOO-BROAD).** Every read, the Sensor also asks AWS
with a *dry run* whether the role could add a security-group rule (a documentation-range
address, port 1 — nothing is ever changed). If it could and fixing is off on the instance,
NetSentry says the role is broader than it needs.

### Optional: letting NetSentry close a port itself

Only if you want "Fix it for me" for **CLD-ADMIN-PORT-OPEN**: add
`ec2:RevokeSecurityGroupIngress` and `ec2:AuthorizeSecurityGroupIngress` (the second is used
only to put a rule back if a fix fails) **and** switch fixing on at the instance
(`NETSENTRY_EXECUTOR=on` in the Sensor's environment). The Sensor removes exactly one rule
that lets the whole internet (`0.0.0.0/0` or `::/0`) reach one port, after a person approved
that exact plan; it refuses anything else.

### Keyless enrolment

An instance with an allowed role enrols its Sensor without any token: it signs an
`sts:GetCallerIdentity` request with its own role (bound to your console's address) and
NetSentry asks AWS who signed it. No permission is needed for that call. Allow the role in
**Network → Put a monitor on your servers → On AWS** (or `settings.update cloud_enrol_roles`),
then run `curl -fsSL https://<console>/api/netsentry/sensor/install.sh | sudo NETSENTRY_KEYLESS=aws sh`.

## GCP — VM service account

Give the VM a service account with **Compute Network Viewer**
(`roles/compute.networkViewer`, read-only — or a custom role with just
`compute.firewalls.list`) and the `cloud-platform` or `compute-ro` access scope. NetSentry reads the firewall rules that apply to this VM's network
and tags (CLD-ADMIN-PORT-OPEN).

## Azure — managed identity

Enable the VM's system-assigned managed identity and grant it **Reader** on the
VM's resource group. NetSentry reads the VM, its network interfaces and their
network security groups (CLD-ADMIN-PORT-OPEN).

## App accounts (organisations, D12)

To see who has an account in an app and who is an administrator, NetSentry needs a
**read-only** key for that app. Today only apps that offer one are supported:

| App | Key | Proven in the lab |
|---|---|---|
| Gitea, Forgejo | an access token with only the `read:admin` scope (Settings → Applications) | lists every account; the same token is refused when it tries to create one |

Keys are stored encrypted, never returned by any operation, and handed only to the
Sensor on the machine that runs that app. Apps whose keys can also change things
(Nextcloud, Grafana OSS, Vaultwarden, Odoo…) are not asked for one: review their accounts
in the app and record the review in NetSentry.

## Status of the cloud adapters

The AWS request signing is checked against AWS's published Signature V4 test vector, and
all parsers are tested against the providers' documented response formats. The AWS
adapter — reads, cloud reachability, the dry run, keyless enrolment and the
security-group fix — runs end to end in the lab against **moto** (the open-source AWS
API emulator) with an emulated instance metadata service (`tests/lab/riya.py`).
**None of the three adapters has yet been run against a live account** — treat the first
run as a check (docs/PLATFORM-MATRIX.md).

## v3: what the monitor can do when changes are switched on

Changes are off until someone **at the machine** switches them on (the installer asks;
`NETSENTRY_EXECUTOR=on`). The console can never switch them on, and every change still needs a
person to confirm it in NetSentry (or a standing policy a person set: a maintenance window, a
backup plan).

| To do this | the monitor needs | why |
|---|---|---|
| start / stop / restart, update, back up, install apps | Docker's socket | Docker's socket is as powerful as root on that machine. The monitor never opens a port; every action is typed and its target checked by the monitor itself. |
| restart services, install security updates, schedule a restart | root (Linux) / SYSTEM (Windows) | the operating system only lets an administrator do these |
| back up apps | write access to the backup folder | set `NETSENTRY_FOLDERS` to limit where copies may ever go |
| show log sizes (in a container) | `/var/lib/docker/containers` read-only | otherwise HL-DOCKER-LOGS says "can't tell" |
| processor, memory, disks (in a container) | the host's `/proc` and `/sys` read-only | otherwise the container's own numbers would be reported |

Never, whatever is switched on: a shell or free-form command, a web terminal, new monitor code
from the console, a privileged or capability-adding container, the monitor stopping itself, or
touching remote login, networking, the firewall or Docker itself.
