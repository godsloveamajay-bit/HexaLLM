import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import uuid
from typing import Optional, List

logger = logging.getLogger(__name__)

DOCKER_IMAGE = "python:3.12-slim"
DEFAULT_TIMEOUT = 30
MEMORY_LIMIT = "256m"
CPUS = "0.5"
PIDS_LIMIT = "64"

# Host-side: docker run -v resolves paths from the HOST filesystem, not the
# container's. When this backend runs inside a container with
#   -v /opt/hexallm/data:/app/data
# then /app/data/.sandbox on the inside is /opt/hexallm/data/.sandbox outside.
# We detect whether we are inside a container and derive the host-side base.
_CONTAINER_DATA_DIR = "/app/data"
_HOST_DATA_DIR = os.environ.get(
    "HEXA_HOST_DATA_DIR",
    _CONTAINER_DATA_DIR if os.path.exists(_CONTAINER_DATA_DIR) else _CONTAINER_DATA_DIR,
)
SANDBOX_BASE_CONTAINER = os.environ.get(
    "HEXA_SANDBOX_DIR",
    os.path.join(_CONTAINER_DATA_DIR, ".sandbox"),
)
if os.environ.get("HEXA_HOST_DATA_DIR"):
    SANDBOX_BASE_HOST = SANDBOX_BASE_CONTAINER.replace(_CONTAINER_DATA_DIR, _HOST_DATA_DIR, 1)
else:
    SANDBOX_BASE_HOST = SANDBOX_BASE_CONTAINER


def _check_docker() -> bool:
    try:
        r = subprocess.run(["docker", "info"], capture_output=True, timeout=5)
        return r.returncode == 0
    except Exception:
        return False


DOCKER_AVAILABLE = _check_docker()

if DOCKER_AVAILABLE:
    logger.info("Sandbox: Docker available — spawning persistent containers per agent run")
else:
    logger.warning("Sandbox: Docker not found — falling back to local subprocess (less safe)")


_ANSI_STRIP = re.compile(r'\x1B\[[0-?]*[ -/]*[@-~]')


def _strip_ansi(text: str) -> str:
    return _ANSI_STRIP.sub('', text)


class Sandbox:
    """Per-agent-run execution sandbox.

    With Docker:
      A long-lived container (tail -f /dev/null as init) is created at __init__
      and destroyed at cleanup(). Each execute_code / execute_bash call uses
      `docker exec` to run inside the same container, preserving filesystem state
      and installed packages across steps.

    Without Docker:
      Falls back to subprocess inside a throwaway temp directory with hard timeout.
    """

    def __init__(self):
        os.makedirs(SANDBOX_BASE_CONTAINER, exist_ok=True)
        self.workspace = tempfile.mkdtemp(prefix="hexallm_sb_", dir=SANDBOX_BASE_CONTAINER)
        # Host-side path for docker -v bind mounts
        if self.workspace.startswith(SANDBOX_BASE_CONTAINER):
            self._host_workspace = self.workspace.replace(
                SANDBOX_BASE_CONTAINER, SANDBOX_BASE_HOST, 1
            )
        else:
            self._host_workspace = self.workspace
        os.chmod(self.workspace, 0o777)
        self._cleaned = False
        self._container_id: Optional[str] = None
        self.mode = "docker" if DOCKER_AVAILABLE else "subprocess"

        if DOCKER_AVAILABLE:
            self._container_id = self._start_container()
            if self._container_id:
                logger.info(f"Sandbox container started: {self._container_id[:12]}")
            else:
                logger.warning("Failed to start sandbox container — falling back to subprocess")
                self.mode = "subprocess"

    # ── Public API ──────────────────────────────────────────────────────────

    async def execute_code(self, code: str, timeout: int = DEFAULT_TIMEOUT) -> str:
        code_path = os.path.join(self.workspace, "_run.py")
        with open(code_path, "w") as f:
            f.write(code)
        if self._container_id:
            return await self._docker_exec(["python", "/workspace/_run.py"], timeout)
        return await self._subprocess_run(["python3", code_path], timeout)

    async def list_files(self, pattern: str) -> str:
        """List files matching glob pattern (inside container or on host workspace)."""
        pattern = pattern.strip() or "."
        if self._container_id:
            return await self._docker_exec(["bash", "-c",
                f"find {pattern} -maxdepth 2 -not -path '*/.*' 2>/dev/null | head -50 || true"], timeout=10)
        import glob as _glob
        try:
            p = pattern if os.path.isabs(pattern) else os.path.join(self.workspace, pattern)
            matches = sorted(_glob.glob(p, recursive=True))[:50]
            if not matches:
                return f"No files matching: {pattern}"
            lines = []
            for m in matches:
                if os.path.isdir(m):
                    lines.append(f"📁 {m}/")
                else:
                    lines.append(f"📄 {m}  ({os.path.getsize(m)} bytes)")
            return "\n".join(lines)
        except Exception as e:
            return f"List files error: {e}"

    async def execute_bash(self, cmd: str, timeout: int = DEFAULT_TIMEOUT) -> str:
        if self._container_id:
            return await self._docker_exec(["bash", "-c", cmd], timeout)
        return await self._subprocess_run(["bash", "-c", cmd], timeout, cwd=self.workspace)

    async def write_file(self, input_str: str) -> str:
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
        safe = self._safe_path(path.strip())
        if safe and os.path.isfile(safe):
            with open(safe) as f:
                return f.read()[:4000]
        # Also try stripping /workspace/ prefix for paths from inside the container
        if path.startswith("/workspace/"):
            local = path[len("/workspace/"):]
            safe = self._safe_path(local)
            if safe and os.path.isfile(safe):
                with open(safe) as f:
                    return f.read()[:4000]
        try:
            with open(path.strip()) as f:
                return f.read()[:4000]
        except Exception as e:
            return f"File read error: {e}"

    def cleanup(self):
        if self._cleaned:
            return
        self._cleaned = True
        if self._container_id:
            self._kill_container(self._container_id)
        if os.path.exists(self.workspace):
            shutil.rmtree(self.workspace, ignore_errors=True)

    def __del__(self):
        self.cleanup()

    # ── Container lifecycle ─────────────────────────────────────────────────

    def _start_container(self) -> Optional[str]:
        container_name = f"hexallm-sb-{uuid.uuid4().hex[:8]}"
        try:
            result = subprocess.run(
                [
                    "docker", "run", "-d", "--init",
                    "--name", container_name,
                    "--network", "none",
                    "--memory", MEMORY_LIMIT,
                    "--cpus", CPUS,
                    f"--pids-limit={PIDS_LIMIT}",
                    "--cap-drop", "ALL",
                    "--security-opt", "no-new-privileges",
                    "--read-only",
                    "-v", f"{self._host_workspace}:/workspace:rw",
                    "-w", "/workspace",
                    DOCKER_IMAGE,
                    "tail", "-f", "/dev/null",
                ],
                capture_output=True, text=True, timeout=15, check=True,
            )
            cid = result.stdout.strip()
            logger.info(f"Started sandbox container {container_name} ({cid[:12]})")
            return cid
        except subprocess.CalledProcessError as e:
            logger.error(f"Container start failed: {e.stderr}")
            return None
        except Exception as e:
            logger.error(f"Container start error: {e}")
            return None

    def _kill_container(self, cid: str):
        try:
            subprocess.run(
                ["docker", "rm", "-f", cid],
                capture_output=True, timeout=10,
            )
        except Exception:
            pass

    # ── Command execution ───────────────────────────────────────────────────

    async def _docker_exec(self, cmd: List[str], timeout: int) -> str:
        docker_cmd = [
            "docker", "exec", "-i",
            self._container_id,
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
                return f"Sandbox timed out after {timeout}s"
            out = stdout.decode(errors="replace")
            err = _strip_ansi(stderr.decode(errors="replace").strip())
            if err:
                out += f"\nSTDERR:\n{err}"
            return out or "(no output)"
        except FileNotFoundError:
            return "Docker not found"
        except Exception as e:
            return f"Sandbox exec error: {e}"

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

    # ── Helpers ─────────────────────────────────────────────────────────────

    def _safe_path(self, path: str) -> Optional[str]:
        ws = os.path.realpath(self.workspace)
        resolved = os.path.realpath(os.path.join(ws, path.lstrip("/")))
        return resolved if resolved == ws or resolved.startswith(ws + os.sep) else None
