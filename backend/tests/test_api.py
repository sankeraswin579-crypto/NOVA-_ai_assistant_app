from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

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
