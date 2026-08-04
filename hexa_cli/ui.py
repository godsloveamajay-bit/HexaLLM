from rich.console import Console
from rich.live import Live
from rich.markdown import Markdown
from rich.panel import Panel
from rich.rule import Rule
from rich.text import Text

console = Console(highlight=False)

TOOL_STYLE: dict = {
    "read_file":    ("blue",         "📖"),
    "write_file":   ("green",        "✏️ "),
    "patch_file":   ("green",        "🩹"),
    "list_files":   ("cyan",         "📁"),
    "run_command":  ("yellow",       "⚡"),
    "search_files": ("magenta",      "🔍"),
    "search_kb":    ("bright_green", "🌐"),
    "web_search":   ("bright_cyan",  "🌍"),
    "fetch_url":    ("cyan",         "🔗"),
    "git_run":      ("yellow",       "🌿"),
    "ssh_run":      ("bright_yellow","🖥️ "),
}


def print_welcome(model: str, backend_label: str) -> None:
    is_hexallm = backend_label.startswith("HexaLLM")
    is_pollinations = backend_label.startswith("Pollinations")
    if is_hexallm:
        backend_style, border = "green", "bright_green"
    elif is_pollinations:
        backend_style, border = "bright_cyan", "bright_cyan"
    else:
        backend_style, border = "yellow", "bright_blue"
    console.print()
    console.print(
        Panel(
            Text.assemble(
                ("HexaLLM", "bold white"),
                ("  v0.8.0\n", "dim"),
                ("model    ", "dim"),
                (model, "cyan"),
                ("\nbackend  ", "dim"),
                (backend_label, backend_style),
                ("\n\nType your coding request. ", "dim"),
                ("/help", "cyan"),
                (" for commands, ", "dim"),
                ("Ctrl-C", "cyan"),
                (" to exit.", "dim"),
            ),
            border_style=border,
            padding=(0, 2),
        )
    )
    console.print()


def print_tool(name: str, thought: str, inp: str, output: str) -> None:
    color, icon = TOOL_STYLE.get(name, ("white", "⚙ "))
    trunc_input  = inp[:160]    + ("…" if len(inp)    > 160 else "")
    trunc_output = output[:600] + ("…" if len(output) > 600 else "")

    body = Text()
    if thought:
        body.append("thought  ", style="dim")
        body.append(thought[:120] + ("…" if len(thought) > 120 else ""), style="italic dim")
        body.append("\n")
    body.append("input    ", style="dim")
    body.append(trunc_input)
    body.append("\n\n")
    body.append("output\n", style="dim")
    body.append(trunc_output, style="dim white")

    console.print(
        Panel(
            body,
            title=f"[{color}]{icon} {name}[/]",
            border_style=f"dim {color}",
            padding=(0, 1),
        )
    )


def print_response(text: str) -> None:
    console.print()
    console.print(Rule(style="dim bright_blue"))
    console.print(Markdown(text))
    console.print(Rule(style="dim bright_blue"))
    console.print()


class StreamingResponse:
    """Live-renders the answer as Markdown while tokens stream in, framed
    identically to print_response. On a CPU box the answer can take minutes;
    streaming turns a frozen prompt into visible, real-time output.

    Usage:
        sr = StreamingResponse(); sr.start()
        sr.update(delta); ...
        sr.stop()   # leaves the finished Markdown in scrollback
    """

    def __init__(self) -> None:
        self.text = ""
        self._live: "Live | None" = None

    def start(self) -> None:
        console.print()
        console.print(Rule(style="dim bright_blue"))
        self._live = Live(
            Markdown(""),
            console=console,
            refresh_per_second=8,
            vertical_overflow="visible",
        )
        self._live.start()

    def update(self, delta: str) -> None:
        self.text += delta
        if self._live is not None:
            self._live.update(Markdown(self.text))

    def stop(self) -> None:
        if self._live is not None:
            self._live.update(Markdown(self.text))
            self._live.stop()
            self._live = None
        console.print(Rule(style="dim bright_blue"))
        console.print()


def print_error(text: str) -> None:
    console.print(f"\n[bold red]Error:[/] {text}\n")


def print_info(text: str) -> None:
    console.print(f"[dim]{text}[/]")
