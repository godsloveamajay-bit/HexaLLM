def _register(client, email, username, password="Pass123!"):
    r = client.post("/api/v1/auth/register", json={
        "email": email, "username": username, "password": password,
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["access_token"], r.json()["user"]["id"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_agent_run_ownership(client):
    token_a, _ = _register(client, "a@example.com", "auser")
    token_b, _ = _register(client, "b@example.com", "buser")
    r = client.post("/api/v1/agents/run", headers=_auth(token_a), json={
        "task": "Use code_exec to print 1",
        "tools": ["code_exec"],
        "max_steps": 2,
        "model": "gemma3:27b",
    })
    assert r.status_code == 201, r.text
    run_id = r.json()["id"]
    # owner can fetch
    r = client.get(f"/api/v1/agents/runs/{run_id}", headers=_auth(token_a))
    assert r.status_code == 200
    # other user cannot
    r = client.get(f"/api/v1/agents/runs/{run_id}", headers=_auth(token_b))
    assert r.status_code == 404
