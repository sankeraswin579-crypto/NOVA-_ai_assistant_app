import sqlite3

from sqlalchemy import create_engine, inspect

from app.database import Base, ensure_schema
from app.models import Conversation, Message, Note  # noqa: F401  (register tables on Base)


def _tables(database_path):
    connection = sqlite3.connect(database_path)
    try:
        return {row[0] for row in connection.execute("select name from sqlite_master where type='table'")}
    finally:
        connection.close()


def _revision(database_path):
    connection = sqlite3.connect(database_path)
    try:
        return connection.execute("select version_num from alembic_version").fetchone()[0]
    finally:
        connection.close()


def test_creates_the_full_schema_on_an_empty_database(tmp_path):
    database_path = tmp_path / "fresh.db"
    ensure_schema(f"sqlite:///{database_path}")

    assert {
        "conversations", "messages", "notes", "documents",
        "document_chunks", "agent_runs", "alembic_version",
    } <= _tables(database_path)
    assert _revision(database_path) == "0001_initial"

    inspector = inspect(create_engine(f"sqlite:///{database_path}"))
    assert "document_id" in {column["name"] for column in inspector.get_columns("document_chunks")}
    assert inspector.get_indexes("document_chunks"), "document_id must stay indexed for retrieval"


def test_upgrades_a_legacy_create_all_database_without_losing_data(tmp_path):
    database_path = tmp_path / "legacy.db"
    legacy_url = f"sqlite:///{database_path}"

    # A database written by an earlier release: tables from create_all, no alembic_version.
    legacy_engine = create_engine(legacy_url)
    Base.metadata.create_all(bind=legacy_engine)
    with legacy_engine.begin() as connection:
        connection.exec_driver_sql(
            "insert into notes (id, title, content, created_at, updated_at) "
            "values (1, 'Kept note', 'user data must survive', '2026-01-01 00:00:00', '2026-01-01 00:00:00')"
        )
        connection.exec_driver_sql(
            "insert into conversations (id, title, created_at) values (1, 'Kept conversation', '2026-01-01 00:00:00')"
        )
        connection.exec_driver_sql(
            "insert into messages (id, conversation_id, role, content, created_at) "
            "values (1, 1, 'user', 'kept message', '2026-01-01 00:00:00')"
        )
    legacy_engine.dispose()
    assert "alembic_version" not in _tables(database_path)

    ensure_schema(legacy_url)

    assert _revision(database_path) == "0001_initial"
    connection = sqlite3.connect(database_path)
    try:
        assert connection.execute("select title, content from notes").fetchall() == [
            ("Kept note", "user data must survive")
        ]
        assert connection.execute("select content from messages").fetchone()[0] == "kept message"
    finally:
        connection.close()


def test_ensure_schema_is_idempotent(tmp_path):
    database_path = tmp_path / "repeat.db"
    url = f"sqlite:///{database_path}"
    ensure_schema(url)
    ensure_schema(url)
    assert _revision(database_path) == "0001_initial"
