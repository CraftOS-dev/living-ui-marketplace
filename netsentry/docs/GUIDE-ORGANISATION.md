# NetSentry for an organisation

For the person who looks after a company's self-hosted apps — a CRM, code, a wiki, files,
monitoring — on a server. NetSentry looks after the one server it runs on (it keeps no list of
machines and has no organisation mode); with a few servers, run NetSentry on each one.

## Set up (about 30 minutes)

1. Install NetSentry on the server it should look after and open it. The first account becomes
   the admin. To bring your team in, switch **Settings → General & fixes → Sign-up** on while they
   create their accounts (they join as viewers), switch it off again, and give each person a role
   under **Settings → Team**: admin, analyst, viewer or auditor.
2. **Setup** (*Let NetSentry look after this server*) opens by itself the first time; later, Home
   → **Set it up**. **Install the monitor on this server → Show me the command** gives one command
   for the server (a terminal on Linux, an administrator PowerShell on Windows). Its key works
   once, for one day; Setup waits until the monitor reports.
3. **Who should reach your apps → Answer for each app.** One question per app: *only this server*,
   *only my local network*, *my network, and me when I’m away*, or *anyone on the internet*.
   NetSentry then checks that only they can.
4. **Get told when something is wrong**: a chat app (Slack, Discord, ntfy, any webhook), email
   sent by your agent, a heartbeat service, and the daily summary — Setup's third step, or
   **Settings → Alerts** later.
5. On each app's **Access & safety** tab: who should reach it; for Gitea, Forgejo and Odoo also
   *Who looks after it* (an **owner** and **importance**), a read-only key to list its accounts,
   and the **access review**.

## What you get

- **Home**: is everything OK — one status line, **Needs you** (problems grouped by cause, worst
  first, each with the one button that fixes it), **Your apps** (running, stopped, problems),
  recent activity and **Ask the agent**.
- **Server → Network & firewall**: what accepts connections, what Docker and the router open to
  the network (and whether you meant it), the firewall and remote access. **Activity → Network**:
  what the monitor saw on the wire in the last 24 hours.
- **Accounts** (optional): for apps with a read-only key (Gitea, Forgejo: a token with only
  `read:admin`; Odoo), who has an account, who is an administrator, and accounts nobody used in 90
  days — on the app's **Access & safety** tab. Those apps get an **access review** reminder;
  record each review on the same tab (**I’ve reviewed who has access**).
- **Accepted risks** (Activity → **Accepted risks**): anything accepted as fine, with who, why and
  until when. The end date is optional, at most a year away; when it passes, it counts again and
  the daily summary says so.
- **Audit log** (Settings → More settings → **Audit log**): every change by people, the agent or
  the system, in a tamper-evident chain an admin can verify and download. **Activity → Who did
  what** shows the last 7 days. The *auditor* role can read everything and change nothing.

## Running the server

- **Server**: the server at a glance — on its Overview processor, memory, temperature, how long
  it has been up, failed services, operating-system security updates waiting (**Install security
  updates**) and a pending restart; then Files, Disk space, Programs, Network & firewall, Users &
  keys, Scheduled jobs, Terminal, History and Details.
- **Apps**: every app on the server, with Start / Stop / Restart, Logs, Settings, Updates (with
  automatic undo), Backups (taken, restore-tested every month) and its changes (Overview →
  Changes made).
- **Maintenance windows** (Settings → Updates): apps set to "Update small ones in my maintenance
  window" are updated only then, one at a time; never a new major version or a database upgrade.
- **Who confirms what**: anyone who looks after the server (analyst) confirms starts, stops,
  restarts and backups; an admin confirms updates, restores, installs, operating-system changes,
  NetSentry's own fixes, and changes to files, app settings, the firewall, keys and scheduled
  jobs. The agent may prepare any of them when asked, and never confirms.
- **Owners hear first**: an app's owner (an email address in *Who looks after it*) gets its
  urgent problems directly, besides the usual alerts.
- **Change records**: every change — who asked, who confirmed, what happened — on each app
  (Overview → Changes made), on the server (Server → Overview → Changes made here) and in the
  audit log.

## Changes NetSentry makes

Only when a person confirms them (or a standing policy a person set: a maintenance window, a
backup plan), only the typed actions in docs/ARCHITECTURE.md, only on a machine where changes
were switched on AT that machine (the console can never switch it on), and never with a plan
other than the one confirmed. Each is applied by the machine's own monitor, which checks every
target itself, proves the result, and undoes it if it didn't work. Everything is in the audit log.
