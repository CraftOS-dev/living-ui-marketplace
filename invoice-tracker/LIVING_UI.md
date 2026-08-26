# Living UI Specification: Multi-Group Invoice & Subscription Tracker

An interactive Multi-Group Workspace Living UI for tracking expenses, recurring subscriptions, and invoices across customizable groups (e.g. Engineering & Cloud Stack, AI Tools, Marketing & Operations) with full manual input, customizable line items, receipt attachment inspection, and multi-year financial history.

---

## 1. Core Architectural Concepts

- **Workspace Groups (`TrackerGroup`)**: Isolate and organize finances into distinct projects/departments (e.g., Engineering & Cloud Stack, AI & Dev Tools, Marketing & Operations).
- **Direct User-Input Modals**:
  - **Add Invoice**: Record vendor, amount, category, invoice number, date, line items with automatic total calculation, notes, and receipt file attachment previews.
  - **Add Subscription**: Record recurring subscriptions with billing frequency (monthly, yearly, weekly, quarterly), renewal date, category, and purpose.
  - **Group Management**: Create custom workspace groups with colored tags, currency, and starter templates.
- **Dynamic 10-Item Pagination**: Page through Subscriptions, Invoices Ledger, Multi-Year History, and Activity Audit Stream with Next / Previous controls.
- **Isolated Metrics**: Total spend, MRR run-rate, active subscriptions, category breakdowns, and yearly history calculate dynamically per active workspace group.

---

## 2. Data Models (SQLite / SQLAlchemy)

| Entity | Description | Key Attributes |
| :--- | :--- | :--- |
| `TrackerGroup` | Workspace group isolation entity | `id`, `name`, `description`, `color`, `icon`, `currency`, `created_at`, `updated_at` |
| `InvoiceReceipt` | Invoice or receipt record | `vendor`, `amount`, `currency`, `payment_type`, `billing_frequency`, `category`, `purpose`, `invoice_date`, `invoice_number`, `group_id`, `has_pdf_attachment`, `pdf_filename`, `pdf_text_preview`, `line_items`, `notes` |
| `Subscription` | Recurring software or cloud seat | `name`, `vendor`, `amount`, `currency`, `billing_frequency`, `category`, `purpose`, `status`, `group_id`, `last_billed_date`, `next_renewal_date`, `auto_renew`, `icon_name` |
| `ActivityLog` | Audit log of workspace events | `event_type`, `title`, `description`, `amount`, `currency`, `vendor`, `group_id`, `created_at` |

---

## 3. REST API Endpoints

| Method | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/groups` | List all workspace groups with spend & count summaries |
| `POST` | `/api/groups` | Create a new workspace group |
| `PUT` | `/api/groups/{id}` | Update workspace group details |
| `DELETE` | `/api/groups/{id}` | Delete a workspace group and its associated records |
| `GET` | `/api/dashboard/stats` | Group-scoped financial summary, category breakdowns, and MRR |
| `GET` | `/api/invoices` | List group-scoped filterable invoices and receipts |
| `POST` | `/api/invoices` | Directly create a manual invoice / receipt |
| `PUT` | `/api/invoices/{id}` | Update an existing invoice |
| `DELETE` | `/api/invoices/{id}` | Delete an invoice |
| `GET` | `/api/subscriptions` | List recurring subscriptions for active group |
| `POST` | `/api/subscriptions` | Directly add a recurring subscription |
| `PATCH` | `/api/subscriptions/{id}` | Update subscription status or attributes |
| `DELETE` | `/api/subscriptions/{id}` | Delete a subscription |
| `GET` | `/api/yearly-history` | Multi-year historical totals and quarterly breakdowns |
| `GET` | `/api/activity` | Workspace activity audit stream |
