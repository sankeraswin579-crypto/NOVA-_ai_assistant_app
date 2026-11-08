import pytest
import asyncio
from fastapi.testclient import TestClient
from app.main import app
from app.assistant import generate_agent_response, generate_project_proposal, generate_reply
from app.config import settings
from app.database import SessionLocal
from app.models import AgentRun
from app.ai_engine import AIEngineError, AIResult, engine
from app.schemas import ChatRequest
from pydantic import ValidationError

client = TestClient(app, client=("127.0.0.1", 8765))

def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

def test_create_and_list_note():
    response = client.post("/api/notes", json={"title": "Test note", "content": "Hello Nova"})
    assert response.status_code == 200
    note_id = response.json()["id"]
    assert response.json()["title"] == "Test note"
    listed = client.get("/api/notes")
    assert listed.status_code == 200
    assert any(n["id"] == note_id for n in listed.json())
    client.delete(f"/api/notes/{note_id}")

def test_chat_uses_project_context_without_persisting_file_contents(monkeypatch):
    async def fake_generate_reply(message, history, project_name=None, project_files=None, **kwargs):
        assert project_name == "sample-project"
        assert project_files == [{"path": "src/main.py", "content": "print('private source')"}]
        return "Project-aware answer", "test-model"

    monkeypatch.setattr("app.main.generate_reply", fake_generate_reply)
    response = client.post("/api/chat", json={
        "message": "Explain this file",
        "project_name": "sample-project",
        "project_files": [{"path": "src/main.py", "content": "print('private source')"}],
    })
    assert response.status_code == 200
    assert response.json()["reply"] == "Project-aware answer"
    conversation = client.get(f"/api/conversations/{response.json()['conversation_id']}").json()
    assert [message["content"] for message in conversation["messages"]] == ["Explain this file", "Project-aware answer"]

def test_chat_rejects_oversized_project_context():
    with pytest.raises(ValidationError):
        ChatRequest(
            message="Review these files",
            project_files=[
                {"path": "a.py", "content": "a" * 10000},
                {"path": "b.py", "content": "b" * 10000},
                {"path": "c.py", "content": "c" * 10000},
                {"path": "d.py", "content": "d" * 10001},
            ],
        )

def test_chat_rejects_traversal_and_sensitive_project_paths():
    for path in ("../outside.py", "..\\outside.py", "config/secrets.py", ".env.local"):
        with pytest.raises(ValidationError):
            ChatRequest(message="Inspect file", project_files=[{"path": path, "content": "not sent"}])

def test_chat_rejects_project_context_from_non_local_client():
    remote_client = TestClient(app, client=("192.0.2.10", 1234))
    response = remote_client.post("/api/chat", json={
        "message": "Review this source",
        "project_files": [{"path": "main.py", "content": "print('hello')"}],
    })
    assert response.status_code == 403

def test_chat_rejects_project_context_from_untrusted_origin():
    response = client.post("/api/chat", headers={"Origin": "https://untrusted.example"}, json={
        "message": "Review this source",
        "project_files": [{"path": "main.py", "content": "print('hello')"}],
    })
    assert response.status_code == 403

def test_project_proposal_requires_local_tools_and_only_proposes_supplied_files(monkeypatch):
    async def fake_proposal(task, files, agent_context=""):
        assert task == "Add a greeting"
        assert files == [{"path": "src/main.py", "content": "print('hello')"}]
        assert agent_context == "Architect plan: update the greeting."
        return [{
            "path": "src/main.py",
            "original_content": "print('hello')",
            "proposed_content": "print('hello, Nova')",
            "summary": "Update greeting",
        }]

    monkeypatch.setattr("app.main.settings.local_project_tools", True)
    monkeypatch.setattr("app.main.generate_project_proposal", fake_proposal)
    response = client.post("/api/projects/proposals", json={
        "task": "Add a greeting",
        "project_files": [{"path": "src/main.py", "content": "print('hello')"}],
        "agent_context": "Architect plan: update the greeting.",
    })
    assert response.status_code == 200
    assert response.json()["changes"][0]["proposed_content"] == "print('hello, Nova')"

def test_agent_execution_is_local_only_and_uses_selected_role(monkeypatch):
    async def fake_agent(agent, task, files, context=""):
        assert agent == "architect"
        assert task == "Plan this change"
        assert files == [{"path": "main.py", "content": "print('safe')"}]
        assert context == "prior notes"
        return "Plan: inspect the entry point."

    monkeypatch.setattr("app.main.settings.local_project_tools", True)
    monkeypatch.setattr("app.main.generate_agent_response", fake_agent)
    response = client.post("/api/agents/execute", json={
        "agent": "architect",
        "task": "Plan this change",
        "project_files": [{"path": "main.py", "content": "print('safe')"}],
        "agent_context": "prior notes",
    })
    assert response.status_code == 200
    assert response.json()["reply"].startswith("Plan:")

    remote_client = TestClient(app, client=("192.0.2.10", 1234))
    remote = remote_client.post("/api/agents/execute", json={
        "agent": "architect", "task": "Plan", "project_files": [],
    })
    assert remote.status_code == 403

def test_agent_routes_reject_untrusted_origins(monkeypatch):
    monkeypatch.setattr("app.main.settings.local_project_tools", True)
    response = client.post("/api/agents/execute", headers={"Origin": "https://untrusted.example"}, json={
        "agent": "security", "task": "Review this project", "project_files": [],
    })
    assert response.status_code == 403

def test_agent_run_history_persists_only_safe_task_logs_and_is_local(monkeypatch):
    monkeypatch.setattr("app.main.settings.local_project_tools", True)
    created = client.post("/api/agents/runs", json={"task": "Improve the project", "project_name": "sample"})
    assert created.status_code == 200
    run_id = created.json()["id"]
    event = client.post(f"/api/agents/runs/{run_id}/events", json={
        "agent": "architect", "status": "completed", "message": "Plan the module boundaries.",
    })
    assert event.status_code == 200
    assert event.json()["events"][0]["message"] == "Plan the module boundaries."
    assert client.get("/api/agents/runs").json()[0]["id"] == run_id
    assert client.patch(f"/api/agents/runs/{run_id}", json={"status": "completed"}).status_code == 200
    assert client.post(f"/api/agents/runs/{run_id}/events", json={
        "agent": "security", "status": "completed", "message": "should not append",
    }).status_code == 200

    assert client.post("/api/agents/runs", json={
        "task": 'API_KEY = "credential-value"', "project_name": "sample",
    }).status_code == 422
    remote_client = TestClient(app, client=("192.0.2.10", 1234))
    assert remote_client.get("/api/agents/runs").status_code == 403
    with SessionLocal() as db:
        db.query(AgentRun).filter(AgentRun.id == run_id).delete()
        db.commit()

def test_agent_response_requires_local_model_and_rejects_sensitive_context(monkeypatch):
    monkeypatch.setattr(settings, "ollama_model", "test-model")
    monkeypatch.setattr(settings, "ollama_base_url", "https://models.example")
    with pytest.raises(RuntimeError, match="local Ollama URL"):
        asyncio.run(generate_agent_response("architect", "Plan", [], ""))
    monkeypatch.setattr(settings, "ollama_base_url", "http://127.0.0.1:11434")
    with pytest.raises(ValueError, match="sensitive values"):
        asyncio.run(generate_agent_response(
            "security", "Review", [{"path": "main.py", "content": 'API_KEY="secret-value"'}],
        ))

def test_agent_response_uses_local_model_and_marks_context_untrusted(monkeypatch):
    monkeypatch.setattr(settings, "ollama_model", "test-model")
    monkeypatch.setattr(settings, "ollama_base_url", "http://127.0.0.1:11434")
    captured = {}

    async def fake_generate(messages, **kwargs):
        captured["messages"] = messages
        captured["kwargs"] = kwargs
        return AIResult("Plan: inspect the entry point.", "ollama", "test-model")

    monkeypatch.setattr(engine, "generate", fake_generate)
    reply = asyncio.run(generate_agent_response(
        "architect",
        "Plan a small refactor",
        [{"path": "main.py", "content": "print('safe')"}],
        "Prior review: keep the API stable.",
    ))
    assert reply.startswith("Plan:")
    assert captured["kwargs"] == {"mode": "local-only", "provider": "ollama"}
    assert "untrusted reference data" in captured["messages"][0]["content"]
    assert "Prior review" in captured["messages"][1]["content"]

def test_project_proposals_reject_traversal_and_sensitive_paths():
    for path in ("../outside.py", "..\\outside.py", "config/secrets.py", ".env.example"):
        response = client.post("/api/projects/proposals", json={
            "task": "Change it",
            "project_files": [{"path": path, "content": "safe"}],
        })
        assert response.status_code == 422

def test_project_proposal_does_not_send_sensitive_values_to_model(monkeypatch):
    monkeypatch.setattr(settings, "ollama_model", "test-model")
    monkeypatch.setattr(settings, "ollama_base_url", "http://127.0.0.1:11434")
    with pytest.raises(ValueError, match="sensitive values"):
        asyncio.run(generate_project_proposal("Review this file", [
            {"path": "main.py", "content": 'API_KEY = "credential-value"'},
        ]))

def test_project_proposal_rejects_sensitive_model_output(monkeypatch):
    monkeypatch.setattr(settings, "ollama_model", "test-model")
    monkeypatch.setattr(settings, "ollama_base_url", "http://127.0.0.1:11434")

    async def fake_generate(*args, **kwargs):
        return AIResult(
            '{"changes":[{"path":"main.py","proposed_content":'
            '"API_KEY = \\"credential-value\\"","summary":"Update"}]}',
            "ollama",
            "test-model",
        )

    monkeypatch.setattr(engine, "generate", fake_generate)
    with pytest.raises(ValueError, match="sensitive project values"):
        asyncio.run(generate_project_proposal("Review this file", [
            {"path": "main.py", "content": "print('safe')"},
        ]))

def test_project_proposal_rejects_untrusted_origin(monkeypatch):
    monkeypatch.setattr("app.main.settings.local_project_tools", True)
    response = client.post("/api/projects/proposals", headers={"Origin": "https://untrusted.example"}, json={
        "task": "Change it",
        "project_files": [{"path": "main.py", "content": "safe"}],
    })
    assert response.status_code == 403

def test_test_explanation_requires_local_tools_and_does_not_store_output(monkeypatch):
    async def fake_reply(message, history, project_name=None, project_files=None):
        assert "test output" in message.lower()
        assert history == []
        assert project_files == [{"path": "main.py", "content": "print('hello')"}]
        return "The assertion failed because the expected text differs.", "test-model"

    monkeypatch.setattr("app.main.settings.local_project_tools", True)
    monkeypatch.setattr("app.main.generate_reply", fake_reply)
    response = client.post("/api/projects/explain-tests", json={
        "task": "AssertionError: expected 1 but received 2",
        "project_files": [{"path": "main.py", "content": "print('hello')"}],
    })
    assert response.status_code == 200
    assert response.json()["reply"].startswith("The assertion failed")

def test_project_context_never_goes_to_a_remote_model_endpoint(monkeypatch):
    monkeypatch.setattr(settings, "ollama_model", "test-model")
    monkeypatch.setattr(settings, "ollama_base_url", "https://models.example")
    with pytest.raises(AIEngineError, match="project files were not sent"):
        asyncio.run(generate_reply(
            "Explain this file",
            [],
            "project",
            [{"path": "main.py", "content": "private source"}],
        ))
    with pytest.raises(RuntimeError, match="local Ollama URL"):
        asyncio.run(generate_project_proposal("Change it", [{"path": "main.py", "content": "safe"}]))
