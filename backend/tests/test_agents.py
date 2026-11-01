def _register(client, email="a@example.com", username="auser", password="Pass123!"):
    r = client.post("/api/v1/auth/register", json={
        "email": email, "username": username, "password": password,
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_agent_code_exec(client):
    token = _register(client)
    r = client.post("/api/v1/agents/run", headers=_auth(token), json={
        "task": "Use code_exec to print 2+2",
        "tools": ["code_exec"],
        "max_steps": 3,
        "model": "gemma3:27b",
    })
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["status"] == "completed"
    assert "4" in (data.get("result") or "")
