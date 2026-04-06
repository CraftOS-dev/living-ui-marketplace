"""
Tests for Settings API endpoints.

Covers GET/PUT settings and POST seed for chart of accounts.
"""


class TestGetSettings:
    def test_get_default_settings(self, client):
        """GET /api/settings returns sensible defaults."""
        resp = client.get("/api/settings")
        assert resp.status_code == 200
        data = resp.json()
        assert data["businessName"] == "My Business"
        assert data["currency"] == "USD"
        assert data["taxRate"] == 0.0

    def test_get_settings_includes_all_fields(self, client):
        """Response should include all expected setting fields."""
        resp = client.get("/api/settings")
        data = resp.json()
        for key in ("businessName", "currency", "taxRate"):
            assert key in data


class TestUpdateSettings:
    def test_update_business_name(self, client):
        """PUT /api/settings can update businessName."""
        resp = client.put("/api/settings", json={"businessName": "Acme Corp"})
        assert resp.status_code == 200
        assert resp.json()["businessName"] == "Acme Corp"

    def test_update_currency(self, client):
        """PUT /api/settings can update currency."""
        resp = client.put("/api/settings", json={"currency": "EUR"})
        assert resp.status_code == 200
        assert resp.json()["currency"] == "EUR"

    def test_update_tax_rate(self, client):
        """PUT /api/settings can update taxRate."""
        resp = client.put("/api/settings", json={"taxRate": 8.5})
        assert resp.status_code == 200
        assert resp.json()["taxRate"] == 8.5

    def test_update_multiple_fields(self, client):
        """PUT /api/settings can update several fields at once."""
        resp = client.put("/api/settings", json={
            "businessName": "New Co",
            "currency": "GBP",
            "taxRate": 20.0,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["businessName"] == "New Co"
        assert data["currency"] == "GBP"
        assert data["taxRate"] == 20.0

    def test_update_persists(self, client):
        """Updated settings persist across GET calls."""
        client.put("/api/settings", json={"businessName": "Persisted"})
        resp = client.get("/api/settings")
        assert resp.json()["businessName"] == "Persisted"


class TestSeedAccounts:
    def test_seed_creates_accounts(self, client):
        """POST /api/settings/seed should create chart of accounts."""
        resp = client.post("/api/settings/seed")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("status") in ("seeded", "created")

    def test_seed_creates_at_least_20_accounts(self, client):
        """After seeding, there should be at least 20 accounts."""
        client.post("/api/settings/seed")
        resp = client.get("/api/accounts")
        assert resp.status_code == 200
        accounts = resp.json()
        assert len(accounts) >= 20

    def test_seed_is_idempotent(self, client):
        """Second seed call should not duplicate accounts."""
        client.post("/api/settings/seed")
        resp1 = client.get("/api/accounts")
        count1 = len(resp1.json())

        resp2 = client.post("/api/settings/seed")
        assert resp2.status_code == 200
        data2 = resp2.json()
        assert data2.get("status") in ("skipped", "already_seeded", "seeded")

        resp3 = client.get("/api/accounts")
        count2 = len(resp3.json())
        assert count2 == count1

    def test_seed_creates_all_account_types(self, client):
        """Seeded accounts should span all 5 types: asset, liability, equity, revenue, expense."""
        client.post("/api/settings/seed")
        accounts = client.get("/api/accounts").json()
        types_found = {a["accountType"] for a in accounts}
        for expected_type in ("asset", "liability", "equity", "revenue", "expense"):
            assert expected_type in types_found, f"Missing account type: {expected_type}"

    def test_seed_creates_expected_codes(self, client):
        """Seeded accounts should include standard codes like 1000, 1200, 2000."""
        client.post("/api/settings/seed")
        accounts = client.get("/api/accounts").json()
        codes = {a["code"] for a in accounts}
        for expected_code in ("1000", "1010", "1200", "2000"):
            assert expected_code in codes, f"Missing account code: {expected_code}"

    def test_get_settings_after_seed(self, client):
        """Settings should still be accessible after seeding."""
        client.post("/api/settings/seed")
        resp = client.get("/api/settings")
        assert resp.status_code == 200
        assert "businessName" in resp.json()
