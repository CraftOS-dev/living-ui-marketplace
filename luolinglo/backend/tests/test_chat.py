"""Tests for chat session management (non-LLM parts)."""


def _setup(client):
    client.post("/api/profile", json={
        "nativeLanguage": "English",
        "targetLanguage": "Japanese",
    })


def test_create_chat_session(client):
    response = client.post("/api/chat/sessions", json={"name": "Test Chat"})
    assert response.status_code == 200
    data = response.json()
    assert "sessionId" in data


def test_list_sessions_empty(client):
    response = client.get("/api/chat/sessions")
    assert response.status_code == 200
    assert response.json() == []


def test_delete_session(client):
    session = client.post("/api/chat/sessions").json()
    sid = session["sessionId"]

    response = client.delete(f"/api/chat/sessions/{sid}")
    assert response.status_code == 200
