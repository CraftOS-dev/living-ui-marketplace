"""
CRM System Database Configuration

SQLite database setup for persistent state storage.
Uses synchronous SQLite with SQLAlchemy for simplicity and reliability.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from models import Base
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

DATABASE_PATH = Path(__file__).parent / "living_ui.db"
DATABASE_URL = f"sqlite:///{DATABASE_PATH}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


async def init_db():
    """Initialize database tables and seed default data."""
    logger.info(f"[Database] Creating tables at {DATABASE_PATH}")
    Base.metadata.create_all(bind=engine)

    # Ensure default app state exists
    from models import AppState, DealStage
    db = SessionLocal()
    try:
        state = db.query(AppState).first()
        if not state:
            state = AppState()
            db.add(state)
            db.commit()
            logger.info("[Database] Created default app state")

        # Seed default deal stages if none exist
        stage_count = db.query(DealStage).count()
        if stage_count == 0:
            default_stages = [
                DealStage(name="New Lead", position=0, probability_default=10, color="#6366f1"),
                DealStage(name="Contacted", position=1, probability_default=20, color="#8b5cf6"),
                DealStage(name="Qualified", position=2, probability_default=30, color="#06b6d4"),
                DealStage(name="Demo/Meeting", position=3, probability_default=50, color="#3b82f6"),
                DealStage(name="Proposal", position=4, probability_default=60, color="#f59e0b"),
                DealStage(name="Negotiation", position=5, probability_default=80, color="#f97316"),
                DealStage(name="Closed Won", position=6, probability_default=100, color="#22c55e",
                          is_closed_won=True),
                DealStage(name="Closed Lost", position=7, probability_default=0, color="#ef4444",
                          is_closed_lost=True),
            ]
            db.add_all(default_stages)
            db.commit()
            logger.info("[Database] Seeded 8 default deal stages")
    finally:
        db.close()


def get_db():
    """Dependency to get database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
