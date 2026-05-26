"""
Thin email sender. Uses SMTP when configured; falls back to logging the
reset link to stdout so dev/self-hosted installs still work without mail.
"""

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from ..core.config import settings

logger = logging.getLogger(__name__)


def _smtp_configured() -> bool:
    return bool(settings.SMTP_HOST and settings.SMTP_USER and settings.SMTP_PASSWORD)


def send_password_reset(to_email: str, reset_url: str, username: str) -> None:
    subject = "Reset your NebulaX AI password"
    html = f"""
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#0f172a;color:#e2e8f0;padding:32px;">
  <div style="max-width:480px;margin:auto;background:#1e293b;border-radius:12px;padding:32px;">
    <h2 style="color:#a78bfa;margin-top:0;">NebulaX AI</h2>
    <p>Hi <strong>{username}</strong>,</p>
    <p>We received a request to reset your password. Click the button below — this link expires in <strong>1 hour</strong>.</p>
    <a href="{reset_url}"
       style="display:inline-block;margin:16px 0;padding:12px 24px;background:#7c3aed;
              color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">
      Reset Password
    </a>
    <p style="color:#94a3b8;font-size:13px;">
      If you didn't request this, ignore this email — your password won't change.<br>
      Or copy this link: <a href="{reset_url}" style="color:#a78bfa;">{reset_url}</a>
    </p>
  </div>
</body>
</html>"""

    plain = (
        f"Hi {username},\n\n"
        f"Reset your NebulaX AI password (expires in 1 hour):\n{reset_url}\n\n"
        "If you didn't request this, ignore this email."
    )

    if not _smtp_configured():
        logger.warning("SMTP not configured — password reset link for %s: %s", to_email, reset_url)
        print(f"\n[NebulaX] Password reset link for {to_email}:\n  {reset_url}\n", flush=True)
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to_email
    msg.attach(MIMEText(plain, "plain"))
    msg.attach(MIMEText(html, "html"))

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
            server.ehlo()
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.SMTP_FROM, to_email, msg.as_string())
        logger.info("Password reset email sent to %s", to_email)
    except Exception as exc:
        logger.error("Failed to send reset email to %s: %s", to_email, exc)
        print(f"\n[NebulaX] SMTP failed — reset link for {to_email}:\n  {reset_url}\n", flush=True)
        raise
