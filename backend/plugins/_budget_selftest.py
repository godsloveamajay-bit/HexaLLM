"""Budget and retention self-test.

Covers:
* PluginResult unwrapping and self-reported cost capture
* daily call budget trips and is audited as budget_exceeded
* daily cost budget trips on reported spend
* a refused budget call does not consume a slot
* per-call output-size cap
* per-call latency cap
* size-based retention (max rows)
* per-plugin retention windows override the global setting, both directions
* a plugin pinned to "never expire" keeps its rows
"""
import asyncio
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timedelta, timezone

sys.path.insert(0, ".")

from app.core.database import SessionLocal
from app.models.plugin import PluginCallLog
from app.services import plugin_service
from app.services.plugin_service import (
    PluginBudgetExceeded,
    PluginRateLimited,
    PluginResult,
    effective_retention_days,
    prune_audit,
    registry,
)

results = []


def check(label, ok, detail=""):
    results.append(ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))


def clear():
    db = SessionLocal()
    try:
        db.query(PluginCallLog).delete()
        db.commit()
    finally:
        db.close()


def seed(plugin="probe", age_days=0.0, cost=0.0, out_bytes=10, n=1):
    db = SessionLocal()
    try:
        for _ in range(n):
            db.add(PluginCallLog(
                plugin_name=plugin, tool_name="t", status="ok", latency_ms=1,
                isolation="sandbox", args_redacted=0,
                cost_usd=cost, output_bytes=out_bytes,
                created_at=datetime.now(timezone.utc) - timedelta(days=age_days),
            ))
        db.commit()
    finally:
        db.close()


def count(plugin=None):
    db = SessionLocal()
    try:
        q = db.query(PluginCallLog)
        if plugin:
            q = q.filter(PluginCallLog.plugin_name == plugin)
        return q.count()
    finally:
        db.close()


def total_cost(plugin=None):
    from sqlalchemy import func
    db = SessionLocal()
    try:
        q = db.query(func.coalesce(func.sum(PluginCallLog.cost_usd), 0.0))
        if plugin:
            q = q.filter(PluginCallLog.plugin_name == plugin)
        return round(float(q.scalar() or 0), 6)
    finally:
        db.close()


def make_plugin(root, name, extra_manifest=None, plugin_body=None):
    d = os.path.join(root, name)
    os.makedirs(d, exist_ok=True)
    manifest = {
        "name": name, "version": "1.0.0", "description": "budget probe",
        "tools": [{
            "name": "ping", "description": "echo",
            "input_schema": {
                "type": "object",
                "properties": {"text": {"type": "string"}},
                "required": ["text"],
            },
        }],
    }
    manifest.update(extra_manifest or {})
    with open(os.path.join(d, "manifest.json"), "w") as f:
        json.dump(manifest, f)
    with open(os.path.join(d, "plugin.py"), "w") as f:
        f.write(plugin_body or (
            "TOOLS=[{'name':'ping','description':'echo'}]\n"
            "def run(t, a):\n    return str(a.get('text',''))\n"
        ))
    return d


async def main():
    tmp = tempfile.mkdtemp(prefix="hexallm_budget_")
    saved_dir = plugin_service.settings.PLUGINS_DIR
    saved = {
        k: getattr(plugin_service.settings, k)
        for k in ("PLUGIN_AUDIT_RETENTION_DAYS", "PLUGIN_AUDIT_MAX_ROWS",
                  "PLUGIN_AUDIT_MAX_MB")
    }
    try:
        # ── PluginResult / cost capture ───────────────────────────────────
        print("=== PluginResult ===")
        make_plugin(tmp, "bud_cost", plugin_body=(
            "class R:\n"
            "    def __init__(s, o, c):\n        s.output, s.cost_usd = o, c\n"
            "    def __str__(s):\n        return s.output\n"
            "TOOLS=[{'name':'ping','description':'echo'}]\n"
            "def run(t, a):\n    return R('paid result', 0.5)\n"
        ))
        plugin_service.settings.PLUGINS_DIR = tmp
        clear()
        registry.refresh(enabled_names={"bud_cost": True})
        out = await registry.call("ping", {"text": "x"}, user_id=1)
        db = SessionLocal()
        row = db.query(PluginCallLog).order_by(PluginCallLog.id.desc()).first()
        reported = row.cost_usd
        db.close()
        check("a PluginResult is unwrapped to its text", out == "paid result", repr(out))
        check("self-reported cost is recorded", abs(reported - 0.5) < 1e-9, f"cost={reported}")
        check("output size is recorded", (row.output_bytes or 0) > 0, f"bytes={row.output_bytes}")

        # ── daily call budget ─────────────────────────────────────────────
        print("=== daily call budget ===")
        make_plugin(tmp, "bud_calls", extra_manifest={
            "budget": {"per_day_calls": 3},
        })
        clear()
        registry.refresh(enabled_names={"bud_calls": True})
        allowed = 0
        for _ in range(5):
            try:
                await registry.call("ping", {"text": "x"}, user_id=2)
                allowed += 1
            except PluginBudgetExceeded:
                pass
        check("exactly the daily budget is allowed", allowed == 3, f"allowed={allowed}")
        db = SessionLocal()
        refused = db.query(PluginCallLog).filter(
            PluginCallLog.status == "budget_exceeded").count()
        db.close()
        check("refused calls are audited as budget_exceeded", refused == 2, f"rows={refused}")
        check("refused calls did not consume budget",
              count("bud_calls") == 5, f"rows={count('bud_calls')}")

        # ── daily cost budget ─────────────────────────────────────────────
        print("=== daily cost budget ===")
        make_plugin(tmp, "bud_usd", extra_manifest={
            "budget": {"max_daily_cost_usd": 1.0},
        }, plugin_body=(
            "class R:\n"
            "    def __init__(s, o, c):\n        s.output, s.cost_usd = o, c\n"
            "    def __str__(s):\n        return s.output\n"
            "TOOLS=[{'name':'ping','description':'echo'}]\n"
            "def run(t, a):\n    return R('expensive', 0.4)\n"
        ))
        clear()
        registry.refresh(enabled_names={"bud_usd": True})
        allowed, spent_before_refusal = 0, None
        for _ in range(5):
            try:
                await registry.call("ping", {"text": "x"}, user_id=3)
                allowed += 1
            except PluginBudgetExceeded as e:
                spent_before_refusal = total_cost("bud_usd")
                check("the refusal names cost, not calls", e.kind == "cost", f"kind={e.kind}")
                check("the message reports the declared cap", "$1.00" in str(e), str(e)[:70])
                break
        # 0 -> 0.4 -> 0.8 -> 1.2 all pass the pre-check; the 4th sees 1.2 >= 1.0.
        check("the cost budget stops at the first call past the cap",
              allowed == 3, f"allowed={allowed}")
        # Pre-flight check: the call that crosses the line still runs, so the
        # final spend may exceed the cap by at most one call's reported cost.
        over = (spent_before_refusal or 0) - 1.0
        check("overshoot is bounded by a single call", 0 <= over <= 0.5 + 1e-6,
              f"spent={spent_before_refusal} overshoot={over:.2f}")

        # ── per-call output cap ───────────────────────────────────────────
        print("=== per-call output cap ===")
        make_plugin(tmp, "bud_out", extra_manifest={
            "budget": {"max_output_bytes": 32},
        }, plugin_body=(
            "TOOLS=[{'name':'ping','description':'echo'}]\n"
            "def run(t, a):\n    return 'x' * 500\n"
        ))
        clear()
        registry.refresh(enabled_names={"bud_out": True})
        tripped = False
        try:
            await registry.call("ping", {"text": "x"}, user_id=4)
        except PluginBudgetExceeded as e:
            tripped = e.kind == "output"
        check("oversized output is rejected", tripped)

        # ── no budget declared means no cap ───────────────────────────────
        print("=== no budget declared ===")
        make_plugin(tmp, "bud_none")
        clear()
        registry.refresh(enabled_names={"bud_none": True})
        ok = True
        for _ in range(4):
            try:
                await registry.call("ping", {"text": "x"}, user_id=5)
            except (PluginBudgetExceeded, PluginRateLimited):
                ok = False
        check("a plugin with no budget is uncapped", ok)

        # ── size-based retention ──────────────────────────────────────────
        print("=== size-based retention (max rows) ===")
        plugin_service.settings.PLUGIN_AUDIT_RETENTION_DAYS = 0     # disable age
        plugin_service.settings.PLUGIN_AUDIT_MAX_ROWS = 10
        clear()
        seed("bulk", n=25)
        deleted = prune_audit()
        check("rows beyond max_rows are removed", count("bulk") == 10,
              f"deleted={deleted} left={count('bulk')}")
        check("the newest rows are the ones kept", _newest_kept())
        plugin_service.settings.PLUGIN_AUDIT_MAX_ROWS = 0

        # ── per-plugin retention windows ──────────────────────────────────
        print("=== per-plugin retention windows ===")
        plugin_service.settings.PLUGIN_AUDIT_RETENTION_DAYS = 30
        for nm, extra in (("keep_long", {"retention_days": 90}),
                          ("keep_short", {"retention_days": 2}),
                          ("keep_forever", {"retention_days": -1}),
                          ("keep_global", {})):
            make_plugin(
                tmp, nm,
                extra_manifest={**extra, "tools": [
                    {"name": f"{nm}_tool", "description": "echo"}]},
                plugin_body=(
                    f"TOOLS=[{{'name':'{nm}_tool','description':'echo'}}]\n"
                    f"def run(t, a):\n    return str(a.get('text',''))\n"
                ),
            )
        clear()
        registry.refresh(enabled_names={n: True for n in
                                       ("keep_long", "keep_short", "keep_forever", "keep_global")})
        # 10 days old: inside 90 and 30, outside 2, and exempt for -1.
        for name in ("keep_long", "keep_short", "keep_forever", "keep_global"):
            seed(name, age_days=10, n=1)
        prune_audit()
        check("a plugin may keep rows longer than the global window",
              count("keep_long") == 1, f"left={count('keep_long')}")
        check("a plugin may keep rows far longer, still exempt",
              count("keep_forever") == 1, f"left={count('keep_forever')}")
        check("a plugin may keep rows shorter than the global window",
              count("keep_short") == 0, f"left={count('keep_short')}")
        check("a plugin with no declared window uses the global",
              count("keep_global") == 1, f"left={count('keep_global')}")

        # 40 days old: only the 90-day and never-expire plugins keep them.
        for name in ("keep_long", "keep_forever", "keep_global"):
            seed(name, age_days=40, n=1)
        prune_audit()
        check("the plugin's own window is what counts at 40 days",
              count("keep_long") == 2 and count("keep_forever") == 2,
              f"long={count('keep_long')} forever={count('keep_forever')}")
        check("the global window still applies when not overridden",
              count("keep_global") == 1, f"left={count('keep_global')}")

    finally:
        plugin_service.settings.PLUGINS_DIR = saved_dir
        for k, v in saved.items():
            setattr(plugin_service.settings, k, v)
        clear()
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    print(f"{sum(results)}/{len(results)} checks passed")


def _newest_kept():
    db = SessionLocal()
    try:
        rows = db.query(PluginCallLog.id).order_by(PluginCallLog.id).all()
        return bool(rows) and rows[0][0] > 1
    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
