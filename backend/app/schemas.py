from datetime import datetime
from pydantic import BaseModel, Field

class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=12000)
    conversation_id: int | None = None

class MessageOut(BaseModel):
    id: int
    role: str
    content: str
    created_at: datetime
    model_config = {"from_attributes": True}

class ConversationOut(BaseModel):
    id: int
    title: str
    created_at: datetime
    messages: list[MessageOut] = []
    model_config = {"from_attributes": True}

class NoteIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(default="", max_length=100000)

class NoteOut(BaseModel):
    id: int
    title: str
    content: str
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}

class DocumentIn(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1, max_length=500000)
