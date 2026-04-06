"""Tests for Company CRUD and company-contacts relationship."""

import pytest


def _create_company(client, **overrides):
    """Helper to create a company with default data."""
    data = {
        "name": "Acme Corp",
        "domain": "acme.com",
        "industry": "Technology",
        "size": "51-200",
        "annualRevenue": 5000000,
        "phone": "+1-555-0200",
        "website": "https://acme.com",
        "city": "Austin",
        "state": "TX",
        "country": "US",
        "description": "A technology company.",
    }
    data.update(overrides)
    resp = client.post("/api/companies", json=data)
    assert resp.status_code == 200
    return resp.json()


def _create_contact(client, **overrides):
    data = {
        "firstName": "John",
        "lastName": "Doe",
        "email": "john@example.com",
    }
    data.update(overrides)
    resp = client.post("/api/contacts", json=data)
    assert resp.status_code == 200
    return resp.json()


class TestCreateCompany:
    def test_create_company(self, client):
        body = _create_company(client)
        assert body["name"] == "Acme Corp"
        assert body["domain"] == "acme.com"
        assert body["industry"] == "Technology"
        assert body["size"] == "51-200"
        assert body["annualRevenue"] == 5000000
        assert body["id"] is not None
        assert body["createdAt"] is not None

    def test_create_company_minimal(self, client):
        resp = client.post("/api/companies", json={"name": "Minimal Inc"})
        assert resp.status_code == 200
        assert resp.json()["name"] == "Minimal Inc"

    def test_create_company_missing_name(self, client):
        resp = client.post("/api/companies", json={"domain": "noname.com"})
        assert resp.status_code == 422


class TestListCompanies:
    def test_list_companies_empty(self, client):
        resp = client.get("/api/companies")
        assert resp.status_code == 200
        body = resp.json()
        assert body["items"] == []
        assert body["total"] == 0

    def test_list_companies(self, client):
        _create_company(client, name="Alpha Inc", domain="alpha.com")
        _create_company(client, name="Beta LLC", domain="beta.com")
        resp = client.get("/api/companies")
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 2

    def test_list_companies_search(self, client):
        _create_company(client, name="Unique Company", domain="unique.com")
        _create_company(client, name="Other Company", domain="other.com")
        resp = client.get("/api/companies", params={"search": "Unique"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["items"][0]["name"] == "Unique Company"

    def test_list_companies_filter_by_industry(self, client):
        _create_company(client, name="Tech Co", industry="Technology")
        _create_company(client, name="Health Co", industry="Healthcare")
        resp = client.get("/api/companies", params={"industry": "Healthcare"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["items"][0]["industry"] == "Healthcare"


class TestGetCompany:
    def test_get_company(self, client):
        created = _create_company(client)
        resp = client.get(f"/api/companies/{created['id']}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == created["id"]
        assert body["name"] == "Acme Corp"

    def test_get_company_not_found(self, client):
        resp = client.get("/api/companies/999")
        assert resp.status_code == 404


class TestUpdateCompany:
    def test_update_company(self, client):
        created = _create_company(client)
        resp = client.put(
            f"/api/companies/{created['id']}",
            json={"name": "Acme Incorporated", "industry": "SaaS"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "Acme Incorporated"
        assert body["industry"] == "SaaS"
        # Unchanged fields preserved
        assert body["domain"] == "acme.com"

    def test_update_company_not_found(self, client):
        resp = client.put("/api/companies/999", json={"name": "Ghost"})
        assert resp.status_code == 404


class TestDeleteCompany:
    def test_delete_company(self, client):
        created = _create_company(client)
        resp = client.delete(f"/api/companies/{created['id']}")
        assert resp.status_code == 200
        assert resp.json()["status"] == "deleted"

        resp = client.get(f"/api/companies/{created['id']}")
        assert resp.status_code == 404

    def test_delete_company_not_found(self, client):
        resp = client.delete("/api/companies/999")
        assert resp.status_code == 404


class TestCompanyContacts:
    def test_company_contacts(self, client):
        company = _create_company(client)
        _create_contact(client, firstName="Alice", lastName="A", email="a@test.com", companyId=company["id"])
        _create_contact(client, firstName="Bob", lastName="B", email="b@test.com", companyId=company["id"])
        _create_contact(client, firstName="Charlie", lastName="C", email="c@test.com")  # no company

        resp = client.get(f"/api/companies/{company['id']}/contacts")
        assert resp.status_code == 200
        contacts = resp.json()
        assert len(contacts) == 2
        names = {c["firstName"] for c in contacts}
        assert "Alice" in names
        assert "Bob" in names

    def test_company_contacts_empty(self, client):
        company = _create_company(client)
        resp = client.get(f"/api/companies/{company['id']}/contacts")
        assert resp.status_code == 200
        assert resp.json() == []
