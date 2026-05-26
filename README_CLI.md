# Nebula Code

AI coding assistant for the terminal — like Claude Code or Codex, but runs on your own local models via [Ollama](https://ollama.com) or a [NebulaX](https://github.com/godsloveamajay-bit/nebulaxai) instance.

```
nebula › explain the auth flow in this repo
nebula › add input validation to src/api/users.py
nebula › write tests for the payment module and run them
```

## Install

```bash
pip install nebulacode
```

Or from a downloaded wheel:

```bash
pip install nebulacode-0.6.0-py3-none-any.whl
```

## Requirements

- Python 3.10+
- [Ollama](https://ollama.com) running locally (`ollama serve`)
- A model: `ollama pull llama3.2` or `ollama pull codellama`

## Quick start

```bash
nebula                   # start interactive session
nebula -m codellama:7b   # use a specific model
nebula models            # list available models
nebula set model codellama:7b   # save default model
```

## Session commands

| Command | Description |
|---|---|
| `/clear` | Clear conversation and screen |
| `/context` | Show conversation history |
| `/model NAME` | Switch model |
| `/set KEY VALUE` | Change `max_steps` or `temperature` |
| `/tools` | List available tools |
| `/help` | Show help |
| `/exit` | Quit |

## Tools

| Tool | What it does |
|---|---|
| `read_file` | Read any file |
| `write_file` | Create or overwrite a file |
| `patch_file` | Targeted string replacement |
| `list_files` | List a directory |
| `run_command` | Run shell commands (tests, linters, builds) |
| `search_files` | Grep across files |

## Remote daemon mode

Connect to a NebulaX server and let the web UI dispatch tasks to your machine:

```bash
nebula login https://your-nebulax-server   # authenticate
nebula daemon                              # start listening
```

The NebulaX Chat UI will show a "CLI" badge — select your connected machine and the AI will execute tasks locally and stream results back.

## Configuration

Stored at `~/.nebula/config.json`.

```bash
nebula config                            # show config
nebula set model codellama:13b           # default model
nebula set max_steps 30                  # allow longer runs
nebula set ollama_url http://host:11434  # remote Ollama
```
