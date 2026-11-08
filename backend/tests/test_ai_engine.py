import asyncio

import httpx
import pytest

from app.ai_engine import AIEngine, AIEngineError, ProviderConfig, _ADAPTERS, provider_status


class FakeAdapter:
    def __init__(self, chunks, error=None):
        self.chunks = chunks
        self.error = error
        self.calls = []

    async def stream(self, config, model, messages):
        self.calls.append((config.name, model, messages))
        if self.error:
            raise self.error
        for chunk in self.chunks:
            yield chunk

    async def check(self, config):
        return {"provider": config.name, "available": True, "message": "Connected."}


def _configured_provider(name, model):
    return ProviderConfig(name, model, "http://127.0.0.1:11434" if name == "ollama" else "https://provider.test", "key")


def test_local_only_never_attempts_cloud_provider(monkeypatch):
    ollama = FakeAdapter(["local answer"])
    openai = FakeAdapter(["should not be called"])
    monkeypatch.setattr("app.ai_engine.provider_config", lambda name: _configured_provider(name, "model"))
    monkeypatch.setitem(_ADAPTERS, "ollama", ollama)
    monkeypatch.setitem(_ADAPTERS, "openai", openai)

    result = asyncio.run(AIEngine().generate(
        [{"role": "user", "content": "private text"}],
        mode="local-only",
    ))

    assert result.provider == "ollama"
    assert result.text == "local answer"
    assert len(ollama.calls) == 1
    assert openai.calls == []


def test_local_only_rejects_manually_selected_cloud_provider():
    with pytest.raises(AIEngineError, match="only allows the local Ollama"):
        asyncio.run(AIEngine().generate(
            [{"role": "user", "content": "private text"}],
            mode="local-only",
            provider="openai",
        ))


def test_local_first_falls_back_to_configured_cloud_provider(monkeypatch):
    local = FakeAdapter([], httpx.ConnectError("unavailable"))
    cloud = FakeAdapter(["cloud", " answer"])
    monkeypatch.setattr("app.ai_engine.provider_config", lambda name: _configured_provider(name, f"{name}-model"))
    monkeypatch.setitem(_ADAPTERS, "ollama", local)
    monkeypatch.setitem(_ADAPTERS, "openai", cloud)

    result = asyncio.run(AIEngine().generate(
        [{"role": "user", "content": "request"}],
        mode="local-first",
        provider="ollama",
    ))

    assert result.provider == "openai"
    assert result.model == "openai-model"
    assert result.text == "cloud answer"
    assert result.fallback_from and "Could not connect to Ollama" in result.fallback_from


def test_cloud_first_stream_reports_provider_and_tokens(monkeypatch):
    cloud = FakeAdapter(["hello", " world"])
    monkeypatch.setattr("app.ai_engine.provider_config", lambda name: _configured_provider(name, f"{name}-model"))
    monkeypatch.setitem(_ADAPTERS, "openai", cloud)
    events = asyncio.run(_collect(AIEngine().stream(
        [{"role": "user", "content": "request"}],
        mode="cloud-first",
    )))

    assert events[0] == {"type": "meta", "provider": "openai", "model": "openai-model"}
    assert [event.get("text") for event in events if event["type"] == "token"] == ["hello", " world"]
    assert events[-1] == {"type": "done"}


async def _collect(iterator):
    return [event async for event in iterator]


def test_provider_status_never_returns_credentials():
    assert all("api_key" not in provider and "key" not in provider for provider in provider_status())
