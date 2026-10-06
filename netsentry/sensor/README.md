# NetSentry Sensor

A small, dependency-free Python program (3.9+) that reports a machine's security
state to your NetSentry console. It is **read-only**: it never changes the host.

## What it reports

| Collector | Linux | Windows | macOS | Notes |
|---|---|---|---|---|
| Operating system | ✓ | ✓ | ✓ | |
| Listening ports | `ss` | `netstat` + `tasklist` | `lsof` | process names need root/Administrator |
| Users & administrators | /etc/passwd, sudo/wheel | local users, Administrators group | dscl | |
| SSH server & authorized keys | `sshd -T` or sshd_config | OpenSSH for Windows | ✓ | key **fingerprints** only, never comments |
| Pending security updates | apt, dnf | — | — | |
| Login attempts | journald / auth.log | Security log 4624/4625 (**Administrator**) | — | counts per source per minute; raw lines never leave the host |
| Autostart entries | cron, systemd | Run keys, scheduled tasks, auto services | launchd | command lines are redacted (passwords, tokens, keys) |
| Critical file integrity | passwd, shadow, sudoers, sshd_config, hosts, ld.so.preload… | hosts, sshd_config | hosts, sudoers… | SHA-256 only |
| Disk encryption, firewall, antivirus | LUKS, ufw/firewalld | BitLocker, Windows Firewall, Security Center | FileVault, app firewall | on cloud VMs disk encryption is left to the cloud adapter |
| Docker published ports | ✓ | ✓ | ✓ | needs access to the Docker daemon |
| Network connections | `ss` | `netstat` | `lsof` | programs on the network; outbound destinations aggregated per minute |
| DNS lookups | Pi-hole¹ | DNS client cache, or Pi-hole¹ | Pi-hole¹ | names only |
| IDS alerts | Suricata eve.json, CrowdSec | — | — | only when installed |
| Cloud (AWS / GCP / Azure) | ✓ | ✓ | — | uses the VM's own identity, never keys — see `docs/PERMISSIONS.md` |

¹ Set `NETSENTRY_PIHOLE_URL` (and `NETSENTRY_PIHOLE_TOKEN`) in the sensor's environment to read lookups from your Pi-hole.

Anything it cannot read is reported as **unavailable, with the reason**. It never guesses.

## Run it

1. In NetSentry go to **Sources → Sensors → Add sensor**, name it and copy the command. The token is shown once.
2. On the machine, from this `sensor/` directory:

   ```bash
   python -m netsentry_sensor check                                   # what can this host report? (sends nothing)
   python -m netsentry_sensor run --console http://127.0.0.1:<port> --token ns1.xxxx.yyyy   # the command in NetSentry has the right port
   ```

   Or run `pip install .` and then use `netsentry-sensor run …`. For full coverage run it as root / Administrator.
3. To keep it running, use a systemd service on Linux. Example `/etc/systemd/system/netsentry-sensor.service`:

   ```ini
   [Unit]
   Description=NetSentry Sensor
   After=network-online.target
   [Service]
   Environment=NETSENTRY_CONSOLE=http://127.0.0.1:<port>
   EnvironmentFile=/etc/netsentry-sensor.env   # NETSENTRY_TOKEN=ns1.xxxx.yyyy  (chmod 600)
   ExecStart=/usr/bin/python3 -m netsentry_sensor run
   WorkingDirectory=/opt/netsentry/sensor
   Restart=always
   [Install]
   WantedBy=multi-user.target
   ```

   On Windows, use a Task Scheduler task "At startup", run whether the user is logged on or not.

## Security

- The token is a revocable credential. It can only *check in* and *report*; it cannot read anything in NetSentry.
- If the console is unreachable, reports are spooled to disk and sent later.
- If the sensor stops checking in for 10 minutes, NetSentry raises **RES-002 "Sensor has gone silent"** and alerts you.
- A console on another machine must be reached over `https://` (plain http is refused except to this machine, and redirects are never followed). `--ca-file` / `NETSENTRY_CA_FILE` trusts a private CA. See `docs/DEPLOYMENT.md` → "Sensors on other machines".

## Tests

```bash
python -m unittest discover -s tests
```
