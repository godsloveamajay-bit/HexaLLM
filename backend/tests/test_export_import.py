import io
import zipfile

import pytest


def _register(client, email="t@example.com", username="tester", password="Pass123!"):
    r = client.post("/api/v1/auth/register", json={
        "email": email, "username": username, "password": password,
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_zip_import_roundtrip(client, db):
    token = _register(client)
    # create a session + message directly
    from app.models.chat import ChatSession, ChatMessage
    s = ChatSession(title="Hello", model_name="m", user_id=1)
    db.add(s)
    db.flush()
    db.add(ChatMessage(session_id=s.id, role="user", content="hi"))
    db.commit()

    # export
    r = client.post("/api/v1/export-import/export", headers=_auth(token),
                    json={"format": "zip"})
    assert r.status_code in (200, 201), r.text
    zip_bytes = r.content

    # duplicate skip
    r = client.post("/api/v1/export-import/import", headers=_auth(token),
                    files={"file": ("x.zip", zip_bytes, "application/zip")})
    assert r.status_code in (200, 201), r.text
    data = r.json()
    assert data["imported_sessions"] == 0
    assert data["skipped_sessions"] == 1

    # overwrite
    r = client.post("/api/v1/export-import/import", headers=_auth(token),
                    files={"file": ("x.zip", zip_bytes, "application/zip")},
                    data={"overwrite": "true"})
    assert r.status_code in (200, 201), r.text
    data = r.json()
    assert data["imported_sessions"] == 1
    assert data["imported_messages"] == 1

    # skip_duplicates=false creates new
    r = client.post("/api/v1/export-import/import", headers=_auth(token),
                    files={"file": ("x.zip", zip_bytes, "application/zip")},
                    data={"skip_duplicates": "false"})
    assert r.status_code in (200, 201), r.text
    data = r.json()
    assert data["imported_sessions"] == 1


def test_bad_zip(client):
    token = _register(client, email="t2@example.com", username="tester2")
    r = client.post("/api/v1/export-import/import", headers=_auth(token),
                    files={"file": ("bad.zip", b"not a zip", "application/zip")})
    assert r.status_code == 200
    assert r.json()["errors"]


def test_zip_slip(client):
    token = _register(client, email="t3@example.com", username="tester3")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("../evil.jsonl", '{"title":"x"}\n')
    r = client.post("/api/v1/export-import/import", headers=_auth(token),
                    files={"file": ("slip.zip", buf.getvalue(), "application/zip")})
    assert r.status_code == 200
    assert "Unsafe" in " ".join(r.json()["errors"])


def test_markdown_import_single(client, db):
    token = _register(client, email="md@example.com", username="mduser")
    md = """# MD Chat

**Model:** gemma3:27b
**Created:** 2026-11-01T22:05:44.917671+00:00
**Updated:** 2026-11-01T22:05:44.917674+00:00

---

## User (2026-11-01T22:05:44.918699+00:00)

> hello md

## Assistant (2026-11-01T22:05:44.918701+00:00)

> hi there
"""
    r = client.post("/api/v1/export-import/import", headers=_auth(token),
                    files={"file": ("chat.md", md.encode(), "text/markdown")})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["imported_sessions"] == 1
    assert data["imported_messages"] == 2
