import asyncio
import json
import secrets
import socket
import sys
import time
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, urlparse

import click
from prompt_toolkit import PromptSession
from prompt_toolkit.formatted_text import HTML
from prompt_toolkit.history import FileHistory
from prompt_toolkit.styles import Style

from . import __version__
from .agent import Agent, OllamaClient
from .config import CONFIG_DIR, load_config, save_config
from .tools import TOOL_DESCRIPTIONS, TOOL_FUNCS
from .ui import (
    StreamingResponse,
    console,
    print_error,
    print_info,
    print_response,
    print_tool,
    print_welcome,
)

HISTORY_FILE = CONFIG_DIR / "history"
PROMPT_STYLE = Style.from_dict(
    {
        "prompt":         "#7c6aff bold",
        "bottom-toolbar": "bg:#0d0d1a #444466",
    }
)

HELP_TEXT = """
[bold]Commands[/]
  [cyan]/clear[/]           Clear conversation memory and screen
  [cyan]/context[/]         Show conversation history
  [cyan]/history[/]         Show last N turns (e.g. /history 5)
  [cyan]/save[/]            Save session as JSON file
  [cyan]/system[/]          Show backend and model configuration
  [cyan]/model NAME[/]      Switch model for this session
  [cyan]/kb[/]              List HexaLLM knowledge bases (when connected)
  [cyan]/use-kb ID[/]       Attach a KB — adds search_kb tool to this session
  [cyan]/set KEY VALUE[/]   Change max_steps, temperature, or backend
  [cyan]/tools[/]           List active tools
  [cyan]/help[/]            Show this message
  [cyan]/exit[/]            Quit
  [cyan]login URL[/]        Sign in with email + password (inside the REPL)
  [cyan]login URL --google[/]  Sign in with Google — opens/prints a login link

[bold]HexaLLM login[/]
  [cyan]hexallm login URL[/]           Sign in with email + password
  [cyan]hexallm login URL --google[/]  Sign in with Google (opens browser)
  [dim]Typing "login URL --google" at the prompt works too — it opens the link
  instead of sending the text to the model.[/]

[bold]Backends[/]  (priority: HexaLLM › Ollama › Pollinations)
  [dim]auto[/]          HexaLLM if logged in, then Ollama if running, then Pollinations
  [dim]pollinations[/]  Free cloud — works out of the box, no install needed
  [dim]ollama[/]        Local inference — run [cyan]ollama pull llama3[/] first
  Switch with: [cyan]hexallm set backend pollinations[/]  or  [cyan]hexallm set backend ollama[/]

[bold]Built-in tools[/]
  [dim]read_file / write_file / patch_file / list_files[/]   File operations
  [dim]run_command / search_files[/]   Shell and grep
  [dim]web_search[/]     Search the web via DuckDuckGo
  [dim]fetch_url[/]      Download and read any URL as plain text
  [dim]git_run[/]        Run git commands (status, diff, log, commit…)
  [dim]ssh_run[/]        Run a command on a remote host over SSH

[bold]Tips[/]
  • Works out of the box — Pollinations is used automatically if Ollama isn't installed.
  • Ask HexaLLM to [italic]read, edit, create, debug, explain[/] any file.
  • "Search the web for…" or "fetch https://…" triggers web tools.
  • "git diff HEAD" or "commit my changes" uses git_run.
  • [cyan]/clear[/] starts a fresh task with no prior context.
"""


def _make_hexallm_client(cfg):
    """Return a HexaLLMClient if credentials are configured, else None."""
    if cfg.hexallm_url and cfg.hexallm_token:
        from .hexallm import HexaLLMClient
        return HexaLLMClient(cfg.hexallm_url, cfg.hexallm_token)
    return None


def _build_kb_tool(nx_client, kb_id: int):
    """Return a sync search_kb tool function closed over the client and kb_id."""
    def search_kb(query: str) -> str:
        try:
            return nx_client.search_kb_sync(kb_id, query)
        except Exception as e:
            return f"KB search error: {e}"
    return search_kb


async def _pick_backend(cfg):
    """
    Return (backend, backend_label, nx_client_or_None) using priority:
      1. HexaLLM  — if backend is explicitly set to "hexallm" OR (auto AND token is valid)
      2. Ollama   — if cfg.backend == "ollama" OR (auto AND Ollama is reachable)
      3. Pollinations — free cloud fallback, no setup needed
    """
    from .hexallm import HexaLLMClient, PollinationsClient

    # 1. HexaLLM
    want_hexallm = cfg.backend == "hexallm"
    hexa = _make_hexallm_client(cfg)
    if hexa:
        hexa_user = await HexaLLMClient.verify(cfg.hexallm_url, cfg.hexallm_token)
        if hexa_user:
            # Try to get or create an API key for LLM calls
            await hexa.get_or_create_api_key()
            return hexa, f"HexaLLM  {cfg.hexallm_url}", hexa, hexa_user
        # If explicitly requested but token invalid, fail fast
        if want_hexallm:
            console.print("[red]HexaLLM backend requested but token is expired or invalid.[/]")
            console.print("[yellow]Run[/] [cyan]hexallm login <URL>[/] [yellow]to reconnect.[/]")
            sys.exit(1)
        # Otherwise, if auto, continue to fallback backends
        console.print("[yellow]HexaLLM token expired — run[/] [cyan]hexallm login URL[/] [yellow]to reconnect.[/]")

    # 2. Ollama
    want_ollama = cfg.backend == "ollama"
    if want_ollama or cfg.backend == "auto":
        try:
            ollama = OllamaClient(cfg.ollama_url)
            models = await ollama.list_models()
            if models:
                return ollama, f"Ollama  {cfg.ollama_url}", None, None
        except Exception:
            if want_ollama:
                console.print(f"[red]Ollama not reachable at {cfg.ollama_url}[/]")
                sys.exit(1)

    # 3. Pollinations (free cloud, no key)
    cloud = PollinationsClient()
    return cloud, "Pollinations  [dim](free cloud · no setup)[/]", None, None


# Fast-loading models (within Cloudflare's ~100s 524 window on this CPU-only box).
# Prefer these over models[0] for auto-selection, since the server lists the
# largest model (qwen3:14B, ~290s cold-load) first — picking it blindly causes a
# Cloudflare 524 on first token. Matched case-insensitively against installed names.
_FAST_MODEL_PREFS = ("llama3:8B", "openchat:7B", "Qwen2.5-Coder:7B")


def _pick_default_model(models: list) -> str:
    """Pick a sensible default from the available models.

    Prefers a known fast model (cold-loads inside Cloudflare's 524 window) over
    the server's models[0], which is typically the slowest/largest model.
    """
    lower = {m.lower(): m for m in models}
    for pref in _FAST_MODEL_PREFS:
        if pref.lower() in lower:
            return lower[pref.lower()]
    return models[0]


async def _interactive(cfg) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)

    backend, backend_label, hexa, hexa_user = await _pick_backend(cfg)

    # Auto-select a sensible default model for the chosen backend
    from .hexallm import PollinationsClient
    if isinstance(backend, PollinationsClient):
        if cfg.model not in PollinationsClient.MODELS:
            cfg.model = PollinationsClient.DEFAULT_MODEL
    elif hexa is None:  # Ollama
        if ":" not in cfg.model:
            # Bare/invalid model name — fall back to a default that exists;
            # the live-list validation just below corrects it if needed.
            cfg.model = "llama3:8B"

    agent = Agent(
        model=cfg.model,
        max_steps=cfg.max_steps,
        temperature=cfg.temperature,
        backend=backend,
    )

    # connectivity / model check (skip for Pollinations — no model list endpoint needed)
    # Also skip for HexaLLM since it uses cloud models, not local Ollama
    if not isinstance(backend, PollinationsClient):
        try:
            models = await backend.list_models()
            if not models:
                # HexaLLM doesn't require local models
                if hexa:
                    pass  # This is expected for HexaLLM cloud backend
                else:
                    console.print("[yellow]Warning:[/] No models found.")
            elif cfg.model not in models:
                console.print(
                    f"[yellow]Note:[/] '{cfg.model}' not found. "
                    f"Available: {', '.join(models[:5])}. "
                    f"Switching to [cyan]{_pick_default_model(models)}[/]."
                )
                cfg.model = _pick_default_model(models)
                agent.model = cfg.model
        except Exception as e:
            src = "HexaLLM" if hexa else "Ollama"
            console.print(f"[red]Cannot reach {src}:[/] {e}")
            sys.exit(1)

    print_welcome(cfg.model, backend_label)
    if hexa and hexa_user:
        console.print(
            f"  [dim]Connected as[/] [cyan]{hexa_user.get('email', '?')}[/] "
            f"[dim]on[/] [cyan]{cfg.hexallm_url}[/]\n"
        )
    else:
        console.print(
            "  [dim]Not connected to HexaLLM — log in with[/] [cyan]hexallm login URL[/]"
            " [dim]or[/] [cyan]hexallm login URL --google[/] [dim](or type[/] [cyan]login URL --google[/] [dim]here).[/]\n"
        )

    # active tools (may grow if user attaches a KB)
    active_tool_funcs = dict(TOOL_FUNCS)
    active_tool_descs = dict(TOOL_DESCRIPTIONS)
    active_kb_id: Optional[int] = None

    session: PromptSession = PromptSession(
        history=FileHistory(str(HISTORY_FILE)),
        style=PROMPT_STYLE,
        multiline=False,
    )

    while True:
        kb_hint = f"  kb:{active_kb_id}" if active_kb_id else ""
        toolbar = HTML(
            f"<b>model:</b> {agent.model}  "
            f"<b>turns:</b> {len(agent.history) // 2}  "
            f"<b>cwd:</b> {Path.cwd()}"
            f"{kb_hint}"
        )
        try:
            raw = await session.prompt_async(
                HTML("<prompt>hexallm</prompt> <ansi_bright_black>›</ansi_bright_black> "),
                bottom_toolbar=toolbar,
            )
        except (KeyboardInterrupt, EOFError):
            console.print("\n[dim]Goodbye.[/]")
            break

        user_input = raw.strip()
        if not user_input:
            continue

        low = user_input.lower()

        # ── built-in commands ──────────────────────────────────────────────
        if low in ("/exit", "/quit", "exit", "quit"):
            console.print("[dim]Goodbye.[/]")
            break

        if low == "login" or low.startswith("login "):
            # In-REPL login: "login URL [--google]" — opens/prints the login
            # link instead of sending the text to the model, then hot-swaps
            # the session onto the HexaLLM backend.
            parts = user_input.split()
            login_url = cfg.hexallm_url or "https://ai.hexallm.co.uk"
            use_google = any(p == "--google" for p in parts)
            for p in parts[1:]:
                if p.startswith("http"):
                    login_url = p
            if use_google:
                await _google_login(login_url)
            else:
                email = click.prompt("Email")
                password = click.prompt("Password", hide_input=True)
                from .hexallm import HexaLLMClient
                try:
                    token = await HexaLLMClient.login(login_url, email, password)
                except Exception as e:
                    console.print(f"[red]Login failed:[/] {e}")
                    continue
                cfg.hexallm_url = login_url
                cfg.hexallm_token = token
                save_config(cfg)
                console.print(f"[green]Logged in as[/] [cyan]{email}[/] [dim]on {login_url}[/]")
            # Hot-swap this session onto the HexaLLM backend
            from .hexallm import HexaLLMClient
            cfg = load_config()
            hexa = _make_hexallm_client(cfg)
            if hexa:
                hexa_user = await HexaLLMClient.verify(cfg.hexallm_url, cfg.hexallm_token)
                if hexa_user:
                    agent.backend = hexa
                    try:
                        models = await hexa.list_models()
                        if cfg.model not in models and models:
                            cfg.model = _pick_default_model(models)
                            agent.model = cfg.model
                    except Exception:
                        pass
                    console.print(f"[green]Connected as[/] [cyan]{hexa_user.get('email', '?')}[/] [dim]on {cfg.hexallm_url}[/]")
                else:
                    console.print("[red]Login failed: token invalid.[/]")
            else:
                console.print("[yellow]Login link:[/] run [cyan]hexallm login <URL>[/] from the shell (or [cyan]<URL> --google[/]) and restart.")
            continue

        if low == "/help":
            console.print(HELP_TEXT)
            continue

        if low == "/clear":
            agent.history.clear()
            console.clear()
            print_welcome(cfg.model, backend_label)
            if hexa and hexa_user:
                console.print(f"  [dim]Connected as[/] [cyan]{hexa_user.get('email', '?')}[/]\n")
            continue

        if low == "/context":
            if not agent.history:
                print_info("No conversation history yet.")
            for msg in agent.history:
                color = "cyan" if msg["role"] == "user" else "green"
                preview = msg["content"][:200].replace("\n", " ")
                console.print(f"[{color}]{msg['role']}:[/] {preview}")
            continue

        if low.startswith("/history"):
            # /history or /history 5 (show last N turns)
            parts = user_input.split()
            n = int(parts[1]) if len(parts) > 1 else 10
            if not agent.history:
                print_info("No conversation history yet.")
            else:
                turns = agent.history[-n*2:] if len(agent.history) > n*2 else agent.history
                for msg in turns:
                    color = "cyan" if msg["role"] == "user" else "green"
                    preview = msg["content"][:150].replace("\n", " ")
                    console.print(f"[{color}]{msg['role']}:[/] {preview}")
                console.print(f"\n[dim]Showing last {len(turns)//2} turns[/]")
            continue

        if low == "/save":
            # Save session as JSON
            try:
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                filename = f"session_{timestamp}.json"
                session_data = {
                    "timestamp": datetime.now().isoformat(),
                    "model": agent.model,
                    "backend": backend_label,
                    "turns": len(agent.history) // 2,
                    "history": agent.history,
                    "cwd": str(Path.cwd()),
                }
                Path(filename).write_text(json.dumps(session_data, indent=2))
                console.print(f"[green]✓[/] Session saved to [cyan]{filename}[/]")
            except Exception as e:
                print_error(f"Failed to save session: {e}")
            continue

        if low == "/tools":
            for name, desc in active_tool_descs.items():
                console.print(f"  [cyan]{name}[/]  [dim]{desc}[/]")
            continue

        if low == "/system":
            console.print(
                f"[cyan]HexaLLM System[/]\n"
                f"  Model     [bold]{agent.model}[/]\n"
                f"  Backend   {backend_label}\n"
                f"  Max steps {agent.max_steps}\n"
                f"  Temp      {agent.temperature}\n"
                f"  Turns     {len(agent.history) // 2}\n"
                f"  CWD       {Path.cwd()}\n"
            )
            if active_kb_id:
                console.print(f"  KB        KB#{active_kb_id} (search_kb enabled)")
            continue

        if low == "/kb":
            if not hexa:
                print_info("Connect to HexaLLM first with [cyan]hexallm login URL[/]")
                continue
            try:
                kbs = hexa.list_kbs_sync()
                if not kbs:
                    print_info("No knowledge bases found.")
                else:
                    for kb in kbs:
                        console.print(
                            f"  [cyan]{kb['id']}[/]  {kb['name']}  "
                            f"[dim]{kb.get('document_count', 0)} docs · "
                            f"{kb.get('chunk_count', 0)} chunks[/]"
                        )
                    console.print("\n[dim]Use /use-kb ID to attach one.[/]")
            except Exception as e:
                print_error(str(e))
            continue

        if low.startswith("/use-kb "):
            if not hexa:
                print_info("Connect to HexaLLM first with [cyan]hexallm login URL[/]")
                continue
            try:
                kb_id = int(user_input.split()[1])
                active_kb_id = kb_id
                active_tool_funcs["search_kb"] = _build_kb_tool(hexa, kb_id)
                active_tool_descs["search_kb"] = f"Search HexaLLM knowledge base {kb_id}. Input: query string."
                console.print(f"[green]KB {kb_id} attached.[/] [dim]search_kb tool is now active.[/]")
            except (ValueError, IndexError):
                print_error("Usage: /use-kb <numeric-id>")
            continue

        if low.startswith("/model "):
            new_model = user_input[7:].strip()
            agent.model = new_model
            cfg.model = new_model
            save_config(cfg)
            console.print(f"[green]Model →[/] [cyan]{new_model}[/]")
            continue

        if low.startswith("/set "):
            parts = user_input.split(maxsplit=2)
            if len(parts) == 3:
                key, val = parts[1], parts[2]
                try:
                    if key == "max_steps":
                        cfg.max_steps = agent.max_steps = int(val)
                    elif key == "temperature":
                        cfg.temperature = agent.temperature = float(val)
                    save_config(cfg)
                    console.print(f"[green]{key} = {val}[/]")
                except ValueError:
                    print_error(f"Invalid value for {key}: {val}")
            else:
                print_error("Usage: /set KEY VALUE")
            continue

        # ── agent run ─────────────────────────────────────────────────────
        done_event: Optional[dict] = None
        stream: Optional[StreamingResponse] = None

        with console.status("[dim]Thinking…[/]", spinner="dots") as status:
            async for event in agent.run(user_input, active_tool_funcs, active_tool_descs):
                if event["type"] == "tool":
                    status.stop()
                    print_tool(
                        event["name"],
                        event.get("thought", ""),
                        event["input"],
                        event["output"],
                    )
                    status.start()
                elif event["type"] == "answer_chunk":
                    # First token of the final answer — swap the spinner for a
                    # live Markdown render so output appears as it generates.
                    if stream is None:
                        status.stop()
                        stream = StreamingResponse()
                        stream.start()
                    stream.update(event["text"])
                elif event["type"] == "done":
                    done_event = event
                elif event["type"] == "error":
                    status.stop()
                    print_error(event["text"])
                    status.start()

        if stream is not None:
            stream.stop()

        if done_event:
            # If the answer already streamed live, it's on screen — don't repaint.
            if not done_event.get("streamed"):
                print_response(done_event["text"])
            # sync run to HexaLLM in the background
            if hexa and done_event.get("steps"):
                try:
                    run_id = hexa.sync_run(
                        task=user_input,
                        model=agent.model,
                        tools=done_event.get("tools_used", []),
                        steps=done_event["steps"],
                        result=done_event["text"],
                    )
                    if run_id:
                        console.print(
                            f"[dim]↑ synced to HexaLLM run #{run_id}[/]"
                        )
                except Exception:
                    pass


# ── OAuth helpers ─────────────────────────────────────────────────────────────

def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


async def _google_login(url: str) -> None:
    port = _free_port()
    nonce = secrets.token_hex(8)
    state = f"cli_{port}_{nonce}"
    auth_url = f"{url.rstrip('/')}/api/v1/auth/oauth/google?state={state}"

    result: dict = {}

    class _Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            params = parse_qs(urlparse(self.path).query)
            if "token" in params:
                result["token"] = params["token"][0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(
                b"<html><body style='font-family:sans-serif;text-align:center;padding:60px'>"
                b"<h2>Authentication successful!</h2>"
                b"<p>You can close this tab and return to the terminal.</p>"
                b"</body></html>"
            )

        def log_message(self, *_):
            pass

    server = HTTPServer(("localhost", port), _Handler)
    server.timeout = 1

    console.print("\n[dim]Opening browser for Google sign-in…[/]")
    console.print(f"[dim]If the browser doesn't open, paste this link into any browser:[/]\n[cyan]{auth_url}[/]\n")
    webbrowser.open(auth_url)
    console.print("[dim]Waiting for authentication (120 s timeout)…  Ctrl-C to cancel.[/]\n")

    deadline = time.time() + 120
    while "token" not in result and time.time() < deadline:
        server.handle_request()
    server.server_close()

    if "token" not in result:
        console.print("[red]Authentication timed out or was cancelled.[/]")
        raise SystemExit(1)

    from .hexallm import HexaLLMClient
    user = await HexaLLMClient.verify(url, result["token"])
    if not user:
        console.print("[red]Login failed: token invalid.[/]")
        raise SystemExit(1)

    cfg = load_config()
    cfg.hexallm_url = url
    cfg.hexallm_token = result["token"]
    save_config(cfg)
    console.print(f"[green]Logged in as[/] [cyan]{user.get('email', '?')}[/] [dim]on {url}[/]")
    console.print("[dim]Token saved to ~/.hexallm/config.json[/]\n")


# ── Click entry points ─────────────────────────────────────────────────────

@click.group(invoke_without_command=True, context_settings={"help_option_names": ["-h", "--help"]})
@click.version_option(__version__, "-V", "--version")
@click.option("--model", "-m", default=None, help="Model to use (overrides config).")
@click.option("--ollama-url", default=None, help="Ollama base URL (overrides config).")
@click.pass_context
def main(ctx, model, ollama_url):
    """HexaLLM — AI coding assistant for the terminal."""
    if ctx.invoked_subcommand is not None:
        return
    cfg = load_config()
    if model:
        cfg.model = model
    if ollama_url:
        cfg.ollama_url = ollama_url
    asyncio.run(_interactive(cfg))


@main.command("login")
@click.argument("url")
@click.option("--email", default=None, help="Email address (omit to use --google).")
@click.option("--password", default=None, hide_input=True, help="Password (omit to use --google).")
@click.option("--google", is_flag=True, default=False, help="Sign in with Google via browser.")
def cmd_login(url: str, email: Optional[str], password: Optional[str], google: bool):
    """Authenticate with a HexaLLM instance and save credentials.

    \b
    Email / password:
      hexallm login https://ai.hexallm.co.uk

    Google (opens browser):
      hexallm login https://ai.hexallm.co.uk --google
    """
    if google:
        asyncio.run(_google_login(url))
        return

    # Fall back to email / password, prompting if not supplied
    if not email:
        email = click.prompt("Email")
    if not password:
        password = click.prompt("Password", hide_input=True)

    async def _do():
        from .hexallm import HexaLLMClient
        try:
            token = await HexaLLMClient.login(url, email, password)
            cfg = load_config()
            cfg.hexallm_url = url
            cfg.hexallm_token = token
            save_config(cfg)

            user = await HexaLLMClient.verify(url, token)
            name = user.get("email", "?") if user else email
            console.print(f"\n[green]Logged in as[/] [cyan]{name}[/] [dim]on {url}[/]")
            console.print("[dim]Token saved to ~/.hexallm/config.json[/]\n")
        except Exception as e:
            import httpx as _httpx
            if isinstance(e, _httpx.HTTPStatusError):
                status = e.response.status_code
                if status == 401:
                    console.print("[red]Login failed:[/] Invalid email or password.")
                elif status == 422:
                    console.print("[red]Login failed:[/] Invalid email format.")
                elif status == 429:
                    console.print("[red]Login failed:[/] Too many attempts — wait a minute and try again.")
                else:
                    console.print(f"[red]Login failed:[/] Server returned {status}.")
            elif isinstance(e, _httpx.ConnectError):
                console.print(f"[red]Login failed:[/] Cannot connect to {url} — check the URL.")
            else:
                console.print(f"[red]Login failed:[/] {e}")
            raise SystemExit(1)

    asyncio.run(_do())


@main.command("logout")
def cmd_logout():
    """Remove stored HexaLLM credentials."""
    cfg = load_config()
    cfg.hexallm_url = None
    cfg.hexallm_token = None
    save_config(cfg)
    console.print("[green]Logged out.[/] Credentials removed from config.")


@main.command("kbs")
def cmd_kbs():
    """List knowledge bases on the connected HexaLLM instance."""
    cfg = load_config()
    hexa = _make_hexallm_client(cfg)
    if not hexa:
        console.print("[yellow]Not connected.[/] Run [cyan]hexallm login URL[/] first.")
        return
    try:
        kbs = hexa.list_kbs_sync()
        if not kbs:
            console.print("[dim]No knowledge bases found.[/]")
            return
        console.print()
        for kb in kbs:
            console.print(
                f"  [cyan]{kb['id']:>3}[/]  {kb['name']:<30} "
                f"[dim]{kb.get('document_count', 0)} docs  "
                f"{kb.get('chunk_count', 0)} chunks[/]"
            )
        console.print()
    except Exception as e:
        console.print(f"[red]Error:[/] {e}")


@main.command("config")
def cmd_config():
    """Show current configuration."""
    cfg = load_config()
    console.print(f"\n[dim]Config:[/] {CONFIG_DIR / 'config.json'}\n")
    for k, v in vars(cfg).items():
        if k == "hexallm_token" and v:
            v = v[:12] + "…"
        console.print(f"  [cyan]{k}[/]  {v}")
    console.print()


@main.command("set")
@click.argument("key")
@click.argument("value")
def cmd_set(key: str, value: str):
    """Persist a config value."""
    cfg = load_config()
    if not hasattr(cfg, key):
        console.print(f"[red]Unknown key:[/] {key}")
        sys.exit(1)
    try:
        current = getattr(cfg, key)
        if isinstance(current, int):
            value = int(value)  # type: ignore[assignment]
        elif isinstance(current, float):
            value = float(value)  # type: ignore[assignment]
        setattr(cfg, key, value)
        save_config(cfg)
        console.print(f"[green]{key} = {value}[/]")
    except ValueError as e:
        console.print(f"[red]Error:[/] {e}")
        sys.exit(1)


@main.command("daemon")
@click.option("--no-reconnect", is_flag=True, default=False, help="Exit on disconnect instead of reconnecting.")
def cmd_daemon(no_reconnect: bool):
    """
    Connect to HexaLLM and accept tasks dispatched from the web UI.

    The CLI keeps a persistent WebSocket open. Any task you send from
    the HexaLLM Agents → Remote CLI page executes locally here, with
    full access to your filesystem and shell, and streams results back
    to the browser in real time.
    """
    cfg = load_config()
    hexa = _make_hexallm_client(cfg)
    if not hexa:
        console.print("[red]Not connected to HexaLLM.[/] Run [cyan]hexallm login URL[/] first.")
        sys.exit(1)

    async def _run():
        from .tunnel import CliTunnel
        from .hexallm import HexaLLMClient

        # verify token first
        user = await HexaLLMClient.verify(cfg.hexallm_url, cfg.hexallm_token)
        if not user:
            console.print("[red]Token expired.[/] Run [cyan]hexallm login URL[/] again.")
            sys.exit(1)

        backend = hexa

        # Validate / auto-select model — same logic as interactive mode.
        try:
            models = await backend.list_models()
            if models and cfg.model not in models:
                picked = _pick_default_model(models)
                console.print(
                    f"[yellow]Note:[/] Model [cyan]{cfg.model!r}[/] not available on this server. "
                    f"Switching to [cyan]{picked}[/]."
                )
                cfg.model = picked
                save_config(cfg)
        except Exception:
            pass

        agent = Agent(
            model=cfg.model,
            max_steps=cfg.max_steps,
            temperature=cfg.temperature,
            backend=backend,
        )

        tunnel = CliTunnel(cfg.hexallm_url, cfg.hexallm_token)

        console.print()
        console.print(
            f"[bold white]HexaLLM Daemon[/]  [dim]connected to[/] [cyan]{cfg.hexallm_url}[/]\n"
            f"[dim]user:[/] [cyan]{user.get('email', '?')}[/]   "
            f"[dim]model:[/] [cyan]{cfg.model}[/]\n\n"
            "[dim]Waiting for tasks from the HexaLLM web UI…  Ctrl-C to stop.[/]\n"
        )

        def on_event(evt: dict) -> None:
            etype = evt.get("type", "")
            if etype == "ready":
                console.print(f"[green]✓ Session[/] [cyan]{evt['session_id']}[/] [dim]registered[/]")
            elif etype == "task_start":
                console.print(f"\n[bold cyan]▶ Task:[/] {evt['task']}")
            elif etype == "step":
                color = {"read_file": "blue", "write_file": "green", "run_command": "yellow",
                         "bash_exec": "yellow", "search_files": "magenta"}.get(evt.get("name", ""), "white")
                console.print(f"  [{color}]⚙ {evt.get('name')}[/]  [dim]{str(evt.get('input',''))[:80]}[/]")
            elif etype == "done":
                console.print(f"[green]✓ Done[/]  [dim]{str(evt.get('result',''))[:120]}[/]")
            elif etype == "error":
                console.print(f"[red]✗ Error[/]  {evt.get('error', '')}")
            elif etype == "disconnected":
                console.print(f"[yellow]⚡ Disconnected:[/] {evt.get('error', '')}")
            elif etype == "reconnecting":
                console.print(f"[dim]Reconnecting in {evt.get('delay')}s…[/]")

        try:
            await tunnel.run_forever(
                agent=agent,
                tool_funcs=TOOL_FUNCS,
                tool_descriptions=TOOL_DESCRIPTIONS,
                on_event=on_event,
                reconnect=not no_reconnect,
            )
        except KeyboardInterrupt:
            console.print("\n[dim]Daemon stopped.[/]")

    asyncio.run(_run())


@main.command("models")
def cmd_models():
    """List models available in Ollama (or HexaLLM)."""
    async def _list():
        cfg = load_config()
        hexa = _make_hexallm_client(cfg)
        backend = hexa if hexa else OllamaClient(cfg.ollama_url)
        src = "HexaLLM" if hexa else "Ollama"
        try:
            models = await backend.list_models()
            console.print(f"\n[dim]{src} models:[/]")
            for m in models:
                marker = "  [cyan]← active[/]" if m == cfg.model else ""
                console.print(f"  {m}{marker}")
            console.print()
        except Exception as e:
            console.print(f"[red]Error:[/] {e}")

    asyncio.run(_list())
