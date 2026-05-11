from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path


def save_invoice_attachment(*, invoice_id: int, filename: str, content: bytes) -> str:
    """Save an uploaded invoice attachment, returning a public URL under /uploads/*."""
    safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "_", filename or "attachment")
    root = Path(__file__).resolve().parents[2]  # backend/
    target_dir = root / "uploads" / "invoice_attachments" / str(int(invoice_id))
    target_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    candidate = target_dir / f"{stamp}_{safe_name}"
    candidate.write_bytes(content)
    rel = candidate.relative_to(root / "uploads").as_posix()
    return f"/uploads/{rel}"

