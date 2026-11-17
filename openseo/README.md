# OpenSEO — as an Agent App

**This is [OpenSEO](https://openseo.so), by Ben Senescu and [Every App](https://github.com/every-app), running exactly as its authors release it.**

OpenSEO is the open-source alternative to Semrush and Ahrefs. It covers:
- keyword research and rank tracking;
- site audits;
- domain, backlink and competitor research;
- local SEO;
- AI visibility across ChatGPT, Claude, Gemini and Perplexity;
- Google Search Console and GA4;
- HTML reports.

You bring your own DataForSEO key and pay only for the data you use. Every feature here is the OpenSEO team's work.

- Website: https://openseo.so
- Source: https://github.com/every-app/open-seo (MIT). Star it, file issues there, and join their Discord.
- Release used: `v0.1.27`, pinned by SHA-256 in [upstream.json](upstream.json)

## What this package adds

Only the agent layer:
- **No changes to OpenSEO.** The install step downloads OpenSEO's own release archive, checks its hash, and unpacks it into `upstream/`.
- **Agent access.** A small sidecar puts the [Agent App framework](https://github.com/CraftOS-dev/Agent-App) in front of OpenSEO, so any agent that speaks `a2app` can drive all 84 of OpenSEO's own tools.
- **Approval.** The person approves deletions and anything that starts recurring charges.
- **The rest is OpenSEO's.** Your browser gets OpenSEO's own UI. OpenSEO's MCP endpoint stays open at `/mcp` for MCP clients.

## Install

```sh
agent-app install openseo
agent-app openseo serve --install
agent-app openseo open
```

Needs Node 20 or newer and an internet connection for the first install. It takes about 3 minutes: the release download, `pnpm install` and the build. Docker and a Cloudflare account are not needed.

**Windows:** keep the app folder path short. The default `~/.a2app/apps/openseo` is fine; otherwise use `--into C:\apps\openseo`.

## Keys

Keys live in `data/settings.env`. Either edit that file, or give them to your agent, which stores them with `app set_keys` and restarts OpenSEO:

| Key | Needed for |
| --- | --- |
| DataForSEO (login + API password from app.dataforseo.com/api-access) | all SEO data: keywords, SERPs, domains, backlinks, rank tracking, AI visibility, Lighthouse |
| OpenRouter (or any OpenAI-compatible server) | SAM, OpenSEO's in-app assistant, and website research |
| Google OAuth client id + secret | Search Console and GA4 (`app status` lists the redirect URIs) |
| Google Maps | the Local SEO map |
| Context.dev | site audits that render JavaScript |

Without any key you still get projects, project memory, site audits (the crawl), reports, and Search Console / GA4 once Google is connected.

**Telemetry:** OpenSEO's anonymous usage heartbeat (counts only) is **off** here unless you turn it on (`OPENSEO_TELEMETRY=on`). Turning it on is an easy way to help the OpenSEO team see their project being used.

## Credit and licence

OpenSEO is © 2026 Ben Senescu, released under the MIT licence; see [NOTICE.md](NOTICE.md). Its full licence text ships inside every install at `upstream/LICENSE`. The agent layer in this folder (`sidecar/`, `a2app/` and the framework files) is the marketplace's, also MIT.
