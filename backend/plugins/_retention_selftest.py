"""Retention self-test for the plugin audit trail.

Asserts:
* rows older than the retention window are deleted
* rows inside the window are kept
* retention_days=0 disables pruning entirely
* pruning is batched, and a batch smaller than the limit means "done"
* the prune loop starts and stops cleanly, and a stop during the sleep ends it
  promptly rather than after a full interval
"""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, ".")

from app.core.database import SessionLocal
from app.models.plugin import PluginCallLog
from app.services import plugin_service
from app.services.plugin_service import (
    audit_prune_loop,
    prune_audit,
    start_audit_pruner,
    stop_audit_pruner,
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


def seed(age_days, n=1, plugin="probe"):
    """Insert n rows created `age_days` in the past."""
    db = SessionLocal()
    try:
        for _ in range(n):
            db.add(PluginCallLog(
                plugin_name=plugin, tool_name="t", status="ok", latency_ms=1,
                created_at=datetime.now(timezone.utc) - timedelta(days=age_days),
            ))
        db.commit()
    finally:
        db.close()


def count():
    db = SessionLocal()
    try:
        return db.query(PluginCallLog).count()
    finally:
        db.close()


def oldest_age_days():
    db = SessionLocal()
    try:
        row = db.query(PluginCallLog).order_by(PluginCallLog.created_at).first()
        if not row:
            return None
        # SQLite drops tzinfo, so treat a naive stamp as UTC.
        stamp = row.created_at
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        return round((datetime.now(timezone.utc) - stamp).total_seconds() / 86400, 2)
    finally:
        db.close()


async def main():
    saved_days = plugin_service.settings.PLUGIN_AUDIT_RETENTION_DAYS
    saved_interval = plugin_service.settings.PLUGIN_AUDIT_PRUNE_INTERVAL_MINUTES
    try:
        print("=== age-based prune ===")
        clear()
        seed(40, n=5)      # older than a 30-day window
        seed(10, n=3)      # inside it
        seed(1, n=2)       # recent
        before = count()

        deleted = prune_audit()
        after = count()
        check("old rows are removed", deleted == 5, f"deleted={deleted}")
        check("recent rows survive", after == before - 5, f"before={before} after={after}")
        check("the oldest remaining row is inside the window",
              (oldest_age_days() or 0) < 30, f"oldest={oldest_age_days()}d")

        print("=== retention disabled ===")
        clear()
        seed(400, n=4)
        plugin_service.settings.PLUGIN_AUDIT_RETENTION_DAYS = 0
        deleted = prune_audit()
        check("retention_days=0 deletes nothing", deleted == 0, f"deleted={deleted}")
        check("old rows are all still there", count() == 4, f"count={count()}")
        plugin_service.settings.PLUGIN_AUDIT_RETENTION_DAYS = 30

        print("=== batching ===")
        clear()
        seed(60, n=25)     # all expired
        # A batch smaller than 25 proves the loop ran more than once and still
        # drained the table rather than stopping after the first page.
        deleted = prune_audit(batch_size=10)
        check("batched prune drains the table", deleted == 25, f"deleted={deleted}")
        check("nothing is left behind", count() == 0, f"count={count()}")

        print("=== nothing to do ===")
        deleted = prune_audit()
        check("pruning an empty/clean table is a no-op", deleted == 0, f"deleted={deleted}")

        print("=== the loop starts and stops ===")
        plugin_service.settings.PLUGIN_AUDIT_PRUNE_INTERVAL_MINUTES = 60
        task = start_audit_pruner()
        check("a task is created when retention is on", task is not None)
        stop_audit_pruner()
        # The loop sleeps first, so a stop set immediately must be observed
        # without waiting out the 60-minute interval.
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=6)
            check("stop ends the loop promptly", True)
        except asyncio.TimeoutError:
            check("stop ends the loop promptly", False, "still running after 6s")
        except asyncio.CancelledError:
            check("stop ends the loop promptly", True)

        print("=== disabled retention starts no task ===")
        plugin_service.settings.PLUGIN_AUDIT_RETENTION_DAYS = 0
        task2 = start_audit_pruner()
        check("no task when retention is disabled", task2 is None)
        stop_audit_pruner()

    finally:
        plugin_service.settings.PLUGIN_AUDIT_RETENTION_DAYS = saved_days
        plugin_service.settings.PLUGIN_AUDIT_PRUNE_INTERVAL_MINUTES = saved_interval
        clear()
        stop_audit_pruner()

    print()
    print(f"{sum(results)}/{len(results)} checks passed")


asyncio.run(main())
