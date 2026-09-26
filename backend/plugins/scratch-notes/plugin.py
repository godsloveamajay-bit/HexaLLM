"""scratch-notes — filesystem access inside the plugin's own data dir.

The manifest declares ``filesystem: ["scratch"]``. The harness allows reads
and writes only under ``$HEXALLM_PLUGIN_DATA`` and its declared sub-paths, and
denies everything else, so ``open("/etc/passwd")`` raises before it is
reached. That directory persists between calls, so notes survive.

``$HEXALLM_PLUGIN_DATA`` is provided by the runtime; there's no reason for a
plugin to hardcode a host path.
"""
import json
import os
import re

TOOLS = [
    {
        "name": "note_write",
        "description": "Save a note in the plugin's private storage. Input: JSON {\"name\": \"my-note\", \"text\": \"...\"}",
        "input_schema": {
            "type": "object",
            "properties": {"name": {"type": "string"}, "text": {"type": "string"}},
            "required": ["name", "text"],
        },
    },
    {
        "name": "note_read",
        "description": "Read a saved note by name.",
        "input_schema": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]},
    },
    {"name": "note_list", "description": "List saved notes."},
]

SCRATCH = "scratch"
_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


def _dir() -> str:
    path = os.path.join(os.environ.get("HEXALLM_PLUGIN_DATA", "."), SCRATCH)
    os.makedirs(path, exist_ok=True)
    return path


def _path(name) -> str:
    if not isinstance(name, str) or not _NAME_RE.match(name):
        raise ValueError(
            "note name must be 1-64 chars of letters, digits, '-' and '_'"
        )
    return os.path.join(_dir(), f"{name}.txt")


def run(tool: str, args: dict) -> str:
    args = args or {}

    if tool == "note_write":
        text = args.get("text")
        if not isinstance(text, str):
            raise ValueError("'text' is required and must be a string")
        target = _path(args.get("name"))
        with open(target, "w") as f:
            f.write(text)
        return f"saved {os.path.basename(target)} ({len(text)} chars)"

    if tool == "note_read":
        target = _path(args.get("name"))
        if not os.path.isfile(target):
            return f"no note named {args.get('name')!r}"
        with open(target) as f:
            return f.read()[:8000]

    if tool == "note_list":
        names = sorted(
            os.path.splitext(n)[0]
            for n in os.listdir(_dir())
            if n.endswith(".txt")
        )
        return "\n".join(names) if names else "(no notes)"

    raise ValueError(f"unknown tool: {tool}")
