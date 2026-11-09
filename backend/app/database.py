
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import settings


# --------------------------------------------------
# DATABASE CONNECTION
# --------------------------------------------------

connect_args = (
    {"check_same_thread": False}
    if settings.database_url.startswith("sqlite")
    else {}
)

engine = create_engine(
    settings.database_url,
    connect_args=connect_args,
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

Base = declarative_base()

BACKEND_ROOT = Path(__file__).resolve().parent.parent


# --------------------------------------------------
# KNOWN LEGACY NOVA DATABASE SCHEMA
# --------------------------------------------------

LEGACY_COLUMNS = {
    "agent_runs": {
        "id": "INTEGER",
        "task": "TEXT",
        "project_name": "VARCHAR(255)",
        "status": "VARCHAR(20)",
        "events": "TEXT",
        "created_at": "DATETIME",
        "updated_at": "DATETIME",
    },
    "conversations": {
        "id": "INTEGER",
        "title": "VARCHAR(160)",
        "created_at": "DATETIME",
    },
    "document_chunks": {
        "id": "INTEGER",
        "document_id": "INTEGER",
        "chunk_index": "INTEGER",
        "content": "TEXT",
        "embedding": "TEXT",
        "embedding_model": "VARCHAR(160)",
    },
    "documents": {
        "id": "INTEGER",
        "filename": "VARCHAR(255)",
        "content": "TEXT",
        "created_at": "DATETIME",
    },
    "messages": {
        "id": "INTEGER",
        "conversation_id": "INTEGER",
        "role": "VARCHAR(20)",
        "content": "TEXT",
        "created_at": "DATETIME",
    },
    "notes": {
        "id": "INTEGER",
        "title": "VARCHAR(200)",
        "content": "TEXT",
        "created_at": "DATETIME",
        "updated_at": "DATETIME",
    },
}

LEGACY_INDEXES = {
    "agent_runs": {"ix_agent_runs_id"},
    "conversations": {"ix_conversations_id"},
    "document_chunks": {
        "ix_document_chunks_document_id",
        "ix_document_chunks_id",
    },
    "documents": {"ix_documents_id"},
    "messages": {"ix_messages_id"},
    "notes": {"ix_notes_id"},
}

LEGACY_FOREIGN_KEYS = {
    (
        "messages",
        ("conversation_id",),
        "conversations",
        ("id",),
        None,
    ),
    (
        "document_chunks",
        ("document_id",),
        "documents",
        ("id",),
        "CASCADE",
    ),
}


# --------------------------------------------------
# LEGACY DATABASE VALIDATION
# --------------------------------------------------

def _validate_legacy_schema(inspector) -> None:
    """
    Verify that an existing database matches the known
    original NOVA schema before stamping it with Alembic.
    """

    expected_tables = set(LEGACY_COLUMNS)
    actual_tables = set(inspector.get_table_names())

    if actual_tables != expected_tables:
        raise RuntimeError(
            "Refusing to stamp database: unexpected tables. "
            f"Expected {sorted(expected_tables)}, "
            f"found {sorted(actual_tables)}."
        )

    for table, expected_columns in LEGACY_COLUMNS.items():

        columns = inspector.get_columns(table)

        actual_columns = {
            column["name"]: str(column["type"]).upper()
            for column in columns
        }

        if actual_columns != expected_columns:
            raise RuntimeError(
                f"Refusing to stamp database: unexpected "
                f"columns or types in table '{table}'."
            )

        nullable_columns = [
            column["name"]
            for column in columns
            if column.get("nullable", True)
        ]

        if nullable_columns:
            raise RuntimeError(
                f"Refusing to stamp database: nullable "
                f"columns in '{table}': {nullable_columns}."
            )

        primary_key = inspector.get_pk_constraint(
            table
        ).get("constrained_columns")

        if primary_key != ["id"]:
            raise RuntimeError(
                f"Unexpected primary key in table '{table}'."
            )

        actual_indexes = {
            index["name"]
            for index in inspector.get_indexes(table)
        }

        if actual_indexes != LEGACY_INDEXES[table]:
            raise RuntimeError(
                f"Unexpected indexes in table '{table}'."
            )

    actual_foreign_keys = set()

    for table in expected_tables:

        for fk in inspector.get_foreign_keys(table):

            options = fk.get("options") or {}

            actual_foreign_keys.add(
                (
                    table,
                    tuple(fk.get("constrained_columns") or []),
                    fk.get("referred_table"),
                    tuple(fk.get("referred_columns") or []),
                    options.get("ondelete"),
                )
            )

    if actual_foreign_keys != LEGACY_FOREIGN_KEYS:
        raise RuntimeError(
            "Refusing to stamp database: foreign-key "
            "definitions do not match the known NOVA schema."
        )


# --------------------------------------------------
# ALEMBIC CONFIGURATION
# --------------------------------------------------

def _get_alembic_config(database_url: str) -> Config:

    config = Config(
        str(BACKEND_ROOT / "alembic.ini")
    )

    config.set_main_option(
        "script_location",
        str(BACKEND_ROOT / "migrations"),
    )

    config.set_main_option(
        "sqlalchemy.url",
        database_url.replace("%", "%%"),
    )

    return config


# --------------------------------------------------
# DATABASE MIGRATION
# --------------------------------------------------

def ensure_schema(database_url: str | None = None) -> None:
    """
    Safely initialize or upgrade the NOVA database.

    Fresh database:
        Apply Alembic migrations.

    Known legacy database:
        Validate schema, stamp initial revision,
        then upgrade.

    Unknown database:
        Stop without stamping or modifying it.
    """

    url = database_url or settings.database_url

    config = _get_alembic_config(url)

    inspector_engine = create_engine(
        url,
        connect_args=(
            {"check_same_thread": False}
            if url.startswith("sqlite")
            else {}
        ),
    )

    try:
        inspector = inspect(inspector_engine)
        existing_tables = set(inspector.get_table_names())

        has_alembic_version = (
            "alembic_version" in existing_tables
        )

        if existing_tables and not has_alembic_version:
            _validate_legacy_schema(inspector)

    finally:
        inspector_engine.dispose()

    # Only stamp a verified legacy database.
    if existing_tables and not has_alembic_version:
        command.stamp(config, "head")

    # Apply pending migrations.
    command.upgrade(config, "head")


# --------------------------------------------------
# DATABASE DEPENDENCY
# --------------------------------------------------

def get_db():
    db = SessionLocal()

    try:
        yield db

    finally:
        db.close()
