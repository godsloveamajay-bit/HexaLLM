"""Extract plain text from uploaded documents."""
from __future__ import annotations

import csv
from pathlib import Path


def _load_pdf(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as e:
        raise RuntimeError(
            "PDF support requires the 'pypdf' package — pip install pypdf"
        ) from e
    reader = PdfReader(str(path))
    return "\n\n".join((page.extract_text() or "") for page in reader.pages)


def _load_csv(path: Path) -> str:
    out_lines = []
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        reader = csv.reader(f)
        for row in reader:
            out_lines.append(", ".join(row))
    return "\n".join(out_lines)


def _load_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


_EXT_LOADERS = {
    ".pdf": _load_pdf,
    ".csv": _load_csv,
    ".txt": _load_text,
    ".md": _load_text,
    ".markdown": _load_text,
    ".rst": _load_text,
    ".html": _load_text,
    ".htm": _load_text,
    ".json": _load_text,
    ".log": _load_text,
}


SUPPORTED_EXTS = sorted(_EXT_LOADERS.keys())


def load_document(path: str | Path) -> str:
    """Return plain-text contents of a file. Raises on unsupported types."""
    p = Path(path)
    ext = p.suffix.lower()
    loader = _EXT_LOADERS.get(ext)
    if not loader:
        raise ValueError(
            f"Unsupported file type '{ext}'. Supported: {', '.join(SUPPORTED_EXTS)}"
        )
    return loader(p)
