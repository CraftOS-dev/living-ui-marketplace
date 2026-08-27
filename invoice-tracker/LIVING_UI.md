# Invoice & Subscription Tracker (Living UI V2)

A production-grade, multi-workspace financial tracker for recurring SaaS subscriptions, one-time receipts, and invoice documents built with Living UI V2, PocketBase backend, and React 19 + Tailwind CSS.

---

## Capabilities & Architecture

- **Workspace Groups**: Multi-workspace organization (Engineering & Cloud Stack, AI Tools, Operations, etc.) with custom colors, icons, and currency definitions.
- **Overview Dashboard**:
  - Top KPI cards: Total Money Spent (strictly YTD elapsed spend across invoices & subscriptions, totaling $1,526.00), Monthly Subscription Burn ($838.00/mo), Active Subscriptions (2), Total Invoices (5).
  - Spend Summary interactive month-by-month chart (March through August 2026) with auto-scaling dynamic Y-axis and hover breakdown tooltips.
  - Spend by Service & Vendor donut breakdown chart with distinct palette indicators.
  - Live Ingestion Feed with real-time bill ingestion updates.
- **Active Subscriptions**:
  - Full subscription ledger with status toggling (`active` ↔ `paused`), frequency selection (`monthly`, `yearly`, `weekly`, `quarterly`), renewal countdowns, and quick actions.
  - "Add Subscription" modal with all canonical categories.
- **Invoices & Receipts Ledger**:
  - Searchable and category-filterable table with itemized previews, PDF attachments, and automated confidence scoring.
  - Detail Inspection modal with itemized line items and simulated invoice document view.
- **Monthly Costs Explorer**:
  - Historical monthly ledger and category breakdowns.
  - "Download Report" button generating clean UTF-8 CSV reports with BOM.
- **Multi-Year History**:
  - Multi-year financial comparison (2026, 2025, 2024, 2023) with strictly YTD subscription calculation and quarterly spend maps.

---

## PocketBase Schema (`pb/pb_migrations/`)

1. **`groups`**: Workspace groups (`name`, `description`, `color`, `icon`, `currency`).
2. **`subscriptions`**: Recurring subscriptions (`name`, `vendor`, `amount`, `currency`, `billing_frequency`, `category`, `purpose`, `status`, `group_id`, `last_billed_date`, `next_renewal_date`, `auto_renew`, `icon_name`).
3. **`invoices`**: One-time & recurring invoices (`vendor`, `amount`, `currency`, `payment_type`, `billing_frequency`, `category`, `purpose`, `invoice_date`, `invoice_number`, `group_id`, `has_pdf_attachment`, `pdf_filename`, `pdf_text_preview`, `pdf_data_base64`, `line_items`, `notes`, `subscription_id`, `confidence_score`, `is_verified`).
4. **`activities`**: Event stream (`event_type`, `title`, `description`, `amount`, `currency`, `vendor`, `group_id`).

---

## Agent Operations (`operations.json`)

- `invoices.simulate-bill`: Simulate incoming email bill (AWS, OpenAI, Figma).
- `health`: PocketBase liveness check.
- `ops.list`: Discoverable agent verbs list.
