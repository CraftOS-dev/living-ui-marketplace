"""Tests for global search across contacts, companies, and deals."""

import pytest


class TestGlobalSearch:
    def test_global_search_contacts(self, client):
        client.post("/api/contacts", json={
            "firstName": "Searchable", "lastName": "Person", "email": "search@test.com",
        })
        resp = client.get("/api/search", params={"q": "Searchable"})
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["contacts"]) == 1
        assert body["contacts"][0]["firstName"] == "Searchable"
        assert isinstance(body["companies"], list)
        assert isinstance(body["deals"], list)

    def test_global_search_companies(self, client):
        client.post("/api/companies", json={"name": "Unique Corp", "domain": "uniquecorp.com"})
        resp = client.get("/api/search", params={"q": "Unique Corp"})
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["companies"]) == 1
        assert body["companies"][0]["name"] == "Unique Corp"

    def test_global_search_deals(self, client):
        stage = client.post("/api/stages", json={"name": "Pipeline"}).json()
        client.post("/api/deals", json={
            "title": "Mega Deal XYZ", "stageId": stage["id"], "value": 100000,
        })
        resp = client.get("/api/search", params={"q": "Mega Deal"})
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["deals"]) == 1
        assert body["deals"][0]["title"] == "Mega Deal XYZ"

    def test_global_search_across_types(self, client):
        """A single search term can match contacts, companies, and deals simultaneously."""
        client.post("/api/contacts", json={
            "firstName": "Alpha", "lastName": "User", "email": "alpha@alpha.com",
        })
        client.post("/api/companies", json={"name": "Alpha Industries"})
        stage = client.post("/api/stages", json={"name": "Stage"}).json()
        client.post("/api/deals", json={
            "title": "Alpha Project", "stageId": stage["id"], "value": 5000,
        })

        resp = client.get("/api/search", params={"q": "Alpha"})
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["contacts"]) >= 1
        assert len(body["companies"]) >= 1
        assert len(body["deals"]) >= 1

    def test_global_search_no_results(self, client):
        resp = client.get("/api/search", params={"q": "zzzznonexistent"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["contacts"] == []
        assert body["companies"] == []
        assert body["deals"] == []

    def test_global_search_by_email(self, client):
        client.post("/api/contacts", json={
            "firstName": "Email", "lastName": "Finder", "email": "findme@specific.com",
        })
        resp = client.get("/api/search", params={"q": "findme@specific"})
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["contacts"]) == 1

    def test_global_search_by_domain(self, client):
        client.post("/api/companies", json={"name": "Domain Co", "domain": "specialdomain.io"})
        resp = client.get("/api/search", params={"q": "specialdomain"})
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["companies"]) == 1
