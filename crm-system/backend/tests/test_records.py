"""Records: CRUD, custom attributes, query/filter/sort, duplicates, cascade."""

from tests.helpers import auth_headers


def test_create_and_get_person(client):
    headers = auth_headers(client)
    response = client.post("/api/records/person", json={
        "first_name": "Ada", "last_name": "Lovelace",
        "emails": ["ada@example.com"], "job_title": "Engineer",
    }, headers=headers)
    assert response.status_code == 200
    person = response.json()
    assert person["name"] == "Ada Lovelace"
    assert person["emails"] == ["ada@example.com"]

    response = client.get(f"/api/records/person/{person['id']}", headers=headers)
    assert response.status_code == 200
    detail = response.json()
    assert detail["status"] == "ok"
    assert detail["record"]["firstName"] == "Ada"


def test_create_writes_created_activity(client):
    headers = auth_headers(client)
    person = client.post("/api/records/person", json={"first_name": "Bo"}, headers=headers).json()
    timeline = client.get(f"/api/timeline/person/{person['id']}", headers=headers).json()
    assert timeline["total"] == 1
    assert timeline["items"][0]["type"] == "created"


def test_update_person_logs_field_change(client):
    headers = auth_headers(client)
    person = client.post("/api/records/person", json={"first_name": "Cara"}, headers=headers).json()
    response = client.put(f"/api/records/person/{person['id']}", json={
        "job_title": "CTO",
    }, headers=headers)
    assert response.status_code == 200
    assert response.json()["jobTitle"] == "CTO"

    timeline = client.get(f"/api/timeline/person/{person['id']}", headers=headers).json()
    types = [item["type"] for item in timeline["items"]]
    assert "field_change" in types


def test_update_missing_record_returns_200_not_found(client):
    headers = auth_headers(client)
    response = client.put("/api/records/person/9999", json={"first_name": "X"}, headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "not_found"


def test_delete_is_idempotent(client):
    headers = auth_headers(client)
    person = client.post("/api/records/person", json={"first_name": "Del"}, headers=headers).json()
    assert client.delete(f"/api/records/person/{person['id']}", headers=headers).json()["status"] == "deleted"
    response = client.delete(f"/api/records/person/{person['id']}", headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "not_found"


def test_delete_cascades_notes_and_tasks(client):
    headers = auth_headers(client)
    person = client.post("/api/records/person", json={"first_name": "Cass"}, headers=headers).json()
    client.post("/api/notes", json={
        "record_type": "person", "record_id": person["id"], "content": "hello",
    }, headers=headers)
    task = client.post("/api/tasks", json={
        "title": "Follow up", "record_type": "person", "record_id": person["id"],
    }, headers=headers).json()

    client.delete(f"/api/records/person/{person['id']}", headers=headers)
    notes = client.get(f"/api/notes/person/{person['id']}", headers=headers).json()
    assert notes == []
    # Task survives but is unlinked
    tasks = client.get("/api/tasks", headers=headers).json()
    kept = [t for t in tasks if t["id"] == task["id"]]
    assert kept and kept[0]["recordType"] is None


def test_person_company_relationship(client):
    headers = auth_headers(client)
    company = client.post("/api/records/company", json={
        "name": "Acme", "domain": "acme.com",
    }, headers=headers).json()
    person = client.post("/api/records/person", json={
        "first_name": "Eve", "company_id": company["id"],
    }, headers=headers).json()
    detail = client.get(f"/api/records/person/{person['id']}", headers=headers).json()
    assert detail["record"]["company"]["name"] == "Acme"
    assert detail["record"]["related"]["companies"][0]["id"] == company["id"]

    company_detail = client.get(f"/api/records/company/{company['id']}", headers=headers).json()
    assert any(p["id"] == person["id"] for p in company_detail["record"]["related"]["people"])


def test_custom_attribute_roundtrip(client):
    headers = auth_headers(client)
    attribute = client.post("/api/attributes", json={
        "name": "Persona", "object_type": "person", "type": "select",
        "options": [{"label": "Buyer"}, {"label": "Investor"}],
    }, headers=headers).json()
    assert attribute["slug"] == "persona"
    assert len(attribute["options"]) == 2

    person = client.post("/api/records/person", json={
        "first_name": "Fay", "attributes": {"persona": attribute["options"][0]["id"]},
    }, headers=headers).json()

    result = client.post("/api/records/person/query", json={}, headers=headers).json()
    row = next(r for r in result["items"] if r["id"] == person["id"])
    assert row["attributes"]["persona"] == attribute["options"][0]["id"]


def test_query_filters_and_sort(client):
    headers = auth_headers(client)
    client.post("/api/records/deal", json={"name": "Big", "value": 100000}, headers=headers)
    client.post("/api/records/deal", json={"name": "Small", "value": 500}, headers=headers)

    result = client.post("/api/records/deal/query", json={
        "filters": [{"field": "value", "operator": "gt", "value": 1000}],
    }, headers=headers).json()
    assert result["total"] == 1
    assert result["items"][0]["name"] == "Big"

    result = client.post("/api/records/deal/query", json={
        "sorts": [{"field": "value", "dir": "asc"}],
    }, headers=headers).json()
    assert [r["name"] for r in result["items"]] == ["Small", "Big"]


def test_query_search(client):
    headers = auth_headers(client)
    client.post("/api/records/person", json={
        "first_name": "Greta", "emails": ["greta@zeppelin.io"],
    }, headers=headers)
    client.post("/api/records/person", json={"first_name": "Hank"}, headers=headers)
    result = client.post("/api/records/person/query", json={"search": "zeppelin"}, headers=headers).json()
    assert result["total"] == 1
    assert result["items"][0]["name"] == "Greta"


def test_duplicate_detection(client):
    headers = auth_headers(client)
    client.post("/api/records/person", json={
        "first_name": "Ida", "emails": ["ida@dup.com"],
    }, headers=headers)
    response = client.get("/api/records/person/check-duplicates?email=ida@dup.com", headers=headers)
    assert response.status_code == 200
    assert len(response.json()["duplicates"]) == 1


def test_deal_people_links(client):
    headers = auth_headers(client)
    deal = client.post("/api/records/deal", json={"name": "D1"}, headers=headers).json()
    person = client.post("/api/records/person", json={"first_name": "Jo"}, headers=headers).json()
    response = client.post(f"/api/deals/{deal['id']}/people", json={"person_id": person["id"]}, headers=headers)
    assert response.status_code == 200

    detail = client.get(f"/api/records/deal/{deal['id']}", headers=headers).json()
    assert any(p["id"] == person["id"] for p in detail["record"]["related"]["people"])

    response = client.delete(f"/api/deals/{deal['id']}/people/{person['id']}", headers=headers)
    assert response.status_code == 200
    # Idempotent
    assert client.delete(f"/api/deals/{deal['id']}/people/{person['id']}", headers=headers).status_code == 200


def test_global_search(client):
    headers = auth_headers(client)
    client.post("/api/records/company", json={"name": "Zephyr Corp"}, headers=headers)
    result = client.get("/api/search?q=zeph", headers=headers).json()
    assert result["companies"][0]["name"] == "Zephyr Corp"


def test_deal_status_change_sets_closed_at(client):
    headers = auth_headers(client)
    deal = client.post("/api/records/deal", json={"name": "W", "value": 10}, headers=headers).json()
    updated = client.put(f"/api/records/deal/{deal['id']}", json={"status": "won"}, headers=headers).json()
    assert updated["status"] == "won"
    assert updated["closedAt"] is not None
