"""
Tests for Bill API endpoints.

Mirrors invoice tests for the accounts-payable side.
Covers create, list, receive, payments, and status transitions.
"""

import pytest


def _setup(client):
    """Seed accounts and create a vendor contact. Returns (accounts_dict, contact)."""
    client.post("/api/settings/seed")
    accounts = {a["code"]: a for a in client.get("/api/accounts").json()}
    contact = client.post("/api/contacts", json={
        "name": "Bill Vendor",
        "contactType": "vendor",
    }).json()
    return accounts, contact


def _find_account(accounts, code_prefix, account_type=None):
    for code, acct in sorted(accounts.items()):
        if code.startswith(code_prefix):
            if account_type is None or acct["accountType"] == account_type:
                return acct
    return None


def _create_bill(client, contact_id, **overrides):
    """Helper to create a basic bill."""
    payload = {
        "contactId": contact_id,
        "issueDate": "2025-01-10",
        "dueDate": "2025-02-10",
        "lines": [
            {"description": "Office supplies", "quantity": 20, "unitPrice": 25.00},
        ],
    }
    payload.update(overrides)
    return client.post("/api/bills", json=payload)


class TestCreateBill:
    def test_create_draft_single_line(self, client):
        """POST /api/bills with one line returns 201, status=draft."""
        accounts, contact = _setup(client)
        resp = _create_bill(client, contact["id"])
        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "draft"
        assert "id" in data
        # subtotal = 20 * 25 = 500
        assert data["subtotal"] == 500.00
        assert data["total"] == 500.00

    def test_create_multiple_lines(self, client):
        """Bill with multiple lines sums correctly."""
        accounts, contact = _setup(client)
        resp = _create_bill(client, contact["id"], lines=[
            {"description": "Paper", "quantity": 10, "unitPrice": 5.00},
            {"description": "Ink", "quantity": 3, "unitPrice": 50.00},
        ])
        assert resp.status_code == 201
        data = resp.json()
        # subtotal = 10*5 + 3*50 = 50 + 150 = 200
        assert data["subtotal"] == 200.00
        assert data["total"] == 200.00

    def test_create_with_tax(self, client):
        """Bill with taxRate calculates tax correctly."""
        accounts, contact = _setup(client)
        resp = _create_bill(client, contact["id"], taxRate=8.0, lines=[
            {"description": "Equipment", "quantity": 1, "unitPrice": 500.00},
        ])
        assert resp.status_code == 201
        data = resp.json()
        assert data["subtotal"] == 500.00
        assert data["taxAmount"] == 40.00  # 500 * 8 / 100
        assert data["total"] == 540.00

    def test_auto_assigns_bill_number(self, client):
        """Bill should get an auto-assigned billNumber."""
        accounts, contact = _setup(client)
        resp = _create_bill(client, contact["id"])
        data = resp.json()
        assert "billNumber" in data
        assert data["billNumber"] is not None


class TestListBills:
    def test_list_empty(self, client):
        """GET /api/bills returns empty when none exist."""
        resp = client.get("/api/bills")
        assert resp.status_code == 200
        data = resp.json()
        bills = data if isinstance(data, list) else data.get("bills", [])
        assert len(bills) == 0

    def test_list_after_creating(self, client):
        """GET /api/bills returns all bills."""
        accounts, contact = _setup(client)
        _create_bill(client, contact["id"])
        _create_bill(client, contact["id"], lines=[
            {"description": "Item 2", "quantity": 1, "unitPrice": 75.00},
        ])
        resp = client.get("/api/bills")
        data = resp.json()
        bills = data if isinstance(data, list) else data.get("bills", [])
        assert len(bills) == 2

    def test_filter_by_status(self, client):
        """GET /api/bills?status=draft returns only drafts."""
        accounts, contact = _setup(client)
        _create_bill(client, contact["id"])
        resp = client.get("/api/bills", params={"status": "draft"})
        data = resp.json()
        bills = data if isinstance(data, list) else data.get("bills", [])
        assert len(bills) == 1
        assert bills[0]["status"] == "draft"


class TestGetBill:
    def test_get_by_id_includes_lines(self, client):
        """GET /api/bills/:id returns bill with lines."""
        accounts, contact = _setup(client)
        created = _create_bill(client, contact["id"]).json()
        resp = client.get(f"/api/bills/{created['id']}")
        assert resp.status_code == 200
        data = resp.json()
        assert "lines" in data
        assert len(data["lines"]) == 1


class TestReceiveBill:
    def test_receive_changes_status(self, client):
        """POST /api/bills/:id/receive sets status to 'received'."""
        accounts, contact = _setup(client)
        created = _create_bill(client, contact["id"]).json()
        resp = client.post(f"/api/bills/{created['id']}/receive")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "received"

    def test_receive_creates_journal_entry(self, client):
        """Receiving a bill should create a journal entry (debit expense, credit AP)."""
        accounts, contact = _setup(client)
        created = _create_bill(client, contact["id"]).json()
        resp = client.post(f"/api/bills/{created['id']}/receive")
        data = resp.json()
        assert data.get("journalEntryId") is not None or data.get("journal_entry_id") is not None

    def test_receive_missing_returns_404(self, client):
        """POST /api/bills/999/receive returns 404."""
        resp = client.post("/api/bills/999/receive")
        assert resp.status_code == 404


class TestBillPayments:
    def _create_and_receive(self, client):
        """Helper: create and receive a bill, return (bill, accounts)."""
        accounts, contact = _setup(client)
        bill = _create_bill(client, contact["id"], lines=[
            {"description": "Service", "quantity": 1, "unitPrice": 800.00},
        ]).json()
        client.post(f"/api/bills/{bill['id']}/receive")
        bill = client.get(f"/api/bills/{bill['id']}").json()
        return bill, accounts

    def test_partial_payment(self, client):
        """Partial payment increases amountPaid but keeps status as received."""
        bill, accounts = self._create_and_receive(client)
        cash = accounts["1000"]

        resp = client.post(f"/api/bills/{bill['id']}/payment", json={
            "amount": 300.00,
            "paymentAccountId": cash["id"],
        })
        assert resp.status_code in (200, 201)
        updated = client.get(f"/api/bills/{bill['id']}").json()
        assert updated["amountPaid"] == 300.00
        assert updated["status"] == "received"

    def test_full_payment(self, client):
        """Full payment sets status to 'paid'."""
        bill, accounts = self._create_and_receive(client)
        cash = accounts["1000"]

        client.post(f"/api/bills/{bill['id']}/payment", json={
            "amount": 800.00,
            "paymentAccountId": cash["id"],
        })
        updated = client.get(f"/api/bills/{bill['id']}").json()
        assert updated["amountPaid"] == 800.00
        assert updated["status"] == "paid"

    def test_multiple_partial_payments(self, client):
        """Multiple partial payments summing to total set status to paid."""
        bill, accounts = self._create_and_receive(client)
        cash = accounts["1000"]

        client.post(f"/api/bills/{bill['id']}/payment", json={
            "amount": 200.00,
            "paymentAccountId": cash["id"],
        })
        client.post(f"/api/bills/{bill['id']}/payment", json={
            "amount": 600.00,
            "paymentAccountId": cash["id"],
        })
        updated = client.get(f"/api/bills/{bill['id']}").json()
        assert updated["amountPaid"] == 800.00
        assert updated["status"] == "paid"

    def test_payment_on_missing_bill(self, client):
        """POST /api/bills/999/payment returns 404."""
        resp = client.post("/api/bills/999/payment", json={
            "amount": 100.00,
            "paymentAccountId": 1,
        })
        assert resp.status_code == 404
