import heapq
import io
import json
import math
import re

import httpx
from docx import Document as DocxDocument
from docx.opc.exceptions import PackageNotFoundError
from pypdf import PdfReader
from pypdf.errors import PdfReadError
from sqlalchemy.orm import Session

from .ai_engine import AIEngineError, _is_loopback_url
from .config import settings
from .models import Document, DocumentChunk

MAX_DOCUMENT_CHARS = 500_000
# "All documents" means the most recent MAX_SELECTED_DOCUMENTS documents. Retrieval used to
# raise an error above this number, which made document Q&A unusable once a library grew
# past it even though the UI offers "leave empty for all".
MAX_SELECTED_DOCUMENTS = 50
# Chunks are scored in batches so a large knowledge base is searched instead of rejected.
CHUNK_SCAN_BATCH = 500


class DocumentIngestionError(ValueError):
    pass


def extract_document_text(filename: str, raw: bytes) -> str:
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    try:
        if suffix in {"txt", "md"}:
            content = raw.decode("utf-8-sig")
        elif suffix == "pdf":
            reader = PdfReader(io.BytesIO(raw))
            content = "\n\n".join(page.extract_text() or "" for page in reader.pages)
        elif suffix == "docx":
            document = DocxDocument(io.BytesIO(raw))
            pieces = [paragraph.text for paragraph in document.paragraphs if paragraph.text.strip()]
            for table in document.tables:
                pieces.extend(" | ".join(cell.text for cell in row.cells) for row in table.rows)
            content = "\n".join(pieces)
        else:
            raise DocumentIngestionError("Supported document types are PDF, DOCX, and TXT.")
    except DocumentIngestionError:
        raise
    except UnicodeDecodeError as error:
        raise DocumentIngestionError("The TXT file must use UTF-8 encoding.") from error
    except (OSError, ValueError, KeyError, PackageNotFoundError, PdfReadError) as error:
        raise DocumentIngestionError("The document could not be read. Check that the file is valid and not encrypted.") from error
    content = content.strip()
    if not content:
        raise DocumentIngestionError("No readable text was found in the document.")
    if len(content) > MAX_DOCUMENT_CHARS:
        raise DocumentIngestionError("Extracted document text exceeds the 500,000 character limit.")
    return content


def split_into_chunks(content: str, chunk_size: int = 1200, overlap: int = 180) -> list[str]:
    text = re.sub(r"[ \t]+", " ", content).strip()
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        if end < len(text):
            boundary = text.rfind(" ", start + chunk_size // 2, end)
            if boundary > start:
                end = boundary
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
        start = max(start + 1, end - overlap)
    return chunks


async def embed_texts(texts: list[str]) -> list[list[float]]:
    if not settings.ollama_embedding_model:
        raise AIEngineError("Configure OLLAMA_EMBEDDING_MODEL to index documents.")
    if not _is_loopback_url(settings.ollama_base_url):
        raise AIEngineError("Document embeddings require a loopback Ollama URL.")
    try:
        embeddings = []
        async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=3)) as client:
            for start in range(0, len(texts), 32):
                response = await client.post(
                    f"{settings.ollama_base_url.rstrip('/')}/api/embed",
                    json={"model": settings.ollama_embedding_model, "input": texts[start:start + 32]},
                )
                response.raise_for_status()
                batch = response.json().get("embeddings")
                if not isinstance(batch, list):
                    raise ValueError("Invalid embeddings payload")
                embeddings.extend(batch)
    except httpx.TimeoutException as error:
        raise AIEngineError("Ollama document embeddings timed out.") from error
    except httpx.ConnectError as error:
        raise AIEngineError("Could not connect to Ollama for document embeddings.") from error
    except httpx.HTTPStatusError as error:
        raise AIEngineError(
            "Ollama could not create document embeddings. Check that the embedding model is installed."
        ) from error
    except (ValueError, KeyError, TypeError) as error:
        raise AIEngineError("Ollama returned invalid document embeddings.") from error
    if not isinstance(embeddings, list) or len(embeddings) != len(texts):
        raise AIEngineError("Ollama returned an incomplete embedding response.")
    vectors = []
    for vector in embeddings:
        if not isinstance(vector, list) or not vector or any(not isinstance(value, (int, float)) for value in vector):
            raise AIEngineError("Ollama returned an invalid embedding vector.")
        vectors.append([float(value) for value in vector])
    return vectors


async def index_document(db: Session, document: Document) -> int:
    pieces = split_into_chunks(document.content)
    vectors = await embed_texts(pieces)
    db.query(DocumentChunk).filter(DocumentChunk.document_id == document.id).delete()
    db.add_all([
        DocumentChunk(
            document_id=document.id,
            chunk_index=index,
            content=piece,
            embedding=json.dumps(vector),
            embedding_model=settings.ollama_embedding_model,
        )
        for index, (piece, vector) in enumerate(zip(pieces, vectors))
    ])
    db.commit()
    return len(pieces)


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if len(left) != len(right):
        return 0.0
    magnitude = math.sqrt(sum(value * value for value in left) * sum(value * value for value in right))
    return sum(a * b for a, b in zip(left, right)) / magnitude if magnitude else 0.0


async def retrieve_context(
    db: Session,
    question: str,
    document_ids: list[int] | None = None,
    limit: int = 5,
) -> list[dict]:
    if document_ids:
        # WriterRequest.document_ids is capped at 50 by the request schema.
        docs = db.query(Document).filter(Document.id.in_(document_ids)).all()
    else:
        docs = (
            db.query(Document)
            .order_by(Document.created_at.desc(), Document.id.desc())
            .limit(MAX_SELECTED_DOCUMENTS)
            .all()
        )
    if not docs:
        raise DocumentIngestionError("Import a document before asking a question about it.")
    for document in docs:
        existing = db.query(DocumentChunk).filter(
            DocumentChunk.document_id == document.id,
            DocumentChunk.embedding_model == settings.ollama_embedding_model,
        ).first()
        if not existing:
            await index_document(db, document)
    query = db.query(DocumentChunk).join(Document)
    if document_ids:
        query = query.filter(Document.id.in_(document_ids))
    query = query.order_by(DocumentChunk.id)
    query_vector = (await embed_texts([question]))[0]

    # Score every matching chunk in id-paged batches, keeping only the best `limit` so a
    # large knowledge base is searched with bounded memory instead of being rejected.
    best: list[tuple[float, int, DocumentChunk]] = []
    scanned = 0
    last_id = 0
    while True:
        batch = query.filter(DocumentChunk.id > last_id).limit(CHUNK_SCAN_BATCH).all()
        if not batch:
            break
        last_id = batch[-1].id
        for chunk in batch:
            if chunk.embedding_model != settings.ollama_embedding_model:
                continue
            try:
                score = _cosine_similarity(query_vector, json.loads(chunk.embedding))
            except (ValueError, TypeError):
                continue
            scanned += 1
            heapq.heappush(best, (score, -scanned, chunk))
            if len(best) > limit:
                heapq.heappop(best)
    matches = [(score, chunk) for score, _, chunk in sorted(best, key=lambda item: item[0], reverse=True)]
    if not matches or matches[0][0] <= 0:
        raise DocumentIngestionError("No matching indexed document context was found.")
    return [
        {
            "filename": chunk.document.filename,
            "chunk": chunk.chunk_index + 1,
            "content": chunk.content,
            "score": score,
        }
        for score, chunk in matches
    ]
