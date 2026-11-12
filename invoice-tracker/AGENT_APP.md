# Invoice & Subscription Tracker

> Per-project plan, context and index. Keep it current with every change.

## Plan

A dark, single-page tracker for a small company's software spend: recurring
subscriptions, one-time receipts and invoices, sorted into **workspaces**
(for example "Engineering & Cloud Stack"). It is used in the browser by one
person or a small team on one machine, with no accounts or sign-in
(`authMode: none`).

The header holds the app title, the workspace dropdown (with the
workspace's color dot), a currency quick-switch for the workspace, and the
buttons Groups, + Subscription and Add Invoice. Six tabs sit under it:

- **Overview Dashboard:** four KPI cards (Total Money Spent, Monthly
  Subscription Burn with the annual run rate, Active Subscriptions,
  Invoices & Receipts). Below them come the Spend Summary bar chart (the six
  months up to the current one), Spend by Service & Vendor (donut and table
  for the current or hovered month), and the three latest feed items.
- **Active Subscriptions:** subscription cards with search, status and
  category filters, the monthly burn and the annual run rate, and Pause,
  Activate and Delete on each card.
- **Invoices & Receipts:** the ledger table with search, category and
  payment-type filters and the filtered total. Each row has Inspect and
  Delete, plus the attached PDF's download or Attach PDF; Inspect opens the
  invoice inspector.
- **Live Ingestion Feed:** the activity log (`activities`), ten per page,
  with Refresh Feed (a simulated bill) and Log Event (a feed row typed by
  hand).
- **Monthly Costs:** month pills, the month's totals, recurring versus
  one-time spend, category and vendor breakdowns, itemised rows, and a
  "Download Report" CSV.
- **Multi-Year History:** totals for this year and the three before it, the
  quarterly and category split of a chosen year, and a statements list.

Each record's amount carries its own currency's symbol; totals are in the
shown workspace's currency and leave other currencies out (§ Conventions).
An attached PDF is stored on its invoice and can be downloaded; the app reads
nothing from it. The app has no email or mailbox connection. The only
"ingestion" is a built-in simulation of three sample bills (AWS, OpenAI,
Figma).

An AI agent works on the same data through the `a2app` CLI, using the 16
operations below and plain `data` access to the four collections. The app
never asks the agent for work: `events.json` declares no capabilities.

**Start a session with these three calls:**
- `a2app invoice-tracker data groups list --sort -created` lists the
  workspaces. The first row is the one the app opens on, and it is the
  default for every operation.
- `a2app invoice-tracker dashboard dashboard.overview` gives the figures the
  person sees first.
- `a2app invoice-tracker invoices invoices.list` and
  `a2app invoice-tracker subscriptions subscriptions.list` give the records.

Pass `--group all` to see every workspace at once, including records that
belong to none (written while All Workspaces was shown).

## Modules

Every operation and every collection an agent can reach belongs to one module. `a2app <app>` lists them; `a2app <app> <module>` lists a module's operations.

| Module | Operations | Collections |
| --- | --- | --- |
| `invoices` | 5 | `invoices` |
| `dashboard` | 1 | — |
| `subscriptions` | 4 | `subscriptions` |
| `reports` | 3 | — |
| `groups` | 3 | `groups` |
| `records` | 0 | `activities` |

## Entities

See `reference/requirements.md` § Data Requirements for every field.

The collections have no relation fields. A workspace link (`group_id`) and
a subscription link (`subscription_id`) are plain text record ids. Deleting
a workspace deletes the invoices, subscriptions and feed rows filed under it
(a server hook, `pb/pb_hooks/records.pb.js`, whatever path deletes it);
deleting a subscription leaves its invoices.
Amounts are plain numbers in major units (25.5 means 25.50). Dates the
app writes are ISO 8601 text such as `2026-11-11T09:30:00.000Z`. The
`created` and `updated` fields are PocketBase's own server time stamps.

| Collection | Purpose | Notes |
|------------|---------|-------|
| groups | Workspaces: `name`, `description`, `color` (one of six presets), `icon`, `currency` (the workspace's display currency) | One is seeded: "Engineering & Cloud Stack" (USD). The newest is the one the app opens on. |
| subscriptions | Recurring costs: `name`, `vendor`, `amount`, `currency`, `billing_frequency` (monthly, yearly, weekly, quarterly), `category`, `purpose`, `status` (active, paused), `group_id`, `last_billed_date`, `next_renewal_date`, `auto_renew`, `icon_name` | Two seeded (sub 240.00, sub1 598.00, monthly). |
| invoices | Receipts and invoices: `vendor`, `amount`, `currency`, `payment_type` (one_time, subscription), `billing_frequency` (text: none or monthly), `category`, `purpose`, `invoice_date`, `invoice_number`, `group_id`, `has_pdf_attachment`, `pdf_file`, `pdf_filename`, `pdf_text_preview`, `line_items`, `notes`, `subscription_id`, `confidence_score`, `is_verified` | Five seeded (test … test4, dated 2026-08-15). `pdf_file` is the stored PDF (one file, PDF only, up to 25 MB); `has_pdf_attachment` is true only when it is set. `pdf_data_base64` exists but nothing writes it. |
| activities | The Live Ingestion Feed: `event_type`, `title`, `description`, `amount`, `currency`, `vendor`, `group_id` | Written as a side effect when an invoice or subscription is added or deleted and when a bill is simulated, each with its record's currency; the feed's Log Event form writes one by hand. Three are seeded. |

## Operations

Call an operation with `a2app <app> <module> <operation> --param value` (`<app>` is the app directory, its id or its name). A destructive one first answers `approval_required` with an approval key: ask the person, then repeat the call with `--approve <key>`. `a2app <app> --find <word>` locates an operation by name. `invoices.simulate-bill` runs the same handler the app's own screens use. The screens write the four collections directly, so every other operation is a server-side copy of exactly what a screen does (`pb/pb_hooks/lib_agent.js`): the same fields, defaults, feed rows and formulas, checked against the screens' own code.

### invoices

- `invoices.simulate-bill` — Simulate an incoming emailed bill (the feed's Refresh Feed, preset aws): an invoice, its subscription link and a feed row, all in the workspace. Params: `preset` (string), `group` (string).
- `invoices.list` *(read-only)* — The Invoices & Receipts ledger: invoices with their count and filtered total, filtered like the screen (category; payment type; search over vendor, purpose, invoice number, category, amount and currency). Params: `group` (string), `category` (string), `payment_type` (all|one_time|subscription), `q` (string).
- `invoices.get` *(read-only)* — One invoice as the inspector shows it: vendor, purpose, amount, date, category, reference, verified %, attached PDF (`pdf_attached`, its name and its download path `pdf_url`) and text preview. Params: `invoice` (string, required), `group` (string).
- `invoices.add` — Add a receipt or invoice like the Add Invoice form: a one-time bill dated today, optionally with its PDF, which is stored on the invoice; also logs 'Invoice Added' in the feed. Params: `vendor` (string), `amount` (number, required), `currency` (USD|EUR|GBP|PKR|KRW|JPY|INR|CAD|AUD|AED|BRL|CHF|CNY|NZD|SAR|SEK|SGD|TRY), `category` (Cloud Infrastructure|Software & SaaS|Developer Tools & DevOps|Productivity & AI|Design & Creative|Marketing & Growth|Security & Compliance|Communications & Collaboration|Finance & Operations|Customer Support|Other Services), `purpose` (string), `invoice_number` (string), `pdf_filename` (string), `pdf_base64` (string), `group` (string).
- `invoices.delete` *(destructive)* — Delete an invoice or receipt; also logs 'Invoice Removed' in the feed. Params: `invoice` (string, required).

### dashboard

- `dashboard.overview` *(read-only)* — The Overview Dashboard for a workspace: total money spent, monthly subscription burn and annual run rate, active subscriptions, invoice count, this month's month-to-date, the spend summary bars (the six months up to this one), this month's spend by service & vendor, amounts left out for being in another currency (`other_currencies`), and the latest feed items. Params: `group` (string).

### subscriptions

- `subscriptions.list` *(read-only)* — The Active Subscriptions tab: subscriptions with the monthly burn and annual run rate, filtered like the screen (status, category, search over name, vendor, purpose, category, frequency and amount). Params: `group` (string), `status` (all|active|paused|cancelled), `category` (string), `q` (string).
- `subscriptions.add` — Add a recurring subscription like the Add Subscription form, with its billing frequency, next renewal date and auto-renew; also logs 'New Subscription' in the feed. Params: `name` (string, required), `vendor` (string), `amount` (number, required), `billing_frequency` (monthly|yearly|weekly|quarterly), `currency` (USD|EUR|GBP|PKR|KRW|JPY|INR|CAD|AUD|AED|BRL|CHF|CNY|NZD|SAR|SEK|SGD|TRY), `category` (Cloud Infrastructure|Software & SaaS|Developer Tools & DevOps|Productivity & AI|Design & Creative|Marketing & Growth|Security & Compliance|Communications & Collaboration|Finance & Operations|Customer Support|Other Services), `next_renewal_date` (string, YYYY-MM-DD), `purpose` (string), `auto_renew` (boolean), `group` (string).
- `subscriptions.set-status` — Pause or re-activate a subscription (the Pause / Activate buttons). Changes the status only; no feed row. Params: `subscription` (string, required), `status` (active|paused, required).
- `subscriptions.delete` *(destructive)* — Delete a subscription; also logs 'Subscription Removed' in the feed. Its invoices stay. Params: `subscription` (string, required).

### reports

- `reports.monthly` *(read-only)* — The Monthly Costs screen for one month: the months it lists, total, change vs the previous month, recurring vs one-time, transactions, average per bill, category and vendor breakdowns, and itemised rows (rows marked estimated are the app's own monthly figures for subscriptions without a bill that month). Params: `group` (string), `month` (string), `category` (string), `q` (string).
- `reports.monthly-csv` *(read-only)* — The Monthly Costs 'Download Report' CSV for one month: same layout as the app's file (UTF-8 with BOM), except that dates are ISO YYYY-MM-DD instead of the browser's locale format. Returns the file name and content. Params: `group` (string), `month` (string).
- `reports.yearly` *(read-only)* — The Multi-Year History screen: grand total, per-year totals, invoice counts, monthly average, top vendor, quarterly and category splits, and the statements list (rows marked estimated are the app's year-to-date subscription figures). The year figures are added up from those same statements. Params: `group` (string), `year` (string: this year or one of the three before it, or all), `category` (string), `q` (string).

### groups

- `groups.add` — Create a workspace like the Create New Workspace form: name, description, one of the six theme colors and a default currency. Params: `name` (string, required), `description` (string), `color` (#FF9900|#00A67E|#635BFF|#3B82F6|#8B5CF6|#EF4444), `currency` (USD|EUR|GBP|PKR|KRW|JPY|INR|CAD|AUD|AED|BRL|CHF|CNY|NZD|SAR|SEK|SGD|TRY).
- `groups.update` — Change a workspace's name, description, theme color or default currency (the Edit form and the header currency switch). Params: `group` (string, required), `name` (string), `description` (string), `color` (#FF9900|#00A67E|#635BFF|#3B82F6|#8B5CF6|#EF4444), `currency` (USD|EUR|GBP|PKR|KRW|JPY|INR|CAD|AUD|AED|BRL|CHF|CNY|NZD|SAR|SEK|SGD|TRY).
- `groups.delete` *(destructive)* — Delete a workspace (refused for the last one) together with its invoices (and their PDFs), subscriptions and feed rows, as the screen's confirmation says. Answers how many of each were deleted (`deleted_records`). Params: `group` (string, required).

### What each write stores

These are the screens' own values. Operations refuse a parameter the
screen's form never stores, rather than dropping it silently.

- **`invoices.add`** (the Add Invoice form):
  - **Currency:** the one given, else the workspace's currency (the newest workspace's with `--group all`), the one its totals use; the form opens on it.
  - **Fixed values:** `payment_type` one_time, `billing_frequency` none, `invoice_date` the current time, `line_items` [], `notes` empty, `confidence_score` 0.99, `is_verified` true, and the workspace's id.
  - **`invoice_number`:** the one given, else one taken from the PDF name (`INV-`, `REC-` or `BILL-` followed by letters or digits), else `INV-` and six digits of the clock.
  - **Without a PDF:** `has_pdf_attachment` false, `pdf_filename` `<vendor>_Receipt.pdf`, and preview text `RECEIPT / Vendor / Amount: $…`.
  - **With `pdf_filename` and `pdf_base64`** (the PDF file encoded as base64; pass `--pdf_base64 @file.b64` to read it from a file): the file is stored in `pdf_file` (PDF only, up to 25 MB), `has_pdf_attachment` true, the name, and the preview "PDF Invoice Statement extracted from <name> (<n> KB)". Bytes that are not a PDF are refused.
  - **Vendor from the PDF name:** when the vendor is empty, the name decides it: aws or amazon → Amazon Web Services, openai → OpenAI, cursor → Cursor AI, figma → Figma, vercel → Vercel, stripe → Stripe, google → Google Workspace.
  - **Refused:** `invoice_date`, `payment_type` and `billing_frequency`. The form always records a one-time bill dated today.
  - **Feed row:** "Invoice Added: <vendor>", "Recorded <currency> <amount> invoice #<number>."
- **`subscriptions.add`** (the Add Subscription form):
  - **Fixed values:** `status` active, `last_billed_date` now, `icon_name` CreditCard.
  - **From the form's fields:** `billing_frequency` (default monthly), `next_renewal_date` (a day, stored as ISO text at local midnight; default now + 30 days) and `auto_renew` (default true).
  - **Defaults:** `vendor` is the name when empty; `currency` is the workspace's, as for `invoices.add`.
  - **Validation:** the name must not be empty, and the amount must be 0 or more.
  - **Refused:** `status` (a new subscription is always active).
  - **Feed row:** "New Subscription: <name>", "Created recurring subscription of <currency> <amount>/<frequency>."
- **`subscriptions.set-status`** sets `status` only and writes no feed row. These are the Pause and Activate buttons.
- **Deletes:**
  - `invoices.delete` logs "Invoice Removed: <vendor>".
  - `subscriptions.delete` logs "Subscription Removed: <name>". Invoices linked to the subscription stay.
  - `groups.delete` logs nothing; it deletes the workspace's invoices, subscriptions and feed rows with it and reports how many (`deleted_records`).
- **`groups.add`:** the name and description are trimmed, the color defaults to #FF9900, the currency defaults to USD, and `icon` is Folder.
- **`groups.update`** changes only the fields given. The header's currency switch changes only `currency`.
- **Feed rows** store the `currency` of their record. A feed row that cannot be saved is skipped, as on screen: the record stays and `activity_id` is null.

### `invoices.simulate-bill`

This is what the feed's **Refresh Feed** button does, always with `--preset aws`.

**Presets:**

| Preset | Vendor | Amount (USD) | Category | Purpose |
|---|---|---|---|---|
| `aws` | Amazon Web Services | 248.50 | Cloud Infrastructure | Monthly AWS compute cluster & storage bill |
| `openai` | OpenAI | 42.00 | AI & Developer Tools (a category the forms do not offer) | ChatGPT Plus & GPT-4o API developer credit tier |
| `figma` | Figma | 15.00 | Design & Creative | Figma Pro design seat renewal |

**What it writes:**

- **An invoice** with `payment_type` subscription, monthly, dated now, a sample PDF name (no file is stored, so it shows no attached PDF) and preview text, verified at 0.99, one line item, and the note "Simulated automated scan ingestion.".
- **A subscription link.** The invoice is linked to the first subscription of the workspace whose vendor contains the preset's vendor (any workspace with `--group all`). If there is none, a new active monthly subscription is created in the workspace.
- **A feed row** "Simulated Bill: <vendor>".

All three are filed in the `--group` workspace (default: the one the app opens on; `all` files them under none), as the screen files them in the shown workspace. Its result holds `workspace`, `invoice` and `subscription_id`.

Never call it to "refresh" or "sync" anything: it creates data. To read the feed, use `data activities list`.

### Plain `data` calls that are enough

`a2app invoice-tracker data <collection> list|get <id> [--filter '…'] [--sort '…'] [--limit N]`:

- **Workspaces:** `data groups list --sort -created`. The first row is the default workspace. Resolve a name to an id here, or pass the exact name as `--group`. A name shared by two workspaces is refused as ambiguous.
- **The feed (Live Ingestion Feed):** use `data activities list --filter 'group_id="<id>"' --sort -created`. Drop the filter for All Workspaces. The tab shows every row of the workspace, newest first, ten per page. `dashboard.overview` returns the three latest as well.
- **Log Event (a feed row typed by hand):** `data activities create --event_type <invoice_detected|subscription_renewed|payment_processed|contract_updated|manual_audit> --title "…" --group_id <workspace id> [--vendor …] [--amount …] [--currency EUR] [--description …]`. This is the same single row the feed's Log Event form writes; use it only when the person asks to log an event.
- **Raw records:** `data invoices get <id>` and `data subscriptions list --filter '…'`.
- **Pausing or activating:** `data subscriptions update <id> --status paused` (or `active`) is the same write as `subscriptions.set-status`.

Do not create, update or delete invoices, subscriptions or workspaces through
`data`:
- creating or deleting that way skips the feed row and the screens' defaults;
- `data groups delete` skips the last-workspace guard (and, like every workspace delete, deletes the workspace's records);
- any update other than a subscription's `status` does something no screen can do. No screen edits an invoice or a subscription.

### Recipes

- **Record a receipt:**
  1. `a2app invoice-tracker invoices invoices.add --vendor "Supabase" --amount 25.50 --currency USD --category "Developer Tools & DevOps" --purpose "Database" [--group <id or name>]`.
  2. Read back the returned `invoice`.
  3. If the PDF is at hand, encode it (`base64 -w0 invoice.pdf > invoice.b64`) and add `--pdf_filename invoice.pdf --pdf_base64 @invoice.b64`. The file is stored on the invoice; `invoices.get` then returns `pdf_url`, the app path that downloads it.
  4. A PDF for an invoice that already exists is attached by the person (Attach PDF in the ledger or the inspector); no operation does that yet.
- **Add a recurring cost:** `a2app invoice-tracker subscriptions subscriptions.add --name "Vercel Pro" --amount 20 --category "Cloud Infrastructure"`.
  - Add `--billing_frequency yearly|weekly|quarterly` for a cost that is not monthly (enter the amount per period, not converted), `--next_renewal_date 2027-01-15`, and `--auto_renew false` for one that must be renewed by hand.
- **Pause or resume:** `subscriptions subscriptions.set-status --subscription <id> --status paused` (or `active`).
- **Remove something:** `invoices invoices.delete --invoice <id>`, or `subscriptions subscriptions.delete --subscription <id>`. Each answers `approval_required`; repeat it with `--approve <key>` after the person agrees.
- **Correct a wrong invoice or subscription:** no screen edits them. Tell the person, and offer to delete the record and add a corrected one. That writes two feed rows, as it would for the person.
- **"How much are we spending?":**
  - `dashboard dashboard.overview --group all`, or a named workspace;
  - `subscriptions subscriptions.list` for the monthly burn;
  - `reports reports.monthly --month YYYY-MM` for one month;
  - `reports reports.yearly` for the years.
  Quote the app's own figures and labels (§ Conventions, Numbers).
- **Monthly report file:** `reports reports.monthly-csv --month 2026-08`. Write `content` to `filename` exactly as returned. It starts with a byte-order mark.
- **An invoice's PDF:** `invoices invoices.get --invoice <id>` gives `pdf_attached` and `pdf_url` (`/api/invoices/<id>/download-pdf` on the app's address). Give the person that link, or fetch it over HTTP on the same machine.
- **Workspaces:**
  - create one with `groups groups.add --name "Marketing" --color "#635BFF" --currency EUR`;
  - rename it, or change its color or currency, with `groups groups.update --group <id or name> …`;
  - delete it with `groups groups.delete --group <id or name>`, which is destructive. Tell the person it deletes the workspace's invoices, subscriptions and feed rows too.

### Work the app asks for

None. `events.json` declares no capabilities and no screen fires an agent
request.

### Notes

16 operations in `operations.json` (`a2app <app>`):

- `invoices.simulate-bill|list|get|add|delete`;
- `dashboard.overview`;
- `subscriptions.list|add|set-status|delete`;
- `reports.monthly|monthly-csv|yearly`;
- `groups.add|update|delete`.

**Where the code is:**

- `invoices.simulate-bill` is the screens' route in `pb/pb_hooks/ops.pb.js`.
- The other 15 are routed in `pb/pb_hooks/agent_ops.pb.js` (GET for reads, POST for writes, at `/api/ops/<group>/<verb>`). Their logic, and simulate-bill's, is in `pb/pb_hooks/lib_agent.js`, which is required inside each handler.
- `pb/pb_hooks/records.pb.js` holds the PDF download route (`GET /api/invoices/<id>/download-pdf`) and the hook that deletes a workspace's records with it.
- `pb/pb_hooks/a2app_routes.pb.js` (generated) serves all 16 to agents as `POST /api/ops/<name>`.

## Conventions

### Rules

- **Workspace scope (`group`).**
  - Every operation except the `groups.*` writes takes `--group`: a workspace id, its exact name, or `all` (also accepted: `All Workspaces`).
  - Leave it out, and the operation uses the workspace the app opens on. That is the newest workspace, the first row of `data groups list --sort -created`. So creating a workspace changes the default.
  - **Reads:** `all` means no workspace filter, the screens' "All Workspaces".
  - **Writes:** `all` stores no workspace (`group_id` empty), which is what a screen does when "All Workspaces" is shown. Such a record appears only under `all`.
  - The read operations, `invoices.add` and `subscriptions.add` answer with `workspace` (`id`, `name`, `currency`, `currency_symbol`): say which workspace you read or wrote.
  - An unknown workspace answers 404. A name shared by two workspaces answers 400.
- **Amounts and currencies.**
  - Amounts are plain numbers in major units. The screens show them with two decimals.
  - A record has its own currency code, one of 18: USD, EUR, GBP, PKR, KRW, JPY, INR, CAD, AUD, AED, BRL, CHF, CNY, NZD, SAR, SEK, SGD, TRY. The screens show a record's amount with its own symbol.
  - Totals add only the amounts in the shown workspace's currency (`workspace.currency`, symbol `workspace.currency_symbol`; under All Workspaces, the newest workspace's). The app has no exchange rates: amounts in other currencies are left out and listed per currency in `other_currencies` (`{currency, total, count}`), as the screens name them under their totals.
  - Report figures the same way: quote the total in the workspace's currency and the `other_currencies` beside it. Never convert currencies on your own.
- **Categories.**
  - The forms offer 11 categories: Cloud Infrastructure, Software & SaaS, Developer Tools & DevOps, Productivity & AI, Design & Creative, Marketing & Growth, Security & Compliance, Communications & Collaboration, Finance & Operations, Customer Support, Other Services.
  - Stored data can hold others, for example AI & Developer Tools from the openai simulation.
  - The `category` filters of the list operations take any exact name.
- **Numbers.** These are the screens' formulas, kept as they are.
  - **Monthly burn:** active subscriptions only. yearly ÷ 12, weekly × 4.33, quarterly ÷ 3, monthly as is. The annual run rate is the burn × 12.
  - **Total Money Spent:** every invoice in scope, plus, for each active subscription that no invoice covers, its amount once (yearly and quarterly count their full amount, weekly × 4.33).
    - An invoice covers a subscription when it carries that `subscription_id`.
    - It also covers it when its vendor equals the subscription's vendor (ignoring case) and it is a subscription payment.
  - **Spend Summary:** one bar per month for the six months up to the current one; each is that month's Monthly Costs total. The month-to-date is the current month's bar.
  - **Spend by Service & Vendor:** the current month's Monthly Costs rows per vendor (invoices dated in the month plus the estimated rows of uncovered active subscriptions). Each percent is of the sum of that table.
  - **Multi-Year History:** each year's total, quarters and categories are added up from that year's statements (invoices plus year-to-date estimates); the invoice counts count real invoices only.
- **Dates.**
  - Stored dates are ISO 8601 text.
  - The calendar follows today's date: Monthly Costs lists the six months up to the current one plus every month with an invoice, and Multi-Year History covers this year and the three before it.
  - Months and years in the reports are taken from each invoice's `invoice_date` (or `created` when empty), in the server's local time. The screens use the browser's, which is the same machine in normal use.
  - `month` is `YYYY-MM`, and only the months Monthly Costs lists are accepted. The answer lists them.
  - `year` is this year or one of the three before it (for example 2026), or `all`.
  - The CSV report writes dates as ISO `YYYY-MM-DD` and its "Generated:" line as `YYYY-MM-DD HH:MM:SS`. The screen's file uses the browser's locale format instead.
- **Estimated rows.** Monthly Costs and Multi-Year History add rows for active subscriptions that have no bill in that month or year. They are marked `estimated: true` with numbers `SUB-…`. They are the app's own estimates, not stored records, so `invoices.get` cannot open them.

### Freshness (what the person sees)

- **Open screens refresh every 10 seconds.** There is no live push. An agent's change shows up on the person's screen within about 10 s, without a toast: toasts appear only for the person's own actions.
- **The person's view state is in their browser only.** That includes the workspace they picked, the tab, filters, search, the selected month or year, and pagination. An agent cannot read or change it.
  - What they see may be another workspace than the operations' default.
  - When you report numbers, name the workspace you read.

### Known app behaviour (agents must know)

The operations reproduce these exactly. Do not work around them by writing collections directly; tell the person instead.

1. **No operation attaches a PDF to an invoice that already exists.** `invoices.add` stores a PDF given with the new invoice; for an existing one, the person uses Attach PDF in the ledger or the inspector.
2. **The email-sync screen is not shown anywhere.** It would need a mailbox connection the app does not have. No operation offers it; Refresh Feed and `invoices.simulate-bill` only simulate sample bills.
3. **The "Cancelled" status filter always shows nothing,** because a subscription is only ever active or paused.
4. **Invoice amounts may be negative,** because the form sets no minimum, and a subscription can be added with amount 0.

### Gotchas

- **Restart after hook changes.** Hooks do not hot-reload (`--hooksWatch=false`), so restart the app after any change to `pb/pb_hooks`.
- **Copied lists and formulas.** `lib_agent.js` holds copies of the frontend's currency list, categories, color presets, the PDF vendor hints, and the calendar, month and year models and currency rule of `frontend/src/app/services/reports.ts`, because the frontend cannot be imported. Change both together.
- **`created` dates.** PocketBase writes `created` as `2026-08-15 12:00:00.000Z` (with a space). `lib_agent.js` normalises it before parsing.
- **Copy query results first.** Never sort or reverse a query result in place: copy it with `Array.from()`.
- **Keep require() out of loops.** It costs about 1.6 ms per call.

### Ownership map

- **System-owned (hash-locked, from the `blueprint-pocketbase-kit` toolkit — never edit):** `manifest.json`, `pb-serve.mjs`, `pb-fetch.mjs`, `pb-check.mjs`, `pb-build.mjs`, `pb/pb_hooks/_a2app.pb.js`, `pb/pb_hooks/_a2app_impl.js`, `pb/pb_hooks/_a2app_rules.js`, `pb/pb_hooks/_compat_lib.js`, `pb/pb_hooks/_compat_rules.js`, `pb/pb_hooks/_compat_system.js`, `pb/pb_hooks/_system.pb.js`, `pb/pb_hooks/_triggers.pb.js`, `pb/pb_hooks/_triggers_lib.js`, `pb/pb_hooks/_craftbot_bridge.js`.
- **Agent-owned:** `operations.json`, `events.json`, `AGENT_APP.md`, `reference/`, `pb/pb_hooks/a2app_routes.pb.js` (regenerate with `tools/agent-app-migrate` rather than hand-edit), every other file under `pb/pb_hooks/` and `pb/pb_migrations/`, and `frontend/`.

## Checklist

Build and verification tasks live in `reference/tasks.md`.

See `reference/requirements.md` (binding). Feature checklist:

- [x] Workspaces: create, edit (name, description, color, currency), switch (header dropdown or Groups), delete with its records (never the last one); currency quick-switch in the header
- [x] Overview Dashboard: four KPI cards, Spend Summary bars (six months up to the current one) with segment tooltips and Grow/Shrink, Spend by Service & Vendor donut and table, latest feed items
- [x] Active Subscriptions: cards with search, status and category filters, monthly burn and annual run rate, Pause / Activate, Delete
- [x] Add Subscription form (billing frequency, next renewal date and auto-renew stored)
- [x] Invoices & Receipts ledger: search, category and payment-type filters, filtered total, Attach PDF / download, Inspect, Delete with confirmation
- [x] Add Invoice form with an optional PDF (stored on the invoice) that fills vendor and invoice number
- [x] Invoice inspector: details, verified %, text preview, Download PDF or Attach PDF File, Delete
- [x] Live Ingestion Feed with Refresh Feed (simulates an AWS bill in the shown workspace) and Log Event
- [x] Monthly Costs: month pills, totals, change vs previous month, recurring and one-time shares, breakdowns, itemised rows, CSV report
- [x] Multi-Year History: year cards, trajectory bars, quarterly and category split, statements list (one calculation)
- [x] Totals in the workspace's currency, with other currencies named apart
- [x] Every UI action an agent may take has a CLI operation (or an equivalent plain `data` call)
