# ERP: requirements

A general-purpose ERP for one company of 1 to 5,000 people: sales,
purchasing, stock, manufacturing, accounting, banking, people, payroll and
projects in one app with one database. Easy on the surface (each person sees
only what their role and the switched-on modules need; the next step is
always one obvious button), with the advanced depth one click away. Your AI
agent operates it through the same operations the screens use and hands work
back for approval. No emoji anywhere: line icons only.

Visual language: the Expenses tracker family. A warm canvas holding one app
shell with large rounded corners; white, sand and one dark card per page;
dark primary pills with an accent dot; generous radii, no card borders;
Manrope; one type scale of 12, 13, 14, 15 and 26 px on a 4 px grid; pointer
cursor on everything clickable. Every color comes from the host's theme
tokens with contrast checks in every pack, light and dark; only the state
colors (green good, amber attention, red bad) are fixed and always come with
a label. Business screens get an in-family data list: rows in a white card,
right-aligned tabular numbers, status pills, no grid lines. The app names no
particular AI agent: it says "your AI agent". Numbers read "1,234.50"
whatever the browser language. Every page works down to 320 px wide. No
on-screen instruction text stands in for an affordance. No opacity fades on
rows or cards.

## Foundations

1. One company, one base currency chosen at setup. Documents and payments may
   be in other currencies with their own exchange rate; every ledger amount
   is also kept in the base currency.
2. Money is an integer of the currency's minor unit (cents); unit prices and
   costs are integers of ten-thousandths; tax rates are basis points (600 is
   6%); quantities have at most 3 decimals. Money text is parsed exactly,
   never through floats. Days are `YYYY-MM-DD`.
3. Double-entry ledger: every posted business event writes one balanced
   journal entry (debits equal credits in base currency). Journal entries are
   never edited or deleted; a correction is a reversal entry. Posted
   documents are voided (which reverses them), never deleted. Drafts may be
   deleted.
4. Lock dates: a soft lock (only people with full Accounting rights may post
   on or before it) and a hard lock (nobody may). Closing a month sets the
   soft lock.
5. Stock is a ledger of moves; balances per item and warehouse are written in
   the same transaction. Valuation is moving average per item across all
   warehouses: the item's quantity and value are running totals, so the
   ledger's inventory balance always equals the stock valuation. Stock cannot
   go below zero unless a setting allows it.
6. Numbers: invoices, credit notes, bills, supplier credits, payments and
   journal entries are numbered when posted from gapless series; quotes,
   orders, deliveries, goods receipts and the rest are numbered when created.
   Prefixes are settings.
7. Every write records who did it: a person (by name) or your AI agent, in
   an append-only audit trail with the record, a summary and the data.
8. Every action in the app is an operation the AI agent can call with the
   `agent-app` CLI (string parameters, names or numbers instead of ids);
   `app.guide` explains the conventions and recipes.

## People, sign-in and rights

9. App accounts: email and password (passwords hashed by the platform's
   auth collection). The first open runs setup: company, country preset,
   currency, fiscal year, business type and the owner's account.
10. Members are invited by an administrator: an invite code (shown once,
    valid 7 days) lets the person set their password. Administrators can
    disable members, change their role, issue a new code (password reset)
    and sign a member out everywhere. Ten wrong passwords lock the account
    for 15 minutes.
11. Roles grant a level per module (none, view, edit, full) and an
    administration right. Full means posting, voiding, approving and money.
    Built-in roles: Owner, Administrator, Accountant, Sales, Purchasing,
    Warehouse, HR, Manager, Employee (self-service only), Viewer; custom
    roles may be added. The Owner role cannot be changed and one active
    owner always remains.
12. Everyone has self-service: their own leave, expense claims, timesheets,
    payslips and profile. Managers see and approve their team's requests.
13. Your AI agent is its own actor: it may read everything and draft
    anything, but posting, voiding and money become proposals a person with
    the right approves (optionally, named low-risk kinds post on their own
    under an amount ceiling; money never does). It can never manage members,
    roles or lock dates.

## Frame

14. A sidebar in the family style: the app mark, a search box that opens the
    command palette (Ctrl+K: pages, records, actions), "Needs you" with a
    count, then the switched-on modules as rows that expand like a tree to
    their pages, each module row with an inline "+" for its main new
    document. It collapses to an icon rail; on phones a floating bottom bar
    with Home, Needs you, a raised "+", Search and a menu.
15. The "+" opens a full-screen "Create" sheet (circular reveal) with tiles
    for what this person may create, most used first.
16. Modules can be switched on and off in Settings (business type presets
    pick them at setup): Sales, Purchasing, Inventory, Manufacturing,
    Accounting, Banking, People, Payroll, Projects. Hidden modules vanish
    from the frame, Home and the palette.

## Home

17. Greeting, date, search and the "+ New" pill. A "Needs you" strip with
    approvals, proposals from your AI agent and exceptions.
18. Role-shaped cards: cash (dark card with bank balances and a 30-day cash
    line), money owed to you and by you (aging rings), sales this month
    against last (bars), profit this month, overdue invoices and bills due
    soon, orders to deliver and receive, low stock, projects at risk; for
    everyone: my leave balance ring, my claims, my week of time, holidays.
19. Your AI agent card: what it did today, proposals waiting, and an "Ask
    your AI agent" box whose answers come back into the app.
20. Until the company is set up: a setup checklist (company details, bank
    accounts, customers and suppliers, items, opening balances, members).

## Documents (sales and purchasing)

21. Sales: quotes, sales orders, deliveries, invoices, credit notes and
    customer payments. Purchasing: purchase orders, goods receipts, bills,
    supplier credits and supplier payments. One document engine for all of
    them: party, dates, currency and rate, prices with or without tax,
    lines (item or free text, quantity, unit price, discount %, tax, account),
    totals, notes, attachments, activity.
22. Flows: quote to order or invoice; order to delivery and invoice (or one
    invoice that also delivers); purchase order to goods receipt and bill (or
    one bill that also receives); invoice to credit note; any invoice or bill
    to a payment. Every converted document links to where it came from, and a
    document shows its flow as a chain. Order status follows from what was
    delivered and invoiced (or received and billed); invoice status follows
    from payments and the due date (draft, unpaid, partly paid, paid,
    overdue, void).
23. A new document opens as a full screen of three numbered steps: who (party
    search with recent tiles and quick create), what (a line editor with item
    search, keyboard flow, live totals), when and save (dates, terms, notes;
    Save draft or Post). The document page shows the next step as its one
    primary button and the rest in a menu.
24. Posting writes the journal entry and stock moves in one transaction:
    invoices (receivable, income per line, tax payable, and cost of goods
    when it delivers), credit notes (the reverse), deliveries (cost of goods
    against inventory at average cost), goods receipts (inventory against
    goods received not invoiced at the order price), bills (payable, tax
    receivable, expense or inventory per line; against receipts it clears
    goods received not invoiced and puts any price difference to purchase
    price variance), supplier credits (the reverse). Voiding reverses both.
25. Payments in and out: bank account, amount, currency, method, reference;
    allocated to open invoices or bills of the same party and currency
    (oldest first by default, editable); what is not allocated stays as
    credit on the party. Credit notes and supplier credits allocate to
    invoices and bills the same way. Exchange differences between the
    document's and the payment's rate post to the exchange gain or loss
    account on allocation.
26. Customers and suppliers are one directory of parties (a party can be
    both): contacts, addresses, tax id, payment terms, currency, credit
    limit; a party page with what is owed both ways, aging, documents,
    statement, and activity.

## Inventory and manufacturing

27. Items: stock items, services and non-stock goods; SKU, barcode,
    category with line icon, unit, sale and purchase prices and taxes,
    income and expense accounts, reorder point, target level, preferred
    supplier, lead time, photo. Item page: on hand per warehouse, value,
    incoming and committed, history, documents.
28. Warehouses; stock levels and valuation per warehouse; the moves history;
    stock changes (adjust in, adjust out, set counted quantity, transfer
    between warehouses) as one numbered action with its journal entry.
29. Reorder suggestions from the reorder point, target, on hand, incoming and
    committed quantities, grouped by supplier, turning into draft purchase
    orders in one step (or by your AI agent).
30. Bills of materials and builds: building consumes components at average
    cost and adds the finished item at their cost plus labor and overhead.

## Accounting and banking

31. Chart of accounts (types: asset, liability, equity, income, expense, with
    subtypes) from a template at setup; control accounts (receivable,
    payable, inventory, goods received not invoiced, taxes) only take
    postings from their documents. Account page: balance and the ledger with
    running balance, drilling to the source.
32. Manual journal entries (balanced, with optional party, department and
    project on each line); reversal.
33. Opening balances: accounts, open invoices and bills, and stock as at a
    cut-over date, against opening balance equity.
34. Taxes as data (name, rate, sales or purchase, account), country presets;
    payment terms; currencies with rates.
35. Banks: each bank or cash account with its statement lines (CSV import
    with column detection and preview, duplicate skipping, undo); reconcile
    by matching a line to a payment or entry (suggested by amount, date and
    exact references), creating a payment, a transfer or an expense from a
    line, or ignoring it; your AI agent can propose matches.
36. Close the books: per month, a checklist computed from the data (drafts
    left, unreconciled lines, goods received not invoiced, unposted claims,
    the trial balance check) and closing sets the soft lock.
37. Fixed assets with straight-line depreciation posted monthly; budgets per
    account and month.

## Reports

38. Profit and loss, balance sheet (with current year earnings computed, no
    closing entry), cash flow, trial balance, general ledger, receivables and
    payables aging, sales by customer and by item, purchases by supplier,
    stock valuation, tax summary, budget against actual, project
    profitability, payroll summary. Each with period presets, comparison,
    a chart, drill-down to entries and documents, CSV export and print.

## People and payroll

39. Employees (directory with avatars, org chart, departments, job, manager,
    contract type, start and end, pay), leave types with yearly days,
    holidays, leave requests with working-day counting and balances,
    approval by the manager or HR; expense claims with lines and receipts,
    approval, posting and reimbursement.
40. Payroll as data: pay components (earnings, deductions, employer
    contributions; fixed or a percent of basic pay, each with its account);
    a pay run computes payslips for a month, people may adjust lines, then it
    is approved, posted and paid. No statutory calculations are built in.

## Projects

41. Projects with customer, manager, budget, billing type (fixed, time and
    materials, non-billable) and status; tasks on a board; weekly timesheets
    (a grid of projects by days); approval; billing approved billable time
    to an invoice; profitability from invoices, costs and time.

## Your AI agent

42. Every screen action has an operation. The app hands work back through
    triggers: read files dropped in the Inbox (bills, receipts, statements)
    into drafts, propose bank matches, draft reorders, chase overdue
    invoices (drafts emails, never sends without approval), review the month
    close, answer a question asked in the app. Requests show honestly in the
    app (sent, working, done or refused) and say that they are picked up
    while your AI agent is running.
43. Proposals page: each proposal shows what it would post (the exact
    journal lines), why, and its sources; approve, reject, or open the
    draft. Fields your AI agent set are marked.

## Settings and data

44. Company, modules, members and roles (a level per module), numbering,
    taxes, payment terms, currencies, default accounts, lock dates, your AI
    agent's autonomy, import (customers, suppliers, items, accounts, opening
    balances, employees) and export, and the audit trail.

## Changes

- 2026-10-20: First version.
