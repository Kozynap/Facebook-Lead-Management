"""SQLite persistence layer for Facebook leads.

Leads are keyed by their Facebook lead `id` (Column A). Re-importing a lead
that already exists updates its descriptive fields but never touches
`status` / `remarks` — those are only ever changed by the user in the UI.
"""

import os
import sqlite3
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "leads.db")

STATUS_OPTIONS = [
    "New", "Follow up", "Warm",
    "Home Visit Booked", "Home Visit Done", "Home Visit Done and Paid",
    "Bulk Order", "Cold",
]
DEFAULT_STATUS = "New"

# A lead's `status` column can hold more than one of the above, joined by
# commas (e.g. "Warm,Bulk Order") - the UI sets this via checkboxes rather
# than a single dropdown value.
UNSET = object()


def normalize_status(value, default=None):
    """Dedupe a comma-separated status string and put it in canonical
    STATUS_OPTIONS order, so the same combination always serializes the
    same way. Unrecognised parts are silently dropped; `default` (or
    DEFAULT_STATUS) is returned if nothing valid remains."""
    parts = {p.strip() for p in (value or "").split(",") if p.strip()}
    ordered = [s for s in STATUS_OPTIONS if s in parts]
    if ordered:
        return ",".join(ordered)
    return default if default is not None else DEFAULT_STATUS

# Leads in one of these statuses are the ones that show up in the Home
# Visit tab - membership is driven by the main status, not a separate field.
HV_PIPELINE_STATUSES = ["Home Visit Booked", "Home Visit Done", "Home Visit Done and Paid"]

AREAS = ["North Bengal", "South Bengal", "North East"]

SALES_PERSONS = [
    "Abhishek", "Aditya", "Chinmoy", "Dipankar", "Gourav", "Joydip",
    "Krishna", "Kuldeep", "Madhumita", "Oikantik", "Rajesh", "Sambhu",
    "Samya", "Sarat", "Snehasish", "Sreerup", "Srijita", "Suman",
]

LEAD_FIELDS = [
    "id", "created_time", "created_month",
    "ad_id", "ad_name", "adset_id", "adset_name",
    "campaign_id", "campaign_name", "form_id", "form_name",
    "is_organic", "platform", "email", "full_name", "phone", "street_address",
]

MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def _connect():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    conn = _connect()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS leads (
            id TEXT PRIMARY KEY,
            created_time TEXT,
            created_month TEXT,
            ad_id TEXT,
            ad_name TEXT,
            adset_id TEXT,
            adset_name TEXT,
            campaign_id TEXT,
            campaign_name TEXT,
            form_id TEXT,
            form_name TEXT,
            is_organic TEXT,
            platform TEXT,
            email TEXT,
            full_name TEXT,
            phone TEXT,
            street_address TEXT,
            status TEXT NOT NULL DEFAULT 'New',
            remarks TEXT NOT NULL DEFAULT '',
            attempts INTEGER NOT NULL DEFAULT 0,
            home_visit_status TEXT NOT NULL DEFAULT 'Pending',
            home_visit_date TEXT NOT NULL DEFAULT '',
            sales_person TEXT NOT NULL DEFAULT '',
            status_updated_at TEXT,
            first_imported_at TEXT,
            last_seen_at TEXT,
            source_zip TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS campaign_areas (
            campaign_name TEXT PRIMARY KEY,
            area TEXT NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_leads_month ON leads(created_month)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads(campaign_name)")

    # Migrate older databases created before these columns existed.
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(leads)").fetchall()]
    if "attempts" not in cols:
        conn.execute("ALTER TABLE leads ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0")
    if "home_visit_status" not in cols:
        conn.execute("ALTER TABLE leads ADD COLUMN home_visit_status TEXT NOT NULL DEFAULT 'Pending'")
    if "home_visit_date" not in cols:
        conn.execute("ALTER TABLE leads ADD COLUMN home_visit_date TEXT NOT NULL DEFAULT ''")
    if "sales_person" not in cols:
        conn.execute("ALTER TABLE leads ADD COLUMN sales_person TEXT NOT NULL DEFAULT ''")
    if "sales_value" not in cols:
        conn.execute("ALTER TABLE leads ADD COLUMN sales_value REAL")
    if "model_name" not in cols:
        conn.execute("ALTER TABLE leads ADD COLUMN model_name TEXT NOT NULL DEFAULT ''")

    # "Booked" (an older status value) is now split into the Home Visit
    # pipeline stages - the closest equivalent is "Home Visit Booked".
    conn.execute("UPDATE leads SET status = 'Home Visit Booked' WHERE status = 'Booked'")

    # Normalize every stored status through the same comma-separated,
    # canonically-ordered form normalize_status() produces on save - covers
    # stray values from older schemes (reset to New) as well as rows saved
    # before STATUS_OPTIONS grew to include a newly added status.
    rows = conn.execute("SELECT id, status FROM leads").fetchall()
    for r in rows:
        cleaned = normalize_status(r["status"])
        if cleaned != r["status"]:
            conn.execute("UPDATE leads SET status = ? WHERE id = ?", (cleaned, r["id"]))

    conn.commit()
    conn.close()


def _date_only(created_time):
    """Return the YYYY-MM-DD portion of an ISO created_time, or ''."""
    if not created_time:
        return ""
    try:
        return datetime.fromisoformat(created_time).strftime("%Y-%m-%d")
    except ValueError:
        return created_time[:10]


def month_label(created_month):
    if not created_month or created_month == "unknown":
        return "Unknown"
    try:
        year, month = created_month.split("-")
        return f"{MONTH_NAMES[int(month) - 1]} {year}"
    except (ValueError, IndexError):
        return created_month


def upsert_lead(record, imported_at, source_zip):
    """Insert a new lead, or update an existing one while preserving
    status/remarks. Returns 'inserted' or 'updated'."""
    conn = _connect()
    try:
        cur = conn.execute("SELECT id FROM leads WHERE id = ?", (record["id"],))
        exists = cur.fetchone() is not None

        if exists:
            conn.execute(
                f"""UPDATE leads SET
                    {', '.join(f'{f} = ?' for f in LEAD_FIELDS if f != 'id')},
                    last_seen_at = ?,
                    source_zip = ?
                WHERE id = ?""",
                [record[f] for f in LEAD_FIELDS if f != "id"]
                + [imported_at, source_zip, record["id"]],
            )
            result = "updated"
        else:
            fields = LEAD_FIELDS + [
                "status", "remarks", "attempts",
                "home_visit_date", "sales_person", "status_updated_at",
                "first_imported_at", "last_seen_at", "source_zip",
            ]
            values = [record[f] for f in LEAD_FIELDS] + [
                DEFAULT_STATUS, "", 0,
                "", "", None, imported_at, imported_at, source_zip,
            ]
            placeholders = ", ".join("?" for _ in fields)
            conn.execute(
                f"INSERT INTO leads ({', '.join(fields)}) VALUES ({placeholders})",
                values,
            )
            result = "inserted"

        conn.commit()
        return result
    finally:
        conn.close()


def get_all_leads():
    conn = _connect()
    try:
        rows = conn.execute("""
            SELECT leads.id, leads.created_time, leads.created_month,
                   leads.ad_name, leads.campaign_name,
                   leads.email, leads.full_name, leads.phone, leads.street_address,
                   leads.status, leads.remarks, leads.attempts,
                   leads.home_visit_date, leads.sales_person,
                   leads.sales_value, leads.model_name,
                   campaign_areas.area AS area
            FROM leads
            LEFT JOIN campaign_areas ON leads.campaign_name = campaign_areas.campaign_name
            ORDER BY leads.created_time DESC
        """).fetchall()
        leads = []
        for r in rows:
            d = dict(r)
            d["created_month_label"] = month_label(d["created_month"])
            d["created_date"] = _date_only(d["created_time"])
            leads.append(d)
        return leads
    finally:
        conn.close()


def update_lead(lead_id, status=None, remarks=None, home_visit_date=None,
                sales_person=None, increment_attempts=False, decrement_attempts=False,
                sales_value=UNSET, model_name=None):
    """Update status/remarks/home-visit-date/sales-person/sales-value/model
    for a lead. `attempts` is a manual counter: it only moves when
    increment_attempts or decrement_attempts is True (the user clicked the
    "+"/"-" button), never automatically on a status change, and never
    drops below zero. `sales_value` defaults to the UNSET sentinel (rather
    than None) so a caller can still explicitly clear it to NULL by
    passing None."""
    conn = _connect()
    try:
        row = conn.execute("SELECT * FROM leads WHERE id = ?", (lead_id,)).fetchone()
        if row is None:
            return None

        sets, values = [], []
        if status is not None and status != row["status"]:
            sets.append("status = ?")
            values.append(status)
            sets.append("status_updated_at = ?")
            values.append(datetime.now().astimezone().isoformat())
        if remarks is not None:
            sets.append("remarks = ?")
            values.append(remarks)
        if home_visit_date is not None:
            sets.append("home_visit_date = ?")
            values.append(home_visit_date)
        if sales_person is not None:
            sets.append("sales_person = ?")
            values.append(sales_person)
        if model_name is not None:
            sets.append("model_name = ?")
            values.append(model_name)
        if sales_value is not UNSET:
            sets.append("sales_value = ?")
            values.append(sales_value)
        if increment_attempts:
            sets.append("attempts = attempts + 1")
        if decrement_attempts:
            sets.append("attempts = MAX(attempts - 1, 0)")

        if sets:
            values.append(lead_id)
            conn.execute(f"UPDATE leads SET {', '.join(sets)} WHERE id = ?", values)
            conn.commit()

        row = conn.execute(
            "SELECT id, status, remarks, attempts, home_visit_date, sales_person, "
            "sales_value, model_name FROM leads WHERE id = ?", (lead_id,)
        ).fetchone()
        return dict(row)
    finally:
        conn.close()


def get_meta(key, default=None):
    conn = _connect()
    try:
        row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default
    finally:
        conn.close()


def set_meta(key, value):
    conn = _connect()
    try:
        conn.execute(
            "INSERT INTO meta (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
        conn.commit()
    finally:
        conn.close()


def get_last_created():
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT MAX(created_time) AS latest FROM leads WHERE created_time != ''"
        ).fetchone()
        return row["latest"] if row else None
    finally:
        conn.close()


def get_distinct_months():
    conn = _connect()
    try:
        rows = conn.execute("""
            SELECT DISTINCT created_month FROM leads
            WHERE created_month IS NOT NULL AND created_month != ''
            ORDER BY created_month DESC
        """).fetchall()
        return [
            {"value": r["created_month"], "label": month_label(r["created_month"])}
            for r in rows
        ]
    finally:
        conn.close()


def get_campaigns_with_area():
    """All campaigns seen in leads, with their lead count and the area
    they're currently mapped to (None if not yet assigned)."""
    conn = _connect()
    try:
        rows = conn.execute("""
            SELECT leads.campaign_name AS name, COUNT(*) AS cnt,
                   campaign_areas.area AS area
            FROM leads
            LEFT JOIN campaign_areas ON leads.campaign_name = campaign_areas.campaign_name
            WHERE leads.campaign_name IS NOT NULL AND leads.campaign_name != ''
            GROUP BY leads.campaign_name
            ORDER BY leads.campaign_name COLLATE NOCASE
        """).fetchall()
        return [{"name": r["name"], "count": r["cnt"], "area": r["area"]} for r in rows]
    finally:
        conn.close()


def get_area_counts():
    """Lead count per fixed area (0 if nothing mapped to it yet)."""
    conn = _connect()
    try:
        rows = conn.execute("""
            SELECT campaign_areas.area AS area, COUNT(*) AS cnt
            FROM leads
            JOIN campaign_areas ON leads.campaign_name = campaign_areas.campaign_name
            GROUP BY campaign_areas.area
        """).fetchall()
        counts = {r["area"]: r["cnt"] for r in rows}
        return [{"name": a, "count": counts.get(a, 0)} for a in AREAS]
    finally:
        conn.close()


def get_unassigned_campaign_count():
    conn = _connect()
    try:
        row = conn.execute("""
            SELECT COUNT(DISTINCT leads.campaign_name) AS cnt
            FROM leads
            LEFT JOIN campaign_areas ON leads.campaign_name = campaign_areas.campaign_name
            WHERE campaign_areas.area IS NULL
              AND leads.campaign_name IS NOT NULL AND leads.campaign_name != ''
        """).fetchone()
        return row["cnt"]
    finally:
        conn.close()


def set_campaign_area(campaign_name, area):
    """Assign a campaign to an area, or unassign it if area is falsy."""
    conn = _connect()
    try:
        if area:
            conn.execute(
                "INSERT INTO campaign_areas (campaign_name, area) VALUES (?, ?) "
                "ON CONFLICT(campaign_name) DO UPDATE SET area = excluded.area",
                (campaign_name, area),
            )
        else:
            conn.execute("DELETE FROM campaign_areas WHERE campaign_name = ?", (campaign_name,))
        conn.commit()
    finally:
        conn.close()
