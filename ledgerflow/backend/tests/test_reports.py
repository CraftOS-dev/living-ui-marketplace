"""
Tests for Reports API endpoints.

Covers Profit & Loss, Balance Sheet, Trial Balance, and Account Ledger.
Verifies mathematical correctness of accounting reports.
"""

import pytest


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
    """Return all accounts of a given type."""
    return [a for a in accounts.values() if a["accountType"] == account_type]


def _setup_with_transactions(client):
    """Seed accounts and record various income/expense transactions.

    Returns the account map.

    Transactions recorded:
    - Income: $5000 to first revenue account (Sales)
    - Income: $3000 to second revenue account (Service Revenue)
    - Expense: $1000 from first expense account (Rent)
    - Expense: $500 from second expense account (Utilities)
    """
    accts = _seed_accounts(client)
    cash = accts["1000"]

    # Find revenue accounts
    rev_accounts = sorted(
        _find_accounts_by_type(accts, "revenue"), key=lambda a: a["code"]
    )
    rev1 = rev_accounts[0] if len(rev_accounts) > 0 else None
    rev2 = rev_accounts[1] if len(rev_accounts) > 1 else rev1

    # Find expense accounts
    exp_accounts = sorted(
        _find_accounts_by_type(accts, "expense"), key=lambda a: a["code"]
    )
    exp1 = exp_accounts[0] if len(exp_accounts) > 0 else None
    exp2 = exp_accounts[1] if len(exp_accounts) > 1 else exp1

    # Record income
    client.post("/api/transactions/income", json={
        "date": "2025-06-01",
        "amount": 5000.00,
        "depositAccountId": cash["id"],
        "revenueAccountId": rev1["id"],
        "description": "Sales income",
    })
    client.post("/api/transactions/income", json={
        "date": "2025-06-15",
        "amount": 3000.00,
        "depositAccountId": cash["id"],
        "revenueAccountId": rev2["id"],
        "description": "Service income",
    })

    # Record expenses
    client.post("/api/transactions/expense", json={
        "date": "2025-06-05",
        "amount": 1000.00,
        "paymentAccountId": cash["id"],
        "expenseAccountId": exp1["id"],
        "description": "Rent",
    })
    client.post("/api/transactions/expense", json={
        "date": "2025-06-10",
        "amount": 500.00,
        "paymentAccountId": cash["id"],
        "expenseAccountId": exp2["id"],
        "description": "Utilities",
    })

    return accts


# =============================================================================
# Profit & Loss
# =============================================================================


class TestProfitAndLoss:
    def test_pnl_empty(self, client):
        """P&L with no transactions has zero totals."""
        _seed_accounts(client)
        resp = client.get("/api/reports/profit-loss", params={
            "from_date": "2025-01-01",
            "to_date": "2025-12-31",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["totalRevenue"] == 0
        assert data["totalExpenses"] == 0
        assert data["netIncome"] == 0

    def test_pnl_after_transactions(self, client):
        """P&L reflects recorded income and expenses."""
        _setup_with_transactions(client)
        resp = client.get("/api/reports/profit-loss", params={
            "from_date": "2025-01-01",
            "to_date": "2025-12-31",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["totalRevenue"] == 8000.00
        assert data["totalExpenses"] == 1500.00
        assert data["netIncome"] == 6500.00

    def test_pnl_date_filter(self, client):
        """P&L only includes transactions within the date range."""
        _setup_with_transactions(client)
        # Only June 1-7 should capture: $5000 income, $1000 expense
        resp = client.get("/api/reports/profit-loss", params={
            "from_date": "2025-06-01",
            "to_date": "2025-06-07",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["totalRevenue"] == 5000.00
        assert data["totalExpenses"] == 1000.00
        assert data["netIncome"] == 4000.00

    def test_pnl_revenue_list(self, client):
        """P&L response includes individual revenue account lines."""
        _setup_with_transactions(client)
        resp = client.get("/api/reports/profit-loss", params={
            "from_date": "2025-01-01",
            "to_date": "2025-12-31",
        })
        data = resp.json()
        assert "revenue" in data
        assert isinstance(data["revenue"], list)
        assert len(data["revenue"]) >= 1

    def test_pnl_response_format(self, client):
        """P&L response has correct structure with fromDate/toDate."""
        _seed_accounts(client)
        resp = client.get("/api/reports/profit-loss", params={
            "from_date": "2025-01-01",
            "to_date": "2025-12-31",
        })
        data = resp.json()
        assert "fromDate" in data
        assert "toDate" in data
        assert "revenue" in data
        assert "expenses" in data
        assert "totalRevenue" in data
        assert "totalExpenses" in data
        assert "netIncome" in data


# =============================================================================
# Balance Sheet
# =============================================================================


class TestBalanceSheet:
    def test_balance_sheet_empty(self, client):
        """Balance sheet with no transactions has zero totals."""
        _seed_accounts(client)
        resp = client.get("/api/reports/balance-sheet")
        assert resp.status_code == 200
        data = resp.json()
        assert data["assets"]["total"] == 0
        assert data["liabilities"]["total"] == 0
        assert data["equity"]["total"] == 0

    def test_balance_sheet_after_transactions(self, client):
        """Balance sheet reflects account balances after transactions."""
        _setup_with_transactions(client)
        resp = client.get("/api/reports/balance-sheet")
        assert resp.status_code == 200
        data = resp.json()
        total_assets = data["assets"]["total"]
        total_liabilities = data["liabilities"]["total"]
        total_equity = data["equity"]["total"]
        # Assets should reflect the net cash from income/expense transactions
        # Income: 5000 + 3000 = 8000 deposited to cash
        # Expense: 1000 + 500 = 1500 paid from cash
        # Net cash = 6500
        assert total_assets == 6500.0

    def test_balance_sheet_includes_opening_balances(self, client):
        """Balance sheet should include opening balances."""
        accts = _seed_accounts(client)
        cash = accts["1000"]
        # Create account with opening balance (use unique code to avoid collision with seed)
        resp = client.post("/api/accounts", json={
            "code": "1600",
            "name": "Equipment",
            "accountType": "asset",
            "openingBalance": 10000.00,
        })
        assert resp.status_code == 201

        bs = client.get("/api/reports/balance-sheet").json()
        assert bs["assets"]["total"] >= 10000.00


# =============================================================================
# Trial Balance
# =============================================================================


class TestTrialBalance:
    def test_trial_balance_empty(self, client):
        """Trial balance with no transactions has zero totals."""
        _seed_accounts(client)
        resp = client.get("/api/reports/trial-balance")
        assert resp.status_code == 200
        data = resp.json()
        assert data["totalDebits"] == data["totalCredits"]

    def test_trial_balance_debits_equal_credits(self, client):
        """Trial balance: total debits MUST always equal total credits."""
        _setup_with_transactions(client)
        resp = client.get("/api/reports/trial-balance", params={
            "from_date": "2025-01-01",
            "to_date": "2025-12-31",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["totalDebits"] == data["totalCredits"]

    def test_trial_balance_lists_active_accounts(self, client):
        """Trial balance lists accounts that had activity."""
        _setup_with_transactions(client)
        resp = client.get("/api/reports/trial-balance", params={
            "from_date": "2025-01-01",
            "to_date": "2025-12-31",
        })
        data = resp.json()
        assert "accounts" in data
        assert len(data["accounts"]) >= 1

    def test_trial_balance_nonzero_after_transactions(self, client):
        """Trial balance totals should be non-zero after transactions."""
        _setup_with_transactions(client)
        resp = client.get("/api/reports/trial-balance", params={
            "from_date": "2025-01-01",
            "to_date": "2025-12-31",
        })
        data = resp.json()
        assert data["totalDebits"] > 0
        assert data["totalCredits"] > 0


# =============================================================================
# Account Ledger
# =============================================================================


class TestAccountLedger:
    def test_ledger_with_activity(self, client):
        """Account ledger returns entries with running balance."""
        accts = _setup_with_transactions(client)
        cash = accts["1000"]

        resp = client.get(f"/api/reports/account-ledger/{cash['id']}")
        assert resp.status_code == 200
        data = resp.json()
        assert "entries" in data
        assert len(data["entries"]) >= 1
        # Each entry should have a running balance
        for entry in data["entries"]:
            assert "balance" in entry or "runningBalance" in entry

    def test_ledger_no_activity(self, client):
        """Account ledger for account with no activity returns empty entries."""
        accts = _seed_accounts(client)
        # Pick an account we know has no transactions
        liability_accounts = _find_accounts_by_type(accts, "liability")
        if liability_accounts:
            acct = liability_accounts[0]
            resp = client.get(f"/api/reports/account-ledger/{acct['id']}")
            assert resp.status_code == 200
            data = resp.json()
            entries = data.get("entries", [])
            assert len(entries) == 0
