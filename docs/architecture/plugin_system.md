# Plugin System

A plugin adds **tools** — functions an agent or a workflow can call — without
touching HexaLLM's source.

Implemented in this document's scope: tool plugins, admin management, a
subprocess sandbox with enforced permissions, per-plugin rate limiting, an
audit trail, agent + workflow integration, and a dev-site UI.

> **Scope note.** An earlier draft of this document also described model
> adapters, UI extensions, workflow templates, auth providers, storage
> backends, a signed remote marketplace, WASM isolation, and a `hexallm`
> CLI. **None of those are implemented.** They are listed under
> [Not built](#not-built) so nobody assumes they exist.

---

## Layout

```
backend/plugins/
├── text-stats/            # example: pure computation, no permissions
│   ├── manifest.json
│   └── plugin.py
├── scratch-notes/         # example: declares filesystem access
│   ├── manifest.json
│   └── plugin.py
└── _data/<name>/          # per-plugin storage, created on first call
```

A plugin is a directory under `PLUGINS_DIR` (default `backend/plugins`).
`PLUGINS_DIR` is configurable via the `PLUGINS_DIR` setting; set
`PLUGINS_ENABLED=false` to switch discovery off entirely.

## Plugin contract

`plugin.py` must expose two module-level names. Keeping the contract this
small means a plugin needs no SDK, no inheritance, and no imports from
HexaLLM — so it runs unchanged in the sandbox or in-process.

```python
TOOLS = [
    {
        "name": "text_stats",
        "description": "Word/character counts for a block of text.",
        "input_schema": {
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
        },
    },
]

def run(tool: str, args: dict) -> str:
    """Dispatch a tool call. May be sync or async."""
    if tool == "text_stats":
        return json.dumps(analyse(args["text"]))
    raise ValueError(f"unknown tool: {tool}")
```

`TOOLS` in the code is documentation for the author; the **manifest** is the
authority the registry indexes, and a tool the manifest doesn't list cannot be
called.

## Manifest

```json
{
  "name": "scratch-notes",
  "version": "1.0.0",
  "description": "Read and write short notes in a private scratch directory.",
  "author": "HexaLLM",
  "license": "MIT",
  "entry_point": "plugin.py",
  "isolation": "sandbox",
  "permissions": {
    "filesystem": ["scratch"],
    "network": [],
    "secrets": [],
    "subprocess": false
  },
  "rate_limit": {
    "per_user": 20,
    "per_plugin": 60,
    "period_seconds": 60
  },
  "tools": [
    {
      "name": "note_write",
      "description": "Save a note. Input: JSON {\"name\": \"my-note\", \"text\": \"...\"}",
      "input_schema": { "...": "..." }
    }
  ]
}
```

Validated on load; a plugin that fails validation is marked `invalid` in the UI
and contributes **no** tools. Rejections include a bad `name`, a missing or
duplicate tool, a tool with no description, an `entry_point` outside the plugin
directory, and an unknown `isolation`.

An optional top-level `timeout` (seconds) may lower the per-call ceiling; it
can never raise it above `PLUGIN_MAX_TIMEOUT`.

## Isolation

**Loading a plugin executes its code.** Every management route requires admin,
and a newly discovered plugin is inserted **disabled** — it starts
contributing nothing until an admin enables it.

| Mode | Behaviour | Use for |
|------|-----------|---------|
| `sandbox` *(default)* | Fresh Python subprocess, locked-down stdlib, jailed filesystem, host-filtered sockets, hard timeout, capped output | Everything, including third-party plugins |
| `inprocess` | Module imported into the backend and `run` awaited directly | First-party plugins only |

`inprocess` gives a plugin the full authority of the backend process. Enabling
it is equivalent to trusting the author as much as you trust yourself.

### What `sandbox` actually enforces

The harness is generated per call and applied **before** the plugin module is
imported, so a plugin cannot capture the real `socket` at import time:

| Permission | Enforcement |
|------------|-------------|
| `filesystem` | `open()` is wrapped. Only the plugin's data dir and its declared sub-paths resolve; every other read or write raises. Path traversal and absolute paths outside those roots are denied. |
| `network` | With no hosts declared, `socket`, `ssl`, `urllib`, `requests`, `httpx`, `asyncio` and friends are removed from `sys.modules`. With hosts declared, `socket.connect` is wrapped to allow only those hosts (or `*`). |
| `subprocess` | With `subprocess: false`, `subprocess` and `commands` are removed from `sys.modules`. |
| `secrets` | Only declared names are resolved and injected — as environment variables, passed on **stdin** so they never appear in a process listing. Undeclared secrets are not passed. |
| output | Truncated at `PLUGIN_MAX_OUTPUT` (100 kB). |
| time | Hard kill at `PLUGIN_MAX_TIMEOUT` (60 s) or the manifest's `timeout`. |

The filesystem jail is *real*: a plugin that calls `open("/etc/passwd")` with
no declared `filesystem` is blocked by the harness, not by the plugin being
well-behaved. See `backend/plugins/_sandbox_selftest.py`, which asserts each
of these.

The data dir is passed as `$HEXALLM_PLUGIN_DATA`. Declared relative
`filesystem` entries resolve inside it, so a plugin can persist state without
being able to reach the rest of the host:

```python
path = os.path.join(os.environ["HEXALLM_PLUGIN_DATA"], "scratch")
```

> **Docker note.** `sandbox` mode reuses the existing `Sandbox` service, so it
> gains a container boundary when Docker is available and degrades to a
> subprocess with an enforced timeout when it is not. It currently runs
> **subprocess** on this host: no container, so the stdlib/permission gating
> above is the only boundary. That gating is meaningful but is not a kernel
> boundary — treat `sandbox` plugins as semi-trusted code.

## How plugin tools are used

Enabled plugin tools appear in three places, with no extra wiring:

- **Agents.** Pass a plugin tool name in `tools`; the agent prompt and dispatch
  table pick it up. A plugin can't widen its own reach — only tools the caller
  asked for are exposed. Models often call a structured tool with a bare
  string, so a single required schema property is filled in automatically.
- **Workflow `tool` nodes.** Set `tool` to the plugin's tool name. The result
  is tagged `"source": "plugin"` in the node run so it's distinguishable from a
  built-in. Output flows downstream via `{{node.output}}` like any other node.
- **The dev-site Plugins page** (`/plugins`), which can invoke a tool directly
  for testing. It has two tabs: **installed** (list, permissions, per-tool
  schemas, test runner) and **audit log** (stat tiles, filters, expandable
  rows, CSV export).

## Rate limiting

Optional per-manifest quotas over a rolling window:

```json
"rate_limit": { "per_user": 20, "per_plugin": 60, "period_seconds": 60 }
```

`0` (or absent) means unlimited for that scope. A plugin that declares no
limits at all is unlimited — **the default is not a limit**, so a third-party
plugin can opt out of protection by omission. Set limits deliberately.

Two scopes, both enforced before the call runs:

- `per_user` — charged to the authenticated user, when one is known.
- `per_plugin` — charged to the plugin, regardless of who called it. Calls with
  no known actor still consume this, so an unattributed path can't bypass the
  cap.

Counting is done by querying recent `plugin_call_logs` rows rather than keeping
counters in memory, which means a quota survives a restart and **cannot be
bypassed by crashing the plugin on purpose** — `ok`, `error` and `blocked`
rows all consume quota. A throttled attempt is itself recorded (as
`rate_limited`) but deliberately does not consume a slot, otherwise a client
hammering a throttled tool would extend its own lockout.

The rate-limited error names the scope, the counts and the retry delay:

```
scratch-notes: rate limit reached for this user (20/20 calls per 60s).
Try again in 60s.
```

The direct-call API returns **429** with a `Retry-After` header. Inside an
agent, the throttle is returned to the model as a tool result so it can back
off or give up rather than burning its step budget.

`backend/plugins/_ratelimit_selftest.py` asserts this behaviour: exact quota
admission, throttle auditing, no self-extending lockout, plugin-wide cap
across distinct users, unattributed calls being capped, window expiry,
redaction, and errors consuming quota.

## Audit trail

Every plugin tool call writes one row to `plugin_call_logs`: plugin, tool,
acting user, isolation mode, status, latency, truncated args and output, and
the error if any. Four statuses are recorded:

| Status | Meaning |
|--------|---------|
| `ok` | Returned normally |
| `error` | The plugin or the host raised |
| `blocked` | The sandbox refused — a permission denial, i.e. an attempted escape |
| `rate_limited` | Throttled before running |

`blocked` is separated from `error` deliberately: a permission block is the
sandbox doing its job and is the single most interesting row to look for.

**Attribution.** Calls are attributed to the user who triggered them — the
admin on the direct-call API, the request's user in `/agents`, the workflow
owner for workflow tool nodes, and for delegated sub-agents the user who
started the run. It's carried on a `contextvars` contextvar, so it propagates
correctly across `await` boundaries inside a background task without threading
a parameter through every layer.

**Redaction.** Args are stored JSON-encoded, truncated to 2 kB, and any key
that is a declared secret or *looks* like a credential (`token`, `secret`,
`password`, `credential`, `api_key`, `authorization`, `auth`) is replaced with
`***redacted***`, with `args_redacted` set. Only key *names* are known to the
host, never values, so a secret passed under an innocuous name is not caught —
this is a safety net, not a guarantee.

Audit rows never carry enough to reconstruct a secret, and the table is
readable only through admin-gated endpoints.

## API

All routes require **admin**.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/plugins` | List discovered plugins, permissions, tools, validation state |
| `GET` | `/api/v1/plugins/tools` | Flat list of tools from enabled plugins |
| `GET` | `/api/v1/plugins/marketplace` | Remote sources (none configured) |
| `GET` | `/api/v1/plugins/{name}/manifest` | Parsed manifest |
| `POST` | `/api/v1/plugins/{name}/enable` | Enable (starts contributing tools) |
| `POST` | `/api/v1/plugins/{name}/disable` | Disable |
| `POST` | `/api/v1/plugins/{name}/call` | Invoke a tool (testing) |
| `POST` | `/api/v1/plugins/install_archive` | Install from a server-side `.tar.gz` / `.zip` path |
| `DELETE` | `/api/v1/plugins/{name}?purge_data=` | Uninstall |
| `GET` | `/api/v1/plugins/audit` | Audit trail — filters `hours`, `plugin_name`, `tool_name`, `user_id`, `status`; paginated; includes a window summary (by status, by plugin, top tools, avg latency, error rate) |
| `GET` | `/api/v1/plugins/audit/export` | CSV dump of the window |
| `DELETE` | `/api/v1/plugins/audit?hours=` | Prune the trail (`hours=0` clears all) — irreversible |

Install takes a **path on the server**, not a file upload, so a plugin can come
from CI or a synced directory. The archive is extracted to a temp dir,
validated, and only then moved into `PLUGINS_DIR`. Rejected: entries that
escape the target directory, and symlinks/hardlinks.

`GET /api/v1/plugins/marketplace` deliberately returns an empty list rather
than a stub, so nothing depends on a remote source that doesn't exist.

### Retention

`plugin_call_logs` is not pruned automatically — rows are kept until an admin
calls `DELETE /api/v1/plugins/audit?hours=N`. On a quiet install that is a few
rows per minute at worst; on a busy one, schedule the prune or the table grows
without bound. CSV export is capped at 10 000 rows per request.

## Writing a plugin

1. Create `plugins/my-plugin/manifest.json` and `plugin.py` per the contract
   above. Start from `backend/plugins/text-stats`.
2. Restart the backend, or hit `GET /api/v1/plugins` to pick it up — discovery
   runs per request, so no restart is needed after the first one.
3. It appears **disabled**. Enable it on `/plugins`.
4. Use a tool in an agent, or drop a `tool` node on the canvas in `/builder`.
5. Test a call from the Plugins page before trusting it with real inputs.

Two plugins claiming the same tool name is allowed; the first wins and the
second is logged, so don't rely on shadowing.

## Not built

Deliberately out of scope, and **not** present in the codebase:

- Model adapters, UI extension slots, auth providers, storage backends,
  event hooks, and workflow templates.
- Remote marketplace, signature verification, and `git`/`npm` install.
- A `hexallm plugin` CLI (scaffold/dev/test/build/publish).
- WASM, gVisor, or Firecracker isolation; `inprocess` is the only non-subprocess
  mode.
- Per-plugin token/cost budgets — quotas are call counts, not spend.
- Automatic audit retention. Pruning is manual (see [Retention](#retention)).
- Secret storage beyond environment variables — declared secrets are read from
  the backend's environment, not from a vault.

Each of these is a real piece of work, not a follow-up tag. Treat this document
as the description of the system that exists.
