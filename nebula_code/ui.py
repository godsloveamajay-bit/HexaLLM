from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.rule import Rule
from rich.text import Text

console = Console(highlight=False)

TOOL_STYLE: dict = {
    "read_file":    ("blue",    "📖"),
    "write_file":   ("green",   "✏️ "),
    "patch_file":   ("green",   "🩹"),
    "list_files":   ("cyan",    "📁"),
    "run_command":  ("yellow",  "⚡"),
    "search_files": ("magenta", "🔍"),
    "search_kb":    ("bright_green", "🌐"),
}


def print_welcome(model: str, backend_label: str) -> None:
    is_nebulax = backend_label.startswith("NebulaX")
    backend_style = "green" if is_nebulax else "dim"
    console.print()
    console.print(
        Panel(
            Text.assemble(
                ("Nebula Code", "bold white"),
                ("  v0.1.0\n", "dim"),
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
            border_style="bright_blue" if not is_nebulax else "bright_green",
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


def print_error(text: str) -> None:
    console.print(f"\n[bold red]Error:[/] {text}\n")


def print_info(text: str) -> None:
    console.print(f"[dim]{text}[/]")
