import html as html_module
import json
import re
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
    "web_search":   "Search the web via DuckDuckGo. Input: search query string.",
    "fetch_url":    "Download and read a URL as plain text. Input: URL string.",
    "git_run":      'Run a git command. Input: git subcommand string, e.g. "status" or "log --oneline -5".',
    "ssh_run":      'Run a command on a remote host. Input: JSON {"host": "user@host", "command": "...", "key_file": "~/.ssh/id_rsa" (optional)}',
}


def read_file(path: str) -> str:
    try:
        p = Path(path.strip()).expanduser()
        if not p.exists():
            # Provide helpful suggestions
            if not p.is_absolute():
                return f"File not found: {path} (relative to {Path.cwd()})"
            return f"File not found: {path}"
        if p.is_dir():
            return f"Path is a directory: {path} (use list_files instead)"
        content = p.read_text(errors="replace")
        if len(content) > 8000:
            return content[:8000] + f"\n\n… (truncated at 8,000 chars, total {len(content)})"
        return content
    except PermissionError:
        return f"Permission denied reading {path}"
    except Exception as e:
        return f"Error reading {path}: {e}"


def write_file(input_str: str) -> str:
    try:
        # Try parsing JSON as-is first
        data = json.loads(input_str)
    except json.JSONDecodeError:
        # Try to fix common JSON issues (missing quotes, etc)
        try:
            # Extract path and content more flexibly
            import re
            path_match = re.search(r'"path"\s*:\s*"([^"]+)"', input_str)
            content_match = re.search(r'"content"\s*:\s*"(.*)"\s*\}?\s*$', input_str, re.DOTALL)
            if path_match and content_match:
                data = {"path": path_match.group(1), "content": content_match.group(1)}
            else:
                raise ValueError("Could not parse JSON structure")
        except Exception as parse_e:
            return f"Error parsing input JSON: {parse_e}\nExpected: {{\"path\": \"...\", \"content\": \"...\"}}"
    
    try:
        p = Path(data["path"]).expanduser()
        p.parent.mkdir(parents=True, exist_ok=True)
        content = data.get("content", "")
        p.write_text(content)
        return f"Written {p} ({len(content)} chars)"
    except PermissionError:
        return f"Permission denied writing to {data['path']}"
    except Exception as e:
        return f"Error writing file: {e}"


def patch_file(input_str: str) -> str:
    """Replace the first occurrence of 'old' with 'new' in a file."""
    try:
        data = json.loads(input_str)
        p = Path(data["path"]).expanduser()
        old, new = data["old"], data["new"]
        
        if not p.exists():
            return f"File not found: {p}"
        
        content = p.read_text(errors="replace")
        if old not in content:
            # Provide helpful message showing what's in the file
            preview = content[:200].replace("\n", "\\n")
            return f"String not found in {p}.\nSearched for: {old[:80]!r}\nFile starts with: {preview}…"
        
        patched = content.replace(old, new, 1)
        p.write_text(patched)
        return f"Patched {p} (replaced {len(old)} → {len(new)} chars)"
    except PermissionError:
        return f"Permission denied patching {data.get('path', '?')}"
    except Exception as e:
        return f"Error patching file: {e}"


def list_files(path: str = ".") -> str:
    try:
        p = Path(path.strip() or ".").expanduser()
        if not p.exists():
            return f"Path not found: {path}"
        if not p.is_dir():
            return f"Not a directory: {path} (use read_file to read file contents)"
        
        entries = sorted(p.iterdir(), key=lambda x: (x.is_file(), x.name))
        lines = []
        for entry in entries[:80]:
            try:
                if entry.is_dir():
                    lines.append(f"  📁 {entry.name}/")
                else:
                    size = entry.stat().st_size
                    if size < 1024:
                        size_str = f"{size}B"
                    elif size < 1024*1024:
                        size_str = f"{size/1024:.1f}KB"
                    else:
                        size_str = f"{size/(1024*1024):.1f}MB"
                    lines.append(f"  📄 {entry.name}  ({size_str})")
            except (OSError, PermissionError):
                lines.append(f"  ❌ {entry.name}  (permission denied)")
        
        if len(entries) > 80:
            lines.append(f"  … and {len(entries)-80} more entries")
        
        return "\n".join(lines) or "(empty directory)"
    except PermissionError:
        return f"Permission denied listing {path}"
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


def web_search(query: str) -> str:
    """Search DuckDuckGo HTML endpoint — no API key required."""
    try:
        import httpx
    except ImportError:
        return "httpx not installed. Run: pip install httpx"
    try:
        resp = httpx.post(
            "https://html.duckduckgo.com/html/",
            data={"q": query.strip()},
            headers={"User-Agent": "Mozilla/5.0 (compatible; NebulaCode/0.6)"},
            timeout=15,
            follow_redirects=True,
        )
        body = resp.text
    except Exception as e:
        return f"Search failed: {e}"

    def clean(s: str) -> str:
        return html_module.unescape(re.sub(r"<[^>]+>", "", s)).strip()

    titles   = re.findall(r'class="result__a"[^>]*>(.*?)</a>', body, re.DOTALL)
    snippets = re.findall(r'class="result__snippet"[^>]*>(.*?)</a>', body, re.DOTALL)
    urls     = re.findall(r'class="result__url"[^>]*>\s*(.*?)\s*</span>', body, re.DOTALL)

    if not titles:
        return "No results found (DDG may have changed its HTML — try fetch_url on the search page directly)."

    lines = []
    for i, title in enumerate(titles[:6]):
        t = clean(title)
        u = clean(urls[i]) if i < len(urls) else ""
        s = clean(snippets[i]) if i < len(snippets) else ""
        lines.append(f"{i + 1}. {t}\n   {u}\n   {s}")

    return "\n\n".join(lines)


def fetch_url(url: str) -> str:
    """Download a URL and return its content as plain text."""
    try:
        import httpx
    except ImportError:
        return "httpx not installed. Run: pip install httpx"
    try:
        resp = httpx.get(
            url.strip(),
            headers={"User-Agent": "Mozilla/5.0 (compatible; NebulaCode/0.6)"},
            timeout=20,
            follow_redirects=True,
        )
        ct = resp.headers.get("content-type", "")
        text = resp.text
    except Exception as e:
        return f"Fetch error: {e}"

    if "html" in ct.lower():
        # Remove scripts, styles, then all tags
        text = re.sub(r"(?is)<script[^>]*>.*?</script>", "", text)
        text = re.sub(r"(?is)<style[^>]*>.*?</style>", "", text)
        text = re.sub(r"<[^>]+>", " ", text)
        text = html_module.unescape(text)
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()

    if len(text) > 6000:
        return text[:6000] + "\n\n… (truncated)"
    return text or "(empty response)"


def git_run(cmd: str) -> str:
    """Run a git command in the current working directory."""
    cmd = cmd.strip()
    # Strip leading "git " if user included it
    if cmd.startswith("git "):
        cmd = cmd[4:].strip()
    if not cmd:
        return "No git subcommand provided. Example: status"
    return run_command(f"git {cmd}")


def ssh_run(input_str: str) -> str:
    """Run a command on a remote host via SSH."""
    try:
        data = json.loads(input_str) if input_str.strip().startswith("{") else None
        if not data:
            return 'Input must be JSON: {"host": "user@host", "command": "..."}'
        host    = data.get("host", "").strip()
        command = data.get("command", "").strip()
        key_file = data.get("key_file", "").strip()
        port     = str(data.get("port", "22"))

        if not host or not command:
            return 'host and command are required. Example: {"host": "ubuntu@10.0.0.1", "command": "df -h"}'

        ssh_cmd = [
            "ssh",
            "-o", "StrictHostKeyChecking=accept-new",
            "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=10",
            "-p", port,
        ]
        if key_file:
            ssh_cmd += ["-i", str(Path(key_file).expanduser())]
        ssh_cmd += [host, command]

        result = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=30)
        out = result.stdout or ""
        if result.stderr:
            out += f"\nSTDERR:\n{result.stderr}"
        if result.returncode != 0:
            out += f"\n(exit {result.returncode})"
        return out or "(no output)"
    except subprocess.TimeoutExpired:
        return "SSH command timed out (30 s)"
    except Exception as e:
        return f"SSH error: {e}"


TOOL_FUNCS: Dict[str, Callable[[str], str]] = {
    "read_file":    read_file,
    "write_file":   write_file,
    "patch_file":   patch_file,
    "list_files":   list_files,
    "run_command":  run_command,
    "search_files": search_files,
    "web_search":   web_search,
    "fetch_url":    fetch_url,
    "git_run":      git_run,
    "ssh_run":      ssh_run,
}
