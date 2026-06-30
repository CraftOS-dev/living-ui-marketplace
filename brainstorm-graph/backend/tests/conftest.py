"""
Test configuration for Living UI backend tests.

Provides a temporary in-memory SQLite database and a FastAPI test client.
All tests run against a fresh database — the real database is never touched.
"""

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Add backend directory to path so imports work
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from models import Base
from database import get_db
from main import app


# Create a temporary in-memory database for testing
TEST_ENGINE = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=TEST_ENGINE)


def override_get_db():
    """Override the database dependency to use the test database."""
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


# Override the real database with the test database
app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(autouse=True)
def setup_database():
    """Create all tables before each test, drop them after."""
    Base.metadata.create_all(bind=TEST_ENGINE)
    yield
    Base.metadata.drop_all(bind=TEST_ENGINE)


@pytest.fixture(autouse=True)
def mock_bridge(monkeypatch):
    """Mock the CraftBot LLM bridge so AI routes exercise the real parsing path
    without a live bridge. Returns deterministic content per prompt type."""
    import services.integration_client as ic

    monkeypatch.setattr(ic, "BRIDGE_URL", "http://test-bridge")
    monkeypatch.setattr(ic, "BRIDGE_TOKEN", "test-token")

    async def fake_llm_complete(prompt, system_message=None):
        if "most valuable next action" in prompt:             # explore: pick a node
            return '{"nodeId": 0, "action": "expand", "reason": "test"}'
        if "Synthesize the brainstorming session" in prompt:  # summary
            return '{"summary": "Test summary.", "themes": ["t1", "t2"], "insights": ["i1"]}'
        if "specific questions" in prompt:                    # expand
            return '["Question one?", "Question two?", "Question three?"]'
        if "insightful answer" in prompt:                     # answer
            return "This is a test answer with specifics and a caveat."
        return ""

    monkeypatch.setattr(ic.integration, "llm_complete", fake_llm_complete)


@pytest.fixture
def client():
    """Provide a FastAPI test client."""
    return TestClient(app)


@pytest.fixture
def db():
    """Provide a database session for direct DB operations in tests."""
    session = TestSessionLocal()
    try:
        yield session
    finally:
        session.close()
