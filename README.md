# NebulaX AI Platform

An open-source AI platform for creating, fine-tuning, sharing, and running large language models — with a full-featured dashboard.

## Features

| Feature | Description |
|---|---|
| **Chat Playground** | Stream conversations with any Ollama model, with session history |
| **AI Agents** | Autonomous agents with web search, code execution, file I/O |
| **Model Hub** | Discover, create, share and rate community models |
| **Fine-tuning** | Train models on your own data using LoRA/QLoRA (via HuggingFace PEFT) |
| **Analytics** | Usage charts, token stats, latency tracking, model breakdown |
| **Request Logs** | Full log of every API request with filtering and pagination |
| **API Keys** | Create and manage API keys for programmatic access |
| **User Auth** | JWT authentication, first user becomes admin |

## Tech Stack

- **Backend**: Python 3.11, FastAPI, SQLAlchemy, Celery
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Recharts
- **Inference**: [Ollama](https://ollama.com) (runs models locally)
- **Fine-tuning**: HuggingFace Transformers + PEFT (LoRA/QLoRA)
- **Database**: SQLite (dev) / PostgreSQL (prod)
- **Queue**: Redis + Celery (for training jobs)

## Quick Start

### Option 1: Docker Compose (recommended)

```bash
git clone https://github.com/your-org/nebulaxai
cd nebulaxai
cp backend/.env.example backend/.env
docker compose up -d
```

Then open http://localhost:3000

### Option 2: Local Development

**Prerequisites**: Python 3.11+, Node.js 20+, [Ollama](https://ollama.com/download)

```bash
# Start Ollama
ollama serve
ollama pull llama3.2:3b   # pull a model to start chatting

# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

Open http://localhost:3000 — the first account you register becomes admin.

## Fine-tuning

1. **Create a model** in Model Hub (pick a base like `llama3.2:3b`)
2. **Upload a dataset** in Training (JSONL: `{"text": "..."}` or `{"instruction": "...", "output": "..."}`)
3. **Configure** LoRA parameters (rank, alpha, epochs, etc.)
4. **Start training** — watch logs update in real time

Training requires a GPU for reasonable speed. For CPU-only, use QLoRA with small batch sizes.

## API Usage

All endpoints accept `Bearer <jwt>` or `Bearer nai_<api_key>`.

```bash
# Chat completion (streaming)
curl -N http://localhost:8000/api/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "llama3.2:3b", "messages": [{"role": "user", "content": "Hello!"}], "stream": true}'

# Run an agent
curl -X POST http://localhost:8000/api/v1/agents/run \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"task": "What is the latest news about AI?", "model": "llama3.2:3b"}'
```

## Project Structure

```
nebulaxai/
├── backend/
│   ├── app/
│   │   ├── api/          # Route handlers (auth, models, chat, agents, analytics)
│   │   ├── core/         # Config, database, security
│   │   ├── models/       # SQLAlchemy ORM models
│   │   ├── schemas/      # Pydantic request/response schemas
│   │   ├── services/     # Ollama, agent runner, training
│   │   ├── main.py       # FastAPI application
│   │   └── worker.py     # Celery worker
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── pages/        # Dashboard, Chat, Agents, Models, Train, Analytics, Logs...
│   │   ├── components/   # Layout, Sidebar
│   │   ├── store/        # Zustand auth store
│   │   └── lib/          # Axios API client
│   └── Dockerfile
└── docker-compose.yml
```

## License

MIT
