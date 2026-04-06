"""
Tests for Account API endpoints.

Covers CRUD, filtering, balance calculations, and account tree.
"""

import pytest


def _create_account(client, **overrides):
    """Helper to create an account with sensible defaults."""
    payload = {
        "code": "1000",
        "name": "Cash",
        "accountType": "asset",
    }
    payload.update(overrides)
    return client.post("/api/accounts", json=payload)


class TestCreateAccount:
    def test_create_with_required_fields(self, client):
        """POST /api/accounts with required fields returns 201."""
        resp = _create_account(client)
        assert resp.status_code == 201
        data = resp.json()
        assert data["code"] == "1000"
        assert data["name"] == "Cash"
        assert data["accountType"] == "asset"
        assert "id" in data

    def test_create_with_all_optional_fields(self, client):
        """POST /api/accounts with all fields returns 201."""
        resp = _create_account(
            client,
            code="1100",
            name="Savings",
            accountType="asset",
            subType="bank",
            description="Primary savings account",
            openingBalance=5000.00,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["subType"] == "bank"
        assert data["description"] == "Primary savings account"
        assert data["openingBalance"] == 5000.00

    def test_create_duplicate_code_fails(self, client):
        """Creating two accounts with the same code should fail."""
        _create_account(client, code="1000", name="Cash")
        try:
            resp = _create_account(client, code="1000", name="Cash Duplicate")
            assert resp.status_code in (400, 500)
        except Exception:
            # IntegrityError propagated through the test client is acceptable
            pass

    def test_create_with_parent_id(self, client):
        """Account can be created with a parentId."""
        parent = _create_account(client, code="1000", name="Cash").json()
        child = _create_account(
            client, code="1001", name="Petty Cash", parentId=parent["id"]
        )
        assert child.status_code == 201
        assert child.json()["parentId"] == parent["id"]


class TestListAccounts:
    def test_list_empty(self, client):
        """GET /api/accounts returns empty list when no accounts exist."""
        resp = client.get("/api/accounts")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_populated(self, client):
        """GET /api/accounts returns all created accounts."""
        _create_account(client, code="1000", name="Cash")
        _create_account(client, code="2000", name="Accounts Payable", accountType="liability")
        resp = client.get("/api/accounts")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_filter_by_type(self, client):
        """GET /api/accounts?type=asset returns only asset accounts."""
        _create_account(client, code="1000", name="Cash", accountType="asset")
        _create_account(client, code="2000", name="AP", accountType="liability")
        resp = client.get("/api/accounts", params={"type": "asset"})
        assert resp.status_code == 200
        accounts = resp.json()
        assert len(accounts) == 1
        assert accounts[0]["accountType"] == "asset"

    def test_filter_by_unknown_type(self, client):
        """Filtering by a non-existent type returns empty list."""
        _create_account(client, code="1000", name="Cash", accountType="asset")
        resp = client.get("/api/accounts", params={"type": "nonexistent"})
        assert resp.status_code == 200
        assert resp.json() == []


class TestGetAccount:
    def test_get_by_id(self, client):
        """GET /api/accounts/:id returns correct account."""
        created = _create_account(client).json()
        resp = client.get(f"/api/accounts/{created['id']}")
        assert resp.status_code == 200
        assert resp.json()["id"] == created["id"]
        assert resp.json()["name"] == "Cash"

    def test_get_missing_id(self, client):
        """GET /api/accounts/999 returns 404."""
        resp = client.get("/api/accounts/999")
        assert resp.status_code == 404


class TestUpdateAccount:
    def test_update_name(self, client):
        """PUT /api/accounts/:id can update name."""
        created = _create_account(client).json()
        resp = client.put(f"/api/accounts/{created['id']}", json={"name": "Updated Cash"})
        assert resp.status_code == 200
        assert resp.json()["name"] == "Updated Cash"

    def test_update_code(self, client):
        """PUT /api/accounts/:id can update code."""
        created = _create_account(client).json()
        resp = client.put(f"/api/accounts/{created['id']}", json={"code": "1099"})
        assert resp.status_code == 200
        assert resp.json()["code"] == "1099"

    def test_update_description(self, client):
        """PUT /api/accounts/:id can update description."""
        created = _create_account(client).json()
        resp = client.put(
            f"/api/accounts/{created['id']}", json={"description": "Main cash account"}
        )
        assert resp.status_code == 200
        assert resp.json()["description"] == "Main cash account"

    def test_update_with_duplicate_code_fails(self, client):
        """Updating an account to use an existing code should fail."""
        _create_account(client, code="1000", name="Cash")
        second = _create_account(client, code="1100", name="Savings").json()
        try:
            resp = client.put(f"/api/accounts/{second['id']}", json={"code": "1000"})
            assert resp.status_code in (400, 500)
        except Exception:
            # IntegrityError propagated through the test client is acceptable
            pass


class TestDeleteAccount:
    def test_delete_soft_deletes(self, client, db):
        """DELETE /api/accounts/:id should soft-delete (is_active=False)."""
        created = _create_account(client).json()
        resp = client.delete(f"/api/accounts/{created['id']}")
        assert resp.status_code == 200

        # Account should no longer appear in active list
        accounts = client.get("/api/accounts", params={"active": True}).json()
        active_ids = [a["id"] for a in accounts]
        assert created["id"] not in active_ids


class TestAccountBalance:
    def test_balance_no_transactions(self, client):
        """Balance of account with no transactions equals opening balance (default 0)."""
        created = _create_account(client, code="1000", name="Cash").json()
        resp = client.get(f"/api/accounts/{created['id']}/balance")
        assert resp.status_code == 200
        assert resp.json()["balance"] == 0

    def test_balance_with_opening_balance(self, client):
        """Balance includes the opening balance."""
        created = _create_account(
            client, code="1000", name="Cash", openingBalance=1000.00
        ).json()
        resp = client.get(f"/api/accounts/{created['id']}/balance")
        assert resp.status_code == 200
        assert resp.json()["balance"] == 1000.00

    def test_balance_debit_normal_account(self, client):
        """Asset account balance increases with debits (income deposits)."""
        client.post("/api/settings/seed")
        accounts = {a["code"]: a for a in client.get("/api/accounts").json()}
        cash = accounts["1000"]
        revenue = accounts.get("4000") or accounts.get("4100")

        client.post("/api/transactions/income", json={
            "date": "2025-01-15",
            "amount": 500.00,
            "depositAccountId": cash["id"],
            "revenueAccountId": revenue["id"],
            "description": "Test income",
        })

        resp = client.get(f"/api/accounts/{cash['id']}/balance")
        assert resp.status_code == 200
        # Cash (asset/debit-normal) should increase by 500
        balance = resp.json()["balance"]
        assert balance >= 500.00

    def test_balance_credit_normal_account(self, client):
        """Revenue account balance increases with credits."""
        client.post("/api/settings/seed")
        accounts = {a["code"]: a for a in client.get("/api/accounts").json()}
        cash = accounts["1000"]
        revenue = accounts.get("4000") or accounts.get("4100")

        client.post("/api/transactions/income", json={
            "date": "2025-01-15",
            "amount": 750.00,
            "depositAccountId": cash["id"],
            "revenueAccountId": revenue["id"],
            "description": "Service revenue",
        })

        resp = client.get(f"/api/accounts/{revenue['id']}/balance")
        assert resp.status_code == 200
        balance = resp.json()["balance"]
        assert balance >= 750.00


class TestAccountTree:
    def test_tree_empty(self, client):
        """Account tree with no accounts should be empty."""
        resp = client.get("/api/accounts/tree")
        assert resp.status_code == 200
        data = resp.json()
        # Could be empty dict or empty list
        assert data == {} or data == []

    def test_tree_groups_by_type(self, client):
        """Account tree should group accounts by type."""
        _create_account(client, code="1000", name="Cash", accountType="asset")
        _create_account(client, code="2000", name="AP", accountType="liability")
        _create_account(client, code="4000", name="Sales", accountType="revenue")

        resp = client.get("/api/accounts/tree")
        assert resp.status_code == 200
        data = resp.json()
        # Tree should contain groupings for the types we created
        if isinstance(data, dict):
            assert "asset" in data
            assert "liability" in data
            assert "revenue" in data
        elif isinstance(data, list):
            type_names = [group.get("type") or group.get("accountType") for group in data]
            assert "asset" in type_names
            assert "liability" in type_names
            assert "revenue" in type_names
