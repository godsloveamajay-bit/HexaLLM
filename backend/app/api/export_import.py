"""Export/Import Chats API - JSONL/Markdown portability."""
from __future__ import annotations

import json
import re
import io
import zipfile
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Query, File, UploadFile, Form
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Text, JSON, Boolean
from sqlalchemy.orm import Session, relationship

from ..core.database import Base, get_db
from ..core.security import get_current_user
from ..models.user import User
from ..models.chat import ChatSession, ChatMessage

router = APIRouter(prefix="/export-import", tags=["export-import"])


class ExportRequest(BaseModel):
    session_ids: Optional[List[int]] = None
    format: str = Field("jsonl", pattern="^(jsonl|markdown|zip)$")
    include_messages: bool = True
    include_metadata: bool = True
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    # Admin-only: export another user's chats. Ignored for non-admins.
    user_id: Optional[int] = None


class ImportRequest(BaseModel):
    overwrite_existing: bool = False
    skip_duplicates: bool = True


class ExportResponse(BaseModel):
    download_url: str
    filename: str
    format: str
    session_count: int
    message_count: int


class ImportResult(BaseModel):
    imported_sessions: int
    imported_messages: int
    skipped_sessions: int
    errors: List[str]


class SessionExport(BaseModel):
    id: int
    title: str
    model: Optional[str]
    created_at: str
    updated_at: str
    messages: List[Dict[str, Any]]


def session_to_dict(session: ChatSession, include_messages: bool = True) -> Dict[str, Any]:
    """Convert a session to a dictionary for export."""
    data = {
        "id": session.id,
        "user_id": session.user_id,
        "title": session.title,
        "model": session.model_name,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "updated_at": session.updated_at.isoformat() if session.updated_at else None,
    }
    if include_messages:
        messages = []
        for msg in session.messages:
            messages.append({
                "role": msg.role,
                "content": msg.content,
                "created_at": msg.created_at.isoformat() if msg.created_at else None,
                "tokens": getattr(msg, 'tokens', None),
            })
        data["messages"] = messages
    return data


def session_to_markdown(session: ChatSession) -> str:
    """Convert a session to Markdown format."""
    lines = [
        f"# {session.title or 'Untitled Chat'}",
        "",
        f"**Model:** {session.model_name or 'Unknown'}",
        f"**Created:** {session.created_at.isoformat() if session.created_at else 'Unknown'}",
        f"**Updated:** {session.updated_at.isoformat() if session.updated_at else 'Unknown'}",
        "",
        "---",
        "",
    ]
    
    for msg in session.messages:
        role = msg.role.capitalize()
        content = msg.content.replace('\n', '\n> ')
        timestamp = msg.created_at.isoformat() if msg.created_at else ""
        lines.append(f"## {role} ({timestamp})")
        lines.append("")
        lines.append(f"> {content}")
        lines.append("")
    
    return "\n".join(lines)


def export_to_jsonl(sessions: List, include_messages: bool = True) -> str:
    """Export sessions to JSONL format."""
    lines = []
    for session in sessions:
        data = session_to_dict(session, include_messages)
        lines.append(json.dumps(data, ensure_ascii=False))
    return "\n".join(lines)


def export_to_markdown(sessions: List) -> str:
    """Export sessions to Markdown format (one file per session in a zip)."""
    # This will be used in zip export
    pass


def export_to_zip(sessions: List, include_messages: bool = True) -> bytes:
    """Export sessions to a ZIP file containing JSONL and Markdown files."""
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zipf:
        # Add JSONL file
        jsonl_content = export_to_jsonl(sessions, include_messages=True)
        zipf.writestr("chats.jsonl", jsonl_content.encode('utf-8'))
        
        # Add individual markdown files
        for session in sessions:
            md_content = session_to_markdown(session)
            safe_title = "".join(c if c.isalnum() or c in " -_" else "_" for c in session.title or "untitled")
            filename = f"chats/{session.id}_{safe_title[:50]}.md"
            zipf.writestr(filename, md_content.encode('utf-8'))
        
        # Add metadata file
        metadata = {
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "session_count": len(sessions),
            "version": "1.0",
        }
        zipf.writestr("metadata.json", json.dumps(metadata, indent=2).encode('utf-8'))
    
    buffer.seek(0)
    return buffer.read()


def import_from_jsonl(content: str, db: Session, user_id: int, overwrite: bool = False, skip_duplicates: bool = True) -> tuple[int, int, int, List[str]]:
    """Import sessions from JSONL content.

    Returns (imported_sessions, imported_messages, skipped_sessions, errors).
    """
    from ..models.chat import ChatSession, ChatMessage
    imported_sessions = 0
    imported_messages = 0
    skipped_sessions = 0
    errors = []

    for line_num, line in enumerate(content.strip().split('\n'), 1):
        if not line.strip():
            continue
        try:
            data = json.loads(line)
            # Check if session exists — scoped to the importing user. A global
            # lookup would let a crafted `id` overwrite (and delete) somebody
            # else's session.
            existing = None
            if skip_duplicates and 'id' in data:
                existing = (
                    db.query(ChatSession)
                    .filter(ChatSession.id == data['id'], ChatSession.user_id == user_id)
                    .first()
                )

            if existing and not overwrite:
                skipped_sessions += 1
                continue  # Skip

            if existing:
                db.delete(existing)
                db.commit()
            
            # Create session. The owner always comes from the authenticated
            # caller — never from the file, which would let an import plant
            # sessions in another user's account.
            session = ChatSession(
                title=data.get('title', 'Imported Chat'),
                model_name=data.get('model'),
                user_id=user_id,
            )
            if 'created_at' in data and data['created_at']:
                try:
                    session.created_at = datetime.fromisoformat(data['created_at'].replace('Z', '+00:00'))
                except:
                    pass
            if 'updated_at' in data and data['updated_at']:
                try:
                    session.updated_at = datetime.fromisoformat(data['updated_at'].replace('Z', '+00:00'))
                except:
                    pass
            
            db.add(session)
            db.flush()
            
            # Import messages
            if 'messages' in data:
                for msg_data in data['messages']:
                    msg = ChatMessage(
                        session_id=session.id,
                        role=msg_data.get('role', 'user'),
                        content=msg_data.get('content', ''),
                    )
                    if 'created_at' in msg_data and msg_data['created_at']:
                        try:
                            msg.created_at = datetime.fromisoformat(msg_data['created_at'].replace('Z', '+00:00'))
                        except:
                            pass
                    db.add(msg)
            
            imported_sessions += 1
            imported_messages += len(data.get('messages', []))
            
        except Exception as e:
            errors.append(f"Line {line_num}: {str(e)}")
    
    db.commit()
    return imported_sessions, imported_messages, skipped_sessions, errors


def _parse_markdown_session(content: str):
    lines = content.splitlines()
    title = "Imported Chat"
    model = None
    created_at = None
    updated_at = None
    messages = []  # list of (role, content, timestamp_str)
    idx = 0
    if lines and lines[0].startswith("# "):
        title = lines[0][2:].strip() or title
        idx = 1
    # header fields
    for line in lines[idx:]:
        m = re.match(r"^\*\*Model:\*\*\s*(.*)$", line.strip())
        if m:
            model = m.group(1).strip() or None
            continue
        m = re.match(r"^\*\*Created:\*\*\s*(.*)$", line.strip())
        if m:
            created_at = m.group(1).strip() or None
            continue
        m = re.match(r"^\*\*Updated:\*\*\s*(.*)$", line.strip())
        if m:
            updated_at = m.group(1).strip() or None
            continue

    # message sections
    current_role = None
    current_ts = None
    current_lines = []

    def flush():
        nonlocal current_role, current_ts, current_lines
        if current_role is not None:
            text = "\n".join(current_lines).strip()
            messages.append((current_role, text, current_ts))
        current_role = None
        current_ts = None
        current_lines = []

    for line in lines:
        m = re.match(r"^##\s+(\w+)\s*\(([^)]*)\)\s*$", line.strip())
        if m:
            flush()
            current_role = m.group(1).strip().lower()
            current_ts = m.group(2).strip()
            current_lines = []
            continue
        if current_role is not None:
            s = line.rstrip()
            stripped = s.strip()
            if stripped == "---":
                continue
            if stripped.startswith("> "):
                current_lines.append(stripped[2:])
            elif stripped.startswith(">"):
                current_lines.append(stripped[1:])
            else:
                # ignore stray non-content lines inside a section
                if stripped:
                    current_lines.append(stripped)
    flush()

    # normalize roles
    norm_messages = []
    for role, text, ts in messages:
        if role not in ("user", "assistant", "system"):
            role = "assistant"
        norm_messages.append((role, text, ts))
    return title, model, created_at, updated_at, norm_messages


def import_from_markdown(content: str, db: Session, user_id: int, overwrite: bool = False, skip_duplicates: bool = True) -> tuple[int, int, int, List[str]]:
    """Import a single markdown chat transcript."""
    from ..models.chat import ChatSession, ChatMessage
    imported_sessions = 0
    imported_messages = 0
    skipped_sessions = 0
    errors = []
    try:
        title, model, created_at, updated_at, messages = _parse_markdown_session(content)
        session = ChatSession(title=title, model_name=model, user_id=user_id)
        if created_at:
            try:
                session.created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            except Exception:
                pass
        if updated_at:
            try:
                session.updated_at = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
            except Exception:
                pass
        db.add(session)
        db.flush()
        for role, text, ts in messages:
            msg = ChatMessage(session_id=session.id, role=role, content=text)
            if ts:
                try:
                    msg.created_at = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                except Exception:
                    pass
            db.add(msg)
        imported_sessions += 1
        imported_messages += len(messages)
    except Exception as e:
        errors.append(str(e))
    db.commit()
    return imported_sessions, imported_messages, skipped_sessions, errors


router = APIRouter(prefix="/export-import", tags=["export-import"])


@router.post("/export", response_model=ExportResponse)
async def export_chats(
    request: ExportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export chat sessions to JSONL, Markdown, or ZIP.

    Always scoped to the caller's own sessions. Admins can pass user_id to
    export someone else's.
    """
    if request.user_id is not None and request.user_id != current_user.id:
        if not current_user.is_admin:
            raise HTTPException(403, "Cannot export another user's chats")

    target_user_id = request.user_id if current_user.is_admin and request.user_id else current_user.id

    query = db.query(ChatSession).filter(ChatSession.user_id == target_user_id)
    
    if request.session_ids:
        query = query.filter(ChatSession.id.in_(request.session_ids))
    
    if request.date_from:
        try:
            date_from = datetime.fromisoformat(request.date_from)
            query = query.filter(ChatSession.created_at >= date_from)
        except ValueError:
            pass
    
    if request.date_to:
        try:
            date_to = datetime.fromisoformat(request.date_to)
            query = query.filter(ChatSession.created_at <= date_to)
        except ValueError:
            pass
    
    sessions = query.all()
    
    if not sessions:
        raise HTTPException(404, "No sessions found to export")
    
    if request.format == "jsonl":
        content = export_to_jsonl(sessions, request.include_messages)
        filename = f"hexallm_chats_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.jsonl"
        return StreamingResponse(
            io.BytesIO(content.encode('utf-8')),
            media_type="application/jsonl",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    
    elif request.format == "markdown":
        # Create zip with markdown files
        zip_content = export_to_zip(sessions, request.include_messages)
        filename = f"hexallm_chats_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.zip"
        return StreamingResponse(
            io.BytesIO(zip_content),
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    
    elif request.format == "zip":
        zip_content = export_to_zip(sessions, request.include_messages)
        filename = f"hexallm_chats_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.zip"
        return StreamingResponse(
            io.BytesIO(zip_content),
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    
    else:
        raise HTTPException(400, "Invalid format. Use jsonl, markdown, or zip")


@router.post("/import", response_model=ImportResult)
async def import_chats(
    file: UploadFile = File(...),
    overwrite: bool = Form(False),
    skip_duplicates: bool = Form(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Import chats from JSONL or ZIP file into the caller's own account."""
    content = await file.read()

    if file.filename.endswith('.jsonl'):
        content_str = content.decode('utf-8')
        imported_sessions, imported_messages, skipped_sessions, errors = import_from_jsonl(
            content_str,
            db,
            current_user.id,
            overwrite=overwrite,
            skip_duplicates=skip_duplicates,
        )
        return ImportResult(
            imported_sessions=imported_sessions,
            imported_messages=imported_messages,
            skipped_sessions=skipped_sessions,
            errors=errors,
        )

    elif file.filename.endswith('.md'):
        content_str = content.decode('utf-8')
        imported_sessions, imported_messages, skipped_sessions, errors = import_from_markdown(
            content_str,
            db,
            current_user.id,
            overwrite=overwrite,
            skip_duplicates=skip_duplicates,
        )
        return ImportResult(
            imported_sessions=imported_sessions,
            imported_messages=imported_messages,
            skipped_sessions=skipped_sessions,
            errors=errors,
        )

    elif file.filename.endswith('.zip'):
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as zf:
                jsonl_members = [m for m in zf.namelist() if m.lower().endswith('.jsonl')]
                md_members = [m for m in zf.namelist() if m.lower().endswith('.md')]
                # Prefer JSONL when present (richer data).
                if jsonl_members:
                    if 'chats.jsonl' in [m.split('/')[-1] for m in jsonl_members]:
                        targets = [next(m for m in jsonl_members if m.split('/')[-1] == 'chats.jsonl')]
                    else:
                        targets = [jsonl_members[0]]
                    use_md = False
                elif md_members:
                    targets = md_members
                    use_md = True
                else:
                    return ImportResult(
                        imported_sessions=0,
                        imported_messages=0,
                        skipped_sessions=0,
                        errors=["ZIP contains no .jsonl or .md file to import"],
                    )
                for target in targets:
                    if target.startswith('/') or '..' in target.split('/'):
                        return ImportResult(
                            imported_sessions=0,
                            imported_messages=0,
                            skipped_sessions=0,
                            errors=["Unsafe entry in archive"],
                        )
                if use_md:
                    total_sessions = 0
                    total_messages = 0
                    total_skipped = 0
                    all_errors = []
                    for target in targets:
                        try:
                            text = zf.read(target).decode('utf-8')
                        except (KeyError, UnicodeDecodeError) as e:
                            all_errors.append(f"{target}: {e}")
                            continue
                        is_, im, sk, errs = import_from_markdown(
                            text, db, current_user.id,
                            overwrite=overwrite, skip_duplicates=skip_duplicates,
                        )
                        total_sessions += is_
                        total_messages += im
                        total_skipped += sk
                        all_errors.extend(f"{target}: {e}" for e in errs)
                    return ImportResult(
                        imported_sessions=total_sessions,
                        imported_messages=total_messages,
                        skipped_sessions=total_skipped,
                        errors=all_errors,
                    )
                content_str = zf.read(targets[0]).decode('utf-8')
        except (zipfile.BadZipFile, KeyError, UnicodeDecodeError) as e:
            return ImportResult(
                imported_sessions=0,
                imported_messages=0,
                skipped_sessions=0,
                errors=[f"Invalid ZIP archive: {e}"],
            )
        imported_sessions, imported_messages, skipped_sessions, errors = import_from_jsonl(
            content_str,
            db,
            current_user.id,
            overwrite=overwrite,
            skip_duplicates=skip_duplicates,
        )
        return ImportResult(
            imported_sessions=imported_sessions,
            imported_messages=imported_messages,
            skipped_sessions=skipped_sessions,
            errors=errors,
        )

    else:
        raise HTTPException(400, "Unsupported file format. Use .jsonl, .md or .zip")


@router.get("/preview/{session_id}")
async def preview_export(
    session_id: int,
    format: str = Query("jsonl", pattern="^(jsonl|markdown)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Preview export for a single session (own sessions only)."""
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(404, "Session not found")

    if session.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "Not authorized to preview this session")

    if format == "jsonl":
        content = export_to_jsonl([session], include_messages=True)
        return Response(content=content, media_type="application/jsonl")
    elif format == "markdown":
        content = session_to_markdown(session)
        return Response(content=content, media_type="text/markdown")
    else:
        raise HTTPException(400, "Invalid format")


# Add the missing import
import io
