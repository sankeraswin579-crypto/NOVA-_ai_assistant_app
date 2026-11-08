import asyncio
import io

from docx import Document as DocxDocument
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Document
from app.rag import DocumentIngestionError, extract_document_text, index_document, retrieve_context, split_into_chunks


def test_extracts_txt_and_docx_text():
    assert extract_document_text("notes.txt", b"Nova notes") == "Nova notes"
    docx = DocxDocument()
    docx.add_paragraph("DOCX reference text")
    file_data = io.BytesIO()
    docx.save(file_data)
    assert "DOCX reference text" in extract_document_text("reference.docx", file_data.getvalue())


def test_rejects_bad_pdf_and_unsupported_types():
    for filename, raw in (("bad.pdf", b"not a pdf"), ("notes.rtf", b"ignored")):
        try:
            extract_document_text(filename, raw)
        except DocumentIngestionError:
            pass
        else:
            raise AssertionError(f"{filename} should not be accepted")


def test_chunks_overlap_and_stay_bounded():
    chunks = split_into_chunks("word " * 1200, chunk_size=500, overlap=50)
    assert len(chunks) > 1
    assert all(len(chunk) <= 500 for chunk in chunks)
    assert chunks[0][-20:] in chunks[1]


def test_indexes_and_retrieves_relevant_document_chunks(monkeypatch):
    database = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(database)
    session_factory = sessionmaker(bind=database)

    async def fake_embeddings(texts):
        return [[1.0, 0.0] if "alpha" in text.lower() else [0.0, 1.0] for text in texts]

    monkeypatch.setattr("app.rag.embed_texts", fake_embeddings)
    monkeypatch.setattr("app.rag.settings.ollama_embedding_model", "test-embed")
    with session_factory() as db:
        alpha = Document(filename="alpha.txt", content="alpha information")
        beta = Document(filename="beta.txt", content="beta information")
        db.add_all([alpha, beta])
        db.commit()
        db.refresh(alpha)
        db.refresh(beta)
        asyncio.run(index_document(db, alpha))
        asyncio.run(index_document(db, beta))
        sources = asyncio.run(retrieve_context(db, "alpha question"))
        assert sources[0]["filename"] == "alpha.txt"
        assert sources[0]["chunk"] == 1
    database.dispose()
