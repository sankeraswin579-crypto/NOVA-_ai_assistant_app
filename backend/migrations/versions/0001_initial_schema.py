"""initial schema

Captures the schema that earlier releases created with Base.metadata.create_all, so an
existing nova.db can be stamped as already-migrated instead of being rebuilt.

Revision ID: 0001_initial
Revises:
Create Date: 2026-11-09
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "conversations",
        sa.Column("id", sa.Integer(), primary_key=True, index=True, nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "messages",
        sa.Column("id", sa.Integer(), primary_key=True, index=True, nullable=False),
        sa.Column("conversation_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"]),
    )
    op.create_table(
        "notes",
        sa.Column("id", sa.Integer(), primary_key=True, index=True, nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "documents",
        sa.Column("id", sa.Integer(), primary_key=True, index=True, nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "document_chunks",
        sa.Column("id", sa.Integer(), primary_key=True, index=True, nullable=False),
        sa.Column("document_id", sa.Integer(), nullable=False, index=True),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("embedding", sa.Text(), nullable=False),
        sa.Column("embedding_model", sa.String(length=160), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
    )
    op.create_table(
        "agent_runs",
        sa.Column("id", sa.Integer(), primary_key=True, index=True, nullable=False),
        sa.Column("task", sa.Text(), nullable=False),
        sa.Column("project_name", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("events", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("agent_runs")
    op.drop_table("document_chunks")
    op.drop_table("documents")
    op.drop_table("notes")
    op.drop_table("messages")
    op.drop_table("conversations")
