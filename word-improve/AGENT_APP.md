# Word Improve

> Per-project plan, context and index. Keep it current with every change.

## Plan

Word Improve is a git-style merge tool for prose. It is for one person in the
browser, with no accounts.

1. The person pastes a text (paragraphs separated by blank lines).
2. They pick a mode: **Improve** (polish the wording, keep the meaning),
   **Tone shift** (rewrite in Formal, Casual, Persuasive, Concise, Friendly
   or Academic) or **Custom** (a free-form instruction).
3. They pick how many variants they want, from 2 to 5.
4. A language model writes that many whole-text rewrites in a single call.
5. The app splits the original into sentences and lines every variant up
   against them. Sentences that every variant agrees on stay as plain text.
   Each disagreement becomes a numbered **conflict** with lettered choices
   (Original, Variant A, Variant B …). Each sentence that a variant adds
   becomes a numbered **addition** that the person includes or skips.
6. Every pick recompiles the **result**. It is shown as a word diff against
   the original and as plain text, with a Copy button.

There is one round of picking per session, and sessions persist: the
sidebar lists them all, newest activity first. The app has no language
model of its own. It asks the host's model (see § Conventions → The
language model).

An AI agent does all of this through the `sessions` module. It can:

- create a session;
- read the merge view;
- pick versions, include or skip additions;
- read the compiled result;
- regenerate a session;
- delete a session.

Renaming uses the record API. Each operation does exactly what the person's
screen does, with the same validation, and stores the same records. A
session an agent makes is identical to one made in the UI from the same
text and the same model answer.

## Modules

Every operation and every collection an agent can reach belongs to one module. `a2app <app>` lists them; `a2app <app> <module>` lists a module's operations.

| Module | Operations | Collections |
| --- | --- | --- |
| `ai` | 1 | — |
| `integrations` | 1 | — |
| `sessions` | 7 | `sessions` |

- **`sessions`:** the app itself. Everything a person does is here.
- **`integrations`:** `integrations.status` tells you whether the
  *person's own screen* will call a language model (see § Conventions).
- **`ai`:** `ai.generate` is the plumbing the person's screen uses for its
  model call. An agent never needs it.

## Entities

One collection holds everything. Each improvement run is one `sessions`
record, and its variants and merge rows are stored on it as JSON. Field
types and limits are in `reference/requirements.md` § Data Requirements.

| Field | Meaning |
|-------|---------|
| `title` | The display name. Set once from the model's 3–6 word title, or from `"<first line> (stub)"` when no model answered, if the session has none yet. Renaming changes it. When it is empty, screens show the first line of the text. |
| `original_text` | The pasted text, exactly as given |
| `mode` | `improve`, `tone_shift` or `custom` |
| `tone` | One of Formal, Casual, Persuasive, Concise, Friendly, Academic with `tone_shift`; otherwise empty |
| `custom_instruction` | The instruction with `custom`; otherwise empty |
| `variant_count` | 2–5 |
| `status` | `draft` (no variants yet), `variants_ready`, `compiled` (variants written and the result compiled; this follows every generation and pick) |
| `variants` | `[{idx, text}]`: the whole-text rewrites, one per variant (raw data only; no screen shows them) |
| `segments` | The merge rows, in order. Each row is `{kind, choices: [{source, text, note}], selection, position}`. `kind` is `conflict`, `addition` or `auto` (all variants agree). An `auto` row whose text is `"\n\n"` is a paragraph break. |
| `compiled_text` | The compiled result as last saved |
| `created` / `updated` | Server-set. The list is sorted newest `updated` first. |

Read sessions through the operations, which return them the way the screens
show them. `a2app <app> data sessions get <id>` shows the raw record,
including the stored `variants`.

## Operations

Call an operation with `a2app <app> <module> <operation> --param value` (`<app>` is the app directory, its id or its name). A destructive one first answers `approval_required` with an approval key: ask the person, then repeat the call with `--approve <key>`. `a2app <app> --find <word>` locates an operation by name. Every operation below runs on the server in the app's own code: the handler its screens use where they call one, otherwise a server copy of exactly what the screens do.

### ai

- `ai.generate` — Run one prompt through the host's language model and return the raw text (empty string when no language model is connected). Used to produce the whole-text rewrite variants. Params: `system` (string), `prompt` (string, required).

### integrations

- `integrations.status` *(read-only)* — Whether a language model is connected (CraftBot's bridge or a running framework bridge), so the screen can show an honest LLM-available banner.

### sessions

- `sessions.list` *(read-only)* — Your improvement sessions, newest first: id, title, status, mode, tone and variant count, as the sidebar lists them.
- `sessions.get` *(read-only)* — One session as the merge view shows it: numbered conflicts with their choices (original, A, B...), additions, picks left, and the compiled text. Params: `session_id` (string, required).
- `sessions.result` *(read-only)* — The compiled result: the final text (what Copy copies), the word diff against the original, words added and removed. Params: `session_id` (string, required).
- `sessions.create` — Start a session: the text, a mode and 2-5 variants; the LLM writes the variants, which can take minutes. If the call times out, do not retry: check sessions.list. Params: `text` (string, required), `mode` (improve|tone_shift|custom), `tone` (Formal|Casual|Persuasive|Concise|Friendly|Academic), `instruction` (string), `variants` (number).
- `sessions.regenerate` *(destructive)* — Ask the LLM for fresh variants of a session; replaces every pick and the compiled result. Can take minutes; if it times out, do not retry: check sessions.get. Params: `session_id` (string, required).
- `sessions.pick` — Pick a version for a conflict (original, A-E, or none to unpick) or include/skip an addition; the compiled text updates. Params: `session_id` (string, required), `position` (number), `choice` (string), `picks` (json).
- `sessions.delete` *(destructive)* — Delete a session for good. Params: `session_id` (string, required).

### The common jobs

**Improve a text** (create, then pick, then read the result):

```
a2app <app> sessions sessions.create --text "<the text>" --mode improve --variants 3
a2app <app> sessions sessions.get --session_id <id>
a2app <app> sessions sessions.pick --session_id <id> --position 2 --choice B
a2app <app> sessions sessions.pick --session_id <id> --picks '[{"position":4,"choice":"original"},{"position":6,"choice":"include"}]'
a2app <app> sessions sessions.result --session_id <id>
```

**Creating a session.**

- `--text` keeps its paragraphs only if the text holds real blank lines (two
  newlines) between them.
- `--mode tone_shift` takes `--tone`, which defaults to Formal.
- `--mode custom` requires `--instruction`.
- A `--tone` or `--instruction` with any other mode is refused, because the
  form never sends one.
- The result is `{session, llm}`. `session` has the same shape as
  `sessions.get`, and `llm` reports what the model contributed.

**Reading the merge.** `sessions.get` returns the header fields, `stats`,
`segments` in reading order, and the live `compiled_text`.

- `stats` holds `sentences`, `conflicts`, `picked` and `to_go`, exactly as the
  merge header counts them. `sentences` counts every row, including breaks
  and additions.
- A conflict row is
  `{position, kind: "conflict", number, picked, selected, choices: [{choice, label, text, note, pickable}]}`.
- An addition row is `{position, kind: "addition", number, label, text, included}`.
- Other rows are `{position, kind: "auto", text}` and `{position, kind: "break"}`.
- `number` is the "#3" or "+2" the person sees on screen.
- `position` is what `sessions.pick` takes. It is the row's index in the
  stored list and counts every row, so it is not the conflict number.

**Picking.**

- For a conflict, `choice` is `original`, a variant letter `A`–`E`, or `none`
  to unpick it.
- For an addition, `choice` is `include` or `skip`. Letters are
  case-insensitive.
- An unpicked conflict compiles as the Original sentence. Additions are
  skipped until included.
- A card with no text (other than a "remove this sentence" choice) cannot be
  picked. The screen disables it too, and the op refuses it with 409.
- Rows every variant agrees on, and paragraph breaks, offer no choice (409).
- `picks` applies a batch in order, all or nothing: one bad pick writes
  nothing. The batch ends the same as clicking each card in turn.
- The answer carries the new `stats` and `compiled_text`.

**The result.** `sessions.result` returns:

- `compiled_text`: exactly what the Copy button copies. Hand it to the person
  yourself, because an agent cannot reach their clipboard.
- `diff`: `[{op: equal|insert|delete, text}]`, the word diff the result pane
  draws.
- `words_added`, `words_removed` and `no_changes`.

A session with no variants yet answers 409.

**Fresh variants.** `sessions.regenerate` asks the model again, with a
"regeneration attempt" line in the prompt. The new variants replace every
pick and the compiled result. It is destructive (approval first). It is
also how a `draft` with no variants gets its first ones, which is what the
draft view's "Generate variants" button does.

**Rename.** Use `a2app <app> data sessions update <id> --title "New name"`.
Trim the name and never send an empty one, as the rename dialog does. The
field takes at most 500 characters.

**Delete.** `sessions.delete` removes the session and everything in it. It
is destructive (approval first), like the screen's "Delete this session?
This cannot be undone."

**Answers.** Every answer is the adapter's envelope `{a2app, ok, operation,
result}`. Refusals carry the app's message:

- 400: a bad or missing parameter, named in the message;
- 404: "Session not found";
- 409: the session has no variants yet, the row offers no choice, or the
  card cannot be picked.

### Work the app asks for

None. The app queues no tasks for agents (`events.json` declares no events).

## Conventions

### The language model

- **How the ops reach a model.** `sessions.create` and `sessions.regenerate`
  ask the host's language model through `_craftbot_bridge.callLLM`, in one
  call for all variants. It is answered:
  - by CraftBot's bridge when CraftBot launched the app (`CRAFTBOT_BRIDGE_URL`
    and `CRAFTBOT_BRIDGE_TOKEN`);
  - otherwise by the Agent App Framework's bridge when one runs for the app
    (`agent-app <app> bridge start`, which writes `.a2app/bridge-llm.json` and
    answers with the harness's own model);
  - otherwise by nobody.
- **When nobody answers.** The op stores exactly the placeholder stubs the
  person's screen shows without a model, for example
  `"<sentence> [stub rewrite #1] (connect an AI agent for real output)"`,
  with the title `"<first line> (stub)"`. It reports
  `llm: {answered: false, model_variants: 0, stub_variants: <n>, message}`.
  Do not present stubs as rewrites, and do not pick them as if they were
  real. Tell the person that no model is connected.
- **Partial answers.** When the model answers but some variants are unusable
  (not JSON, or fewer than asked), `llm.model_variants` says how many are
  real. The rest are stubs, and `llm.message` says so.
- **The person's own screen asks the same model.** It calls a model only
  when `integrations.status` answers `llmAvailable: true`, which it does when
  CraftBot's bridge is configured or a framework bridge answers (checked
  live, cached for 10 s). Without either, the person's "Generate variants"
  and "Regenerate" store stubs, and the screen says no language model is
  connected. Check `integrations.status` before telling them what their
  screen will do.

### Long calls

- **How long they take.** `sessions.create` and `sessions.regenerate` wait
  for the model: up to 120 s through CraftBot's bridge, and up to 300 s
  through the framework bridge. The CLI waits up to 600 s.
- **If the call still times out**, the server finishes and saves anyway, so
  do not repeat it:
  - after a `sessions.create`, a retry makes a second session. Run
    `sessions.list` and use the newest session.
  - after a `sessions.regenerate`, run `sessions.get`.
- **Status during the wait.** A session stays `draft` with no segments while
  its first generation is still running. Once it lands, the status becomes
  `compiled`.

### Limits

- `sessions.list` returns at most the 500 most recently updated sessions, as
  the sidebar does.
- The server-side word diff costs words × words. `sessions.result` skips it
  above 1,500,000 cells (about 1,200 × 1,200 words). It then answers
  `diff: null` and a `diff_skipped` note, without the word counts, and
  `compiled_text` is still complete. A 1,150-word text takes about 3 s.
- Text up to 2,000,000 characters and instructions up to 100,000 characters
  are accepted.

### The person's screen does not refresh by itself

- **What they see.** The screen has no live updates. The person sees an
  agent's picks, a regeneration, a rename or a deletion only after clicking
  the session in the sidebar again, or reloading. After changing a session
  they have open, tell them to reopen it.
- **Do not regenerate or delete a session they are working on without
  asking.** Their next click uses row positions from before the change, so
  it can land on a different sentence. Both ops need their approval anyway.
- **Opening a session saves on screen.** It recompiles and saves the result,
  which moves the session to the top of the list. `sessions.get` and
  `sessions.result` only read and change nothing.

### Writing through `data`

Write only `title` through `a2app <app> data sessions …`. After creation,
the UI never changes the mode, tone, instruction, variant count, text,
`variants`, `segments`, `compiled_text` or `status`. The operations are the
only way those change, and they keep them consistent. `data sessions
delete` would skip the person's approval; use `sessions.delete`.

### Code map

- **The person's screen.** It is the V1 frontend, unchanged. It talks to a
  fetch shim, `frontend/src/app/services/apiAdapter.ts`, which does all the
  domain work in the browser:
  - sentence splitting;
  - the prompt;
  - validating the model's answer and falling back to stubs;
  - building the merge rows;
  - compiling;
  - the word diff.

  It stores results through the record API, and reaches the model through
  `ai.generate` and `integrations.status` (`pb/pb_hooks/ops.pb.js`).
- **The agent operations.**
  - `pb/pb_hooks/agent_ops.pb.js` holds the routes, each at
    `/api/ops/sessions/<verb>`.
  - `lib_agent.js` holds the operations.
  - `lib_agent_text.js` is a function-by-function port of the shim's engine.
    Its output was checked to be identical to the shim's: the same stored
    bytes, picks, compile and diff.

  `a2app_routes.pb.js` serves all of them to agents as
  `POST /api/ops/<name>`.
- **Keep the two engines in step.** A change to the shim's engine must be
  made in `lib_agent_text.js` too.
- **Restarts.** Hooks do not hot-reload (`--hooksWatch=false`). Restart the
  app after any hook change.
- **`LIVING_UI.md` is out of date.** It describes the V1 Python backend and
  features this app does not have: Auto-complete mode, per-paragraph
  drill-down, per-chunk regenerate and a Compile button. Follow this file
  and `reference/requirements.md` instead.

### Ownership map

- **System-owned (hash-locked, from the `blueprint-pocketbase-kit` toolkit — never edit):** `manifest.json`, `pb-serve.mjs`, `pb-fetch.mjs`, `pb-check.mjs`, `pb-build.mjs`, `pb/pb_hooks/_a2app.pb.js`, `pb/pb_hooks/_a2app_impl.js`, `pb/pb_hooks/_a2app_rules.js`, `pb/pb_hooks/_compat_lib.js`, `pb/pb_hooks/_compat_rules.js`, `pb/pb_hooks/_compat_system.js`, `pb/pb_hooks/_system.pb.js`, `pb/pb_hooks/_triggers.pb.js`, `pb/pb_hooks/_triggers_lib.js`, `pb/pb_hooks/_craftbot_bridge.js`.
- **Agent-owned:** `operations.json`, `events.json`, `AGENT_APP.md`, `reference/`, `pb/pb_hooks/a2app_routes.pb.js` (regenerate with `tools/agent-app-migrate` rather than hand-edit), every other file under `pb/pb_hooks/` and `pb/pb_migrations/`, and `frontend/`.

## Checklist

Build and verification tasks live in `reference/tasks.md`. The binding
spec is `reference/requirements.md`.

- [x] Sidebar of sessions (newest activity first) with status, mode, rename and delete
- [x] New-session form: text, mode (Improve, Tone shift with a tone, Custom with an instruction), 2–5 variants
- [x] One model call per generation; placeholder stubs when no model answers
- [x] Git-style merge: agreed sentences, numbered conflicts with lettered choices, numbered additions to include or skip
- [x] Live compiled result: word diff, plain text, words added and removed, Copy
- [x] Regenerate; "Generate variants" for a session without variants
- [x] Every UI action has a CLI operation (rename through `data sessions update --title`)
