import ipaddress
import json
from dataclasses import dataclass
from typing import AsyncIterator, Literal, Protocol
from urllib.parse import urlparse

import httpx

from .config import settings

ProviderName = Literal["ollama", "gemini", "openai", "groq", "anthropic"]
RoutingMode = Literal["local-only", "local-first", "cloud-first"]


class AIEngineError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 503):
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class ProviderConfig:
    name: ProviderName
    model: str
    base_url: str
    api_key: str = ""

    @property
    def configured(self) -> bool:
        if self.name == "ollama":
            return bool(self.model) and _is_loopback_url(self.base_url)
        return bool(self.model and self.api_key)


@dataclass(frozen=True)
class AIResult:
    text: str
    provider: ProviderName
    model: str
    fallback_from: str | None = None
    # Token counts as reported by the provider, when it reports them:
    # {"prompt_tokens": int, "completion_tokens": int}
    usage: dict | None = None


def _is_loopback_url(value: str) -> bool:
    try:
        host = urlparse(value).hostname
        if not host:
            return False
        if host.lower() == "localhost":
            return True
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def provider_config(name: ProviderName) -> ProviderConfig:
    if name == "ollama":
        return ProviderConfig(name, settings.ollama_model, settings.ollama_base_url)
    if name == "gemini":
        return ProviderConfig(
            name, settings.gemini_model, "https://generativelanguage.googleapis.com/v1beta",
            settings.gemini_api_key,
        )
    if name == "openai":
        return ProviderConfig(name, settings.openai_model, settings.openai_base_url, settings.openai_api_key)
    if name == "anthropic":
        return ProviderConfig(
            name, settings.anthropic_model, settings.anthropic_base_url, settings.anthropic_api_key,
        )
    return ProviderConfig(name, settings.groq_model, settings.groq_base_url, settings.groq_api_key)


def provider_status() -> list[dict]:
    names: tuple[ProviderName, ...] = ("ollama", "gemini", "openai", "groq", "anthropic")
    return [
        {
            "provider": config.name,
            "model": config.model,
            "configured": config.configured,
            "local": config.name == "ollama",
        }
        for config in (provider_config(name) for name in names)
    ]


def _provider_order(mode: RoutingMode, preferred: ProviderName | None) -> list[ProviderName]:
    if mode == "local-only":
        if preferred and preferred != "ollama":
            raise AIEngineError("Local-only mode only allows the local Ollama provider.", status_code=422)
        return ["ollama"]
    if mode == "local-first":
        order: list[ProviderName] = ["ollama", "openai", "gemini", "groq", "anthropic"]
    else:
        order = ["openai", "anthropic", "gemini", "groq", "ollama"]
    if preferred:
        order = [preferred] + [item for item in order if item != preferred]
    return order


def _normalize_messages(messages: list[dict[str, str]]) -> list[dict[str, str]]:
    return [
        {"role": item["role"], "content": item["content"]}
        for item in messages
        if item.get("role") in {"system", "user", "assistant"} and isinstance(item.get("content"), str)
    ]


def _record_usage(usage: dict | None, prompt_tokens, completion_tokens) -> None:
    """Copy provider-reported token counts into the caller's sink, ignoring absences."""
    if usage is None:
        return
    if isinstance(prompt_tokens, int) and prompt_tokens >= 0:
        usage["prompt_tokens"] = prompt_tokens
    if isinstance(completion_tokens, int) and completion_tokens >= 0:
        usage["completion_tokens"] = completion_tokens


def _provider_error(provider: ProviderName, error: Exception) -> AIEngineError:
    if isinstance(error, httpx.TimeoutException):
        return AIEngineError(f"{provider.title()} timed out. Check the connection and try again.")
    if isinstance(error, httpx.ConnectError):
        return AIEngineError(f"Could not connect to {provider.title()}. Check its URL and availability.")
    if isinstance(error, httpx.HTTPStatusError):
        status = error.response.status_code
        if status in {401, 403}:
            return AIEngineError(f"{provider.title()} rejected its API credentials.", status_code=502)
        if status == 429:
            return AIEngineError(f"{provider.title()} rate limit reached. Try again later.")
        if status in {400, 404, 413, 422}:
            return AIEngineError(
                f"{provider.title()} rejected the request. Check the selected model and input.",
                status_code=502,
            )
        return AIEngineError(f"{provider.title()} returned an error (HTTP {status}).")
    if isinstance(error, (KeyError, ValueError, TypeError)):
        return AIEngineError(f"{provider.title()} returned an invalid response.")
    return AIEngineError(f"{provider.title()} could not complete the request.")


class ProviderAdapter(Protocol):
    async def stream(
        self,
        config: ProviderConfig,
        model: str,
        messages: list[dict[str, str]],
        usage: dict | None = None,
    ) -> AsyncIterator[str]: ...

    async def check(self, config: ProviderConfig) -> dict: ...


class OllamaAdapter:
    async def stream(
        self,
        config: ProviderConfig,
        model: str,
        messages: list[dict[str, str]],
        usage: dict | None = None,
    ) -> AsyncIterator[str]:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=10)) as client:
            async with client.stream(
                "POST",
                f"{config.base_url.rstrip('/')}/api/chat",
                json={"model": model, "messages": _normalize_messages(messages), "stream": True},
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    data = json.loads(line)
                    if data.get("error"):
                        raise AIEngineError(f"Ollama: {data['error']}")
                    _record_usage(usage, data.get("prompt_eval_count"), data.get("eval_count"))
                    text = data.get("message", {}).get("content", "")
                    if text:
                        yield text

    async def check(self, config: ProviderConfig) -> dict:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(f"{config.base_url.rstrip('/')}/api/tags")
            response.raise_for_status()
        names = [item.get("name") for item in response.json().get("models", [])]
        available = config.model in names or f"{config.model}:latest" in names
        return {
            "provider": config.name,
            "available": available,
            "message": "Connected." if available else f"Connected, but model '{config.model}' is not installed.",
        }


class GeminiAdapter:
    async def stream(
        self,
        config: ProviderConfig,
        model: str,
        messages: list[dict[str, str]],
        usage: dict | None = None,
    ) -> AsyncIterator[str]:
        contents = []
        system = []
        for item in _normalize_messages(messages):
            if item["role"] == "system":
                system.append(item["content"])
            else:
                contents.append({
                    "role": "model" if item["role"] == "assistant" else "user",
                    "parts": [{"text": item["content"]}],
                })
        body = {"contents": contents, "generationConfig": {"temperature": 0.7}}
        if system:
            body["systemInstruction"] = {"parts": [{"text": "\n\n".join(system)}]}
        endpoint = f"{config.base_url}/models/{model}:streamGenerateContent?alt=sse"
        async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=10)) as client:
            async with client.stream(
                "POST",
                endpoint,
                headers={"x-goog-api-key": config.api_key},
                json=body,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = json.loads(line[5:].strip())
                    metadata = data.get("usageMetadata") or {}
                    _record_usage(
                        usage, metadata.get("promptTokenCount"), metadata.get("candidatesTokenCount"),
                    )
                    for candidate in data.get("candidates", []):
                        for part in candidate.get("content", {}).get("parts", []):
                            if part.get("text"):
                                yield part["text"]

    async def check(self, config: ProviderConfig) -> dict:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(
                f"{config.base_url}/models",
                headers={"x-goog-api-key": config.api_key},
            )
            response.raise_for_status()
        return {"provider": config.name, "available": True, "message": "Connected."}


ANTHROPIC_API_VERSION = "2023-06-01"


def _anthropic_payload(model: str, messages: list[dict[str, str]], max_tokens: int) -> dict:
    """Build an Anthropic Messages request body.

    Anthropic differs from the OpenAI shape: the system prompt is a top-level field, roles
    are user/assistant only, the turns must alternate, and the conversation must open with
    a user turn. Consecutive same-role turns are merged and any leading assistant turn is
    dropped, so a truncated history cannot produce a 400.
    """
    system_parts: list[str] = []
    contents: list[dict[str, str]] = []
    for item in _normalize_messages(messages):
        if item["role"] == "system":
            system_parts.append(item["content"])
            continue
        role = "assistant" if item["role"] == "assistant" else "user"
        if contents and contents[-1]["role"] == role:
            contents[-1]["content"] += "\n\n" + item["content"]
        else:
            contents.append({"role": role, "content": item["content"]})
    while contents and contents[0]["role"] != "user":
        contents.pop(0)
    if not contents:
        contents = [{"role": "user", "content": "(no message)"}]
    payload: dict = {"model": model, "max_tokens": max_tokens, "messages": contents, "stream": True}
    if system_parts:
        payload["system"] = "\n\n".join(system_parts)
    return payload


class AnthropicAdapter:
    async def stream(
        self,
        config: ProviderConfig,
        model: str,
        messages: list[dict[str, str]],
        usage: dict | None = None,
    ) -> AsyncIterator[str]:
        endpoint = f"{config.base_url.rstrip('/')}/v1/messages"
        headers = {"x-api-key": config.api_key, "anthropic-version": ANTHROPIC_API_VERSION}
        async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=10)) as client:
            async with client.stream(
                "POST",
                endpoint,
                headers=headers,
                json=_anthropic_payload(model, messages, settings.anthropic_max_tokens),
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = json.loads(line[5:].strip())
                    event_type = data.get("type")
                    if event_type == "error":
                        detail = (data.get("error") or {}).get("message", "request failed")
                        raise AIEngineError(f"Anthropic: {detail}")
                    if event_type == "message_start":
                        start = (data.get("message") or {}).get("usage") or {}
                        _record_usage(usage, start.get("input_tokens"), start.get("output_tokens"))
                    elif event_type == "message_delta":
                        _record_usage(usage, None, (data.get("usage") or {}).get("output_tokens"))
                    delta = data.get("delta") or {}
                    if event_type == "content_block_delta" and delta.get("type") == "text_delta":
                        text = delta.get("text")
                        if text:
                            yield text

    async def check(self, config: ProviderConfig) -> dict:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(
                f"{config.base_url.rstrip('/')}/v1/models",
                headers={"x-api-key": config.api_key, "anthropic-version": ANTHROPIC_API_VERSION},
            )
            response.raise_for_status()
        names = [item.get("id") for item in response.json().get("data", [])]
        available = not names or config.model in names
        return {
            "provider": config.name,
            "available": available,
            "message": "Connected." if available else (
                f"Connected, but model '{config.model}' is not available to this API key."
            ),
        }


class OpenAICompatibleAdapter:
    async def stream(
        self,
        config: ProviderConfig,
        model: str,
        messages: list[dict[str, str]],
        usage: dict | None = None,
    ) -> AsyncIterator[str]:
        endpoint = f"{config.base_url.rstrip('/')}/chat/completions"
        async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=10)) as client:
            async with client.stream(
                "POST",
                endpoint,
                headers={"Authorization": "Bearer " + config.api_key},
                json={
                    "model": model,
                    "messages": _normalize_messages(messages),
                    "stream": True,
                    # Both OpenAI and Groq report token usage on the final chunk only
                    # when this option is set.
                    "stream_options": {"include_usage": True},
                },
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if payload == "[DONE]":
                        break
                    data = json.loads(payload)
                    reported = data.get("usage") or {}
                    _record_usage(
                        usage, reported.get("prompt_tokens"), reported.get("completion_tokens"),
                    )
                    for choice in data.get("choices", []):
                        text = choice.get("delta", {}).get("content")
                        if isinstance(text, str) and text:
                            yield text

    async def check(self, config: ProviderConfig) -> dict:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(
                f"{config.base_url.rstrip('/')}/models",
                headers={"Authorization": "Bearer " + config.api_key},
            )
            response.raise_for_status()
        return {"provider": config.name, "available": True, "message": "Connected."}


_ADAPTERS: dict[ProviderName, ProviderAdapter] = {
    "ollama": OllamaAdapter(),
    "gemini": GeminiAdapter(),
    "openai": OpenAICompatibleAdapter(),
    "groq": OpenAICompatibleAdapter(),
    "anthropic": AnthropicAdapter(),
}


class AIEngine:
    async def generate(
        self,
        messages: list[dict[str, str]],
        *,
        mode: RoutingMode = "local-only",
        provider: ProviderName | None = None,
        model: str | None = None,
    ) -> AIResult:
        if model and not provider:
            raise AIEngineError("Select a provider when choosing a specific model.", status_code=422)
        result = ""
        last_error: AIEngineError | None = None
        first_error: str | None = None
        for name in _provider_order(mode, provider):
            config = provider_config(name)
            if not config.configured:
                continue
            selected_model = model.strip() if model and name == provider else config.model
            usage: dict = {}
            try:
                async for part in _ADAPTERS[name].stream(config, selected_model, messages, usage):
                    result += part
                if not result.strip():
                    raise AIEngineError(f"{name.title()} returned an empty response.")
                return AIResult(result.strip(), name, selected_model, first_error, usage or None)
            except AIEngineError as error:
                last_error = error
                if first_error is None:
                    first_error = str(error)
            except (httpx.HTTPError, KeyError, ValueError, TypeError) as error:
                last_error = _provider_error(name, error)
                if first_error is None:
                    first_error = str(last_error)
            result = ""
        if last_error:
            if mode != "local-only" and first_error and str(last_error) != first_error:
                raise AIEngineError(f"All configured AI providers failed. {last_error}")
            raise last_error
        if mode == "local-only":
            raise AIEngineError(
                "Local Ollama is not configured or available. Set OLLAMA_MODEL and start Ollama."
            )
        raise AIEngineError(
            "No AI provider is configured. Configure Ollama locally or add a cloud provider API key on the API host."
        )

    async def stream(
        self,
        messages: list[dict[str, str]],
        *,
        mode: RoutingMode = "local-only",
        provider: ProviderName | None = None,
        model: str | None = None,
    ) -> AsyncIterator[dict]:
        if model and not provider:
            yield {"type": "error", "details": "Select a provider when choosing a specific model."}
            return
        try:
            order = _provider_order(mode, provider)
        except AIEngineError as error:
            yield {"type": "error", "details": str(error)}
            return
        partial = ""
        failures: list[str] = []
        for name in order:
            config = provider_config(name)
            if not config.configured:
                continue
            selected_model = model.strip() if model and name == provider else config.model
            partial = ""
            usage: dict = {}
            try:
                yield {"type": "meta", "provider": name, "model": selected_model}
                async for text in _ADAPTERS[name].stream(config, selected_model, messages, usage):
                    partial += text
                    yield {"type": "token", "text": text}
                if partial.strip():
                    if failures:
                        yield {"type": "fallback", "details": failures[0]}
                    yield {"type": "done", "usage": usage or None}
                    return
                raise AIEngineError(f"{name.title()} returned an empty response.")
            except AIEngineError as error:
                failures.append(str(error))
                if partial:
                    yield {"type": "reset"}
                yield {"type": "provider_error", "provider": name, "details": str(error)}
            except (httpx.HTTPError, KeyError, ValueError, TypeError) as error:
                failure = _provider_error(name, error)
                failures.append(str(failure))
                if partial:
                    yield {"type": "reset"}
                yield {"type": "provider_error", "provider": name, "details": str(failure)}
        if not failures:
            failures.append(
                "Local Ollama is not configured or available. Set OLLAMA_MODEL and start Ollama."
                if mode == "local-only"
                else "No AI provider is configured. Configure Ollama locally or add a cloud provider API key on the API host."
            )
        yield {"type": "error", "details": failures[-1]}

    async def check_provider(self, name: ProviderName) -> dict:
        config = provider_config(name)
        if not config.configured:
            return {"provider": name, "available": False, "message": "Provider is not configured."}
        try:
            return await _ADAPTERS[name].check(config)
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as error:
            return {"provider": name, "available": False, "message": str(_provider_error(name, error))}


engine = AIEngine()
