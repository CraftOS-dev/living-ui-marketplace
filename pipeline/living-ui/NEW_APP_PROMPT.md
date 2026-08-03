# Start a new Living UI — fill in and paste

This is the **only** thing you need to start the autonomous pipeline: fill in the fields, paste the whole block into a chat, and the research → build → QA → review flow runs on its own until it's ready for you to look at (see [README.md](README.md) for how the pipeline works end to end). There's no separate queue or request file — one app at a time, tracked entirely under `runs/`.

Two variants below, depending on who you want doing the research. Pick one, fill it in, paste it — the rest is identical either way.

---

## Research by CraftBot (default — paste into CraftBot chat)

```
You are the Living UI RESEARCH pipeline runner.
Read the file /workspace/pipeline/living-ui/RESEARCH_PIPELINE.md in full and
follow it exactly, stage by stage, in order.
Mode: RESEARCH — resume an in-flight run if one exists, otherwise start this
request and take it through stage R8 (handoff).

APP
  Slug (kebab-case, used for the run id and the delivered ZIP):  <FILL IN>
  Display name:                                                  <FILL IN>
  Tags (3–5):                                                    <FILL IN>
  Auth mode (none | multi-user):                                 <FILL IN>

REQUIREMENT
<FILL IN — plain English, 1–10 sentences. Cover: what the app is and who it's
for; the features that matter most; any apps/products you'd like it to look or
behave like (these are pinned — they outrank whatever research finds); any
hard constraints (which of your connected services it should pull from,
explicit non-goals like "no email sending"). Don't write a spec — the pipeline
researches and writes that for you.>
```

## Research by Claude Code (paste into a Claude Code session instead)

Use this if you'd rather Claude Code do the research — same result, lighter process since it doesn't need the CraftBot-oriented hand-holding.

```
You are the Living UI RESEARCH pipeline runner (Claude Code variant).
Read agent_file_system/workspace/pipeline/living-ui/README.md and
RESEARCH_PIPELINE_CLAUDE.md in the CraftBot repo and follow them exactly,
stage by stage.
Mode: RESEARCH — resume an in-flight run if one exists, otherwise start this
request and take it through stage R8 (handoff).

APP
  Slug (kebab-case, used for the run id and the delivered ZIP):  <FILL IN>
  Display name:                                                  <FILL IN>
  Tags (3–5):                                                    <FILL IN>
  Auth mode (none | multi-user):                                 <FILL IN>

REQUIREMENT
<FILL IN — plain English, 1–10 sentences. Cover: what the app is and who it's
for; the features that matter most; any apps/products you'd like it to look or
behave like (these are pinned — they outrank whatever research finds); any
hard constraints (which of your connected services it should pull from,
explicit non-goals like "no email sending"). Don't write a spec — the pipeline
researches and writes that for you.>
```

---

## Filling in the two fields that aren't obvious

**Auth mode** — `none` means a personal local tool with no login (the default; pick this unless you have a reason). `multi-user` adds email+password accounts and per-account data. It's decided up front because every collection's access rules depend on it, and switching later means rewriting the whole schema.

**What you can and can't ask for.** The app runs locally as a single PocketBase process. It *can* read your CraftBot-connected accounts (Gmail, Slack, Discord, Notion, GitHub, …) through a built-in zero-key bridge, refreshing on load and on a schedule, and it *can* use in-app AI for things like summarizing or classifying. It *cannot* receive webhooks, run OAuth flows, ask you for an API key, or rely on browser permission prompts (location, notifications, camera) — so phrase external-data features as "pull my X from <service> and refresh periodically" rather than "notify me when X happens over there". If you ask for something impossible, the pipeline stops and offers you re-scopes rather than guessing.

---

After this, nothing else needs pasting until the review gate: research hands off to a Claude Code build session automatically, and it posts a review request in-chat when there's something for you to look at. That message includes a **ZIP path** — import it via the Living UI panel's import button (or ask CraftBot to run `living_ui_import_zip`) and it installs as a fresh project with its own id and port. See [README.md §5](README.md) for the follow-up prompts (approve/request changes, or manually resume if a run stalls).
