import os
from datetime import datetime

from flask import Flask, jsonify, render_template, request

import db
import importer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")

app = Flask(__name__)
db.init_db()


def _display(iso_str):
    if not iso_str:
        return None
    try:
        dt = datetime.fromisoformat(iso_str)
        return dt.strftime("%d %b %Y, %I:%M %p")
    except ValueError:
        return iso_str


def _asset_version(*rel_parts):
    """File mtime used as a cache-busting query param, so a browser can
    never serve a stale static/js or static/css file against newer HTML."""
    path = os.path.join(BASE_DIR, "static", *rel_parts)
    try:
        return str(int(os.path.getmtime(path)))
    except OSError:
        return "0"


@app.route("/")
def index():
    return render_template(
        "index.html",
        status_options=db.STATUS_OPTIONS,
        css_version=_asset_version("css", "style.css"),
        js_version=_asset_version("js", "app.js"),
    )


@app.route("/api/meta")
def api_meta():
    return jsonify({
        "last_created": _display(db.get_last_created()),
        "last_updated": _display(db.get_meta("last_upload_at")),
        "months": db.get_distinct_months(),
        "campaigns": db.get_distinct_campaigns(),
        "status_options": db.STATUS_OPTIONS,
    })


@app.route("/api/leads")
def api_leads():
    return jsonify(db.get_all_leads())


@app.route("/api/upload", methods=["POST"])
def api_upload():
    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "No files were uploaded."}), 400

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    imported_at = datetime.now().astimezone().isoformat()

    total = {"inserted": 0, "updated": 0, "skipped_rows": 0, "files_processed": 0, "errors": []}
    processed_any = False

    for f in files:
        if not f.filename:
            continue
        if not f.filename.lower().endswith(".zip"):
            total["errors"].append(f"{f.filename}: not a .zip file, skipped")
            continue

        data = f.read()

        safe_name = f"{imported_at.replace(':', '-')}__{os.path.basename(f.filename)}"
        with open(os.path.join(UPLOAD_DIR, safe_name), "wb") as out:
            out.write(data)

        stats = importer.process_zip(data, f.filename, imported_at)
        for key in ("inserted", "updated", "skipped_rows", "files_processed"):
            total[key] += stats[key]
        total["errors"].extend(stats["errors"])
        processed_any = True

    if processed_any:
        db.set_meta("last_upload_at", imported_at)

    return jsonify(total)


@app.route("/api/leads/<path:lead_id>", methods=["PATCH"])
def api_update_lead(lead_id):
    body = request.get_json(force=True, silent=True) or {}
    status = body.get("status")
    remarks = body.get("remarks")

    if status is not None and status not in db.STATUS_OPTIONS:
        return jsonify({"error": "Invalid status value."}), 400

    updated = db.update_lead(lead_id, status=status, remarks=remarks)
    if updated is None:
        return jsonify({"error": "Lead not found."}), 404
    return jsonify(updated)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
