"""Tests for Deal CRUD, pipeline view, and Kanban move operations."""

import pytest


def _create_stage(client, **overrides):
    """Helper to create a deal stage."""
    data = {
        "name": "Prospecting",
        "position": 1,
        "probabilityDefault": 10,
        "color": "#3b82f6",
        "isClosedWon": False,
        "isClosedLost": False,
    }
    data.update(overrides)
    resp = client.post("/api/stages", json=data)
    assert resp.status_code == 200
    return resp.json()


def _create_deal(client, stage_id, **overrides):
    """Helper to create a deal."""
    data = {
        "title": "Big Enterprise Deal",
        "stageId": stage_id,
        "value": 50000,
        "currency": "USD",
        "priority": "high",
        "description": "A large deal with an enterprise client.",
    }
    data.update(overrides)
    resp = client.post("/api/deals", json=data)
    assert resp.status_code == 200
    return resp.json()


class TestCreateDeal:
    def test_create_deal(self, client):
        stage = _create_stage(client)
        deal = _create_deal(client, stage["id"])
        assert deal["title"] == "Big Enterprise Deal"
        assert deal["stageId"] == stage["id"]
        assert deal["value"] == 50000
        assert deal["currency"] == "USD"
        assert deal["priority"] == "high"
        assert deal["status"] == "open"
        assert deal["id"] is not None
        assert deal["createdAt"] is not None

    def test_create_deal_invalid_stage(self, client):
        resp = client.post("/api/deals", json={
            "title": "Ghost Deal",
            "stageId": 999,
            "value": 100,
        })
        assert resp.status_code == 400

    def test_create_deal_inherits_stage_probability(self, client):
        stage = _create_stage(client, name="Qualified", probabilityDefault=40)
        deal = _create_deal(client, stage["id"])
        assert deal["probability"] == 40


class TestListDeals:
    def test_list_deals_empty(self, client):
        resp = client.get("/api/deals")
        assert resp.status_code == 200
        body = resp.json()
        assert body["items"] == []
        assert body["total"] == 0

    def test_list_deals(self, client):
        stage = _create_stage(client)
        _create_deal(client, stage["id"], title="Deal A")
        _create_deal(client, stage["id"], title="Deal B")
        resp = client.get("/api/deals")
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 2

    def test_list_deals_filter_by_status(self, client):
        stage = _create_stage(client)
        _create_deal(client, stage["id"], title="Open Deal")
        resp = client.get("/api/deals", params={"status": "open"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1

    def test_list_deals_filter_by_stage(self, client):
        stage1 = _create_stage(client, name="Stage A", position=1)
        stage2 = _create_stage(client, name="Stage B", position=2)
        _create_deal(client, stage1["id"], title="In A")
        _create_deal(client, stage2["id"], title="In B")
        resp = client.get("/api/deals", params={"stage_id": stage1["id"]})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["items"][0]["title"] == "In A"


class TestGetDeal:
    def test_get_deal(self, client):
        stage = _create_stage(client)
        deal = _create_deal(client, stage["id"])
        resp = client.get(f"/api/deals/{deal['id']}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == deal["id"]
        assert body["title"] == "Big Enterprise Deal"

    def test_get_deal_not_found(self, client):
        resp = client.get("/api/deals/999")
        assert resp.status_code == 404


class TestUpdateDeal:
    def test_update_deal(self, client):
        stage = _create_stage(client)
        deal = _create_deal(client, stage["id"])
        resp = client.put(
            f"/api/deals/{deal['id']}",
            json={"title": "Updated Deal", "value": 75000},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["title"] == "Updated Deal"
        assert body["value"] == 75000

    def test_update_deal_not_found(self, client):
        resp = client.put("/api/deals/999", json={"title": "Ghost"})
        assert resp.status_code == 404


class TestDeleteDeal:
    def test_delete_deal(self, client):
        stage = _create_stage(client)
        deal = _create_deal(client, stage["id"])
        resp = client.delete(f"/api/deals/{deal['id']}")
        assert resp.status_code == 200
        assert resp.json()["status"] == "deleted"

        resp = client.get(f"/api/deals/{deal['id']}")
        assert resp.status_code == 404

    def test_delete_deal_not_found(self, client):
        resp = client.delete("/api/deals/999")
        assert resp.status_code == 404


class TestMoveDeal:
    def test_move_deal(self, client):
        stage1 = _create_stage(client, name="Prospecting", position=1, probabilityDefault=10)
        stage2 = _create_stage(client, name="Negotiation", position=2, probabilityDefault=60)
        deal = _create_deal(client, stage1["id"])

        resp = client.put(f"/api/deals/{deal['id']}/move", json={
            "stageId": stage2["id"],
            "position": 0,
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["stageId"] == stage2["id"]
        assert body["probability"] == 60
        assert body["status"] == "open"

    def test_move_deal_invalid_stage(self, client):
        stage = _create_stage(client)
        deal = _create_deal(client, stage["id"])
        resp = client.put(f"/api/deals/{deal['id']}/move", json={
            "stageId": 9999,
            "position": 0,
        })
        assert resp.status_code == 400

    def test_move_deal_not_found(self, client):
        stage = _create_stage(client)
        resp = client.put("/api/deals/999/move", json={
            "stageId": stage["id"],
            "position": 0,
        })
        assert resp.status_code == 404


class TestDealWonOnClosedStage:
    def test_deal_won_on_closed_stage(self, client):
        """Moving a deal to a 'Closed Won' stage should auto-set status to 'won'."""
        open_stage = _create_stage(client, name="Open", position=1, probabilityDefault=20)
        won_stage = _create_stage(
            client, name="Closed Won", position=10,
            probabilityDefault=100, isClosedWon=True,
        )
        deal = _create_deal(client, open_stage["id"])
        assert deal["status"] == "open"

        resp = client.put(f"/api/deals/{deal['id']}/move", json={
            "stageId": won_stage["id"],
            "position": 0,
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "won"
        assert body["actualCloseDate"] is not None

    def test_deal_lost_on_closed_lost_stage(self, client):
        """Moving a deal to a 'Closed Lost' stage should auto-set status to 'lost'."""
        open_stage = _create_stage(client, name="Open", position=1)
        lost_stage = _create_stage(
            client, name="Closed Lost", position=11,
            probabilityDefault=0, isClosedLost=True,
        )
        deal = _create_deal(client, open_stage["id"])
        resp = client.put(f"/api/deals/{deal['id']}/move", json={
            "stageId": lost_stage["id"],
            "position": 0,
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "lost"
        assert body["actualCloseDate"] is not None


class TestPipelineView:
    def test_pipeline_view(self, client):
        stage1 = _create_stage(client, name="Lead", position=1)
        stage2 = _create_stage(client, name="Qualified", position=2)
        _create_deal(client, stage1["id"], title="Deal in Lead")
        _create_deal(client, stage2["id"], title="Deal in Qualified")

        resp = client.get("/api/deals/pipeline")
        assert resp.status_code == 200
        pipeline = resp.json()
        assert isinstance(pipeline, list)
        assert len(pipeline) == 2
        assert pipeline[0]["name"] == "Lead"
        assert len(pipeline[0]["deals"]) == 1
        assert pipeline[1]["name"] == "Qualified"
        assert len(pipeline[1]["deals"]) == 1

    def test_pipeline_view_empty(self, client):
        resp = client.get("/api/deals/pipeline")
        assert resp.status_code == 200
        assert resp.json() == []
