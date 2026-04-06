"""Tests for Dashboard summary and pipeline endpoints."""

import pytest


def _seed_data(client):
    """Create a set of contacts, companies, stages, and deals for dashboard tests."""
    # Contacts
    for i in range(3):
        client.post("/api/contacts", json={
            "firstName": f"Contact{i}", "lastName": "Test", "email": f"c{i}@test.com",
        })

    # Companies
    for name in ["Alpha", "Beta"]:
        client.post("/api/companies", json={"name": name})

    # Stages
    stage1 = client.post("/api/stages", json={
        "name": "Prospecting", "position": 1, "probabilityDefault": 10, "color": "#3b82f6",
    }).json()
    stage2 = client.post("/api/stages", json={
        "name": "Negotiation", "position": 2, "probabilityDefault": 50, "color": "#f59e0b",
    }).json()
    won_stage = client.post("/api/stages", json={
        "name": "Closed Won", "position": 3, "probabilityDefault": 100,
        "color": "#22c55e", "isClosedWon": True,
    }).json()

    # Open deals
    client.post("/api/deals", json={
        "title": "Open Deal 1", "stageId": stage1["id"], "value": 10000,
    })
    client.post("/api/deals", json={
        "title": "Open Deal 2", "stageId": stage2["id"], "value": 25000,
    })

    # Won deal (move to closed won stage)
    deal3 = client.post("/api/deals", json={
        "title": "Won Deal", "stageId": stage1["id"], "value": 50000,
    }).json()
    client.put(f"/api/deals/{deal3['id']}/move", json={
        "stageId": won_stage["id"], "position": 0,
    })

    return {
        "stages": [stage1, stage2, won_stage],
    }


class TestDashboardSummary:
    def test_dashboard_summary_empty(self, client):
        resp = client.get("/api/dashboard/summary")
        assert resp.status_code == 200
        body = resp.json()
        assert body["totalContacts"] == 0
        assert body["totalCompanies"] == 0
        assert body["openDeals"] == 0
        assert body["wonDeals"] == 0
        assert body["pipelineValue"] == 0

    def test_dashboard_summary(self, client):
        _seed_data(client)
        resp = client.get("/api/dashboard/summary")
        assert resp.status_code == 200
        body = resp.json()
        assert body["totalContacts"] == 3
        assert body["totalCompanies"] == 2
        assert body["openDeals"] == 2
        assert body["wonDeals"] == 1
        assert body["pipelineValue"] == 35000  # 10000 + 25000
        assert body["wonValue"] == 50000
        assert body["conversionRate"] == 100.0  # 1 won, 0 lost -> 100%
        assert "overdueTasks" in body
        assert "upcomingTasks" in body
        assert "newContactsMonth" in body


class TestDashboardPipeline:
    def test_dashboard_pipeline_empty(self, client):
        resp = client.get("/api/dashboard/pipeline")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_dashboard_pipeline(self, client):
        info = _seed_data(client)
        resp = client.get("/api/dashboard/pipeline")
        assert resp.status_code == 200
        pipeline = resp.json()
        assert len(pipeline) == 3

        # First stage has 1 open deal (10000)
        assert pipeline[0]["name"] == "Prospecting"
        assert pipeline[0]["dealCount"] == 1
        assert pipeline[0]["totalValue"] == 10000

        # Second stage has 1 open deal (25000)
        assert pipeline[1]["name"] == "Negotiation"
        assert pipeline[1]["dealCount"] == 1
        assert pipeline[1]["totalValue"] == 25000

        # Won stage shows 0 open deals (the deal there has status=won)
        assert pipeline[2]["name"] == "Closed Won"
        assert pipeline[2]["dealCount"] == 0
