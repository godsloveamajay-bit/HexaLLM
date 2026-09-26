# Workflow Engine Architecture

## Overview
A visual, drag-and-drop workflow builder that enables users to create complex AI pipelines by connecting nodes (LLM calls, tools, conditionals, loops, human-in-the-loop) into executable graphs.

## Core Concepts

### Node Types
| Type | Description | Inputs | Outputs |
|------|-------------|--------|---------|
| **LLM Node** | Call any LLM with prompt template | prompt, variables, model config | text, structured JSON |
| **Tool Node** | Execute registered tool (search, code, file, web) | params | tool result |
| **Condition Node** | Branch based on expression | input value | true/false branches |
| **Loop Node** | Iterate over collection | collection, item var | iteration outputs |
| **Parallel Node** | Run branches concurrently | shared input | merged outputs |
| **Human Node** | Request human input/approval | prompt, options | user response |
| **Transform Node** | Data transformation (map, filter, reduce) | input | transformed output |
| **Sub-workflow Node** | Embed another workflow | inputs | sub-workflow outputs |

### Execution Model
- **DAG-based execution** - Topological sort for dependency resolution
- **Async execution** - All nodes run async, parallel where possible
- **Checkpointing** - Save state after each node for recovery
- **Streaming** - Real-time output for LLM nodes
- **Timeout/Retry** - Per-node configurable policies

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Workflow Engine                         │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Workflow    │  │  Execution   │  │  State Manager   │  │
│  │  Registry    │──►│  Engine      │──►│  (Redis/SQL)     │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│         ▲                │                   ▲              │
│         │                ▼                   │              │
│  ┌──────┴───────────────────────────────────┴──────┐       │
│  │              Node Executor Pool                  │       │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────────┐  │       │
│  │  │ LLM     │ │ Tool    │ │ Cond.   │ │ Loop   │  │       │
│  │  │ Node    │ │ Node    │ │ Node    │ │ Node   │  │       │
│  │  └─────────┘ └─────────┘ └─────────┘ └────────┘  │       │
│  └──────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

## Data Models

### Workflow Definition
```json
{
  "id": "wf_123",
  "name": "Research Assistant",
  "version": 1,
  "nodes": [
    {
      "id": "n1",
      "type": "llm",
      "config": {
        "model": "hex-auto",
        "prompt_template": "Research {{topic}} and provide key findings",
        "temperature": 0.7
      },
      "inputs": {"topic": "{{workflow.input.topic}}"}
    },
    {
      "id": "n2", 
      "type": "tool",
      "config": {"tool": "search_web", "params": {"query": "{{n1.output}}", "max_results": 5}},
      "inputs": {"query": "{{n1.output}}"}
    }
  ],
  "edges": [
    {"from": "n1", "to": "n2", "output": "output", "input": "query"}
  ],
  "input_schema": {"topic": "string"},
  "output_schema": {"findings": "string"}
}
```

### Execution State
```json
{
  "workflow_id": "wf_123",
  "execution_id": "exec_456",
  "status": "running",
  "current_node": "n2",
  "node_states": {
    "n1": {"status": "completed", "output": "Research findings...", "started_at": "...", "completed_at": "..."},
    "n2": {"status": "running", "started_at": "..."}
  },
  "variables": {"topic": "quantum computing"},
  "created_at": "...",
  "updated_at": "..."
}
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/workflows` | Create workflow |
| GET | `/api/v1/workflows` | List workflows |
| GET | `/api/v1/workflows/{id}` | Get workflow |
| PATCH | `/api/v1/workflows/{id}` | Update workflow |
| DELETE | `/api/v1/workflows/{id}` | Delete workflow |
| POST | `/api/v1/workflows/{id}/execute` | Execute workflow |
| GET | `/api/v1/workflows/{id}/executions` | List executions |
| GET | `/api/v1/workflows/{id}/executions/{exec_id}` | Get execution status |
| GET | `/api/v1/workflows/{id}/executions/{exec_id}/stream` | Stream execution events |
| POST | `/api/v1/workflows/{id}/executions/{exec_id}/cancel` | Cancel execution |
| POST | `/api/v1/workflows/{id}/executions/{exec_id}/retry` | Retry from failed node |

## Frontend Components

### Workflow Canvas
- React Flow / Cytoscape.js for canvas
- Drag-and-drop node palette
- Real-time collaboration (Yjs)
- Mini-map, zoom, undo/redo
- Node configuration panel (side drawer)

### Node Editor
- Form-based config per node type
- Variable picker ({{variable}} autocomplete)
- Input/output mapping UI
- Validation with inline errors

### Execution Monitor
- Real-time node status (pending/running/completed/failed)
- Live output streaming for LLM nodes
- Token usage, latency, cost per node
- Debug panel with input/output inspection

## Implementation Phases

### Phase 1: Core Engine (2 weeks)
- [ ] Workflow CRUD API
- [ ] DAG execution engine
- [ ] Basic node types (LLM, Tool, Condition)
- [ ] State persistence (PostgreSQL + Redis)
- [ ] Basic execution API

### Phase 2: Advanced Nodes (2 weeks)
- [ ] Loop, Parallel, Human nodes
- [ ] Sub-workflow support
- [ ] Retry/timeout policies
- [ ] Checkpoint/resume

### Phase 3: Frontend (3 weeks)
- [ ] Canvas with React Flow
- [ ] Node palette & configuration
- [ ] Execution monitor with streaming
- [ ] Collaboration (cursors, comments)

### Phase 4: Advanced Features (2 weeks)
- [ ] Workflow templates marketplace
- [ ] Version control (git-like)
- [ ] Scheduled/cron executions
- [ ] Webhook triggers
- [ ] Evaluation/benchmarking harness

## Integration Points

| System | Integration |
|--------|-------------|
| Prompt Library | Node prompt templates |
| Cost Dashboard | Per-node cost tracking |
| MCP Server | Expose workflows as MCP tools |
| Auth | RBAC for workflow access |
| Webhooks | Trigger workflows externally |

## Security Considerations
- Sandbox tool execution (Docker/gVisor)
- Input sanitization for templates
- Rate limiting per workflow
- Audit logging for all executions
- Secrets management (Vault integration)
