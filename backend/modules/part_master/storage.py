from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path


def save_part_master_attachment(*, part_master_id: int, filename: str, content: bytes) -> str:
    safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "_", filename or "attachment")
    root = Path(__file__).resolve().parents[2]
    target_dir = root / "uploads" / "part_master_attachments" / str(int(part_master_id))
    target_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    candidate = target_dir / f"{stamp}_{safe_name}"
    candidate.write_bytes(content)
    rel = candidate.relative_to(root / "uploads").as_posix()
    return f"/uploads/{rel}"


def save_negotiation_attachment(*, contractor_rate_id: int, round_id: int, filename: str, content: bytes) -> str:
    safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "_", filename or "attachment")
    root = Path(__file__).resolve().parents[2]
    target_dir = root / "uploads" / "negotiation_attachments" / str(int(contractor_rate_id)) / str(int(round_id))
    target_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    candidate = target_dir / f"{stamp}_{safe_name}"
    candidate.write_bytes(content)
    rel = candidate.relative_to(root / "uploads").as_posix()
    return f"/uploads/{rel}"
