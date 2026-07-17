"""Dashboard, reports, AI degradation, CSV import/export, demo seed, agent API."""

from tests.helpers import auth_headers


def test_dashboard_on_empty_db(client):
    headers = auth_headers(client)
    data = client.get("/api/dashboard", headers=headers).json()
    assert data["counts"]["people"] == 0
    assert data["pipeline"]["list"]["name"] == "Sales Pipeline"
    assert data["checklist"]["steps"]["hasRecords"] is False


def test_seed_demo_then_dashboard_and_reports(client):
    headers = auth_headers(client)
    stats = client.post("/api/seed/demo", headers=headers).json()
    assert stats["status"] == "seeded"
    assert stats["people"] >= 50
    assert stats["companies"] == 20
    assert stats["deals"] >= 25
    assert stats["lists"] >= 4

    dashboard = client.get("/api/dashboard", headers=headers).json()
    assert dashboard["counts"]["people"] >= 50
    assert dashboard["seeded"] is True
    assert len(dashboard["recentActivity"]) > 0
    assert len(dashboard["reconnect"]) > 0
    assert dashboard["pipeline"]["totalValue"] > 0

    funnel = client.get("/api/reports/funnel", headers=headers).json()
    assert len(funnel["stages"]) > 0
    assert funnel["stages"][0]["reached"] >= funnel["stages"][-1]["reached"]

    win_rate = client.get("/api/reports/win-rate?months=6", headers=headers).json()
    assert win_rate["overall"]["winRate"] is not None
    assert win_rate["overall"]["totalWonValue"] > 0

    velocity = client.get("/api/reports/velocity", headers=headers).json()
    assert any(s["avgDays"] > 0 for s in velocity["stages"])

    volume = client.get("/api/reports/activity-volume?weeks=8", headers=headers).json()
    assert sum(w["total"] for w in volume["weeks"]) > 0

    export = client.get("/api/reports/export?report=win-rate", headers=headers)
    assert export.status_code == 200
    assert "Win rate" in export.text


def test_seed_clear(client):
    headers = auth_headers(client)
    client.post("/api/seed/demo", headers=headers)
    response = client.post("/api/seed/clear", headers=headers)
    assert response.json()["status"] == "cleared"
    dashboard = client.get("/api/dashboard", headers=headers).json()
    assert dashboard["counts"]["people"] == 0
    # Defaults re-created
    assert dashboard["pipeline"]["list"]["name"] == "Sales Pipeline"


def test_ai_degrades_gracefully_without_llm(client, monkeypatch):
    # Force the LLM to be unavailable regardless of the host machine's CraftBot config
    import services.llm_service as llm
    monkeypatch.setattr(llm, "_llm_instance", None)
    monkeypatch.setattr(llm, "_llm_init_attempted", True)
    monkeypatch.setattr(llm, "_llm_model_name", "")

    headers = auth_headers(client)
    status = client.get("/api/ai/status", headers=headers).json()
    assert status["configured"] is False

    person = client.post("/api/records/person", json={"first_name": "AI"}, headers=headers).json()
    for path, body in (
        ("/api/ai/summary", {"record_type": "person", "record_id": person["id"]}),
        ("/api/ai/email-draft", {"instruction": "say hi"}),
        ("/api/ai/score", {"record_type": "person", "record_id": person["id"]}),
        ("/api/ai/chat", {"question": "any stalled deals?"}),
    ):
        response = client.post(path, json=body, headers=headers)
        assert response.status_code == 200
        assert response.json()["configured"] is False

    runs = client.get("/api/ai/runs", headers=headers).json()
    assert runs == []


def test_csv_import_and_export(client):
    headers = auth_headers(client)
    csv_text = (
        "first_name,last_name,email,company,job_title\n"
        "Ana,Reyes,ana@corex.io,Corex,CTO\n"
        "Ben,Cho,ben@corex.io,Corex,CEO\n"
        "Ana,Reyes,ana@corex.io,Corex,CTO\n"  # duplicate row
    )
    report = client.post("/api/import/csv", json={
        "record_type": "person", "csv_text": csv_text, "dedupe": True,
    }, headers=headers).json()
    assert report["created"] == 2
    assert report["skipped"] == 1

    # Company auto-created and linked
    result = client.post("/api/records/person/query", json={"search": "corex"}, headers=headers).json()
    assert result["total"] == 2
    assert result["items"][0]["company"]["name"] == "Corex"

    export = client.get("/api/export/csv?record_type=person", headers=headers)
    assert export.status_code == 200
    assert "ana@corex.io" in export.text


def test_import_empty_returns_message(client):
    headers = auth_headers(client)
    report = client.post("/api/import/csv", json={"record_type": "person", "csv_text": ""}, headers=headers).json()
    assert report["created"] == 0
    assert "No CSV" in report["message"]


# ---- Agent API (F11) ----

def test_agent_state_and_actions(client):
    headers = auth_headers(client)
    client.get("/api/lists", headers=headers)  # bootstrap defaults

    state = client.get("/api/state").json()
    assert "crm" in state
    assert state["crm"]["counts"]["people"] == 0

    created = client.post("/api/action", json={
        "action": "create_contact",
        "payload": {"first_name": "Agent", "last_name": "Made", "email": "agent@x.com", "company": "BotCo"},
    }).json()
    assert created["status"] == "created"
    person_id = created["person"]["id"]

    deal = client.post("/api/action", json={
        "action": "create_deal", "payload": {"name": "Agent deal", "value": 900},
    }).json()
    assert deal["status"] == "created"

    moved = client.post("/api/action", json={
        "action": "move_deal", "payload": {"deal_id": deal["deal"]["id"], "stage": "Qualified"},
    }).json()
    assert moved["status"] == "moved"

    note = client.post("/api/action", json={
        "action": "add_note",
        "payload": {"record_type": "person", "record_id": person_id, "content": "from agent"},
    }).json()
    assert note["status"] == "created"

    task = client.post("/api/tasks", json={"title": "Agent task"}, headers=headers).json()
    completed = client.post("/api/action", json={
        "action": "complete_task", "payload": {"task_id": task["id"]},
    }).json()
    assert completed["status"] == "completed"

    state = client.get("/api/state").json()
    assert state["crm"]["counts"]["people"] == 1
    assert state["crm"]["counts"]["deals"] == 1
    assert any(s["stage"] == "Qualified" and s["count"] == 1 for s in state["crm"]["pipeline"]["stages"])
