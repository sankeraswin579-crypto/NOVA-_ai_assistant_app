from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

class Settings(BaseSettings):
    database_url: str = Field(default="sqlite:///./nova.db", validation_alias="NOVA_DATABASE_URL")
    # `*` enables arbitrary hosted web origins and Electron's `null` origin.
    # Configure explicit origins instead when the API is public.
    cors_origins: str = Field(default="http://localhost:5173,http://127.0.0.1:5173,null", validation_alias="NOVA_CORS_ORIGINS")
    ollama_base_url: str = Field(default="http://127.0.0.1:11434", validation_alias="OLLAMA_BASE_URL")
    ollama_model: str = Field(default="", validation_alias="OLLAMA_MODEL")

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
settings = Settings()
