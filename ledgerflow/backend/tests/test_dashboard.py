"""
Tests for Dashboard API endpoints.

Covers summary, recent transactions, and overdue invoices/bills.
"""

import pytest
from datetime import date


def _seed_accounts(client):
    """Seed chart of accounts and return dict of code -> account."""
    client.post("/api/settings/seed")
    accounts = {a["code"]: a for a in client.get("/api/accounts").json()}
    return accounts


def _find_account(accounts, code_prefix, account_type=None):
    for code, acct in sorted(accounts.items()):
        if code.startswith(code_prefix):
            if account_type is None or acct["accountType"] == account_type:
                return acct
    return None


def _find_accounts_by_type(accounts, account_type):
    return [a for a in accounts.values() if a["accountType"] == account_type]


# =============================================================================
# Summary
# =============================================================================


class TestDashboardSummary:
    def test_summary_empty(self, client):
        """Dashboard summary with no data returns all zeros."""
        resp = client.get("/api/dashboard/summary")
        assert resp.status_code == 200
        data = resp.json()
        assert data["cashBalance"] == 0
        assert data["totalIncome"] == 0
        assert data["totalExpenses"] == 0
        assert data["netIncome"] == 0

    def test_summary_after_transactions(self, client):
        """Dashboard summary reflects income and expense transactions."""
        accts = _seed_accounts(client)
        cash = accts["1000"]
        revenue = _find_account(accts, "4", "revenue")
        expense = _find_account(accts, "5", "expense") or _find_account(accts, "6", "expense")

        today = date.today()
        income_date = today.replace(day=1).isoformat()
        expense_date = today.replace(day=min(5, today.day)).isoformat()

        client.post("/api/transactions/income", json={
            "date": income_date,
            "amount": 5000.00,
            "depositAccountId": cash["id"],
            "revenueAccountId": revenue["id"],
        })
        client.post("/api/transactions/expense", json={
            "date": expense_date,
            "amount": 1200.00,
            "paymentAccountId": cash["id"],
            "expenseAccountId": expense["id"],
        })

        resp = client.get("/api/dashboard/summary")
        data = resp.json()
        assert data["totalIncome"] == 5000.00
        assert data["totalExpenses"] == 1200.00
        assert data["netIncome"] == 3800.00
        assert data["cashBalance"] == 3800.00

    def test_summary_shows_ar_ap(self, client):
        """Summary should include accounts receivable and accounts payable."""
        accts = _seed_accounts(client)

        resp = client.get("/api/dashboard/summary")
        data = resp.json()
        # AR and AP fields should exist (may be 0 with no invoices/bills)
        assert "accountsReceivable" in data or "ar" in data
        assert "accountsPayable" in data or "ap" in data


# =============================================================================
# Recent Transactions
# =============================================================================


class TestDashboardRecent:
    def test_recent_empty(self, client):
        """Recent transactions with no data returns empty list."""
        resp = client.get("/api/dashboard/recent")
        assert resp.status_code == 200
        data = resp.json()
        recent = data if isinstance(data, list) else data.get("recent", data.get("transactions", []))
        assert len(recent) == 0

    def test_recent_returns_max_10(self, client):
        """Recent transactions returns at most 10 entries."""
        accts = _seed_accounts(client)
        cash = accts["1000"]
        revenue = _find_account(accts, "4", "revenue")

        for i in range(15):
            client.post("/api/transactions/income", json={
                "date": f"2025-01-{(i % 28) + 1:02d}",
                "amount": 100.00 + i,
                "depositAccountId": cash["id"],
                "revenueAccountId": revenue["id"],
                "description": f"Transaction {i + 1}",
            })

        resp = client.get("/api/dashboard/recent")
        data = resp.json()
        recent = data if isinstance(data, list) else data.get("recent", data.get("transactions", []))
        assert len(recent) <= 10

    def test_recent_has_required_fields(self, client):
        """Recent transaction entries have required fields."""
        accts = _seed_accounts(client)
        cash = accts["1000"]
        revenue = _find_account(accts, "4", "revenue")

        client.post("/api/transactions/income", json={
            "date": "2025-01-15",
            "amount": 250.00,
            "depositAccountId": cash["id"],
            "revenueAccountId": revenue["id"],
            "description": "Test entry",
        })

        resp = client.get("/api/dashboard/recent")
        data = resp.json()
        recent = data if isinstance(data, list) else data.get("recent", data.get("transactions", []))
        assert len(recent) >= 1
        entry = recent[0]
        assert "id" in entry
        # Should have a date field (entryDate or date)
        assert "entryDate" in entry or "date" in entry
        # Should have description
        assert "description" in entry
        # Should have amount (totalAmount or amount)
        assert "totalAmount" in entry or "amount" in entry


# =============================================================================
# Overdue
# =============================================================================


class TestDashboardOverdue:
    def test_overdue_empty(self, client):
        """Overdue endpoint with no invoices/bills returns empty lists."""
        resp = client.get("/api/dashboard/overdue")
        assert resp.status_code == 200
        data = resp.json()
        assert data["overdueInvoices"] == []
        assert data["overdueBills"] == []

    def test_overdue_with_past_due_invoice(self, client):
        """An unpaid sent invoice past due date shows up as overdue."""
        accts = _seed_accounts(client)
        contact = client.post("/api/contacts", json={
            "name": "Late Payer",
            "contactType": "customer",
        }).json()

        inv = client.post("/api/invoices", json={
            "contactId": contact["id"],
            "issueDate": "2024-01-01",
            "dueDate": "2024-02-01",  # Well past due
            "lines": [{"description": "Work", "quantity": 1, "unitPrice": 500.00}],
        }).json()
        client.post(f"/api/invoices/{inv['id']}/send")

        resp = client.get("/api/dashboard/overdue")
        data = resp.json()
        assert len(data["overdueInvoices"]) == 1

    def test_overdue_with_past_due_bill(self, client):
        """An unpaid received bill past due date shows up as overdue."""
        accts = _seed_accounts(client)
        contact = client.post("/api/contacts", json={
            "name": "Overdue Vendor",
            "contactType": "vendor",
        }).json()

        bill = client.post("/api/bills", json={
            "contactId": contact["id"],
            "issueDate": "2024-01-01",
            "dueDate": "2024-02-01",
            "lines": [{"description": "Parts", "quantity": 10, "unitPrice": 20.00}],
        }).json()
        client.post(f"/api/bills/{bill['id']}/receive")

        resp = client.get("/api/dashboard/overdue")
        data = resp.json()
        assert len(data["overdueBills"]) == 1

    def test_overdue_excludes_paid(self, client):
        """Paid invoices should NOT appear as overdue."""
        accts = _seed_accounts(client)
        cash = accts["1000"]
        contact = client.post("/api/contacts", json={
            "name": "Prompt Payer",
            "contactType": "customer",
        }).json()

        inv = client.post("/api/invoices", json={
            "contactId": contact["id"],
            "issueDate": "2024-01-01",
            "dueDate": "2024-02-01",
            "lines": [{"description": "Work", "quantity": 1, "unitPrice": 500.00}],
        }).json()
        client.post(f"/api/invoices/{inv['id']}/send")
        client.post(f"/api/invoices/{inv['id']}/payment", json={
            "amount": 500.00,
            "depositAccountId": cash["id"],
        })

        resp = client.get("/api/dashboard/overdue")
        data = resp.json()
        assert len(data["overdueInvoices"]) == 0

    def test_overdue_excludes_void(self, client):
        """Void invoices should NOT appear as overdue."""
        accts = _seed_accounts(client)
        contact = client.post("/api/contacts", json={
            "name": "Voided Client",
            "contactType": "customer",
        }).json()

        inv = client.post("/api/invoices", json={
            "contactId": contact["id"],
            "issueDate": "2024-01-01",
            "dueDate": "2024-02-01",
            "lines": [{"description": "Work", "quantity": 1, "unitPrice": 500.00}],
        }).json()
        client.post(f"/api/invoices/{inv['id']}/send")

        # Void the invoice (if endpoint exists)
        void_resp = client.post(f"/api/invoices/{inv['id']}/void")
        if void_resp.status_code == 200:
            resp = client.get("/api/dashboard/overdue")
            data = resp.json()
            assert len(data["overdueInvoices"]) == 0
        else:
            # If void endpoint doesn't exist, skip
            pytest.skip("Void endpoint not implemented")
