"""
Fast Batched SharePoint VMS Synchronizer (OAuth2 Bearer Token - No Cookies)
--------------------------------------------------------------------------
Syncs newly merged backup data from SQL Server [SeaZen_AccessControl] to the
18 SeaPoint lists under https://seazenvn.sharepoint.com/sites/ONESEAZEN using
connection-pooled HTTPS sessions and bounded worker concurrency:

- 100% OAuth2 Bearer Token via SEAZENHR-PORTAL (no FedAuth/rtFa cookies).
- Uploads missing biometric JPEG portraits (AttachmentFiles/add) for active staff.
- Respects SharePoint 5,000-item List View safety ceiling for high-volume log/timekeeping lists:
  * tbl_Employees & tbl_EmployeeBiometrics: 100% of active staff (max_rows=500)
  * tbl_Visitors: 100% of records in tbl_Visitors (max_rows=2000)
  * tbl_DailyTimekeeping: latest 3,200 rows (keeps list safely below 5,000 limit)
  * tbl_AttendanceLogs: latest 1,500 scans (keeps list safely below 5,000 limit)
"""

import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
import logging
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

import pyodbc
import requests

import db_mssql
import sharepoint_vms_sync as sp

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("sync_sharepoint_backup")

_TL = threading.local()


def _session() -> requests.Session:
    s = getattr(_TL, "sess", None)
    if s is None:
        s = requests.Session()
        adapter = requests.adapters.HTTPAdapter(pool_connections=8, pool_maxsize=8)
        s.mount("https://", adapter)
        _TL.sess = s
    return s


class _TokenState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.sp_token = ""
        self.digest = ""
        self.last_refresh = 0.0
        self.refresh()

    def refresh(self) -> None:
        with self.lock:
            tok = sp.get_sharepoint_tokens()
            if not tok.get("ok"):
                raise RuntimeError(f"SharePoint OAuth2 failed: {tok.get('error')}")
            self.sp_token = tok["sp_token"]
            ctx = requests.post(
                f"{sp.SP_SITE_URL}/_api/contextinfo",
                headers={"Authorization": f"Bearer {self.sp_token}", "Accept": "application/json;odata=nometadata"},
                timeout=10,
            )
            self.digest = ctx.json().get("FormDigestValue", "") if ctx.status_code == 200 else ""
            self.last_refresh = time.time()

    def ensure_fresh(self) -> Tuple[str, str]:
        if time.time() - self.last_refresh > 900:
            self.refresh()
        return self.sp_token, self.digest


def _fetch_existing_keys(state: _TokenState, sql_table: str, list_id: str) -> Dict[str, Dict[str, Any]]:
    tok, _ = state.ensure_fresh()
    select_fields = ["Id", "Title"]
    if sql_table == "tbl_AttendanceLogs":
        select_fields.extend(["MaChamCongATID", "ThoiGianQuet"])
    elif sql_table == "tbl_DailyTimekeeping":
        select_fields.extend(["NgayLamViec", "MaChamCongATID", "TongSoLanQuet", "GioRaCuoiCung"])
    elif sql_table == "tbl_DoorAuditLogs":
        select_fields.extend(["HanhDong", "MaCua", "ThoiGianThaoTac"])

    existing: Dict[str, Dict[str, Any]] = {}
    url: Optional[str] = (
        f"{sp.SP_SITE_URL}/_api/web/lists(guid'{list_id}')/items"
        f"?$select={','.join(select_fields)}&$top=5000&$orderby=Id desc"
    )
    headers = {"Authorization": f"Bearer {tok}", "Accept": "application/json;odata=nometadata"}
    while url:
        r = _session().get(url, headers=headers, timeout=20)
        if r.status_code != 200:
            logger.warning("Fetch existing warning (%s): HTTP %s", sql_table, r.status_code)
            break
        body = r.json()
        for it in body.get("value", []):
            if it.get("Title") is not None:
                existing.setdefault(str(it["Title"]).strip(), it)
            if sql_table == "tbl_AttendanceLogs":
                s_atid = str(it.get("MaChamCongATID") or "").strip()
                s_ts = str(it.get("ThoiGianQuet") or "").replace("T", " ").strip()[:19]
                if s_atid and s_ts:
                    existing.setdefault(f"{s_atid}_{s_ts}", it)
            elif sql_table == "tbl_DailyTimekeeping":
                s_wd = str(it.get("NgayLamViec") or "")[:10]
                s_atid = str(it.get("MaChamCongATID") or "").strip()
                if s_wd and s_atid:
                    existing.setdefault(f"{s_wd}_{s_atid}", it)
            elif sql_table == "tbl_DoorAuditLogs":
                s_act = str(it.get("HanhDong") or "").strip()
                s_did = str(it.get("MaCua") or "0").strip()
                s_ts = str(it.get("ThoiGianThaoTac") or "").replace("T", " ").strip()[:19]
                if s_act and s_ts:
                    existing.setdefault(f"{s_act}_D{s_did}_{s_ts}", it)
        url = body.get("odata.nextLink")
        if url and not url.startswith("http"):
            url = f"{sp.SP_SITE_URL}/_api/{url.lstrip('/')}"
        # Safety break around 6000 items to keep pagination bounded
        if len(existing) >= 6000:
            break
    return existing


def _build_payload(meta: Dict[str, Any], unique_key: str, row: Dict[str, Any]) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"Title": unique_key[:250]}
    for col in meta["columns"]:
        raw_val = row.get(col["sql"])
        if raw_val is None:
            continue
        c_type = col["type"]
        if c_type == "boolean":
            payload[col["internal"]] = bool(raw_val)
        elif c_type == "number":
            try:
                payload[col["internal"]] = float(raw_val) if "." in str(raw_val) else int(raw_val)
            except Exception:
                payload[col["internal"]] = 0
        elif c_type == "note":
            payload[col["internal"]] = str(raw_val)[:8000]
        else:
            payload[col["internal"]] = str(raw_val)[:250]
    return payload


def _sp_upsert_one(
    state: _TokenState,
    list_id: str,
    sp_item_id: Optional[int],
    payload: Dict[str, Any],
) -> Tuple[str, Optional[int], Optional[str]]:
    """Returns ('inserted'|'updated'|'error', created_or_id, error_msg)."""
    for attempt in range(4):
        tok, digest = state.ensure_fresh()
        headers = {
            "Authorization": f"Bearer {tok}",
            "Accept": "application/json;odata=nometadata",
            "Content-Type": "application/json;odata=nometadata",
            "X-RequestDigest": digest,
        }
        try:
            if sp_item_id is not None:
                resp = _session().post(
                    f"{sp.SP_SITE_URL}/_api/web/lists(guid'{list_id}')/items({sp_item_id})",
                    headers={**headers, "X-HTTP-Method": "MERGE", "If-Match": "*"},
                    json=payload,
                    timeout=15,
                )
                if resp.status_code in (200, 204):
                    return "updated", sp_item_id, None
            else:
                resp = _session().post(
                    f"{sp.SP_SITE_URL}/_api/web/lists(guid'{list_id}')/items",
                    headers=headers,
                    json=payload,
                    timeout=15,
                )
                if resp.status_code in (200, 201):
                    created_id = (resp.json() if resp.text else {}).get("Id")
                    return "inserted", created_id, None

            if resp.status_code in (429, 503):
                retry_after = float(resp.headers.get("Retry-After") or (1.5 * (attempt + 1)))
                time.sleep(min(retry_after, 10.0))
                continue
            if resp.status_code == 403 and "request digest" in resp.text.lower():
                state.refresh()
                continue
            return "error", None, f"HTTP {resp.status_code}: {resp.text[:160]}"
        except Exception as exc:
            if attempt < 3:
                time.sleep(0.5 * (attempt + 1))
                continue
            return "error", None, str(exc)
    return "error", None, "max retries exceeded"


def fast_sync_table(
    state: _TokenState,
    sql_table: str,
    max_rows: int,
    skip_existing: bool = False,
    workers: int = 4,
) -> Dict[str, Any]:
    meta = sp.VMS_SHAREPOINT_LIST_SCHEMAS[sql_table]
    list_id = sp._SP_KNOWN_LIST_IDS[sql_table]
    existing_by_key = _fetch_existing_keys(state, sql_table, list_id)
    rows = db_mssql.get_table_rows(sql_table, limit=max_rows)

    tasks: List[Tuple[str, Optional[int], Dict[str, Any]]] = []
    seen_batch_keys = set()
    skipped = 0

    for row in rows:
        ukey = sp._build_sp_unique_key(sql_table, row)
        if not ukey or ukey in seen_batch_keys:
            continue
        seen_batch_keys.add(ukey)

        ex = existing_by_key.get(ukey)
        if ex:
            if skip_existing or sql_table in (
                "tbl_AttendanceLogs", "tbl_DoorAuditLogs", "tbl_DeviceCommands", "tbl_ClockSyncAuditLogs"
            ):
                skipped += 1
                continue
            if sql_table == "tbl_DailyTimekeeping":
                sp_scans = int(ex.get("TongSoLanQuet") or 0)
                sp_out = str(ex.get("GioRaCuoiCung") or "")
                cur_scans = int(row.get("TotalScans") or 0)
                cur_out = str(row.get("LastOutTime") or "")
                if sp_scans == cur_scans and sp_out == cur_out:
                    skipped += 1
                    continue

        payload = _build_payload(meta, ukey, row)
        tasks.append((ukey, ex["Id"] if ex else None, payload))

    inserted = 0
    updated = 0
    errors = 0
    sample_errs: List[str] = []

    if tasks:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futs = [pool.submit(_sp_upsert_one, state, list_id, item_id, payload) for _uk, item_id, payload in tasks]
            for fut in as_completed(futs):
                status, _id, err = fut.result()
                if status == "inserted":
                    inserted += 1
                elif status == "updated":
                    updated += 1
                else:
                    errors += 1
                    if err and len(sample_errs) < 3:
                        sample_errs.append(err)

    logger.info(
        "  [%s] rows=%d skipped=%d inserted=%d updated=%d errors=%d %s",
        sql_table, len(rows), skipped, inserted, updated, errors,
        f"errs={sample_errs}" if sample_errs else "",
    )
    return {"rows": len(rows), "skipped": skipped, "inserted": inserted, "updated": updated, "errors": errors}


def sync_biometric_attachments(state: _TokenState) -> Dict[str, int]:
    """Uploads portrait_{atid}.jpg via OAuth2 Bearer Token for active staff missing SharePoint attachment."""
    list_id = sp._SP_KNOWN_LIST_IDS["tbl_EmployeeBiometrics"]
    tok, _ = state.ensure_fresh()
    r = _session().get(
        f"{sp.SP_SITE_URL}/_api/web/lists(guid'{list_id}')/items"
        f"?$select=Id,Title,AttachmentFiles&$expand=AttachmentFiles&$top=5000",
        headers={"Authorization": f"Bearer {tok}", "Accept": "application/json;odata=nometadata"},
        timeout=20,
    )
    if r.status_code != 200:
        logger.warning("Could not list biometric SharePoint items: HTTP %s", r.status_code)
        return {"uploaded": 0, "skipped": 0, "errors": 1}

    sp_items_by_atid: Dict[str, Tuple[int, set]] = {}
    for it in r.json().get("value", []):
        title = str(it.get("Title") or "").strip()
        files = {str(af.get("FileName") or "").lower() for af in it.get("AttachmentFiles", [])}
        if title:
            sp_items_by_atid[title] = (int(it["Id"]), files)

    # Load active staff portraits from SQL Server
    with pyodbc.connect(db_mssql.get_connection_string(), timeout=8) as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT e.EmployeeATID, b.FacePhotoBase64
            FROM tbl_Employees e
            INNER JOIN tbl_EmployeeBiometrics b ON e.EmployeeATID = b.EmployeeATID
            WHERE e.IsStaff = 1 AND e.IsActive = 1
              AND e.DepartmentName IS NOT NULL AND e.DepartmentName <> '' AND e.DepartmentName <> N'Khác'
              AND b.FacePhotoBase64 IS NOT NULL AND LEN(b.FacePhotoBase64) > 20
        """)
        staff_photos = [(str(row[0]).strip(), str(row[1])) for row in cur.fetchall()]

    uploaded = 0
    skipped = 0
    errors = 0

    def _upload_one(atid: str, b64_uri: str) -> str:
        item_info = sp_items_by_atid.get(atid)
        if not item_info:
            return "skip"
        sp_id, existing_files = item_info
        fname = sp.sanitize_sp_attachment_name(f"portrait_{atid}.jpg")
        if fname.lower() in existing_files:
            return "skip"
        raw_b64 = b64_uri.split(",", 1)[1] if "," in b64_uri else b64_uri
        raw_bytes = base64.b64decode(raw_b64)
        for attempt in range(3):
            tk, dg = state.ensure_fresh()
            resp = _session().post(
                f"{sp.SP_SITE_URL}/_api/web/lists(guid'{list_id}')/items({sp_id})/AttachmentFiles/add(FileName='{fname}')",
                headers={
                    "Authorization": f"Bearer {tk}",
                    "X-RequestDigest": dg,
                    "Content-Type": "application/octet-stream",
                    "Accept": "application/json;odata=verbose",
                },
                data=raw_bytes,
                timeout=15,
            )
            if resp.status_code in (200, 201):
                return "ok"
            if resp.status_code in (429, 503):
                time.sleep(1.5 * (attempt + 1))
                continue
            if resp.status_code == 403 and "digest" in resp.text.lower():
                state.refresh()
                continue
            return "err"
        return "err"

    with ThreadPoolExecutor(max_workers=4) as pool:
        futs = [pool.submit(_upload_one, atid, b64) for atid, b64 in staff_photos]
        for fut in as_completed(futs):
            res = fut.result()
            if res == "ok":
                uploaded += 1
            elif res == "skip":
                skipped += 1
            else:
                errors += 1

    logger.info(
        "  [Biometric JPEG Attachments] total_with_photo=%d uploaded=%d already_attached=%d errors=%d",
        len(staff_photos), uploaded, skipped, errors,
    )
    return {"uploaded": uploaded, "skipped": skipped, "errors": errors}


def main() -> None:
    state = _TokenState()
    logger.info("SharePoint OAuth2 authenticated via SEAZENHR-PORTAL.")

    plan = [
        ("tbl_Departments", 100, False, 2),
        ("tbl_Employees", 500, False, 4),
        ("tbl_EmployeeBiometrics", 500, False, 4),
        ("tbl_CustomerCards", 200, False, 3),
        # Skip existing already-archived visitor rows to quickly insert ~890 newly merged backup visitors
        ("tbl_Visitors", 2000, True, 4),
        # Latest ~3,200 daily timekeeping rows (Aug-Nov 2026), keeping list safely < 5,000 SharePoint view limit
        ("tbl_DailyTimekeeping", 3200, False, 4),
        # Latest ~1,500 attendance logs, keeping list safely < 5,000 SharePoint view limit
        ("tbl_AttendanceLogs", 1500, True, 4),
        ("tbl_DoorAuditLogs", 150, True, 2),
    ]

    results: Dict[str, Any] = {}
    for tbl, lim, skip_ex, w in plan:
        results[tbl] = fast_sync_table(state, tbl, max_rows=lim, skip_existing=skip_ex, workers=w)

    results["biometric_attachments"] = sync_biometric_attachments(state)

    st = sp.get_vms_sharepoint_status()
    print("\n=== SHAREPOINT VMS FINAL LIST COUNTS ===")
    print(f"Account: {st.get('account')} | Authenticated: {st.get('authenticated')}")
    for item in st.get("schemas", []):
        print(f"  {item['sql_table']:28s} | {item['list_title']:40s} | {item.get('sp_item_count')} items")


if __name__ == "__main__":
    main()
