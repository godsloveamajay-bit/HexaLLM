def _register(client, email="p@example.com", username="puser", password="Pass123!"):
    r = client.post("/api/v1/auth/register", json={
        "email": email, "username": username, "password": password,
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_plugin_secret_crud(client):
    token = _register(client)
    name = "demo-plugin"
    # set
    r = client.put(f"/api/v1/plugins/{name}/secrets/API_TOKEN", headers=_auth(token),
                   json={"value": "supersecret"})
    assert r.status_code == 200, r.text
    assert r.json()["stored"] is True
    # list names only
    r = client.get(f"/api/v1/plugins/{name}/secrets", headers=_auth(token))
    assert r.status_code == 200, r.text
    assert "API_TOKEN" in r.json()["secrets"]
    # delete
    r = client.delete(f"/api/v1/plugins/{name}/secrets/API_TOKEN", headers=_auth(token))
    assert r.status_code == 204, r.text
    r = client.get(f"/api/v1/plugins/{name}/secrets", headers=_auth(token))
    assert r.json()["secrets"] == []
