from pathlib import Path
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import desc
from .config import settings
from .database import Base, engine, get_db
from .models import Conversation, Message, Note, Document
from .schemas import ChatRequest, ConversationOut, NoteIn, NoteOut, DocumentIn
from .assistant import generate_reply

Base.metadata.create_all(bind=engine)
app = FastAPI(title="Nova AI API", version="1.0.0", description="Local-first assistant API")

origins = [x.strip() for x in settings.cors_origins.split(",") if x.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["http://localhost:5173"],
    allow_origin_regex=r"https?://.*" if "*" in origins else None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"name": "Nova AI API", "status": "online", "docs": "/docs"}

@app.get("/api/health")
def health():
    return {"status": "ok", "mode": "local-first", "model_configured": bool(settings.ollama_model)}

@app.get("/api/conversations", response_model=list[ConversationOut])
def list_conversations(db: Session = Depends(get_db)):
    return db.query(Conversation).order_by(desc(Conversation.created_at)).limit(100).all()

@app.get("/api/conversations/{conversation_id}", response_model=ConversationOut)
def get_conversation(conversation_id: int, db: Session = Depends(get_db)):
    item = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not item:
        raise HTTPException(404, "Conversation not found")
    return item

@app.delete("/api/conversations/{conversation_id}")
def delete_conversation(conversation_id: int, db: Session = Depends(get_db)):
    item = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not item:
        raise HTTPException(404, "Conversation not found")
    db.delete(item)
    db.commit()
    return {"deleted": True}

@app.post("/api/chat")
async def chat(payload: ChatRequest, db: Session = Depends(get_db)):
    conversation = None
    if payload.conversation_id:
        conversation = db.query(Conversation).filter(Conversation.id == payload.conversation_id).first()
        if not conversation:
            raise HTTPException(404, "Conversation not found")
    else:
        title = payload.message.strip().replace("\n", " ")[:48] or "New conversation"
        conversation = Conversation(title=title)
        db.add(conversation)
        db.commit()
        db.refresh(conversation)

    history_rows = db.query(Message).filter(
        Message.conversation_id == conversation.id
    ).order_by(Message.id.asc()).all()
    history = [{"role": m.role, "content": m.content} for m in history_rows]
    user_msg = Message(conversation_id=conversation.id, role="user", content=payload.message)
    db.add(user_msg)
    db.commit()

    answer, model = await generate_reply(payload.message, history)
    assistant_msg = Message(conversation_id=conversation.id, role="assistant", content=answer)
    db.add(assistant_msg)
    db.commit()
    db.refresh(assistant_msg)
    return {
        "conversation_id": conversation.id,
        "reply": answer,
        "model": model,
        "message_id": assistant_msg.id
    }

@app.get("/api/notes", response_model=list[NoteOut])
def list_notes(db: Session = Depends(get_db)):
    return db.query(Note).order_by(desc(Note.updated_at)).all()

@app.post("/api/notes", response_model=NoteOut)
def create_note(payload: NoteIn, db: Session = Depends(get_db)):
    note = Note(title=payload.title, content=payload.content)
    db.add(note); db.commit(); db.refresh(note)
    return note

@app.put("/api/notes/{note_id}", response_model=NoteOut)
def update_note(note_id: int, payload: NoteIn, db: Session = Depends(get_db)):
    note = db.query(Note).filter(Note.id == note_id).first()
    if not note: raise HTTPException(404, "Note not found")
    note.title = payload.title; note.content = payload.content
    db.commit(); db.refresh(note)
    return note

@app.delete("/api/notes/{note_id}")
def delete_note(note_id: int, db: Session = Depends(get_db)):
    note = db.query(Note).filter(Note.id == note_id).first()
    if not note: raise HTTPException(404, "Note not found")
    db.delete(note); db.commit()
    return {"deleted": True}

@app.post("/api/documents")
def save_document(payload: DocumentIn, db: Session = Depends(get_db)):
    doc = Document(filename=Path(payload.filename).name, content=payload.content)
    db.add(doc); db.commit(); db.refresh(doc)
    return {"id": doc.id, "filename": doc.filename, "characters": len(doc.content)}

@app.get("/api/documents")
def list_documents(db: Session = Depends(get_db)):
    return db.query(Document).order_by(desc(Document.created_at)).all()

@app.post("/api/documents/upload")
async def upload_text(file: UploadFile = File(...), db: Session = Depends(get_db)):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".txt", ".md"}:
        raise HTTPException(415, "Only .txt and .md files are supported in this starter.")
    raw = await file.read()
    if len(raw) > 2_000_000:
        raise HTTPException(413, "File must be smaller than 2 MB.")
    content = raw.decode("utf-8", errors="replace")
    doc = Document(filename=Path(file.filename or "document.txt").name, content=content)
    db.add(doc); db.commit(); db.refresh(doc)
    return {"id": doc.id, "filename": doc.filename, "characters": len(content)}
