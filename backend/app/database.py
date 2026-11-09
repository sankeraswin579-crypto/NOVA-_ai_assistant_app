from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import declarative_base, sessionmaker
from .config import settings

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

BACKEND_ROOT = Path(__file__).resolve().parent.parent


def ensure_schema(database_url: str | None = None) -> None:
    """Bring the database to the latest migration revision.

    Replaces the previous `Base.metadata.create_all()` call, which could create tables but
    never alter them. A database created by an older release has no `alembic_version`
    table, so it is stamped at head instead of being rebuilt — existing conversations,
    notes and documents are left untouched.
    """
    url = database_url or settings.database_url
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))

    inspector_engine = create_engine(url)
    try:
        existing = set(inspect(inspector_engine).get_table_names())
    finally:
        inspector_engine.dispose()
    if existing and "alembic_version" not in existing:
        command.stamp(config, "head")
    command.upgrade(config, "head")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
