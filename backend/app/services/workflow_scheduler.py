"""Lightweight scheduler for workflows that declare a `schedule`.

Supports cron expressions (5 fields) and simple intervals such as
"every 5m" / "every 2h". A workflow with a valid schedule is picked up
automatically; invalid schedules are ignored.
"""
from __future__ import annotations

import logging
import re
import threading
from datetime import datetime, timedelta, timezone

from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from ..core.database import SessionLocal
from ..models.workflows import Workflow, WorkflowExecution, ExecutionStatus

logger = logging.getLogger(__name__)

_scheduler = None


def _parse_trigger(schedule: str):
    s = (schedule or "").strip()
    m = re.match(r"^every\s+(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?)$",
                 s, re.IGNORECASE)
    if m:
        n = int(m.group(1))
        unit = m.group(2).lower()
        if unit.startswith("h"):
            return IntervalTrigger(hours=n)
        return IntervalTrigger(minutes=n)
    # Fall back to a 5-field cron expression.
    return CronTrigger.from_crontab(s)


def _run_workflow_now(wf_id: int) -> None:
    db = SessionLocal()
    try:
        wf = db.query(Workflow).filter(Workflow.id == wf_id,
                                      Workflow.is_active.is_(True)).first()
        if not wf:
            return
        if wf.definition and (wf.definition.get("nodes") or []):
            from ..api.workflows import run_workflow_dag
            execution = WorkflowExecution(
                workflow_id=wf.id,
                execution_id=__import__("uuid").uuid4().__str__(),
                status=ExecutionStatus.PENDING,
                input_data={},
                variables={},
            )
            db.add(execution)
            db.commit()
            db.refresh(execution)
            run_workflow_dag(execution.id)
        elif wf.task and wf.model:
            from ..api.workflows import _run_task_workflow_bg
            import asyncio
            asyncio.run(_run_task_workflow_bg(wf.id, wf.owner_id))
    except Exception:
        logger.exception("scheduled workflow %s failed", wf_id)
    finally:
        db.close()


def _tick() -> None:
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        due = (
            db.query(Workflow)
            .filter(
                Workflow.is_active.is_(True),
                Workflow.schedule.isnot(None),
            )
            .all()
        )
        for wf in due:
            try:
                trigger = _parse_trigger(wf.schedule)
            except Exception:
                continue
            if wf.next_run_at is None:
                first = trigger.get_next_fire_time(None, now - timedelta(seconds=1))
            else:
                first = wf.next_run_at
            if first is None:
                continue
            if first.tzinfo is None:
                first = first.replace(tzinfo=timezone.utc)
            if first <= now + timedelta(seconds=30):
                # Mark the next fire time before dispatching so a slow run
                # can't be triggered twice by the next tick.
                nxt = trigger.get_next_fire_time(first, first)
                if nxt is None:
                    nxt = first + timedelta(minutes=1)
                if nxt.tzinfo is None:
                    nxt = nxt.replace(tzinfo=timezone.utc)
                wf.next_run_at = nxt
                db.commit()
                threading.Thread(
                    target=_run_workflow_now, args=(wf.id,), daemon=True
                ).start()
            else:
                if wf.next_run_at != first:
                    wf.next_run_at = first
                    db.commit()
    finally:
        db.close()


def start_scheduler() -> None:
    global _scheduler
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
    except Exception:
        logger.warning("APScheduler not available; workflow scheduling disabled")
        return
    if _scheduler is not None:
        return
    _scheduler = BackgroundScheduler(timezone="UTC")
    _scheduler.add_job(_tick, "interval", seconds=30, id="workflow-tick",
                      max_instances=1, coalesce=True)
    _scheduler.start()
    logger.info("workflow scheduler started")


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
        except Exception:
            pass
        _scheduler = None
