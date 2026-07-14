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
  Slug (kebab-case, used as the app folder + catalogue id):  <FILL IN>
  Display name:                                              <FILL IN>
  Tags (3–5):                                                <FILL IN>

REQUIREMENT
<FILL IN — plain English, 1–10 sentences. Cover: what the app is and who it's
for; the features that matter most; any apps/products you'd like it to look or
behave like (these are pinned — they outrank whatever research finds); any
hard constraints (auth needs, integrations to use, explicit non-goals like
"no email sending"). Don't write a spec — the pipeline researches and writes
that for you.>
```

## Research by Claude Code (paste into a Claude Code session instead)

Use this if you'd rather Claude Code do the research — same result, lighter process since it doesn't need the CraftBot-oriented hand-holding.

```
You are the Living UI RESEARCH pipeline runner (Claude Code variant).
Read the file pipeline/living-ui/README.md and RESEARCH_PIPELINE_CLAUDE.md in
the CraftBot repo and follow them exactly, stage by stage.
Mode: RESEARCH — resume an in-flight run if one exists, otherwise start this
request and take it through stage R8 (handoff).

APP
  Slug (kebab-case, used as the app folder + catalogue id):  <FILL IN>
  Display name:                                              <FILL IN>
  Tags (3–5):                                                <FILL IN>

REQUIREMENT
<FILL IN — plain English, 1–10 sentences. Cover: what the app is and who it's
for; the features that matter most; any apps/products you'd like it to look or
behave like (these are pinned — they outrank whatever research finds); any
hard constraints (auth needs, integrations to use, explicit non-goals like
"no email sending"). Don't write a spec — the pipeline researches and writes
that for you.>
```

---

After this, nothing else needs pasting until the review gate: research hands off to a Claude Code build session automatically, and it posts a review request in-chat when there's something for you to look at. See [README.md §5](README.md) for the follow-up prompts (approve/request changes, or manually resume if a run stalls).
