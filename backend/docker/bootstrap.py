from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

from sqlalchemy import func, select, text
from sqlalchemy.exc import OperationalError


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
for path in (BACKEND_ROOT, REPO_ROOT):
    path_str = str(path)
    if path_str not in sys.path:
        sys.path.insert(0, path_str)

import db.models  # noqa: F401
from db.session import SessionLocal
from modules.contractor.models import Contractor
from modules.invoices.models import Invoice
from modules.part_master.models import PartMaster
from modules.users.model import User
from modules.work_orders.models import WorkOrder


def _bool_env(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _run(cmd: list[str], *, cwd: Path | None = None) -> None:
    print(f"+ {' '.join(cmd)}", flush=True)
    subprocess.run(cmd, cwd=str(cwd or REPO_ROOT), check=True)


def wait_for_db(timeout_seconds: int = 90) -> None:
    deadline = time.time() + timeout_seconds
    last_error: Exception | None = None
    while time.time() < deadline:
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
            print("Database is ready.", flush=True)
            return
        except OperationalError as exc:
            last_error = exc
            time.sleep(2)
        finally:
            db.close()
    raise RuntimeError(f"Database did not become ready within {timeout_seconds}s") from last_error


def run_migrations() -> None:
    _run(["alembic", "-c", str(BACKEND_ROOT / "alembic.ini"), "upgrade", "head"])


def ensure_superuser_if_needed() -> None:
    db = SessionLocal()
    try:
        user_count = int(db.scalar(select(func.count()).select_from(User)) or 0)
    finally:
        db.close()

    if user_count > 0:
        print("Users already exist. Skipping superuser bootstrap.", flush=True)
        return

    email = os.environ.get("SUPERUSER_EMAIL", "admin@example.com").strip()
    password = os.environ.get("SUPERUSER_PASSWORD", "Admin123!").strip()
    username = os.environ.get("SUPERUSER_USERNAME", "admin").strip()
    full_name = os.environ.get("SUPERUSER_FULL_NAME", "Ultra Admin").strip()
    phone = os.environ.get("SUPERUSER_PHONE", "+10000000001").strip()

    print("No users found. Creating bootstrap superuser.", flush=True)
    _run(
        [
            sys.executable,
            str(REPO_ROOT / "create_superuser.py"),
            "--email",
            email,
            "--password",
            password,
            "--username",
            username,
            "--full-name",
            full_name,
            "--phone",
            phone,
        ]
    )


def seed_demo_data_if_empty() -> None:
    if not _bool_env("AUTO_SEED_DEMO_DATA", True):
        print("AUTO_SEED_DEMO_DATA is disabled. Skipping demo seed.", flush=True)
        return

    db = SessionLocal()
    try:
        contractor_count = int(db.scalar(select(func.count()).select_from(Contractor)) or 0)
        part_master_count = int(db.scalar(select(func.count()).select_from(PartMaster)) or 0)
        work_order_count = int(db.scalar(select(func.count()).select_from(WorkOrder)) or 0)
        invoice_count = int(db.scalar(select(func.count()).select_from(Invoice)) or 0)
    finally:
        db.close()

    if any(count > 0 for count in (contractor_count, part_master_count, work_order_count, invoice_count)):
        print(
            "Business data already exists. Skipping demo seed "
            f"(contractors={contractor_count}, parts={part_master_count}, work_orders={work_order_count}, invoices={invoice_count}).",
            flush=True,
        )
        return

    print("Database business tables are empty. Running status-matrix demo seed.", flush=True)
    _run([sys.executable, str(REPO_ROOT / "scripts/seed_demo_status_matrix.py")])


def seed_demo_access_matrix() -> None:
    if not _bool_env("AUTO_SEED_DEMO_ACCESS_MATRIX", True):
        print("AUTO_SEED_DEMO_ACCESS_MATRIX is disabled. Skipping demo access-matrix seed.", flush=True)
        return

    password = os.environ.get("DEMO_USER_PASSWORD", "DemoPass123!").strip()
    print("Applying demo access-matrix roles/users/workflows.", flush=True)
    _run(
        [
            sys.executable,
            str(REPO_ROOT / "scripts/seed_demo_access_matrix.py"),
            "--password",
            password,
        ]
    )


def main() -> None:
    wait_for_db()
    run_migrations()
    ensure_superuser_if_needed()
    seed_demo_data_if_empty()
    seed_demo_access_matrix()


if __name__ == "__main__":
    main()
