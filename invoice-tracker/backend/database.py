"""
Living UI Database Configuration and Tables for Invoice & Subscription Tracker
"""

import os
import logging
from datetime import datetime
from pathlib import Path
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, Session
from models import Base, AppState, UISnapshot, UIScreenshot, InvoiceReceipt, Subscription, TrackerGroup, ActivityLog

logger = logging.getLogger(__name__)

DATABASE_PATH = Path(__file__).parent / "living_ui.db"
DATABASE_URL = f"sqlite:///{DATABASE_PATH}"

# Create SQLite engine with WAL mode for high concurrency
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)

@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()

# Session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def seed_group_starter_data(db: Session, group: TrackerGroup, template_type: str = "cloud"):
    """Clean slate - no dummy invoices or subscriptions auto-seeded."""
    pass


def seed_initial_data(db: Session):
    """Seed standard clean starter workspace groups if database is empty."""
    groups = db.query(TrackerGroup).all()
    if not groups:
        # 1. Cloud & Engineering Group
        g1 = TrackerGroup(
            name="Engineering & Cloud Stack",
            description="Production infrastructure, AWS clusters, databases & CI/CD",
            color="#FF9900",
            icon="Cpu",
            currency="USD",
        )
        db.add(g1)

        # 2. AI & Modern Dev Tools Group
        g2 = TrackerGroup(
            name="AI & Modern Dev Tools",
            description="AI coding assistants, LLM APIs, Vercel & design tools",
            color="#00A67E",
            icon="Sparkles",
            currency="USD",
        )
        db.add(g2)

        # 3. Marketing & Operations Group
        g3 = TrackerGroup(
            name="Marketing & Operations",
            description="Creative assets, productivity, workspace seats & operations",
            color="#635BFF",
            icon="Layers",
            currency="USD",
        )
        db.add(g3)
        db.commit()


async def init_db():
    """Initialize database tables and perform column migrations."""
    logger.info(f"[Database] Initializing tables at {DATABASE_PATH}")
    Base.metadata.create_all(bind=engine)

    with engine.connect() as conn:
        for tbl in ["invoice_receipts", "subscriptions", "activity_logs"]:
            try:
                conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN group_id INTEGER"))
                conn.commit()
            except Exception:
                pass
        try:
            conn.execute(text("ALTER TABLE invoice_receipts ADD COLUMN notes TEXT"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE invoice_receipts ADD COLUMN subscription_id INTEGER"))
            conn.commit()
        except Exception:
            pass

    db = SessionLocal()
    try:
        state = db.query(AppState).first()
        if not state:
            state = AppState(data={"appName": "Invoice & Subscription Tracker", "status": "active"})
            db.add(state)
            db.commit()

        seed_initial_data(db)
    finally:
        db.close()


def get_db():
    """Dependency for DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
