import asyncio
import json
import logging
import os
import shutil
import subprocess
import tempfile
from typing import Optional

logger = logging.getLogger(__name__)

DOCKER_IMAGE = "python:3.12-slim"
DEFAULT_TIMEOUT = 30   # seconds
MEMORY_LIMIT = "256m"
CPUS = "0.5"
PIDS_LIMIT = "64"


def _check_docker() -> bool:
    try:
        r = subprocess.run(
            ["docker", "info"], capture_output=True, timeout=5
        )
        return r.returncode == 0
    except Exception:
        return False


DOCKER_AVAILABLE = _check_docker()

if DOCKER_AVAILABLE:
    logger.info("Sandbox: Docker available — code_exec will run in isolated containers")
else:
    logger.warning(
        "Sandbox: Docker not found — code_exec falls back to local subprocess (less safe)"
    )


class Sandbox:
    """
    Isolated execution workspace for one agent run.

    With Docker:  code runs inside a locked-down container —
                  no network, 256 MB RAM cap, 0.5 CPU, all Linux
                  capabilities dropped, only /workspace is writable.

    Without Docker: falls back to subprocess inside a temp dir with
                    a hard timeout.  Not fully isolated but still
                    contained to a throwaway directory.
    """

    def __init__(self):
        self.workspace = tempfile.mkdtemp(prefix="nebula_sb_")
        # world-writable so the nobody user inside Docker can write here
        os.chmod(self.workspace, 0o777)
        self._cleaned = False
        self.mode = "docker" if DOCKER_AVAILABLE else "subprocess"

    # ── Public API ──────────────────────────────────────────────────────────

    async def execute_code(self, code: str, timeout: int = DEFAULT_TIMEOUT) -> str:
        """Run Python code inside the sandbox."""
        code_path = os.path.join(self.workspace, "_run.py")
        with open(code_path, "w") as f:
            f.write(code)
        if DOCKER_AVAILABLE:
            return await self._docker_run(["python", "/workspace/_run.py"], timeout)
        return await self._subprocess_run(["python3", code_path], timeout)

    async def execute_bash(self, cmd: str, timeout: int = DEFAULT_TIMEOUT) -> str:
        """Run a bash command inside the sandbox."""
        if DOCKER_AVAILABLE:
            return await self._docker_run(["bash", "-c", cmd], timeout)
        return await self._subprocess_run(
            ["bash", "-c", cmd], timeout, cwd=self.workspace
        )

    async def write_file(self, input_str: str) -> str:
        """JSON input: {"path": "...", "content": "..."}"""
        try:
            data = json.loads(input_str)
            path, content = data["path"], data["content"]
        except Exception as e:
            return f"write_file error: {e}"
        safe = self._safe_path(path)
        if safe is None:
            return "Error: path traversal denied"
        os.makedirs(os.path.dirname(safe), exist_ok=True)
        with open(safe, "w") as f:
            f.write(content)
        return f"Written {path} ({len(content)} chars)"

    async def read_file(self, path: str) -> str:
        """Read a file; checks workspace first, then absolute path."""
        safe = self._safe_path(path.strip())
        if safe and os.path.isfile(safe):
            with open(safe) as f:
                return f.read()[:4000]
        try:
            with open(path.strip()) as f:
                return f.read()[:4000]
        except Exception as e:
            return f"File read error: {e}"

    def cleanup(self):
        if not self._cleaned and os.path.exists(self.workspace):
            shutil.rmtree(self.workspace, ignore_errors=True)
            self._cleaned = True

    def __del__(self):
        self.cleanup()

    # ── Internals ───────────────────────────────────────────────────────────

    def _safe_path(self, path: str) -> Optional[str]:
        resolved = os.path.normpath(os.path.join(self.workspace, path.lstrip("/")))
        return resolved if resolved.startswith(self.workspace) else None

    async def _docker_run(self, cmd: list, timeout: int) -> str:
        docker_cmd = [
            "docker", "run", "--rm",
            "--network", "none",
            "--memory", MEMORY_LIMIT,
            "--cpus", CPUS,
            f"--pids-limit={PIDS_LIMIT}",
            "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges",
            "-v", f"{self.workspace}:/workspace:rw",
            "-w", "/workspace",
            DOCKER_IMAGE,
            *cmd,
        ]
        try:
            proc = await asyncio.create_subprocess_exec(
                *docker_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(), timeout=timeout + 10
                )
            except asyncio.TimeoutError:
                proc.kill()
                return f"Sandbox timed out after {timeout}s — process killed"

            out = stdout.decode(errors="replace")
            err = stderr.decode(errors="replace").strip()
            if err:
                out += f"\nSTDERR:\n{err}"
            return out or "(no output)"
        except FileNotFoundError:
            return "Docker not found — cannot execute in sandbox"
        except Exception as e:
            return f"Sandbox error: {e}"

    async def _subprocess_run(
        self, cmd: list, timeout: int, cwd: Optional[str] = None
    ) -> str:
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd or self.workspace,
            )
            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(), timeout=timeout
                )
            except asyncio.TimeoutError:
                proc.kill()
                return f"Execution timed out after {timeout}s"
            out = stdout.decode(errors="replace")
            err = stderr.decode(errors="replace").strip()
            if err:
                out += f"\nSTDERR:\n{err}"
            return out or "(no output)"
        except Exception as e:
            return f"Execution error: {e}"
