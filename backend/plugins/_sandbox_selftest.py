"""Adversarial checks on the plugin sandbox.

Each case is a plugin that tries to do something its manifest did not
declare. A pass means the harness blocked it, not that the plugin gave up.
"""
import asyncio
import sys

sys.path.insert(0, ".")

from app.services.plugin_service import PluginError, discover, registry

found = discover()
registry.refresh(enabled_names={n: True for n in found})

results = []


async def check(label, expect_blocked, tool, args):
    try:
        out = await registry.call(tool, args)
        blocked = False
        detail = out[:150].replace("\n", " ")
    except PluginError as e:
        blocked = True
        detail = str(e)[:150]
    except Exception as e:
        blocked = "denied" in str(e).lower()
        detail = f"{type(e).__name__}: {str(e)[:130]}"
    ok = blocked == expect_blocked
    results.append(ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}")
    print(f"         {'BLOCKED' if blocked else 'ALLOWED'}: {detail}")


async def main():
    print("=== filesystem jail (scratch-notes declares only ./scratch) ===")
    # The plugin's own _path() rejects traversal before open(), so also probe the
    # harness directly with a note name that tries to escape.
    await check("read /etc/passwd via note_read traversal", True, "note_read", {"name": "../../etc/passwd"})
    await check("write outside scratch via note_write traversal", True, "note_write",
                {"name": "../escaped", "text": "pwned"})
    await check("absolute path as note name", True, "note_read", {"name": "/etc/shadow"})

    print()
    print("=== legitimate use still works ===")
    out = await registry.call("note_write", {"name": "demo", "text": "hello sandbox"})
    results.append("saved" in out)
    print(f"  [{'PASS' if 'saved' in out else 'FAIL'}] note_write inside scratch: {out}")
    out = await registry.call("note_list", {})
    print(f"  [{'PASS' if 'demo' in out else 'FAIL'}] note_list: {out}")
    results.append("demo" in out)

    print()
    print("=== network denied for plugins that declare none ===")
    import json as _json
    import os
    import tempfile

    tmp = tempfile.mkdtemp()
    d = os.path.join(tmp, "netprobe")
    os.makedirs(d)
    with open(os.path.join(d, "plugin.py"), "w") as f:
        f.write(
            "TOOLS=[{'name':'probe_net','description':'try a socket'}]\n"
            "def run(tool, args):\n"
            "    import socket\n"
            "    s=socket.socket()\n"
            "    s.settimeout(3)\n"
            "    s.connect(('93.184.216.34',80))\n"
            "    return 'connected'\n"
        )
    with open(os.path.join(d, "manifest.json"), "w") as f:
        _json.dump({"name": "netprobe", "version": "1.0.0",
                    "description": "probe", "tools": [
                        {"name": "probe_net", "description": "try a socket"}]}, f)

    from app.services import plugin_service
    saved_dir = plugin_service.settings.PLUGINS_DIR
    plugin_service.settings.PLUGINS_DIR = tmp
    try:
        registry.refresh(enabled_names={"netprobe": True})
        await check("outbound socket (no network declared)", True, "probe_net", {})
    finally:
        plugin_service.settings.PLUGINS_DIR = saved_dir

    print()
    print("=== subprocess denied unless declared ===")
    tmp2 = tempfile.mkdtemp()
    d2 = os.path.join(tmp2, "subprobe")
    os.makedirs(d2)
    with open(os.path.join(d2, "plugin.py"), "w") as f:
        f.write(
            "TOOLS=[{'name':'probe_sub','description':'try subprocess'}]\n"
            "def run(tool, args):\n"
            "    import subprocess\n"
            "    return subprocess.run(['id'], capture_output=True, text=True).stdout\n"
        )
    with open(os.path.join(d2, "manifest.json"), "w") as f:
        _json.dump({"name": "subprobe", "version": "1.0.0",
                    "description": "probe", "tools": [
                        {"name": "probe_sub", "description": "try subprocess"}]}, f)
    plugin_service.settings.PLUGINS_DIR = tmp2
    try:
        registry.refresh(enabled_names={"subprobe": True})
        await check("subprocess.run (no subprocess declared)", True, "probe_sub", {})
    finally:
        plugin_service.settings.PLUGINS_DIR = saved_dir

    print()
    print("=== harness filesystem jail (plugin bypasses its own validation) ===")
    import json as _json2
    import os as _os
    import tempfile as _tf

    tmp3 = _tf.mkdtemp()
    d3 = _os.path.join(tmp3, "jailprobe")
    _os.makedirs(d3)
    # No name validation: go straight for the host filesystem.
    with open(_os.path.join(d3, "plugin.py"), "w") as f:
        f.write(
            "TOOLS=[{'name':'read_etc','description':'read a host file'}]\n"
            "def run(tool, args):\n"
            "    return open('/etc/passwd').read()[:200]\n"
        )
    with open(_os.path.join(d3, "manifest.json"), "w") as f:
        _json2.dump({"name": "jailprobe", "version": "1.0.0", "description": "probe",
                     "tools": [{"name": "read_etc", "description": "read a host file"}]}, f)
    plugin_service.settings.PLUGINS_DIR = tmp3
    try:
        registry.refresh(enabled_names={"jailprobe": True})
        await check("open('/etc/passwd') with no declared filesystem", True, "read_etc", {})
    finally:
        plugin_service.settings.PLUGINS_DIR = saved_dir

    print()
    print("=== unknown tool / disabled plugin ===")
    await check("tool nobody provides", True, "no_such_tool", {})

    print()
    print(f"{sum(results)}/{len(results)} checks passed")


asyncio.run(main())
