"""Pluggable storage backends for uploaded files.

The default backend stores files on the local filesystem. An S3 backend is
available when boto3 is installed and ``STORAGE_BACKEND=s3`` is configured.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Protocol

from ..core.config import settings


class StorageBackend(Protocol):
    def save(self, key: str, data) -> str: ...
    def read(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...
    def exists(self, key: str) -> bool: ...


class LocalStorageBackend:
    def __init__(self, root: str | None = None):
        self.root = Path(root or settings.STORAGE_ROOT or settings.UPLOADS_DIR)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        return self.root / key

    def save(self, key: str, data) -> str:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        if hasattr(data, "read"):
            with open(path, "wb") as out:
                import shutil
                shutil.copyfileobj(data, out)
        elif isinstance(data, (bytes, bytearray)):
            path.write_bytes(bytes(data))
        else:
            path.write_text(str(data), encoding="utf-8")
        return str(path)

    def read(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        try:
            self._path(key).unlink()
        except FileNotFoundError:
            pass

    def exists(self, key: str) -> bool:
        return self._path(key).exists()


def get_storage() -> StorageBackend:
    backend = (settings.STORAGE_BACKEND or "local").lower()
    if backend == "local":
        return LocalStorageBackend()
    if backend == "s3":
        try:
            import boto3
        except ImportError as exc:
            raise RuntimeError("S3 storage requires boto3") from exc
        return S3StorageBackend()
    raise ValueError(f"Unknown storage backend: {backend}")


class S3StorageBackend:
    def __init__(self):
        import boto3
        self.bucket = settings.S3_BUCKET
        self.prefix = settings.S3_PREFIX.strip("/")
        self.client = boto3.client("s3")

    def _key(self, key: str) -> str:
        return f"{self.prefix}/{key}".lstrip("/") if self.prefix else key

    def save(self, key: str, data) -> str:
        k = self._key(key)
        if hasattr(data, "read"):
            self.client.upload_fileobj(data, self.bucket, k)
        elif isinstance(data, (bytes, bytearray)):
            self.client.put_object(Bucket=self.bucket, Key=k, Body=bytes(data))
        else:
            self.client.put_object(Bucket=self.bucket, Key=k, Body=str(data).encode())
        return f"s3://{self.bucket}/{k}"

    def read(self, key: str) -> bytes:
        import io
        buf = io.BytesIO()
        self.client.download_fileobj(self.bucket, self._key(key), buf)
        return buf.getvalue()

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=self._key(key))

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=self._key(key))
            return True
        except Exception:
            return False
