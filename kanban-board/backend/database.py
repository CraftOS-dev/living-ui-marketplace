"""
Living UI Database Configuration

SQLite database setup for persistent state storage.
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
    """Initialize database tables and create default board if none exists."""
    logger.info(f"[Database] Creating tables at {DATABASE_PATH}")
    Base.metadata.create_all(bind=engine)

    from models import AppState, Board, BoardList
    db = SessionLocal()
    try:
        state = db.query(AppState).first()
        if not state:
            state = AppState()
            db.add(state)
            db.commit()
            logger.info("[Database] Created default app state")

        if db.query(Board).count() == 0:
            board = Board(name="My Board")
            db.add(board)
            db.flush()
            for i, title in enumerate(["To Do", "In Progress", "Done"]):
                db.add(BoardList(board_id=board.id, title=title, position=i))
            db.commit()
            logger.info("[Database] Created default board with 3 lists")
    finally:
        db.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
