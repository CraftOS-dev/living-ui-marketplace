"""
Tests for Transaction API endpoints.

Covers income, expense, transfer recording, journal entry verification,
balance updates, listing, filtering, and deletion.
"""

import pytest


def _seed_accounts(client):
    """Seed chart of accounts and return dict of code -> account."""
    client.post("/api/settings/seed")
    accounts = client.get("/api/accounts").json()
    return {a["code"]: a for a in accounts}


def _find_account(accounts, code_prefix, account_type=None):
    """Find first account matching a code prefix and optional type."""
    for code, acct in sorted(accounts.items()):
        if code.startswith(code_prefix):
            if account_type is None or acct["accountType"] == account_type:
                return acct
    return None


class TestRecordIncome:
    def test_record_income(self, client):
        """POST /api/transactions/income creates a journal entry with 2 lines."""
        accts = _seed_accounts(client)
        cash = accts["1000"]
        revenue = _find_account(accts, "4", "revenue")

        resp = client.post("/api/transactions/income", json={
            "date": "2025-01-15",
            "amount": 1000.00,
            "depositAccountId": cash["id"],
            "revenueAccountId": revenue["id"],
            "description": "Consulting income",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert "id" in data

    def test_income_creates_two_journal_lines(self, client):
        """Income transaction should produce exactly 2 journal lines."""
        accts = _seed_accounts(client)
        cash = accts["1000"]
        revenue = _find_account(accts, "4", "revenue")

        resp = client.post("/api/transactions/income", json={
            "date": "2025-01-15",
            "amount": 500.00,
            "depositAccountId": cash["id"],
            "revenueAccountId": revenue["id"],
            "description": "Sales",
        })
        txn_id = resp.json()["id"]
        detail = client.get(f"/api/transactions/{txn_id}").json()
        lines = detail.get("lines") or detail.get("journalLines") or []
        assert len(lines) == 2

    def test_income_debit_credit_correct(self, client):
        """Income: debit on deposit account, credit on revenue account."""
        accts = _seed_accounts(client)
        cash = accts["1000"]
        revenue = _find_account(accts, "4", "revenue")

        resp = client.post("/api/transactions/income", json={
            "date": "2025-01-15",
            "amount": 300.00,
            "depositAccountId": cash["id"],
            "revenueAccountId": revenue["id"],
        })
        txn_id = resp.json()["id"]
        detail = client.get(f"/api/transactions/{txn_id}").json()
        lines = detail.get("lines") or detail.get("journalLines") or []

        debit_line = next((l for l in lines if l.get("debit", 0) > 0), None)
        credit_line = next((l for l in lines if l.get("credit", 0) > 0), None)
        assert debit_line is not None, "Should have a debit line"
        assert credit_line is not None, "Should have a credit line"
        assert debit_line["accountId"] == cash["id"]
        assert credit_line["accountId"] == revenue["id"]
        assert debit_line["debit"] == 300.00
        assert credit_line["credit"] == 300.00

    def test_income_with_contact_and_category(self, client):
        """Income can be recorded with contactId and categoryId."""
        accts = _seed_accounts(client)
        cash = accts["1000"]
        revenue = _find_account(accts, "4", "revenue")

        contact = client.post("/api/contacts", json={
            "name": "Client X", "contactType": "customer",
        }).json()
        category = client.post("/api/categories", json={"name": "Services"}).json()

        resp = client.post("/api/transactions/income", json={
            "date": "2025-02-01",
            "amount": 2000.00,
            "depositAccountId": cash["id"],
            "revenueAccountId": revenue["id"],
            "contactId": contact["id"],
            "categoryId": category["id"],
            "description": "Service fee",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data.get("contactId") == contact["id"]
        assert data.get("categoryId") == category["id"]


class TestRecordExpense:
    def test_record_expense(self, client):
        """POST /api/transactions/expense returns 201."""
        accts = _seed_accounts(client)
        cash = accts["1000"]
        expense = _find_account(accts, "5", "expense") or _find_account(accts, "6", "expense")

        resp = client.post("/api/transactions/expense", json={
            "date": "2025-01-20",
            "amount": 200.00,
            "paymentAccountId": cash["id"],
            "expenseAccountId": expense["id"],
            "description": "Office rent",
        })
        assert resp.status_code == 201

    def test_expense_debit_credit_correct(self, client):
        """Expense: debit on expense account, credit on payment account."""
        accts = _seed_accounts(client)
        cash = accts["1000"]
        expense = _find_account(accts, "5", "expense") or _find_account(accts, "6", "expense")

        resp = client.post("/api/transactions/expense", json={
            "date": "2025-01-20",
            "amount": 150.00,
            "paymentAccountId": cash["id"],
            "expenseAccountId": expense["id"],
        })
        txn_id = resp.json()["id"]
        detail = client.get(f"/api/transactions/{txn_id}").json()
        lines = detail.get("lines") or detail.get("journalLines") or []

        debit_line = next((l for l in lines if l.get("debit", 0) > 0), None)
        credit_line = next((l for l in lines if l.get("credit", 0) > 0), None)
        assert debit_line["accountId"] == expense["id"]
        assert credit_line["accountId"] == cash["id"]
        assert debit_line["debit"] == 150.00
        assert credit_line["credit"] == 150.00


class TestRecordTransfer:
    def test_record_transfer(self, client):
        """POST /api/transactions/transfer returns 201."""
        accts = _seed_accounts(client)
        cash = accts["1000"]
        bank = accts.get("1010") or accts.get("1100") or _find_account(accts, "1", "asset")

        resp = client.post("/api/transactions/transfer", json={
            "date": "2025-01-25",
            "amount": 500.00,
            "fromAccountId": cash["id"],
            "toAccountId": bank["id"],
            "description": "Transfer to savings",
        })
        assert resp.status_code == 201

    def test_transfer_debit_credit_correct(self, client):
        """Transfer: debit on to-account, credit on from-account."""
        accts = _seed_accounts(client)
        cash = accts["1000"]
        bank = accts.get("1010") or accts.get("1100") or _find_account(accts, "1", "asset")

        resp = client.post("/api/transactions/transfer", json={
            "date": "2025-01-25",
            "amount": 250.00,
            "fromAccountId": cash["id"],
            "toAccountId": bank["id"],
        })
        txn_id = resp.json()["id"]
        detail = client.get(f"/api/transactions/{txn_id}").json()
        lines = detail.get("lines") or detail.get("journalLines") or []

        debit_line = next((l for l in lines if l.get("debit", 0) > 0), None)
        credit_line = next((l for l in lines if l.get("credit", 0) > 0), None)
        assert debit_line["accountId"] == bank["id"]
        assert credit_line["accountId"] == cash["id"]


class TestAccountBalanceAfterTransactions:
    def test_income_increases_cash_balance(self, client):
        """Cash balance should increase after recording income."""
        accts = _seed_accounts(client)
        cash = accts["1000"]
        revenue = _find_account(accts, "4", "revenue")

        client.post("/api/transactions/income", json={
            "date": "2025-01-15",
            "amount": 1000.00,
            "depositAccountId": cash["id"],
            "revenueAccountId": revenue["id"],
        })

        bal = client.get(f"/api/accounts/{cash['id']}/balance").json()
        assert bal["balance"] == 1000.00

    def test_expense_decreases_cash_balance(self, client):
        """Cash balance should decrease after recording expense."""
        accts = _seed_accounts(client)
        cash = accts["1000"]
        revenue = _find_account(accts, "4", "revenue")
        expense = _find_account(accts, "5", "expense") or _find_account(accts, "6", "expense")

        # First add income
        client.post("/api/transactions/income", json={
            "date": "2025-01-15",
            "amount": 1000.00,
            "depositAccountId": cash["id"],
            "revenueAccountId": revenue["id"],
        })
        # Then expense
        client.post("/api/transactions/expense", json={
            "date": "2025-01-20",
            "amount": 300.00,
            "paymentAccountId": cash["id"],
            "expenseAccountId": expense["id"],
        })

        bal = client.get(f"/api/accounts/{cash['id']}/balance").json()
        assert bal["balance"] == 700.00

    def test_multiple_transactions_accumulate(self, client):
        """Multiple transactions should accumulate correctly."""
        accts = _seed_accounts(client)
        cash = accts["1000"]
        revenue = _find_account(accts, "4", "revenue")

        for i in range(3):
            client.post("/api/transactions/income", json={
                "date": f"2025-01-{10 + i:02d}",
                "amount": 100.00,
                "depositAccountId": cash["id"],
                "revenueAccountId": revenue["id"],
            })

        bal = client.get(f"/api/accounts/{cash['id']}/balance").json()
        assert bal["balance"] == 300.00


class TestListTransactions:
    def test_list_empty(self, client):
        """GET /api/transactions with no data returns empty list and total=0."""
        resp = client.get("/api/transactions")
        assert resp.status_code == 200
        data = resp.json()
        assert data["transactions"] == []
        assert data["total"] == 0

    def test_list_after_creating(self, client):
        """GET /api/transactions returns all created transactions."""
        accts = _seed_accounts(client)
        cash = accts["1000"]
        revenue = _find_account(accts, "4", "revenue")

        for i in range(3):
            client.post("/api/transactions/income", json={
                "date": f"2025-01-{10 + i:02d}",
                "amount": 100.00 * (i + 1),
                "depositAccountId": cash["id"],
                "revenueAccountId": revenue["id"],
            })

        resp = client.get("/api/transactions")
        data = resp.json()
        assert data["total"] == 3
        assert len(data["transactions"]) == 3

    def test_filter_by_date_range(self, client):
        """GET /api/transactions with from_date/to_date filters correctly."""
        accts = _seed_accounts(client)
        cash = accts["1000"]
        revenue = _find_account(accts, "4", "revenue")

        dates = ["2025-01-10", "2025-02-15", "2025-03-20"]
        for d in dates:
            client.post("/api/transactions/income", json={
                "date": d,
                "amount": 100.00,
                "depositAccountId": cash["id"],
                "revenueAccountId": revenue["id"],
            })

        resp = client.get("/api/transactions", params={
            "from_date": "2025-02-01",
            "to_date": "2025-02-28",
        })
        data = resp.json()
        assert data["total"] == 1

    def test_filter_by_entry_type(self, client):
        """GET /api/transactions with entry_type filters correctly."""
        accts = _seed_accounts(client)
        cash = accts["1000"]
        revenue = _find_account(accts, "4", "revenue")
        expense = _find_account(accts, "5", "expense") or _find_account(accts, "6", "expense")

        client.post("/api/transactions/income", json={
            "date": "2025-01-15",
            "amount": 500.00,
            "depositAccountId": cash["id"],
            "revenueAccountId": revenue["id"],
        })
        client.post("/api/transactions/expense", json={
            "date": "2025-01-20",
            "amount": 200.00,
            "paymentAccountId": cash["id"],
            "expenseAccountId": expense["id"],
        })

        resp = client.get("/api/transactions", params={"entry_type": "income"})
        data = resp.json()
        assert data["total"] == 1


class TestGetTransaction:
    def test_get_by_id(self, client):
        """GET /api/transactions/:id returns full transaction with lines."""
        accts = _seed_accounts(client)
        cash = accts["1000"]
        revenue = _find_account(accts, "4", "revenue")

        created = client.post("/api/transactions/income", json={
            "date": "2025-01-15",
            "amount": 999.99,
            "depositAccountId": cash["id"],
            "revenueAccountId": revenue["id"],
            "description": "Detailed view",
        }).json()

        resp = client.get(f"/api/transactions/{created['id']}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == created["id"]
        lines = data.get("lines") or data.get("journalLines") or []
        assert len(lines) >= 2
        # Lines should include accountName
        for line in lines:
            assert "accountId" in line

    def test_get_missing_returns_404(self, client):
        """GET /api/transactions/999 returns 404."""
        resp = client.get("/api/transactions/999")
        assert resp.status_code == 404


class TestDeleteTransaction:
    def test_delete_removes_transaction(self, client):
        """DELETE /api/transactions/:id removes the transaction."""
        accts = _seed_accounts(client)
        cash = accts["1000"]
        revenue = _find_account(accts, "4", "revenue")

        created = client.post("/api/transactions/income", json={
            "date": "2025-01-15",
            "amount": 500.00,
            "depositAccountId": cash["id"],
            "revenueAccountId": revenue["id"],
        }).json()

        resp = client.delete(f"/api/transactions/{created['id']}")
        assert resp.status_code == 200

        # Verify gone
        get_resp = client.get(f"/api/transactions/{created['id']}")
        assert get_resp.status_code == 404

    def test_delete_reverts_balance(self, client):
        """Deleting a transaction should revert account balances."""
        accts = _seed_accounts(client)
        cash = accts["1000"]
        revenue = _find_account(accts, "4", "revenue")

        created = client.post("/api/transactions/income", json={
            "date": "2025-01-15",
            "amount": 500.00,
            "depositAccountId": cash["id"],
            "revenueAccountId": revenue["id"],
        }).json()

        # Balance should be 500
        bal = client.get(f"/api/accounts/{cash['id']}/balance").json()
        assert bal["balance"] == 500.00

        # Delete
        client.delete(f"/api/transactions/{created['id']}")

        # Balance should revert to 0
        bal = client.get(f"/api/accounts/{cash['id']}/balance").json()
        assert bal["balance"] == 0

    def test_list_total_after_delete(self, client):
        """Transaction total should decrease after deletion."""
        accts = _seed_accounts(client)
        cash = accts["1000"]
        revenue = _find_account(accts, "4", "revenue")

        ids = []
        for i in range(3):
            resp = client.post("/api/transactions/income", json={
                "date": f"2025-01-{10 + i:02d}",
                "amount": 100.00,
                "depositAccountId": cash["id"],
                "revenueAccountId": revenue["id"],
            })
            ids.append(resp.json()["id"])

        client.delete(f"/api/transactions/{ids[0]}")
        data = client.get("/api/transactions").json()
        assert data["total"] == 2
