"""Tests for Deal Stage CRUD and deletion constraints."""

import pytest


def _create_stage(client, **overrides):
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


class TestListStages:
    def test_list_stages_empty(self, client):
        """Without seeding, stages list should be empty in test DB."""
        resp = client.get("/api/stages")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_stages_ordered_by_position(self, client):
        _create_stage(client, name="Third", position=3)
        _create_stage(client, name="First", position=1)
        _create_stage(client, name="Second", position=2)
        resp = client.get("/api/stages")
        assert resp.status_code == 200
        stages = resp.json()
        assert len(stages) == 3
        assert stages[0]["name"] == "First"
        assert stages[1]["name"] == "Second"
        assert stages[2]["name"] == "Third"


class TestCreateStage:
    def test_create_stage(self, client):
        body = _create_stage(client, name="Discovery", position=2, probabilityDefault=25, color="#06b6d4")
        assert body["name"] == "Discovery"
        assert body["position"] == 2
        assert body["probabilityDefault"] == 25
        assert body["color"] == "#06b6d4"
        assert body["isClosedWon"] is False
        assert body["isClosedLost"] is False
        assert body["id"] is not None

    def test_create_stage_auto_position(self, client):
        _create_stage(client, name="First", position=1)
        resp = client.post("/api/stages", json={"name": "Auto Pos"})
        assert resp.status_code == 200
        body = resp.json()
        # Auto position should be max + 1 = 2
        assert body["position"] == 2

    def test_create_closed_won_stage(self, client):
        body = _create_stage(client, name="Closed Won", isClosedWon=True, probabilityDefault=100)
        assert body["isClosedWon"] is True
        assert body["isClosedLost"] is False


class TestUpdateStage:
    def test_update_stage(self, client):
        stage = _create_stage(client)
        resp = client.put(
            f"/api/stages/{stage['id']}",
            json={"name": "Renamed Stage", "color": "#ef4444"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "Renamed Stage"
        assert body["color"] == "#ef4444"

    def test_update_stage_not_found(self, client):
        resp = client.put("/api/stages/999", json={"name": "Ghost"})
        assert resp.status_code == 404


class TestDeleteStage:
    def test_delete_empty_stage(self, client):
        stage = _create_stage(client)
        resp = client.delete(f"/api/stages/{stage['id']}")
        assert resp.status_code == 200
        assert resp.json()["status"] == "deleted"

        # Verify deleted
        resp = client.get("/api/stages")
        assert all(s["id"] != stage["id"] for s in resp.json())

    def test_cannot_delete_stage_with_deals(self, client):
        stage = _create_stage(client)
        # Create a deal in this stage
        client.post("/api/deals", json={
            "title": "Blocking Deal",
            "stageId": stage["id"],
            "value": 1000,
        })
        resp = client.delete(f"/api/stages/{stage['id']}")
        assert resp.status_code == 400
        assert "deals" in resp.json()["detail"].lower()

    def test_delete_stage_not_found(self, client):
        resp = client.delete("/api/stages/999")
        assert resp.status_code == 404
