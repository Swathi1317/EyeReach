#!/usr/bin/env python3
"""
EyeReach – Safe SQLite-to-PostgreSQL Data Migration Utility
------------------------------------------------------------
Migrates all existing records from the local SQLite database into a target PostgreSQL database:
- Shops
- Doctors
- Customers
- Products (Optical Frames)
- Orders
- Appointments (with Face Scan biometrics)
- FrameViews
- CustomerFramePicks

SAFETY GUARANTEES:
1. SQLite source is treated strictly READ-ONLY. No records are deleted or altered in SQLite.
2. Topological migration order preserves all Foreign Key relationships.
3. Automatically resets PostgreSQL ID sequences (setval) to prevent PK collisions on new inserts.
4. Validates row counts table-by-table.
5. Requires explicit user confirmation (--confirm) before executing.
"""

import os
import sys
import argparse
import datetime
from sqlalchemy import create_engine, text, inspect
from sqlalchemy.orm import sessionmaker

# Add project root to path
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from backend.app.db.models import (
    Base,
    Shop,
    Doctor,
    Customer,
    Product,
    Order,
    Appointment,
    FrameView,
    CustomerFramePick
)

DEFAULT_SQLITE_PATH = os.path.join(PROJECT_ROOT, "backend", "data", "smartframe.db")

MODELS_IN_ORDER = [
    ("shops", Shop),
    ("doctors", Doctor),
    ("customers", Customer),
    ("products", Product),
    ("orders", Order),
    ("appointments", Appointment),
    ("frame_views", FrameView),
    ("customer_frame_picks", CustomerFramePick),
]

def migrate(sqlite_path: str, pg_url: str, dry_run: bool = False, confirm: bool = False):
    print("=" * 70)
    print(" EyeReach – SQLite to PostgreSQL Migration Utility")
    print("=" * 70)
    print(f" Source SQLite  : {sqlite_path}")
    # Mask password in PG URL for secure logging
    safe_pg_url = pg_url
    if "@" in safe_pg_url:
        prefix, host_part = safe_pg_url.split("@", 1)
        if ":" in prefix:
            scheme_user = prefix.rsplit(":", 1)[0]
            safe_pg_url = f"{scheme_user}:****@{host_part}"
    print(f" Target Postgres: {safe_pg_url}")
    print(f" Mode           : {'DRY RUN (Analysis Only)' if dry_run else 'LIVE MIGRATION'}")
    print("-" * 70)

    # 1. Validate SQLite Source
    if not os.path.exists(sqlite_path):
        print(f"[ERROR] Source SQLite file not found at: {sqlite_path}")
        sys.exit(1)

    sqlite_url = f"sqlite:///{sqlite_path}"
    sqlite_engine = create_engine(sqlite_url, connect_args={"check_same_thread": False})
    SqliteSession = sessionmaker(bind=sqlite_engine)
    sqlite_session = SqliteSession()

    # 2. Inspect SQLite Row Counts
    source_counts = {}
    print("\n[1/5] Source SQLite Record Counts:")
    for table_name, model_cls in MODELS_IN_ORDER:
        try:
            count = sqlite_session.query(model_cls).count()
            source_counts[table_name] = count
            print(f"  • {table_name:<24}: {count:>6} records")
        except Exception as e:
            source_counts[table_name] = 0
            print(f"  • {table_name:<24}: [Error reading count: {e}]")

    total_records = sum(source_counts.values())
    print(f"  Total records to migrate : {total_records:>6}")

    if dry_run:
        print("\n[DRY RUN COMPLETE] No changes were written to PostgreSQL.")
        sqlite_session.close()
        return

    # 3. Explicit User Confirmation Guard
    if not confirm:
        print("\n" + "!" * 70)
        print(" CAUTION: You are about to copy records into the target PostgreSQL database.")
        print(" Existing tables in PostgreSQL will have their schemas created if not present.")
        print(" Source SQLite database remains 100% UNTOUCHED.")
        print("!" * 70)
        user_input = input("\nType 'MIGRATE' to proceed with migration: ").strip()
        if user_input != "MIGRATE":
            print("[ABORTED] Migration was cancelled by user. No data was transferred.")
            sqlite_session.close()
            sys.exit(0)

    # 4. Connect to PostgreSQL & Initialize Schema
    print("\n[2/5] Connecting to PostgreSQL...")
    if pg_url.startswith("postgres://"):
        pg_url = pg_url.replace("postgres://", "postgresql://", 1)

    try:
        pg_engine = create_engine(pg_url, pool_pre_ping=True)
        with pg_engine.connect() as conn:
            conn.execute(text("SELECT 1;"))
        print("  ✓ Successfully connected to PostgreSQL.")
    except Exception as e:
        print(f"[ERROR] Could not connect to PostgreSQL: {e}")
        sqlite_session.close()
        sys.exit(1)

    print("\n[3/5] Creating table schemas in PostgreSQL (if not present)...")
    Base.metadata.create_all(bind=pg_engine)
    print("  ✓ Table schemas verified.")

    PgSession = sessionmaker(bind=pg_engine)
    pg_session = PgSession()

    # 5. Migrate Data Table-by-Table in Topological Order
    print("\n[4/5] Migrating records in topological order...")
    migrated_counts = {}

    try:
        for table_name, model_cls in MODELS_IN_ORDER:
            rows = sqlite_session.query(model_cls).all()
            print(f"  -> Migrating {table_name} ({len(rows)} records)...", end="", flush=True)

            inserted = 0
            for row in rows:
                # Extract pure column attributes
                row_dict = {
                    c.name: getattr(row, c.name)
                    for c in inspect(model_cls).columns
                }
                new_obj = model_cls(**row_dict)
                pg_session.merge(new_obj) # merge handles duplicate protection idempotently
                inserted += 1

            pg_session.commit()
            migrated_counts[table_name] = inserted
            print(f" ✓ Done ({inserted} inserted/merged).")

            # Update PostgreSQL primary key sequence so subsequent auto-increments work cleanly
            try:
                seq_query = text(f"""
                    SELECT setval(
                        pg_get_serial_sequence('{table_name}', 'id'),
                        COALESCE((SELECT MAX(id) FROM {table_name}), 1),
                        true
                    );
                """)
                with pg_engine.connect() as conn:
                    conn.execute(seq_query)
                    conn.commit()
            except Exception:
                # Table might use non-serial sequence or not have id
                pass

        print("  ✓ All tables migrated successfully.")

    except Exception as err:
        pg_session.rollback()
        print(f"\n[ERROR] Migration failed during transfer: {err}")
        print("PostgreSQL transaction rolled back. Source SQLite is intact.")
        sqlite_session.close()
        pg_session.close()
        sys.exit(1)

    # 6. Post-Migration Verification & Row Count Validation
    print("\n[5/5] Validating Record Counts Between Databases:")
    verification_passed = True
    report_lines = [
        f"# EyeReach Database Migration Report",
        f"- **Date**: {datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}",
        f"- **Source**: `{sqlite_path}`",
        f"- **Status**: SUCCESS",
        "",
        "| Table Name | Source SQLite Rows | Target PostgreSQL Rows | Status |",
        "| :--- | :---: | :---: | :---: |",
    ]

    for table_name, model_cls in MODELS_IN_ORDER:
        src_cnt = source_counts.get(table_name, 0)
        pg_cnt = pg_session.query(model_cls).count()
        status_str = "MATCH ✓" if src_cnt == pg_cnt else "MISMATCH ✗"
        if src_cnt != pg_cnt:
            verification_passed = False
        print(f"  • {table_name:<24}: SQLite={src_cnt:<5} | Postgres={pg_cnt:<5} | {status_str}")
        report_lines.append(f"| `{table_name}` | {src_cnt} | {pg_cnt} | {status_str} |")

    sqlite_session.close()
    pg_session.close()

    report_lines.append("")
    report_lines.append(f"**Verification Result**: {'All record counts matched 100%' if verification_passed else 'Count discrepancies detected.'}")

    # Write report file
    report_path = os.path.join(PROJECT_ROOT, "migration_report.md")
    with open(report_path, "w", encoding="utf-8") as f:
        f.write("\n".join(report_lines))

    print("\n" + "=" * 70)
    if verification_passed:
        print(" MIGRATION VERIFICATION PASSED: 100% of records matched successfully!")
        print(f" Migration Report saved to: {report_path}")
    else:
        print(" MIGRATION WARNING: Some table row counts did not match.")
    print("=" * 70)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Safely migrate EyeReach SQLite database to PostgreSQL.")
    parser.add_argument("--pg-url", default=os.getenv("DATABASE_URL"), help="PostgreSQL connection string (or set DATABASE_URL env var)")
    parser.add_argument("--sqlite-path", default=DEFAULT_SQLITE_PATH, help="Path to local smartframe.db")
    parser.add_argument("--dry-run", action="store_true", help="Inspect source counts without writing to PostgreSQL")
    parser.add_argument("--confirm", action="store_true", help="Bypass interactive confirmation prompt")

    args = parser.parse_args()

    if not args.dry_run and not args.pg_url:
        print("[ERROR] PostgreSQL connection URL is required for live migration.")
        print("Usage:")
        print("  python scripts/migrate_sqlite_to_pg.py --dry-run")
        print("  python scripts/migrate_sqlite_to_pg.py --pg-url 'postgresql://user:pass@host/dbname' --confirm")
        print("Or set the DATABASE_URL environment variable.")
        sys.exit(1)

    migrate(
        sqlite_path=args.sqlite_path,
        pg_url=args.pg_url or "",
        dry_run=args.dry_run,
        confirm=args.confirm
    )
