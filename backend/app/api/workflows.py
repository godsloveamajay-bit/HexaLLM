"""Workflow API.

Two flavours share one table (`workflows`) and one router (`/api/v1/workflows`):

* **Task runner** (legacy) — `task` + `model` + `tools` describe a single agent
  run. Used by the Workflows page; `POST /{id}/run` executes it.
* **Visual DAG** — `definition` holds `{nodes, edges}` and each node is also
  persisted as a `WorkflowNode` row so executions can record per-node
  results, tokens and latency. `POST /{id}/execute` runs the graph.
"""
from __future__ import annotations

import ast
import json
import operator
import re
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from ..core.database import get_db, SessionLocal
from ..core.security import get_current_user
from ..models.user import User
from ..models.workflows import (
    Workflow,
    WorkflowNode,
    WorkflowEdge,
    WorkflowExecution,
    NodeExecution,
    ExecutionStatus,
    NodeExecutionStatus,
)
from ..models.chat import RequestLog
from ..services.ollama_service import ollama
from ..services.agent_service import run_agent, _TOOL_FUNCS
from ..services.sandbox_service import Sandbox
from ..services import model_router

router = APIRouter(prefix="/workflows", tags=["workflows"])


# ─── Schemas ─────────────────────────────────────────────────────────────────

class WorkflowCreate(BaseModel):
    """Create either a DAG workflow (`definition`) or a task workflow."""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    definition: Optional[Dict[str, Any]] = None
    # Legacy task-runner fields
    task: Optional[str] = None
    model: Optional[str] = None
    tools: List[str] = []
    system_prompt: Optional[str] = None
    max_steps: int = 10
    schedule: Optional[str] = None
    is_template: bool = False
    tags: Optional[List[str]] = None


class WorkflowUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    definition: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None
    is_template: Optional[bool] = None
    tags: Optional[List[str]] = None
    task: Optional[str] = None
    model: Optional[str] = None
    tools: Optional[List[str]] = None
    system_prompt: Optional[str] = None
    max_steps: Optional[int] = None
    schedule: Optional[str] = None


class WorkflowResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    version: int
    definition: Dict[str, Any] = {}
    task: Optional[str] = None
    model: Optional[str] = None
    tools: List[str] = []
    system_prompt: Optional[str] = None
    max_steps: int = 10
    schedule: Optional[str] = None
    is_active: bool
    is_template: bool
    tags: List[str] = []
    run_count: int = 0
    last_run_at: Optional[datetime] = None
    last_result: Optional[str] = None
    last_error: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ExecuteRequest(BaseModel):
    input_data: Dict[str, Any] = {}
    variables: Optional[Dict[str, Any]] = None


class ExecutionResponse(BaseModel):
    id: int
    execution_id: str
    workflow_id: int
    status: str
    input_data: Optional[Dict[str, Any]] = None
    output_data: Optional[Dict[str, Any]] = None
    current_node_id: Optional[int] = None
    total_tokens: int = 0
    total_cost_usd: float = 0.0
    total_latency_ms: int = 0
    error_message: Optional[str] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ExecutionListResponse(BaseModel):
    executions: List[ExecutionResponse]
    total: int
    page: int
    page_size: int


class NodeExecutionResponse(BaseModel):
    id: int
    execution_id: int
    node_id: int
    # The node_id string from the definition (e.g. "llm_1") so a UI can label
    # the run without a second lookup.
    node_key: Optional[str] = None
    status: str
    input_data: Optional[Dict[str, Any]] = None
    output_data: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    tokens_used: int = 0
    cost_usd: float = 0.0
    latency_ms: int = 0
    attempt: int = 1
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ExecutionDetailResponse(BaseModel):
    execution: ExecutionResponse
    node_executions: List[NodeExecutionResponse]


# ─── Definition validation / graph helpers ───────────────────────────────────

# Node types the engine can actually run. Anything else is rejected on create so
# a saved workflow can never be un-runnable.
SUPPORTED_NODE_TYPES = {"llm", "tool", "condition", "transform"}


def has_cycles(node_ids: Set[str], edges: List[Dict[str, Any]]) -> bool:
    """Detect cycles with an iterative DFS (no recursion limit)."""
    graph = defaultdict(list)
    for edge in edges:
        frm, to = edge.get("from_node_id"), edge.get("to_node_id")
        if frm and to:
            graph[frm].append(to)

    WHITE, GREY, BLACK = 0, 1, 2
    colour = defaultdict(int)
    for start in node_ids:
        if colour[start] != WHITE:
            continue
        stack = [(start, iter(graph.get(start, ())))]
        colour[start] = GREY
        while stack:
            node, it = stack[-1]
            advanced = False
            for nxt in it:
                if colour[nxt] == GREY:
                    return True
                if colour[nxt] == WHITE:
                    colour[nxt] = GREY
                    stack.append((nxt, iter(graph.get(nxt, ()))))
                    advanced = True
                    break
            if not advanced:
                colour[node] = BLACK
                stack.pop()
    return False


def validate_workflow_definition(definition: Dict[str, Any]) -> Tuple[List[str], List[str]]:
    """Validate a `{nodes, edges}` definition. Returns (errors, warnings)."""
    errors: List[str] = []
    warnings: List[str] = []

    nodes = definition.get("nodes") or []
    edges = definition.get("edges") or []

    if not nodes:
        return ["Workflow must have at least one node"], warnings

    node_ids: Set[str] = set()
    for node in nodes:
        node_id = node.get("node_id")
        if not node_id:
            errors.append("Each node must have a node_id")
            continue
        if node_id in node_ids:
            errors.append(f"Duplicate node_id: {node_id}")
        node_ids.add(node_id)

        node_type = (node.get("node_type") or "").lower()
        if not node_type:
            errors.append(f"Node {node_id} is missing node_type")
        elif node_type not in SUPPORTED_NODE_TYPES:
            errors.append(
                f"Node {node_id}: unsupported node_type '{node_type}' "
                f"(supported: {', '.join(sorted(SUPPORTED_NODE_TYPES))})"
            )

    for edge in edges:
        frm, to = edge.get("from_node_id"), edge.get("to_node_id")
        if frm not in node_ids:
            errors.append(f"Edge references unknown from_node_id: {frm}")
        if to not in node_ids:
            errors.append(f"Edge references unknown to_node_id: {to}")

    if has_cycles(node_ids, edges):
        errors.append("Workflow contains cycles")

    return errors, warnings


def topological_sort(node_ids: List[str], edges: List[Dict[str, Any]]) -> List[str]:
    """Kahn's algorithm. Returns [] if the graph is cyclic."""
    graph = defaultdict(list)
    in_degree: Dict[str, int] = {n: 0 for n in node_ids}
    for edge in edges:
        frm, to = edge.get("from_node_id"), edge.get("to_node_id")
        if frm in in_degree and to in in_degree:
            graph[frm].append(to)
            in_degree[to] += 1

    # Stable order: keep declaration order among ready nodes.
    order_index = {n: i for i, n in enumerate(node_ids)}
    ready = sorted((n for n, d in in_degree.items() if d == 0), key=order_index.get)
    queue = deque(ready)
    result: List[str] = []

    while queue:
        node = queue.popleft()
        result.append(node)
        for nxt in graph.get(node, ()):
            in_degree[nxt] -= 1
            if in_degree[nxt] == 0:
                queue.append(nxt)
        queue = deque(sorted(queue, key=order_index.get))

    return result if len(result) == len(node_ids) else []


# ─── Node persistence ────────────────────────────────────────────────────────

def sync_nodes_and_edges(db: Session, wf: Workflow, definition: Dict[str, Any]) -> None:
    """Rebuild WorkflowNode/WorkflowEdge rows from `definition`.

    Rows are keyed by the string `node_id` inside the definition, so the
    graph survives edits. Two passes: create nodes, then wire edges.
    """
    nodes = definition.get("nodes") or []
    edges = definition.get("edges") or []

    by_node_id = {n.node_id: n for n in wf.nodes}
    seen: Set[str] = set()

    for spec in nodes:
        node_id = spec["node_id"]
        seen.add(node_id)
        row = by_node_id.get(node_id)
        if row is None:
            row = WorkflowNode(workflow_id=wf.id, node_id=node_id)
            db.add(row)
        row.node_type = (spec.get("node_type") or "transform").lower()
        row.config = spec.get("config") or {}
        row.input_mapping = spec.get("input_mapping")
        row.output_schema = spec.get("output_schema")
        row.position_x = int(spec.get("position_x") or spec.get("position", {}).get("x") or 0)
        row.position_y = int(spec.get("position_y") or spec.get("position", {}).get("y") or 0)
        row.is_active = bool(spec.get("is_active", True))
        by_node_id[node_id] = row

    db.flush()  # assign PKs so edges can reference them

    # Drop edges whose endpoints are gone, then re-add the current set.
    for edge in list(wf.edges):
        db.delete(edge)
    db.flush()

    for spec in edges:
        frm, to = spec.get("from_node_id"), spec.get("to_node_id")
        if frm in by_node_id and to in by_node_id:
            db.add(WorkflowEdge(
                workflow_id=wf.id,
                from_node_id=by_node_id[frm].id,
                to_node_id=by_node_id[to].id,
                from_output=spec.get("from_output", "output"),
                to_input=spec.get("to_input", "input"),
                label=spec.get("label"),
                style=spec.get("style"),
            ))

    # Remove nodes no longer in the definition (FK cascade clears their runs).
    for node_id, row in by_node_id.items():
        if node_id not in seen:
            db.delete(row)


# ─── Serialization ───────────────────────────────────────────────────────────

def _serialize(wf: Workflow) -> WorkflowResponse:
    return WorkflowResponse(
        id=wf.id,
        name=wf.name,
        description=wf.description,
        version=wf.version or 1,
        definition=wf.definition or {},
        task=wf.task,
        model=wf.model,
        tools=wf.tools or [],
        system_prompt=wf.system_prompt,
        max_steps=wf.max_steps or 10,
        schedule=wf.schedule,
        is_active=bool(wf.is_active),
        is_template=bool(wf.is_template),
        tags=wf.tags or [],
        run_count=wf.run_count or 0,
        last_run_at=wf.last_run_at,
        last_result=wf.last_result,
        last_error=wf.last_error,
        created_at=wf.created_at,
        updated_at=wf.updated_at,
    )


# ─── CRUD ───────────────────────────────────────────────────────────────────

@router.post("", response_model=WorkflowResponse, status_code=status.HTTP_201_CREATED)
def create_workflow(
    data: WorkflowCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if data.definition:
        errors, warnings = validate_workflow_definition(data.definition)
        if errors:
            raise HTTPException(400, detail={"errors": errors, "warnings": warnings})
    elif not (data.task and data.model):
        raise HTTPException(400, detail="Provide either `definition` or `task` + `model`")

    wf = Workflow(
        name=data.name,
        description=data.description,
        definition=data.definition or {},
        is_template=data.is_template,
        tags=data.tags or [],
        task=data.task,
        model=data.model,
        tools=data.tools or [],
        system_prompt=data.system_prompt,
        max_steps=data.max_steps or 10,
        schedule=data.schedule,
        owner_id=current_user.id,
    )
    db.add(wf)
    db.flush()  # need wf.id for child rows

    if data.definition:
        sync_nodes_and_edges(db, wf, data.definition)

    db.commit()
    db.refresh(wf)
    return _serialize(wf)


@router.get("", response_model=List[WorkflowResponse])
def list_workflows(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    wfs = (
        db.query(Workflow)
        .filter(Workflow.owner_id == current_user.id)
        .order_by(Workflow.updated_at.desc())
        .all()
    )
    return [_serialize(w) for w in wfs]


@router.get("/{workflow_id}", response_model=WorkflowResponse)
def get_workflow(
    workflow_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    wf = db.query(Workflow).filter(Workflow.id == workflow_id).first()
    if not wf:
        raise HTTPException(404, "Workflow not found")
    if wf.owner_id != current_user.id and not current_user.is_admin and not wf.is_public:
        raise HTTPException(403, "Not authorized to view this workflow")
    return _serialize(wf)


@router.patch("/{workflow_id}", response_model=WorkflowResponse)
def update_workflow(
    workflow_id: int,
    data: WorkflowUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    wf = db.query(Workflow).filter(Workflow.id == workflow_id).first()
    if not wf:
        raise HTTPException(404, "Workflow not found")
    if wf.owner_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "Not authorized to update this workflow")

    if data.definition is not None:
        errors, warnings = validate_workflow_definition(data.definition)
        if errors:
            raise HTTPException(400, detail={"errors": errors, "warnings": warnings})
        sync_nodes_and_edges(db, wf, data.definition)

    for field, value in data.model_dump(exclude_unset=True, exclude_none=True).items():
        setattr(wf, field, value)

    wf.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(wf)
    return _serialize(wf)


@router.delete("/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workflow(
    workflow_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    wf = db.query(Workflow).filter(Workflow.id == workflow_id).first()
    if not wf:
        raise HTTPException(404, "Workflow not found")
    if wf.owner_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "Not authorized to delete this workflow")
    db.delete(wf)
    db.commit()


# ─── Node execution ──────────────────────────────────────────────────────────

_TEMPLATE_RE = re.compile(r"\{\{\s*([\w.]+)\s*\}\}")

# Safe comparison ops for condition nodes — replaces the previous eval().
_COMPARATORS = {
    ast.Eq: operator.eq, ast.NotEq: operator.ne, ast.Lt: operator.lt,
    ast.LtE: operator.le, ast.Gt: operator.gt, ast.GtE: operator.ge,
    ast.In: lambda a, b: a in b, ast.NotIn: lambda a, b: a not in b,
}


def render_template(text: str, scope: Dict[str, Any]) -> str:
    """Substitute {{name}} / {{node.output}} references from `scope`."""
    def _sub(match: re.Match) -> str:
        path = match.group(1)
        if path in scope:
            return str(scope[path])
        node_id, _, field = path.partition(".")
        if node_id in scope and isinstance(scope[node_id], dict):
            return str(scope[node_id].get(field, match.group(0)))
        return match.group(0)

    return _TEMPLATE_RE.sub(_sub, text)


def resolve_inputs(node: WorkflowNode, scope: Dict[str, Any]) -> Dict[str, Any]:
    """Merge node.config with any input_mapping overrides, templated."""
    inputs = dict(node.config or {})
    for key, source in (node.input_mapping or {}).items():
        if isinstance(source, str):
            inputs[key] = render_template(source, scope)
        else:
            inputs[key] = source
    return inputs


def _safe_eval_expr(node: ast.AST, scope: Dict[str, Any]):
    """Evaluate a condition expression using a restricted AST walker."""
    if isinstance(node, ast.BoolOp):
        values = [_safe_eval_expr(v, scope) for v in node.values]
        return all(values) if isinstance(node.op, ast.And) else any(values)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
        return not _safe_eval_expr(node.operand, scope)
    if isinstance(node, ast.Compare):
        left = _safe_eval_expr(node.left, scope)
        for op, comparator in zip(node.ops, node.comparators):
            right = _safe_eval_expr(comparator, scope)
            fn = _COMPARATORS.get(type(op))
            if fn is None or not fn(left, right):
                return False
            left = right
        return True
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        if node.id in scope:
            return scope[node.id]
        raise ValueError(f"Unknown variable '{node.id}'")
    if isinstance(node, ast.Attribute):
        base = _safe_eval_expr(node.value, scope)
        if isinstance(base, dict) and node.attr in base:
            return base[node.attr]
        raise ValueError(f"Unknown field '{node.attr}'")
    if isinstance(node, (ast.List, ast.Tuple)):
        return [_safe_eval_expr(e, scope) for e in node.elts]
    if isinstance(node, ast.Dict):
        return {
            _safe_eval_expr(k, scope): _safe_eval_expr(v, scope)
            for k, v in zip(node.keys, node.values)
        }
    raise ValueError(f"Unsupported expression: {type(node).__name__}")


def evaluate_condition(expression: str, scope: Dict[str, Any]) -> bool:
    try:
        tree = ast.parse(expression.strip(), mode="eval")
    except SyntaxError as e:
        raise ValueError(f"Invalid condition: {e}") from e
    return bool(_safe_eval_expr(tree.body, scope))


async def _run_llm_node(node: WorkflowNode, scope: Dict[str, Any]) -> Dict[str, Any]:
    config = resolve_inputs(node, scope)
    prompt = config.get("prompt") or config.get("input") or ""
    if not prompt:
        raise ValueError("LLM node requires a `prompt` in its config")
    prompt = render_template(str(prompt), scope)

    model = config.get("model") or "qwen2.5:7b"
    temperature = float(config.get("temperature", 0.7))
    max_tokens = config.get("max_tokens")
    system_prompt = config.get("system_prompt") or None

    # Resolve a HexaLLM variant (e.g. hex-auto) to a concrete model.
    if model_router.is_variant(model):
        try:
            available = [m["name"] for m in await ollama.list_models()]
        except Exception:
            available = []
        model = model_router.concrete_for(model, prompt, available)

    text = await ollama.chat_complete(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        system_prompt=system_prompt,
        temperature=temperature,
        max_tokens=int(max_tokens) if max_tokens else None,
    )
    return {"output": text, "model": model, "prompt": prompt}


async def _run_tool_node(node: WorkflowNode, scope: Dict[str, Any]) -> Dict[str, Any]:
    """Run a built-in agent tool or a tool contributed by an enabled plugin."""
    config = resolve_inputs(node, scope)
    tool_name = config.get("tool")
    if not tool_name:
        raise ValueError("Tool node requires a `tool` in its config")

    # Plugin tools are resolved first so a plugin can add to (never silently
    # shadow) the built-in set.
    from ..services.plugin_service import PluginError, registry
    if registry.tool_owner(tool_name) is not None:
        if "input" in config:
            arg: Any = config["input"]
        else:
            arg = {k: v for k, v in config.items() if k != "tool"}
        if isinstance(arg, str):
            arg = render_template(arg, scope)
        try:
            result = await registry.call(tool_name, arg if isinstance(arg, dict) else {"input": arg})
        except PluginError as exc:
            raise ValueError(f"plugin {tool_name}: {exc}") from exc
        return {"output": result, "tool": tool_name, "source": "plugin"}

    runner = _TOOL_FUNCS.get(tool_name)
    if runner is None:
        raise ValueError(
            f"Unknown tool '{tool_name}'. Available: {', '.join(sorted(_TOOL_FUNCS))}"
        )

    # An explicit `input` config key is the tool argument; otherwise the
    # remaining config keys are passed as a dict.
    if "input" in config:
        arg = config["input"]
    else:
        arg = {k: v for k, v in config.items() if k != "tool"}

    if isinstance(arg, str):
        arg = render_template(arg, scope)

    result = await runner(arg)
    return {"output": result, "tool": tool_name}


async def _run_condition_node(node: WorkflowNode, scope: Dict[str, Any]) -> Dict[str, Any]:
    config = resolve_inputs(node, scope)
    expression = config.get("condition") or "true"
    result = evaluate_condition(str(expression), scope)
    return {"result": result, "branch": "true" if result else "false"}


async def _run_transform_node(node: WorkflowNode, scope: Dict[str, Any]) -> Dict[str, Any]:
    config = resolve_inputs(node, scope)
    transform = (config.get("transform") or "passthrough").lower()
    value = config.get("value", config.get("input"))

    # An unset (or blank) value means "use the workflow input", so a node
    # dropped on the canvas with its default config still does something
    # sensible instead of emitting an empty string.
    if value is None or (isinstance(value, str) and not value.strip()):
        value = scope.get("input", {})

    if isinstance(value, str):
        value = render_template(value, scope)

    if transform == "json_parse":
        if isinstance(value, str):
            try:
                return {"output": json.loads(value)}
            except json.JSONDecodeError as e:
                raise ValueError(f"json_parse failed: {e}") from e
        return {"output": value}
    if transform == "json_stringify":
        return {"output": json.dumps(value, default=str)}
    if transform == "template":
        return {"output": render_template(str(config.get("template", "")), scope)}
    return {"output": value}


_NODE_RUNNERS = {
    "llm": _run_llm_node,
    "tool": _run_tool_node,
    "condition": _run_condition_node,
    "transform": _run_transform_node,
}


# ─── DAG execution ───────────────────────────────────────────────────────────

@router.post("/{workflow_id}/execute", response_model=ExecutionResponse, status_code=status.HTTP_201_CREATED)
def execute_workflow(
    workflow_id: int,
    request: ExecuteRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    wf = db.query(Workflow).filter(Workflow.id == workflow_id).first()
    if not wf:
        raise HTTPException(404, "Workflow not found")
    if not wf.is_active:
        raise HTTPException(400, "Workflow is not active")
    if wf.owner_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "Not authorized to execute this workflow")

    definition = wf.definition or {}
    if not definition.get("nodes"):
        raise HTTPException(400, "Workflow has no runnable nodes")

    execution = WorkflowExecution(
        workflow_id=wf.id,
        execution_id=str(uuid.uuid4()),
        status=ExecutionStatus.PENDING,
        input_data=request.input_data,
        variables=request.variables or {},
    )
    db.add(execution)
    db.commit()
    db.refresh(execution)

    background_tasks.add_task(run_workflow_dag, execution.id)
    return ExecutionResponse.model_validate(execution)


def run_workflow_dag(execution_id: int) -> None:
    """Background DAG runner. Owns its own session."""
    import asyncio

    async def _run() -> None:
        db = SessionLocal()
        try:
            execution = db.query(WorkflowExecution).filter(
                WorkflowExecution.id == execution_id
            ).first()
            if not execution:
                return

            wf = (
                db.query(Workflow)
                .options(joinedload(Workflow.nodes), joinedload(Workflow.edges))
                .filter(Workflow.id == execution.workflow_id)
                .first()
            )
            if not wf:
                execution.status = ExecutionStatus.FAILED
                execution.error_message = "Workflow not found"
                execution.completed_at = datetime.now(timezone.utc)
                db.commit()
                return

            execution.status = ExecutionStatus.RUNNING
            execution.started_at = datetime.now(timezone.utc)
            db.commit()

            nodes = [n for n in wf.nodes if n.is_active]
            node_map = {n.node_id: n for n in nodes}
            definition = wf.definition or {}
            edge_specs = definition.get("edges") or []

            order = topological_sort([n.node_id for n in nodes], edge_specs)
            if not order:
                execution.status = ExecutionStatus.FAILED
                execution.error_message = "Workflow graph is cyclic or empty"
                execution.completed_at = datetime.now(timezone.utc)
                db.commit()
                return

            # Scope available to {{var}} templates: workflow inputs, then each
            # finished node's output. `input` holds the whole input object so a
            # transform with no configured value can pass it through, and so
            # {{input}} works the same way in a prompt.
            scope: Dict[str, Any] = dict(execution.variables or {})
            scope.update(execution.input_data or {})
            scope["input"] = execution.input_data or {}

            for node_id in order:
                node = node_map.get(node_id)
                if node is None:
                    continue

                # Branch filtering: a condition node's true/false ports gate the
                # nodes downstream of them. An edge only fires when its
                # `from_output` matches the branch the condition actually took;
                # edges with no true/false port are unconditional.
                upstream = [
                    e for e in edge_specs if e.get("to_node_id") == node_id
                ]
                skipped = False
                for edge in upstream:
                    parent = node_map.get(edge.get("from_node_id", ""))
                    if parent is None or parent.node_type.lower() != "condition":
                        continue
                    port = str(edge.get("from_output") or "").lower()
                    if port not in ("true", "false"):
                        continue
                    parent_output = scope.get(parent.node_id)
                    branch = (
                        parent_output.get("branch")
                        if isinstance(parent_output, dict)
                        else None
                    )
                    if branch is not None and port != str(branch).lower():
                        skipped = True
                        break
                if skipped:
                    db.add(NodeExecution(
                        execution_id=execution.id,
                        node_id=node.id,
                        status=NodeExecutionStatus.SKIPPED,
                        started_at=datetime.now(timezone.utc),
                        completed_at=datetime.now(timezone.utc),
                    ))
                    db.commit()
                    continue

                started = datetime.now(timezone.utc)
                node_exec = NodeExecution(
                    execution_id=execution.id,
                    node_id=node.id,
                    status=NodeExecutionStatus.RUNNING,
                    started_at=started,
                    input_data=node.config,
                )
                db.add(node_exec)
                execution.current_node_id = node.id
                db.commit()

                try:
                    runner = _NODE_RUNNERS.get(node.node_type.lower())
                    if runner is None:
                        raise ValueError(
                            f"Unsupported node type '{node.node_type}'"
                        )
                    result = await runner(node, scope)
                except Exception as exc:
                    node_exec.status = NodeExecutionStatus.FAILED
                    node_exec.error_message = f"{type(exc).__name__}: {exc}"
                    node_exec.completed_at = datetime.now(timezone.utc)
                    execution.status = ExecutionStatus.FAILED
                    execution.error_message = f"Node {node.node_id} failed: {exc}"
                    execution.error_node_id = node.id
                    execution.completed_at = datetime.now(timezone.utc)
                    db.commit()
                    return

                latency_ms = int(
                    (datetime.now(timezone.utc) - started).total_seconds() * 1000
                )
                node_exec.status = NodeExecutionStatus.COMPLETED
                node_exec.output_data = result
                node_exec.latency_ms = latency_ms
                node_exec.completed_at = datetime.now(timezone.utc)
                scope[node.node_id] = result
                execution.total_latency_ms = (execution.total_latency_ms or 0) + latency_ms
                db.commit()

            # The workflow's result is the output of the last terminal node
            # that actually ran (a skipped branch must not win).
            terminals = [
                n for n in order
                if not [e for e in edge_specs if e.get("from_node_id") == n]
            ]
            ran = [n for n in terminals if n in scope]
            final_node = (ran or terminals or [None])[-1]
            final_output = scope.get(final_node) if final_node else None

            execution.status = ExecutionStatus.COMPLETED
            execution.output_data = final_output if final_output is not None else scope
            execution.current_node_id = None
            execution.completed_at = datetime.now(timezone.utc)

            wf.run_count = (wf.run_count or 0) + 1
            wf.last_run_at = execution.completed_at
            db.commit()
        except Exception as exc:  # pragma: no cover - safety net
            db.rollback()
            execution = db.query(WorkflowExecution).filter(
                WorkflowExecution.id == execution_id
            ).first()
            if execution:
                execution.status = ExecutionStatus.FAILED
                execution.error_message = f"Runner crashed: {type(exc).__name__}: {exc}"
                execution.completed_at = datetime.now(timezone.utc)
                db.commit()
        finally:
            db.close()

    asyncio.run(_run())


# ─── Execution history ──────────────────────────────────────────────────────

@router.get("/{workflow_id}/executions", response_model=ExecutionListResponse)
def list_executions(
    workflow_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    wf = db.query(Workflow).filter(Workflow.id == workflow_id).first()
    if not wf:
        raise HTTPException(404, "Workflow not found")
    if wf.owner_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "Not authorized")

    query = db.query(WorkflowExecution).filter(WorkflowExecution.workflow_id == workflow_id)
    total = query.count()
    rows = (
        query.order_by(WorkflowExecution.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return ExecutionListResponse(
        executions=[ExecutionResponse.model_validate(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{workflow_id}/executions/{execution_id}", response_model=ExecutionDetailResponse)
def get_execution(
    workflow_id: int,
    execution_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    wf = db.query(Workflow).filter(Workflow.id == workflow_id).first()
    if not wf:
        raise HTTPException(404, "Workflow not found")
    if wf.owner_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "Not authorized")

    execution = db.query(WorkflowExecution).filter(
        WorkflowExecution.id == execution_id,
        WorkflowExecution.workflow_id == workflow_id,
    ).first()
    if not execution:
        raise HTTPException(404, "Execution not found")

    runs = (
        db.query(NodeExecution)
        .options(joinedload(NodeExecution.node))
        .filter(NodeExecution.execution_id == execution.id)
        .order_by(NodeExecution.id)
        .all()
    )
    return ExecutionDetailResponse(
        execution=ExecutionResponse.model_validate(execution),
        node_executions=[
            NodeExecutionResponse.model_validate(
                {**r.__dict__, "node_key": r.node.node_id if r.node else None}
            )
            for r in runs
        ],
    )


# ─── Legacy task-runner execution ───────────────────────────────────────────

async def _run_task_workflow_bg(workflow_id: int, user_id: int) -> None:
    """Run a single-agent `task` workflow (legacy Workflows page)."""
    db = SessionLocal()
    try:
        wf = db.query(Workflow).filter(
            Workflow.id == workflow_id, Workflow.owner_id == user_id
        ).first()
        if not wf:
            return

        eff_model = wf.model
        if model_router.is_variant(wf.model or ""):
            try:
                available = [m["name"] for m in await ollama.list_models()]
            except Exception:
                available = []
            eff_model = model_router.concrete_for(wf.model, wf.task or "", available)

        sandbox = Sandbox()
        try:
            result = await run_agent(
                task=wf.task or "",
                model=eff_model,
                tools=wf.tools or [],
                max_steps=wf.max_steps or 10,
                persona_prompt=wf.system_prompt,
                sandbox=sandbox,
            )
        finally:
            sandbox.cleanup()

        wf.last_result = result.get("result")
        wf.last_error = result.get("error")
        wf.run_count = (wf.run_count or 0) + 1
        wf.last_run_at = datetime.now(timezone.utc)

        usage = result.get("usage") or {}
        db.add(RequestLog(
            user_id=user_id,
            endpoint="/workflows/run",
            method="POST",
            status_code=200 if result.get("result") else 500,
            model_name=wf.model,
            prompt_tokens=int(usage.get("prompt_tokens", 0) or 0),
            completion_tokens=int(usage.get("completion_tokens", 0) or 0),
        ))
        db.commit()
    except Exception as exc:
        db.rollback()
        wf = db.query(Workflow).filter(Workflow.id == workflow_id).first()
        if wf:
            wf.last_error = f"{type(exc).__name__}: {exc}"
            wf.last_run_at = datetime.now(timezone.utc)
            db.commit()
    finally:
        db.close()


@router.post("/{workflow_id}/run", response_model=WorkflowResponse)
def trigger_workflow(
    workflow_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    wf = db.query(Workflow).filter(Workflow.id == workflow_id).first()
    if not wf:
        raise HTTPException(404, "Workflow not found")
    if wf.owner_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "Not authorized to run this workflow")
    if not wf.task:
        raise HTTPException(400, "This workflow has no `task` to run — use /execute instead")

    background_tasks.add_task(_run_task_workflow_bg, wf.id, current_user.id)
    return _serialize(wf)
