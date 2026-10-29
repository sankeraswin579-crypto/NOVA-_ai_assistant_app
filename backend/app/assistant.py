import httpx
from .config import settings

SYSTEM_PROMPT = (
    "You are Nova, a helpful private desktop assistant. Be clear, practical, and honest. "
    "If the user asks for current facts and you have no web access, say so."
)

async def generate_reply(message: str, history: list[dict]) -> tuple[str, str]:
    # Optional private local model. If it is not running, use deterministic offline fallback.
    if settings.ollama_model:
        try:
            messages = [{"role": "system", "content": SYSTEM_PROMPT}] + history[-12:] + [
                {"role": "user", "content": message}
            ]
            async with httpx.AsyncClient(timeout=90) as client:
                response = await client.post(
                    f"{settings.ollama_base_url.rstrip('/')}/api/chat",
                    json={"model": settings.ollama_model, "messages": messages, "stream": False}
                )
                response.raise_for_status()
                answer = response.json().get("message", {}).get("content", "").strip()
                if answer:
                    return answer, f"ollama:{settings.ollama_model}"
        except Exception:
            pass

    lower = message.lower().strip()
    if any(g in lower for g in ["hello", "hi nova", "hey nova", "good morning", "good evening"]):
        answer = "Hello! I'm Nova. I can help you plan work, explain concepts, draft text, and organize ideas. I'm running in offline fallback mode."
    elif "summar" in lower and len(message) > 300:
        answer = "Offline summary helper: identify the main topic, key claims, evidence, and next actions. For a reliable summary, paste a shorter passage or connect a local Ollama model for stronger language understanding."
    elif any(w in lower for w in ["python", "react", "fastapi", "javascript", "sql"]):
        answer = (
            "Here's a practical way to approach it:\n\n"
            "1. Define the smallest working example.\n"
            "2. Build one feature at a time and test it immediately.\n"
            "3. Keep configuration in environment variables, not source code.\n"
            "4. Add validation and clear error handling.\n\n"
            "I'm currently using Nova's offline fallback, so this is a general checklist rather than model-generated code. Set up Ollama for deeper local coding help."
        )
    elif len(message) < 20:
        answer = f"You said: “{message}”. Tell me your goal and constraints, and I'll help you break it into actionable steps."
    else:
        answer = (
            "I'm running in local offline mode without a connected language model. I saved your message to this conversation.\n\n"
            "For richer answers without sending data to a cloud API, install Ollama, pull a model such as `llama3.2:3b`, and set `OLLAMA_MODEL=llama3.2:3b` in `backend/.env`.\n\n"
            "I can still help you organize ideas, keep notes, and maintain your chat history here."
        )
    return answer, "offline-fallback"
