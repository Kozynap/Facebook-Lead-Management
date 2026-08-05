"""Parses uploaded ZIP files of Facebook Lead Ads exports.

Each ZIP contains one folder per ad, each folder holding one export file
(CSV or XLSX) with the same 16-column schema. Files observed in the wild
are UTF-16LE tab-delimited CSVs with a ".csv" extension, but this module
also copes with UTF-8 CSVs and true .xlsx files, and with minor header
variations (e.g. "phone" vs "phone_number", missing "street_address").
"""

import csv
import io
import os
import zipfile
from datetime import datetime

import db

SUPPORTED_EXTENSIONS = (".csv", ".tsv", ".txt", ".xlsx", ".xls")

# Canonical field -> accepted header aliases (checked case-insensitively).
HEADER_ALIASES = {
    "id": ["id"],
    "created_time": ["created_time", "created time"],
    "ad_id": ["ad_id"],
    "ad_name": ["ad_name"],
    "adset_id": ["adset_id"],
    "adset_name": ["adset_name"],
    "campaign_id": ["campaign_id"],
    "campaign_name": ["campaign_name"],
    "form_id": ["form_id"],
    "form_name": ["form_name"],
    "is_organic": ["is_organic"],
    "platform": ["platform"],
    "email": ["email"],
    "full_name": ["full_name", "name"],
    "phone": ["phone", "phone_number"],
    "street_address": ["street_address", "address"],
}


def _decode_bytes(data):
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16")
    if data[:3] == b"\xef\xbb\xbf":
        return data.decode("utf-8-sig")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("latin-1")


def _parse_delimited(data):
    text = _decode_bytes(data)
    lines = text.splitlines()
    if not lines:
        return []
    first_line = lines[0]
    delimiter = "\t" if first_line.count("\t") >= first_line.count(",") else ","
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    rows = list(reader)
    if not rows:
        return []
    headers = [h.strip().lstrip("﻿").lower() for h in rows[0]]
    records = []
    for r in rows[1:]:
        if not any(cell.strip() for cell in r):
            continue
        records.append({headers[i]: r[i].strip() for i in range(len(headers)) if i < len(r)})
    return records


def _parse_xlsx(data):
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    ws = wb.worksheets[0]
    rows_iter = ws.iter_rows(values_only=True)
    try:
        header_row = next(rows_iter)
    except StopIteration:
        return []
    headers = [str(h).strip().lower() if h is not None else "" for h in header_row]
    records = []
    for r in rows_iter:
        if r is None or not any(cell not in (None, "") for cell in r):
            continue
        rec = {}
        for i, h in enumerate(headers):
            if not h or i >= len(r):
                continue
            val = r[i]
            rec[h] = "" if val is None else str(val).strip()
        records.append(rec)
    return records


def _normalize_row(raw_row):
    def get(field):
        for alias in HEADER_ALIASES[field]:
            v = raw_row.get(alias)
            if v:
                return v.strip('"')
        return ""

    rec = {field: get(field) for field in HEADER_ALIASES}

    created_time = rec["created_time"]
    created_month = "unknown"
    if created_time:
        try:
            dt = datetime.fromisoformat(created_time)
            created_month = f"{dt.year:04d}-{dt.month:02d}"
        except ValueError:
            pass
    rec["created_month"] = created_month
    return rec


def process_zip(file_bytes, filename, imported_at):
    stats = {"inserted": 0, "updated": 0, "skipped_rows": 0, "files_processed": 0, "errors": []}

    try:
        zf = zipfile.ZipFile(io.BytesIO(file_bytes))
    except zipfile.BadZipFile:
        stats["errors"].append(f"{filename}: not a valid ZIP file")
        return stats

    for name in zf.namelist():
        base = os.path.basename(name)
        if not base or name.endswith("/"):
            continue
        if base.startswith(".") or "__MACOSX" in name:
            continue
        ext = os.path.splitext(base)[1].lower()
        if ext not in SUPPORTED_EXTENSIONS:
            continue

        try:
            raw = zf.read(name)
            if ext in (".xlsx", ".xls"):
                raw_records = _parse_xlsx(raw)
            else:
                raw_records = _parse_delimited(raw)
        except Exception as exc:  # noqa: BLE001 - surface any parse failure per-file
            stats["errors"].append(f"{name}: {exc}")
            continue

        stats["files_processed"] += 1

        for raw_row in raw_records:
            rec = _normalize_row(raw_row)
            if not rec["id"]:
                stats["skipped_rows"] += 1
                continue
            result = db.upsert_lead(rec, imported_at, source_zip=f"{filename}::{name}")
            stats[result] += 1

    zf.close()
    return stats
