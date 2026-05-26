import json
import subprocess
from pathlib import Path
from typing import Callable, Dict

TOOL_DESCRIPTIONS: Dict[str, str] = {
    "read_file":    "Read a file. Input: file path.",
    "write_file":   'Write/overwrite a file. Input: JSON {"path": "...", "content": "..."}',
    "patch_file":   'Apply a targeted edit. Input: JSON {"path": "...", "old": "...", "new": "..."}',
    "list_files":   'List a directory. Input: path (default ".").',
    "run_command":  "Run a shell command. Input: command string.",
    "search_files": 'Grep for text. Input: JSON {"pattern": "...", "path": ".", "glob": "*.py"}',
}


def read_file(path: str) -> str:
    try:
        p = Path(path.strip())
        if not p.exists():
            return f"File not found: {path}"
        content = p.read_text(errors="replace")
        if len(content) > 8000:
            return content[:8000] + f"\n\n… (truncated at 8 000 chars, total {len(content)})"
        return content
    except Exception as e:
        return f"Error reading {path}: {e}"


def write_file(input_str: str) -> str:
    try:
        data = json.loads(input_str)
        p = Path(data["path"])
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(data["content"])
        return f"Written {p} ({len(data['content'])} chars)"
    except Exception as e:
        return f"Error writing file: {e}"


def patch_file(input_str: str) -> str:
    """Replace the first occurrence of 'old' with 'new' in a file."""
    try:
        data = json.loads(input_str)
        p = Path(data["path"])
        old, new = data["old"], data["new"]
        content = p.read_text(errors="replace")
        if old not in content:
            return f"String not found in {p}: {old[:80]!r}"
        patched = content.replace(old, new, 1)
        p.write_text(patched)
        return f"Patched {p} (replaced {len(old)} chars)"
    except Exception as e:
        return f"Error patching file: {e}"


def list_files(path: str = ".") -> str:
    try:
        p = Path(path.strip() or ".")
        if not p.is_dir():
            return f"Not a directory: {path}"
        entries = sorted(p.iterdir(), key=lambda x: (x.is_file(), x.name))
        lines = []
        for entry in entries[:80]:
            if entry.is_dir():
                lines.append(f"  {entry.name}/")
            else:
                size = entry.stat().st_size
                lines.append(f"  {entry.name}  ({size:,} B)")
        if len(lines) == 80:
            lines.append("  … (truncated)")
        return "\n".join(lines) or "(empty)"
    except Exception as e:
        return f"Error listing {path}: {e}"


def run_command(cmd: str) -> str:
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=60
        )
        out = result.stdout or ""
        if result.stderr:
            out += f"\nSTDERR:\n{result.stderr}"
        if result.returncode != 0:
            out += f"\n(exit {result.returncode})"
        return out or "(no output)"
    except subprocess.TimeoutExpired:
        return "Command timed out (60 s)"
    except Exception as e:
        return f"Error: {e}"


def search_files(input_str: str) -> str:
    try:
        data = json.loads(input_str) if input_str.strip().startswith("{") else {"pattern": input_str}
        pattern = data.get("pattern", "")
        path    = data.get("path", ".")
        glob    = data.get("glob", "*")
        if not pattern:
            return "No pattern provided"
        return run_command(f'grep -rn --include="{glob}" {json.dumps(pattern)} {path} 2>&1 | head -60')
    except Exception as e:
        return f"Search error: {e}"


TOOL_FUNCS: Dict[str, Callable[[str], str]] = {
    "read_file":    read_file,
    "write_file":   write_file,
    "patch_file":   patch_file,
    "list_files":   list_files,
    "run_command":  run_command,
    "search_files": search_files,
}
