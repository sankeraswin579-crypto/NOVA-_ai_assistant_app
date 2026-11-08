from datetime import datetime
from typing import Literal
from pathlib import PurePosixPath
from pydantic import BaseModel, Field, model_validator

class ProjectFileContext(BaseModel):
    path: str = Field(min_length=1, max_length=1000)
    content: str = Field(max_length=10000)

def validate_project_paths(files: list[ProjectFileContext]) -> None:
    paths = set()
    for file in files:
        normalized = file.path.replace("\\", "/")
        path = PurePosixPath(normalized)
        if path.is_absolute() or ":" in normalized or ".." in path.parts or file.path in paths:
            raise ValueError("Project paths must be unique and stay inside the project.")
        if any(
            segment.lower().startswith(".env") or any(
                marker in segment.lower() for marker in ("secret", "credential", "token", "password", "private.key")
            )
            for segment in path.parts
        ):
            raise ValueError("Sensitive files cannot be included.")
        paths.add(file.path)

class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=12000)
    conversation_id: int | None = None
    project_name: str | None = Field(default=None, max_length=255)
    project_files: list[ProjectFileContext] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def validate_project_context(self):
        if sum(len(file.content) for file in self.project_files) > 40000:
            raise ValueError("Project context cannot exceed 40,000 characters.")
        validate_project_paths(self.project_files)
        return self

class ProjectProposalRequest(BaseModel):
    task: str = Field(min_length=1, max_length=4000)
    project_files: list[ProjectFileContext] = Field(min_length=1, max_length=8)
    agent_context: str = Field(default="", max_length=20000)

    @model_validator(mode="after")
    def validate_project_context(self):
        if sum(len(file.content) for file in self.project_files) > 40000:
            raise ValueError("Project context cannot exceed 40,000 characters.")
        validate_project_paths(self.project_files)
        return self

class ProjectTestExplanationRequest(ProjectProposalRequest):
    task: str = Field(min_length=1, max_length=10000)

class AgentExecutionRequest(BaseModel):
    agent: Literal["architect", "qa", "security"]
    task: str = Field(min_length=1, max_length=10000)
    project_files: list[ProjectFileContext] = Field(default_factory=list, max_length=8)
    agent_context: str = Field(default="", max_length=20000)

    @model_validator(mode="after")
    def validate_project_context(self):
        if sum(len(file.content) for file in self.project_files) > 40000:
            raise ValueError("Project context cannot exceed 40,000 characters.")
        validate_project_paths(self.project_files)
        return self

class AgentRunCreate(BaseModel):
    task: str = Field(min_length=1, max_length=4000)
    project_name: str = Field(default="", max_length=255)

class AgentRunEventCreate(BaseModel):
    agent: Literal["architect", "developer", "qa", "security", "supervisor"]
    status: Literal["running", "completed", "failed", "approval"]
    message: str = Field(min_length=1, max_length=20000)

class AgentRunEventOut(AgentRunEventCreate):
    created_at: datetime

class AgentRunStatusUpdate(BaseModel):
    status: Literal["completed", "failed", "cancelled"]

class AgentRunOut(BaseModel):
    id: int
    task: str
    project_name: str
    status: str
    events: list[AgentRunEventOut]
    created_at: datetime
    updated_at: datetime

class ProjectChangeProposal(BaseModel):
    path: str = Field(min_length=1, max_length=1000)
    original_content: str = Field(max_length=20000)
    proposed_content: str = Field(max_length=200000)
    summary: str = Field(min_length=1, max_length=1000)

class ProjectProposalOut(BaseModel):
    changes: list[ProjectChangeProposal] = Field(max_length=8)

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
