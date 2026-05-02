"""
Test configuration for Living UI backend tests.

Provides a temporary in-memory SQLite database and a FastAPI test client.
All tests run against a fresh database — the real database is never touched.
"""

import sys
from pathlib import Path

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


# Use StaticPool so ALL connections share the same in-memory database.
# Without this, each thread (TestClient runs handlers in a thread pool)
# gets its own empty :memory: database.
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
        db.rollback()
        db.close()


# Override the real database with the test database
app.dependency_overrides[get_db] = override_get_db


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
        session.rollback()
        session.close()


@pytest.fixture
def seeded_universe(db):
    """Manually insert a small fixture universe (no network calls).

    Replaces the heavyweight ``client.post('/api/stocks/seed')`` call which
    would hit NASDAQ Trader + Yahoo Finance and is unsuitable for unit tests.
    External smoke tests still exercise the real seed endpoint.
    """
    from models import Stock, StockPrice, MarketNews
    from datetime import datetime

    fixtures = [
        ("AAPL", "Apple Inc.", "Technology"),
        ("MSFT", "Microsoft Corporation", "Technology"),
        ("GOOGL", "Alphabet Inc.", "Technology"),
        ("JPM", "JPMorgan Chase", "Financial"),
    ]
    for sym, name, sector in fixtures:
        s = Stock(symbol=sym, name=name, sector=sector, exchange="NASDAQ")
        db.add(s)
        db.flush()
        db.add(StockPrice(
            stock_id=s.id, price=150.0, open_price=148.0, high=152.0,
            low=147.0, prev_close=149.0, volume=1_000_000,
            change=1.0, change_pct=0.67,
        ))

    # Seed a couple of news rows so test_get_news passes without a network call
    db.add(MarketNews(
        stock_symbol=None,
        headline="Markets close mixed amid tech earnings",
        summary="Major indices were mixed in afternoon trading.",
        source="Reuters",
        url="https://example.com/markets",
        published_at=datetime.utcnow(),
    ))
    db.add(MarketNews(
        stock_symbol="AAPL",
        headline="Apple announces quarterly results",
        summary="Apple reported fiscal Q-results today.",
        source="Bloomberg",
        url="https://example.com/aapl",
        published_at=datetime.utcnow(),
    ))
    db.commit()
    return fixtures
