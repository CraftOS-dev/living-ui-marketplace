"""
Test configuration for LedgerFlow backend tests.

Provides a temporary in-memory SQLite database and a FastAPI test client.
All tests run against a fresh database -- the real database is never touched.
"""

import sys
from pathlib import Path
from contextlib import asynccontextmanager

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Add backend directory to path so imports work
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from models import Base
from database import get_db
from main import app

# Create a temporary in-memory database for testing with StaticPool
# so the same connection is reused (required for in-memory SQLite)
TEST_ENGINE = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

# Enable foreign key support in SQLite
@event.listens_for(TEST_ENGINE, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()

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


# Disable lifespan (no health checker in tests)
async def _noop_lifespan():
    yield


app.router.lifespan_context = asynccontextmanager(lambda app: _noop_lifespan())


@pytest.fixture(autouse=True)
def setup_database():
    """Create all tables before each test, drop them after."""
    Base.metadata.create_all(bind=TEST_ENGINE)
    yield
    Base.metadata.drop_all(bind=TEST_ENGINE)


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
