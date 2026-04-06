"""
Root conftest.py for backend tests.

Patches SQLAlchemy to use StaticPool for in-memory SQLite databases.
This ensures all threads share the same in-memory database during tests,
fixing the 'no such table' error caused by SQLite's per-thread connections.
"""
import sqlalchemy
from sqlalchemy.pool import StaticPool

_original_create_engine = sqlalchemy.create_engine


def _patched_create_engine(url, **kwargs):
    """Patch create_engine to use StaticPool for in-memory SQLite."""
    url_str = str(url)
    if "sqlite:///:memory:" in url_str or url_str == "sqlite://":
        kwargs.setdefault("poolclass", StaticPool)
        kwargs.setdefault("connect_args", {"check_same_thread": False})
    return _original_create_engine(url, **kwargs)


# Apply the patch before tests/conftest.py is loaded
sqlalchemy.create_engine = _patched_create_engine
