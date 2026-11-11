def test_local_storage_roundtrip(tmp_path):
    from app.core.config import settings
    settings.STORAGE_BACKEND = "local"
    settings.STORAGE_ROOT = str(tmp_path)
    from app.services.storage_service import get_storage
    storage = get_storage()
    key = "kb_1/1_hello.txt"
    path = storage.save(key, b"hello")
    assert storage.exists(key)
    assert storage.read(key) == b"hello"
    storage.delete(key)
    assert not storage.exists(key)
