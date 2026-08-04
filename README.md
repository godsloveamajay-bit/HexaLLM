# HexaLLM AI Platform

**HexaLLM AI is a platform where you can interact with AI, share and create your own models, run sandboxed workflows and more.**

🌐 Website: **[ai.hexallm.co.uk](https://ai.hexallm.co.uk)**

## Features

- **Chat** — stream conversations with any local model, plus web search, image & video generation, and voice input
- **Image Gen** — “generate an image of …” renders inline, in any chat
- **Agents** — autonomous agents with web search, code execution, and file I/O
- **AI Tools** — the AI writes its own tools; you approve them; they run sandboxed
- **Personas** — saved assistant configs (prompt + model + personality sliders)
- **Workflows** — chain steps and models into reusable, sandboxed pipelines
- **Memory** — per-user memory and custom instructions carried across chats
- **Knowledge Graph** — a force-directed view of how stored knowledge connects
- **MCP Servers** — connect Model Context Protocol servers for extra tools
- **Remote CLI** — dispatch coding tasks from the web UI to your own machine
- **Model Hub** — discover, create, share, and rate community models
- **Knowledge** — upload documents for retrieval-augmented answers (RAG)
- **Model Training** — fine-tune on your own data with LoRA/QLoRA
- **Expose as API** — OpenAI-compatible endpoint keyed by your own API keys
- And more!

Available on the web, desktop (macOS · Windows · Linux), Android, and as an installable PWA.

## HexaLLM CLI

**HexaLLM** (`hexallm`) is an AI coding assistant for your terminal — like Claude Code or Codex, but running entirely on your own local models via [Ollama](https://ollama.com) or a HexaLLM instance.

```
hexallm › explain the auth flow in this repo
hexallm › add input validation to src/api/users.py
hexallm › write tests for the payment module and run them
```

### Install

```bash
pip install hexallm
```

### Quick start

```bash
hexallm                          # start an interactive session
hexallm -m codellama:7b          # use a specific model
hexallm models                   # list available models
hexallm set model codellama:7b   # save your default model
```

It can read and write files, apply targeted patches, search the codebase, and run shell commands (tests, linters, builds) — all with your approval.

### Remote daemon mode

Connect the CLI to a HexaLLM server and let the web UI dispatch tasks to your machine:

```bash
hexallm login https://your-hexallm-server   # authenticate
hexallm daemon                               # start listening
```

The HexaLLM Chat UI shows a “CLI” badge — pick your connected machine and the AI executes tasks locally, streaming results back to the browser.

See **[README_CLI.md](README_CLI.md)** for the full command and tool reference.

## The Hexa Ecosystem

HexaLLM is part of the **Hexa** product family — integrated AI products built on one shared engine:

- **HexaCore** — the inference and routing engine behind every Hexa product
- **HexaCloud** — managed hosting and scaling for Hexa deployments
- **HexaAPI** — OpenAI-compatible API with per-key access (see *Expose as API*)
- **HexaStudio** — build, evaluate, and ship prompts, agents, and workflows
- **HexaConsole** — monitoring, analytics, and key management
- **HexaFlow** — visual workflow and agent pipelines
- **HexaForge** — fine-tuning and model training

Tools: **HexaCLI** (the `hexallm` terminal assistant in this repo), **HexaSDK**, **HexaStream**, **HexaEmbed**, **HexaGuard**.
Utilities: **HexaTune**, **HexaInspect**, **HexaCache**, **HexaSync**, **HexaSecure**, **HexaDeploy**.
UI: **HexaPanel**, **HexaPrompt**, **HexaCanvas**, **HexaBlocks**, **HexaShell**.

## License

MIT
