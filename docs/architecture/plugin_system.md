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
  "budget": {
    "per_day_calls": 5000,
    "max_daily_cost_usd": 2.5,
    "max_output_bytes": 65536,
    "max_latency_ms": 30000
  },
  "retention_days": 90,
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

## Budgets

`rate_limit` bounds burst rate over seconds. A runaway loop still gets through,
so `budget` adds daily ceilings plus per-call limits. `0`/absent means
unlimited.

| Field | Effect |
|-------|--------|
| `per_day_calls` | Calls per rolling 24h across all users. Stops an overnight runaway. |
| `max_daily_cost_usd` | Daily ceiling on **self-reported** spend (see below). |
| `max_output_bytes` | Per-call returned size. Exceeding it fails the call. |
| `max_latency_ms` | Per-call wall clock. It also tightens the subprocess timeout, so an over-budget call is killed rather than merely flagged; if a call still overruns, it is recorded as an error. |

Refusals are audited with status `budget_exceeded` and, like
`rate_limited`, do not consume a slot in the window they were refused for.

### Cost is self-reported, and cannot be verified

`max_daily_cost_usd` is measured from what the plugin *tells us*, via
`PluginResult`:

```python
from app.services.plugin_service import PluginResult   # in-process plugins
return PluginResult("done", cost_usd=0.002)
```

A sandboxed plugin can return any object with `.output` and `.cost_usd`
attributes, so it needs no imports. The original contract — returning a plain
string — still works and reports zero.

**The host cannot verify this.** A plugin calling a third-party API spends money
the backend never sees; the plugin could simply report `0`. Treat the number as
a budgeting aid for plugins you trust, not as an accounting record. A sandboxed
plugin with no `network` permission genuinely cannot spend anything and should
report `0` — if one declares `max_daily_cost_usd`, that is a signal it expects
to reach the network.

The budget check runs **before** the call, so the final spend can exceed the cap
by at most one call's reported cost.

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

Three independent rules, applied together by the background task. `0`/absent
disables each.

| Rule | Setting | Effect |
|------|---------|--------|
| Age | `PLUGIN_AUDIT_RETENTION_DAYS` (30) | Drop rows older than the window. |
| Row count | `PLUGIN_AUDIT_MAX_ROWS` (50 000) | Keep only the newest N. |
| Size | `PLUGIN_AUDIT_MAX_MB` (256) | Keep the newest rows that fit the budget, measured by the length of the stored args/output/error previews. |

Age is evaluated **per plugin**. A manifest may set its own `retention_days`,
which overrides the global value in either direction:

* a longer window keeps more history for that plugin
* a shorter window discards it sooner
* `-1` pins the plugin's rows indefinitely — a deliberate opt-out
* absent or `0` means "use the global setting"

The row-count and size caps are global, and keep the newest rows when exceeded.

The prune is **batched** (2000 ids per transaction, commit between batches).
One unbounded `DELETE` on SQLite holds a write lock for the whole table scan,
which would stall live plugin calls on a busy install; ordering by id keeps it
to an indexed range scan. The loop sleeps before its first cycle so a fresh
process doesn't contend with live traffic, and the interval has a 5-minute
floor.

Manual pruning stays available via `DELETE /api/v1/plugins/audit?hours=N`, with
`hours=0` clearing everything. It deliberately ignores `plugin_name` when
clearing all — a "delete all" that quietly kept one plugin's rows would be
surprising. CSV export is capped at 10 000 rows per request.

The audit tab states the effective policy in plain text, so nobody assumes the
trail is permanent.

`backend/plugins/_retention_selftest.py` and
`backend/plugins/_budget_selftest.py` cover age deletion, the size cap,
per-plugin windows in both directions, the never-expire opt-out, and that the
newest rows are the ones kept.

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
- **Verified** cost accounting. Budgets are enforced against self-reported
  spend, which the host cannot check; see
  [Cost is self-reported](#cost-is-self-reported-and-cannot-be-verified).
- Per-user daily budgets — `budget` is per plugin, not per user.
- Retention by row age only for plugins whose window is not overridden;
  row-count and size caps are global, not per plugin.
- Secret storage beyond environment variables — declared secrets are read from
  the backend's environment, not from a vault.

Each of these is a real piece of work, not a follow-up tag. Treat this document
as the description of the system that exists.
