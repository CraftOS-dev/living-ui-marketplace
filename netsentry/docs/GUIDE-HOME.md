# NetSentry at home

For a computer at home that runs your own apps — a movie server, a photo library, Home
Assistant, a download box. NetSentry keeps it running and keeps it safe, in one place.

## Set up (10 minutes)

1. Install NetSentry from the CraftBot marketplace and open it.
2. **Setup → Who is NetSentry for?** → *My home server*.
3. **Put the monitor on the server.** The simplest setup runs CraftBot (and NetSentry) on the
   server itself. Settings → Machine monitors shows the command for each kind of machine:
   - **Linux** (Ubuntu, Debian, Fedora…): one command in a terminal (`curl … | sudo sh`).
   - **Windows**: one command in an administrator PowerShell (`irm … | iex`).
   - **Unraid, Synology, TrueNAS**: the monitor as a container — the template in
     `deploy/unraid/` or the compose file in `deploy/compose/`.
   The installer asks one question: **may NetSentry make changes on this machine** when you
   confirm them? Say yes to get the Start / Restart / Update / Back up buttons. You can change
   your mind by running the installer again.
4. **Your apps → Tell us who should reach them.** One question per app.
5. Optional: **Settings → Alerts** so NetSentry can tell you when something needs you.

## Every day

Home says *Everything's running and safe* or lists the few things that need you, most important
first: an app that is down or keeps restarting, a disk filling up or failing, an app open to the
internet, a backup that didn't run. Each one says what NetSentry saw, what it means and what to do.

## Running your apps

Open an app (Apps → the app):

- **Start / Stop / Restart.** NetSentry shows exactly what will happen; you confirm; the monitor
  does it and checks it worked. Usually done in a few seconds.
- **Logs** — its last lines, read from the machine when you open them. Passwords and keys are
  hidden on the machine before anything is sent; NetSentry doesn't keep logs. Above them, what the
  lines usually mean ("it ran out of memory", "another app uses its port").
- **How it's running** — processor and memory over the last day, week or month.

Machines → your server shows the whole machine: processor, memory, temperature, how long it has
been up, disks (and when one will be full), services that failed, security updates waiting.

## Updates, safely

An app's **Updates** part says when a newer version is out and how risky it is (fixes only, new
features, or a new major version). **Update now**:

1. NetSentry copies the app's settings first,
2. downloads the new version (the app keeps running meanwhile),
3. starts it exactly as you had it set up,
4. checks it comes back healthy — running, answering, not restarting —
5. and if it doesn't, **puts the old version and its settings back by itself**.

For 14 days afterwards, **Roll back** puts it back the way it was.

Want it automatic? Set the app to **Update small ones in my maintenance window** and add a window
(Settings → Updates, e.g. Sundays 03:00–05:00). Only fixes and small updates, one app at a time,
never a new major version or a database upgrade.

Operating-system security updates: Machines → your server → **Install security updates**. The
kernel, remote login, networking and Docker are never updated automatically — do those yourself
with a restart planned (**Restart the machine…**).

## Backups

An app's **Backups** part → **Back it up with NetSentry**: pick a folder on another disk or a NAS
share. Every day NetSentry copies the app's settings and database there, keeps 7 daily, 4 weekly
and 6 monthly copies, and once a month **tests that the newest one restores**. Each copy has
**Restore…** (NetSentry keeps what is there now and puts it back if the app doesn't come back).

Movie and music libraries are not copied — they need a disk of their own, not a copy a day.

Already use a backup tool? Tell NetSentry about it instead: it gives you a private link your
backup job opens when it finishes, and says when a backup is late.

## Adding an app

Apps → **Add an app**: Jellyfin, Plex, Sonarr, Radarr, Prowlarr, qBittorrent, Home Assistant,
Immich, Vaultwarden, Nextcloud, Uptime Kuma (and, for offices, Odoo, Gitea, Wiki.js, Mattermost).
Each is set up safely from the start: its own folder, an ordinary user, reachable only at home
(never by opening your router), logs that can't fill the disk, passwords made on the machine.
Then NetSentry shows its first-time setup link.

## Using an app from away, safely

Opening a port on your router lets anyone on the internet find the app. An app's page →
*Who can reach it* → **Use it from away, safely** explains the private ways (Tailscale,
Cloudflare Tunnel with Access, your router's VPN).

## Asking the agent

In CraftBot you can ask: "how's my server?", "why did Jellyfin stop?", "restart Sonarr",
"update everything that's safe tonight". The agent reads what NetSentry knows and prepares
changes; **you confirm each one** in NetSentry (it shows up on Home as "needs your OK").
