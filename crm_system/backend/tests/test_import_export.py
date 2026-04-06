"""Tests for contact import and export functionality."""

import pytest
import csv
import io


class TestImportContacts:
    def test_import_contacts(self, client):
        data = {
            "data": [
                {"firstName": "Import1", "lastName": "User1", "email": "import1@test.com"},
                {"firstName": "Import2", "lastName": "User2", "email": "import2@test.com"},
                {"firstName": "Import3", "lastName": "User3", "email": "import3@test.com"},
            ],
        }
        resp = client.post("/api/import/contacts", json=data)
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "completed"
        assert body["totalRows"] == 3
        assert body["importedRows"] == 3
        assert body["skippedRows"] == 0

        # Verify contacts were actually created
        resp = client.get("/api/contacts")
        assert resp.json()["total"] == 3

    def test_import_contacts_with_missing_names(self, client):
        data = {
            "data": [
                {"firstName": "Valid", "lastName": "Contact", "email": "valid@test.com"},
                {"firstName": "", "lastName": "", "email": "invalid@test.com"},
                {"email": "noname@test.com"},
            ],
        }
        resp = client.post("/api/import/contacts", json=data)
        assert resp.status_code == 200
        body = resp.json()
        assert body["importedRows"] == 1
        assert body["skippedRows"] == 2
        assert len(body["errorLog"]) == 2

    def test_import_contacts_with_mapping(self, client):
        data = {
            "data": [
                {"first": "Mapped", "last": "User", "mail": "mapped@test.com"},
            ],
            "mapping": {
                "firstName": "first",
                "lastName": "last",
                "email": "mail",
            },
        }
        resp = client.post("/api/import/contacts", json=data)
        assert resp.status_code == 200
        body = resp.json()
        assert body["importedRows"] == 1

    def test_import_contacts_empty_array(self, client):
        resp = client.post("/api/import/contacts", json={"data": []})
        assert resp.status_code == 200
        body = resp.json()
        assert body["totalRows"] == 0
        assert body["importedRows"] == 0


class TestExportContacts:
    def test_export_contacts(self, client):
        # Create some contacts first
        client.post("/api/contacts", json={
            "firstName": "Export", "lastName": "User", "email": "export@test.com",
            "phone": "+1-555-0300", "jobTitle": "Exporter",
        })
        client.post("/api/contacts", json={
            "firstName": "Second", "lastName": "Export", "email": "second@test.com",
        })

        resp = client.get("/api/export/contacts")
        assert resp.status_code == 200
        assert "text/csv" in resp.headers.get("content-type", "")

        # Parse CSV content
        content = resp.text
        reader = csv.reader(io.StringIO(content))
        rows = list(reader)

        # Header + 2 data rows
        assert len(rows) == 3
        header = rows[0]
        assert "First Name" in header
        assert "Last Name" in header
        assert "Email" in header

        # Check data
        data_row = rows[1]
        assert "Export" in data_row
        assert "export@test.com" in data_row

    def test_export_contacts_empty(self, client):
        resp = client.get("/api/export/contacts")
        assert resp.status_code == 200
        content = resp.text
        reader = csv.reader(io.StringIO(content))
        rows = list(reader)
        # Only header row
        assert len(rows) == 1
