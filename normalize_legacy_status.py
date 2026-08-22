"""One-time cleanup: collapse any lead's comma-joined status (left over
from the brief window when per-row status editing was multi-select) down
to a single value - the most-advanced status present, using the same rule
as the app's own display logic (static/js/app.js: primaryStatus).

Run once after deploying: python normalize_legacy_status.py
Safe to run again later - leads that are already single-valued are skipped.
"""
import db


def primary_status(status_value):
    parts = [p.strip() for p in (status_value or "").split(",") if p.strip()]
    for opt in reversed(db.STATUS_OPTIONS):
        if opt in parts:
            return opt
    return db.DEFAULT_STATUS


def main():
    leads = db.get_all_leads()
    changed = 0
    for l in leads:
        if "," in (l["status"] or ""):
            new_status = primary_status(l["status"])
            db.update_lead(l["id"], status=new_status)
            changed += 1
            print(f"{l['id']}: {l['status']!r} -> {new_status!r}")
    print(f"\n{changed} lead(s) normalized out of {len(leads)} total.")


if __name__ == "__main__":
    main()
