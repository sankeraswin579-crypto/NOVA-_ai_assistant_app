from typing import Literal
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

class Settings(BaseSettings):
    database_url: str = Field(default="sqlite:///./nova.db", validation_alias="NOVA_DATABASE_URL")
    # `*` enables arbitrary hosted web origins and Electron's `null` origin.
    # Configure explicit origins instead when the API is public.
    cors_origins: str = Field(default="http://localhost:5173,http://127.0.0.1:5173,null", validation_alias="NOVA_CORS_ORIGINS")
    ollama_base_url: str = Field(default="http://127.0.0.1:11434", validation_alias="OLLAMA_BASE_URL")
    ollama_model: str = Field(default="", validation_alias="OLLAMA_MODEL")
    ollama_embedding_model: str = Field(default="nomic-embed-text", validation_alias="OLLAMA_EMBEDDING_MODEL")
    gemini_api_key: str = Field(default="", validation_alias="GEMINI_API_KEY")
    gemini_model: str = Field(default="gemini-2.0-flash", validation_alias="GEMINI_MODEL")
    openai_api_key: str = Field(default="", validation_alias="OPENAI_API_KEY")
    openai_model: str = Field(default="gpt-4o-mini", validation_alias="OPENAI_MODEL")
    openai_base_url: str = Field(default="https://api.openai.com/v1", validation_alias="OPENAI_BASE_URL")
    groq_api_key: str = Field(default="", validation_alias="GROQ_API_KEY")
    groq_model: str = Field(default="llama-3.3-70b-versatile", validation_alias="GROQ_MODEL")
    groq_base_url: str = Field(default="https://api.groq.com/openai/v1", validation_alias="GROQ_BASE_URL")
    ai_default_mode: Literal["local-only", "local-first", "cloud-first"] = Field(
        default="local-only", validation_alias="NOVA_AI_DEFAULT_MODE",
    )
    local_project_tools: bool = Field(default=False, validation_alias="NOVA_LOCAL_PROJECT_TOOLS")

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
settings = Settings()
