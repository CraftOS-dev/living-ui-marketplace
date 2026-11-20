# Tasks: Invoice & Subscription Tracker

Every task cites what it implements. These features already exist in the published app `invoice-tracker` 1.0.0, so the build tasks are recorded as done. The agent operations were added on 2026-11-11 without changing the View.

## Build
- [x] T-1 (F-FRM-1, F-FRM-2): page frame (`components/MainView.tsx`). The 1,280 px column holds the header and the six tabs. The header has the title, the workspace dropdown with its color dot, the currency quick-switch, Groups, + Subscription and Add Invoice. The Active Subscriptions and Invoices & Receipts tabs carry their counts.
- [x] T-2 (F-FRM-3, F-FRM-4): start-up in `AppController.initialize`. It shows the loading spinner and opens on the newest workspace (groups sorted `-created`). Amounts carry the shown workspace's currency symbol (`getCurrencySymbol`, `types.ts`).
- [x] T-3 (F-FRM-5, F-FRM-6): the 10-second refresh of every collection (`AppController.startPolling` / `refreshData`), plus success and error toasts on every write.
- [x] T-4 (F-GRP-1, F-GRP-2, F-GRP-3): Manage & Edit Workspaces with the workspace list, the ACTIVE mark and Select (`GroupManageModal.tsx`), and the header dropdown, which switches to the picked workspace.
- [x] T-5 (F-GRP-4, F-GRP-5, F-GRP-6, F-GRP-7): create and edit a workspace (name, description, six preset colors, currency; icon Folder), the header currency switch, and delete with the last-workspace alert (`ApiService.createGroup`, `updateGroup`, `deleteGroup`). Deleting also deletes the workspace's invoices, subscriptions and feed rows (`pb/pb_hooks/records.pb.js`).
- [x] T-6 (F-DSH-1, F-DSH-2, F-DSH-3): the four KPI cards, which link to their tabs, with the total-spent and monthly-burn formulas (`DashboardView.tsx`, `ApiService.computeDashboardStatsFromData`).
- [x] T-7 (F-DSH-4, F-DSH-5): Spend Summary (the six months up to the current one as stacked bars from the Monthly Costs model, auto-scaled axis, segment tooltips, Grow/Shrink, Cost Explorer) and Spend by Service & Vendor (donut and share table, Bill Details).
- [x] T-8 (F-DSH-6): the dashboard's three latest feed items with "Open Full Feed (<n>)". The indicator pulses for 4 s after an add.
- [x] T-9 (F-SUB-1, F-SUB-2, F-SUB-3): Active Subscriptions cards, twelve per page, with the /MO BURN badge and annual run rate, search, and the status and category filters (`SubscriptionsView.tsx`).
- [x] T-10 (F-SUB-4): the Add Recurring Subscription form (`AddSubscriptionModal.tsx` → `AppController.createManualSubscription` → `ApiService.createSubscription`). It saves the subscription active with the chosen billing frequency, next renewal date (30 days from now by default) and auto-renew, and logs "New Subscription".
- [x] T-11 (F-SUB-5, F-SUB-6): Pause and Activate (status only, no feed row), and Delete without a confirmation, which logs "Subscription Removed".
- [x] T-12 (F-INV-1, F-INV-2): the Invoices & Receipts ledger, twelve rows per page, with search, category and payment-type filters and the filtered total (`InvoicesLedgerView.tsx`).
- [x] T-13 (F-INV-3, F-INV-4): the Add Receipt or Invoice form (`AddInvoiceModal.tsx` → `ApiService.createInvoice`):
  - it saves a one-time bill dated now with the INV- number default, and logs "Invoice Added";
  - a picked PDF fills the vendor and the number, and is stored on the invoice (`pdf_file`) with its name and preview text.
- [x] T-14 (F-INV-5, F-INV-6): the invoice inspector with verified %, the purpose fallback, the reference id and View Text Preview (`InvoiceDetailModal.tsx`). "Download PDF" serves the stored file (`GET /api/invoices/<id>/download-pdf`), and "Attach PDF" in the ledger and the inspector stores a picked PDF on the invoice.
- [x] T-15 (F-INV-7): delete from the ledger or the inspector after the browser confirmation, logging "Invoice Removed" (`ApiService.deleteInvoice`).
- [x] T-16 (F-FED-1, F-FED-2): the Live Ingestion Feed, ten rows per page (`ActivityFeedView.tsx`). Refresh Feed runs the AWS preset of `POST /api/ops/invoices/simulate-bill` (`pb/pb_hooks/ops.pb.js`) in the shown workspace, and Log Event opens the ingestion-event dialog.
- [x] T-17 (F-MON-1, F-MON-2, F-MON-3): the Monthly Cost Explorer month model (`services/reports.ts`, shown by `MonthlyCostsView.tsx`):
  - the six months up to the current one plus the months that have invoices;
  - totals, the change against the previous month, and the recurring and one-time shares;
  - estimated subscription rows.
- [x] T-18 (F-MON-4, F-MON-5, F-MON-6): Category Spend and Top Vendors, the itemised list with search and category filter, and "Download Report" (CSV with BOM).
- [x] T-19 (F-YR-1, F-YR-2, F-YR-3): Annual Spending History: the four cards, the year selector and Year-over-Year Spend Trajectory, with year totals added up from the statements (`services/reports.ts` `buildYearly`, shown by `YearlyHistoryView.tsx`).
- [x] T-20 (F-YR-4, F-YR-5): a chosen year's Quarterly Distribution and Spend by Category, and the statements list with its year-to-date subscription rows, search, category filter and ten per page.
- [x] T-21 (F-AGT-1, F-AGT-2, F-AGT-4): 15 agent operations:
  - routed in `pb/pb_hooks/agent_ops.pb.js` (GET reads, POST writes), with logic in `pb/pb_hooks/lib_agent.js` copying the View's formulas;
  - the `group` scope defaults to the newest workspace and accepts an id, an exact name or `all`;
  - all 16 operations are declared in `operations.json` and served to agents by the generated `a2app_routes.pb.js`.
- [x] T-22 (F-AGT-3, F-AGT-5): the agent writes store exactly what the forms store, with the same feed rows, and refuse parameters the forms never store. Workspace writes keep the form rules: preset colors, the currency list, a name that is not empty, and never the last workspace.
- [x] T-23 (F-AGT-6, F-AGT-7): `invoices.simulate-bill` declared for agents (presets aws, openai, figma), and `reports.monthly-csv`, which returns the Download Report file with ISO `YYYY-MM-DD` dates.
- [x] T-24 (F-AGT-8): `invoices.delete`, `subscriptions.delete` and `groups.delete` are declared destructive, so the adapter asks for the person's approval.
- [x] T-25 (F-AGT-2, F-AGT-3): the agent operations were checked live on PocketBase 0.39.7 against the View's own code. The bundled `ApiService.ts` and the screens' formula blocks were run on the same data, and the form payloads were written through `ApiService`. The run passed 2,941 checks with 0 failures (2026-11-11).
- [x] T-26 (F-SUB-4, F-INV-4, F-INV-6, F-GRP-3, F-GRP-7, F-FED-1, F-FED-2, F-DSH-4, F-DSH-5, F-MON-1, F-YR-3, F-INV-2, F-FRM-4, F-AGT-3, F-AGT-6): the defect fixes of 2026-11-11 (requirements ## Changes) in the View, `lib_agent.js`, `records.pb.js` and the migration `1700000002_invoice_pdf_file.js`, checked live through the screens (Playwright) and through the agent operations.

## Verification
- [x] Framework-files check (`validateFrameworkFiles` of the Agent App CLI) reports no problems for manifest.json, operations.json, AGENT_APP.md, reference/requirements.md and reference/tasks.md.
- [x] ## Operations Design in reference/requirements.md lists exactly the 16 operations of operations.json, each under its declared module.
- [ ] Agent App Framework gate (`agent-app <dir> validate`) passes, including the describe budget on a dev instance.
- [ ] Every declared operation answers through `a2app` on a live instance.
- [ ] The View renders identically to the published build (screenshot comparison).
