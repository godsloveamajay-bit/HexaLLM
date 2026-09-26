# Plugin System Architecture

## Overview
A secure, extensible plugin system that allows developers to extend HexaLLM with custom tools, models, UI components, and workflows without modifying core code.

## Plugin Types

| Type | Description | Use Cases |
|------|-------------|-----------|
| **Tool Plugins** | Custom functions callable by LLM | Custom APIs, DB queries, file ops, integrations |
| **Model Adapters** | Custom model providers | Local models, fine-tuned models, proprietary APIs |
| **UI Extensions** | Custom React components | Custom chat views, dashboards, widgets |
| **Workflow Plugins** | Pre-built workflow templates | Domain-specific pipelines |
| **Auth Providers** | Custom authentication | SSO, LDAP, OAuth, WebAuthn |
| **Storage Backends** | Custom storage | S3, GCS, IPFS, encrypted local |
| **Event Hooks** | Lifecycle callbacks | Logging, audit, notifications |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      HexaLLM Core                            │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Plugin      │  │ Plugin      │  │ Plugin Marketplace  │  │
│  │ Registry    │──►│ Loader      │──►│ (GitHub/npm/Registry)│  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│         ▲                │                    ▲              │
│         │                ▼                    │              │
│  ┌──────┴────────────────────────────────────┴──────┐      │
│  │              Plugin Sandbox Runtime              │      │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────────┐   │      │
│  │  │ Tool     │ │ Model    │ │ UI Component   │   │      │
│  │  │ Plugins  │ │ Adapters │ │ Registry       │   │      │
│  │  └──────────┘ └──────────┘ └────────────────┘   │      │
│  └──────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## Plugin Manifest

```json
{
  "name": "hexallm-github",
  "version": "1.0.0",
  "description": "GitHub integration tools",
  "author": "HexaLLM Team",
  "license": "MIT",
  "hexallm_version": ">=14.0.0",
  "entry_point": "index.py",
  "permissions": {
    "tools": ["github_search", "github_create_issue", "github_create_pr"],
    "network": ["api.github.com"],
    "filesystem": ["/workspace/github"],
    "secrets": ["GITHUB_TOKEN"]
  },
  "tools": [
    {
      "name": "github_search",
      "description": "Search GitHub repositories",
      "input_schema": { ... },
      "handler": "github_search"
    }
  ],
  "ui_components": [
    {
      "name": "GitHubRepoPicker",
      "entry": "components/GitHubRepoPicker.tsx",
      "slots": ["sidebar", "modal"]
    }
  ],
  "workflows": [
    {
      "id": "github_pr_review",
      "name": "PR Code Review",
      "file": "workflows/pr_review.yaml"
    }
  ],
  "hooks": {
    "on_chat_start": "on_chat_start",
    "on_message_send": "on_message_send"
  }
}
```

## Plugin Sandbox

### Isolation Levels
| Level | Isolation | Use Case |
|--------|-----------|----------|
| **Process** | Separate process (gVisor/Firecracker) | Untrusted code, user plugins |
| **Container** | Docker with seccomp | Trusted plugins, network access |
| **WASM** | WebAssembly (wasmtime) | Portable, fast, safe |
| **Native** | Direct execution (trusted only) | Core plugins, max performance |

### Security Model
```python
# Plugin capability declaration
class PluginCapabilities:
    network: List[str] = []        # Allowed domains
    filesystem: List[str] = []     # Allowed paths
    secrets: List[str] = []        # Secret names
    subprocess: bool = False       # Allow subprocess
    network_raw: bool = False      # Raw sockets
    
# Runtime enforcement
class PluginSandbox:
    def __init__(self, manifest: PluginManifest):
        self.capabilities = manifest.permissions
        self.allowed_domains = manifest.permissions.network
        self.allowed_paths = manifest.permissions.filesystem
    
    def check_network(self, url: str) -> bool:
        return any(url.startswith(d) for d in self.allowed_domains)
    
    def check_filesystem(self, path: str) -> bool:
        return any(path.startswith(p) for p in self.allowed_paths)
```

## Plugin SDK (Python)

```python
# plugins/my_plugin/__init__.py
from hexallm.plugins import Plugin, Tool, tool

class MyPlugin(Plugin):
    name = "my_plugin"
    version = "1.0.0"
    
    @tool(
        name="my_tool",
        description="Does something useful",
        input_schema={
            "type": "object",
            "properties": {
                "input": {"type": "string"}
            },
            required: ["input"]
        }
    )
    async def my_tool(self, input: str) -> str:
        return f"Processed: {input}"

    async def on_startup(self):
        """Called when plugin loads"""
        pass
    
    async def on_shutdown(self):
        """Called when plugin unloads"""
        pass

# Entry point
PLUGIN = MyPlugin()
```

## Plugin Marketplace

### Distribution Channels
| Channel | Protocol | Verification |
|--------|----------|--------------|
| **Official Registry** | HTTPS + Sigstore | Signed by HexaLLM |
| **GitHub** | git + Sigstore | Signed by author |
| **npm/pypi** | Package manager | Package signatures |
| **Local** | File system | Manual review |

### Installation Flow
```bash
# CLI commands
hexallm plugin install hexallm-github@1.0.0
hexallm plugin list
hexallm plugin update hexallm-github
hexallm plugin remove hexallm-github

# With verification
hexallm plugin install github:user/repo@v1.0.0 --verify
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/plugins` | List installed plugins |
| POST | `/api/v1/plugins/install` | Install plugin |
| DELETE | `/api/v1/plugins/{name}` | Uninstall plugin |
| PATCH | `/api/v1/plugins/{name}` | Update plugin |
| GET | `/api/v1/plugins/{name}/manifest` | Get manifest |
| GET | `/api/v1/plugins/marketplace` | Browse marketplace |
| POST | `/api/v1/plugins/{name}/enable` | Enable plugin |
| POST | `/api/v1/plugins/{name}/disable` | Disable plugin |

## Frontend Integration

### Plugin UI Registry
```typescript
// Frontend plugin registry
interface PluginUIComponent {
  name: string;
  slots: ('sidebar' | 'header' | 'chat' | 'settings' | 'modal')[];
  component: React.ComponentType<{plugin: PluginAPI}>;
}

// Registration
PluginRegistry.registerUI('GitHubRepoPicker', {
  slots: ['sidebar', 'modal'],
  component: GitHubRepoPicker
});

// Usage in HexaLLM UI
<PluginSlot name="sidebar">
  {plugins.map(p => <p.component key={p.name} plugin={p} />)}
</PluginSlot>
```

### Plugin Settings UI
- Manifest editor (JSON + form)
- Permission manager (toggle permissions)
- Secret manager (Vault integration)
- Logs viewer (structured logs)
- Health checks

## Development Workflow

### 1. Scaffold
```bash
hexallm plugin create my-plugin
# Creates:
# my_plugin/
#   ├── manifest.json
#   ├── src/
#   │   ├── __init__.py
#   │   ├── tools.py
#   │   └── hooks.py
#   ├── tests/
#   │   └── test_tools.py
#   ├── pyproject.toml
#   └── README.md
```

### 2. Develop
```bash
# Hot reload during development
hexallm plugin dev my-plugin

# Run tests
hexallm plugin test my-plugin

# Package for distribution
hexallm plugin build my-plugin
```

### 3. Publish
```bash
# To official registry (requires approval)
hexallm plugin publish my-plugin

# Or self-host
hexallm plugin package my-plugin --output my-plugin-1.0.0.tar.gz
```

## Security Best Practices

1. **Least Privilege** - Declare minimal permissions in manifest
2. **Input Validation** - Validate all inputs with schemas
3. **Output Sanitization** - Sanitize outputs before returning to LLM
4. **Rate Limiting** - Built-in per-plugin rate limits
5. **Audit Logging** - All tool calls logged with plugin ID
6. **Signature Verification** - Verify plugin signatures on install
7. **Sandbox Escape Prevention** - No eval, no dynamic imports, restricted builtins

## Migration Path

| From | To | Effort |
|------|-----|--------|
| Custom Python scripts | Tool plugins | Low |
| Custom API endpoints | Tool plugins | Low |
| Custom frontend | UI plugins | Medium |
| External services | MCP tools | Low |
| Legacy plugins | New manifest | Medium |

## Roadmap

| Quarter | Milestone |
|---------|-----------|
| Q1 | Core plugin system, tool plugins, marketplace MVP |
| Q2 | Model adapters, UI plugins, sandbox hardening |
| Q3 | Workflow plugins, marketplace v2, revenue sharing |
| Q4 | Enterprise features (SSO, RBAC, audit), plugin analytics |
