import app.api.prompts  # noqa: F401

def _register(client, email="pr@example.com", username="pruser", password="Pass123!"):
    r = client.post("/api/v1/auth/register", json={
        "email": email, "username": username, "password": password,
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_prompt_versioning(client):
    token = _register(client)
    r = client.post("/api/v1/prompts", headers=_auth(token), json={
        "title": "P", "content": "hello {{name}}", "tags": ["t"],
    })
    assert r.status_code in (200, 201), r.text
    pid = r.json()["id"]
    r = client.get(f"/api/v1/prompts/{pid}/versions", headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 1

    r = client.patch(f"/api/v1/prompts/{pid}", headers=_auth(token), json={"content": "hi {{name}}"})
    assert r.status_code == 200, r.text
    r = client.get(f"/api/v1/prompts/{pid}/versions", headers=_auth(token))
    assert r.json()["total"] == 2

    vid = r.json()["versions"][-1]["id"]
    r = client.post(f"/api/v1/prompts/{pid}/versions/{vid}/restore", headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json()["content"] == "hello {{name}}"
