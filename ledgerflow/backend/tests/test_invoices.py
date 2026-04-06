"""
Tests for Invoice API endpoints.

Covers create, list, send, payments, and status transitions.
"""

import pytest


def _setup(client):
    """Seed accounts and create a customer contact. Returns (accounts_dict, contact)."""
    client.post("/api/settings/seed")
    accounts = {a["code"]: a for a in client.get("/api/accounts").json()}
    contact = client.post("/api/contacts", json={
        "name": "Invoice Customer",
        "contactType": "customer",
    }).json()
    return accounts, contact


def _find_account(accounts, code_prefix, account_type=None):
    for code, acct in sorted(accounts.items()):
        if code.startswith(code_prefix):
            if account_type is None or acct["accountType"] == account_type:
                return acct
    return None


def _create_invoice(client, contact_id, **overrides):
    """Helper to create a basic invoice."""
    payload = {
        "contactId": contact_id,
        "issueDate": "2025-01-15",
        "dueDate": "2025-02-15",
        "lines": [
            {"description": "Consulting", "quantity": 10, "unitPrice": 100.00},
        ],
    }
    payload.update(overrides)
    return client.post("/api/invoices", json=payload)


class TestCreateInvoice:
    def test_create_draft_single_line(self, client):
        """POST /api/invoices with one line returns 201, status=draft."""
        accounts, contact = _setup(client)
        resp = _create_invoice(client, contact["id"])
        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "draft"
        assert "id" in data
        # subtotal = 10 * 100 = 1000
        assert data["subtotal"] == 1000.00
        assert data["total"] == 1000.00

    def test_create_multiple_lines(self, client):
        """Invoice with multiple lines sums correctly."""
        accounts, contact = _setup(client)
        resp = _create_invoice(client, contact["id"], lines=[
            {"description": "Service A", "quantity": 5, "unitPrice": 200.00},
            {"description": "Service B", "quantity": 2, "unitPrice": 350.00},
        ])
        assert resp.status_code == 201
        data = resp.json()
        # subtotal = 5*200 + 2*350 = 1000 + 700 = 1700
        assert data["subtotal"] == 1700.00
        assert data["total"] == 1700.00

    def test_create_with_tax(self, client):
        """Invoice with taxRate calculates tax correctly."""
        accounts, contact = _setup(client)
        resp = _create_invoice(client, contact["id"], taxRate=10.0, lines=[
            {"description": "Product", "quantity": 1, "unitPrice": 1000.00},
        ])
        assert resp.status_code == 201
        data = resp.json()
        assert data["subtotal"] == 1000.00
        assert data["taxAmount"] == 100.00  # 1000 * 10 / 100
        assert data["total"] == 1100.00

    def test_auto_assigns_invoice_number(self, client):
        """Invoice should get an auto-assigned invoiceNumber."""
        accounts, contact = _setup(client)
        resp = _create_invoice(client, contact["id"])
        data = resp.json()
        assert "invoiceNumber" in data
        assert data["invoiceNumber"] is not None


class TestListInvoices:
    def test_list_empty(self, client):
        """GET /api/invoices returns empty list when none exist."""
        resp = client.get("/api/invoices")
        assert resp.status_code == 200
        data = resp.json()
        invoices = data if isinstance(data, list) else data.get("invoices", [])
        assert len(invoices) == 0

    def test_list_after_creating(self, client):
        """GET /api/invoices returns all invoices."""
        accounts, contact = _setup(client)
        _create_invoice(client, contact["id"])
        _create_invoice(client, contact["id"], lines=[
            {"description": "Item 2", "quantity": 1, "unitPrice": 50.00},
        ])
        resp = client.get("/api/invoices")
        data = resp.json()
        invoices = data if isinstance(data, list) else data.get("invoices", [])
        assert len(invoices) == 2

    def test_filter_by_status(self, client):
        """GET /api/invoices?status=draft returns only drafts."""
        accounts, contact = _setup(client)
        _create_invoice(client, contact["id"])
        resp = client.get("/api/invoices", params={"status": "draft"})
        data = resp.json()
        invoices = data if isinstance(data, list) else data.get("invoices", [])
        assert len(invoices) == 1
        assert invoices[0]["status"] == "draft"


class TestGetInvoice:
    def test_get_by_id_includes_lines(self, client):
        """GET /api/invoices/:id returns invoice with lines."""
        accounts, contact = _setup(client)
        created = _create_invoice(client, contact["id"]).json()
        resp = client.get(f"/api/invoices/{created['id']}")
        assert resp.status_code == 200
        data = resp.json()
        assert "lines" in data
        assert len(data["lines"]) == 1


class TestSendInvoice:
    def test_send_changes_status(self, client):
        """POST /api/invoices/:id/send sets status to 'sent'."""
        accounts, contact = _setup(client)
        created = _create_invoice(client, contact["id"]).json()
        resp = client.post(f"/api/invoices/{created['id']}/send")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "sent"

    def test_send_creates_journal_entry(self, client):
        """Sending an invoice should create a journal entry (debit AR, credit revenue)."""
        accounts, contact = _setup(client)
        created = _create_invoice(client, contact["id"]).json()
        resp = client.post(f"/api/invoices/{created['id']}/send")
        data = resp.json()
        # Journal entry should be linked
        assert data.get("journalEntryId") is not None or data.get("journal_entry_id") is not None

    def test_send_missing_returns_404(self, client):
        """POST /api/invoices/999/send returns 404."""
        resp = client.post("/api/invoices/999/send")
        assert resp.status_code == 404


class TestInvoicePayments:
    def _create_and_send(self, client):
        """Helper: create and send an invoice, return (invoice, accounts)."""
        accounts, contact = _setup(client)
        inv = _create_invoice(client, contact["id"], lines=[
            {"description": "Work", "quantity": 1, "unitPrice": 1000.00},
        ]).json()
        client.post(f"/api/invoices/{inv['id']}/send")
        inv = client.get(f"/api/invoices/{inv['id']}").json()
        return inv, accounts

    def test_partial_payment(self, client):
        """Partial payment increases amountPaid but keeps status as sent."""
        inv, accounts = self._create_and_send(client)
        cash = accounts["1000"]

        resp = client.post(f"/api/invoices/{inv['id']}/payment", json={
            "amount": 400.00,
            "depositAccountId": cash["id"],
        })
        assert resp.status_code in (200, 201)
        updated = client.get(f"/api/invoices/{inv['id']}").json()
        assert updated["amountPaid"] == 400.00
        assert updated["status"] == "sent"

    def test_full_payment(self, client):
        """Full payment sets status to 'paid'."""
        inv, accounts = self._create_and_send(client)
        cash = accounts["1000"]

        client.post(f"/api/invoices/{inv['id']}/payment", json={
            "amount": 1000.00,
            "depositAccountId": cash["id"],
        })
        updated = client.get(f"/api/invoices/{inv['id']}").json()
        assert updated["amountPaid"] == 1000.00
        assert updated["status"] == "paid"

    def test_multiple_partial_payments(self, client):
        """Multiple partial payments that sum to total set status to paid."""
        inv, accounts = self._create_and_send(client)
        cash = accounts["1000"]

        client.post(f"/api/invoices/{inv['id']}/payment", json={
            "amount": 300.00,
            "depositAccountId": cash["id"],
        })
        client.post(f"/api/invoices/{inv['id']}/payment", json={
            "amount": 700.00,
            "depositAccountId": cash["id"],
        })
        updated = client.get(f"/api/invoices/{inv['id']}").json()
        assert updated["amountPaid"] == 1000.00
        assert updated["status"] == "paid"

    def test_payment_on_missing_invoice(self, client):
        """POST /api/invoices/999/payment returns 404."""
        resp = client.post("/api/invoices/999/payment", json={
            "amount": 100.00,
            "depositAccountId": 1,
        })
        assert resp.status_code == 404
