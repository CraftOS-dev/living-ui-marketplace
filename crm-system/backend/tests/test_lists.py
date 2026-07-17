"""Lists, stages, entries, board payload, drag-move semantics."""

from tests.helpers import auth_headers


def test_default_pipeline_bootstrapped(client):
    headers = auth_headers(client)
    lists = client.get("/api/lists", headers=headers).json()
    assert any(l["name"] == "Sales Pipeline" for l in lists)
    pipeline = next(l for l in lists if l["name"] == "Sales Pipeline")
    stage_names = [s["name"] for s in pipeline["stages"]]
    assert stage_names[0] == "Lead"
    assert "Won" in stage_names and "Lost" in stage_names


def test_create_list_with_default_stages_and_views(client):
    headers = auth_headers(client)
    record_list = client.post("/api/lists", json={
        "name": "Investors", "parent_object": "deal",
    }, headers=headers).json()
    assert len(record_list["stages"]) == 8
    views = client.get(f"/api/views?list_id={record_list['id']}", headers=headers).json()
    assert any(v["layout"] == "kanban" for v in views)


def test_stage_crud_and_reorder(client):
    headers = auth_headers(client)
    record_list = client.post("/api/lists", json={"name": "P", "parent_object": "person"}, headers=headers).json()
    stage = client.post(f"/api/lists/{record_list['id']}/stages", json={"name": "Extra"}, headers=headers).json()
    assert stage["name"] == "Extra"

    updated = client.put(f"/api/stages/{stage['id']}", json={"name": "Renamed", "color": "#123456"}, headers=headers).json()
    assert updated["name"] == "Renamed"

    stage_ids = [s["id"] for s in client.get(f"/api/lists/{record_list['id']}", headers=headers).json()["stages"]]
    stage_ids.reverse()
    response = client.put(f"/api/lists/{record_list['id']}/stages-reorder", json={"stage_ids": stage_ids}, headers=headers)
    assert response.status_code == 200
    reordered = client.get(f"/api/lists/{record_list['id']}", headers=headers).json()["stages"]
    assert [s["id"] for s in reordered] == stage_ids

    response = client.delete(f"/api/stages/{stage['id']}", headers=headers)
    assert response.status_code == 200
    assert client.delete(f"/api/stages/{stage['id']}", headers=headers).json()["status"] == "not_found"


def test_entry_add_move_and_board(client):
    headers = auth_headers(client)
    lists = client.get("/api/lists", headers=headers).json()
    pipeline = next(l for l in lists if l["name"] == "Sales Pipeline")
    deal = client.post("/api/records/deal", json={"name": "Board deal", "value": 5000}, headers=headers).json()

    entry = client.post(f"/api/lists/{pipeline['id']}/entries", json={
        "record_id": deal["id"],
    }, headers=headers).json()
    lead_stage = pipeline["stages"][0]
    assert entry["stageId"] == lead_stage["id"]

    board = client.get(f"/api/lists/{pipeline['id']}/board", headers=headers).json()
    lead_column = next(c for c in board["columns"] if c["stage"]["id"] == lead_stage["id"])
    assert lead_column["count"] == 1
    assert lead_column["totalValue"] == 5000

    # Move to Won: writes stage_change activity + flips deal status
    won_stage = next(s for s in pipeline["stages"] if s["isWon"])
    moved = client.put(f"/api/entries/{entry['id']}/move", json={"stage_id": won_stage["id"]}, headers=headers).json()
    assert moved["stageId"] == won_stage["id"]

    deal_detail = client.get(f"/api/records/deal/{deal['id']}", headers=headers).json()
    assert deal_detail["record"]["status"] == "won"

    timeline = client.get(f"/api/timeline/deal/{deal['id']}", headers=headers).json()
    assert any(item["type"] == "stage_change" for item in timeline["items"])

    # Moving back to open stage reopens the deal
    client.put(f"/api/entries/{entry['id']}/move", json={"stage_id": lead_stage["id"]}, headers=headers)
    deal_detail = client.get(f"/api/records/deal/{deal['id']}", headers=headers).json()
    assert deal_detail["record"]["status"] == "open"


def test_entry_unique_per_list(client):
    headers = auth_headers(client)
    pipeline = next(l for l in client.get("/api/lists", headers=headers).json() if l["parentObject"] == "deal")
    deal = client.post("/api/records/deal", json={"name": "Dup"}, headers=headers).json()
    first = client.post(f"/api/lists/{pipeline['id']}/entries", json={"record_id": deal["id"]}, headers=headers).json()
    second = client.post(f"/api/lists/{pipeline['id']}/entries", json={"record_id": deal["id"]}, headers=headers).json()
    assert first["id"] == second["id"]


def test_delete_list_keeps_records(client):
    headers = auth_headers(client)
    record_list = client.post("/api/lists", json={"name": "Temp", "parent_object": "deal"}, headers=headers).json()
    deal = client.post("/api/records/deal", json={"name": "Keeper"}, headers=headers).json()
    client.post(f"/api/lists/{record_list['id']}/entries", json={"record_id": deal["id"]}, headers=headers)

    response = client.delete(f"/api/lists/{record_list['id']}", headers=headers)
    assert response.status_code == 200
    # Record survives
    detail = client.get(f"/api/records/deal/{deal['id']}", headers=headers).json()
    assert detail["status"] == "ok"
    # Idempotent
    assert client.delete(f"/api/lists/{record_list['id']}", headers=headers).json()["status"] == "not_found"


def test_board_skips_dangling_entries(client):
    headers = auth_headers(client)
    pipeline = next(l for l in client.get("/api/lists", headers=headers).json() if l["parentObject"] == "deal")
    # Entry pointing at a non-existent record (smoke-test scenario)
    response = client.post(f"/api/lists/{pipeline['id']}/entries", json={"record_id": 424242}, headers=headers)
    assert response.status_code == 200
    board = client.get(f"/api/lists/{pipeline['id']}/board", headers=headers).json()
    for column in board["columns"]:
        for card in column["cards"]:
            assert card["record"] is not None
