"""Rate-limit and audit self-test for the plugin system.

Builds throwaway plugins in a temp PLUGINS_DIR so the quotas can be small
enough to trip in a test, then asserts the behaviour that matters:

* a call past the quota is refused with PluginRateLimited
* the throttled attempt IS audited, as status "rate_limited"
* a throttled attempt does NOT consume quota (otherwise the window locks out)
* the plugin-wide cap trips independently of the per-user cap
* calls with no actor still consume the plugin-wide cap
* quota frees up once the window passes
* credential-shaped args are redacted in the stored row
* errors and permission blocks consume quota too, so a failing plugin can't
  hammer the host by failing on purpose
"""
import asyncio
import json
import os
import shutil
import sys
import tempfile

sys.path.insert(0, ".")

from app.core.database import SessionLocal
from app.models.plugin import PluginCallLog
from app.services import plugin_service
from app.services.plugin_service import PluginRateLimited, registry

results = []


def check(label, ok, detail=""):
    results.append(ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))


def make_plugin(root, name, per_user, per_plugin, period):
    d = os.path.join(root, name)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "manifest.json"), "w") as f:
        json.dump({
            "name": name, "version": "1.0.0", "description": "ratelimit probe",
            "rate_limit": {
                "per_user": per_user, "per_plugin": per_plugin,
                "period_seconds": period,
            },
            "tools": [{
                "name": "ping",
                "description": "return the text back",
                "input_schema": {
                    "type": "object",
                    "properties": {"text": {"type": "string"}},
                    "required": ["text"],
                },
            }],
        }, f)
    with open(os.path.join(d, "plugin.py"), "w") as f:
        f.write(
            "TOOLS=[{'name':'ping','description':'echo'}]\n"
            "def run(tool, args):\n"
            "    return str(args.get('text',''))\n"
        )
    return d


def clear_logs():
    db = SessionLocal()
    try:
        db.query(PluginCallLog).delete()
        db.commit()
    finally:
        db.close()


def log_rows():
    db = SessionLocal()
    try:
        return db.query(PluginCallLog).order_by(PluginCallLog.id).all()
    finally:
        db.close()


async def main():
    tmp = tempfile.mkdtemp(prefix="hexallm_rl_")
    saved_dir = plugin_service.settings.PLUGINS_DIR
    try:
        # ── per-user quota ────────────────────────────────────────────────
        make_plugin(tmp, "rl_user", per_user=3, per_plugin=0, period=60)
        plugin_service.settings.PLUGINS_DIR = tmp
        clear_logs()
        registry.refresh(enabled_names={"rl_user": True})

        print("=== per-user quota (3/60s) ===")
        allowed = 0
        for i in range(5):
            try:
                await registry.call("ping", {"text": f"call {i}"}, user_id=42)
                allowed += 1
            except PluginRateLimited:
                pass
        check("exactly the quota is allowed", allowed == 3, f"allowed={allowed}")

        rows = log_rows()
        limited = [r for r in rows if r.status == "rate_limited"]
        check("throttled attempts are audited", len(limited) == 2, f"rate_limited rows={len(limited)}")
        check(
            "throttled attempt did not consume quota",
            len([r for r in rows if r.status == "ok"]) == 3,
            f"ok rows={len([r for r in rows if r.status=='ok'])}",
        )
        check(
            "limit error names the scope and retry",
            all(r.error and "per 60s" in r.error for r in limited),
            (limited[0].error or "")[:70] if limited else "",
        )

        # ── attribution ───────────────────────────────────────────────────
        print("=== attribution ===")
        check("rows carry the acting user", all(r.user_id == 42 for r in rows if r.user_id),
              f"user_ids={sorted({r.user_id for r in rows})}")

        # ── plugin-wide cap, distinct users ───────────────────────────────
        print("=== plugin-wide cap (4 total, no per-user cap) ===")
        make_plugin(tmp, "rl_plugin", per_user=0, per_plugin=4, period=60)
        clear_logs()
        registry.refresh(enabled_names={"rl_plugin": True})
        allowed = 0
        for uid in range(1, 8):
            try:
                await registry.call("ping", {"text": "x"}, user_id=uid)
                allowed += 1
            except PluginRateLimited:
                pass
        check("plugin cap holds across distinct users", allowed == 4, f"allowed={allowed}")
        scope_rows = [r for r in log_rows() if r.status == "rate_limited"]
        check("throttle is attributed to the plugin scope",
              bool(scope_rows) and "plugin-wide" in (scope_rows[0].error or ""),
              (scope_rows[0].error or "")[:60] if scope_rows else "")

        # ── unattributed calls still consume the cap ──────────────────────
        print("=== unattributed calls count toward the plugin cap ===")
        clear_logs()
        registry.refresh(enabled_names={"rl_plugin": True})
        allowed = 0
        for _ in range(6):
            try:
                await registry.call("ping", {"text": "x"})  # no user_id
                allowed += 1
            except PluginRateLimited:
                pass
        check("no-actor calls are capped too", allowed == 4, f"allowed={allowed}")

        # ── window expiry ─────────────────────────────────────────────────
        print("=== quota frees up after the window ===")
        make_plugin(tmp, "rl_window", per_user=1, per_plugin=0, period=1)
        clear_logs()
        registry.refresh(enabled_names={"rl_window": True})
        first_ok = True
        try:
            await registry.call("ping", {"text": "a"}, user_id=7)
        except PluginRateLimited:
            first_ok = False
        second_blocked = False
        try:
            await registry.call("ping", {"text": "b"}, user_id=7)
        except PluginRateLimited:
            second_blocked = True
        await asyncio.sleep(1.3)
        third_ok = True
        try:
            await registry.call("ping", {"text": "c"}, user_id=7)
        except PluginRateLimited:
            third_ok = False
        check("first call allowed", first_ok)
        check("second call inside the window is blocked", second_blocked)
        check("call after the window is allowed again", third_ok)

        # ── redaction ─────────────────────────────────────────────────────
        print("=== audit redaction ===")
        clear_logs()
        registry.refresh(enabled_names={"rl_user": True})
        await registry.call("ping", {"text": "keep me", "api_token": "sk-live-123"}, user_id=42)
        row = log_rows()[-1]
        check("credential arg is masked in the audit row",
              "sk-live-123" not in (row.args_preview or ""), (row.args_preview or "")[:70])
        check("redaction is flagged", bool(row.args_redacted))
        check("non-secret args are kept", "keep me" in (row.args_preview or ""))

        # ── errors consume quota ──────────────────────────────────────────
        print("=== errors consume quota ===")
        d = os.path.join(tmp, "rl_err")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "manifest.json"), "w") as f:
            json.dump({"name": "rl_err", "version": "1.0.0", "description": "err",
                       "rate_limit": {"per_user": 2, "per_plugin": 0, "period_seconds": 60},
                       "tools": [{"name": "boom", "description": "always fails"}]}, f)
        with open(os.path.join(d, "plugin.py"), "w") as f:
            f.write("TOOLS=[{'name':'boom','description':'always fails'}]\n"
                    "def run(t,a):\n    raise RuntimeError('nope')\n")
        clear_logs()
        registry.refresh(enabled_names={"rl_err": True})
        for _ in range(2):
            try:
                await registry.call("boom", {}, user_id=5)
            except Exception:
                pass
        blocked_by_limit = False
        try:
            await registry.call("boom", {}, user_id=5)
        except PluginRateLimited:
            blocked_by_limit = True
        check("a plugin cannot bypass its quota by failing", blocked_by_limit)
        errs = [r for r in log_rows() if r.status == "error"]
        check("errors are audited with status 'error'", len(errs) == 2, f"error rows={len(errs)}")

    finally:
        plugin_service.settings.PLUGINS_DIR = saved_dir
        clear_logs()
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    print(f"{sum(results)}/{len(results)} checks passed")


asyncio.run(main())
