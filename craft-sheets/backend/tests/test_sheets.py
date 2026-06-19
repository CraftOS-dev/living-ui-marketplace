"""API tests for the Sheet CRUD endpoints."""


def test_create_sheet_defaults(client):
    """Creating with just a name gives a default 6x20 grid."""
    resp = client.post("/api/sheets", json={"name": "Budget"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Budget"
    assert "id" in data
    assert len(data["columns"]) == 6
    assert data["columns"][0]["name"] == "A"
    assert data["numRows"] == 20
    assert data["values"] == {}


def test_create_and_get_sheet(client):
    created = client.post("/api/sheets", json={
        "name": "Data",
        "columns": [{"name": "A", "type": "number", "width": 100}],
        "numRows": 5,
        "cells": {"A1": {"raw": "10"}, "A2": {"raw": "=A1*2"}},
    }).json()

    resp = client.get(f"/api/sheets/{created['id']}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["cells"]["A2"]["raw"] == "=A1*2"
    assert data["values"]["A1"] == 10
    assert data["values"]["A2"] == 20  # formula evaluated by backend


def test_list_sheets_ordered(client):
    client.post("/api/sheets", json={"name": "First"})
    client.post("/api/sheets", json={"name": "Second"})
    resp = client.get("/api/sheets")
    assert resp.status_code == 200
    sheets = resp.json()
    assert len(sheets) == 2
    assert [s["name"] for s in sheets] == ["First", "Second"]
    # summary is lightweight (no cells)
    assert "cells" not in sheets[0]
    assert sheets[0]["numCols"] >= 1


def test_get_missing_sheet_404(client):
    assert client.get("/api/sheets/999").status_code == 404


def test_update_sheet_replaces_and_reevaluates(client):
    sheet = client.post("/api/sheets", json={"name": "Calc"}).json()
    resp = client.put(f"/api/sheets/{sheet['id']}", json={
        "name": "Calc v2",
        "columns": [{"name": "A", "type": "number", "width": 120}],
        "numRows": 3,
        "cells": {"A1": {"raw": "5"}, "A2": {"raw": "7"}, "A3": {"raw": "=SUM(A1:A2)"}},
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Calc v2"
    assert data["numRows"] == 3
    assert data["values"]["A3"] == 12


def test_update_missing_sheet_404(client):
    resp = client.put("/api/sheets/999", json={"name": "x"})
    assert resp.status_code == 404


def test_formula_error_reported(client):
    sheet = client.post("/api/sheets", json={
        "name": "Errs",
        "cells": {"A1": {"raw": "=1/0"}},
    }).json()
    assert sheet["values"]["A1"] == "#DIV/0!"
    assert sheet["errors"]["A1"] == "#DIV/0!"


def test_cell_format_persists(client):
    sheet = client.post("/api/sheets", json={
        "name": "Fmt",
        "cells": {"A1": {"raw": "hi", "format": {"bold": True, "align": "center", "bg": "#fff3e0"}}},
    }).json()
    fetched = client.get(f"/api/sheets/{sheet['id']}").json()
    assert fetched["cells"]["A1"]["format"]["bold"] is True
    assert fetched["cells"]["A1"]["format"]["align"] == "center"


def test_delete_sheet(client):
    sheet = client.post("/api/sheets", json={"name": "Temp"}).json()
    resp = client.delete(f"/api/sheets/{sheet['id']}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "deleted"
    assert client.get(f"/api/sheets/{sheet['id']}").status_code == 404


def test_delete_missing_sheet_idempotent(client):
    """DELETE on an absent sheet returns 200 (smoke-test friendly)."""
    resp = client.delete("/api/sheets/999")
    assert resp.status_code == 200
    assert resp.json()["status"] == "not_found"
