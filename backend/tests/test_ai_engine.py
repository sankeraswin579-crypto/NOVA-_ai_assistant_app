import asyncio

import httpx
import pytest

from app.ai_engine import AIEngine, AIEngineError, ProviderConfig, _ADAPTERS, provider_status


class FakeAdapter:
    def __init__(self, chunks, error=None, usage=None):
        self.chunks = chunks
        self.error = error
        self.usage = usage
        self.calls = []

    async def stream(self, config, model, messages, usage=None):
        self.calls.append((config.name, model, messages))
        if self.error:
            raise self.error
        for chunk in self.chunks:
            yield chunk
        if self.usage and usage is not None:
            usage.update(self.usage)

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
    assert events[-1] == {"type": "done", "usage": None}


async def _collect(iterator):
    return [event async for event in iterator]


def test_provider_status_never_returns_credentials():
    assert all("api_key" not in provider and "key" not in provider for provider in provider_status())


def test_anthropic_payload_moves_system_out_and_opens_with_a_user_turn():
    from app.ai_engine import _anthropic_payload

    payload = _anthropic_payload(
        "claude-test",
        [
            {"role": "system", "content": "You are Nova."},
            {"role": "assistant", "content": "stale reply from a truncated history"},
            {"role": "user", "content": "first"},
            {"role": "user", "content": "second"},
            {"role": "assistant", "content": "answer"},
        ],
        max_tokens=1024,
    )

    assert payload["system"] == "You are Nova."
    assert payload["max_tokens"] == 1024
    assert payload["stream"] is True
    assert [turn["role"] for turn in payload["messages"]] == ["user", "assistant"]
    assert payload["messages"][0]["content"] == "first\n\nsecond"
    assert all(turn["role"] != "system" for turn in payload["messages"])


class _FakeSSEResponse:
    def __init__(self, lines):
        self.lines = lines

    def raise_for_status(self):
        return None

    async def aiter_lines(self):
        for line in self.lines:
            yield line

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


def _fake_client_factory(lines):
    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def stream(self, *args, **kwargs):
            return _FakeSSEResponse(lines)

    return _FakeClient


def test_anthropic_adapter_streams_text_and_records_usage(monkeypatch):
    lines = [
        'data: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":1}}}',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" there"}}',
        'data: {"type":"message_delta","usage":{"output_tokens":7}}',
        'data: {"type":"message_stop"}',
    ]
    monkeypatch.setattr("app.ai_engine.httpx.AsyncClient", _fake_client_factory(lines))
    usage = {}
    config = ProviderConfig("anthropic", "claude-test", "https://api.anthropic.test", "test-key")

    chunks = asyncio.run(_collect(_ADAPTERS["anthropic"].stream(
        config, "claude-test", [{"role": "user", "content": "hi"}], usage,
    )))

    assert "".join(chunks) == "Hello there"
    assert usage == {"prompt_tokens": 12, "completion_tokens": 7}


def test_anthropic_stream_raises_on_error_event(monkeypatch):
    lines = ['data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}']
    monkeypatch.setattr("app.ai_engine.httpx.AsyncClient", _fake_client_factory(lines))
    config = ProviderConfig("anthropic", "claude-test", "https://api.anthropic.test", "test-key")

    with pytest.raises(AIEngineError, match="Overloaded"):
        asyncio.run(_collect(_ADAPTERS["anthropic"].stream(
            config, "claude-test", [{"role": "user", "content": "hi"}],
        )))


def test_anthropic_routes_only_in_cloud_capable_modes():
    from app.ai_engine import _provider_order

    assert "anthropic" in _provider_order("cloud-first", None)
    assert "anthropic" in _provider_order("local-first", None)
    with pytest.raises(AIEngineError):
        _provider_order("local-only", "anthropic")


def test_generate_and_stream_surface_provider_usage(monkeypatch):
    adapter = FakeAdapter(["answer"], usage={"prompt_tokens": 5, "completion_tokens": 2})
    monkeypatch.setattr("app.ai_engine.provider_config", lambda name: _configured_provider(name, f"{name}-model"))
    monkeypatch.setitem(_ADAPTERS, "openai", adapter)

    result = asyncio.run(AIEngine().generate(
        [{"role": "user", "content": "request"}], mode="cloud-first",
    ))
    assert result.usage == {"prompt_tokens": 5, "completion_tokens": 2}

    events = asyncio.run(_collect(AIEngine().stream(
        [{"role": "user", "content": "request"}], mode="cloud-first",
    )))
    assert events[-1] == {"type": "done", "usage": {"prompt_tokens": 5, "completion_tokens": 2}}
