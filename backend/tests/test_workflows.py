def _register(client, email="w@example.com", username="wuser", password="Pass123!"):
    r = client.post("/api/v1/auth/register", json={
        "email": email, "username": username, "password": password,
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


import app.api.workflows as wf_mod

def test_transform_workflow(client, db, monkeypatch):
    monkeypatch.setattr(wf_mod, "SessionLocal", lambda: db)
    token = _register(client)
    r = client.post("/api/v1/workflows", headers=_auth(token), json={
        "name": "t",
        "definition": {
            "nodes": [{"node_id": "a", "node_type": "transform",
                      "config": {"transform": "passthrough", "value": "{{input.x}}"}}],
            "edges": [],
        },
    })
    assert r.status_code == 201, r.text
    wid = r.json()["id"]
    r = client.post(f"/api/v1/workflows/{wid}/execute", headers=_auth(token),
                    json={"input_data": {"x": 42}})
    assert r.status_code == 201, r.text
    eid = r.json()["id"]
    import time
    for _ in range(50):
        r = client.get(f"/api/v1/workflows/{wid}/executions/{eid}", headers=_auth(token))
        assert r.status_code == 200, r.text
        data = r.json()
        if data["execution"]["status"] in ("completed", "failed"):
            break
        time.sleep(0.1)
    assert data["execution"]["status"] == "completed"
    assert data["execution"]["output_data"] == {"output": "42"}
