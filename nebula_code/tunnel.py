"""
WebSocket tunnel that connects the local nebula-cli daemon to a NebulaX
instance.  Once running, the web UI can dispatch tasks that execute locally
and stream results back in real time.
"""

import asyncio
import json
import os
import platform
import socket
from typing import Any, Callable, Dict, Optional


class CliTunnel:
    """
    Opens a persistent WebSocket to NebulaX and handles incoming `run` tasks
    by executing them through the local Agent.

    Each incoming task gets a fresh conversation context so remote tasks don't
    bleed into each other.  The user's interactive history is preserved between
    remote runs.
    """

    def __init__(self, nebulax_url: str, token: str) -> None:
        ws_base = nebulax_url.rstrip("/").replace("https://", "wss://").replace("http://", "ws://")
        self.ws_url = f"{ws_base}/api/v1/ws/cli?token={token}"
        self.session_id: Optional[str] = None

    async def run_forever(
        self,
        agent,
        tool_funcs: Dict[str, Any],
        tool_descriptions: Dict[str, str],
        on_event: Callable[[dict], None],
        reconnect: bool = True,
        reconnect_delay: float = 5.0,
    ) -> None:
        """Connect and listen.  Reconnects automatically on disconnect."""
        while True:
            try:
                await self._connect(agent, tool_funcs, tool_descriptions, on_event)
            except Exception as exc:
                on_event({"type": "disconnected", "error": str(exc)})
            if not reconnect:
                break
            on_event({"type": "reconnecting", "delay": reconnect_delay})
            await asyncio.sleep(reconnect_delay)

    async def _connect(
        self,
        agent,
        tool_funcs: Dict[str, Any],
        tool_descriptions: Dict[str, str],
        on_event: Callable[[dict], None],
    ) -> None:
        import websockets  # optional dep — only needed for daemon mode

        async with websockets.connect(
            self.ws_url,
            ping_interval=30,
            ping_timeout=10,
        ) as ws:
            # receive session registration
            raw = await ws.recv()
            reg = json.loads(raw)
            self.session_id = reg.get("session_id", "?")

            # introduce ourselves
            await ws.send(json.dumps({
                "type":     "connected",
                "hostname": socket.gethostname(),
                "cwd":      os.getcwd(),
                "platform": platform.system(),
            }))

            on_event({"type": "ready", "session_id": self.session_id})

            # message loop
            async for raw_msg in ws:
                msg = json.loads(raw_msg)
                mtype = msg.get("type", "")

                if mtype == "run":
                    asyncio.create_task(
                        self._handle_task(ws, msg, agent, tool_funcs, tool_descriptions, on_event)
                    )
                elif mtype == "run_tool":
                    asyncio.create_task(
                        self._handle_tool(ws, msg, tool_funcs, on_event)
                    )
                elif mtype == "ping":
                    await ws.send(json.dumps({"type": "pong"}))

    async def _handle_task(
        self,
        ws,
        msg: dict,
        agent,
        tool_funcs: Dict[str, Any],
        tool_descriptions: Dict[str, str],
        on_event: Callable[[dict], None],
    ) -> None:
        task_id = msg["task_id"]
        task    = msg["task"]
        model   = msg.get("model")

        on_event({"type": "task_start", "task_id": task_id, "task": task})

        # run with fresh history; restore interactive history afterwards
        saved_history = list(agent.history)
        agent.history = []
        if model:
            saved_model, agent.model = agent.model, model

        try:
            async for event in agent.run(task, tool_funcs, tool_descriptions):
                if event["type"] == "tool":
                    on_event({"type": "step", "task_id": task_id, **event})
                    await ws.send(json.dumps({
                        "type":    "step",
                        "task_id": task_id,
                        "name":    event["name"],
                        "input":   event["input"],
                        "output":  event["output"],
                        "thought": event.get("thought", ""),
                    }))

                elif event["type"] == "done":
                    on_event({"type": "done", "task_id": task_id, "result": event["text"]})
                    await ws.send(json.dumps({
                        "type":    "done",
                        "task_id": task_id,
                        "result":  event["text"],
                        "steps":   event.get("steps", []),
                    }))

                elif event["type"] == "error":
                    on_event({"type": "error", "task_id": task_id, "error": event["text"]})
                    await ws.send(json.dumps({
                        "type":    "error",
                        "task_id": task_id,
                        "error":   event["text"],
                    }))

        except Exception as exc:
            err = str(exc)
            on_event({"type": "error", "task_id": task_id, "error": err})
            await ws.send(json.dumps({"type": "error", "task_id": task_id, "error": err}))

        finally:
            agent.history = saved_history
            if model:
                agent.model = saved_model

    async def _handle_tool(
        self,
        ws,
        msg: dict,
        tool_funcs: Dict[str, Any],
        on_event: Callable[[dict], None],
    ) -> None:
        """Execute a single tool dispatch from the chat ReAct loop."""
        task_id   = msg.get("task_id", "")
        tool_name = msg.get("tool", "")
        tool_input = msg.get("input", "")

        on_event({"type": "tool_exec", "task_id": task_id, "tool": tool_name})

        try:
            fn = tool_funcs.get(tool_name)
            if fn is None:
                output = f"Unknown tool '{tool_name}'"
            else:
                import asyncio as _asyncio
                import inspect
                if inspect.iscoroutinefunction(fn):
                    output = await fn(tool_input)
                else:
                    output = await _asyncio.get_event_loop().run_in_executor(None, fn, tool_input)
        except Exception as exc:
            output = f"Tool error: {exc}"

        await ws.send(json.dumps({
            "type":    "tool_result",
            "task_id": task_id,
            "output":  str(output),
        }))
