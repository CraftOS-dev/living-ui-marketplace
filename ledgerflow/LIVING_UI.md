# LedgerFlow — Bookkeeping App

## Overview
LedgerFlow is a comprehensive bookkeeping app for personal and business use. It features proper double-entry bookkeeping under the hood with simplified Income/Expense/Transfer forms for non-accountants. Auto-seeds 20 standard accounts on first launch.

## Requirements
- Both personal and business bookkeeping
- Simple transaction entry (double-entry auto-generated)
- Invoices, bills, financial reports, contacts, categories
- Compact data-dense design, sidebar navigation, dark theme
- Currency: USD

## Data Model (10 models)
| Model | Purpose |
|-------|---------|
| Settings | Business config (singleton) |
| Account | Chart of Accounts (asset/liability/equity/revenue/expense) |
| Category | Transaction categories with colors |
| Contact | Customers and vendors |
| JournalEntry | Transaction headers |
| JournalLine | Debit/credit lines (double-entry) |
| Invoice + InvoiceLine | Customer invoicing |
| Bill + BillLine | Vendor bill tracking |

## API Endpoints (~48 routes)
- Settings: GET/PUT /settings, POST /settings/seed
- Accounts: CRUD + /accounts/tree + /accounts/{id}/balance
- Categories: CRUD
- Contacts: CRUD with soft delete
- Transactions: income/expense/transfer + list with filters
- Invoices: CRUD + send + payment
- Bills: CRUD + receive + payment
- Reports: profit-loss, balance-sheet, trial-balance, account-ledger
- Dashboard: summary, recent, overdue, income-expense-chart, expense-breakdown

## Frontend (11 components)
| Component | Purpose |
|-----------|---------|
| MainView | Sidebar + header + content routing |
| Sidebar | 8 navigation items |
| DashboardView | 6 KPIs, charts, recent, overdue, quick actions |
| TransactionsView | Filterable list + Income/Expense/Transfer modal |
| AccountsView | Grouped by type with balances |
| AccountLedgerView | Per-account history with running balance |
| InvoicesView | Create, send, record payments |
| BillsView | Create, receive, record payments |
| ContactsView | Customer/vendor management |
| ReportsView | P&L, Balance Sheet, Trial Balance |
| SettingsView | Business settings + account seeding |

## Testing
- 136 backend tests across 9 test files (all passing)
- TypeScript: 0 errors
- Build: exit code 0

## Key Files
- backend/models.py, routes.py, database.py
- frontend/types.ts, AppController.ts
- frontend/components/ (11 components)
- config/manifest.json (ports: 3108/3109)
