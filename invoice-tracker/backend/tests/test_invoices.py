"""
Unit and Integration Tests for Invoice & Subscription Tracker
"""

import pytest
from datetime import datetime, timedelta
from parser import parse_email_message, is_invoice_email, extract_amount_and_currency, extract_vendor


def test_parser_detects_openai_subscription():
    """Test OpenAI invoice detection and field extraction."""
    subject = "Your receipt for OpenAI API & ChatGPT Plus"
    sender = "billing@openai.com"
    body = "Hi Alex, thank you for using OpenAI. We charged $35.00 for your developer API credit tier and monthly ChatGPT Plus seat.\nBilling Period: Aug 17 - Sep 17"
    
    parsed = parse_email_message(subject, sender, body, has_attachment=True, pdf_filename="OpenAI_Invoice.pdf")
    assert parsed["is_invoice"] is True
    assert parsed["vendor"] == "OpenAI"
    assert parsed["amount"] == 35.00
    assert parsed["currency"] == "USD"
    assert parsed["payment_type"] == "subscription"
    assert parsed["billing_frequency"] == "monthly"
    assert parsed["has_pdf_attachment"] is True
    assert parsed["confidence_score"] > 0.6


def test_parser_detects_uber_onetime_receipt():
    """Test Uber ride receipt classified as one_time purchase."""
    subject = "Your Tuesday evening trip with Uber"
    sender = "uber.receipts@uber.com"
    body = "Thanks for riding, Alex! Total fare for your trip: $28.75. Dropoff: Airport Terminal 2."
    
    parsed = parse_email_message(subject, sender, body, has_attachment=True, pdf_filename="Uber_Receipt.pdf")
    assert parsed["is_invoice"] is True
    assert parsed["vendor"] == "Uber"
    assert parsed["amount"] == 28.75
    assert parsed["payment_type"] == "one_time"
    assert parsed["billing_frequency"] == "none"


def test_parser_rejects_marketing_newsletter():
    """Test marketing newsletter is classified as not an invoice."""
    subject = "Our Summer Sale ends soon! Check out new features"
    sender = "newsletter@acmeproducts.io"
    body = "Don't miss our massive discount. Unsubscribe anytime by clicking here. Privacy policy applies."
    
    is_inv, conf, reason = is_invoice_email(subject, sender, body)
    assert is_inv is False


def test_dashboard_stats_endpoint(client, db):
    """Test GET /api/dashboard/stats computes metrics correctly."""
    # Seed an invoice
    client.post("/api/invoices", json={
        "vendor": "Figma",
        "amount": 15.00,
        "currency": "USD",
        "payment_type": "subscription",
        "billing_frequency": "monthly",
        "category": "Design & Creative",
        "purpose": "Figma Pro design seat",
        "has_pdf_attachment": True
    })

    # Seed a subscription
    client.post("/api/subscriptions", json={
        "name": "Figma Pro",
        "vendor": "Figma",
        "amount": 15.00,
        "currency": "USD",
        "billing_frequency": "monthly",
        "category": "Design & Creative",
        "purpose": "Figma recurring license"
    })

    resp = client.get("/api/dashboard/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert data["totalSpentAllTime"] >= 15.00
    assert data["monthlyRecurringBurn"] >= 15.00
    assert data["activeSubscriptionsCount"] >= 1
    assert len(data["categoryBreakdown"]) >= 1


def test_simulate_email_bill(client):
    """Test simulating incoming email bill creates invoice and subscription."""
    resp = client.post("/api/email/simulate", json={"preset": "aws"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["isInvoice"] is True
    assert "Amazon Web Services" in data["invoice"]["vendor"]
    assert data["invoice"]["amount"] > 0
    assert data["subscription"] is not None

    # Check that invoice appears in /api/invoices
    inv_list_resp = client.get("/api/invoices")
    assert inv_list_resp.status_code == 200
    invoices = inv_list_resp.json()
    assert any(inv["vendor"] == "Amazon Web Services" for inv in invoices)


def test_subscription_status_toggle(client):
    """Test toggling subscription status between active and paused."""
    # Create subscription directly
    sub_resp = client.post("/api/subscriptions", json={
        "name": "Netflix",
        "vendor": "Netflix",
        "amount": 22.99,
        "billing_frequency": "monthly",
        "category": "Entertainment",
        "purpose": "Streaming subscription"
    })
    assert sub_resp.status_code == 200
    sub_id = sub_resp.json()["id"]

    # Toggle status
    toggle_resp = client.patch(f"/api/subscriptions/{sub_id}/toggle-status")
    assert toggle_resp.status_code == 200
    assert toggle_resp.json()["status"] == "paused"

    # Toggle back
    toggle_resp2 = client.patch(f"/api/subscriptions/{sub_id}/toggle-status")
    assert toggle_resp2.status_code == 200
    assert toggle_resp2.json()["status"] == "active"


def test_agent_compliance_state(client):
    """Test /api/state and /api/action endpoints."""
    # Test state get/put
    put_resp = client.put("/api/state", json={"data": {"filter": "subscriptions"}})
    assert put_resp.status_code == 200
    assert put_resp.json()["data"]["filter"] == "subscriptions"

    get_resp = client.get("/api/state")
    assert get_resp.status_code == 200
    assert get_resp.json()["data"]["filter"] == "subscriptions"

    # Test action
    act_resp = client.post("/api/action", json={"action": "sync_email", "payload": {}})
    assert act_resp.status_code == 200
    assert act_resp.json()["status"] == "synced"


def test_exact_dashboard_calculations(client):
    """Verify that user-added subscriptions and invoices calculate exact numbers."""
    # 1. Add subscription of $35.00/mo
    sub_resp = client.post("/api/subscriptions", json={
        "name": "Cursor AI Pro",
        "vendor": "Cursor AI",
        "amount": 35.00,
        "billing_frequency": "monthly",
        "category": "Developer Tools & DevOps",
    })
    assert sub_resp.status_code == 200

    # 2. Add one-time invoice of $150.00
    inv_resp = client.post("/api/invoices", json={
        "vendor": "Amazon Web Services",
        "amount": 150.00,
        "payment_type": "one_time",
        "category": "Cloud Infrastructure",
    })
    assert inv_resp.status_code == 200

    # 3. Retrieve stats
    stats_resp = client.get("/api/dashboard/stats")
    assert stats_resp.status_code == 200
    stats = stats_resp.json()
    assert stats["totalSpentAllTime"] == 150.00
    assert stats["monthlyRecurringBurn"] == 35.00
    assert stats["activeSubscriptionsCount"] == 1
    assert stats["totalInvoicesCount"] == 1

    # 4. Verify that live ingestion feed recorded both events
    act_resp = client.get("/api/activity")
    assert act_resp.status_code == 200
    activities = act_resp.json()
    assert len(activities) >= 2
    assert any("Cursor AI" in a.get("title", "") or "Cursor AI" in a.get("description", "") for a in activities)
    assert any("Amazon Web Services" in a.get("title", "") or "Amazon Web Services" in a.get("description", "") for a in activities)


def test_receipt_does_not_add_to_active_subscriptions(client):
    """Verify that creating a monthly receipt/invoice adds to invoices and NOT to subscriptions."""
    initial_subs = client.get("/api/subscriptions").json()
    initial_count = len(initial_subs)

    inv_resp = client.post("/api/invoices", json={
        "vendor": "Spotify Premium",
        "amount": 10.99,
        "payment_type": "subscription",
        "billing_frequency": "monthly",
        "category": "Entertainment",
        "purpose": "Monthly family plan receipt",
    })
    assert inv_resp.status_code == 200

    # Verify subscriptions count has NOT increased
    subs_resp = client.get("/api/subscriptions")
    assert subs_resp.status_code == 200
    subs = subs_resp.json()
    assert len(subs) == initial_count


def test_yearly_history_reflects_only_exact_invoices(client):
    """Verify that yearly history calculates strictly from real invoices with zero synthetic money in prev years."""
    # Post a single invoice in 2026
    client.post("/api/invoices", json={
        "vendor": "Vercel Enterprise",
        "amount": 200.00,
        "payment_type": "subscription",
        "category": "Cloud Infrastructure",
        "invoice_date": "2026-08-15T12:00:00Z"
    })

    resp = client.get("/api/yearly-history")
    assert resp.status_code == 200
    data = resp.json()
    
    # 2026 should have exact invoice
    y2026 = next((y for y in data["yearlySummaries"] if y["year"] == 2026), None)
    assert y2026 is not None
    assert y2026["totalSpend"] == 200.00
    assert y2026["invoiceCount"] == 1

    # 2025, 2024, 2023 must have EXACTLY $0.00 spent and 0 invoices (no fake historical money)
    for prev_y in [2025, 2024, 2023]:
        y_item = next((y for y in data["yearlySummaries"] if y["year"] == prev_y), None)
        assert y_item is not None
        assert y_item["totalSpend"] == 0.0
        assert y_item["invoiceCount"] == 0


def test_update_workspace_group(client):
    """Verify that updating a workspace group persists changes to name, description, and color."""
    # 1. Create a group
    create_resp = client.post("/api/groups", json={
        "name": "Design Systems",
        "description": "Figma and Adobe licenses",
        "color": "#635BFF",
        "currency": "USD"
    })
    assert create_resp.status_code == 200
    grp = create_resp.json()
    grp_id = grp["id"]

    # 2. Update the group
    update_resp = client.put(f"/api/groups/{grp_id}", json={
        "name": "Creative Operations",
        "description": "Updated design and branding stack",
        "color": "#00A67E"
    })
    assert update_resp.status_code == 200
    updated = update_resp.json()
    assert updated["name"] == "Creative Operations"
    assert updated["description"] == "Updated design and branding stack"
    assert updated["color"] == "#00A67E"

    # 3. Verify list includes updated group
    list_resp = client.get("/api/groups")
    assert list_resp.status_code == 200
    groups = list_resp.json()
    target = next((g for g in groups if g["id"] == grp_id), None)
    assert target is not None
    assert target["name"] == "Creative Operations"
    assert target["description"] == "Updated design and branding stack"
    assert target["color"] == "#00A67E"





