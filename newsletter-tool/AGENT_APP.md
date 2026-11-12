# Newsletter Tool

> Per-project plan, context and index. Keep it current with every change.

## Plan

A newsletter workspace for one person, in the browser, with no accounts or
sign-in. It keeps a subscriber list (with tags), reusable email templates,
and campaigns: emails built from blocks in a drag-and-drop editor, previewed
as recipients would see them, then sent now or scheduled. The left sidebar
(a bottom tab bar on phones) has Dashboard, Campaigns, Subscribers,
Templates, Schedule and Settings; the campaign and template editors take the
whole content area.

**Sending records; it does not email.** The app's Send (and a scheduled
send when its time comes) records the audience snapshot: every subscriber in
the campaign's audience (everyone whose status is `subscribed`, or with
tag targeting only those with any of its tags) becomes a recipient row on the
campaign, and the campaign is marked sent with that count. No email leaves the
app: the person mails a campaign from their own email service, or asks their
AI agent to send it. `campaigns.send-now` does exactly what the Send button
does.

An AI agent operates the app through the `a2app` CLI. Every action a person
can take on the screens has an operation, and an operation stores exactly
what the same action in the UI stores (the screens' logic runs in the browser,
`frontend/src/app/services/apiAdapter.ts`; the operations are server ports of
it in `pb/pb_hooks/lib_agent.js`). The app hands no work to the agent (no
events).

**Start every agent session with `a2app <app> app app.guide`**: it returns
how the app works, the block format, the design keys, the placeholders and the
campaign statuses. `a2app <app> dashboard dashboard.get` then shows the state
of things.

## Modules

Every operation and every collection an agent can reach belongs to one module. `a2app <app>` lists them; `a2app <app> <module>` lists a module's operations.

| Module | Operations | Collections |
| --- | --- | --- |
| `app` | 1 | — |
| `dashboard` | 1 | — |
| `subscribers` | 4 | `subscribers` |
| `templates` | 6 | — |
| `campaigns` | 11 | — |
| `blocks` | 1 | — |
| `settings` | 2 | — |
| `ai` | 1 | — |
| `integrations` | 1 | — |

## Entities

See `reference/requirements.md` § Data Requirements.

Only `subscribers` is a raw-data entity (`a2app <app> data subscribers …`).
`campaigns`, `templates`, `settings` and `campaign_recipients` are hidden
from `data` (operations.json `x-agent-hidden-collections`): they are shaped
by operations only.

| Collection | What it holds | Reach it with |
|------------|---------------|---------------|
| subscribers | `email` (unique), `name` ("First Last"), `status` (`subscribed` or `unsubscribed`), `tags` (text, written `"vip, beta"`) | `subscribers.*`, or `data subscribers` |
| campaigns | `subject`, `body` (the sidecar, below), `blocks`, `status` (`draft` or `sent`), `scheduled_at`, `sent_at`, `recipients_count`, `deliver` (always false), `delivered_count` | `campaigns.*`, `blocks.edit` |
| templates | `name`, `subject`, `body` (the sidecar), `blocks` | `templates.*`, `blocks.edit` |
| campaign_recipients | One row per contact in the campaign's audience at send time: `campaign`, `email`, `name`, `status` (`logged`), `detail` | Written by a send only; deleted with its campaign |
| settings | One row: `sender_name`, `sender_email`, `reply_to`, `organization_name`, `organization_address` | `settings.*` |

**The sidecar.** Most of a campaign lives in its `body` text column as JSON:
`{"__meta":true, "name", "subject", "preheader", "fromName", "fromEmail",
"replyTo", "design", "targetTags", "targetAll", "status", "errorMessage"}`.
The `subject` column repeats the subject (else the name, else
`"(no subject)"`). A template's sidecar is `{"__meta":true, "preheader",
"design", "category", "icon", "usageCount"}`. The screens rebuild the
sidecar key by key on every save, so a raw write would wipe the name,
preheader, design, audience and status; a raw `status`, `sent_at` or count
would fake or undo a send (a sent campaign set back to `draft` with a past
`scheduled_at` is sent again by the scheduler); and `deliver: true` would make
the scheduler try real delivery. That is why these collections are reached
through operations only.

**Campaign status.** What the screens and operations call a campaign's
status is the logical one: `sent` when the `status` column is `sent`,
otherwise the sidecar's `status`: `draft`, `scheduled` (the column stays
`draft` and `scheduled_at` is set, so the scheduler picks it up) or
`cancelled`. `sending` and `failed` exist as filter values but nothing
produces them. A `sent` campaign is read-only: it can be duplicated or
deleted, not edited, scheduled or sent again.

**Blocks.** A campaign's or template's body is the `blocks` JSON array,
rendered top to bottom: `heading` (`text`, `level` 1–3, `align`, `color`),
`text` (`text`, `size` small|normal|large, `align`, `color`), `button`
(`label`, `url`, `align`, `backgroundColor`, `textColor`), `image` (`url`,
`alt`, `width` small|medium|full, `align`), `divider` (`color`), `spacer`
(`height` 4–96 in steps of 4). Colors are `#RRGGBB`. `heading` and `text`
hold the editor's inline markup only: b, i, u, font color, a href (http,
https or mailto), div, br, span style. `{firstName}`, `{lastName}`, `{email}`
and `{unsubscribeUrl}` are filled per recipient in the preview. Operations
refuse fields and markup the editor cannot produce. `app.guide` has the full
schema with each type's defaults. The design object takes `emailBg`,
`cardBg`, `textColor`, `headingColor`, `buttonBg`, `buttonTextColor` (colors)
and `fontFamily` (`system`, `serif`, `mono`).

**Settings.** The sender name and email, the reply-to address, and the
organization name and mailing address are stored; the organization name and
address appear in the footer of the rendered email (the Review tab and
`campaigns.preview`). The per-campaign from name, from email and reply-to
are stored and shown, but the send uses none of them.

**Seed.** Three subscribers (Ada Lovelace and Grace Hopper tagged `vip`,
Alan Turing), one template "Monthly update" whose text sits in a plain body
with no blocks (the first campaign started from it stores that text as the
template's one text block), and the sender "My Newsletter"
<newsletter@example.com>.

## Operations

Call an operation with `a2app <app> <module> <operation> --param value` (`<app>` is the app directory, its id or its name). A destructive one first answers `approval_required` with an approval key: ask the person, then repeat the call with `--approve <key>`. `a2app <app> --find <word>` locates an operation by name. Every operation below runs on the server in the app's own code: the handler its screens use where they call one, otherwise a server copy of exactly what the screens do.

### app

- `app.guide` *(read-only)* — How the app works and the email block format: block types and fields, design keys, placeholders, campaign statuses, and what sending does. Read this first.

### dashboard

- `dashboard.get` *(read-only)* — The Dashboard: audience counts, 30-day subscriber growth, scheduled and draft campaigns, recent sends and quick-start templates.

### subscribers

- `subscribers.list` *(read-only)* — Subscribers, newest first, with the Subscribers screen's filters, the tag counts and the total number matching. Params: `status` (subscribed|unsubscribed|bounced), `tag` (string), `search` (string), `limit` (number), `offset` (number).
- `subscribers.add` — Add a subscriber as the Add form does; an email already on the list is updated instead (name set if given, tags merged). Params: `email` (string, required), `first_name` (string), `last_name` (string), `tags` (string).
- `subscribers.import` — Import pasted CSV as Import CSV does: one 'email, first name, last name' per line; existing emails are updated, new ones subscribed. Params: `csv` (string, required), `tags` (string).
- `subscribers.export` *(read-only)* — Export the subscribed audience as CSV text (email, name, tags).

### templates

- `templates.list` *(read-only)* — Templates as the Templates screen shows them (most used first), without their blocks, with the total. Params: `limit` (number), `offset` (number).
- `templates.get` *(read-only)* — One template with its subject, preheader, blocks and design. Params: `template_id` (string, required), `include_data_urls` (boolean).
- `templates.create` — Create a template as New blank template does (a 'Hello!' heading and one paragraph unless blocks are given). Params: `name` (string, required), `subject` (string), `preheader` (string), `blocks` (json), `design` (json).
- `templates.update` — Change a template's name, subject, preheader, blocks (whole array) or design (merged), as the template editor saves it. Params: `template_id` (string, required), `name` (string), `subject` (string), `preheader` (string), `blocks` (json), `design` (json).
- `templates.duplicate` — Copy a template as '{name} (copy)' with the same subject, preheader, blocks and design. Params: `template_id` (string, required).
- `templates.delete` *(destructive)* — Delete a template; campaigns started from it keep their content. Params: `template_id` (string, required).

### campaigns

- `campaigns.list` *(read-only)* — Campaigns as the Campaigns screen shows them (last edited first; scheduled ones by send time), with the total. Params: `status` (draft|scheduled|sending|sent|failed|cancelled), `limit` (number), `offset` (number).
- `campaigns.get` *(read-only)* — One campaign: content, design, audience (who a send records) and whether it is editable. The audience is the Audience tab's; sendRecords is how many recipients a send records. Params: `campaign_id` (string, required), `include_data_urls` (boolean).
- `campaigns.preview` *(read-only)* — The email as the Review tab renders it, personalised for the first subscribed contact. Params: `campaign_id` (string, required), `format` (text|html|both).
- `campaigns.create` — Create a draft campaign, blank or from a template (copies its content and counts one use). From a template it copies the subject, preheader, blocks and design. Params: `name` (string), `template_id` (string).
- `campaigns.update` — Edit a campaign that is not sent, as the editor saves it: any of its fields, its blocks or its design. Blocks replace the whole array; design keys are merged. Params: `campaign_id` (string, required), `name` (string), `subject` (string), `preheader` (string), `from_name` (string), `from_email` (string), `reply_to` (string), `target_all` (boolean), `target_tags` (string), `blocks` (json), `design` (json).
- `campaigns.duplicate` — Copy a campaign (any status) as a new draft '{name} (copy)'. Params: `campaign_id` (string, required).
- `campaigns.delete` *(destructive)* — Delete a campaign of any status, with its recorded recipients. Params: `campaign_id` (string, required).
- `campaigns.schedule` — Schedule a campaign for a future time; the app then records the send exactly as Send now does. Sent campaigns cannot be scheduled, and past times are refused (use campaigns.send-now). Params: `campaign_id` (string, required), `scheduled_at` (datetime, required).
- `campaigns.cancel` *(destructive)* — Cancel a scheduled send; the campaign stays as a cancelled draft and can be scheduled again. Params: `campaign_id` (string, required).
- `campaigns.send-now` *(destructive)* — Send now as the app's Send does: records the campaign's audience (everyone subscribed, or by its tags) and marks it sent; no email is delivered. This records the audience snapshot exactly as the app's Send does and cannot be undone. No email leaves the app. Params: `campaign_id` (string, required).
- `campaigns.ai-write` — AI-write a campaign as the editor's AI writer does, replacing its subject, preheader and blocks. Without an LLM, a starter draft is used. Params: `campaign_id` (string, required), `prompt` (string, required), `tone` (friendly|professional|playful|concise|warm|persuasive), `audience` (string).

### blocks

- `blocks.edit` — Add (append), change, move or remove one block in a campaign or template, as the editor canvas does. Params: `campaign_id` (string), `template_id` (string), `action` (add|update|move|remove, required), `index` (number), `to` (number), `block` (json).

### settings

- `settings.get` *(read-only)* — Sender name and email, reply-to, the footer organization and address, and the integration state the Settings screen shows.
- `settings.update` — Change the sender name and email, reply-to, or footer organization and address, as Save on the Settings screen does. Params: `from_name` (string), `from_email` (string), `reply_to` (string), `organization_name` (string), `organization_address` (string).

### ai

- `ai.draft` — Draft a newsletter (subject + body) from a topic via the host's language model (503 when none is connected). Params: `topic` (string, required), `tone` (string).

### integrations

- `integrations.status` *(read-only)* — Whether the CraftBot LLM bridge is configured (used to show an honest AI-writer connected/disconnected state).

### Common jobs

Commands below write `<app>` for the app; ids come from the list and get
operations. A JSON parameter (`--blocks`, `--block`, `--design`) takes the
JSON text, and any parameter value written `@path` is read from that file
(`@-` reads standard input).

- **Look around.** `a2app <app> app app.guide`, then
  `a2app <app> dashboard dashboard.get` (audience counts, the scheduled and
  draft campaigns, recent sends, templates already used, 30-day growth).
- **Build a campaign from a template.**
  1. `a2app <app> templates templates.list` and pick one (`templates.get
     --template_id <id>` shows its blocks).
  2. `a2app <app> campaigns campaigns.create --template_id <id>`: a draft
     named "<template> — campaign" with the template's subject, preheader,
     blocks and design; the template's use count goes up by one. Without
     `--template_id` it is a blank "New campaign"; `--name` sets the name.
  3. `a2app <app> campaigns campaigns.update --campaign_id <id> --subject
     "…" --preheader "…"` for any of the editor's fields (`name`,
     `from_name`, `from_email`, `reply_to`, `target_all`, `target_tags`),
     `--design '{"buttonBg":"#171717"}'` (merged), or `--blocks @blocks.json`
     (replaces the whole array).
  4. Edit single blocks with `blocks.edit` (next item), then preview.
- **Edit blocks.** `a2app <app> blocks blocks.edit --campaign_id <id>` (or
  `--template_id`) with `--action`:
  - `add --block '{"type":"text","text":"Hi {firstName}"}'` appends, like the
    palette; fields left out take the palette's defaults.
  - `update --index 2 --block '{"text":"New words","align":"center"}'` merges
    the fields into block 2; a block keeps its type.
  - `move --index 4 --to 1` and `remove --index 3`.

  Indexes count from 0 in the order `campaigns.get` returns; every call
  answers with the new order as a short summary, so re-read it after a move,
  add or remove. An image takes an `https://` address or a
  `data:image/…;base64,…` upload.
- **Preview.** `a2app <app> campaigns campaigns.preview --campaign_id <id>`
  gives the plain text; `--format html` (or `both`) gives the HTML the Review
  tab shows. It is personalised for the first subscribed contact.
- **Schedule.** `a2app <app> campaigns campaigns.schedule --campaign_id <id>
  --scheduled_at 2026-12-01T09:00:00Z`. The time must be in the future and end
  in `Z` or an offset (`+02:00`); a past time is refused with a pointer to
  `campaigns.send-now`. Scheduling again moves the time. When the time comes,
  the minute scheduler records the send exactly as Send now does. Editing a
  scheduled campaign keeps its schedule.
- **Send now** *(destructive)*. `a2app <app> campaigns campaigns.send-now
  --campaign_id <id>` first answers `approval_required`: tell the person that
  it records the campaign's audience (everyone subscribed, or the subscribed
  contacts with any of its tags; `campaigns.get` shows the count), marks the
  campaign sent for good, and delivers no email; repeat with `--approve <key>`
  once they agree. The result is `{"sent":true,"recipients":N,"delivered":0,
  "failed":0,"mode":"recorded"}`. A second send answers 409.
- **Cancel a schedule** *(destructive)*. `a2app <app> campaigns
  campaigns.cancel --campaign_id <id>` (approval as above). Only a scheduled
  campaign can be cancelled; it becomes `cancelled`, stays editable and can be
  scheduled again.
- **Import subscribers.** `a2app <app> subscribers subscribers.import --csv
  @subscribers.csv --tags "imported, 2026"` (or `--csv @-` to pipe the text
  in). One subscriber per line: email, first name, last name (names
  optional); lines starting with `#` are skipped, and a line without "@" is
  counted as skipped. An email already on the list is updated (name set when
  given, tags merged), never duplicated, so a re-run is safe. The answer
  counts `inserted`, `updated`, `skipped`, and lists in `errors` the rows
  PocketBase refused.
- **One subscriber.** `subscribers.add --email … --first_name … --tags …`
  adds one (or updates the same email, as the Add form does). To edit or
  remove one, use the raw entity: `a2app <app> data subscribers update <id>
  --status unsubscribed --tags "vip, beta"` and `data subscribers delete
  <id>`. Write emails in lower case, `name` as "First Last", tags as
  `"a, b"`, and `status` as `subscribed` or `unsubscribed`; a subscriber
  with no status shows as subscribed but is left out of sends.
  `subscribers.export` returns the subscribed contacts as CSV text (email,
  name, tags).
- **AI writer.** `a2app <app> campaigns campaigns.ai-write --campaign_id <id>
  --prompt "Spring sale on all plans" --tone warm --audience "early
  customers"` drafts with the host's language model and applies it as the
  editor does: the subject and preheader are replaced when the draft has
  them, and the blocks are replaced (a heading, the paragraphs, a "Learn more"
  button). `status` says `ok` (the model wrote it) or `stub`: with no model
  connected the app writes its starter draft, whose preheader asks to
  connect an AI agent. `ai.draft --topic …` returns the raw subject and body
  without writing anything, or 503 when no model is connected.
- **Templates.** `templates.create --name "Welcome v2"` (a "Hello!" heading and
  one paragraph unless `--blocks` is given), `templates.update` (same fields
  as the editor; `--design` merges, `--blocks` replaces),
  `templates.duplicate`, and `templates.delete` *(destructive)*. Campaigns made
  from a template keep their own copy of its content.
- **Sender and footer.** `settings.get` and `settings.update --from_name …
  --from_email … --reply_to … --organization_name … --organization_address …`.
  The organization name and address show in every preview's footer.

### Lists and results

- `subscribers.list`, `campaigns.list` and `templates.list` take `--limit`
  and `--offset` and always answer with `total` (the number matching). The
  default page is the screen's: 500 subscribers, 200 campaigns, 200
  templates. Keep paging while `offset + returned < total`.
- `campaigns.list --status scheduled` is ordered by send time, as the
  Schedule screen; every other list is ordered as its screen.
- Campaigns, templates and subscribers come back in the shapes the screens
  use (`name`, `subject`, `preheader`, `fromName`, `status`, `targetTags`,
  `targetAll`, `scheduledAt`, `sentAt`, `totalRecipients`, `sentCount`,
  `blocks`, `design`, …). `opensUnique`, `clicksUnique`, `unsubscribes` and
  `failedCount` are always 0: there is no tracking in this version.
- `campaigns.get` adds `readonly` and `audience`: `matching` is the Audience
  tab's count for the chosen targeting, `sendRecords` is what a send records
  (the same, less any subscriber stored with no status), plus counts and six
  sample recipients. `dashboard.get` gives each scheduled row its
  `contacts` count the same way.
- An uploaded image's `data:` URL longer than 200 characters is shortened in
  `campaigns.get` and `templates.get` results unless `--include_data_urls
  true`. Never send a shortened URL back (it is refused); change other blocks
  with `blocks.edit`, which leaves the image untouched.
- Errors answer `{"error": "…"}` naming the problem: 400 (a bad parameter or
  block), 404 (unknown id), 409 (not allowed in this state: editing, sending
  or scheduling a sent campaign, cancelling one that is not scheduled), 422
  (an email without "@").

### Notes

28 operations in `operations.json`, in the modules app, dashboard,
subscribers, templates, campaigns, blocks, settings, ai and integrations. The
agent operations are routed in `pb/pb_hooks/agent_ops.pb.js`, with their logic
in `lib_agent.js` and the email renderer in `lib_agent_render.js` (both
ported function by function from `apiAdapter.ts`, each citing its source).
`ops.pb.js` keeps the app's own routes: `subscribers.export`, `ai.draft`,
`integrations.status`, and `POST /api/ops/campaigns/send`, which the View's
Send calls and which is deliberately not declared to agents (its `deliver`
option is not something a person can do). The send itself is `send.js`
(`sendCampaign`, shared by the View, `campaigns.send-now` and the scheduler).

## Conventions

### Sending and email

- Every send is record-only. `campaigns.send-now` and the scheduler call
  `send.js` `sendCampaign(app, id, false)`, exactly as the View's Send:
  recipient rows are `logged`, `delivered_count` stays 0, and the campaign
  is marked sent with `recipients_count` set.
- The audience is the campaign's: every subscriber whose status is
  `subscribed` at that moment, or with `target_all` false only those with
  any of `target_tags` (nobody when none is chosen) — `send.js`
  `audienceOf`. The per-campaign sender fields are stored and shown but not
  applied by the send.
- `deliver.js` (Gmail through CraftBot's integration bridge) runs only when
  a send is asked to deliver: the `deliver` option of the View's
  `campaigns/send` route, or a campaign's `deliver` column for the scheduler.
  The View always passes false, nothing sets the column, and no declared
  operation offers delivery; without CraftBot's integration bridge it fails. Its
  `renderHtml` does not read the editor's block format (it gets the raw JSON
  field and reads a button's `text`, not `label`), so that unused path would
  not send what the preview shows; previews use `lib_agent_render.js` and the
  View's own renderer instead.

### Language model

- `campaigns.ai-write`, `ai.draft` and the editor's AI writer call
  `_craftbot_bridge.js` `callLLM`, answered by the host's language model:
  CraftBot when it launched the app, or the framework bridge
  (`agent-app <dir> bridge start`). With neither, `ai.draft` answers 503 and
  the AI writer and `campaigns.ai-write` use the starter draft (`stub`).
- `settings.get` and the screens report `llm.connected` true when any
  host's model answers (CraftBot or the framework bridge), and so does the
  `integrations.status` operation. Email delivery always shows as not
  connected.
- A model call can take up to 120 s through CraftBot or 300 s through the
  framework bridge.

### Background jobs

- `newsletter-scheduler` (`scheduler.pb.js`, every minute): campaigns whose
  `status` column is `draft` and whose `scheduled_at` has passed are sent
  through `sendCampaign`. Each logs `[newsletter-scheduler] sent <subject> →
  <n> recipient(s), recorded`; a failure logs `[newsletter-scheduler]
  failed: …` and the campaign stays scheduled for the next minute.

### Limits

- A campaign's or template's `blocks` JSON holds at most **31,457,280
  bytes** (30 MB, set by migration `1762819201_blocks_size_limit.js`). An
  image uploaded as a `data:` URL counts in full (a 5 MB file is about
  6.7 MB as base64), so a few full-size uploads fit. Over the limit an
  operation answers 400 "blocks: The maximum allowed JSON size is 31457280
  bytes."; the editor shows "Save failed: This email is too large to save…"
  and keeps the old content. Requests to the operations are also capped at
  PocketBase's 32 MB body limit. Prefer `https://` image addresses.
- Text limits: campaign `subject` 300 characters, template `name` 200,
  subscriber `name` 200, `tags` 500, the sidecar `body` 50,000.
- The screens load one page each: 500 subscribers, 200 campaigns, 200
  templates (newest first). The operations count and page over all rows, so
  above those numbers their totals are right and the screens show the first
  page only.

### Gotchas

- **Stale editors.** The screens do not subscribe to realtime changes: a
  section reloads its lists when it is opened and after the person's own
  actions. An open campaign or template editor holds its own copy and saves
  the whole copy 700 ms after the person's next edit, which silently reverts
  anything an agent changed in that campaign or template meanwhile; an open
  Settings form does the same on Save. Ask the person to leave the editor (go
  back to the list) before you edit that campaign or template, and to reopen
  it to see your change.
- A send cannot be undone. To reuse a sent campaign, `campaigns.duplicate`
  it (a new draft named "<name> (copy)").
- `campaigns.create`, `templates.create` and the two duplicates are not
  idempotent, and the CLI does not forward idempotency keys on operation
  calls: list before you retry a failed create.
- In the campaign editor a design-only change waits for the next other
  change before it is saved; `campaigns.update --design` saves at once.
- A page reload opens the Dashboard: the current section is not saved.
- The HTML in `campaigns.preview` is JSON-escaped (`<` reads as `<`);
  parse the JSON to get the markup.
- Hooks do not hot-reload: restart the app after any hook change. In hooks,
  JSON fields are read with `getString()` and `JSON.parse` (`get()` returns raw
  bytes), and `require()` stays inside each handler.

### Ownership map

- **System-owned (hash-locked, from the `blueprint-pocketbase-kit` toolkit — never edit):** `manifest.json`, `pb-serve.mjs`, `pb-fetch.mjs`, `pb-check.mjs`, `pb-build.mjs`, `pb/pb_hooks/_a2app.pb.js`, `pb/pb_hooks/_a2app_impl.js`, `pb/pb_hooks/_a2app_rules.js`, `pb/pb_hooks/_compat_lib.js`, `pb/pb_hooks/_compat_rules.js`, `pb/pb_hooks/_compat_system.js`, `pb/pb_hooks/_system.pb.js`, `pb/pb_hooks/_triggers.pb.js`, `pb/pb_hooks/_triggers_lib.js`, `pb/pb_hooks/_craftbot_bridge.js`.
- **Agent-owned:** `operations.json`, `events.json`, `AGENT_APP.md`, `reference/`, `pb/pb_hooks/a2app_routes.pb.js` (regenerate with `tools/agent-app-migrate` rather than hand-edit), every other file under `pb/pb_hooks/` and `pb/pb_migrations/`, and `frontend/`.

## Checklist

Build and verification tasks live in `reference/tasks.md`.

See `reference/requirements.md` (binding). Feature checklist:

- [x] Sidebar (collapsible; bottom tab bar on phones) with Dashboard, Campaigns, Subscribers, Templates, Schedule, Settings; theme from the host
- [x] Dashboard: briefing, campaigns in progress, quick start, recent sends, growth chart, audience split
- [x] Subscribers: list, search, status and tag filters, add (upsert by email), edit drawer, remove, CSV import, CSV export
- [x] Templates: cards, blank template, editor with autosave, duplicate, delete, start a campaign (copies content, counts a use)
- [x] Campaigns: cards with status filters, new, duplicate, delete, cancel a schedule
- [x] Campaign editor: sender and subject fields, block palette, inline rich text, drag and context-menu ordering, per-block style, design, autosave, Audience and Review tabs, AI writer, schedule, send now (audience snapshot, no email)
- [x] Schedule: month calendar and agenda with cancel; the minute scheduler records due sends
- [x] Settings: integration state (email delivery never connected, AI writer), sender name and email, reply-to, footer organization and address (all stored)
- [x] Every screen action has an operation; campaigns, templates, settings and recipients are reached through operations only
