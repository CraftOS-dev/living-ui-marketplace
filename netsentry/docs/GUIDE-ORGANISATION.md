# NetSentry for an organisation

For the person who looks after a company's self-hosted apps — a CRM, code, a wiki, files,
monitoring — on a few servers.

## Set up (about 30 minutes)

1. Run NetSentry on a management machine the servers can reach, behind **https** (for example
   Caddy in front of it): monitors on other machines only talk to it over https.
2. **Setup → Who is NetSentry for?** → *My organisation's apps*. Network and Reports appear.
3. **Network → Put a monitor on your servers.** Make a join token (it enrols up to N machines
   for N days) and use one of:
   - one command on a server: `curl -fsSL https://<netsentry>/api/netsentry/sensor/install.sh | sudo NETSENTRY_JOIN=<token> sh`
   - the Ansible playbook it gives you, for many servers at once;
   - the cloud-init file, for new VMs.
   Each server swaps the join token for its own key; revoke the token when you're done.
4. **Network → Which networks should NetSentry look at?** Your monitors propose the networks
   they are on. Allow the ones you own. NetSentry then looks for devices there — a short list
   of well-known ports and each web page's name, never a login.
5. **Home → Finish setting up.** The checklist walks you through the rest:
   - **Your apps → Apply a policy to many apps at once**: *internal app*, *business-critical*,
     *admin tool*, *behind-the-scenes service* (databases), *public website*. Each app records
     the policy it follows;
   - an **owner** and **importance** per app;
   - **alerts**, and who gets the **monthly report**.

## What you get

- **Home**: one table of your apps — reach, safety settings, updates, backups, up — with owners.
- **Network**: a map of each network, what the internet can reach (and whether you meant it),
  which servers have a monitor, and new devices to confirm (*It's ours* / ignore).
- **Accounts** (optional): for apps with a read-only key (Gitea, Forgejo: a token with only
  `read:admin`), who has an account, who is an administrator, and accounts nobody used in 90
  days. Every app gets an **access review** reminder; record each review on the app's page.
- **Accepted risks**: anything accepted as fine, with who, why and until when. Organisations
  must set an end date (at most a year); when it passes, it counts again and the daily summary
  says so.
- **Reports**: the monthly one-pager for your manager or auditor — apps and their state, what
  was fixed and by whom, what's still open and when it's due, accepted risks, coverage and
  NetSentry's own health. Print it to PDF or have it emailed on the 1st. The *auditor* role can
  read everything and change nothing.

## Running the servers (v3)

- **Machines**: every server at a glance — processor, memory, fullest disk, issues, updates
  waiting (apps, risky ones, operating-system security), a pending restart, backups. Pick several
  and **Install security updates**: they run one machine at a time and stop at the first failure.
- **Apps**: every app on every server, with Start / Stop / Restart, Logs, Updates (with automatic
  undo), Backups (taken, restore-tested every month) and its changes.
- **Maintenance windows** (Settings → Updates): apps set to "update small ones in my window" are
  updated only then, one at a time; never a new major version or a database upgrade.
- **Who confirms what**: anyone who looks after the machines (analyst) confirms starts, stops,
  restarts and backups; an admin confirms updates, restores, installs and operating-system
  changes. The agent may prepare any of them when asked, and never confirms.
- **Owners hear first**: an app's owner (an email address on the app) gets its urgent problems
  directly, besides the usual alerts.
- **Change records**: every change — who asked, who confirmed, what happened — on each app and
  machine, and as a spreadsheet for any period (the *changes.export* operation). The monthly report
  adds what was done to keep things running: changes by kind, updates applied and waiting,
  backups taken and restore tests, disks filling up.

## Changes NetSentry makes

Only when a person confirms them (or a standing policy a person set: a maintenance window, a
backup plan), only the typed actions in docs/ARCHITECTURE.md, only on a machine where changes
were switched on AT that machine (the console can never switch it on), and never with a plan
other than the one confirmed. Each is applied by the machine's own monitor, which checks every
target itself, proves the result, and undoes it if it didn't work. Everything is in the audit log.
